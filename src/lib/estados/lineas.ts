// Extracción de texto de un PDF con pdfjs, reconstruyendo las líneas visuales.
// No depende del entorno: recibe el módulo de pdfjs ya cargado (navegador o node).

export type ModuloPdfjs = typeof import("pdfjs-dist");

interface Pieza {
  x: number;
  y: number;
  ancho: number;
  texto: string;
  /** Ancho aproximado de un carácter en esta pieza. */
  anchoLetra: number;
}

/** Tolerancia vertical (en puntos) para considerar que dos piezas están en el mismo renglón. */
const TOLERANCIA_Y = 2;

/**
 * Convierte el PDF en una lista de líneas de texto, en orden de lectura.
 * Las piezas del mismo renglón se unen con un espacio; si entre ellas hay un hueco
 * grande (columnas) se usan dos espacios, para que las columnas sigan separables.
 */
export async function extraerLineas(
  pdfjs: ModuloPdfjs,
  datos: ArrayBuffer | Uint8Array,
): Promise<string[]> {
  // pdfjs se queda con el buffer (lo transfiere al worker): trabajamos con una copia.
  // (Uint8Array.from también convierte un Buffer de node en un Uint8Array normal.)
  const bytes = datos instanceof Uint8Array ? Uint8Array.from(datos) : new Uint8Array(datos.slice(0));
  const tarea = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await tarea.promise;
  const lineas: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      const piezas: Pieza[] = [];
      for (const item of contenido.items) {
        if (!("str" in item)) continue;
        const texto = item.str;
        if (!texto || !texto.trim()) continue;
        const [a, b, , , x, y] = item.transform as number[];
        const tamFuente = Math.hypot(a, b) || item.height || 8;
        const largo = texto.length || 1;
        const anchoLetra = item.width > 0 ? item.width / largo : tamFuente * 0.5;
        piezas.push({ x, y, ancho: item.width, texto, anchoLetra });
      }
      lineas.push(...agruparEnLineas(piezas));
      pagina.cleanup();
    }
  } finally {
    await tarea.destroy();
  }
  return lineas;
}

function agruparEnLineas(piezas: Pieza[]): string[] {
  // De arriba hacia abajo (en PDF la Y crece hacia arriba).
  const ordenadas = [...piezas].sort((p, q) => q.y - p.y || p.x - q.x);
  const renglones: { y: number; piezas: Pieza[] }[] = [];
  for (const p of ordenadas) {
    const ultimo = renglones[renglones.length - 1];
    if (ultimo && Math.abs(ultimo.y - p.y) <= TOLERANCIA_Y) ultimo.piezas.push(p);
    else renglones.push({ y: p.y, piezas: [p] });
  }
  return renglones
    .map((r) => unirRenglon(r.piezas.sort((p, q) => p.x - q.x)))
    .filter((l) => l.length > 0);
}

function unirRenglon(piezas: Pieza[]): string {
  let linea = "";
  let finAnterior: number | null = null;
  for (const p of piezas) {
    const texto = p.texto.replace(/\s+/g, " ");
    if (finAnterior === null) {
      linea = texto.trimStart();
    } else {
      const hueco = p.x - finAnterior;
      const letra = Math.max(p.anchoLetra, 1);
      let sep: string;
      if (hueco > letra * 1.5) sep = "  ";
      else if (hueco > letra * 0.15) sep = " ";
      else sep = ""; // piezas pegadas (una palabra partida en varias piezas)
      if (linea.endsWith(" ") || texto.startsWith(" ")) {
        linea = linea.replace(/ +$/, "") + (sep === "  " ? "  " : " ") + texto.trimStart();
      } else {
        linea += sep + texto;
      }
    }
    finAnterior = Math.max(finAnterior ?? -Infinity, p.x + p.ancho);
  }
  return linea.replace(/\s+$/, "");
}
