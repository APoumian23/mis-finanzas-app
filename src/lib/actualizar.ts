// Buscar e instalar una versión nueva de la app a mano (en el iPhone, desde la pantalla de inicio, no hay botón de recargar).

/** Cuándo se compiló esta versión (lo pone Vite al publicar). */
export const VERSION: string = __VERSION__;

let instalar: ((recargar?: boolean) => Promise<void>) | null = null;
export const guardarInstalador = (f: (recargar?: boolean) => Promise<void>) => { instalar = f; };

/**
 * - descargando: hay versión nueva pero sigue bajando (internet lento); cuando esté lista sale el aviso de arriba.
 * - sin-servicio: aquí no hay app guardada que revisar (modo privado, modo desarrollo o falló el registro).
 */
export type Resultado = "actualizada" | "descargando" | "al-dia" | "sin-conexion" | "sin-servicio";

/** Pregunta al servidor si hay versión nueva; si la hay y ya bajó, la instala y recarga la app. */
export async function buscarActualizacion(): Promise<Resultado> {
  if (navigator.onLine === false) return "sin-conexion";
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return "sin-servicio";
  try { await reg.update(); } catch { return "sin-conexion"; }
  // La versión nueva tarda un momento en bajarse: se espera hasta 10 s a que quede lista
  for (let i = 0; i < 40 && reg.installing && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
  if (reg.waiting) {
    if (instalar) await instalar(true);
    else { reg.waiting.postMessage({ type: "SKIP_WAITING" }); window.location.reload(); }
    return "actualizada";
  }
  // Sigue bajando: no es "ya estás al día". Cuando termine, main.tsx lanza el aviso "Hay una versión nueva".
  if (reg.installing) return "descargando";
  return "al-dia";
}
