// Lector de estados de cuenta de tarjetas de crédito HSBC (VIVA y demás con formato CONDUSEF).
// Los PDF de HSBC llegan escaneados: las líneas vienen del OCR (ver ocrNavegador.ts) y traen ruido.
import type { EstadoLeido, MovimientoLeido } from "../tipos";
import { fechaISO, limpiarDescripcion, redondear, tasaOrdinaria, type ParserEstado } from "./comun";

/*
 * Notas de formato HSBC (sobre texto de OCR):
 * - Mismo formato CONDUSEF que Banamex: intereses, IVA y comisiones vienen como movimientos y el
 *   resumen trae b) cargos regulares, d) intereses, e) comisiones, f) IVA y g) pagos y abonos.
 *   La suma de los movimientos debe dar b + d + e + f − g: con eso se valida (y se corrige) el OCR.
 * - El OCR confunde el "$" de la columna de importes con un dígito: "$613.26" → "8613.26".
 *   Todos los importes de esa columna llevan "$"; si no aparece, el primer dígito era el "$".
 *   Cuando no cuadra, se prueban las dos lecturas de los importes dudosos hasta que cuadre.
 * - El OCR puede leer la coma de miles como punto ("13.830.26"): el último separador es el decimal.
 * - "Fecha límite de pago: INMEDIATO" = el pago ya está vencido.
 */

const FECHA_OCR = String.raw`(\d{1,2})\s?-\s?([A-Za-z]{3})\s?-\s?(\d{4})`;
/** Igual, pero acepta que el OCR se coma el primer guion ("27 Jul-2026"). */
const FECHA_OCR_FLEX = String.raw`(\d{1,2})\s?[-\s]\s?([A-Za-z]{3})\s?-\s?(\d{4})`;

/** Importe leído por OCR: "13.830.26", "1,000.00", "$ 2,638.33" → número. */
export function montoOCR(texto: string): number {
  const t = texto.replace(/[^\d.,]/g, "");
  const m = /^(.*?)[.,](\d{2})$/.exec(t);
  if (!m) return NaN;
  return Number(`${m[1].replace(/[.,]/g, "")}.${m[2]}`);
}

function fechaOCR(texto: string): string | undefined {
  const m = new RegExp(FECHA_OCR).exec(texto);
  return m ? fechaISO(`${m[1]}-${m[2]}-${m[3]}`) : undefined;
}

/** Primer importe con "$" en la línea (o en la siguiente) que contiene la etiqueta. */
function importeTras(lineas: string[], etiqueta: RegExp, desde = 0): number | undefined {
  for (let i = desde; i < lineas.length; i++) {
    const k = lineas[i].search(etiqueta);
    if (k < 0) continue;
    for (const texto of [lineas[i].slice(k), lineas[i + 1] ?? ""]) {
      const m = /\$\s?([\d][\d.,]*[.,]\d{2})/.exec(texto);
      if (m) return montoOCR(m[1]);
    }
  }
  return undefined;
}

/** Todos los importes que siguen a una etiqueta (en su renglón o el de abajo). */
function importesTras(lineas: string[], etiqueta: RegExp, excluir?: RegExp): number[] {
  const encontrados: number[] = [];
  lineas.forEach((l, i) => {
    const k = l.search(etiqueta);
    if (k < 0 || (excluir && excluir.test(l))) return;
    for (const texto of [l.slice(k), lineas[i + 1] ?? ""]) {
      const m = /\$\s?([\d][\d.,]*[.,]\d{2})/.exec(texto);
      if (m) { encontrados.push(montoOCR(m[1])); break; }
    }
  });
  return encontrados.filter(Number.isFinite);
}

/** El estado repite varios importes (el mínimo sale 3 veces): gana el que más se repite; si empatan, el primero. */
function votar(valores: number[]): number | undefined {
  const cuenta = new Map<number, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor: number | undefined, veces = 0;
  for (const v of valores) if ((cuenta.get(v) ?? 0) > veces) { mejor = v; veces = cuenta.get(v)!; }
  return mejor;
}

interface Fila {
  fecha: string;
  descripcion: string;
  /** Lecturas posibles del importe (la primera es la más probable); vacío = ilegible. */
  opciones: number[];
  signo: 1 | -1;
  tarjeta?: string;
}

const ES_ABONO = /^(PAGOS? (INTERBANCARIOS?|RECIBIDO)|SU PAGO|ABONO|BONIFICACI|DEVOLUCI|REEMBOLSO)/i;

