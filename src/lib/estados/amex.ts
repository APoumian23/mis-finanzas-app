// Lector de estados de cuenta de American Express México (Platinum Credit Card y similares).
import type { EstadoLeido, MovimientoLeido, MSILeida } from "../tipos";
import { leerMonto, limpiarDescripcion, redondear, type ParserEstado } from "./comun";

/*
 * Notas de formato Amex:
 * - No es el formato CONDUSEF de BBVA/Banamex. El resumen va en una sola fila:
 *   "Saldo anterior − Pagos + Nuevos cargos = Saldo actual (pago para no generar intereses)  Pago mínimo".
 * - Los movimientos van agrupados por tarjetahabiente (titular y adicionales). Cada grupo TERMINA con
 *   "Total de las transacciones en $ de NOMBRE  1,234.56" (o "…en Moneda Extranjera de NOMBRE"): las
 *   filas anteriores son de esa persona. Ese total no incluye los "PAGO RECIBIDO" (son de la cuenta).
 * - Fecha en dos renglones ("17 de" / "Septiembre  …") o en uno ("4 de Octubre  …"); el año sale del
 *   periodo de facturación. "CR" (en el renglón siguiente) marca un abono.
 * - "CARGO 04 DE 06" en el renglón siguiente = mensualidad de una compra a meses.
 * - "Nuevas transacciones" = cargos positivos (sin pagos ni el "MONTO A DIFERIR" que pasa a meses);
 *   "Total Nuevos Cargos" = eso + "Total de Meses sin Intereses" (meses en automático, sin dueño).
 */

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MES_ABREV: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8,
  sep: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};
const RE_MES = "(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Setiembre|Octubre|Noviembre|Diciembre)";
const IMPORTE = String.raw`([\d,]+\.\d{2})`;
const RE_FILA = new RegExp(String.raw`^(\d{1,2}) de(?: ${RE_MES})?\s+(.*?\S)\s+${IMPORTE}$`, "i");
const RE_SOLO_MES = new RegExp(String.raw`^${RE_MES}\b(.*)$`, "i");
const RE_TOTAL_GRUPO = new RegExp(String.raw`^Total de (?:las )?Transacciones en (?:\$|Moneda Extranjera) de (.+?)\s+${IMPORTE}$`, "i");
const RE_TOTAL_MSI = new RegExp(String.raw`^Total de Meses sin Intereses\s+${IMPORTE}$`, "i");
const RE_CUOTA = /\bCARGO (\d{1,3}) DE (\d{1,3})\b/i;

const dosDigitos = (n: number) => String(n).padStart(2, "0");

function fechaDdMmmAaaa(texto: string): string | undefined {
  const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(texto);
  const mes = m && MES_ABREV[m[2].toLowerCase()];
  return m && mes ? `${m[3]}-${dosDigitos(mes)}-${dosDigitos(Number(m[1]))}` : undefined;
}

