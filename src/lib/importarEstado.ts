import { esMensualidadDe } from "./calculos";
import { clasificar, normalizar } from "./categorizar";
import { db } from "./db";
import type { CompraMSI, Cuenta, EstadoCuenta, EstadoLeido, Movimiento, Regla } from "./tipos";
import { mesDe, uid } from "./util";

export interface ResultadoImportacion {
  estadoId: string;
  cuenta: Cuenta;
  agregados: number;
  repetidos: number; // ya estaban (de otro estado)
  conciliados: number; // gastos que capturaste a mano y llegaron en el estado
  msiActualizadas: number;
}

const NOMBRES: Record<string, string> = {
  BBVA: "BBVA", Banamex: "Banamex", HSBC: "HSBC", Amex: "American Express", Revolut: "Revolut", Otro: "Tarjeta",
};

async function cuentaPara(e: EstadoLeido, soloDe?: string): Promise<Cuenta> {
  const todas = await db.cuentas.where("banco").equals(e.banco).toArray();
  // Aunque esté archivada, si es la misma tarjeta se usa esa (no se crea otra igual)
  const exacta = todas.find((c) => e.terminacion && (c.terminacion === e.terminacion || c.alias?.includes(e.terminacion)));
  if (exacta) return exacta;
  const delBanco = todas.filter((c) => !c.archivada);
  if (delBanco.length === 1 && !delBanco[0].terminacion) return delBanco[0];
  const deOtro = soloDe && e.titular && soloDe !== e.titular;
  const nueva: Cuenta = {
    id: uid(),
    nombre: `${NOMBRES[e.banco]}${e.terminacion ? ` ••${e.terminacion}` : ""}${deOtro ? ` (titular ${nombrePropio(e.titular!)})` : ""}`,
    banco: e.banco,
    tipo: "credito",
    terminacion: e.terminacion,
    ...(soloDe ? { soloDe, titular: e.titular } : {}),
  };
  await db.cuentas.add(nueva);
  return nueva;
}

/** "MARIA JOSE PEREZ LOPEZ" → "Maria Jose" (nombre de pila, sin apellidos). */
const nombrePropio = (nombre: string) =>
  nombre.toLowerCase().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

const DIAS_CONCILIACION = 5;
const diasEntre = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Revisa si ese estado ya se importó antes. */
export async function yaImportado(e: EstadoLeido): Promise<boolean> {
  const cuentas = await db.cuentas.where("banco").equals(e.banco).toArray();
  const ids = new Set(cuentas.filter((c) => !e.terminacion || !c.terminacion || c.terminacion === e.terminacion || c.alias?.includes(e.terminacion)).map((c) => c.id));
  const mismos = await db.estados.where("fechaCorte").equals(e.fechaCorte).toArray();
  return mismos.some((x) => ids.has(x.cuentaId));
}

export interface OpcionesImportacion {
  /** Solo los movimientos de este tarjetahabiente (tu tarjeta adicional en la cuenta de alguien más). */
  soloDe?: string;
}

/** Deja solo tu parte del estado: tus movimientos, tus compras a meses y lo que te toca pagar. */
export function soloTuParte(e: EstadoLeido, nombre: string): EstadoLeido {
  const movimientos = e.movimientos.filter((m) => m.tarjetahabiente === nombre);
  const cargos = movimientos.reduce((s, m) => s + m.monto, 0);
  return {
    ...e, movimientos,
    msi: e.msi.filter((c) => c.tarjetahabiente === nombre),
    pagoNoIntereses: Math.round(Math.max(0, cargos) * 100) / 100,
    pagoMinimo: undefined, intereses: undefined, comisiones: undefined, iva: undefined, saldoTotal: undefined,
    totalCargos: Math.round(movimientos.filter((m) => m.monto > 0).reduce((s, m) => s + m.monto, 0) * 100) / 100,
    totalAbonos: undefined,
  };
}

