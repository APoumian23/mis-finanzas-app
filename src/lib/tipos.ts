// Modelo de datos de la app. Montos en pesos; cargo = positivo, abono/pago = negativo.

export type Banco = "BBVA" | "Banamex" | "HSBC" | "Amex" | "Revolut" | "Otro";
/** "ajena": pagaste con la tarjeta o el dinero de otra persona (p. ej. de la abuela): el gasto es tuyo, pero no va a tus tarjetas. */
export type TipoCuenta = "credito" | "debito" | "efectivo" | "ajena";

export interface Cuenta {
  id: string;
  nombre: string; // "BBVA Oro", "Banamex Joy", "Efectivo"
  banco: Banco | null;
  tipo: TipoCuenta;
  terminacion?: string; // últimos 4 dígitos
  alias?: string[]; // otras terminaciones de la misma cuenta (p. ej. tarjeta repuesta)
  /** Tarjeta de alguien más donde tienes una adicional: solo se cargan los movimientos a este nombre. */
  soloDe?: string;
  titular?: string;
  color?: string;
  archivada?: boolean;
}

export const CATEGORIAS = [
  "Intereses y comisiones",
  "Educación",
  "Suscripciones digitales",
  "Telefonía",
  "Seguros",
  "Comida fuera y bares",
  "OXXO y tiendas de conveniencia",
  "Súper y despensa",
  "Farmacia y salud",
  "Gasolina y auto",
  "Transporte (Uber/Didi/bus)",
  "Viajes y hospedaje",
  "Entretenimiento",
  "Mascotas",
  "Compras a meses (propias)",
  "Hogar, oficina y servicios",
  "Compras en línea",
  "Otros / sin identificar",
  "Ingreso extra",
  "Pago a tarjeta",
  "Reembolsos y puntos",
  "Informativo (no suma)",
] as const;
export type Categoria = (typeof CATEGORIAS)[number] | string;

/** Categorías base + las que ya existen en tus datos (p. ej. "Familia - …", "Por cobrar - …"). */
export function todasLasCategorias(enUso: string[]): string[] {
  return [...new Set([...CATEGORIAS, ...enUso.filter(Boolean)])];
}

export const TIPOS = [
  "Fuga financiera",
  "Recurrente",
  "A meses (MSI)",
  "Gasto fuerte",
  "Hormiga",
  "Variable",
  "Pago",
  "Abono",
  "Informativo",
] as const;
export type TipoGasto = (typeof TIPOS)[number];

export type Origen = "estado" | "manual" | "importado";

export interface Movimiento {
  id: string;
  cuentaId: string;
  fecha: string; // ISO yyyy-mm-dd (fecha de la operación)
  descripcion: string;
  monto: number; // + cargo, − abono
  categoria: Categoria;
  tipo: TipoGasto;
  responsable: string; // "Yo", "Papá", "Ana"…
  nota?: string;
  origen: Origen;
  estadoId?: string; // estado de cuenta del que viene
  periodo?: string; // "2026-11" = mes de la fecha de corte (como en el Excel)
  /** El gasto que habías anotado a mano y que este cargo del banco reemplazó (se recupera si quitas el estado). */
  manualOriginal?: Movimiento;
  creado: number; // Date.now()
}

/** Resumen de un estado de cuenta ya importado. */
export interface EstadoCuenta {
  id: string;
  cuentaId: string;
  banco: Banco;
  fechaCorte: string; // ISO
  fechaLimite?: string;
  periodoDesde?: string;
  pagoNoIntereses?: number;
  pagoMinimo?: number;
  intereses?: number;
  comisiones?: number;
  iva?: number;
  totalCargos?: number;
  totalAbonos?: number;
  saldoTotal?: number;
  archivo?: string;
  importado: number;
  /** Si es tarjeta de otra persona: el pago es solo tu parte, no el total del estado. */
  soloDe?: string;
  /** Tasa de interés anual de la tarjeta (0.709 = 70.9%), si el estado la trae. */
  tasaAnual?: number;
}

export interface CompraMSI {
  id: string;
  cuentaId: string;
  descripcion: string;
  fechaCompra?: string;
  montoOriginal: number;
  saldoPendiente: number;
  pagoMensual: number;
  pagoActual: number; // "7 de 12" → 7
  totalPagos: number; // → 12
  responsable: string;
  actualizadoAl: string; // fecha de corte del último estado que la trajo
  /** Capturada a mano: cuando un estado de cuenta la traiga, se reemplaza con lo que diga el banco. */
  manual?: boolean;
}

