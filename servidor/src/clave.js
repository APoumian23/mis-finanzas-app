// Contraseñas con scrypt (viene con Node: sin dependencias que compilar en el servidor).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 2 ** 15, R = 8, P = 1, LARGO = 64;
const derivar = (clave, sal, n = N, r = R, p = P) =>
  new Promise((ok, mal) => scrypt(clave.normalize("NFKC"), sal, LARGO, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? mal(e) : ok(k))));

/** "scrypt$N$r$p$sal$huella" (sal y huella en base64). */
export async function cifrar(clave) {
  const sal = randomBytes(16);
  const huella = await derivar(clave, sal);
  return ["scrypt", N, R, P, sal.toString("base64"), huella.toString("base64")].join("$");
}

export async function verificar(clave, guardado) {
  const [tipo, n, r, p, sal, huella] = String(guardado).split("$");
  if (tipo !== "scrypt") return false;
  const esperada = Buffer.from(huella, "base64");
  const calculada = await derivar(clave, Buffer.from(sal, "base64"), Number(n), Number(r), Number(p));
  return calculada.length === esperada.length && timingSafeEqual(calculada, esperada);
}

/** Para comparar en el mismo tiempo aunque el usuario no exista (no revelar qué usuarios hay). */
export const HASH_FALSO = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
