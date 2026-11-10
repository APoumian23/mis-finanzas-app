import { Component, type ReactNode } from "react";

/**
 * Si una pantalla truena (p. ej. un respaldo con datos raros), en vez de quedar en blanco se ofrece
 * guardar un respaldo, volver al inicio o borrar los datos para empezar de nuevo.
 */
export default class ErrorDePantalla extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const boton = "w-full rounded-xl px-4 py-3 font-semibold";
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-5 pt-seguro pb-seguro">
        <h1 className="text-2xl font-bold">Algo salió mal</h1>
        <p className="text-suave">La pantalla no se pudo mostrar. Tus datos no se perdieron: siguen en este teléfono y, con tu cuenta, en tu servidor.</p>
        <p className="rounded-xl bg-hundido p-3 font-mono text-xs text-suave">{this.state.error.message}</p>
        <button className={`${boton} bg-acento text-white dark:text-black`} onClick={async () => (await import("../lib/exportar")).descargarRespaldo()}>
          Guardar un respaldo
        </button>
        <button className={`${boton} bg-hundido`} onClick={() => { window.location.hash = "/inicio"; window.location.reload(); }}>
          Volver al inicio
        </button>
        <button className={`${boton} bg-alerta-suave text-alerta`} onClick={async () => {
          if (!confirm("¿Borrar todos los datos de este teléfono? Guarda un respaldo antes.")) return;
          (await import("../lib/db")).borrarTodo().then(() => { window.location.hash = ""; window.location.reload(); });
        }}>
          Borrar los datos y empezar de nuevo
        </button>
      </div>
    );
  }
}
