const ZONA = "America/Mexico_City";

export function uid(): string {
  return crypto.randomUUID();
}

const formatoPesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const formatoPesosCorto = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export const pesos = (n: number) => formatoPesos.format(n || 0);
export const pesosCorto = (n: number) => formatoPesosCorto.format(Math.round(n || 0));
export const redondear = (n: number) => Math.round(n * 100) / 100;

/** Fecha de hoy (yyyy-mm-dd) en Ciudad de México, no en UTC. */
export function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
}

export const mesDe = (fechaISO: string) => fechaISO.slice(0, 7); // "2026-10"

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10" → "oct 26" */
export function etiquetaMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${String(a).slice(2)}`;
}

/** "2026-10" → "octubre 2026" */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES_LARGOS[m - 1]} ${a}`;
}

/** "2026-10-08" → "8 oct" (o "8 oct 25" si no es del año en curso) */
export function fechaCorta(fechaISO: string, conAnio = false): string {
  const [a, m, d] = fechaISO.split("-").map(Number);
  const anioActual = Number(hoyISO().slice(0, 4));
  const anio = conAnio || a !== anioActual ? ` ${String(a).slice(2)}` : "";
  return `${d} ${MESES[m - 1]}${anio}`;
}

export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function diferenciaMeses(desde: string, hasta: string): number {
  const [a1, m1] = desde.split("-").map(Number);
  const [a2, m2] = hasta.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export function diasEnMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function sumar<T>(lista: T[], f: (x: T) => number): number {
  return redondear(lista.reduce((s, x) => s + (f(x) || 0), 0));
}

/** Convierte un texto con formato de dinero ("$1,234.50", "1234,5") a número. */
export function aNumero(texto: string): number {
  const limpio = texto.replace(/[^\d.,-]/g, "");
  if (/,\d{1,2}$/.test(limpio) && !limpio.includes(".")) return Number(limpio.replace(",", "."));
  return Number(limpio.replace(/,/g, "")) || 0;
}

/** Fecha del último respaldo guardado en este teléfono (para recordarte hacer otro). */
export const CLAVE_ULTIMO_RESPALDO = "ultimo-respaldo";
export function ultimoRespaldo(): string | null {
  try { return localStorage.getItem(CLAVE_ULTIMO_RESPALDO); } catch { return null; }
}

/** Monto corto para etiquetas de gráficas: $850, $4.2k, $16k. */
export function pesosK(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) < 1000) return `$${v}`;
  const k = v / 1000;
  return `$${Math.abs(k) >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}
