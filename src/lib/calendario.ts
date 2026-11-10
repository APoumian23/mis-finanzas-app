// Calendario de pagos: qué entra y qué sale de tu bolsa, fecha por fecha, en las próximas semanas.
import { estadoPrestamo, msiDelMes, pagadoDe, tarjetasPorPagar } from "./calculos";
import type { Ajustes, CompraMSI, Cuenta, EstadoCuenta, Movimiento, Prestamo } from "./tipos";
import { diasEnMes, mesDe, redondear, sumar, sumarMeses } from "./util";

export type TipoEvento = "ingreso" | "tarjeta" | "prestamo" | "estimado" | "pendiente";

export interface Evento {
  fecha: string;
  tipo: TipoEvento;
  concepto: string;
  /** Positivo si entra dinero, negativo si sale. */
  monto: number;
  /** Lo menos que se puede pagar para no generar penalización (solo tarjetas). */
  minimo?: number;
  detalle?: string;
  vencido?: boolean;
  /** De qué tarjeta es (tarjetas y estimados). */
  cuentaId?: string;
}

export interface DatosCalendario {
  ajustes: Ajustes;
  cuentas: Cuenta[];
  estados: EstadoCuenta[];
  movimientos: Movimiento[];
  msi: CompraMSI[];
  prestamos: Prestamo[];
}

/** "2026-11" + 30 → "2026-11-30" (o el último día si el mes es más corto). */
const fechaDelMes = (mes: string, dia: number) => `${mes}-${String(Math.min(dia, diasEnMes(mes))).padStart(2, "0")}`;
const mesesEntre = (desde: string, hasta: string) => {
  const meses: string[] = [];
  for (let m = mesDe(desde); m <= mesDe(hasta); m = sumarMeses(m, 1)) meses.push(m);
  return meses;
};
const sumarDias = (fecha: string, dias: number) => new Date(Date.parse(fecha) + dias * 86_400_000).toISOString().slice(0, 10);

/** ¿Este movimiento es la mensualidad de esa compra a meses que ya se cargó? */
const yaCargada = (c: CompraMSI, movs: Movimiento[]) =>
  movs.some((m) => Math.abs(m.monto - c.pagoMensual) < 0.01 && /^\s*\d{1,3}\s+DE\s+\d{1,3}\b/i.test(m.descripcion));

/**
 * Entradas y salidas de `hoy` a `hoy + dias`. Lo vencido o atrasado va con fecha de hoy.
 * Los gastos fijos no van aparte: casi todos se cobran a tus tarjetas y entran en su estado de cuenta.
 */
