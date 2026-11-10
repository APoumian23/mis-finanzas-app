// API de Mis Finanzas. Tres cosas: entrar/salir, saber quién eres, y sincronizar registros entre dispositivos.
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cifrar, HASH_FALSO, verificar } from "./clave.js";

/** Las tablas de la app que se sincronizan (cualquier otra se rechaza). */
export const TABLAS = ["cuentas", "movimientos", "estados", "msi", "prestamos", "deudores", "ajustes", "reglas"];
const COOKIE = "sesion";
const DIAS_SESION = 180;
const huella = (token) => createHash("sha256").update(token).digest("hex");

/** Intentos de entrar por IP: 10 cada 15 minutos. */
function limitador(max = 10, ventanaMs = 15 * 60_000) {
  const intentos = new Map();
  return (ip) => {
    const ahora = Date.now();
    const recientes = (intentos.get(ip) ?? []).filter((t) => ahora - t < ventanaMs);
    recientes.push(ahora);
    intentos.set(ip, recientes);
    if (intentos.size > 10_000) intentos.clear();
    return recientes.length <= max;
  };
}

function validarCambios(cambios) {
  if (!Array.isArray(cambios) || cambios.length > 50_000) return "cambios inválidos";
  for (const c of cambios) {
    if (!c || !TABLAS.includes(c.tabla)) return "tabla inválida";
    if (typeof c.id !== "string" || !c.id || c.id.length > 300) return "id inválido";
    if (!Number.isFinite(c.ts)) return "ts inválido";
    if (c.dato !== null && (typeof c.dato !== "object" || Array.isArray(c.dato))) return "dato inválido";
  }
  return null;
}

