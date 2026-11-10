// Lector de estados de cuenta de tarjetas de crédito BBVA México (Oro, Platinum… mismo formato).
import type { EstadoLeido, MovimientoLeido } from "../tipos";
import {
  CAMPOS_RESUMEN,
  FIN_SECCION_COMUN,
  avisarFaltantes,
  leerEncabezadoCondusef,
  leerSecciones,
  redondear,
  revisarCuadre,
  sumar,
  type ParserEstado,
} from "./comun";

export const DESC_INTERESES_BBVA = "INTERESES ORDINARIOS DEL PERIODO (resumen BBVA)";
export const DESC_IVA_BBVA = "IVA DE INTERESES Y COMISIONES (resumen BBVA)";

/*
 * Cómo cuadra BBVA (revisado con 6 estados reales, may–sep 2026, de dos tarjetas distintas):
 *
 * - BBVA NO lista los intereses ni su IVA como movimientos: solo aparecen en el resumen
 *   ("Monto de intereses", "IVA de intereses y comisiones"). Su "TOTAL CARGOS" NO los incluye.
 *   Ejemplo corte 18-may-2026: filas = $24,269.88 = TOTAL CARGOS; intereses $674.80 e IVA $102.81
 *   van aparte.
 * - Las comisiones SÍ aparecen como movimiento ("COMISION DISPOSICION EFI", "PENALIZACION POR PAGO
 *   TARDIO", "ADMINISTRACION TARJ. TITULAR", "ADM.TAR.TIT. 1 DE 03", "CONTRATACION BENEFICIOS 3MSI"),
 *   pero "TOTAL CARGOS" las deja fuera. Ejemplos: corte 02-sep-2026 (otra tarjeta) la diferencia es
 *   exactamente la comisión de $448.00; corte 18-ago-2026, $150.09; corte 18-sep-2026, $2,024.66 =
 *   anualidad $1,151 + penalización $490 + mensualidad de anualidad $383.66.
 *   Por eso no se agrega una fila sintética de comisiones (ya están como filas) y el cuadre se
 *   calcula sin las filas de comisión.
 * - Para que los totales se comparen con Banamex (que sí lista intereses e IVA como filas), se
 *   agregan dos movimientos sintéticos con fecha de corte cuando son > 0, y el cuadre se calcula
 *   SIN ellos. Si algún día el total del banco sí los trajera, el cuadre también lo acepta.
 */

/** Filas que BBVA cobra como comisión y que su "TOTAL CARGOS" no incluye. */
const RE_COMISION =
  /\bCOMISION|\bPENALIZACION|\bADMINISTRACION TARJ|\bADM\.?\s*TAR|\bCONTRATACION BENEFICIOS|\bANUALIDAD/i;

const DETECTAR = [
  /INSTITUCION DE BANCA MULTIPLE,\s*GRUPO FINANCIERO BBVA/i,
  /BBVA M[ÉE]XICO,\s*S\.A\./i,
];

export const parserBBVA: ParserEstado = {
  banco: "BBVA",

  detectar(lineas) {
    return lineas.some((l) => DETECTAR.some((re) => re.test(l)));
  },

  leer(lineas) {
    const estado: EstadoLeido = leerEncabezadoCondusef(lineas, "BBVA");
    const secciones = leerSecciones(lineas, {
      inicioMovimientos: /^CARGOS,\s*COMPRAS Y ABONOS REGULARES/i,
      inicioMSI: /^COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES/i,
      finSeccion: FIN_SECCION_COMUN,
    });
    const reales = secciones.movimientos;
    estado.msi = secciones.msi;

    const sinteticos: MovimientoLeido[] = [];
    if (estado.fechaCorte) {
      if ((estado.intereses ?? 0) > 0)
        sinteticos.push({ fecha: estado.fechaCorte, descripcion: DESC_INTERESES_BBVA, monto: estado.intereses! });
      if ((estado.iva ?? 0) > 0)
        sinteticos.push({ fecha: estado.fechaCorte, descripcion: DESC_IVA_BBVA, monto: estado.iva! });
    }
    estado.movimientos = [...reales, ...sinteticos];

    if (!estado.fechaCorte) estado.avisos.push("No se pudo leer la fecha de corte.");
    avisarFaltantes(estado, CAMPOS_RESUMEN);
    for (const l of secciones.sinLeer) estado.avisos.push(`Renglón no reconocido: «${l}»`);
    if (reales.length === 0) estado.avisos.push("No se encontraron movimientos en el estado de cuenta.");

    // Distintas formas en que el total del banco puede estar armado; se usa la que cuadre.
    const cargosReales = sumar(reales, 1);
    const comisiones = sumar(reales.filter((m) => RE_COMISION.test(m.descripcion)), 1);
    const candidatos = [
      cargosReales,
      redondear(cargosReales - comisiones),
      redondear(cargosReales + sumar(sinteticos, 1)),
      redondear(cargosReales - comisiones + sumar(sinteticos, 1)),
    ];
    const total = estado.totalCargos;
    const cargosComparables =
      total === undefined
        ? cargosReales
        : candidatos.reduce((mejor, c) => (Math.abs(c - total) < Math.abs(mejor - total) ? c : mejor));
    estado.cuadra = revisarCuadre(estado, cargosComparables, sumar(reales, -1));
    return estado;
  },
};
