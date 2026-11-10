// La app contra la API real (Hono + Postgres de prueba), simulando dos dispositivos. Solo con BD_PRUEBA.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { cifrar, crearApp } from "./src/app.js";
import Dexie from "dexie";
import { db, TABLAS_DATOS } from "../src/lib/db";
import { entrar, instalarSync, leerMeta, sincronizar, subirReemplazando, usarDatosDelServidor } from "../src/lib/sync";

const URL = process.env.BD_PRUEBA;
const esperar = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Cada "dispositivo" es su propia base IndexedDB guardada aparte: se cambia el contenido entre uno y otro. */
type Foto = Record<string, unknown[]>;
async function foto(): Promise<Foto> {
  const r: Foto = {};
  for (const t of [...TABLAS_DATOS, "pendientes", "meta"]) r[t] = await db.table(t).toArray();
  return r;
}
async function cargar(f: Foto) {
  for (const t of [...TABLAS_DATOS, "pendientes", "meta"]) {
    await db.transaction("rw", db.table(t), async () => {
      (Dexie.currentTransaction as unknown as Record<string, boolean>).sinRegistro = true;
      await db.table(t).clear();
      await db.table(t).bulkAdd(f[t] ?? []);
    });
  }
}

describe.skipIf(!URL)("sincronización entre dos dispositivos", () => {
  let sql: ReturnType<typeof postgres>;
  let cookie = "";

  beforeAll(async () => {
    sql = postgres(URL!, { onnotice: () => {} });
    await sql`DELETE FROM usuarios WHERE usuario = 'prueba-sync'`;
    await sql`INSERT INTO usuarios (usuario, hash) VALUES ('prueba-sync', ${await cifrar("una clave larga")})`;
    const app = crearApp(sql, { seguro: false });
    // fetch del navegador → la API, con una cookie compartida
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const r = await app.request(url, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } });
      const nueva = r.headers.get("set-cookie");
      if (nueva) cookie = nueva.split(";")[0];
      return r;
    }) as typeof fetch;
    instalarSync();
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  afterAll(async () => { await sql`DELETE FROM usuarios WHERE usuario = 'prueba-sync'`; await sql.end(); });

  let telefono: Foto, compu: Foto;

  it("el teléfono entra con datos y la cuenta vacía: sube todo", async () => {
    await db.cuentas.add({ id: "bbva", nombre: "BBVA", banco: "BBVA", tipo: "credito" });
    await db.movimientos.add({ id: "m1", cuentaId: "bbva", fecha: "2026-10-20", descripcion: "Tacos", monto: 150, categoria: "Comida fuera y bares", tipo: "Variable", responsable: "Yo", origen: "manual", creado: 1 });
    await esperar();
    const r = await entrar("prueba-sync", "una clave larga");
    expect(r).toMatchObject({ servidorTieneDatos: false, dispositivoTieneDatos: true });
    await subirReemplazando(r.usuario);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM registros r JOIN usuarios u ON u.id = r.usuario_id WHERE u.usuario = 'prueba-sync' AND NOT r.borrado`;
    expect(n).toBe(2);
    telefono = await foto();
  });

  it("la compu entra sin datos: baja todo", async () => {
    await cargar({});
    const r = await entrar("prueba-sync", "una clave larga");
    expect(r).toMatchObject({ servidorTieneDatos: true, dispositivoTieneDatos: false });
    await usarDatosDelServidor(r.respuesta, r.usuario);
    expect((await db.movimientos.get("m1"))?.descripcion).toBe("Tacos");
    compu = await foto();
  });

  it("un gasto anotado en la compu aparece en el teléfono, y un borrado también", async () => {
    await db.movimientos.add({ id: "m2", cuentaId: "bbva", fecha: "2026-10-21", descripcion: "Gasolina", monto: 900, categoria: "Gasolina y auto", tipo: "Variable", responsable: "Yo", origen: "manual", creado: 2 });
    await db.movimientos.delete("m1");
    await esperar();
    expect(await db.pendientes.count()).toBe(2);
    await sincronizar();
    expect(await db.pendientes.count()).toBe(0);
    compu = await foto();

    await cargar(telefono);
    await sincronizar();
    expect((await db.movimientos.toArray()).map((m) => m.id)).toEqual(["m2"]);
    expect((await leerMeta()).error).toBeUndefined();
    telefono = await foto();
  });

  it("lo que se cambia aquí mientras llega algo del servidor no se pisa", async () => {
    // En la compu cambia el monto; en el teléfono, sin sincronizar, cambia la descripción del mismo gasto (más tarde)
    await cargar(compu);
    await db.movimientos.update("m2", { monto: 950 });
    await esperar();
    await sincronizar();
    compu = await foto();
    await cargar(telefono);
    await db.movimientos.update("m2", { descripcion: "Gasolina Pemex" });
    await esperar(5);
    await sincronizar();
    // Gana el cambio más reciente (el del teléfono), y la compu lo recibe
    const enTelefono = await db.movimientos.get("m2");
    expect(enTelefono?.descripcion).toBe("Gasolina Pemex");
    await cargar(compu);
    await sincronizar();
    expect((await db.movimientos.get("m2"))?.descripcion).toBe("Gasolina Pemex");
  });
});