export function crearApp(sql, { seguro = true } = {}) {
  const app = new Hono().basePath("/api");
  const puedeIntentar = limitador();
  const ip = (c) => c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

  // Solo JSON en lo que escribe: junto con la cookie SameSite=Strict evita que otra página haga peticiones a tu nombre
  app.use("*", async (c, next) => {
    if (c.req.method === "POST" && !(c.req.header("content-type") ?? "").includes("application/json")) {
      return c.json({ error: "Se espera JSON" }, 415);
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  async function usuarioDeSesion(c) {
    const token = getCookie(c, COOKIE);
    if (!token) return null;
    const [fila] = await sql`
      UPDATE sesiones SET ultimo_uso = now()
      WHERE token_hash = ${huella(token)} AND expira > now()
      RETURNING usuario_id`;
    if (!fila) return null;
    const [u] = await sql`SELECT id, usuario FROM usuarios WHERE id = ${fila.usuario_id}`;
    return u ?? null;
  }
  const conSesion = async (c, next) => {
    const u = await usuarioDeSesion(c);
    if (!u) return c.json({ error: "Necesitas entrar" }, 401);
    c.set("usuario", u);
    await next();
  };

  app.post("/entrar", bodyLimit({ maxSize: 10_000 }), async (c) => {
    if (!puedeIntentar(ip(c))) return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    const { usuario, contrasena } = await c.req.json().catch(() => ({}));
    if (typeof usuario !== "string" || typeof contrasena !== "string") return c.json({ error: "Faltan datos" }, 400);
    const [u] = await sql`SELECT id, usuario, hash FROM usuarios WHERE usuario = ${usuario.trim().toLowerCase()}`;
    const ok = await verificar(contrasena, u?.hash ?? HASH_FALSO);
    if (!u || !ok) return c.json({ error: "Usuario o contraseña incorrectos" }, 401);
    const token = randomBytes(32).toString("base64url");
    await sql`
      INSERT INTO sesiones (token_hash, usuario_id, expira)
      VALUES (${huella(token)}, ${u.id}, now() + ${`${DIAS_SESION} days`}::interval)`;
    await sql`DELETE FROM sesiones WHERE expira < now()`;
    setCookie(c, COOKIE, token, { httpOnly: true, secure: seguro, sameSite: "Strict", path: "/api", maxAge: DIAS_SESION * 86400 });
    return c.json({ usuario: u.usuario });
  });

  app.post("/salir", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await sql`DELETE FROM sesiones WHERE token_hash = ${huella(token)}`;
    deleteCookie(c, COOKIE, { path: "/api", secure: seguro });
    return c.json({ ok: true });
  });

  app.get("/yo", conSesion, (c) => c.json({ usuario: c.get("usuario").usuario }));

  /**
   * Sincronizar: el dispositivo manda sus cambios y la última versión que ya tiene; recibe lo que cambió después.
   * Si dos dispositivos cambian el mismo registro, gana el cambio más reciente (ts).
   */
  app.post("/sync", conSesion, bodyLimit({ maxSize: 20 * 1024 * 1024 }), async (c) => {
    const { desde = 0, cambios = [] } = await c.req.json().catch(() => ({}));
    const error = validarCambios(cambios) ?? (Number.isFinite(desde) ? null : "desde inválido");
    if (error) return c.json({ error }, 400);
    const uid = c.get("usuario").id;
    const resultado = await sql.begin(async (tx) => {
      // Una sincronización a la vez por usuario: así nadie se salta una versión
      await tx`SELECT pg_advisory_xact_lock(${uid})`;
      await guardar(tx, uid, cambios);
      return leerDesde(tx, uid, desde);
    });
    return c.json(resultado);
  });

  /** Reemplazar todo (al restaurar un respaldo): lo que había se borra en todos los dispositivos y queda lo nuevo. */
  app.post("/reemplazar", conSesion, bodyLimit({ maxSize: 20 * 1024 * 1024 }), async (c) => {
    const { registros = [] } = await c.req.json().catch(() => ({}));
    const error = validarCambios(registros);
    if (error) return c.json({ error }, 400);
    const uid = c.get("usuario").id;
    const ts = Date.now();
    const resultado = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${uid})`;
      await tx`
        UPDATE registros SET borrado = true, dato = NULL, ts = ${ts}, version = nextval('version_registros')
        WHERE usuario_id = ${uid} AND NOT borrado`;
      await guardar(tx, uid, registros.map((r) => ({ ...r, ts: ts + 1 })));
      const [v] = await tx`SELECT coalesce(max(version), 0)::bigint AS version FROM registros WHERE usuario_id = ${uid}`;
      return { version: Number(v.version) };
    });
    return c.json(resultado);
  });

  app.onError((e, c) => {
    console.error(e);
    return c.json({ error: "Error del servidor" }, 500);
  });
  return app;
}

async function guardar(tx, uid, cambios) {
  for (let i = 0; i < cambios.length; i += 500) {
    const lote = cambios.slice(i, i + 500).map((x) => ({
      usuario_id: uid, tabla: x.tabla, id: x.id, dato: x.dato, borrado: x.dato === null, ts: Math.round(x.ts),
    }));
    await tx`
      INSERT INTO registros (usuario_id, tabla, id, dato, borrado, ts, version)
      SELECT usuario_id, tabla, id, dato, borrado, ts, nextval('version_registros')
      FROM jsonb_to_recordset(${tx.json(lote)}) AS x(usuario_id int, tabla text, id text, dato jsonb, borrado boolean, ts bigint)
      ON CONFLICT (usuario_id, tabla, id) DO UPDATE
        SET dato = excluded.dato, borrado = excluded.borrado, ts = excluded.ts, version = excluded.version
        WHERE registros.ts < excluded.ts`;
  }
}

async function leerDesde(tx, uid, desde) {
  const filas = await tx`
    SELECT tabla, id, dato, borrado, version FROM registros
    WHERE usuario_id = ${uid} AND version > ${desde} ORDER BY version`;
  const [v] = await tx`SELECT coalesce(max(version), 0)::bigint AS version FROM registros WHERE usuario_id = ${uid}`;
  return {
    version: Number(v.version),
    cambios: filas.map((f) => ({ tabla: f.tabla, id: f.id, dato: f.borrado ? null : f.dato })),
  };
}

export { cifrar };
