// Crea tu usuario o le cambia la contraseña. Se corre en el servidor y la contraseña se escribe ahí mismo:
//   cd /var/www/finanzas-api && node --env-file=.env src/crear-usuario.js
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import postgres from "postgres";
import { cifrar } from "./clave.js";

// Lo que escribes en la contraseña no se muestra en pantalla
let silencio = false;
const salida = new Writable({ write(chunk, _enc, listo) { if (!silencio) process.stdout.write(chunk); listo(); } });
const rl = createInterface({ input: process.stdin, output: salida, terminal: true });
// readline escribe la pregunta y luego se calla (si es contraseña), así la pregunta sí se ve pero lo que escribes no
const preguntar = (texto, oculto = false) => new Promise((ok) => {
  rl.question(texto, (r) => { silencio = false; if (oculto) process.stdout.write("\n"); ok(r); });
  silencio = oculto;
});

// Usuario: letras (con acentos y ñ), números, punto, guion, guion bajo o @ (puede ser tu correo). Sin espacios.
const USUARIO = /^[\p{L}\p{N}._@-]{3,60}$/u;
let usuario = "";
while (!USUARIO.test(usuario)) {
  if (usuario) console.log("  Ese usuario no sirve: usa letras, números, punto, guion, guion bajo o @, sin espacios (3 a 60).");
  usuario = (await preguntar("Usuario: ")).trim().toLowerCase();
}
// Contraseña: mínimo 8 caracteres (letras mayúsculas, minúsculas y números, como quieras combinarlos)
let clave = "";
for (;;) {
  clave = await preguntar("Contraseña (mínimo 8 caracteres): ", true);
  if (clave.length < 8) { console.log(`  Tiene ${clave.length} caracteres; necesita al menos 8.`); continue; }
  if ((await preguntar("Repítela: ", true)) !== clave) { console.log("  No coinciden, intenta de nuevo."); continue; }
  break;
}
rl.close();

const sql = postgres(process.env.DATABASE_URL);
const hash = await cifrar(clave);
await sql`INSERT INTO usuarios (usuario, hash) VALUES (${usuario}, ${hash}) ON CONFLICT (usuario) DO UPDATE SET hash = excluded.hash`;
// Cambiar la contraseña cierra las sesiones abiertas en otros dispositivos
await sql`DELETE FROM sesiones WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = ${usuario})`;
await sql.end();
console.log(`Listo: el usuario "${usuario}" ya puede entrar.`);
