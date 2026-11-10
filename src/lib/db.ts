import Dexie, { type EntityTable, type Table } from "dexie";
import type {
  Ajustes, CompraMSI, Cuenta, Deudor, EstadoCuenta, Movimiento, Prestamo, Regla, Respaldo,
} from "./tipos";

// Todo vive en el navegador (IndexedDB) y funciona sin internet. Si entras con tu cuenta, los cambios se
// sincronizan con tu servidor (ver sync.ts): "pendientes" son los registros por subir y "meta" el estado.
export const db = new Dexie("mis-finanzas") as Dexie & {
  cuentas: EntityTable<Cuenta, "id">;
  movimientos: EntityTable<Movimiento, "id">;
  estados: EntityTable<EstadoCuenta, "id">;
  msi: EntityTable<CompraMSI, "id">;
  prestamos: EntityTable<Prestamo, "id">;
  deudores: EntityTable<Deudor, "id">;
  ajustes: EntityTable<Ajustes, "id">;
  reglas: EntityTable<Regla, "clave">;
  pendientes: Table<Pendiente, [string, string]>;
  meta: EntityTable<MetaSync, "clave">;
};

/** Tablas con tus datos (las que se respaldan y se sincronizan). */
export const TABLAS_DATOS = ["cuentas", "movimientos", "estados", "msi", "prestamos", "deudores", "ajustes", "reglas"] as const;
export type TablaDatos = (typeof TABLAS_DATOS)[number];

export interface Pendiente { tabla: TablaDatos; id: string; ts: number }
export interface MetaSync { clave: "sync"; usuario: string | null; desde: number; ultima?: string; error?: string }

/** Marca la transacción en curso para que sus cambios no se anoten como pendientes de subir. */
export const SIN_REGISTRO = "sinRegistro";
export const marcarSinRegistro = () => { (Dexie.currentTransaction as unknown as Record<string, boolean>)[SIN_REGISTRO] = true; };
const tablasDatos = () => TABLAS_DATOS.map((t) => db.table(t));

db.version(1).stores({
  cuentas: "id, banco",
  movimientos: "id, fecha, cuentaId, estadoId, categoria, responsable, periodo",
  estados: "id, cuentaId, fechaCorte",
  msi: "id, cuentaId",
  prestamos: "id",
  deudores: "id, nombre",
  ajustes: "id",
  reglas: "clave",
});
db.version(2).stores({
  pendientes: "[tabla+id]",
  meta: "clave",
});

export const AJUSTES_INICIALES: Ajustes = {
  id: "ajustes",
  ingresos: [],
  fijos: [],
  ahorroPct: 0.1,
  topes: {},
};

export async function leerAjustes(): Promise<Ajustes> {
  return (await db.ajustes.get("ajustes")) ?? AJUSTES_INICIALES;
}

export async function exportarTodo(): Promise<Respaldo> {
  const [cuentas, movimientos, estados, msi, prestamos, deudores, reglas] = await Promise.all([
    db.cuentas.toArray(), db.movimientos.toArray(), db.estados.toArray(), db.msi.toArray(),
    db.prestamos.toArray(), db.deudores.toArray(), db.reglas.toArray(),
  ]);
  return {
    version: 1,
    exportado: new Date().toISOString(),
    cuentas, movimientos, estados, msi, prestamos, deudores, reglas,
    ajustes: await leerAjustes(),
  };
}

/** La fecha "libre de deudas" recuerda el último valor para decir si se movió; con datos nuevos se olvida. */
function olvidarComparaciones() {
  try { localStorage.removeItem("libre-de-deudas"); } catch { /* sin almacenamiento local */ }
}

/** Reemplaza todos los datos por los del respaldo. */
export async function restaurar(r: Respaldo): Promise<void> {
  if (r?.version !== 1 || !Array.isArray(r.movimientos) || !Array.isArray(r.cuentas)) throw new Error("El archivo no es un respaldo de Mis Finanzas.");
  if (r.cuentas.length === 0) throw new Error("El respaldo no trae ninguna cuenta.");
  // Se descartan registros dañados en vez de dejar la app en blanco
  const fechaOk = (f: unknown) => typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f);
  const cuentas = new Set(r.cuentas.map((c) => c.id));
  const movimientos = r.movimientos.filter((m) => fechaOk(m?.fecha) && Number.isFinite(m?.monto) && cuentas.has(m.cuentaId));
  const descartados = r.movimientos.length - movimientos.length;
  r = { ...r, movimientos, prestamos: (r.prestamos ?? []).filter((p) => fechaOk(p?.fechaSaldoInicial) && Number.isFinite(p?.saldoInicial)) };
  if (descartados > 0) console.warn(`Respaldo: se descartaron ${descartados} movimientos dañados`);
  olvidarComparaciones();
  await db.transaction("rw", [...tablasDatos(), db.pendientes], async () => {
    marcarSinRegistro(); // si tienes cuenta, el respaldo se sube completo aparte (reemplaza lo del servidor)
    await Promise.all([...tablasDatos(), db.pendientes].map((t) => t.clear()));
    await db.cuentas.bulkAdd(r.cuentas);
    await db.movimientos.bulkAdd(r.movimientos);
    await db.estados.bulkAdd(r.estados ?? []);
    await db.msi.bulkAdd(r.msi ?? []);
    await db.prestamos.bulkAdd(r.prestamos ?? []);
    await db.deudores.bulkAdd(r.deudores ?? []);
    await db.reglas.bulkAdd(r.reglas ?? []);
    await db.ajustes.put({ ...AJUSTES_INICIALES, ...r.ajustes, id: "ajustes" });
  });
}

/** Borra tus datos de este dispositivo (no los de tu cuenta en el servidor). */
export async function borrarTodo(): Promise<void> {
  olvidarComparaciones();
  await db.transaction("rw", [...tablasDatos(), db.pendientes], async () => {
    marcarSinRegistro();
    await Promise.all([...tablasDatos(), db.pendientes].map((t) => t.clear()));
  });
}
