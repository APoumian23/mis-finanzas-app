import type { Ajustes, CompraMSI, Deudor, EstadoCuenta, Movimiento, Prestamo, TipoGasto } from "./tipos";
import { diasEnMes, diferenciaMeses, hoyISO, mesDe, redondear, sumar, sumarMeses } from "./util";

// ---------- Préstamos ----------

export const tasaMensual = (p: Prestamo) => (p.tasaAnual / 12) * (p.ivaSobreInteres ? 1.16 : 1);

export interface EstadoPrestamo {
  saldo: number;
  pagado: number;
  interesEsteMes: number;
  mesesRestantes: number | null; // null = con ese pago nunca se termina
  terminaEn: string | null; // "2028-10"
  interesesPorPagar: number | null;
  esperadoAHoy: number; // lo que ya debías haber pagado según el plan
  atraso: number; // + vas atrasado, − vas adelantado
}

/** Saldo mes a mes: cada mes se suma el interés y se restan los pagos registrados en ese mes. */
/** El cálculo es mes a mes; si el contrato dice cuándo es el último pago, manda esa fecha (salvo que abonando termines antes). */
function terminaEn(p: Prestamo, calculado: string | null): string | null {
  if (!p.ultimoPago || calculado === null) return calculado;
  const contrato = mesDe(p.ultimoPago);
  return calculado < contrato ? calculado : contrato;
}

