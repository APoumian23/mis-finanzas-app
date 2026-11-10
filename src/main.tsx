import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import ErrorDePantalla from "./componentes/ErrorDePantalla";
import "./index.css";
import { guardarInstalador } from "./lib/actualizar";
import { instalarSync } from "./lib/sync";
import { aplicarTema } from "./lib/tema";

aplicarTema();
instalarSync(); // si entraste con tu cuenta, los cambios se suben y bajan solos

// Hay versión nueva: se avisa en vez de recargar sola (no corta un gasto a medio anotar ni un OCR)
const actualizar = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("version-nueva", { detail: () => actualizar(true) }));
  },
});
guardarInstalador(actualizar);
// En el iPhone la app instalada casi nunca se abre "desde cero": al volver a ella se revisa si hay versión nueva
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
});

// Que Safari/Chrome no borren los datos por falta de espacio o de uso
void navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorDePantalla>
      <App />
    </ErrorDePantalla>
  </StrictMode>,
);