/** Categoría para un gasto que es de alguien más ("Por cobrar - Luis"), conservando "Familia - …" si ya lo era. */
export function categoriaPara(responsable: string, actual: string, propia = "Compras a meses (propias)"): string {
  if (responsable === "Yo") return /^(Familia|Por cobrar) - /.test(actual) ? propia : actual;
  return actual.endsWith(` - ${responsable}`) ? actual : `Por cobrar - ${responsable}`;
}


/** Cambia de quién es una compra a meses y también sus mensualidades ya cargadas. */
export async function cambiarResponsableMSI(c: CompraMSI, responsable: string): Promise<void> {
  await db.transaction("rw", [db.msi, db.movimientos], async () => {
    await db.msi.update(c.id, { responsable });
    const movs = (await db.movimientos.where("cuentaId").equals(c.cuentaId).toArray()).filter((m) => esMensualidadDe(m, c));
    for (const m of movs) await db.movimientos.update(m.id, { responsable, categoria: categoriaPara(responsable, m.categoria) });
  });
}

export async function importarEstado(original: EstadoLeido, archivo?: string, opciones: OpcionesImportacion = {}): Promise<ResultadoImportacion> {
  const e = opciones.soloDe ? soloTuParte(original, opciones.soloDe) : original;
  const reglas = new Map<string, Regla>((await db.reglas.toArray()).map((r) => [r.clave, r]));
  return db.transaction("rw", [db.cuentas, db.movimientos, db.estados, db.msi, db.reglas], async () => {
    // Se revisa dentro de la transacción: un doble toque o el mismo PDF dos veces no lo duplican
    if (await yaImportado(e)) throw new Error("Este estado ya lo habías subido.");
    const cuenta = await cuentaPara(e, opciones.soloDe);
    const estadoId = uid();
    const periodo = mesDe(e.fechaCorte);
    const existentes = await db.movimientos.where("cuentaId").equals(cuenta.id).toArray();
    const usados = new Set<string>();

    // Compras a meses primero: sus mensualidades heredan de quién es la compra
    let msiActualizadas = 0;
    const msiCuenta = await db.msi.where("cuentaId").equals(cuenta.id).toArray();
    const msiUsadas = new Set<string>();
    for (const m of e.msi) {
      const previa = msiCuenta.find((x) => !msiUsadas.has(x.id) && Math.abs(x.montoOriginal - m.montoOriginal) < 0.01
        && x.totalPagos === m.totalPagos
        && ((x.fechaCompra && m.fechaCompra && x.fechaCompra === m.fechaCompra) || normalizar(x.descripcion) === normalizar(m.descripcion)))
        // La capturada a mano: mismo plazo y casi el mismo monto (pudo escribirse redondeado); la descripción del banco es otra
        ?? msiCuenta.find((x) => !msiUsadas.has(x.id) && x.manual && x.totalPagos === m.totalPagos && Math.abs(x.montoOriginal - m.montoOriginal) <= 1
          && (!x.fechaCompra || !m.fechaCompra || Math.abs(Date.parse(x.fechaCompra) - Date.parse(m.fechaCompra)) <= 10 * 86_400_000));
      if (previa) msiUsadas.add(previa.id);
      // Ya hay un estado más nuevo. (La capturada a mano tiene un corte estimado: el del banco siempre gana.)
      if (previa && !previa.manual && previa.actualizadoAl > e.fechaCorte) continue;
      const responsable = previa?.responsable ?? clasificar(m.descripcion, m.pagoMensual, reglas, cuenta.id).responsable;
      const compra: CompraMSI = { ...m, id: previa?.id ?? uid(), cuentaId: cuenta.id, responsable, actualizadoAl: e.fechaCorte };
      await db.msi.put(compra);
      if (!previa) msiCuenta.push(compra); else Object.assign(previa, compra);
      msiActualizadas++;
    }

    let agregados = 0, repetidos = 0, conciliados = 0;
    const nuevos: Movimiento[] = [];
    for (const l of e.movimientos) {
      // Ya venía en otro estado (o en el historial importado del Excel)
      const igual = existentes.find((m) => !usados.has(m.id) && m.origen !== "manual" && m.fecha === l.fecha
        && Math.abs(m.monto - l.monto) < 0.01 && normalizar(m.descripcion) === normalizar(l.descripcion));
      if (igual) { usados.add(igual.id); repetidos++; continue; }

      const c = clasificar(l.descripcion, l.monto, reglas, cuenta.id);
      // Mensualidad de una compra a meses que es de otra persona → a su nombre
      const compra = msiCuenta.find((x) => esMensualidadDe({ cuentaId: cuenta.id, monto: l.monto, descripcion: l.descripcion }, x));
      if (compra && compra.responsable !== c.responsable) {
        c.responsable = compra.responsable;
        c.categoria = categoriaPara(compra.responsable, c.categoria);
      }
      const mov: Movimiento = {
        id: uid(), cuentaId: cuenta.id, fecha: l.fecha, descripcion: l.descripcion, monto: l.monto,
        ...c, origen: "estado", estadoId, periodo, creado: Date.now(),
        ...(l.tarjetahabiente && !opciones.soloDe ? { nota: `Tarjeta ${l.tarjetahabiente.toLowerCase()}` } : {}),
      };
      // Lo capturaste a mano: se queda el del banco, con tu categoría y nota
      const manual = existentes.find((m) => !usados.has(m.id) && m.origen === "manual"
        && Math.abs(m.monto - l.monto) < 0.01 && diasEntre(m.fecha, l.fecha) <= DIAS_CONCILIACION);
      if (manual) {
        usados.add(manual.id);
        await db.movimientos.delete(manual.id);
        Object.assign(mov, {
          categoria: manual.categoria, tipo: manual.tipo, responsable: manual.responsable,
          nota: [manual.descripcion, manual.nota].filter(Boolean).join(" · "),
          manualOriginal: manual,
        });
        conciliados++;
      } else agregados++;
      nuevos.push(mov);
    }
    await db.movimientos.bulkAdd(nuevos);

    const estado: EstadoCuenta = {
      id: estadoId, cuentaId: cuenta.id, banco: e.banco, fechaCorte: e.fechaCorte, fechaLimite: e.fechaLimite,
      periodoDesde: e.periodoDesde, pagoNoIntereses: e.pagoNoIntereses, pagoMinimo: e.pagoMinimo,
      intereses: e.intereses, comisiones: e.comisiones, iva: e.iva, totalCargos: e.totalCargos,
      totalAbonos: e.totalAbonos, saldoTotal: e.saldoTotal, archivo, importado: Date.now(),
      ...(e.tasaAnual ? { tasaAnual: e.tasaAnual } : {}),
      ...(opciones.soloDe ? { soloDe: opciones.soloDe } : {}),
    };
    await db.estados.add(estado);
    return { estadoId, cuenta, agregados, repetidos, conciliados, msiActualizadas };
  });
}

/**
 * Quita un estado de cuenta: borra los movimientos que trajo y recupera los gastos que habías anotado
 * a mano y que se habían juntado con el banco. Las compras a meses se quedan como estaban.
 */
export async function quitarEstado(estadoId: string): Promise<number> {
  return db.transaction("rw", [db.movimientos, db.estados], async () => {
    const movs = await db.movimientos.where("estadoId").equals(estadoId).toArray();
    const recuperados = movs.map((m) => m.manualOriginal).filter((x): x is Movimiento => !!x);
    await db.movimientos.bulkDelete(movs.map((m) => m.id));
    if (recuperados.length) await db.movimientos.bulkPut(recuperados);
    await db.estados.delete(estadoId);
    return movs.length;
  });
}

/** Cuando corriges un movimiento, la app aprende para la próxima vez. */
export async function aprender(m: Movimiento): Promise<void> {
  const clave = normalizar(m.descripcion);
  if (clave.length < 3 || m.tipo === "Informativo") return;
  await db.reglas.put({ clave, categoria: m.categoria, responsable: m.responsable });
}