export interface PagoRegistrado {
  fecha: string;
  monto: number;
  nota?: string;
}

export interface Prestamo {
  id: string;
  nombre: string; // "Préstamo familiar"
  montoOriginal: number;
  saldoInicial: number; // saldo al registrarlo (puede ser distinto al original)
  fechaSaldoInicial: string;
  tasaAnual: number; // 0.39
  ivaSobreInteres: boolean;
  pagoMensual: number;
  plazoMeses?: number;
  primerPago?: string;
  /** Fecha del último pago según el contrato (manda sobre el cálculo mes a mes si vas al corriente). */
  ultimoPago?: string;
  /** Se paga por quincenas (el 15 y el último día), cada una la mitad del pago mensual. */
  quincenal?: boolean;
  pagos: PagoRegistrado[];
  nota?: string;
}

/** Alguien que te debe dinero. Los cargos en tarjeta salen de Movimientos con responsable = nombre. */
export interface Deudor {
  id: string;
  nombre: string;
  adeudos: { concepto: string; monto: number }[]; // fuera de tarjetas
  reembolsos: PagoRegistrado[];
  nota?: string;
}

export interface Ingreso {
  concepto: string;
  monto: number;
  dia?: number;
}

export interface GastoFijo {
  concepto: string;
  monto: number;
  nota?: string;
}

export interface Ajustes {
  id: "ajustes";
  ingresos: Ingreso[];
  fijos: GastoFijo[]; // sin préstamos ni MSI (esos se calculan)
  ahorroPct: number; // 0.10
  topes: Record<string, number>; // tope mensual por categoría
  /** Lo que planeas gastar al mes en tus cosas; lo demás se abona a los préstamos (para la fecha "libre de deudas"). */
  gastoPlaneado?: number;
  /** Lo que tienes en tu cuenta o en efectivo, y cuándo lo anotaste (punto de partida del calendario de pagos). */
  disponible?: { monto: number; fecha: string };
}

/** Regla aprendida: comercio normalizado → categoría. */
export interface Regla {
  clave: string; // descripción normalizada
  categoria: Categoria;
  tipo?: TipoGasto;
  responsable?: string;
  /** La clave basta con que aparezca como palabra en cualquier parte ("CFE" en "CSS CP CFE SUM SERV…"). */
  contiene?: boolean;
  /** Solo aplica a los movimientos de esta cuenta (dos pólizas Qualitas casi iguales en tarjetas distintas). */
  cuentaId?: string;
}

// ---------- Resultado de leer un PDF (antes de guardarlo) ----------

export interface MovimientoLeido {
  fecha: string; // ISO
  descripcion: string;
  monto: number; // + cargo, − abono
  /** En tarjetas con adicionales (Amex): a nombre de quién está el cargo. */
  tarjetahabiente?: string;
}

export interface MSILeida {
  fechaCompra?: string;
  descripcion: string;
  montoOriginal: number;
  saldoPendiente: number;
  pagoMensual: number;
  pagoActual: number;
  totalPagos: number;
  tarjetahabiente?: string;
}

export interface EstadoLeido {
  banco: Banco;
  terminacion?: string;
  fechaCorte: string;
  fechaLimite?: string;
  periodoDesde?: string;
  pagoNoIntereses?: number;
  pagoMinimo?: number;
  intereses?: number;
  comisiones?: number;
  iva?: number;
  totalCargos?: number;
  totalAbonos?: number;
  saldoTotal?: number;
  tasaAnual?: number;
  movimientos: MovimientoLeido[];
  msi: MSILeida[];
  /** Titular de la cuenta y total de cada tarjetahabiente (cuando el banco los separa). */
  titular?: string;
  tarjetahabientes?: { nombre: string; total: number }[];
  /** true si la suma de cargos/abonos leídos cuadra con los totales del banco. */
  cuadra?: boolean;
  avisos: string[];
}

export interface Respaldo {
  version: 1;
  exportado: string;
  cuentas: Cuenta[];
  movimientos: Movimiento[];
  estados: EstadoCuenta[];
  msi: CompraMSI[];
  prestamos: Prestamo[];
  deudores: Deudor[];
  ajustes: Ajustes;
  reglas: Regla[];
}