export function calendarioDePagos(d: DatosCalendario, hoy: string, dias = 45): Evento[] {
  const fin = sumarDias(hoy, dias);
  const enRango = (f: string) => f >= hoy && f <= fin;
  const eventos: Evento[] = [];
  const nombre = new Map(d.cuentas.map((c) => [c.id, c.nombre]));

  // Ingresos con día fijo
  for (const i of d.ajustes.ingresos) {
    if (!i.dia || i.monto <= 0) continue;
    for (const mes of mesesEntre(hoy, fin)) {
      const f = fechaDelMes(mes, i.dia);
      if (enRango(f)) eventos.push({ fecha: f, tipo: "ingreso", concepto: i.concepto, monto: i.monto });
    }
  }

  // Tarjetas: lo que falta del último estado de cada una
  const porPagar = tarjetasPorPagar(d.estados, d.movimientos, hoy);
  for (const { e, falta, vencido } of porPagar) {
    const minimo = e.pagoMinimo !== undefined ? redondear(Math.max(0, e.pagoMinimo - pagadoDe(e, d.movimientos))) : undefined;
    const fecha = vencido ? hoy : e.fechaLimite!;
    if (!enRango(fecha)) continue;
    eventos.push({
      fecha, tipo: "tarjeta", concepto: nombre.get(e.cuentaId) ?? e.banco, monto: -falta, vencido, cuentaId: e.cuentaId,
      minimo: minimo !== undefined && minimo < falta ? minimo : undefined,
      detalle: vencido ? "Vencida: págala cuanto antes" : e.soloDe ? "Tu parte" : "Para no generar intereses",
    });
  }

  // Tarjetas al corriente: su próximo estado, estimado con lo que ya llevan cargado y las mensualidades que faltan
  const ultimo = new Map<string, EstadoCuenta>();
  for (const e of d.estados) {
    const previo = ultimo.get(e.cuentaId);
    if (!previo || e.fechaCorte > previo.fechaCorte) ultimo.set(e.cuentaId, e);
  }
  const vencidas = new Set(porPagar.filter((x) => x.vencido).map((x) => x.e.cuentaId));
  for (const e of ultimo.values()) {
    // Una vencida no tiene fecha límite: su próximo estado depende de cuándo te pongas al corriente
    if (!e.fechaLimite || vencidas.has(e.cuentaId) || e.fechaLimite === e.fechaCorte) continue;
    const corte = sumarMeses(mesDe(e.fechaCorte), 1);
    const limite = fechaDelMes(sumarMeses(mesDe(e.fechaLimite), 1), Number(e.fechaLimite.slice(8)));
    if (!enRango(limite)) continue;
    const despues = d.movimientos.filter((m) => m.cuentaId === e.cuentaId && m.fecha > e.fechaCorte && m.monto > 0
      && m.tipo !== "Informativo" && (!e.soloDe || m.responsable === "Yo"));
    const faltanMSI = d.msi.filter((c) => c.cuentaId === e.cuentaId && msiDelMes([c], corte) > 0 && !yaCargada(c, despues));
    const cargos = [...despues.map((m) => ({ monto: m.monto, quien: m.responsable })), ...faltanMSI.map((c) => ({ monto: c.pagoMensual, quien: c.responsable }))];
    const total = sumar(cargos, (x) => x.monto);
    if (total < 0.5) continue;
    const deOtros = sumar(cargos.filter((x) => x.quien !== "Yo"), (x) => x.monto);
    eventos.push({
      fecha: limite, tipo: "estimado", concepto: `${nombre.get(e.cuentaId) ?? e.banco} (próximo estado)`, monto: -total, cuentaId: e.cuentaId,
      detalle: `Estimado con lo que lleva cargado${deOtros > 0.5 ? ` · $${Math.round(deOtros).toLocaleString("es-MX")} son de otras personas` : ""}`,
    });
  }

  // Préstamos: atraso (hoy) y pagos que tocan
  for (const p of d.prestamos) {
    const e = estadoPrestamo(p, hoy);
    if (e.saldo <= 0.01) continue;
    if (e.atraso > 1) {
      eventos.push({ fecha: hoy, tipo: "pendiente", concepto: p.nombre, monto: -e.atraso, detalle: "Pagos que ya tocaban y aún no cubres" });
    }
    const quincenal = !!p.quincenal;
    const dia = p.primerPago ? Number(p.primerPago.slice(8)) : undefined;
    if (!quincenal && !dia) continue;
    for (const mes of mesesEntre(hoy, fin)) {
      const fechas = quincenal ? [fechaDelMes(mes, 15), fechaDelMes(mes, 31)] : [fechaDelMes(mes, dia!)];
      for (const f of fechas) {
        if (f <= hoy || f > fin || (p.primerPago && f < p.primerPago) || (p.ultimoPago && f > p.ultimoPago)) continue;
        eventos.push({ fecha: f, tipo: "prestamo", concepto: p.nombre, monto: -redondear(quincenal ? p.pagoMensual / 2 : p.pagoMensual) });
      }
    }
  }

  // Mismo día: primero lo que entra
  return eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
}

/** Lo que te quedaría después de cada fecha, empezando con lo que tienes hoy. */
export function saldoPorFecha(eventos: Evento[], inicial: number, soloMinimos = false): Map<string, number> {
  const saldos = new Map<string, number>();
  let saldo = inicial;
  for (const ev of eventos) {
    saldo += soloMinimos && ev.minimo !== undefined ? -ev.minimo : ev.monto;
    saldos.set(ev.fecha, redondear(saldo));
  }
  return saldos;
}

export type Alcance = "pagada" | "completa" | "minimo" | "no";

