// Colores fijos por tipo y por categoría, para que cada cosa se vea igual en todas las gráficas.

export const COLOR_TIPO: Record<string, string> = {
  "Fuga financiera": "#dc2626",
  Recurrente: "#6366f1",
  "A meses (MSI)": "#0891b2",
  "Gasto fuerte": "#d97706",
  Variable: "#0f766e",
  Hormiga: "#a855f7",
};

/** Paleta para pasteles y series (validada para daltonismo, claro y oscuro). Se usa siempre en este orden. */
export const SERIE = Array.from({ length: 8 }, (_, i) => `var(--serie-${i + 1})`);
export const COLOR_OTROS = "var(--otros)";

/** Cada persona con su color fijo en todas las gráficas: tú primero, luego en el orden de tu lista. */
export function colorPersona(nombre: string, personas: string[]): string {
  const i = personas.indexOf(nombre);
  return i >= 0 && i < SERIE.length ? SERIE[i] : COLOR_OTROS;
}

const PALETA = [
  "#0f766e", "#d97706", "#6366f1", "#db2777", "#0891b2", "#65a30d",
  "#a855f7", "#ea580c", "#2563eb", "#ca8a04", "#059669", "#9333ea",
];

const FIJOS: Record<string, string> = {
  "Comida fuera y bares": "#d97706",
  "OXXO y tiendas de conveniencia": "#a855f7",
  "Súper y despensa": "#65a30d",
  "Farmacia y salud": "#db2777",
  "Gasolina y auto": "#2563eb",
  "Transporte (Uber/Didi/bus)": "#0891b2",
  Entretenimiento: "#9333ea",
  Mascotas: "#0f766e",
  "Compras en línea": "#ea580c",
  "Hogar, oficina y servicios": "#ca8a04",
  "Viajes y hospedaje": "#059669",
  "Otros / sin identificar": "#78716c",
  "Intereses y comisiones": "#dc2626",
};

export function colorCategoria(categoria: string): string {
  if (FIJOS[categoria]) return FIJOS[categoria];
  let h = 0;
  for (const c of categoria) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

/** Nombre corto para etiquetas de gráficas. */
export function categoriaCorta(categoria: string): string {
  return categoria
    .replace("OXXO y tiendas de conveniencia", "OXXO y tienditas")
    .replace("Transporte (Uber/Didi/bus)", "Transporte")
    .replace("Hogar, oficina y servicios", "Hogar y oficina")
    .replace("Otros / sin identificar", "Otros")
    .replace("Comida fuera y bares", "Comida fuera")
    .replace("Intereses y comisiones", "Intereses");
}
