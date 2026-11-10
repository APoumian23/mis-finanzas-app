import { useEffect, useState, type ReactNode } from "react";
import EditorMovimiento from "./componentes/EditorMovimiento";
import { Pantalla } from "./componentes/ui";
import { useDatos, useRuta } from "./hooks";
import Ajustes from "./pantallas/Ajustes";
import Bienvenida from "./pantallas/Bienvenida";
import Calendario from "./pantallas/Calendario";
import Cuenta from "./pantallas/Cuenta";
import Cuentas from "./pantallas/Cuentas";
import Estados from "./pantallas/Estados";
import Graficas from "./pantallas/Graficas";
import Inicio from "./pantallas/Inicio";
import Mas from "./pantallas/Mas";
import MesesSinIntereses from "./pantallas/MesesSinIntereses";
import Movimientos from "./pantallas/Movimientos";
import PorCobrar from "./pantallas/PorCobrar";
import Prestamos from "./pantallas/Prestamos";

const icono = (d: string) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const PESTANAS: { ruta: string; nombre: string; icono: ReactNode; activas: string[] }[] = [
  { ruta: "inicio", nombre: "Inicio", icono: icono("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"), activas: ["inicio"] },
  { ruta: "movimientos", nombre: "Movimientos", icono: icono("M4 6h16M4 12h16M4 18h10"), activas: ["movimientos"] },
  { ruta: "graficas", nombre: "Gráficas", icono: icono("M4 20V10m6 10V4m6 16v-7m4 7H2"), activas: ["graficas"] },
  { ruta: "mas", nombre: "Más", icono: icono("M5 12h.01M12 12h.01M19 12h.01"), activas: ["mas", "estados", "prestamos", "por-cobrar", "meses", "ajustes", "cuentas", "calendario", "cuenta"] },
];

function useVersionNueva(): (() => void) | null {
  const [actualizar, setActualizar] = useState<(() => void) | null>(null);
  useEffect(() => {
    const f = (e: Event) => setActualizar(() => (e as CustomEvent<() => void>).detail);
    window.addEventListener("version-nueva", f);
    return () => window.removeEventListener("version-nueva", f);
  }, []);
  return actualizar;
}

export default function App() {
  const d = useDatos();
  const [ruta, ir] = useRuta();
  const actualizar = useVersionNueva();
  if (!d) return null;
  if (d.cuentas.length === 0) return <Bienvenida />;

  const [nombre, consulta = ""] = ruta.split("?");
  const params = new URLSearchParams(consulta);
  const regresar = () => (window.history.length > 1 ? window.history.back() : ir("inicio"));

  const pantallas: Record<string, ReactNode> = {
    inicio: <Inicio d={d} />,
    movimientos: <Movimientos key={consulta} d={d} params={params} />,
    graficas: <Graficas d={d} />,
    mas: <Mas d={d} />,
    estados: <Estados d={d} />,
    prestamos: <Prestamos d={d} />,
    "por-cobrar": <PorCobrar d={d} />,
    meses: <MesesSinIntereses d={d} />,
    ajustes: <Ajustes d={d} />,
    cuentas: <Cuentas d={d} />,
    calendario: <Calendario d={d} />,
    cuenta: <Cuenta />,
    agregar: (
      <Pantalla titulo="Anotar" atras="inicio">
        <EditorMovimiento d={d} alTerminar={regresar} />
      </Pantalla>
    ),
  };

  return (
    <>
      {actualizar && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-seguro">
          <button onClick={actualizar} className="rounded-full bg-tinta px-4 py-2 text-sm font-semibold text-fondo shadow-lg">
            Hay una versión nueva · Actualizar
          </button>
        </div>
      )}
      <MenuLateral nombre={nombre} />
      <main className="lg:pl-64">{pantallas[nombre] ?? pantallas.inicio}</main>
      {nombre !== "agregar" && (
        <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden border-t border-linea bg-superficie/90 backdrop-blur pb-seguro" aria-label="Secciones">
          <div className="mx-auto flex max-w-2xl items-end justify-around px-2 pt-1.5">
            {PESTANAS.slice(0, 2).map((p) => <Pestana key={p.ruta} p={p} activa={p.activas.includes(nombre)} />)}
            <a href="#/agregar" aria-label="Anotar gasto" className="-mt-6 flex size-16 items-center justify-center rounded-full bg-acento text-4xl font-light text-white shadow-lg active:scale-95 transition dark:text-black">+</a>
            {PESTANAS.slice(2).map((p) => <Pestana key={p.ruta} p={p} activa={p.activas.includes(nombre)} />)}
          </div>
        </nav>
      )}
    </>
  );
}

const SECCIONES: { ruta: string; nombre: string; icono: ReactNode }[] = [
  { ruta: "calendario", nombre: "Calendario de pagos", icono: icono("M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2") },
  { ruta: "estados", nombre: "Estados de cuenta", icono: icono("M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6") },
  { ruta: "prestamos", nombre: "Préstamos", icono: icono("M3 10h18M5 10V20M19 10V20M9 10v10M15 10v10M3 20h18M12 3l9 5H3z") },
  { ruta: "por-cobrar", nombre: "Te deben", icono: icono("M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.75") },
  { ruta: "meses", nombre: "Compras a meses", icono: icono("M4 5h16v15H4zM4 10h16M9 3v4M15 3v4") },
  { ruta: "cuentas", nombre: "Cuentas y tarjetas", icono: icono("M3 6h18v12H3zM3 10h18M7 15h4") },
  { ruta: "ajustes", nombre: "Ingresos y ajustes", icono: icono("M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4") },
  { ruta: "cuenta", nombre: "Tu cuenta", icono: icono("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0") },
  { ruta: "mas", nombre: "Respaldo", icono: icono("M12 3v12M7 10l5 5 5-5M5 21h14") },
];

/** En computadora: menú fijo a la izquierda en lugar de la barra de abajo. */
function MenuLateral({ nombre }: { nombre: string }) {
  const enlace = (ruta: string, texto: string, ic: ReactNode, activa: boolean) => (
    <a key={ruta} href={`#/${ruta}`} aria-current={activa ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition ${activa ? "bg-acento-suave text-acento" : "text-suave hover:bg-hundido hover:text-tinta"}`}>
      <span className="[&_svg]:size-5">{ic}</span>{texto}
    </a>
  );
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-1 overflow-y-auto border-r border-linea bg-superficie px-4 py-6 lg:flex" aria-label="Secciones">
      <a href="#/inicio" className="mb-5 flex items-center gap-2.5 px-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-acento text-lg font-bold text-white dark:text-black">$</span>
        <span className="text-lg font-bold tracking-tight">Mis Finanzas</span>
      </a>
      <a href="#/agregar" className="mb-4 rounded-xl bg-acento px-4 py-2.5 text-center font-semibold text-white dark:text-black">+ Anotar un gasto</a>
      {PESTANAS.slice(0, 3).map((p) => enlace(p.ruta, p.nombre, p.icono, p.ruta === nombre))}
      <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-suave">Tu dinero</p>
      {SECCIONES.map((p) => enlace(p.ruta, p.nombre, p.icono, p.ruta === nombre))}
    </aside>
  );
}

function Pestana({ p, activa }: { p: (typeof PESTANAS)[number]; activa: boolean }) {
  return (
    <a href={`#/${p.ruta}`} className={`flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-xs font-semibold ${activa ? "text-acento" : "text-suave"}`} aria-current={activa ? "page" : undefined}>
      <span className="[&_svg]:size-[26px]">{p.icono}</span>{p.nombre}
    </a>
  );
}
