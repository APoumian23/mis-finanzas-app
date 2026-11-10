// Sincronización con tu servidor. La app sigue funcionando sin internet: cada cambio se anota en "pendientes"
// y se sube cuando hay conexión; lo que cambiaste en otro dispositivo baja y se aplica. Si el mismo registro
// cambió en dos lados, gana el cambio más reciente.
import { db, marcarSinRegistro, SIN_REGISTRO, TABLAS_DATOS, type MetaSync, type TablaDatos } from "./db";

const API = "/api";
type Cambio = { tabla: TablaDatos; id: string; dato: Record<string, unknown> | null };
type RespuestaSync = { version: number; cambios: Cambio[] };

// ---------- Anotar lo que cambia en este dispositivo ----------

const cola = new Map<string, { tabla: TablaDatos; id: string; ts: number }>();
let vaciado: ReturnType<typeof setTimeout> | undefined;

function anotar(tabla: TablaDatos, id: unknown, trans: unknown) {
  if ((trans as Record<string, unknown> | undefined)?.[SIN_REGISTRO] || id === undefined) return;
  cola.set(`${tabla}|${id}`, { tabla, id: String(id), ts: Date.now() });
  // Se guarda fuera de la transacción de la app (que no incluye la tabla de pendientes)
  clearTimeout(vaciado);
  vaciado = setTimeout(() => void vaciarCola(), 0);
}

async function vaciarCola() {
  if (cola.size === 0) return;
  const lote = [...cola.values()];
  cola.clear();
  await db.pendientes.bulkPut(lote);
  programar(2000);
}

let instalado = false;
/** Engancha los cambios de cada tabla y arranca la sincronización automática. */
export function instalarSync() {
  if (instalado) return;
  instalado = true;
  for (const tabla of TABLAS_DATOS) {
    const t = db.table(tabla);
    const clave = t.schema.primKey.keyPath as string;
    t.hook("creating", (primKey, obj, trans) => anotar(tabla, primKey ?? (obj as Record<string, unknown>)[clave], trans));
    t.hook("updating", (_cambios, primKey, _obj, trans) => anotar(tabla, primKey, trans));
    t.hook("deleting", (primKey, _obj, trans) => anotar(tabla, primKey, trans));
  }
  if (typeof document === "undefined") return; // pruebas en node: solo los ganchos
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") programar(300); });
  window.addEventListener("online", () => programar(300));
  setInterval(() => { if (document.visibilityState === "visible") programar(0); }, 60_000);
  programar(1000);
}

// ---------- Estado ----------

const META_VACIA: MetaSync = { clave: "sync", usuario: null, desde: 0 };
export const leerMeta = async () => (await db.meta.get("sync")) ?? META_VACIA;
const guardarMeta = async (cambios: Partial<MetaSync>) => db.meta.put({ ...(await leerMeta()), ...cambios, clave: "sync" });

async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: cuerpo === undefined ? undefined : { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    credentials: "same-origin",
  });
  if (r.status === 401) {
    if (ruta !== "/entrar") await guardarMeta({ usuario: null, error: "Tu sesión terminó: vuelve a entrar." });
    throw new ErrorSync((await r.json().catch(() => null))?.error ?? "Necesitas entrar", r.status);
  }
  if (!r.ok) throw new ErrorSync((await r.json().catch(() => null))?.error ?? `El servidor respondió ${r.status}`, r.status);
  return r.json() as Promise<T>;
}
export class ErrorSync extends Error {
  constructor(mensaje: string, readonly estado?: number) { super(mensaje); }
}

// ---------- Sincronizar ----------

let temporizador: ReturnType<typeof setTimeout> | undefined;
let enCurso: Promise<void> | null = null;
let otraVez = false;

/** Pide una sincronización dentro de `ms` (varias seguidas se juntan en una). */
export function programar(ms = 2000) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => void sincronizar().catch(() => undefined), ms);
}

