import { useState, type ReactNode } from "react";
import type { Datos } from "../hooks";
import { estadoPrestamo, pagadoDe, tarjetasPorPagar, todosLosDeudores } from "../lib/calculos";
import { db } from "../lib/db";
import type { EstadoCuenta } from "../lib/tipos";
import { aNumero, fechaCorta, hoyISO, pesos, uid } from "../lib/util";
import { Boton, Hoja, claseCampo } from "./ui";

export const icono = (d: string, tam = 24) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const ICONOS = {
  tarjeta: "M3 6h18v12H3zM3 10h18M7 15h4",
  prestamo: "M3 10h18M5 10v9M19 10v9M9 10v9M15 10v9M3 20h18M12 3l9 5H3z",
  mePagaron: "M12 3v12M7 10l5 5 5-5M5 21h14",
  estado: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  calendario: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4",
  mas: "M12 5v14M5 12h14",
};

type Accion = "tarjeta" | "prestamo" | "mePagaron";

/** Botones grandes de lo que más se hace: anotar un gasto, un pago o que alguien te pagó. */
export function AccionesRapidas({ d }: { d: Datos }) {
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const boton = (accion: Accion | string, texto: string, ic: string) => {
    const clase = "flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-superficie px-1 py-2.5 text-center text-[13px] font-semibold leading-tight shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:scale-[0.97] transition";
    const contenido = <><span className="flex size-10 items-center justify-center rounded-full bg-acento-suave text-acento">{icono(ic, 22)}</span>{texto}</>;
    return accion.startsWith("#")
      ? <a key={texto} href={accion} className={clase}>{contenido}</a>
      : <button key={texto} className={clase} onClick={() => setAbierta(accion as Accion)}>{contenido}</button>;
  };
  return (
    <div>
      <a href="#/agregar" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-acento px-4 text-lg font-semibold text-white active:opacity-90 dark:text-black">
        {icono(ICONOS.mas, 22)} Anotar un gasto
      </a>
      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {boton("tarjeta", "Pagué una tarjeta", ICONOS.tarjeta)}
        {boton("prestamo", "Pagué un préstamo", ICONOS.prestamo)}
        {boton("mePagaron", "Me pagaron", ICONOS.mePagaron)}
        {boton("#/estados", "Subir estado", ICONOS.estado)}
      </div>
      <Hoja abierta={abierta === "tarjeta"} onCerrar={() => setAbierta(null)} titulo="¿Qué tarjeta pagaste?">
        {abierta === "tarjeta" && <PagoTarjeta d={d} cerrar={() => setAbierta(null)} />}
      </Hoja>
      <Hoja abierta={abierta === "prestamo"} onCerrar={() => setAbierta(null)} titulo="¿Qué préstamo pagaste?">
        {abierta === "prestamo" && <PagoPrestamo d={d} cerrar={() => setAbierta(null)} />}
      </Hoja>
      <Hoja abierta={abierta === "mePagaron"} onCerrar={() => setAbierta(null)} titulo="¿Quién te pagó?">
        {abierta === "mePagaron" && <MePagaron d={d} cerrar={() => setAbierta(null)} />}
      </Hoja>
    </div>
  );
}

/** Opción grande para elegir (tarjeta, préstamo o persona). */
function Opcion({ titulo, sub, derecha, onClick, alerta }: { titulo: string; sub?: ReactNode; derecha?: string; onClick: () => void; alerta?: boolean }) {
  return (
    <button onClick={onClick} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-superficie px-4 py-3 text-left active:scale-[0.99] transition">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{titulo}</span>
        {sub && <span className={`block text-sm ${alerta ? "font-semibold text-alerta" : "text-suave"}`}>{sub}</span>}
      </span>
      {derecha && <span className="cifras shrink-0 font-semibold">{derecha}</span>}
      <span className="text-suave" aria-hidden="true">›</span>
    </button>
  );
}

/**
 * Montos listos para tocar (mínimo, total, pago del mes…) o uno a mano, la fecha y el botón para guardar.
 * El botón dice exactamente qué se va a anotar.
 */
