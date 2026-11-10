import type { Categoria, Movimiento, Regla, TipoGasto } from "./tipos";

/** Descripción → clave estable para aprender: sin "05 DE 12", sin números de sucursal, sin acentos. */
export function normalizar(descripcion: string): string {
  return descripcion
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(APP [^)]*\)/g, "")
    .replace(/;.*$/, "")
    .replace(/^\s*\d{1,3}\s+DE\s+\d{1,3}\s+/, "")
    .replace(/\s+\d{1,3}\s+DE\s+\d{1,3}\b/g, "")
    .replace(/[0-9]+/g, " ")
    .replace(/[^A-Z*&. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RECURRENTES = new Set(["Educación", "Suscripciones digitales", "Telefonía", "Seguros"]);
const HORMIGA_SI_CHICO = new Set([
  "Comida fuera y bares", "Farmacia y salud", "Transporte (Uber/Didi/bus)", "Otros / sin identificar",
]);

/** "Familia - Papá" o "Por cobrar - Ana" → el gasto es de esa persona. */
function responsableDe(categoria: string): string | undefined {
  return /^(?:Familia|Por cobrar) - (.+)$/.exec(categoria)?.[1];
}

// Orden importa: la primera que coincide gana. Palabras con \b para no atrapar pedazos
// ("ADO" dentro de "MERCADO", "MOBIL" dentro de "INMOBILIARIA", "IVA" dentro de "OLIVA").
// Solo comercios y términos genéricos: lo propio de cada quien lo aprenden las reglas del historial.
const PALABRAS: [RegExp, Categoria][] = [
  [/\bINTERES|\bIVA\b|\bCOMISION(?! FEDERAL)|PENALIZACION|\bANUALIDAD|GASTOS DE COBRANZA|MORATORIO|LATE PAYMENT FEE/, "Intereses y comisiones"],
  [/^BON\b|BONIF|REEMBOLSO|DEVOLUCION|CASHBACK|^ABONO BBVA/, "Reembolsos y puntos"],
  [/PAGO TDC|SU ABONO|SU PAGO|GRACIAS|PAGOS? INTERBANCARIOS?|PAGO RECIBIDO|BMOVIL\.PAGO|PAGO DE TARJETA|TRANSFER RECEIVED|^TO MXN$|FONDOS EXCEDENTES/, "Pago a tarjeta"],
  [/PLATZI|COURSERA|UDEMY|\bALURA\b|COLEGIATURA/, "Educación"],
  [/CLAUDE|ANTHROPIC|OPENAI|CHATGPT|APPLE\.COM|ICLOUD|NETFLIX|SPOTIFY|DISNEY|\bHBO\b|MAX\.COM|YOUTUBE|GOOGLE \*|HOSTINGER|PRIME VIDEO|PREMIUM PLAN FEE|\bSUNO\b|OBSIDIAN|CODA\.CO/, "Suscripciones digitales"],
  [/TELCEL|AT&T|MOVISTAR|\bBAIT\b|MIBAIT|TELMEX|\bIZZI\b|TOTALPLAY|MEGACABLE/, "Telefonía"],
  [/QUALITAS|SEGURO|\bGNP\b|\bAXA\b|MAPFRE/, "Seguros"],
  [/OXXO GAS|PEMEX|GASOLIN|\bG500\b|\bBP\b|\bSHELL\b|\bMOBIL\b|AUTOZONE|LLANTA|VERIFICENTRO|CASETA|PEAJE|ESTACIONAMIENTO|PARKING|\bESTTO\b|NOVOGAS|\bGASOL\b|^GAS (?:SERV|SAN)\b/, "Gasolina y auto"],
  [/\bOXXO\b|7 ELEVEN|\bSEVEN\b|KIOSKO|MODELORAMA|CIRCLE K|\bEXTRA\b|\bSIX\b/, "OXXO y tiendas de conveniencia"],
  // Comida a domicilio antes que transporte (DIDI FOOD, UBER EATS)
  [/\bREST|PIZZA|\bSBX\b|\bDQ\b|BURGER|\bKFC\b|\bCAFE|STARBUCKS|\bTACOS?\b|\bBAR\b|POLLO|LITTLE CAESARS|DOMINO|SUSHI|CARLS|MCDONALD|SUBWAY|WINGS|BIRRIA|TORTA|RAPPI|DIDI FOOD|UBER EATS/, "Comida fuera y bares"],
  [/\bUBER\b|\bDIDI\b|CABIFY|\bETN\b|PRIMERA PLUS|\bADO\b|MUEVE CIUDAD|METRO CDMX|AUTOBUSES/, "Transporte (Uber/Didi/bus)"],
  [/FARMACIA|\bFARM|FAR GUAD|SIMILARES|BENAVIDES|DEL AHORRO|SAN PABLO|CLINICA|HOSPITAL|LABORATORIO|DOCTOR|DENTAL|OPTICA/, "Farmacia y salud"],
  [/COSTCO|SORIANA|BODEGA|CHEDRAUI|SUPERAMA|LA COMER|CITY MARKET|\bHEB\b|\bSAMS\b|\bSUPER\b|ALSUPER|WALMART(?! VENTA)/, "Súper y despensa"],
  [/CINEPOLIS|CINEMEX|TICKETMASTER|BOLETIA|DIVERSIONES|STEAM|PLAYSTATION|XBOX|NINTENDO|BOLICHE|APP TICKETS|APP FOODS/, "Entretenimiento"],
  [/MASCOTA|CROQUET|CROQUER|PETCO|\bPET\b|VETERINAR/, "Mascotas"],
  [/HOTEL|AIRBNB|VIVA ?AEROBUS|VOLARIS|AEROMEXICO|BOOKING|EXPEDIA/, "Viajes y hospedaje"],
  [/AMAZON|MERCADO ?LIBRE|MERPAGO\*MERCADOLIBRE|SHEIN|TEMU|ALIEXPRESS|LIVERPOOL|COPPEL/, "Compras en línea"],
  [/HOME DEPOT|OFFICE DEPOT|OFFICEMAX|\bCFE\b|COMISION FEDERAL|JUMAPA|\bAGUA\b|INMOBILIARIA|FERRET|IMPERMEA/, "Hogar, oficina y servicios"],
];

/** Tipo según la categoría y el monto (mismas reglas que el Excel). */
export function tipoPara(categoria: Categoria, monto: number, descripcion = ""): TipoGasto {
  if (categoria === "Informativo (no suma)") return "Informativo";
  if (categoria === "Pago a tarjeta") return "Pago";
  if (categoria === "Reembolsos y puntos" || monto < 0) return "Abono";
  if (categoria === "Intereses y comisiones") return "Fuga financiera";
  if (/^\s*\d{1,3}\s+DE\s+\d{1,3}\b/i.test(descripcion) || categoria === "Compras a meses (propias)") return "A meses (MSI)";
  if (RECURRENTES.has(categoria)) return "Recurrente";
  if (categoria === "OXXO y tiendas de conveniencia") return "Hormiga";
  if (HORMIGA_SI_CHICO.has(categoria) && monto < 150) return "Hormiga";
  if (monto >= 1000) return "Gasto fuerte";
  return "Variable";
}

type Coincidencia = { regla: Regla; por: "exacta" | "contiene" | "prefijo" };

function buscarRegla(clave: string, reglas: Map<string, Regla>, cuentaId?: string): Coincidencia | undefined {
  const aplica = (r: Regla | undefined) => r && (!r.cuentaId || r.cuentaId === cuentaId) ? r : undefined;
  const exacta = aplica(reglas.get(clave));
  if (exacta) return { regla: exacta, por: "exacta" };
  // Reglas puestas a propósito ("todo lo de CFE es de papá") ganan sobre las aprendidas por parecido
  for (const r of reglas.values()) {
    if (r.contiene && aplica(r) && ` ${clave} `.includes(` ${r.clave} `)) return { regla: r, por: "contiene" };
  }
  const palabras = clave.split(" ");
  for (let n = Math.min(3, palabras.length - 1); n >= 1; n--) {
    const prefijo = palabras.slice(0, n).join(" ");
    if (prefijo.length < 4) continue;
    for (const [k, r] of reglas) if (aplica(r) && (k === prefijo || k.startsWith(prefijo + " "))) return { regla: r, por: "prefijo" };
  }
  return undefined;
}

const ALTA_A_MESES = /\bA \d{1,2} MESES S\/I|ALTA PARA MESES|FINANC\. COMPRAS|\b00MSI\b|ADM\.TAR\.TIT\.|\bA MESES\s*$/;

export interface Clasificacion {
  categoria: Categoria;
  tipo: TipoGasto;
  responsable: string;
}

export function clasificar(descripcion: string, monto: number, reglas: Map<string, Regla>, cuentaId?: string): Clasificacion {
  const clave = normalizar(descripcion);
  const esMensualidad = /^\s*\d{1,3}\s+DE\s+\d{1,3}\b/i.test(descripcion);
  const encontrada = buscarRegla(clave, reglas, cuentaId);
  // Por parecido (mismo comercio, otra sucursal) solo se hereda la categoría si es tuya: que un OXXO
  // marcado una vez como de papá no vuelva de papá a todos los OXXO
  const deOtro = (r: Regla) => (r.responsable && r.responsable !== "Yo") || !!responsableDe(r.categoria);
  const regla = encontrada && !(encontrada.por === "prefijo" && deOtro(encontrada.regla)) ? encontrada.regla : undefined;
  // Alta de una compra a meses: el banco la pone como cargo, pero se paga por mensualidad
  if (!esMensualidad && ALTA_A_MESES.test(descripcion.toUpperCase())) {
    return { categoria: "Informativo (no suma)", tipo: "Informativo", responsable: regla?.responsable ?? "Yo" };
  }
  if (regla) {
    const tipo = esMensualidad && monto > 0 ? "A meses (MSI)" : regla.tipo ?? tipoPara(regla.categoria, monto, descripcion);
    return {
      categoria: regla.categoria,
      tipo: monto < 0 && tipo !== "Pago" ? "Abono" : tipo,
      responsable: regla.responsable ?? responsableDe(regla.categoria) ?? "Yo",
    };
  }
  const texto = descripcion.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let categoria: Categoria = "Otros / sin identificar";
  for (const [re, cat] of PALABRAS) {
    if (re.test(texto)) { categoria = cat; break; }
  }
  if (monto < 0 && categoria === "Otros / sin identificar") categoria = "Reembolsos y puntos";
  if (esMensualidad && monto > 0 && !RECURRENTES.has(categoria)) categoria = "Compras a meses (propias)";
  return {
    categoria,
    tipo: tipoPara(categoria, monto, descripcion),
    responsable: responsableDe(categoria) ?? "Yo",
  };
}

/** Reglas a partir del historial: para cada comercio, la categoría más usada. */
export function aprenderDeHistorial(movimientos: Movimiento[]): Regla[] {
  const conteo = new Map<string, Map<string, { n: number; r: Regla }>>();
  for (const m of movimientos) {
    if (m.tipo === "Informativo" || m.categoria === "Pago a tarjeta") continue;
    const clave = normalizar(m.descripcion);
    if (clave.length < 3) continue;
    const firma = `${m.categoria}|${m.responsable}`;
    const porClave = conteo.get(clave) ?? new Map();
    const actual = porClave.get(firma) ?? {
      n: 0,
      r: { clave, categoria: m.categoria, responsable: m.responsable, tipo: RECURRENTES.has(m.categoria) ? "Recurrente" : undefined },
    };
    actual.n++;
    porClave.set(firma, actual);
    conteo.set(clave, porClave);
  }
  return [...conteo.values()].map((porClave) => [...porClave.values()].sort((a, b) => b.n - a.n)[0].r);
}
