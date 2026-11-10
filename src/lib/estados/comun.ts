// Utilidades compartidas por los lectores de estados de cuenta (un archivo por banco).
import type { Banco, EstadoLeido, MovimientoLeido, MSILeida } from "../tipos";

/** Contrato de un lector de estados de cuenta. Para sumar un banco: un archivo que exporte uno de estos. */
export interface ParserEstado {
  banco: Banco;
  /** true si las líneas parecen un estado de cuenta de este banco. */
  detectar(lineas: string[]): boolean;
  leer(lineas: string[]): EstadoLeido;
}

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12",
};

/** Fecha en formato bancario mexicano: "8-jun-2026", "18-MAY-2026". */
export const FECHA = String.raw`\d{1,2}-[A-Za-z]{3}-\d{4}`;
/** Importe con signo de pesos: "$1,234.56", "$ 1,234.56", "$4145.00". */
export const MONTO = String.raw`\$\s?-?[\d,]+\.\d{2}`;

/** "18-may-2026" → "2026-05-18". Devuelve undefined si no se entiende. */
export function fechaISO(texto: string): string | undefined {
  const m = texto.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return undefined;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return undefined;
  return `${m[3]}-${mes}-${m[1].padStart(2, "0")}`;
}

/** "$1,234.56" → 1234.56 (sin signo; el signo lo decide quien llama). */
export function leerMonto(texto: string): number {
  const limpio = texto.replace(/[$\s,]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

export function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quita sufijos de tarjeta digital y espacios repetidos. */
export function limpiarDescripcion(texto: string): string {
  return texto
    .replace(/\s*;\s*Tarjeta Digital\s*\*+\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Primera captura de la primera línea que cumpla la expresión. */
export function buscar(lineas: string[], re: RegExp): RegExpMatchArray | null {
  for (const l of lineas) {
    const m = l.match(re);
    if (m) return m;
  }
  return null;
}

/** Línea que solo trae un importe (con nota al pie, signo o "=" opcionales): "4  $840.00", "+ $102.79". */
const SOLO_MONTO = new RegExp(String.raw`^(?:\d{1,2}\s+)?[=+\-]?\s*(${MONTO})\s*$`);

/**
 * Busca el importe que acompaña a una etiqueta. Primero en la misma línea (después de la etiqueta);
 * si no hay, en la línea siguiente o la anterior cuando esa línea solo trae el importe
 * (pasa cuando la etiqueta y el valor quedan a distinta altura por una nota al pie).
 */
export function montoDeEtiqueta(
  lineas: string[],
  etiqueta: RegExp,
  opciones: { vecinas?: boolean } = {},
): number | undefined {
  const vecinas = opciones.vecinas ?? true;
  const reMonto = new RegExp(MONTO);
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(etiqueta);
    if (!m || m.index === undefined) continue;
    const resto = lineas[i].slice(m.index + m[0].length);
    const enLinea = resto.match(reMonto);
    if (enLinea) return leerMonto(enLinea[0]);
    if (!vecinas) continue;
    for (const j of [i + 1, i - 1]) {
      const v = lineas[j]?.match(SOLO_MONTO);
      if (v) return leerMonto(v[1]);
    }
  }
  return undefined;
}

/** Fecha que acompaña a una etiqueta en la misma línea ("Fecha de corte:  18-may-2026"). */
export function fechaDeEtiqueta(lineas: string[], etiqueta: RegExp): string | undefined {
  const re = new RegExp(etiqueta.source + String.raw`\s*(${FECHA})`, "i");
  const m = buscar(lineas, re);
  return m ? fechaISO(m[m.length - 1]) : undefined;
}

/** Fecha límite: "lunes, 08-jun-2026" (el día de la semana solo aparece ahí en BBVA y Banamex). */
export function fechaLimiteConDia(lineas: string[]): string | undefined {
  const re = new RegExp(
    String.raw`(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s*(${FECHA})`,
    "i",
  );
  const m = buscar(lineas, re);
  return m ? fechaISO(m[1]) : undefined;
}

/** Fila típica de movimiento con dos fechas: operación, cargo, descripción, signo e importe. */
export const RE_FILA_MOVIMIENTO = new RegExp(
  String.raw`^(${FECHA})\s+(${FECHA})\s+(.+?)\s+([+-])\s*(${MONTO})\s*$`,
);

/** Convierte una fila de movimiento en MovimientoLeido (usa la fecha de operación). */
export function filaAMovimiento(linea: string): MovimientoLeido | null {
  const m = linea.trim().match(RE_FILA_MOVIMIENTO);
  if (!m) return null;
  const fecha = fechaISO(m[1]);
  const importe = leerMonto(m[5]);
  if (!fecha || !Number.isFinite(importe)) return null;
  return {
    fecha,
    descripcion: limpiarDescripcion(m[3]),
    monto: m[4] === "-" ? -importe : importe,
  };
}

export function sumar(movs: MovimientoLeido[], signo: 1 | -1): number {
  return redondear(
    movs.filter((m) => (signo > 0 ? m.monto > 0 : m.monto < 0)).reduce((s, m) => s + m.monto, 0),
  );
}

export const TOLERANCIA = 0.05;

export function formatoPesos(n: number): string {
  const signo = n < 0 ? "-" : "";
  return `${signo}$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Compara las sumas leídas con los totales del banco y agrega avisos cuando no cuadran.
 * `cargosLeidos` permite excluir filas sintéticas que el total del banco no incluye.
 */
export function revisarCuadre(
  estado: EstadoLeido,
  cargosLeidos: number,
  abonosLeidos: number,
): boolean {
  let cuadra = true;
  if (estado.totalCargos === undefined) {
    cuadra = false;
    estado.avisos.push("No se pudo leer el total de cargos del banco; no se puede comprobar la suma.");
  } else {
    const dif = redondear(cargosLeidos - estado.totalCargos);
    if (Math.abs(dif) > TOLERANCIA) {
      cuadra = false;
      estado.avisos.push(
        `Los cargos leídos suman ${formatoPesos(cargosLeidos)} y el banco reporta ${formatoPesos(estado.totalCargos)} (diferencia ${formatoPesos(dif)}). Revisa si falta algún movimiento.`,
      );
    }
  }
  if (estado.totalAbonos === undefined) {
    cuadra = false;
    estado.avisos.push("No se pudo leer el total de abonos del banco; no se puede comprobar la suma.");
  } else {
    const dif = redondear(abonosLeidos - estado.totalAbonos);
    if (Math.abs(dif) > TOLERANCIA) {
      cuadra = false;
      estado.avisos.push(
        `Los abonos leídos suman ${formatoPesos(abonosLeidos)} y el banco reporta ${formatoPesos(estado.totalAbonos)} (diferencia ${formatoPesos(dif)}). Revisa si falta algún pago.`,
      );
    }
  }
  return cuadra;
}

/** Agrega un aviso por cada dato del encabezado que no se pudo leer. */
export function avisarFaltantes(estado: EstadoLeido, campos: [keyof EstadoLeido, string][]): void {
  for (const [campo, nombre] of campos) {
    if (estado[campo] === undefined) estado.avisos.push(`No se pudo leer: ${nombre}.`);
  }
}

/** Últimos 4 dígitos de un número de tarjeta/cuenta (admite espacios o X de enmascarado). */
export function ultimos4(texto: string): string | undefined {
  const digitos = texto.replace(/[^\d]/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : undefined;
}

// ---------- Recorrido de las secciones de movimientos y meses sin intereses ----------

export interface ConfigSecciones {
  /** Encabezado de la sección de cargos y abonos regulares (se repite tras cada salto de página). */
  inicioMovimientos: RegExp;
  /** Encabezado de la tabla de compras a meses sin intereses. */
  inicioMSI: RegExp;
  /** Líneas que cierran cualquier sección (totales, otras tablas, avisos legales). */
  finSeccion: RegExp[];
}

/** Marcas de fin de sección comunes a los estados de cuenta de tarjeta en México (formato CONDUSEF). */
export const FIN_SECCION_COMUN: RegExp[] = [
  /^TOTAL CARGOS\b/i,
  /^TOTAL ABONOS\b/i,
  /^CARGOS NO RECONOCIDOS/i,
  /^COMPRAS Y CARGOS DIFERIDOS A MESES CON INTERESES/i,
  /^ATENCI[ÓO]N DE QUEJAS/i,
  /^NOTAS ACLARATORIAS/i,
  /^GLOSARIO DE T[ÉE]RMINOS/i,
];

/** Fila de MSI: fecha, descripción, monto original, saldo pendiente, pago requerido, "N de M", tasa. */
const RE_FILA_MSI = new RegExp(
  String.raw`^(${FECHA})\s+(.+?)\s+(${MONTO})\s+(${MONTO})\s+(${MONTO})\s+(\d+)\s+de\s+(\d+)(?:\s+\S+)?\s*$`,
  "i",
);

export function filaAMSI(linea: string): MSILeida | null {
  const m = linea.trim().match(RE_FILA_MSI);
  if (!m) return null;
  return {
    fechaCompra: fechaISO(m[1]),
    descripcion: limpiarDescripcion(m[2]),
    montoOriginal: leerMonto(m[3]),
    saldoPendiente: leerMonto(m[4]),
    pagoMensual: leerMonto(m[5]),
    pagoActual: Number(m[6]),
    totalPagos: Number(m[7]),
  };
}

export interface Secciones {
  movimientos: MovimientoLeido[];
  msi: MSILeida[];
  /** Líneas dentro de una sección que empiezan con fecha pero no se pudieron interpretar. */
  sinLeer: string[];
}

export function leerSecciones(lineas: string[], cfg: ConfigSecciones): Secciones {
  const res: Secciones = { movimientos: [], msi: [], sinLeer: [] };
  const empiezaConFecha = new RegExp(`^${FECHA}\\s`);
  let seccion: "ninguna" | "movimientos" | "msi" = "ninguna";
  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (cfg.inicioMovimientos.test(linea)) {
      seccion = "movimientos";
      continue;
    }
    if (cfg.inicioMSI.test(linea)) {
      seccion = "msi";
      continue;
    }
    if (cfg.finSeccion.some((re) => re.test(linea))) {
      seccion = "ninguna";
      continue;
    }
    if (seccion === "movimientos") {
      const mov = filaAMovimiento(linea);
      if (mov) res.movimientos.push(mov);
      else if (empiezaConFecha.test(linea)) res.sinLeer.push(linea);
      // Lo demás son renglones de continuación (tipo de cambio, desglose del pago) o encabezados de página.
    } else if (seccion === "msi") {
      const compra = filaAMSI(linea);
      if (compra) res.msi.push(compra);
      else if (empiezaConFecha.test(linea)) res.sinLeer.push(linea);
    }
  }
  return res;
}

// ---------- Encabezado / resumen con el formato CONDUSEF ----------

/** Primer valor definido de una lista de intentos. */
export function primero<T>(...intentos: (() => T | undefined)[]): T | undefined {
  for (const f of intentos) {
    const v = f();
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Tasa anual ordinaria (0.709 = 70.90%). Va en el recuadro del CAT, bajo "TASA DE INTERES ANUAL (ORDINARIA)
 * VARIABLE", en un renglón cercano ("103.1% Sin IVA   70.90%"); si no, sale de la fila "Ordinarios … 70.90% …"
 * de la tabla de intereses. BBVA, Banamex y HSBC lo traen igual.
 */
export function tasaOrdinaria(lineas: string[]): number | undefined {
  const porcentajes = (l: string) => [...l.matchAll(/(\d{1,3}[.,]\d{1,2})\s?%/g)].map((m) => Number(m[1].replace(",", ".")) / 100);
  const ordinaria = lineas.findIndex((l) => /ORDINARIA VARIABLE/.test(l));
  const i = ordinaria >= 0 ? ordinaria : lineas.findIndex((l) => /TASA DE INTER[EÉ]S ANUAL/.test(l)); // BBVA: sin "ORDINARIA"
  for (const l of i >= 0 ? lineas.slice(i, i + 5) : []) {
    const despuesCAT = l.includes("Sin IVA") ? l.slice(l.indexOf("Sin IVA")) : l;
    const tasas = porcentajes(despuesCAT);
    if (tasas.length) return tasas.at(-1);
  }
  const ordinarios = lineas.find((l) => /\bOrdinarios?\b/i.test(l) && /%/.test(l));
  return ordinarios ? porcentajes(ordinarios)[0] : undefined;
}

/**
 * Lee el resumen que la CONDUSEF exige en todas las tarjetas de crédito (BBVA y Banamex lo comparten
 * casi palabra por palabra; es probable que HSBC y Amex México también). Cada banco puede corregir
 * después lo que necesite.
 */
export function leerEncabezadoCondusef(lineas: string[], banco: Banco): EstadoLeido {
  const fechaCorte = fechaDeEtiqueta(lineas, /Fecha de corte:?/i)
    ?? (() => { const p = buscar(lineas, new RegExp(String.raw`Periodo:?\s*(${FECHA})\s+al\s+(${FECHA})`, "i")); return p ? fechaISO(p[2]) : undefined; })();
  // Sin fecha de corte no se puede ubicar el estado en el tiempo (ni saber si ya se subió): mejor no importarlo
  if (!fechaCorte) throw new Error(`No encontré la fecha de corte de este estado de ${banco}.`);
  // Saldo a favor: el banco lo muestra con signo menos; no es algo que pagar
  const aFavor = lineas.some((l) => /Pago para no generar intereses/i.test(l) && /-\s*\$|\$\s*-/.test(l));
  const periodo = buscar(lineas, new RegExp(String.raw`Periodo:?\s*(${FECHA})\s+al\s+(${FECHA})`, "i"));
  const totalAbonos = montoDeEtiqueta(lineas, /^TOTAL ABONOS\b/i, { vecinas: false });
  const numTarjeta = buscar(lineas, /N[úu]mero de tarjeta:?\s*(\d[\d ]{7,}\d)/i);
  const numCuenta = buscar(lineas, /N[úu]mero de cuenta:?\s*([X*\d]{4,})/i);
  return {
    banco,
    terminacion: ultimos4(numTarjeta?.[1] ?? numCuenta?.[1] ?? ""),
    fechaCorte,
    fechaLimite: fechaLimiteConDia(lineas) ?? fechaDeEtiqueta(lineas, /Fecha l[íi]mite de pago:?\s*\d*/i),
    periodoDesde: periodo ? fechaISO(periodo[1]) : undefined,
    pagoNoIntereses: aFavor ? 0 : primero(
      () => montoDeEtiqueta(lineas, /Pago para no generar intereses:?\s*\d*/i),
      () => montoDeEtiqueta(lineas, /^El pago para no generar intereses/i, { vecinas: false }),
    ),
    pagoMinimo: primero(
      () => montoDeEtiqueta(lineas, /Pago m[íi]nimo:/i),
      () => montoDeEtiqueta(lineas, /^El pago m[íi]nimo\b/i, { vecinas: false }),
    ),
    intereses: montoDeEtiqueta(lineas, /Monto de intereses\s*\d*\s*\+/i),
    comisiones: montoDeEtiqueta(lineas, /Monto de comisiones\s*\d*\s*\+/i),
    iva: montoDeEtiqueta(lineas, /IVA de intereses y comisiones\s*\d*\s*\+/i),
    totalCargos: montoDeEtiqueta(lineas, /^TOTAL CARGOS\b/i, { vecinas: false }),
    totalAbonos: totalAbonos === undefined ? undefined : -totalAbonos,
    saldoTotal: montoDeEtiqueta(lineas, /Saldo deudor total:?/i),
    tasaAnual: tasaOrdinaria(lineas),
    movimientos: [],
    msi: [],
    avisos: aFavor ? ["Tienes saldo a favor en esta tarjeta: no hay nada que pagar."] : [],
  };
}

export const CAMPOS_RESUMEN: [keyof EstadoLeido, string][] = [
  ["fechaLimite", "fecha límite de pago"],
  ["periodoDesde", "inicio del periodo"],
  ["pagoNoIntereses", "pago para no generar intereses"],
  ["pagoMinimo", "pago mínimo"],
  ["intereses", "monto de intereses"],
  ["comisiones", "monto de comisiones"],
  ["iva", "IVA de intereses y comisiones"],
  ["totalCargos", "total de cargos"],
  ["totalAbonos", "total de abonos"],
  ["terminacion", "terminación de la tarjeta"],
];