export function ElegirMonto({ opciones, verbo, alGuardar }: {
  opciones: { etiqueta: string; monto: number }[]; verbo: string; alGuardar: (monto: number, fecha: string) => Promise<void>;
}) {
  const validas = opciones.filter((o) => o.monto > 0.005);
  // Se recuerda por su nombre, no por su lugar: al guardar, la lista se recalcula (p. ej. el mínimo ya cubierto
  // desaparece) y una posición vieja apuntaría a nada.
  const [elegida, setElegida] = useState<string>(validas[0]?.etiqueta ?? "otra");
  const [otra, setOtra] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [guardando, setGuardando] = useState(false);
  const monto = elegida === "otra" ? aNumero(otra) : validas.find((o) => o.etiqueta === elegida)?.monto ?? 0;

  async function guardar() {
    if (!(monto > 0) || !fecha || guardando) return;
    setGuardando(true);
    try { await alGuardar(monto, fecha); } finally { setGuardando(false); }
  }

  return (
    <div>
      <div className="grid gap-2" role="radiogroup" aria-label="Cuánto">
        {validas.map((o) => (
          <button key={o.etiqueta} role="radio" aria-checked={elegida === o.etiqueta} onClick={() => setElegida(o.etiqueta)}
            className={`flex min-h-14 items-center justify-between rounded-2xl border-2 px-4 text-left transition ${elegida === o.etiqueta ? "border-acento bg-acento-suave" : "border-transparent bg-superficie"}`}>
            <span className="font-medium">{o.etiqueta}</span>
            <span className="cifras text-lg font-bold">{pesos(o.monto)}</span>
          </button>
        ))}
        <div className={`rounded-2xl border-2 px-4 py-2 transition ${elegida === "otra" ? "border-acento bg-acento-suave" : "border-transparent bg-superficie"}`}>
          <label className="flex items-center justify-between gap-3">
            <span className="font-medium">Otra cantidad</span>
            <input className={`${claseCampo} w-36! text-right text-lg font-semibold`} inputMode="decimal" placeholder="$0" value={otra}
              onFocus={() => setElegida("otra")} onChange={(e) => { setOtra(e.target.value); setElegida("otra"); }} />
          </label>
        </div>
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 px-1">
        <span className="text-sm text-suave">Fecha</span>
        <input type="date" className={`${claseCampo} w-auto!`} value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
      </label>
      <Boton className="mt-4 min-h-14 w-full text-lg" onClick={guardar} deshabilitado={!(monto > 0) || !fecha || guardando}>
        {monto > 0 ? `${verbo} ${pesos(monto)}` : "Elige cuánto"}
      </Boton>
    </div>
  );
}

export async function anotarPagoTarjeta(cuentaId: string, monto: number, fecha: string) {
  await db.movimientos.add({
    id: uid(), cuentaId, fecha, descripcion: "Pago a la tarjeta (capturado en la app)",
    monto: -monto, categoria: "Pago a tarjeta", tipo: "Pago", responsable: "Yo", origen: "manual", creado: Date.now(),
  });
}

/** Lo que te falta de mínimo en ese estado (0 si ya lo cubriste). */
export const minimoQueFalta = (e: EstadoCuenta, d: Datos) =>
  e.pagoMinimo === undefined ? undefined : Math.max(0, Math.round((e.pagoMinimo - pagadoDe(e, d.movimientos)) * 100) / 100);

export function PagoTarjeta({ d, cerrar, cuentaId }: { d: Datos; cerrar: () => void; cuentaId?: string }) {
  const hoy = hoyISO();
  const pendientes = tarjetasPorPagar(d.estados, d.movimientos, hoy);
  const [elegida, setElegida] = useState<string | null>(cuentaId ?? (pendientes.length === 1 ? pendientes[0].e.cuentaId : null));
  const nombre = new Map(d.cuentas.map((c) => [c.id, c.nombre]));
  const tarjeta = pendientes.find((x) => x.e.cuentaId === elegida);

  if (!elegida) {
    const otras = d.cuentas.filter((c) => c.tipo === "credito" && !c.archivada && !pendientes.some((x) => x.e.cuentaId === c.id));
    return (
      <div className="space-y-2">
        {pendientes.map(({ e, falta, vencido }) => (
          <Opcion key={e.id} titulo={nombre.get(e.cuentaId) ?? e.banco} derecha={pesos(falta)} alerta={vencido}
            sub={vencido ? "Vencida" : `Antes del ${fechaCorta(e.fechaLimite!)}`} onClick={() => setElegida(e.cuentaId)} />
        ))}
        {otras.map((c) => <Opcion key={c.id} titulo={c.nombre} sub="Sin pago pendiente" onClick={() => setElegida(c.id)} />)}
      </div>
    );
  }
  const minimo = tarjeta ? minimoQueFalta(tarjeta.e, d) : undefined;
  return (
    <div>
      <p className="mb-3 px-1 font-semibold">{nombre.get(elegida)}</p>
      <ElegirMonto verbo="Anotar pago de"
        opciones={tarjeta ? [
          { etiqueta: "Todo (sin intereses)", monto: tarjeta.falta },
          ...(minimo !== undefined && minimo < tarjeta.falta ? [{ etiqueta: "El mínimo", monto: minimo }] : []),
        ] : []}
        alGuardar={async (monto, fecha) => { await anotarPagoTarjeta(elegida, monto, fecha); cerrar(); }} />
    </div>
  );
}

