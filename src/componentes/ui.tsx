import { useEffect, type ReactNode } from "react";
import { hayHistorialPropio } from "../hooks";
import { nombreMes, sumarMeses } from "../lib/util";

export function Pantalla({ titulo, accion, children, atras, amplia }: {
  titulo: string; accion?: ReactNode; children: ReactNode; atras?: string; amplia?: boolean;
}) {
  // En computadora el menú va a un lado (no abajo) y las pantallas con gráficas usan dos columnas
  const ancho = amplia ? "max-w-2xl md:max-w-3xl lg:max-w-6xl" : "max-w-2xl lg:max-w-4xl";
  return (
    <div className={`mx-auto ${ancho} px-4 pb-28 pt-seguro md:px-6 lg:px-8 lg:pb-12 lg:pt-6`}>
      <header className="flex items-center gap-2 py-3">
        {atras && (
          <a href={`#/${atras}`} className="-ml-2 rounded-full p-2 text-acento" aria-label="Regresar"
            onClick={(e) => { if (hayHistorialPropio()) { e.preventDefault(); window.history.back(); } }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </a>
        )}
        <h1 className="flex-1 text-[26px] font-bold tracking-tight">{titulo}</h1>
        {accion}
      </header>
      {children}
    </div>
  );
}

export function Tarjeta({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Etiqueta = onClick ? "button" : "section";
  return (
    <Etiqueta onClick={onClick} className={`block w-full rounded-2xl bg-superficie p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${onClick ? "active:scale-[0.99] transition" : ""} ${className}`}>
      {children}
    </Etiqueta>
  );
}

export function Titulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-suave">{children}</h2>
      {extra}
    </div>
  );
}

export function Boton({ children, onClick, tipo = "primario", className = "", deshabilitado, submit }: {
  children: ReactNode; onClick?: () => void; tipo?: "primario" | "secundario" | "peligro"; className?: string;
  deshabilitado?: boolean; submit?: boolean;
}) {
  const estilos = {
    primario: "bg-acento text-white dark:text-black",
    secundario: "bg-hundido text-tinta",
    peligro: "bg-alerta-suave text-alerta",
  }[tipo];
  return (
    <button type={submit ? "submit" : "button"} disabled={deshabilitado} onClick={onClick}
      className={`min-h-11 rounded-xl px-4 py-2.5 font-semibold transition active:opacity-80 disabled:opacity-40 ${estilos} ${className}`}>
      {children}
    </button>
  );
}

/** Panel que sube desde abajo (como las hojas de iOS). */
export function Hoja({ abierta, onCerrar, titulo, children }: {
  abierta: boolean; onCerrar: () => void; titulo: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!abierta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = previo; window.removeEventListener("keydown", esc); };
  }, [abierta, onCerrar]);
  if (!abierta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <button className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={onCerrar} />
      <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-fondo px-4 pb-seguro pt-3 sm:rounded-3xl">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-linea sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button onClick={onCerrar} className="rounded-full bg-hundido px-3 py-1 text-sm font-semibold text-suave">Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="mb-3 block min-w-0">
      <span className="mb-1 block px-1 text-[13px] font-medium text-suave">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block px-1 text-xs text-suave">{ayuda}</span>}
    </label>
  );
}

export const claseCampo = "w-full rounded-xl border border-linea bg-superficie px-3 py-2.5 outline-none focus:border-acento";