// La fecha de operación se lee bien casi siempre; la de cargo puede venir mutilada ("28-Ju-2026")
const FECHA_SUELTA = String.raw`\d{1,2}\s?-?\s?[A-Za-z]{2,4}\s?-?\s?\d{4}`;
const RE_FILA = new RegExp(String.raw`^\W*${FECHA_OCR_FLEX}(?:\W+${FECHA_SUELTA})?\W*(.+?)\s*[[|(]?\s*([+\-])?\s*[\]|)]?\s*(\$)?\s?(\d[\d.,]*)\W*$`);

// El borde izquierdo de la tabla ("|") a veces se lee como I, J o l pegada a la palabra
const INICIOS = /^(INTERESES|PENALIZACI|ADMINISTRACI|IVA |PAGOS|APPLE|QCS|CSS|TCI|JMA|TME|RES|MUEVE|AMAZON|MERCADO|OXXO|UBER)/;
function quitarBorde(descripcion: string): string {
  return /^[IJl]/.test(descripcion) && !INICIOS.test(descripcion) && INICIOS.test(descripcion.slice(1)) ? descripcion.slice(1) : descripcion;
}

function leerFila(linea: string): Fila | null {
  const m = RE_FILA.exec(linea.trim());
  if (!m) return null;
  // Si el mes de la fecha de operación salió ilegible ("27-Jub-2026"), sirve la fecha de cargo del renglón
  const fecha = fechaISO(`${m[1]}-${m[2]}-${m[3]}`)
    ?? [...linea.matchAll(new RegExp(FECHA_OCR, "g"))].map((x) => fechaISO(`${x[1]}-${x[2]}-${x[3]}`)).find(Boolean);
  if (!fecha) return null;
  const descripcion = quitarBorde(limpiarDescripcion(m[4].replace(/^[|_[\]—–\s-]+|[|_[\]—–\s]+$/g, "")));
  const conPeso = Boolean(m[6]);
  const crudo = m[7];
  const entero = montoOCR(crudo);
  const esAbono = m[5] === "-" || ES_ABONO.test(descripcion);
  // Cargo en moneda extranjera: el importe exacto es dólares × tipo de cambio (vienen en la misma fila)
  const extranjera = /([\d,]+\.\d{2})\s*(USD|EUR|CAD)\s*TC:?\s*([\d.]+)/i.exec(m[4]);
  if (extranjera) {
    const pesos = redondear(Number(extranjera[1].replace(/,/g, "")) * Number(extranjera[3]));
    return { fecha, descripcion: `MONEDA EXTRANJERA ${extranjera[1]} ${extranjera[2].toUpperCase()}`, opciones: [pesos], signo: esAbono ? -1 : 1 };
  }
  // El OCR lee el "$" como 9/8/6/5 y el borde "|" como 1: "$6.42" → "196.42". Sin "$" visible se prueban
  // las lecturas quitando 0, 1 o 2 caracteres del inicio (la más probable primero) y luego se cuadra con el resumen.
  const lecturas = (orden: number[]) => [...new Set(orden.map((n) => montoOCR(crudo.slice(n))).filter((x) => Number.isFinite(x) && x > 0))];
  const opciones = !Number.isFinite(entero) ? []
    : conPeso ? (/^[19]\d/.test(crudo) ? lecturas([0, 1]) : [entero]) // con "$" visible, aún puede colarse el borde como 9 o 1
    : /^1[98653]/.test(crudo) ? lecturas([2, 1, 0])
    : /^[98653]/.test(crudo) ? lecturas([1, 0])
    : lecturas([0, 1]);
  return { fecha, descripcion, opciones, signo: esAbono ? -1 : 1 };
}

/** Elige una lectura por fila para que la suma dé el total esperado (si se puede). */
function cuadrarFilas(filas: Fila[], esperado: number | undefined): { montos: number[]; cuadra: boolean; deducido: boolean } {
  const primeras = filas.map((f) => (f.opciones[0] ?? 0) * f.signo);
  const ilegibles = filas.map((f, i) => (f.opciones.length === 0 ? i : -1)).filter((i) => i >= 0);
  const noCuadra = { montos: primeras, cuadra: false, deducido: false };
  if (esperado === undefined || ilegibles.length > 1) return noCuadra;
  const combinaciones = filas.reduce((n, f) => n * Math.max(1, f.opciones.length), 1);
  if (combinaciones > 2_000_000) return noCuadra;

  // Búsqueda en centavos; el orden de las opciones hace que gane la lectura más probable
  const centavos = (x: number) => Math.round(x * 100);
  const meta = centavos(esperado);
  const elegidos = new Array<number>(filas.length).fill(0);
  const buscar = (i: number, acumulado: number): boolean => {
    if (i === filas.length) {
      if (ilegibles.length === 0) return Math.abs(acumulado - meta) <= 5;
      const falta = (meta - acumulado) * filas[ilegibles[0]].signo; // lo que le toca al importe ilegible
      if (falta <= 0) return false;
      elegidos[ilegibles[0]] = falta / 100 * filas[ilegibles[0]].signo;
      return true;
    }
    if (filas[i].opciones.length === 0) return buscar(i + 1, acumulado);
    for (const x of filas[i].opciones) {
      elegidos[i] = x * filas[i].signo;
      if (buscar(i + 1, acumulado + centavos(x) * filas[i].signo)) return true;
    }
    return false;
  };
  return buscar(0, 0)
    ? { montos: elegidos.map(redondear), cuadra: true, deducido: ilegibles.length === 1 }
    : noCuadra;
}