function PagoPrestamo({ d, cerrar }: { d: Datos; cerrar: () => void }) {
  const hoy = hoyISO();
  const vivos = d.prestamos.map((p) => ({ p, e: estadoPrestamo(p, hoy) })).filter((x) => x.e.saldo > 0.01);
  const [id, setId] = useState<string | null>(vivos.length === 1 ? vivos[0].p.id : null);
  const actual = vivos.find((x) => x.p.id === id);
  if (!actual) {
    return (
      <div className="space-y-2">
        {vivos.map(({ p, e }) => (
          <Opcion key={p.id} titulo={p.nombre} alerta={e.atraso > 1}
            derecha={pesos(p.pagoMensual > 0 ? (p.quincenal ? p.pagoMensual / 2 : p.pagoMensual) : e.saldo)}
            sub={e.atraso > 1 ? `Te falta cubrir ${pesos(e.atraso)}` : p.pagoMensual <= 0 ? "Debes, sin pago fijo" : p.quincenal ? "Por quincena" : "Al mes"} onClick={() => setId(p.id)} />
        ))}
      </div>
    );
  }
  const { p, e } = actual;
  return (
    <div>
      <p className="mb-3 px-1 font-semibold">{p.nombre}</p>
      <ElegirMonto verbo="Anotar pago de"
        opciones={[
          ...(p.quincenal ? [{ etiqueta: "Una quincena", monto: Math.round(p.pagoMensual * 50) / 100 }] : []),
          { etiqueta: "El pago del mes", monto: p.pagoMensual },
          ...(p.pagoMensual <= 0 ? [{ etiqueta: "Todo lo que debes", monto: e.saldo }] : []),
          ...(e.atraso > 1 ? [{ etiqueta: "Lo que ya tocaba", monto: e.atraso }] : []),
        ]}
        alGuardar={async (monto, fecha) => { await db.prestamos.update(p.id, { pagos: [...p.pagos, { fecha, monto }] }); cerrar(); }} />
    </div>
  );
}

function MePagaron({ d, cerrar }: { d: Datos; cerrar: () => void }) {
  const lista = todosLosDeudores(d.deudores, d.movimientos, d.msi).lista.sort((a, b) => b.debeHoy - a.debeHoy);
  const [id, setId] = useState<string | null>(null);
  const actual = lista.find((c) => c.deudor.id === id);
  if (!actual) {
    return (
      <div className="space-y-2">
        {lista.map((c) => (
          <Opcion key={c.deudor.id} titulo={c.deudor.nombre} derecha={c.debeHoy > 0.5 ? pesos(c.debeHoy) : undefined}
            sub={c.debeHoy > 0.5 ? "Te debe hoy" : "Al corriente"} onClick={() => setId(c.deudor.id)} />
        ))}
        <a href="#/por-cobrar" className="block px-1 pt-2 text-sm font-semibold text-acento">¿No está en la lista? Agrégala en Te deben</a>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 px-1 font-semibold">{actual.deudor.nombre}</p>
      <ElegirMonto verbo="Anotar que te pagó"
        opciones={[{ etiqueta: "Todo lo que te debe", monto: actual.debeHoy }]}
        alGuardar={async (monto, fecha) => {
          await db.deudores.update(actual.deudor.id, { reembolsos: [...actual.deudor.reembolsos, { fecha, monto }] });
          cerrar();
        }} />
    </div>
  );
}
