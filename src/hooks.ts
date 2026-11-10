import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { AJUSTES_INICIALES, db } from "./lib/db";

/** Todos los datos, en vivo: cualquier cambio en la base se refleja solo. */
export function useDatos() {
  return useLiveQuery(async () => {
    const [cuentas, movimientos, estados, msi, prestamos, deudores, ajustes] = await Promise.all([
      db.cuentas.toArray(), db.movimientos.toArray(), db.estados.toArray(), db.msi.toArray(),
      db.prestamos.toArray(), db.deudores.toArray(), db.ajustes.get("ajustes"),
    ]);
    return { cuentas, movimientos, estados, msi, prestamos, deudores, ajustes: ajustes ?? AJUSTES_INICIALES };
  }, []);
}
export type Datos = NonNullable<ReturnType<typeof useDatos>>;

/** Tú, las personas que te deben y cualquiera que ya aparezca como responsable de un gasto. */
export function personasDe(d: Datos): string[] {
  return [...new Set(["Yo", ...d.deudores.map((x) => x.nombre), ...d.msi.map((x) => x.responsable), ...d.movimientos.map((x) => x.responsable)])];
}

let navegaciones = 0;
/** ¿Ya se navegó dentro de la app? Entonces "regresar" puede volver a la pantalla anterior. */
export const hayHistorialPropio = () => navegaciones > 0;

/** Navegación por hash (#/movimientos) para que funcione el gesto de regresar en iPhone. */
export function useRuta(): [string, (r: string) => void] {
  const leer = () => window.location.hash.replace(/^#\/?/, "") || "inicio";
  const [ruta, setRuta] = useState(leer);
  useEffect(() => {
    const f = () => { navegaciones++; setRuta(leer()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return [ruta, (r) => { window.location.hash = `/${r}`; }];
}