export interface FilaAlcance {
  cuentaId: string;
  concepto: string;
  /** Fecha límite (hoy si ya está vencida). */
  fecha: string;
  vencido?: boolean;
  /** Es el próximo estado, estimado con lo que lleva cargado. */
  estimado?: boolean;
  /** Lo que falta para no generar intereses. */
  falta: number;
  /** Lo que falta del mínimo; 0 = ya está cubierto; sin dato si el banco no da mínimo (hay que pagarla completa). */
  minimo?: number;
  alcance: Alcance;
  /** Lo que tendrías justo antes de esa fecha (con lo de hoy, tus ingresos y lo que pagaste antes). */
  antes: number;
  /** Lo que te entra de hoy a esa fecha. */
  entran: number;
  /** Cuánto te faltaría: para pagarla completa si alcanza el mínimo; si no, para el mínimo (o el total, si no hay mínimo). */
  faltaria: number;
  /** Tasa de interés anual de la tarjeta (del estado de cuenta más reciente que la trae). */
  tasaAnual?: number;
  /** Intereses aproximados del siguiente mes si pagas solo el mínimo (con IVA). */
  interesesSiMinimo?: number;
}

/**
 * ¿Te alcanza para pagar cada tarjeta a tiempo? Va fecha por fecha con lo que tienes hoy y tus ingresos:
 * si te alcanza la pagas completa; si no, se cuenta que pagas el mínimo y sigues con lo que quede.
 * También pasan los pagos de tus préstamos; no los atrasos con tu familia ni tu gasto del día a día.
 */
export function alcancePorBanco(d: DatosCalendario, hoy: string, inicial: number, dias = 45): FilaAlcance[] {
  const nombre = new Map(d.cuentas.map((c) => [c.id, c.nombre]));
  const tasas = new Map<string, { corte: string; tasa: number }>();
  for (const e of d.estados) {
    const previa = tasas.get(e.cuentaId);
    if (e.tasaAnual && (!previa || e.fechaCorte > previa.corte)) tasas.set(e.cuentaId, { corte: e.fechaCorte, tasa: e.tasaAnual });
  }
  const tasaDe = (id: string) => tasas.get(id)?.tasa;
  const filas: FilaAlcance[] = [];

  // Las que ya pagaste y todavía no llega su fecha límite
  const ultimo = new Map<string, EstadoCuenta>();
  for (const e of d.estados) {
    const previo = ultimo.get(e.cuentaId);
    if (!previo || e.fechaCorte > previo.fechaCorte) ultimo.set(e.cuentaId, e);
  }
  for (const e of ultimo.values()) {
    if (!e.fechaLimite || e.fechaLimite < hoy || (e.pagoNoIntereses ?? 0) <= 0) continue;
    if ((e.pagoNoIntereses ?? 0) - pagadoDe(e, d.movimientos) > 0.5) continue;
    filas.push({ cuentaId: e.cuentaId, concepto: nombre.get(e.cuentaId) ?? e.banco, fecha: e.fechaLimite, falta: 0, alcance: "pagada",
      antes: 0, entran: 0, faltaria: 0, tasaAnual: tasaDe(e.cuentaId) });
  }

  let saldo = inicial;
  let entran = 0;
  for (const ev of calendarioDePagos(d, hoy, dias)) {
    if (ev.tipo === "pendiente") continue;
    if (ev.tipo === "ingreso") { saldo += ev.monto; entran += ev.monto; continue; }
    if (ev.tipo === "prestamo") { saldo += ev.monto; continue; }
    const falta = -ev.monto;
    const minimo = ev.minimo;
    const necesario = minimo ?? falta;
    const alcance: Alcance = saldo >= falta - 0.005 ? "completa" : saldo >= necesario - 0.005 ? "minimo" : "no";
    const tasa = ev.cuentaId ? tasaDe(ev.cuentaId) : undefined;
    filas.push({
      cuentaId: ev.cuentaId ?? ev.concepto, concepto: ev.tipo === "estimado" ? ev.concepto.replace(/ \(próximo estado\)$/, "") : ev.concepto,
      fecha: ev.fecha, vencido: ev.vencido, estimado: ev.tipo === "estimado" || undefined, falta, minimo, alcance,
      antes: redondear(saldo), entran: redondear(entran),
      faltaria: alcance === "completa" ? 0 : redondear((alcance === "minimo" ? falta : necesario) - Math.max(0, saldo)),
      tasaAnual: tasa,
      interesesSiMinimo: tasa && minimo !== undefined && falta - minimo > 0.5 ? redondear((falta - minimo) * (tasa / 12) * 1.16) : undefined,
    });
    saldo -= alcance === "completa" ? falta : necesario;
  }
  // Primero lo que vence antes; las ya pagadas al final
  return filas.sort((a, b) => Number(a.alcance === "pagada") - Number(b.alcance === "pagada") || a.fecha.localeCompare(b.fecha));
}