/** Sube lo pendiente y baja lo nuevo. No hace nada si no has entrado o no hay internet. */
export async function sincronizar(): Promise<void> {
  if (enCurso) { otraVez = true; return enCurso; }
  enCurso = (async () => {
    try {
      const meta = await leerMeta();
      if (!meta.usuario || globalThis.navigator?.onLine === false) return;
      await vaciarCola();
      const pendientes = await db.pendientes.toArray();
      const cambios = await Promise.all(pendientes.map(async (p) => ({ ...p, dato: (await db.table(p.tabla).get(p.id)) ?? null })));
      const r = await pedir<RespuestaSync>("/sync", { desde: meta.desde, cambios });
      await aplicar(r, pendientes);
      await guardarMeta({ desde: r.version, ultima: new Date().toISOString(), error: undefined });
    } catch (e) {
      if (!(e instanceof ErrorSync && e.estado === 401)) await guardarMeta({ error: (e as Error).message || "Sin conexión" });
      throw e;
    } finally {
      enCurso = null;
      if (otraVez) { otraVez = false; programar(500); }
    }
  })();
  return enCurso;
}

/** Aplica lo que llegó del servidor sin pisar lo que cambiaste aquí mientras se sincronizaba. */
async function aplicar(r: RespuestaSync, enviados: { tabla: TablaDatos; id: string; ts: number }[]) {
  await db.transaction("rw", [db.pendientes, ...TABLAS_DATOS.map((t) => db.table(t))], async () => {
    marcarSinRegistro();
    for (const p of enviados) {
      const actual = await db.pendientes.get([p.tabla, p.id]);
      if (actual && actual.ts === p.ts) await db.pendientes.delete([p.tabla, p.id]);
    }
    for (const c of r.cambios) {
      if (await db.pendientes.get([c.tabla, c.id])) continue; // lo cambiaste aquí después: se sube en la siguiente
      if (c.dato === null) await db.table(c.tabla).delete(c.id);
      else await db.table(c.tabla).put(c.dato);
    }
  });
}

// ---------- Entrar y salir ----------

export interface AlEntrar { usuario: string; servidorTieneDatos: boolean; dispositivoTieneDatos: boolean; respuesta: RespuestaSync }

/**
 * Entra con tu usuario y dice si hay datos en tu cuenta y en este dispositivo. Todavía no queda conectado:
 * falta decidir con cuáles datos se queda (usarDatosDelServidor o subirReemplazando).
 */
export async function entrar(usuario: string, contrasena: string): Promise<AlEntrar> {
  const { usuario: nombre } = await pedir<{ usuario: string }>("/entrar", { usuario, contrasena });
  const respuesta = await pedir<RespuestaSync>("/sync", { desde: 0, cambios: [] });
  return {
    usuario: nombre,
    servidorTieneDatos: respuesta.cambios.some((c) => c.dato !== null),
    dispositivoTieneDatos: (await db.cuentas.count()) > 0,
    respuesta,
  };
}

/** Este dispositivo se queda con lo que hay en tu cuenta (lo de aquí se reemplaza). */
export async function usarDatosDelServidor(r: RespuestaSync, usuario: string) {
  await db.transaction("rw", [db.pendientes, ...TABLAS_DATOS.map((t) => db.table(t))], async () => {
    marcarSinRegistro();
    await Promise.all([db.pendientes, ...TABLAS_DATOS.map((t) => db.table(t))].map((t) => t.clear()));
    for (const c of r.cambios) if (c.dato !== null) await db.table(c.tabla).put(c.dato);
  });
  await guardarMeta({ usuario, desde: r.version, ultima: new Date().toISOString(), error: undefined });
}

/** Tu cuenta se queda con lo que hay en este dispositivo (lo de la cuenta se reemplaza en todos lados). */
export async function subirReemplazando(usuario?: string) {
  const registros: (Cambio & { ts: number })[] = [];
  const ts = Date.now();
  for (const tabla of TABLAS_DATOS) {
    const t = db.table(tabla);
    const clave = t.schema.primKey.keyPath as string;
    for (const dato of await t.toArray()) registros.push({ tabla, id: String(dato[clave]), dato, ts });
  }
  const { version } = await pedir<{ version: number }>("/reemplazar", { registros });
  await db.pendientes.clear();
  await guardarMeta({ ...(usuario ? { usuario } : {}), desde: version, ultima: new Date().toISOString(), error: undefined });
}

export async function salir() {
  await pedir("/salir", {}).catch(() => undefined);
  await db.pendientes.clear();
  await guardarMeta({ usuario: null, desde: 0, ultima: undefined, error: undefined });
}

/** ¿Estás conectado a tu cuenta en este dispositivo? */
export const conectado = async () => !!(await leerMeta()).usuario;

