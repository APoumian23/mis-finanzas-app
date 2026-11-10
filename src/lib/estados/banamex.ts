// Lector de estados de cuenta de tarjetas de crédito Banamex (Joy y demás con el mismo formato).
import type { EstadoLeido } from "../tipos";
import {
  CAMPOS_RESUMEN,
  FIN_SECCION_COMUN,
  avisarFaltantes,
  leerEncabezadoCondusef,
  leerSecciones,
  revisarCuadre,
  sumar,
  type ParserEstado,
} from "./comun";

/*
 * Notas de formato Banamex:
 * - A diferencia de BBVA, Banamex sí lista intereses ("INTERES GRAVABLE/EXENTO"), su IVA y las
 *   comisiones como movimientos, y su "Total cargos" los incluye. No hacen falta filas sintéticas.
 * - En el encabezado varias etiquetas quedan en un renglón distinto al de su importe (por las notas
 *   al pie); montoDeEtiqueta revisa los renglones vecinos que solo traen el importe.
 * - La descripción puede traer una segunda columna (RFC del comercio o "009 de 012"); se conserva,
 *   unida con un espacio, igual que en el Excel de control.
 * - Las compras a meses traen una sola fecha.
 */

const DETECTAR = [/BANCO NACIONAL DE M[ÉE]XICO/i, /www\.banamex\.com/i, /\bJOY BANAMEX\b/i];

export const parserBanamex: ParserEstado = {
  banco: "Banamex",

  detectar(lineas) {
    return lineas.some((l) => DETECTAR.some((re) => re.test(l)));
  },

  leer(lineas) {
    const estado: EstadoLeido = leerEncabezadoCondusef(lineas, "Banamex");
    const secciones = leerSecciones(lineas, {
      inicioMovimientos: /^CARGOS,\s*ABONOS Y COMPRAS REGULARES/i,
      inicioMSI: /^COMPRAS Y CARGOS DIFERIDOS A MESES SIN INTERESES/i,
      finSeccion: FIN_SECCION_COMUN,
    });
    estado.movimientos = secciones.movimientos;
    estado.msi = secciones.msi;

    if (!estado.fechaCorte) estado.avisos.push("No se pudo leer la fecha de corte.");
    avisarFaltantes(estado, CAMPOS_RESUMEN);
    for (const l of secciones.sinLeer) estado.avisos.push(`Renglón no reconocido: «${l}»`);
    if (estado.movimientos.length === 0)
      estado.avisos.push("No se encontraron movimientos en el estado de cuenta.");

    estado.cuadra = revisarCuadre(estado, sumar(estado.movimientos, 1), sumar(estado.movimientos, -1));
    return estado;
  },
};