/** Día y mes sin año → fecha, usando el año del corte (o el anterior si el mes es posterior al corte). */
function conAnio(dia: number, mes: number, corte: string): string {
  const [a, m] = corte.split("-").map(Number);
  return `${mes > m ? a - 1 : a}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

/** La fecha límite es posterior al corte: si su mes es menor, ya es el año siguiente. */
function fechaLimiteDe(dia: number, mes: number, corte: string): string {
  const [a, m] = corte.split("-").map(Number);
  return `${mes < m ? a + 1 : a}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

interface Fila extends MovimientoLeido {
  esPago: boolean;
  cuota?: [number, number];
}

/** "Tasa de Interés Anual Por Crédito   63.90%   44,359.65 MN" → 0.639. (La "Tasa Personal Anualizada" de arriba viene en 0%.) */
function tasaAmex(lineas: string[]): number | undefined {
  const l = lineas.find((x) => /Tasa de Inter[eé]s Anual Por Cr[eé]dito/i.test(x));
  const m = l && /(\d{1,3}[.,]\d{1,2})\s?%/.exec(l);
  return m ? Number(m[1].replace(",", ".")) / 100 : undefined;
}

export const parserAmex: ParserEstado = {
  banco: "Amex",

  detectar(lineas) {
    return lineas.some((l) => /American Express Company \(M[ée]xico\)|americanexpress\.com\.mx/i.test(l));
  },

  leer(lineas) {
    const avisos: string[] = [];
    const encabezado = lineas.findIndex((l) => /\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{1,2}-[A-Za-z]{3}-\d{4}/.test(l));
    const fechaCorte = encabezado >= 0 ? fechaDdMmmAaaa(lineas[encabezado]) : undefined;
    if (!fechaCorte) throw new Error("No encontré la fecha de corte de este estado de American Express.");
    const titular = encabezado >= 0 ? lineas[encabezado].split(/\s{2,}|\s\d{1,2}-/)[0].trim() : undefined;
    const cuenta = lineas.map((l) => /(\d{4})-(\d{6})-(\d{5})/.exec(l)).find(Boolean);

    // Resumen: Saldo anterior − Pagos + Nuevos cargos = Saldo actual  Pago mínimo
    const resumen = lineas.map((l) => new RegExp(String.raw`${IMPORTE}\s+-\s+${IMPORTE}\s*\+\s*${IMPORTE}\s*=\s*${IMPORTE}\s+${IMPORTE}`).exec(l)).find(Boolean);
    const limite = lineas.map((l) => new RegExp(String.raw`Fecha l[íi]mite de pago:\s*(\d{1,2}) de ${RE_MES}(?:\s+(\d{4}))?`, "i").exec(l)).find(Boolean);
    const periodo = lineas.map((l) => new RegExp(String.raw`Del (\d{1,2}) de ${RE_MES} al`, "i").exec(l)).find(Boolean);
    const nuevasTransacciones = lineas.map((l) => new RegExp(String.raw`^Nuevas transacciones:\s+${IMPORTE}`, "i").exec(l)).find(Boolean);

    const filas: Fila[] = [];
    const msiMensualidades: Fila[] = [];
    const grupos: { nombre: string; total: number }[] = [];
    let pendientes: Fila[] = [];
    let enMSI = false;
    let enMovimientos = false;
    let totalMSI = 0;
    // Fila partida por un salto de página: descripción e importe al final de una página,
    // la fecha ("25 de" + RFC, y el mes abajo) al inicio de la siguiente.
    let huerfana: { descripcion: string; importe: string } | null = null;

    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i].trim();
      const total = RE_TOTAL_GRUPO.exec(l);
      if (total) {
        const nombre = total[1].trim();
        const suma = redondear(pendientes.filter((f) => !f.esPago).reduce((s, f) => s + f.monto, 0));
        if (Math.abs(suma - leerMonto(total[2])) > 0.05) avisos.push(`Los cargos de ${nombre} suman ${suma}, el banco dice ${total[2]}.`);
        for (const f of pendientes) f.tarjetahabiente = f.esPago ? titular : nombre;
        filas.push(...pendientes);
        const previo = grupos.find((g) => g.nombre === nombre);
        if (previo) previo.total = redondear(previo.total + leerMonto(total[2]));
        else grupos.push({ nombre, total: leerMonto(total[2]) });
        pendientes = [];
        continue;
      }
      if (/^Transacciones de Meses sin Intereses/i.test(l)) { enMSI = true; continue; }
      const totalMsi = RE_TOTAL_MSI.exec(l);
      if (totalMsi) { totalMSI = leerMonto(totalMsi[1]); enMSI = false; continue; }

      if (/^Fecha y Detalle de las operaciones/i.test(l)) { enMovimientos = true; continue; }
      const sinFecha = enMovimientos && !enMSI && !/^Total|:/i.test(l) ? new RegExp(String.raw`^([A-Z*][^:]*?\S)\s{2,}${IMPORTE}$`).exec(l) : null;
      if (sinFecha && !RE_FILA.test(l)) { huerfana = { descripcion: sinFecha[1], importe: sinFecha[2] }; continue; }
      const soloFecha = /^(\d{1,2}) de(?:\s+(?:RFC\S*.*)?)?$/.exec(l);
      if (soloFecha && huerfana) {
        const sm = RE_SOLO_MES.exec(lineas[i + 1]?.trim() ?? "");
        if (sm) {
          pendientes.push({
            fecha: conAnio(Number(soloFecha[1]), MESES[sm[1].toLowerCase()], fechaCorte),
            descripcion: limpiarDescripcion(huerfana.descripcion), monto: leerMonto(huerfana.importe), esPago: false,
          });
          huerfana = null;
          continue;
        }
      }

      const fila = RE_FILA.exec(l);
      if (!fila) continue;
      huerfana = null;
      let mes = fila[2] ? MESES[fila[2].toLowerCase()] : undefined;
      let extra = "";
      const siguiente = lineas[i + 1]?.trim() ?? "";
      if (!mes) {
        const sm = RE_SOLO_MES.exec(siguiente);
        if (!sm) continue;
        mes = MESES[sm[1].toLowerCase()];
        extra = sm[2];
      }
      // Lo que sigue hasta la próxima fila: "CR", "CARGO 04 DE 06", RFC…
      const resto = [extra];
      for (let k = i + (fila[2] ? 1 : 2); k < Math.min(lineas.length, i + 5); k++) {
        const x = lineas[k].trim();
        if (RE_FILA.test(x) || RE_TOTAL_GRUPO.test(x) || RE_TOTAL_MSI.test(x)) break;
        resto.push(x);
      }
      const esCredito = resto.some((x) => /(^|\s)CR$/.test(x.trim()));
      const cuota = resto.map((x) => RE_CUOTA.exec(x)).find(Boolean);
      const descripcionBase = limpiarDescripcion(fila[3]);
      const f: Fila = {
        fecha: conAnio(Number(fila[1]), mes, fechaCorte),
        descripcion: cuota ? `${dosDigitos(Number(cuota[1]))} DE ${dosDigitos(Number(cuota[2]))} ${descripcionBase}` : descripcionBase,
        monto: leerMonto(fila[4]) * (esCredito ? -1 : 1),
        esPago: /^PAGO RECIBIDO/i.test(descripcionBase),
        cuota: cuota ? [Number(cuota[1]), Number(cuota[2])] : undefined,
      };
      if (enMSI) { f.tarjetahabiente = titular; msiMensualidades.push(f); } else pendientes.push(f);
    }
    if (pendientes.length) {
      avisos.push(`${pendientes.length} movimientos quedaron sin tarjetahabiente; se asignaron al titular.`);
      for (const f of pendientes) f.tarjetahabiente = titular;
      filas.push(...pendientes);
    }

    // Compras a meses: la tabla consolidada no dice de quién son; se asignan por su mensualidad
    const msi: MSILeida[] = [];
    for (let i = 0; i < lineas.length; i++) {
      const m = new RegExp(String.raw`^(.*?\S)\s+(\d{1,2}) de ([A-Za-z]{3})\s+${IMPORTE}\s+[\d.]+%\s+${IMPORTE}\s+(\d{1,3}) de (\d{1,3})\s+${IMPORTE}$`).exec(lineas[i].trim());
      if (!m) continue;
      const mensualidad = leerMonto(m[8]);
      const mesCompra = MES_ABREV[m[3].toLowerCase()];
      const dueno = filas.find((f) => f.cuota && Math.abs(f.monto - mensualidad) < 0.01 && f.cuota[1] === Number(m[7]));
      msi.push({
        fechaCompra: mesCompra ? conAnio(Number(m[2]), mesCompra, fechaCorte) : undefined,
        descripcion: limpiarDescripcion(m[1]),
        montoOriginal: leerMonto(m[4]), saldoPendiente: leerMonto(m[5]), pagoMensual: mensualidad,
        pagoActual: Number(m[6]), totalPagos: Number(m[7]),
        tarjetahabiente: dueno?.tarjetahabiente ?? titular,
      });
    }

    const todos = [...filas, ...msiMensualidades];
    const movimientos: MovimientoLeido[] = todos.map(({ fecha, descripcion, monto, tarjetahabiente }) => ({ fecha, descripcion, monto, tarjetahabiente }));
    const cargosPositivos = redondear(filas.filter((f) => !f.esPago && f.monto > 0).reduce((s, f) => s + f.monto, 0));
    // "Pagos y créditos" del banco = pagos + abonos (como el "MONTO A DIFERIR" que pasa a meses)
    const pagos = redondear(filas.filter((f) => f.monto < 0).reduce((s, f) => s - f.monto, 0));
    const totalCargos = resumen ? leerMonto(resumen[3]) : undefined;
    const totalAbonos = resumen ? leerMonto(resumen[2]) : undefined;
    const esperadoNuevas = nuevasTransacciones ? leerMonto(nuevasTransacciones[1]) : undefined;

    let cuadra = avisos.length === 0;
    if (esperadoNuevas !== undefined && Math.abs(cargosPositivos - esperadoNuevas) > 0.05) {
      cuadra = false;
      avisos.push(`Los cargos leídos suman ${cargosPositivos}; el banco dice ${esperadoNuevas} de nuevas transacciones.`);
    }
    if (totalCargos !== undefined && Math.abs(cargosPositivos + totalMSI - totalCargos) > 0.05) {
      cuadra = false;
      avisos.push(`Cargos + meses sin intereses = ${redondear(cargosPositivos + totalMSI)}; el banco dice ${totalCargos}.`);
    }
    if (totalAbonos !== undefined && Math.abs(pagos - totalAbonos) > 0.05) {
      cuadra = false;
      avisos.push(`Los pagos leídos suman ${pagos}; el banco dice ${totalAbonos}.`);
    }

    const estado: EstadoLeido = {
      banco: "Amex",
      terminacion: cuenta ? cuenta[3].slice(-4) : undefined,
      fechaCorte,
      fechaLimite: limite ? fechaLimiteDe(Number(limite[1]), MESES[limite[2].toLowerCase()], fechaCorte) : undefined,
      periodoDesde: periodo ? conAnio(Number(periodo[1]), MESES[periodo[2].toLowerCase()], fechaCorte) : undefined,
      pagoNoIntereses: resumen ? leerMonto(resumen[4]) : undefined,
      pagoMinimo: resumen ? leerMonto(resumen[5]) : undefined,
      tasaAnual: tasaAmex(lineas),
      totalCargos, totalAbonos,
      movimientos, msi, cuadra, avisos,
      titular,
      tarjetahabientes: grupos,
    };
    return estado;
  },
};
