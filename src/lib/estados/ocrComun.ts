// Pasos del OCR que no dependen del navegador: los usan la app (ocrNavegador.ts) y scripts/ocr_hsbc.mjs,
// para que las pruebas lean el mismo texto que verá el teléfono.

/**
 * Borra las líneas de las tablas (trazos oscuros rectos de más de `largo` px) antes del OCR.
 * Con las líneas, el OCR del navegador parte cada renglón en columnas y pierde filas enteras;
 * sin ellas lee la tabla completa (medido con los estados de HSBC).
 */
export function quitarLineasDeTabla(pixeles: Uint8ClampedArray, ancho: number, alto: number, largo = 120): void {
  const oscuro = new Uint8Array(ancho * alto);
  for (let i = 0; i < ancho * alto; i++) {
    oscuro[i] = pixeles[i * 4] + pixeles[i * 4 + 1] + pixeles[i * 4 + 2] < 3 * 140 ? 1 : 0;
  }
  const borrar = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; ) {
      if (!oscuro[y * ancho + x]) { x++; continue; }
      let fin = x;
      while (fin < ancho && oscuro[y * ancho + fin]) fin++;
      if (fin - x >= largo) for (let k = x; k < fin; k++) borrar[y * ancho + k] = 1;
      x = fin;
    }
  }
  for (let x = 0; x < ancho; x++) {
    for (let y = 0; y < alto; ) {
      if (!oscuro[y * ancho + x]) { y++; continue; }
      let fin = y;
      while (fin < alto && oscuro[fin * ancho + x]) fin++;
      if (fin - y >= largo) for (let k = y; k < fin; k++) borrar[k * ancho + x] = 1;
      y = fin;
    }
  }
  for (let i = 0; i < ancho * alto; i++) {
    if (borrar[i]) pixeles[i * 4] = pixeles[i * 4 + 1] = pixeles[i * 4 + 2] = 255;
  }
}

export interface Palabra { texto: string; x0: number; x1: number; y0: number; y1: number }

/**
 * Arma los renglones a partir de la posición de cada palabra (no del orden de bloques del OCR, que separa
 * la columna de importes de la de descripciones). Las palabras cuyo centro vertical coincide van juntas,
 * de izquierda a derecha; un hueco grande se marca con varios espacios, como en los PDF de texto.
 */
export function palabrasARenglones(palabras: Palabra[]): string[] {
  if (palabras.length === 0) return [];
  const alturas = palabras.map((p) => p.y1 - p.y0).sort((a, b) => a - b);
  const alturaTipica = alturas[Math.floor(alturas.length / 2)] || 20;
  const ordenadas = [...palabras].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const renglones: { centro: number; palabras: Palabra[] }[] = [];
  for (const p of ordenadas) {
    const centro = (p.y0 + p.y1) / 2;
    const r = renglones.find((x) => Math.abs(x.centro - centro) < alturaTipica * 0.5);
    if (r) {
      r.palabras.push(p);
      r.centro = (r.centro * (r.palabras.length - 1) + centro) / r.palabras.length;
    } else renglones.push({ centro, palabras: [p] });
  }
  return renglones
    .sort((a, b) => a.centro - b.centro)
    .map((r) => {
      const ps = r.palabras.sort((a, b) => a.x0 - b.x0);
      return ps.map((p, i) => (i === 0 ? "" : p.x0 - ps[i - 1].x1 > alturaTipica * 1.5 ? "   " : " ") + p.texto).join("");
    });
}

