// Carga de pdfjs para el navegador (Vite): el worker se sirve como archivo aparte.
// Se importa de forma diferida desde index.ts para que las pruebas en node no lo toquen.
// Build "legacy": funciona también en Safari de iPhones con iOS no tan reciente.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
