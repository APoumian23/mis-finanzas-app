// Pruebas de la API contra un Postgres de prueba. Solo corren con BD_PRUEBA (no tocan la base real):
//   BD_PRUEBA=postgresql://prueba@127.0.0.1:55432/finanzas_prueba pnpm vitest run servidor
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { cifrar, crearApp } from "./src/app.js";

const URL = process.env.BD_PRUEBA;

describe.skipIf(!URL)("API", () => {
  let sql, app, cookie = "";
  const pedir = (ruta, cuerpo, extra = {}) => app.request(`/api${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie, ...extra },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  beforeAll(async () => {
    sql = postgres(URL, { onnotice: () => {} });
    await sql`DELETE FROM usuarios WHERE usuario = 'prueba-api'`;
    await sql`INSERT INTO usuarios (usuario, hash) VALUES ('prueba-api', ${await cifrar("una clave larga")})`;
    app = crearApp(sql, { seguro: false });
  });
  afterAll(async () => { await sql`DELETE FROM usuarios WHERE usuario = 'prueba-api'`; await sql.end(); });

  it("no deja sincronizar sin entrar, ni entrar con la contraseña mal", async () => {
    expect((await pedir("/sync", { desde: 0, cambios: [] })).status).toBe(401);
    expect((await pedir("/entrar", { usuario: "prueba-api", contrasena: "otra" })).status).toBe(401);
    expect((await pedir("/entrar", { usuario: "nadie", contrasena: "una clave larga" })).status).toBe(401);
  });

  it("entra y regresa una cookie que sirve para /yo", async () => {
    const r = await pedir("/entrar", { usuario: "Prueba-API ", contrasena: "una clave larga" });
    expect(r.status).toBe(200);
    cookie = r.headers.get("set-cookie").split(";")[0];
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(await (await pedir("/yo")).json()).toEqual({ usuario: "prueba-api" });
  });

  it("rechaza peticiones que no son JSON y tablas desconocidas", async () => {
    expect((await app.request("/api/sync", { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await pedir("/sync", { desde: 0, cambios: [{ tabla: "usuarios", id: "1", dato: {}, ts: 1 }] })).status).toBe(400);
  });

  it("sincroniza: un dispositivo sube, el otro baja, y gana el cambio más reciente", async () => {
    const a = await (await pedir("/sync", { desde: 0, cambios: [
      { tabla: "movimientos", id: "m1", dato: { id: "m1", monto: 100 }, ts: 1000 },
      { tabla: "ajustes", id: "ajustes", dato: { id: "ajustes", ahorroPct: 0.1 }, ts: 1000 },
    ] })).json();
    expect(a.cambios).toHaveLength(2);

    // Otro dispositivo, desde cero, recibe todo
    const b = await (await pedir("/sync", { desde: 0, cambios: [] })).json();
    expect(b.cambios.map((x) => x.id).sort()).toEqual(["ajustes", "m1"]);

    // Un cambio viejo no pisa uno nuevo
    await pedir("/sync", { desde: b.version, cambios: [{ tabla: "movimientos", id: "m1", dato: { id: "m1", monto: 200 }, ts: 3000 }] });
    const viejo = await (await pedir("/sync", { desde: b.version, cambios: [{ tabla: "movimientos", id: "m1", dato: { id: "m1", monto: 150 }, ts: 2000 }] })).json();
    expect(viejo.cambios.find((x) => x.id === "m1").dato.monto).toBe(200);

    // Borrar llega como dato null
    const borrado = await (await pedir("/sync", { desde: viejo.version, cambios: [{ tabla: "movimientos", id: "m1", dato: null, ts: 4000 }] })).json();
    expect(borrado.cambios).toEqual([{ tabla: "movimientos", id: "m1", dato: null }]);
  });

  it("reemplazar borra lo anterior en todos los dispositivos y deja lo nuevo", async () => {
    const antes = await (await pedir("/sync", { desde: 0, cambios: [] })).json();
    const r = await (await pedir("/reemplazar", { registros: [{ tabla: "cuentas", id: "c1", dato: { id: "c1", nombre: "BBVA" }, ts: 1 }] })).json();
    expect(r.version).toBeGreaterThan(antes.version);
    const despues = await (await pedir("/sync", { desde: antes.version, cambios: [] })).json();
    expect(despues.cambios).toEqual(expect.arrayContaining([
      { tabla: "ajustes", id: "ajustes", dato: null },
      { tabla: "cuentas", id: "c1", dato: { id: "c1", nombre: "BBVA" } },
    ]));
  });

  it("salir cierra la sesión", async () => {
    expect((await pedir("/salir", {})).status).toBe(200);
    expect((await pedir("/yo")).status).toBe(401);
  });

  it("frena los intentos de adivinar la contraseña", async () => {
    const otraApp = crearApp(sql, { seguro: false });
    const intento = () => otraApp.request("/api/entrar", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "1.2.3.4" }, body: JSON.stringify({ usuario: "prueba-api", contrasena: "x" }) });
    for (let i = 0; i < 10; i++) await intento();
    expect((await intento()).status).toBe(429);
  });
});