/** Barra de progreso: gastado contra el límite; se pone roja si te pasas. */
export function Barra({ valor, maximo, alto = "h-2.5" }: { valor: number; maximo: number; alto?: string }) {
  const pct = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : valor > 0 ? 100 : 0;
  const color = maximo <= 0 || valor > maximo ? "bg-alerta" : pct > 85 ? "bg-aviso" : "bg-acento";
  return (
    <div className={`w-full overflow-hidden rounded-full bg-hundido ${alto}`}>
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Fila({ izquierda, derecha, sub, onClick }: { izquierda: ReactNode; derecha?: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const contenido = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate">{izquierda}</div>
        {sub && <div className="truncate text-[13px] text-suave">{sub}</div>}
      </div>
      {derecha && <div className="cifras shrink-0 text-right">{derecha}</div>}
    </>
  );
  const clase = "flex w-full items-center gap-3 border-b border-linea py-3 text-left last:border-0";
  return onClick ? <button onClick={onClick} className={clase}>{contenido}</button> : <div className={clase}>{contenido}</div>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-2 py-8 text-center text-suave">{children}</p>;
}

export function Aviso({ children, tipo = "aviso" }: { children: ReactNode; tipo?: "aviso" | "alerta" | "info" }) {
  const c = { aviso: "bg-aviso-suave text-aviso", alerta: "bg-alerta-suave text-alerta", info: "bg-acento-suave text-acento" }[tipo];
  return <div className={`rounded-xl px-3 py-2.5 text-sm font-medium ${c}`}>{children}</div>;
}

/** Mes que se está viendo, con flechas grandes para cambiar. */
export function SelectorMes({ mes, setMes }: { mes: string; setMes: (m: string) => void }) {
  const flecha = (paso: number, texto: string, d: string) => (
    <button onClick={() => setMes(sumarMeses(mes, paso))} className="flex size-11 items-center justify-center rounded-full bg-hundido text-tinta active:scale-95 transition" aria-label={texto}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
    </button>
  );
  return (
    <div className="mb-3 flex items-center justify-between">
      {flecha(-1, "Mes anterior", "m15 18-6-6 6-6")}
      <span className="text-lg font-semibold capitalize">{nombreMes(mes)}</span>
      {flecha(1, "Mes siguiente", "m9 18 6-6-6-6")}
    </div>
  );
}

/** Medio círculo: cuánto llevas gastado de lo que te alcanza (verde, amarillo cerca del límite, rojo si te pasas). */
export function Medidor({ gastado, limite }: { gastado: number; limite: number }) {
  // Sin nada para gastar (el mes empezó abajo por lo del mes anterior) no hay porcentaje que mostrar: arco lleno en rojo
  const sinMargen = limite <= 0;
  const pct = sinMargen ? 1.01 : gastado / limite;
  const largo = Math.PI * 90;
  const color = pct > 1 ? "var(--alerta)" : pct > 0.85 ? "var(--aviso)" : "var(--acento)";
  return (
    <svg viewBox="0 0 200 108" className="mx-auto block w-full max-w-[260px]" role="img"
      aria-label={sinMargen ? "Este mes no te queda margen para tus cosas" : `Llevas ${Math.round(pct * 100)}% de lo que te alcanza este mes`}>
      <path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke="var(--hundido)" strokeWidth="16" strokeLinecap="round" />
      <path d="M14 100 A86 86 0 0 1 186 100" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
        strokeDasharray={`${Math.min(1, pct) * largo * (86 / 90)} ${largo}`} />
      <text x="100" y="98" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--suave)">{sinMargen ? "Sin margen" : `${Math.round(pct * 100)}% usado`}</text>
    </svg>
  );
}

/** Anillo de avance (préstamos): cuánto llevas pagado del total, con el porcentaje al centro. */
export function Anillo({ valor, maximo, tam = 56 }: { valor: number; maximo: number; tam?: number }) {
  const pct = maximo > 0 ? Math.max(0, Math.min(1, valor / maximo)) : 0;
  const r = 22, largo = 2 * Math.PI * r;
  return (
    <svg width={tam} height={tam} viewBox="0 0 56 56" className="shrink-0" role="img" aria-label={`${Math.round(pct * 100)}% pagado`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--hundido)" strokeWidth="7" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--acento)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${pct * largo} ${largo}`} transform="rotate(-90 28 28)" />
      <text x="28" y="32.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--tinta)">{Math.round(pct * 100)}%</text>
    </svg>
  );
}
