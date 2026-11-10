// Lectura de estados de cuenta en PDF: texto → líneas → lector del banco correspondiente.
//
// Para sumar un banco (HSBC, Amex, Revolut…): crear `<banco>.ts` que exporte un ParserEstado
// ({ banco, detectar, leer }) y agregarlo a LECTORES. Ver notas en comun.ts.
import type { Banco, EstadoLeido } from "../tipos";
import { parserAmex } from "./amex";
import { parserBanamex } from "./banamex";
import { parserBBVA } from "./bbva";
import { parserHSBC } from "./hsbc";
import { parserRevolut } from "./revolut";
import type { ParserEstado } from "./comun";
import { extraerLineas, type ModuloPdfjs } from "./lineas";

export type { ParserEstado } from "./comun";
export type { ModuloPdfjs } from "./lineas";

/** Lectores registrados, en orden de prioridad de detección. */
export const LECTORES: ParserEstado[] = [parserBBVA, parserBanamex, parserAmex, parserHSBC, parserRevolut];

/** Bancos que ya se saben leer. */
export const BANCOS_SOPORTADOS: Banco[] = LECTORES.map((p) => p.banco);

/**
 * Extrae el texto del PDF en líneas visuales. En el navegador no hace falta pasar `pdfjs`;
 * en node (pruebas) se pasa el build legacy: `import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"`.
 */
export async function pdfALineas(
  datos: ArrayBuffer | Uint8Array,
  pdfjs?: ModuloPdfjs,
): Promise<string[]> {
  const modulo = pdfjs ?? (await import("./pdfNavegador")).pdfjs;
  return extraerLineas(modulo, datos);
}

export function detectarBanco(lineas: string[]): Banco | null {
  return LECTORES.find((p) => p.detectar(lineas))?.banco ?? null;
}

export function leerEstado(lineas: string[]): EstadoLeido {
  const lector = LECTORES.find((p) => p.detectar(lineas));
  if (!lector) {
    throw new Error(
      `No reconocí el banco de este estado de cuenta. Por ahora se pueden leer: ${BANCOS_SOPORTADOS.join(", ")}.`,
    );
  }
  return lector.leer(lineas);
}

export async function leerPDF(
  datos: ArrayBuffer | Uint8Array,
  pdfjs?: ModuloPdfjs,
): Promise<EstadoLeido> {
  const lineas = await pdfALineas(datos, pdfjs);
  if (lineas.length === 0) {
    throw new Error("El PDF no tiene texto que se pueda leer (¿es una imagen escaneada?).");
  }
  return leerEstado(lineas);
}

/**
 * En el navegador: lee el texto del PDF y, si no tiene (estado escaneado), usa OCR.
 * `alAvanzar` recibe la página que se está reconociendo.
 */
export async function leerPDFConOCR(
  datos: ArrayBuffer,
  alAvanzar?: (pagina: number, total: number) => void,
): Promise<EstadoLeido> {
  const lineas = await pdfALineas(datos.slice(0));
  if (lineas.length >= 20) return leerEstado(lineas);
  const { ocrPDF } = await import("./ocrNavegador");
  const lineasOCR = await ocrPDF(datos, alAvanzar);
  if (lineasOCR.length === 0) throw new Error("No pude leer nada en este PDF.");
  return leerEstado(lineasOCR);
}