export function estadoPrestamo(p: Prestamo, hoy = hoyISO()): EstadoPrestamo {
  const r = tasaMensual(p);
  const pagos = [...p.pagos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  let saldo = p.saldoInicial;
  const mesInicio = mesDe(p.fechaSaldoInicial);
  const mesHoy = mesDe(hoy);
  saldo -= sumar(pagos.filter((x) => x.fecha > p.fechaSaldoInicial && mesDe(x.fecha) === mesInicio), (x) => x.monto);
  for (let mes = sumarMeses(mesInicio, 1); mes <= mesHoy; mes = sumarMeses(mes, 1)) {
    saldo += saldo * r;
    saldo -= sumar(pagos.filter((x) => mesDe(x.fecha) === mes), (x) => x.monto);
  }
  saldo = Math.max(0, redondear(saldo));

  // Atraso: solo cuenta los pagos que tocaban DESPUÉS de registrar el préstamo con su saldo
  // (si lo diste de alta a la mitad, los pagos anteriores ya están dentro de ese saldo)
  let esperadoAHoy = 0;
  if (p.primerPago) {
    const dia = p.primerPago.slice(8);
    let primero = p.primerPago;
    if (primero <= p.fechaSaldoInicial) {
      const mismoMes = `${mesInicio}-${dia}`;
      primero = mismoMes > p.fechaSaldoInicial ? mismoMes : `${sumarMeses(mesInicio, 1)}-${dia}`;
    }
    if (primero <= hoy && p.quincenal) {
      // Por quincenas: se cuentan las que de verdad tocaban (el 15 y el último día de cada mes), desde la primera.
      // Por meses enteros se contaban dos en el mes del primer pago aunque empezara en la segunda quincena.
      let n = 0;
      for (let mes = mesDe(primero); mes <= mesHoy; mes = sumarMeses(mes, 1)) {
        for (const f of [`${mes}-15`, `${mes}-${String(diasEnMes(mes)).padStart(2, "0")}`]) if (f >= primero && f <= hoy) n++;
      }
      if (p.plazoMeses) n = Math.min(n, p.plazoMeses * 2);
      esperadoAHoy = redondear(n * (p.pagoMensual / 2));
    } else if (primero <= hoy) {
      let n = diferenciaMeses(mesDe(primero), mesHoy) + 1;
      if (hoy.slice(8) < dia) n--;
      if (p.plazoMeses) n = Math.min(n, p.plazoMeses);
      esperadoAHoy = redondear(Math.max(0, n) * p.pagoMensual);
    }
  }
  const pagadoDesdeAlta = sumar(pagos.filter((x) => x.fecha > p.fechaSaldoInicial), (x) => x.monto);
  const atraso = p.primerPago ? Math.max(0, redondear(esperadoAHoy - pagadoDesdeAlta)) : 0;

  // Meses e intereses que faltan, simulando pago a pago (el último pago es solo lo que reste).
  // Si vas atrasado, se cuenta como si te pusieras al corriente: el atraso no alarga el plazo, se paga aparte.
  const alCorriente = Math.max(0, saldo - atraso);
  let mesesRestantes: number | null = 0;
  let interesesPorPagar: number | null = 0;
  if (alCorriente > 0) {
    if (p.pagoMensual <= alCorriente * r || p.pagoMensual <= 0) { mesesRestantes = null; interesesPorPagar = null; }
    else {
      let s = alCorriente, interes = 0, n = 0;
      while (s > 0.005 && n < 1200) { const i = s * r; interes += i; s = s + i - Math.min(p.pagoMensual, s + i); n++; }
      mesesRestantes = n;
      interesesPorPagar = redondear(interes);
    }
  }
  const pagado = sumar(pagos, (x) => x.monto);
  return {
    saldo,
    pagado,
    interesEsteMes: redondear(saldo * r),
    mesesRestantes,
    terminaEn: terminaEn(p, mesesRestantes === null ? null : sumarMeses(mesHoy, mesesRestantes)),
    interesesPorPagar,
    esperadoAHoy,
    atraso,
  };
}

/** Tabla de amortización desde el saldo actual. */
/**
 * ¿Falta el pago de este mes? Solo se sabe si el préstamo se registró antes de este mes: si se dio de alta
 * este mes, el saldo capturado ya trae (o no) el pago y no se puede adivinar.
 */
function pagoPendienteEsteMes(p: Prestamo, hoy: string): number {
  const mesHoy = mesDe(hoy);
  if (mesDe(p.fechaSaldoInicial) >= mesHoy) return 0;
  if (p.primerPago && mesDe(p.primerPago) > mesHoy) return 0;
  const pagado = sumar(p.pagos.filter((x) => mesDe(x.fecha) === mesHoy), (x) => x.monto);
  return Math.max(0, redondear(p.pagoMensual - pagado));
}

export function tablaPagos(p: Prestamo, hoy = hoyISO(), maxFilas = 120) {
  const r = tasaMensual(p);
  let saldo = estadoPrestamo(p, hoy).saldo;
  const filas: { mes: string; pago: number; interes: number; abono: number; saldo: number }[] = [];
  // El pago de este mes que aún no anotas (el interés del mes ya está en el saldo)
  const pendiente = Math.min(pagoPendienteEsteMes(p, hoy), saldo);
  if (pendiente > 0) {
    saldo = redondear(saldo - pendiente);
    filas.push({ mes: mesDe(hoy), pago: pendiente, interes: 0, abono: pendiente, saldo });
  }
  for (let k = 1; saldo > 0.005 && k <= maxFilas; k++) {
    const interes = redondear(saldo * r);
    const pago = Math.min(p.pagoMensual, redondear(saldo + interes));
    if (pago <= interes) break;
    saldo = redondear(saldo + interes - pago);
    filas.push({ mes: sumarMeses(mesDe(hoy), k), pago, interes, abono: redondear(pago - interes), saldo });
  }
  return filas;
}

// ---------- Compras a meses ----------

export const pagosRestantes = (c: CompraMSI) => Math.max(0, c.totalPagos - c.pagoActual);
export const ultimoCargo = (c: CompraMSI) => sumarMeses(mesDe(c.actualizadoAl), pagosRestantes(c));

/** Plazos que ofrecen las tarjetas para compras a meses. */
export const PLAZOS_MSI = [3, 6, 9, 12, 18, 24];

export interface CapturaMSI {
  cuentaId: string;
  descripcion: string;
  monto: number;
  meses: number;
  fechaCompra: string;
  responsable: string;
}

/**
 * Compra a meses capturada a mano. La primera mensualidad cae en el primer corte de la tarjeta después de la compra
 * (el día de corte sale de su último estado de cuenta; sin estados, se toma el mes de la compra).
 * Queda como si ese corte ya la trajera con el pago 1, igual que las que llegan en un estado de cuenta.
 */
export function compraMSIManual(c: CapturaMSI, estados: EstadoCuenta[], id: string): CompraMSI {
  const ultimo = estados.filter((e) => e.cuentaId === c.cuentaId).reduce<EstadoCuenta | null>((m, e) => (!m || e.fechaCorte > m.fechaCorte ? e : m), null);
  let primerCorte = c.fechaCompra;
  if (ultimo) {
    const dia = Number(ultimo.fechaCorte.slice(8));
    const corteDe = (mes: string) => `${mes}-${String(Math.min(dia, diasEnMes(mes))).padStart(2, "0")}`;
    const mes = mesDe(c.fechaCompra);
    primerCorte = c.fechaCompra <= corteDe(mes) ? corteDe(mes) : corteDe(sumarMeses(mes, 1));
  }
  const pagoMensual = redondear(c.monto / c.meses);
  return {
    id, cuentaId: c.cuentaId, descripcion: c.descripcion.trim(), fechaCompra: c.fechaCompra,
    montoOriginal: redondear(c.monto), pagoMensual, pagoActual: 1, totalPagos: c.meses,
    saldoPendiente: redondear(c.monto - pagoMensual), responsable: c.responsable, actualizadoAl: primerCorte, manual: true,
  };
}

/** ¿Se cobra una mensualidad de esta compra en ese mes? */
export function cobraEnMes(c: CompraMSI, mes: string): boolean {
  const d = diferenciaMeses(mesDe(c.actualizadoAl), mes);
  return d >= 0 && d <= pagosRestantes(c);
}

/** ¿Este movimiento es la mensualidad de esa compra a meses? (misma cuenta, mismo pago, mismo plazo) */
export function esMensualidadDe(m: { cuentaId: string; monto: number; descripcion: string }, c: CompraMSI): boolean {
  const plazo = /^\s*\d{1,3}\s+DE\s+(\d{1,3})\b/i.exec(m.descripcion);
  return m.cuentaId === c.cuentaId && Math.abs(m.monto - c.pagoMensual) < 0.01 && !!plazo && Number(plazo[1]) === c.totalPagos;
}

export interface DetalleMensualidad { pago: number; de: number; total: number; aprox: boolean; falta?: number; compra?: CompraMSI }

/**
 * Si el movimiento es una mensualidad ("03 DE 12 WALMART…"): qué pago es y de cuánto fue la compra completa.
 * Con la compra a meses registrada sale exacto; si no, se estima como mensualidad × plazo.
 */
export function detalleMensualidad(m: Movimiento, msi: CompraMSI[]): DetalleMensualidad | null {
  const plazo = /^\s*(\d{1,3})\s+DE\s+(\d{1,3})\b/i.exec(m.descripcion);
  if (!plazo || m.monto <= 0) return null;
  const pago = Number(plazo[1]), de = Number(plazo[2]);
  const compra = msi.find((c) => esMensualidadDe(m, c));
  if (compra) {
    // Lo que falta después de este pago (el saldo de la compra es al último estado que la trajo)
    const falta = Math.max(0, redondear(compra.pagoMensual * (de - pago)));
    return { pago, de, total: compra.montoOriginal, aprox: false, falta, compra };
  }
  return { pago, de, total: redondear(m.monto * de), aprox: true, falta: redondear(m.monto * (de - pago)) };
}

export function msiDelMes(msi: CompraMSI[], mes: string, responsable?: string): number {
  return sumar(msi.filter((c) => cobraEnMes(c, mes) && (!responsable || c.responsable === responsable)), (c) => c.pagoMensual);
}

// ---------- Mi mes ----------

export const TIPOS_DE_MIS_COSAS: TipoGasto[] = ["Variable", "Hormiga", "Gasto fuerte"];

export const INGRESO_EXTRA = "Ingreso extra";
export const esIngresoExtra = (m: Movimiento) => m.categoria === INGRESO_EXTRA && m.responsable === "Yo" && m.monto < 0;

export const esGastoMio = (m: Movimiento) =>
  m.responsable === "Yo" && TIPOS_DE_MIS_COSAS.includes(m.tipo) && m.monto > 0;

export interface ResumenMes {
  mes: string;
  /** Tus ingresos fijos (Ajustes) más los ingresos extra que anotaste ese mes. */
  ingresos: number;
  ingresosExtra: number;
  prestamos: number;
  msiPropio: number;
  fijos: number;
  totalFijos: number;
  libre: number;
  ahorro: number;
  paraTi: number;
  /** Lo que te pasaste el mes anterior y se descuenta de este (≤ 0). En el mes en curso y los que siguen. */
  arrastre: number;
  gastado: number;
  disponible: number;
  diasRestantes: number;
  porDia: number;
  fuga: number;
  porCategoria: { categoria: string; monto: number; tope?: number }[];
}

/** Día de corte de cada tarjeta (de su último estado de cuenta). */
export function diasDeCorte(estados: EstadoCuenta[] = []): Map<string, number> {
  const ultimo = new Map<string, string>();
  for (const e of estados) if (!ultimo.has(e.cuentaId) || e.fechaCorte > ultimo.get(e.cuentaId)!) ultimo.set(e.cuentaId, e.fechaCorte);
  return new Map([...ultimo].map(([id, corte]) => [id, Number(corte.slice(8))]));
}

/**
 * En qué mes cuenta un movimiento: lo de una tarjeta de crédito, en el mes de su corte (como en tu Excel: en BBVA,
 * con corte el 18, lo del 19 de octubre al 18 de noviembre cuenta en noviembre, que es cuando lo pagas); lo demás
 * (efectivo, débito, dinero de otra persona), en el mes de su fecha. Lo que llegó en un estado de cuenta ya trae su mes.
 * Los pagos y abonos se quedan en su fecha: son dinero que salió o entró ese día, no un gasto del periodo.
 */
export function mesContable(m: Movimiento, cortes: Map<string, number>): string {
  const mes = mesDe(m.fecha);
  if (m.monto < 0) return mes;
  if (m.periodo) return m.periodo;
  const dia = cortes.get(m.cuentaId);
  if (!dia) return mes;
  return Number(m.fecha.slice(8)) <= Math.min(dia, diasEnMes(mes)) ? mes : sumarMeses(mes, 1);
}

export function resumenMes(
  mes: string,
  d: { ajustes: Ajustes; prestamos: Prestamo[]; msi: CompraMSI[]; movimientos: Movimiento[]; estados?: EstadoCuenta[] },
  hoy = hoyISO(),
): ResumenMes {
  // Ingresos extra (una venta, un trabajo aparte…): los anotas como entrada en efectivo o débito y suman a ese mes
  const ingresosExtra = redondear(-sumar(d.movimientos.filter((m) => mesDe(m.fecha) === mes && esIngresoExtra(m)), (m) => m.monto));
  const cortes = diasDeCorte(d.estados);
  const ingresos = redondear(sumar(d.ajustes.ingresos, (i) => i.monto) + ingresosExtra);
  // Un préstamo cuenta en el mes desde su primer pago (p. ej. uno que empieza a pagarse el mes que viene)
  const prestamos = sumar(
    d.prestamos.filter((p) => estadoPrestamo(p, hoy).saldo > 0 && (!p.primerPago || mesDe(p.primerPago) <= mes)),
    (p) => p.pagoMensual,
  );
  const msiPropio = msiDelMes(d.msi, mes, "Yo");
  const fijos = sumar(d.ajustes.fijos, (f) => f.monto);
  const totalFijos = redondear(prestamos + msiPropio + fijos);
  const libre = redondear(ingresos - totalFijos);
  const ahorro = Math.round((ingresos * d.ajustes.ahorroPct) / 10) * 10;
  const paraTi = redondear(libre - ahorro);

  const delMes = d.movimientos.filter((m) => mesContable(m, cortes) === mes);
  const mios = delMes.filter(esGastoMio);
  const gastado = sumar(mios, (m) => m.monto);
  // Lo que te pases en un mes no desaparece: se descuenta del que sigue. El mes en curso descuenta lo del mes que
  // acaba de cerrar (eso lo pagas ahora con tus tarjetas) y los que vienen, en cadena. Los meses ya cerrados no
  // arrastran a su vez lo de antes: así una deuda vieja no se cuenta para siempre.
  const arrastre = mes >= mesDe(hoy) ? Math.min(0, resumenMes(sumarMeses(mes, -1), d, hoy).disponible) : 0;
  const disponible = redondear(paraTi + arrastre - gastado);
  const total = diasEnMes(mes);
  const diasRestantes = mes === mesDe(hoy) ? total - Number(hoy.slice(8)) + 1 : mes > mesDe(hoy) ? total : 0;

  const cats = new Map<string, number>();
  for (const m of mios) cats.set(m.categoria, (cats.get(m.categoria) ?? 0) + m.monto);
  const porCategoria = [...cats.entries()]
    .map(([categoria, monto]) => ({ categoria, monto: redondear(monto), tope: d.ajustes.topes[categoria] }))
    .sort((a, b) => b.monto - a.monto);

  return {
    mes, ingresos, ingresosExtra, prestamos, msiPropio, fijos, totalFijos, libre, ahorro, paraTi, arrastre, gastado, disponible,
    diasRestantes,
    porDia: diasRestantes > 0 ? redondear(Math.max(0, disponible) / diasRestantes) : 0,
    fuga: sumar(delMes.filter((m) => m.tipo === "Fuga financiera" && m.responsable === "Yo"), (m) => m.monto),
    porCategoria,
  };
}

/** Gasto propio por mes y tipo (para la gráfica de barras). */
export function historialPorTipo(movimientos: Movimiento[], meses: string[], estados: EstadoCuenta[] = []) {
  const tipos: TipoGasto[] = ["Fuga financiera", "Recurrente", "A meses (MSI)", "Gasto fuerte", "Variable", "Hormiga"];
  const cortes = diasDeCorte(estados);
  return meses.map((mes) => {
    const fila: Record<string, number | string> = { mes };
    for (const t of tipos) {
      fila[t] = sumar(
        movimientos.filter((m) => mesContable(m, cortes) === mes && m.tipo === t && m.responsable === "Yo" && m.monto > 0),
        (m) => m.monto,
      );
    }
    return fila;
  });
}

// ---------- Estimado del próximo mes ----------

export interface EstimadoMes {
  mes: string;
  resumen: ResumenMes;          // lo fijo del mes que viene (ingresos, préstamos, a meses, fijos, ahorro)
  promedio: number | null;      // gasto en tus cosas, promedio de los últimos meses completos con datos
  mesesPromedio: number;
  ritmo: number | null;         // lo que llevas este mes llevado a mes completo
  gasto: number;                // el estimado: el punto medio entre los dos (o el que haya)
  intereses: number;            // promedio de intereses y comisiones de esos meses, si sigues igual
  quedaria: number;             // para tus cosas − gasto estimado − intereses
  porCategoria: { categoria: string; estimado: number; tope?: number }[];
  excluidas: string[];          // categorías con gasto que no se proyectan (ver SIN_ESTIMAR)
}

/** Gastos de una sola vez: no se proyectan al mes que viene; si vuelve a haber, se anotan como gasto. */
export const SIN_ESTIMAR = new Set(["Mascotas"]);

/** Cuánto vas a gastar el próximo mes si sigues como vas: lo fijo es exacto, lo variable es un estimado. */
export function estimarProximoMes(d: { ajustes: Ajustes; prestamos: Prestamo[]; msi: CompraMSI[]; movimientos: Movimiento[]; estados?: EstadoCuenta[] }, hoy = hoyISO()): EstimadoMes {
  const mesHoy = mesDe(hoy);
  const mes = sumarMeses(mesHoy, 1);
  const resumen = resumenMes(mes, d, hoy);

  // Lo gastado sin las categorías que no se repiten
  const excluidas = new Set<string>();
  const gastadoQueSigue = (r: ResumenMes) => {
    const fuera = r.porCategoria.filter((c) => SIN_ESTIMAR.has(c.categoria) && c.monto > 0);
    for (const c of fuera) excluidas.add(c.categoria);
    return r.gastado - sumar(fuera, (c) => c.monto);
  };

  // Últimos 3 meses completos que tengan gastos tuyos
  const anteriores = [1, 2, 3].map((i) => resumenMes(sumarMeses(mesHoy, -i), d, hoy)).filter((r) => gastadoQueSigue(r) > 0);
  const promedio = anteriores.length ? redondear(sumar(anteriores, gastadoQueSigue) / anteriores.length) : null;
  const intereses = anteriores.length ? redondear(sumar(anteriores, (r) => r.fuga) / anteriores.length) : 0;

  // Ritmo de este mes (a partir del día 5, antes hay muy pocos datos)
  const dia = Number(hoy.slice(8));
  const actual = resumenMes(mesHoy, d, hoy);
  const gastadoHoy = gastadoQueSigue(actual);
  const ritmo = dia >= 5 && gastadoHoy > 0 ? redondear((gastadoHoy / dia) * diasEnMes(mesHoy)) : null;

  const fuentes = [promedio, ritmo].filter((x): x is number => x !== null);
  const gasto = fuentes.length ? redondear(sumar(fuentes, (x) => x) / fuentes.length) : 0;

  // Por categoría, con la misma mezcla
  const cats = new Map<string, number[]>();
  const agregar = (cat: string, i: number, monto: number) => {
    const v = cats.get(cat) ?? [0, 0];
    v[i] += monto;
    cats.set(cat, v);
  };
  for (const r of anteriores) for (const c of r.porCategoria) if (!SIN_ESTIMAR.has(c.categoria)) agregar(c.categoria, 0, c.monto / anteriores.length);
  if (ritmo !== null) for (const c of actual.porCategoria) if (!SIN_ESTIMAR.has(c.categoria)) agregar(c.categoria, 1, (c.monto / dia) * diasEnMes(mesHoy));
  const porCategoria = [...cats.entries()]
    .map(([categoria, [prom, rit]]) => ({
      categoria,
      estimado: redondear(promedio !== null && ritmo !== null ? (prom + rit) / 2 : promedio !== null ? prom : rit),
      tope: d.ajustes.topes[categoria],
    }))
    .filter((c) => c.estimado >= 1)
    .sort((a, b) => b.estimado - a.estimado);

  return {
    mes, resumen, promedio, mesesPromedio: anteriores.length, ritmo, gasto, intereses,
    quedaria: redondear(resumen.paraTi + resumen.arrastre - gasto - intereses), porCategoria, excluidas: [...excluidas],
  };
}

// ---------- Lo que te deben ----------

export interface CuentaDeudor {
  deudor: Deudor;
  cargado: number;
  reembolsado: number;
  debeHoy: number;
  porCargar: number;
  compromiso: number;
  proximoMes: number;
}

export function cuentaDeudor(dd: Deudor, movimientos: Movimiento[], msi: CompraMSI[], hoy = hoyISO()): CuentaDeudor {
  const cargos = sumar(
    movimientos.filter((m) => m.responsable === dd.nombre && m.tipo !== "Informativo" && m.categoria !== "Pago a tarjeta"),
    (m) => m.monto,
  );
  const cargado = redondear(cargos + sumar(dd.adeudos, (a) => a.monto));
  const reembolsado = sumar(dd.reembolsos, (r) => r.monto);
  const suyas = msi.filter((c) => c.responsable === dd.nombre);
  const porCargar = sumar(suyas.filter((c) => pagosRestantes(c) > 0), (c) => c.saldoPendiente);
  const debeHoy = redondear(cargado - reembolsado);
  return {
    deudor: dd, cargado, reembolsado, debeHoy, porCargar,
    compromiso: redondear(debeHoy + porCargar),
    proximoMes: msiDelMes(suyas, sumarMeses(mesDe(hoy), 1)),
  };
}

/** Gente a la que le cargaste algo pero que no está en la lista (o que quitaste): que no se pierda del total. */
export function deudoresSinLista(deudores: Deudor[], movimientos: Movimiento[], msi: CompraMSI[], hoy = hoyISO()): CuentaDeudor[] {
  const registrados = new Set(deudores.map((x) => x.nombre.toLowerCase()));
  const nombres = new Set([...movimientos.filter((m) => m.tipo !== "Informativo").map((m) => m.responsable), ...msi.map((c) => c.responsable)]);
  return [...nombres]
    .filter((n) => n && n !== "Yo" && !registrados.has(n.toLowerCase()))
    .map((nombre) => cuentaDeudor({ id: `sin-lista-${nombre}`, nombre, adeudos: [], reembolsos: [] }, movimientos, msi, hoy))
    .filter((c) => c.debeHoy > 0.5 || c.porCargar > 0.5);
}

/** Todos los que te deben: los de la lista y los que no. */
export function todosLosDeudores(deudores: Deudor[], movimientos: Movimiento[], msi: CompraMSI[], hoy = hoyISO()) {
  const lista = deudores.map((x) => cuentaDeudor(x, movimientos, msi, hoy));
  const sinLista = deudoresSinLista(deudores, movimientos, msi, hoy);
  return { lista, sinLista, total: sumar([...lista, ...sinLista], (c) => Math.max(0, c.debeHoy)) };
}

// ---------- Tarjetas por pagar ----------

/** Lo que llevas pagado a ese estado de cuenta (pagos a la tarjeta después del corte). */
export function pagadoDe(e: EstadoCuenta, movimientos: Movimiento[]): number {
  return -sumar(movimientos.filter((m) => m.cuentaId === e.cuentaId && m.categoria === "Pago a tarjeta" && m.fecha > e.fechaCorte), (m) => m.monto);
}

/** Último estado de cada tarjeta con lo que falta pagarle (solo los que aún no vencen). */
export function tarjetasPorPagar(estados: EstadoCuenta[], movimientos: Movimiento[], hoy = hoyISO()) {
  const ultimo = new Map<string, EstadoCuenta>();
  for (const e of estados) {
    const previo = ultimo.get(e.cuentaId);
    if (!previo || e.fechaCorte > previo.fechaCorte) ultimo.set(e.cuentaId, e);
  }
  // Del último estado de cada tarjeta: lo que falta pagar. Si ya pasó la fecha límite y no se pagó, está vencido.
  return [...ultimo.values()]
    .filter((e) => e.fechaLimite && (e.pagoNoIntereses ?? 0) > 0)
    .map((e) => ({
      e,
      falta: redondear(Math.max(0, (e.pagoNoIntereses ?? 0) - pagadoDe(e, movimientos))),
      vencido: e.fechaLimite! < hoy,
    }))
    .filter((x) => x.falta > 0.5)
    .sort((a, b) => Number(b.vencido) - Number(a.vencido) || a.e.fechaLimite!.localeCompare(b.e.fechaLimite!));
}

/** El mismo día un mes después ("2026-10-31" → "2026-11-30"). */
export function mismoDiaMesSiguiente(fecha: string): string {
  const mes = sumarMeses(mesDe(fecha), 1);
  return `${mes}-${String(Math.min(Number(fecha.slice(8)), diasEnMes(mes))).padStart(2, "0")}`;
}

export interface GrupoEstado {
  /** Último estado de cuenta de la tarjeta. */
  estado: EstadoCuenta;
  /** Primer día del periodo de ese estado. */
  desde: string;
  /** Lo que falta pagar de ese estado para no generar intereses (y del mínimo, si el banco lo da). */
  falta: number;
  minimoFalta?: number;
  vencido: boolean;
  /** Movimientos que entraron en ese estado (lo que ya cortó). */
  cerrado: Movimiento[];
  /** Lo que va del siguiente estado: cargos desde el corte y los pagos que hiciste después del corte. */
  abierto: Movimiento[];
  cargosCerrado: number;
  cargosAbierto: number;
  /** Pagos hechos después del corte: cubren el estado que ya cortó, no lo que va del siguiente. */
  pagadoDespues: number;
  proximoCorte: string;
  proximoLimite?: string;
}

const esPago = (m: Movimiento) => m.categoria === "Pago a tarjeta";
const cuentaParaEstado = (m: Movimiento) => m.tipo !== "Informativo";

/**
 * Movimientos de cada tarjeta agrupados por estado de cuenta: los del último estado (lo que ya cortó y se paga
 * en su fecha límite) y lo que va del siguiente. Ordenado por fecha límite (lo vencido primero).
 */
export function movimientosPorEstado(estados: EstadoCuenta[], movimientos: Movimiento[], hoy = hoyISO()): GrupoEstado[] {
  const porCuenta = new Map<string, EstadoCuenta[]>();
  for (const e of estados) porCuenta.set(e.cuentaId, [...(porCuenta.get(e.cuentaId) ?? []), e]);
  const grupos: GrupoEstado[] = [];
  for (const lista of porCuenta.values()) {
    lista.sort((a, b) => a.fechaCorte.localeCompare(b.fechaCorte));
    const e = lista[lista.length - 1];
    const anterior = lista.length > 1 ? lista[lista.length - 2] : null;
    // El periodo empieza el día después del corte anterior (si no hay, el que diga el estado o un mes antes)
    const desdeExclusivo = anterior?.fechaCorte;
    const desde = desdeExclusivo
      ? new Date(Date.parse(desdeExclusivo) + 86_400_000).toISOString().slice(0, 10)
      : e.periodoDesde ?? `${sumarMeses(mesDe(e.fechaCorte), -1)}-${e.fechaCorte.slice(8)}`;
    const deLaCuenta = movimientos.filter((m) => m.cuentaId === e.cuentaId && cuentaParaEstado(m));
    const porFecha = (a: Movimiento, b: Movimiento) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado;
    const cerrado = deLaCuenta.filter((m) => m.fecha >= desde && m.fecha <= e.fechaCorte).sort(porFecha);
    const abierto = deLaCuenta.filter((m) => m.fecha > e.fechaCorte).sort(porFecha);
    const pagado = pagadoDe(e, movimientos);
    const falta = redondear(Math.max(0, (e.pagoNoIntereses ?? 0) - pagado));
    grupos.push({
      estado: e, desde, falta,
      minimoFalta: e.pagoMinimo !== undefined ? redondear(Math.max(0, e.pagoMinimo - pagado)) : undefined,
      vencido: !!e.fechaLimite && e.fechaLimite < hoy && falta > 0.5,
      cerrado, abierto,
      cargosCerrado: redondear(sumar(cerrado.filter((m) => m.monto > 0), (m) => m.monto)),
      cargosAbierto: redondear(sumar(abierto.filter((m) => m.monto > 0 && !esPago(m)), (m) => m.monto)),
      pagadoDespues: redondear(pagado),
      proximoCorte: mismoDiaMesSiguiente(e.fechaCorte),
      proximoLimite: e.fechaLimite && e.fechaLimite !== e.fechaCorte ? mismoDiaMesSiguiente(e.fechaLimite) : undefined,
    });
  }
  return grupos.sort((a, b) => Number(b.vencido) - Number(a.vencido)
    || (a.estado.fechaLimite ?? a.estado.fechaCorte).localeCompare(b.estado.fechaLimite ?? b.estado.fechaCorte));
}

// ---------- Libre de deudas ----------

export const GASTO_PLANEADO_INICIAL = 3000;

export interface Proyeccion {
  fin: string | null; // mes en que terminas TODO (préstamos y tus compras a meses); null = con este ritmo no terminas
  porPrestamo: { id: string; nombre: string; fin: string | null; saldo: number }[];
  finMSI: string | null;
  deudaTotal: number; // préstamos + lo que falta pagar de las tarjetas
  intereses: number; // intereses que todavía vas a pagar
  extraEsteMes: number; // lo que este mes puede ir a abonos extra
}

/**
 * Simula mes a mes: pagas lo mínimo de cada préstamo, gastas lo planeado (o lo que ya llevas, si es más)
 * y todo lo que sobra se abona al préstamo de tasa más alta. Si un mes no alcanza, el faltante pasa al siguiente.
 */
export function proyectarLibreDeDeudas(
  d: { ajustes: Ajustes; prestamos: Prestamo[]; msi: CompraMSI[]; movimientos: Movimiento[]; estados?: EstadoCuenta[] },
  hoy = hoyISO(),
): Proyeccion {
  const mesHoy = mesDe(hoy);
  const plan = d.ajustes.gastoPlaneado ?? GASTO_PLANEADO_INICIAL;
  const ingresos = sumar(d.ajustes.ingresos, (i) => i.monto);
  const fijos = sumar(d.ajustes.fijos, (f) => f.monto);
  const cortes = diasDeCorte(d.estados);
  const gastadoHoy = sumar(d.movimientos.filter((m) => mesContable(m, cortes) === mesHoy && esGastoMio(m)), (m) => m.monto);

  const vivos = d.prestamos.map((p) => {
    const e = estadoPrestamo(p, hoy);
    return { p, r: tasaMensual(p), saldo: e.saldo, fin: e.saldo <= 0.01 ? mesHoy : (null as string | null) };
  });

  const minimoEn = (v: (typeof vivos)[number], mes: string) =>
    v.saldo > 0.01 && (!v.p.primerPago || mes >= mesDe(v.p.primerPago)) ? v.p.pagoMensual : 0;

  // Lo que debes en tarjetas (estado ya cortado) sale primero, antes de cualquier abono extra
  // Tarjeta vencida con tasa conocida: se trata como un préstamo caro (sigue cobrando intereses y va primero).
  // Lo que aún no vence se paga este mes, antes de cualquier abono extra.
  const porPagar = tarjetasPorPagar(d.estados ?? [], d.movimientos, hoy);
  // (solo tarjetas tuyas: de una ajena, como la de otra persona, solo te toca tu parte y no su tasa)
  const caras = (t: (typeof porPagar)[number]) => t.vencido && !!t.e.tasaAnual && !t.e.soloDe;
  for (const x of porPagar.filter(caras)) {
    vivos.push({
      p: { id: `tarjeta-${x.e.id}`, nombre: `Tarjeta vencida (corte ${x.e.fechaCorte})`, montoOriginal: x.falta, saldoInicial: x.falta,
        fechaSaldoInicial: hoy, tasaAnual: x.e.tasaAnual!, ivaSobreInteres: true, pagoMensual: 0, pagos: [] },
      r: (x.e.tasaAnual! / 12) * 1.16, saldo: x.falta, fin: null,
    });
  }
  const tarjetas = sumar(porPagar.filter((t) => !caras(t)), (x) => x.falta);
  const deudaPrestamos = sumar(vivos, (v) => v.saldo);
  let intereses = 0, arrastre = -tarjetas, extraEsteMes = 0;
  for (let k = 0; k < 360 && vivos.some((v) => v.saldo > 0.01); k++) {
    const mes = sumarMeses(mesHoy, k);
    let minimos = 0;
    for (const v of vivos) {
      const minimo = minimoEn(v, mes);
      minimos += minimo;
      if (k > 0) { const i = v.saldo * v.r; intereses += i; v.saldo += i; }
      const pagar = k === 0 ? Math.min(minimo, pagoPendienteEsteMes(v.p, hoy)) : minimo; // este mes: solo lo que falta
      v.saldo -= Math.min(pagar, v.saldo);
    }
    const gasto = k === 0 ? Math.max(gastadoHoy, plan) : plan;
    let extra = ingresos - fijos - msiDelMes(d.msi, mes, "Yo") - minimos - gasto + arrastre;
    if (k === 0) extraEsteMes = redondear(Math.max(0, extra));
    for (const v of [...vivos].sort((a, b) => b.r - a.r)) {
      if (extra <= 0 || v.saldo <= 0.01) continue;
      const abono = Math.min(extra, v.saldo);
      v.saldo -= abono; extra -= abono;
    }
    arrastre = Math.min(0, extra);
    for (const v of vivos) if (!v.fin && v.saldo <= 0.01) v.fin = mes;
  }

  const propias = d.msi.filter((c) => c.responsable === "Yo" && pagosRestantes(c) > 0);
  const finMSI = propias.length ? propias.map(ultimoCargo).sort().at(-1)! : null;
  const fines = vivos.map((v) => v.fin);
  const fin = fines.some((f) => f === null) ? null : [...fines as string[], finMSI ?? mesHoy].sort().at(-1)!;
  return {
    fin,
    porPrestamo: vivos.map((v) => ({ id: v.p.id, nombre: v.p.nombre, fin: v.fin, saldo: v.p.id.startsWith("tarjeta-") ? v.p.saldoInicial : estadoPrestamo(v.p, hoy).saldo })),
    finMSI, deudaTotal: redondear(deudaPrestamos + tarjetas), intereses: redondear(intereses), extraEsteMes,
  };
}
