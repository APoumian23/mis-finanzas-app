export type Tema = "claro" | "oscuro" | "auto";

const CLAVE = "tema";

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === "oscuro" || t === "auto" ? t : "claro";
  } catch {
    return "claro";
  }
}

const esOscuro = (t: Tema) => t === "oscuro" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

/** Aplica el tema en <html> y en la barra de estado del teléfono. */
export function aplicarTema(t: Tema = temaGuardado()): void {
  document.documentElement.dataset.tema = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", esOscuro(t) ? "#101211" : "#f4f5f2");
}

export function cambiarTema(t: Tema): void {
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento local: solo dura esta visita */ }
  aplicarTema(t);
}

// En "automático", si el teléfono cambia de claro a oscuro, la barra de estado lo sigue
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => aplicarTema());
