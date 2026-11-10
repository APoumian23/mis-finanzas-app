// OCR en el navegador para estados de cuenta escaneados (HSBC). Todo corre en el teléfono:
// la imagen nunca sale del dispositivo. Solo la primera vez se descarga el modelo de español.
import { createWorker, PSM } from "tesseract.js";
import { pdfjs } from "./pdfNavegador";
import { palabrasARenglones, quitarLineasDeTabla, type Palabra } from "./ocrComun";

// Medido con estados de HSBC: a 200 dpi se salta filas; a 300 dpi el navegador aún pierde texto de la
// tabla; a 400 dpi lee todas las filas y hasta el "$". Safari de iPhone no dibuja lienzos de más de
// ~16.7 millones de píxeles, así que la escala se recorta si la página es más grande.
const PUNTOS_POR_PULGADA = 400;
const MAX_PIXELES = 16_000_000;

export async function ocrPDF(datos: ArrayBuffer, alAvanzar?: (pagina: number, total: number) => void): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
  const worker = await createWorker("spa");
  // PSM 3 (automático): con el 6 de fábrica de tesseract.js se pierden tablas enteras
  await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.AUTO });
  const lineas: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      alAvanzar?.(n, doc.numPages);
      const pagina = await doc.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(PUNTOS_POR_PULGADA / 72, Math.sqrt(MAX_PIXELES / (base.width * base.height)));
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.ceil(vista.width);
      lienzo.height = Math.ceil(vista.height);
      // intent "print": no espera requestAnimationFrame, que se detiene si la app pasa a segundo plano
      const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      await pagina.render({ canvas: lienzo, canvasContext: ctx, viewport: vista, intent: "print" } as never).promise;
      const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      quitarLineasDeTabla(imagen.data, lienzo.width, lienzo.height);
      ctx.putImageData(imagen, 0, 0);
      const { data } = await worker.recognize(lienzo, {}, { blocks: true, text: true });
      const palabras: Palabra[] = [];
      for (const b of data.blocks ?? []) for (const par of b.paragraphs) for (const l of par.lines) for (const w of l.words) {
        palabras.push({ texto: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
      }
      lineas.push(...(palabras.length ? palabrasARenglones(palabras) : data.text.split("\n")));
      lienzo.width = lienzo.height = 0; // libera memoria en iPhone
      if (/^\s*NOTAS ACLARATORIAS\s*$/m.test(data.text)) break; // el título de la sección, no la frase "ver notas…"
    }
  } finally {
    await worker.terminate();
    await doc.cleanup?.();
  }
  return lineas.map((l) => l.trim()).filter(Boolean);
}