export const parserHSBC: ParserEstado = {
  banco: "HSBC",

  detectar(lineas) {
    const texto = lineas.join("\n");
    return /HSBC/.test(texto) && /(PAGO PARA NO GENERAR|CARGOS, ABONOS Y COMPRAS REGULARES)/i.test(texto);
  },

  leer(lineasOCR) {
    const avisos: string[] = [];
    // Confusiones típicas del OCR en las fechas: "0ct" con cero
    // y miles separados por espacio ("$2 963.00")
    const lineas = lineasOCR.map((l) => l.replace(/(\d-)0ct(-)/g, "$1Oct$2").replace(/(\$\s?\d{1,3})\s(\d{3}[.,]\d{2})\b/g, "$1,$2"));
    // La fecha de corte puede quedar en otro renglón; el periodo ("14-May-2026 al 13-Jun-2026") termina en el corte
    const corte = lineas.map((l) => /Fecha de corte:?\s*(.*)$/i.exec(l)).find(Boolean);
    const rePeriodo = new RegExp(String.raw`${FECHA_OCR}\s+al\s+${FECHA_OCR}`, "i");
    const periodoMatch = lineas.map((l) => rePeriodo.exec(l)).find(Boolean);
    const finPeriodo = periodoMatch ? periodoMatch.slice(3) : null;
    const fechaCorte = (corte ? fechaOCR(corte[1]) : undefined) ?? (finPeriodo ? fechaISO(`${finPeriodo[1]}-${finPeriodo[2]}-${finPeriodo[3]}`) : undefined);
    if (!fechaCorte) throw new Error("No encontré la fecha de corte de este estado de HSBC.");
    const periodo = periodoMatch;
    // La fecha límite viene como "sábado, 04-Jul-2026", a veces en otro renglón que su etiqueta
    const limiteLinea = lineas.find((l) => /Fecha l[ií]mite de pago/i.test(l) && (/INMEDIATO/i.test(l) || new RegExp(FECHA_OCR).test(l)))
      ?? lineas.find((l) => new RegExp(String.raw`(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo),?\s*${FECHA_OCR}`, "i").test(l))
      ?? lineas.find((l) => /INMEDIATO/.test(l)) ?? "";
    const inmediato = /INMEDIATO/i.test(limiteLinea);
    const cuenta = lineas.map((l) => /N[UÚ]MERO DE CUENTA:?\s*([\d ]{12,})/i.exec(l)).find(Boolean);
    if (inmediato) avisos.push("El banco pide el pago de inmediato: la tarjeta tiene un pago vencido.");

    const resumen = {
      cargos: importeTras(lineas, /Cargos regulares \(no a meses\)/i),
      // "d) Monto de intereses * + $…"; en la misma altura, a la derecha, viene "Monto de intereses pagados en los últimos 12 meses"
      intereses: importeTras(lineas, /Monto de intereses\s*[*?]?\s*[+$]/i),
      comisiones: importeTras(lineas, /Monto de comisiones\s*[+$]/i),
      iva: importeTras(lineas, /IVA de intereses y comisiones/i),
      pagos: importeTras(lineas, /Pagos y abonos/i),
    };

    const inicio = lineas.findIndex((l) => /DESGLOSE DE MOVIMIENTOS/i.test(l));
    const filas: Fila[] = [];
    let tarjeta: string | undefined;
    let previa: string | undefined;
    const inicioMovs = Math.max(0, inicio);
    for (const [k, l] of lineas.slice(inicioMovs).entries()) {
      // Encabezado de tabla ("Tarjeta titular 5412…"), no la fila "ADMINISTRACION TARJETA TITULAR"
      const encabezado = /^\W*Tarjeta (titular|adicional)\s*(\d[\d ]{11,}\d)/i.exec(l);
      if (encabezado) { tarjeta = `${encabezado[1].toLowerCase() === "titular" ? "Titular" : "Adicional"} ••${encabezado[2].replace(/\D/g, "").slice(-4)}`; continue; }
      const f = leerFila(l);
      // A veces "MONEDA EXTRANJERA: 180.00 USD TC: 17.53122" queda en el renglón de abajo
      const siguiente = lineas[inicioMovs + k + 1] ?? "";
      const fx = f && !f.descripcion.includes("USD") ? /([\d,]+\.\d{2})\s*(USD|EUR|CAD)\s*TC:?\s*([\d.]+)/i.exec(siguiente) : null;
      if (f && fx && !leerFila(siguiente)) {
        f.opciones = [redondear(Number(fx[1].replace(/,/g, "")) * Number(fx[3]))];
        f.descripcion = `${f.descripcion} (${fx[1]} ${fx[2].toUpperCase()})`;
      }
      if (!f && new RegExp(String.raw`^\W*${FECHA_OCR_FLEX}`).test(l)) avisos.push(`No entendí este renglón del estado: «${l.replace(/\s+/g, " ").slice(0, 90)}»`);
      if (f && f.descripcion.startsWith("MONEDA EXTRANJERA") && previa && !leerFila(previa)) {
        f.descripcion = `${limpiarDescripcion(previa)} (${f.descripcion.replace("MONEDA EXTRANJERA ", "")})`;
      }
      if (f) filas.push({ ...f, tarjeta });
      previa = l;
    }
    // Dos formas de saber cuánto deben sumar los movimientos; se usa la primera con la que cuadren:
    // 1) pago para no generar intereses − adeudo anterior (los dos importes que el OCR lee mejor)
    // 2) b + d + e + f − g del resumen
    const pagoNoIntereses = votar([
      ...importesTras(lineas, /PAGO PARA NO GENERAR|pago para no generar intereses/i),
      ...importesTras(lineas, /Saldo cargos regulares/i),
    ]);
    const adeudoAnterior = importeTras(lineas, /Adeudo del periodo anterior/i);
    const metas = [
      pagoNoIntereses !== undefined && adeudoAnterior !== undefined ? redondear(pagoNoIntereses - adeudoAnterior) : undefined,
      [resumen.cargos, resumen.intereses, resumen.comisiones, resumen.iva, resumen.pagos].every((x) => x !== undefined)
        ? redondear(resumen.cargos! + resumen.intereses! + resumen.comisiones! + resumen.iva! - resumen.pagos!)
        : undefined,
    ].filter((x): x is number => x !== undefined);
    const intentos = metas.map((meta) => cuadrarFilas(filas, meta));
    const elegido = intentos.find((x) => x.cuadra) ?? intentos[0] ?? cuadrarFilas(filas, undefined);
    const esperado = metas[intentos.indexOf(elegido)];
    const { montos, cuadra, deducido } = elegido;
    if (deducido) avisos.push("Un importe no se leyó bien y se calculó con el resumen del banco.");
    if (!cuadra) {
      avisos.push(esperado === undefined
        ? "No pude leer el resumen del estado para comprobar los importes: revisa los movimientos."
        : `Los movimientos leídos suman ${redondear(montos.reduce((s, x) => s + x, 0))}; el resumen del banco da ${esperado}. Revisa los importes (el PDF es una imagen).`);
    }
    const movimientos: MovimientoLeido[] = filas.map((f, i) => ({
      fecha: f.fecha, descripcion: f.descripcion, monto: montos[i],
      ...(f.tarjeta?.startsWith("Adicional") ? { tarjetahabiente: f.tarjeta } : {}),
    }));

    return {
      banco: "HSBC",
      terminacion: cuenta ? cuenta[1].replace(/\D/g, "").slice(-4) : undefined,
      fechaCorte,
      fechaLimite: inmediato ? fechaCorte : fechaOCR(limiteLinea),
      periodoDesde: periodo ? fechaISO(`${periodo[1]}-${periodo[2]}-${periodo[3]}`) : undefined,
      pagoNoIntereses,
      // "i. El pago mínimo  $2,638.33" (tabla de cuánto pagarías) trae el importe en el mismo renglón
      pagoMinimo: votar(importesTras(lineas, /pago m[ií]nimo/i, /veces/i)),
      intereses: resumen.intereses,
      comisiones: resumen.comisiones,
      iva: resumen.iva,
      totalCargos: resumen.cargos !== undefined ? redondear(resumen.cargos + (resumen.intereses ?? 0) + (resumen.comisiones ?? 0) + (resumen.iva ?? 0)) : undefined,
      totalAbonos: resumen.pagos,
      saldoTotal: importeTras(lineas, /Saldo deudor total/i),
      tasaAnual: tasaOrdinaria(lineas),
      movimientos,
      msi: [],
      cuadra,
      avisos,
    } satisfies EstadoLeido;
  },
};
