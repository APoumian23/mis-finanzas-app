// Lector de estados de cuenta de la tarjeta de crédito Revolut México.
import type { EstadoLeido, MovimientoLeido } from "../tipos";
import { avisarFaltantes, leerMonto, revisarCuadre, sumar, ultimos4, type ParserEstado } from "./comun";

/*
 * Notas de formato Revolut:
 * - Formato CONDUSEF, pero con fechas "14 sept 2026" / "1 jun 2026" (mes abreviado en minúsculas,
 *   septiembre como "sept") y el día de la semana en la fecha límite ("Miércoles, 28 oct 2026").
 * - Cada movimiento: "fecha operación  fecha cargo  descripción  +$123.45" (cargo) o "-$123.45" (abono).
 *   Debajo vienen renglones de detalle que se ignoran: "Tarjeta: **** 7254", "To: …", "From: …",
 *   "IVA: $23.84" (ya incluido en el monto) y, en compras en dólares, "Monto Original: $6.00 USD…".
 * - Pagos: "SPEI transfer received from STP" o "To MXN" (pago desde el saldo de la cuenta Revolut).
 * - "Total cargos" / "Total abonos" cierran la sección: contra ellos se revisa que la suma cuadre.
 * - La tarjeta física y la virtual tienen distinto número; la cuenta se reconoce por la CLABE
 *   (es la misma en todos los estados, aunque en el mes no haya compras con tarjeta).
 */

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12,
};
const FECHA = String.raw`(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sept?|set|oct|nov|dic)\.? (\d{4})`;
const RE_FILA = new RegExp(String.raw`^${FECHA}\s+${FECHA}\s+(.+?)\s+([+-])\s*\$([\d,]+\.\d{2})$`, "i");

function fecha(dia: string, mes: string, anio: string): string | undefined {
  const m = MESES[mes.toLowerCase().replace(".", "")];
  return m ? `${anio}-${String(m).padStart(2, "0")}-${dia.padStart(2, "0")}` : undefined;
}

/** Primera fecha que sigue a la etiqueta en la misma línea. */
function fechaTras(lineas: string[], etiqueta: RegExp): string | undefined {
  const re = new RegExp(etiqueta.source + String.raw`.*?` + FECHA, "i");
  for (const l of lineas) {
    const m = re.exec(l);
    if (m) return fecha(m[m.length - 3], m[m.length - 2], m[m.length - 1]);
  }
  return undefined;
}

/** Importe que sigue a la etiqueta en la misma línea ("Pago mínimo  $50.00", "Monto de intereses  +$0.00"). */
function montoTras(lineas: string[], etiqueta: RegExp): number | undefined {
  const re = new RegExp(etiqueta.source + String.raw`\s+[=+-]?\s*\$\s?([\d,]+\.\d{2})`, "i");
  for (const l of lineas) {
    const m = re.exec(l);
    if (m) return leerMonto(m[1]);
  }
  return undefined;
}

/** "Compra Mercadopago Erickfer" → "Mercadopago Erickfer"; lo demás se deja como lo pone el banco. */
const limpiar = (d: string) => d.replace(/^Compra\s+/i, "").replace(/\s+/g, " ").trim();

export const parserRevolut: ParserEstado = {
  banco: "Revolut",

  detectar(lineas) {
    const texto = lineas.slice(0, 40).join("\n");
    return /Revolut Credit Card/i.test(texto) || (/Revolut/i.test(lineas.join("\n")) && /Pago para no generar intereses/i.test(texto));
  },

  leer(lineas) {
    const fechaCorte = fechaTras(lineas, /Fecha corte/);
    if (!fechaCorte) throw new Error("No encontré la fecha de corte del estado de Revolut.");
    const periodo = lineas.map((l) => new RegExp(String.raw`Periodo\s+${FECHA}\s+al`, "i").exec(l)).find(Boolean);
    const clabe = lineas.map((l) => /\bCLABE\s+(\d{18})\b/.exec(l)).find(Boolean)?.[1];
    const tasa = lineas.map((l) => /Tasa de inter[eé]s anual ordinaria(?: variable)?\s+([\d.]+)%/i.exec(l)).find(Boolean)?.[1];

    const estado: EstadoLeido = {
      banco: "Revolut",
      terminacion: clabe ? ultimos4(clabe) : undefined,
      fechaCorte,
      fechaLimite: fechaTras(lineas, /Fecha l[ií]mite de pago/),
      periodoDesde: periodo ? fecha(periodo[1], periodo[2], periodo[3]) : undefined,
      pagoNoIntereses: montoTras(lineas, /^Pago para no generar intereses/),
      pagoMinimo: montoTras(lineas, /^Pago m[ií]nimo(?! \+)/),
      intereses: montoTras(lineas, /Monto de intereses(?! pagados)/),
      comisiones: montoTras(lineas, /^Monto de comisiones(?! totales)/),
      iva: montoTras(lineas, /^IVA de intereses y comisiones/),
      totalCargos: montoTras(lineas, /^Total cargos/),
      totalAbonos: (() => { const t = montoTras(lineas, /^Total abonos/); return t === undefined ? undefined : -t; })(),
      saldoTotal: montoTras(lineas, /^Saldo deudor total/),
      tasaAnual: tasa ? Number(tasa) / 100 : undefined,
      titular: lineas.map((l) => /Tarjeta titular:\s*(.+)$/i.exec(l)).find(Boolean)?.[1].trim(),
      movimientos: [],
      msi: [],
      avisos: [],
    };

    // Movimientos: desde "Cargos, abonos y compras regulares" hasta "Total cargos"
    let dentro = false;
    let enMeses = false;
    for (const l of lineas) {
      if (/^Cargos, abonos y compras regulares/i.test(l)) { dentro = true; enMeses = false; continue; }
      if (/^Compras y cargos diferidos a meses/i.test(l)) { enMeses = true; continue; }
      if (/^Total cargos/i.test(l)) { dentro = false; continue; }
      const m = RE_FILA.exec(l.trim());
      if (!m) continue;
      if (enMeses && !dentro) {
        estado.avisos.push("Este estado trae compras a meses en Revolut y todavía no sé leerlas: anótalas a mano.");
        continue;
      }
      if (!dentro) continue;
      const f = fecha(m[1], m[2], m[3]);
      if (!f) continue;
      const importe = leerMonto(m[9]);
      const mov: MovimientoLeido = { fecha: f, descripcion: limpiar(m[7]), monto: m[8] === "-" ? -importe : importe };
      estado.movimientos.push(mov);
    }

    // Si la tarjeta ya iba vencida, el banco no pone fecha: "Fecha límite de pago  inmediato"
    if (!estado.fechaLimite && lineas.some((l) => /Fecha l[ií]mite de pago\s+inmediato/i.test(l))) {
      estado.fechaLimite = fechaCorte;
      estado.avisos.push("La tarjeta iba atrasada: el banco pide el pago de inmediato.");
    }
    avisarFaltantes(estado, [["fechaLimite", "la fecha límite de pago"], ["pagoNoIntereses", "el pago para no generar intereses"]]);
    estado.cuadra = revisarCuadre(estado, sumar(estado.movimientos, 1), sumar(estado.movimientos, -1));
    return estado;
  },
};
