import { useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Aviso, Pantalla, Tarjeta, claseCampo } from "../componentes/ui";
import type { Datos } from "../hooks";
import { alcancePorBanco, calendarioDePagos, saldoPorFecha, type Alcance, type Evento, type FilaAlcance, type TipoEvento } from "../lib/calendario";
import { db } from "../lib/db";
import { aNumero, fechaCorta, hoyISO, pesos, pesosCorto, sumar } from "../lib/util";

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const COLOR: Record<TipoEvento, string> = {
  ingreso: "bg-bien", tarjeta: "bg-aviso", prestamo: "bg-acento", estimado: "bg-linea", pendiente: "bg-alerta",
};

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default function Calendario({ d }: { d: Datos }) {
  const hoy = hoyISO();
  const [soloMinimos, setSoloMinimos] = useState(false);
  const eventos = calendarioDePagos(d, hoy);
  const disponible = d.ajustes.disponible;
  const saldos = saldoPorFecha(eventos, disponible?.monto ?? 0, soloMinimos);
  const montoDe = (ev: Evento) => (soloMinimos && ev.minimo !== undefined ? -ev.minimo : ev.monto);
  const entra = sumar(eventos.filter((e) => e.monto > 0), (e) => e.monto);
  const sale = -sumar(eventos.filter((e) => e.monto < 0), montoDe);
  const alFinal = (disponible?.monto ?? 0) + entra - sale;
  const peor = [...saldos.entries()].reduce<[string, number] | null>((m, x) => (!m || x[1] < m[1] ? x : m), null);
  const hayMinimos = eventos.some((e) => e.minimo !== undefined);
  const sinDia = d.ajustes.ingresos.filter((i) => !i.dia && i.monto > 0);

  const porFecha = new Map<string, Evento[]>();
  for (const ev of eventos) porFecha.set(ev.fecha, [...(porFecha.get(ev.fecha) ?? []), ev]);
  const fin = eventos.at(-1)?.fecha ?? hoy;

  return (
    <Pantalla titulo="Calendario de pagos" atras="inicio" amplia>
      <AlcanceBancos filas={alcancePorBanco(d, hoy, disponible?.monto ?? 0)} hayDisponible={!!disponible} />
      <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-6">
        <div className="space-y-3 lg:sticky lg:top-6">
          <Tarjeta>
            <Disponible actual={disponible} hoy={hoy} />
          </Tarjeta>

          <Tarjeta>
            <p className="text-sm text-suave">Del {fechaCorta(hoy)} al {fechaCorta(fin)}</p>
            <div className="cifras mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">Entra</p><p className="font-bold text-bien">{pesosCorto(entra)}</p></div>
              <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">Sale</p><p className="font-bold">{pesosCorto(sale)}</p></div>
              <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">Te quedaría</p><p className={`font-bold ${alFinal < 0 ? "text-alerta" : "text-acento"}`}>{pesosCorto(alFinal)}</p></div>
            </div>
            {peor && peor[1] < 0 && (
              <div className="mt-3"><Aviso tipo="alerta">
                El {fechaCorta(peor[0])} te faltarían <strong className="cifras">{pesos(-peor[1])}</strong>{disponible ? "" : " (sin contar lo que tienes hoy)"}.
              </Aviso></div>
            )}
            {hayMinimos && (
              <label className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span>Ver pagando solo los mínimos</span>
                <input type="checkbox" className="size-5 accent-[var(--acento)]" checked={soloMinimos} onChange={(e) => setSoloMinimos(e.target.checked)} />
              </label>
            )}
            {soloMinimos && <p className="mt-1 text-xs text-suave">Con el mínimo evitas penalizaciones, pero lo que no pagas genera intereses el siguiente mes.</p>}
          </Tarjeta>

          {saldos.size > 1 && (
            <Tarjeta>
              <p className="mb-1 text-sm font-medium">Cómo se mueve tu dinero</p>
              <GraficaSaldo saldos={saldos} />
              <p className="mt-1 text-xs text-suave">{disponible ? "Lo que tendrías después de cada fecha." : "Sin contar lo que tienes hoy."} Abajo de la línea, no te alcanza.</p>
            </Tarjeta>
          )}

          {sinDia.length > 0 && (
            <Aviso tipo="info">
              {sinDia.map((i) => i.concepto).join(", ")} no tiene día: ponle el día en que te llega en <a href="#/ajustes" className="underline">Ajustes</a> para que entre aquí.
            </Aviso>
          )}
          <p className="px-1 text-xs text-suave">
            No incluye comida, gasolina ni tus gastos del día a día. Tus gastos fijos (escuela, suscripciones, seguro) casi todos se cobran a tus tarjetas: entran en sus estados de cuenta.
          </p>
        </div>

        <div className="mt-4 lg:mt-0">
          {eventos.length === 0 && <p className="py-8 text-center text-suave">No hay pagos ni ingresos en las próximas semanas.</p>}
          <ol className="space-y-3">
            {[...porFecha.entries()].map(([fecha, lista]) => {
              const enDias = diasEntre(hoy, fecha);
              const saldo = saldos.get(fecha) ?? 0;
              return (
                <li key={fecha}>
                  <Tarjeta className="p-0!">
                    <div className="flex items-baseline justify-between gap-2 border-b border-linea px-4 py-2.5">
                      <p className="font-semibold">
                        {enDias === 0 ? "Hoy" : <><span className="capitalize">{DIAS_SEMANA[new Date(`${fecha}T12:00:00`).getDay()]}</span> {fechaCorta(fecha)}</>}
                      </p>
                      <p className="text-xs text-suave">{enDias === 0 ? fechaCorta(fecha) : enDias === 1 ? "mañana" : `en ${enDias} días`}</p>
                    </div>
                    <ul className="px-4">
                      {lista.map((ev, i) => (
                        <li key={i} className="flex items-start gap-3 border-b border-linea py-2.5 last:border-0">
                          <i className={`mt-1.5 size-2.5 shrink-0 rounded-full ${COLOR[ev.tipo]}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className={`truncate ${ev.vencido ? "font-semibold text-alerta" : ""}`}>{ev.concepto}</p>
                            <p className="text-[13px] text-suave">
                              {ev.detalle ?? (ev.tipo === "ingreso" ? "Te llega" : ev.tipo === "prestamo" ? "Pago del préstamo" : "")}
                              {ev.minimo !== undefined && !soloMinimos ? (ev.minimo > 0 ? ` · mínimo ${pesos(ev.minimo)}` : " · el mínimo ya está cubierto") : ""}
                              {ev.minimo !== undefined && soloMinimos ? ` · total ${pesos(-ev.monto)}` : ""}
                            </p>
                          </div>
                          <p className={`cifras shrink-0 text-right font-semibold ${ev.monto > 0 ? "text-bien" : ""} ${ev.tipo === "estimado" ? "text-suave" : ""}`}>
                            {ev.monto > 0 ? "+" : "−"}{pesos(Math.abs(montoDe(ev)))}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-between rounded-b-2xl bg-hundido px-4 py-2 text-sm">
                      <span className="text-suave">Te quedarían</span>
                      <span className={`cifras font-semibold ${saldo < 0 ? "text-alerta" : ""}`}>{saldo < 0 ? "−" : ""}{pesos(Math.abs(saldo))}</span>
                    </div>
                  </Tarjeta>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Pantalla>
  );
}

const ETIQUETA: Record<Alcance, { texto: string; clase: string }> = {
  pagada: { texto: "Ya pagada", clase: "bg-hundido text-bien" },
  completa: { texto: "Alcanza", clase: "bg-hundido text-bien" },
  minimo: { texto: "Solo el mínimo", clase: "bg-aviso-suave text-aviso" },
  no: { texto: "No alcanza", clase: "bg-alerta-suave text-alerta" },
};

/** ¿Te alcanza para pagar cada tarjeta a tiempo? Una fila por banco, con su tasa y lo que te cobraría pagar solo el mínimo. */
function AlcanceBancos({ filas, hayDisponible }: { filas: FilaAlcance[]; hayDisponible: boolean }) {
  if (filas.length === 0) return null;
  return (
    <Tarjeta>
      <p className="font-semibold">¿Alcanza para cada banco?</p>
      <p className="text-xs text-suave">Con {hayDisponible ? "lo que tienes hoy y " : ""}tus ingresos en su día. Si no alcanza completa, se cuenta que pagas el mínimo.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {filas.map((f) => <FilaBanco key={`${f.cuentaId}-${f.fecha}`} f={f} />)}
      </ul>
      <p className="mt-3 text-xs text-suave">
        {hayDisponible ? "" : "Anota abajo cuánto tienes hoy: sin eso, se cuenta como si tuvieras $0. "}
        No incluye tu gasto del día a día ni los atrasos con tu familia. La tasa es la anual que cobra cada banco sobre lo que no pagas completo.
      </p>
    </Tarjeta>
  );
}

function FilaBanco({ f }: { f: FilaAlcance }) {
  const etiqueta = ETIQUETA[f.alcance];
  const cuando = f.vencido ? "Vencida" : `${f.alcance === "pagada" ? "Vencía" : "Vence"} ${fechaCorta(f.fecha)}${f.estimado ? " · próximo estado (estimado)" : ""}`;
  const entran = f.vencido ? "Ya venció y hoy no te entra dinero"
    : f.entran > 0 ? `De hoy al ${fechaCorta(f.fecha)} te entran ${pesos(f.entran)}` : "No te entra dinero antes de esa fecha";
  const sinMinimo = f.estimado ? "Aún no se sabe" : "Sin mínimo";
  let motivo = "";
  if (f.alcance === "completa") motivo = "Te alcanza para pagarla completa.";
  else if (f.alcance === "minimo") motivo = `${f.minimo ? "Te alcanza el mínimo" : "El mínimo ya está cubierto"}; completa te faltarían ${pesos(f.faltaria)}.`;
  else if (f.alcance === "no") motivo = `${entran}: te faltarían ${pesos(f.faltaria)} para ${f.minimo !== undefined ? "el mínimo" : f.estimado ? "pagarla" : "pagarla (no tiene mínimo)"}.`;
  return (
    <li className="rounded-xl border border-linea p-3">
      <div className="flex items-start justify-between gap-2">
        <p className={`min-w-0 font-medium ${f.vencido ? "text-alerta" : ""}`}>{f.concepto}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${etiqueta.clase}`}>{etiqueta.texto}</span>
      </div>
      <p className={`text-[13px] ${f.vencido ? "font-semibold text-alerta" : "text-suave"}`}>
        {cuando}{f.tasaAnual ? ` · tasa ${(f.tasaAnual * 100).toFixed(1)}% al año` : ""}
      </p>
      {f.alcance !== "pagada" && (
        <div className="cifras mt-2 grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-xs text-suave">Para no pagar intereses</p><p className="font-semibold">{pesos(f.falta)}</p></div>
          <div><p className="text-xs text-suave">Mínimo que falta</p>
            <p className="font-semibold">{f.minimo === undefined ? sinMinimo : f.minimo > 0 ? pesos(f.minimo) : "Ya cubierto"}</p></div>
        </div>
      )}
      {motivo && <p className="mt-2 text-[13px]">{motivo}</p>}
      {f.interesesSiMinimo !== undefined && f.alcance !== "completa" && (
        <p className="mt-1 text-[13px] text-aviso">Si pagas solo el mínimo: ≈ {pesos(f.interesesSiMinimo)} de intereses el siguiente mes.</p>
      )}
    </li>
  );
}

/** Línea del saldo fecha por fecha: arriba de cero en verde, abajo en rojo. */
function GraficaSaldo({ saldos }: { saldos: Map<string, number> }) {
  const datos = [...saldos.entries()].map(([fecha, saldo]) => ({ fecha: fechaCorta(fecha), saldo }));
  const max = Math.max(0, ...datos.map((x) => x.saldo));
  const min = Math.min(0, ...datos.map((x) => x.saldo));
  const corte = max - min > 0 ? max / (max - min) : 1; // dónde cae el cero en el degradado
  const ultimo = datos[datos.length - 1];
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos} margin={{ top: 18, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="relleno-saldo" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--acento)" stopOpacity={0.35} />
              <stop offset={corte} stopColor="var(--acento)" stopOpacity={0.1} />
              <stop offset={corte} stopColor="var(--alerta)" stopOpacity={0.1} />
              <stop offset={1} stopColor="var(--alerta)" stopOpacity={0.35} />
            </linearGradient>
            <linearGradient id="linea-saldo" x1="0" y1="0" x2="0" y2="1">
              <stop offset={corte} stopColor="var(--acento)" />
              <stop offset={corte} stopColor="var(--alerta)" />
            </linearGradient>
          </defs>
          <XAxis dataKey="fecha" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "var(--suave)" }} />
          <YAxis hide domain={[min * 1.1, max * 1.1 || 1]} />
          <ReferenceLine y={0} stroke="var(--suave)" strokeDasharray="4 4" />
          <Area type="stepAfter" dataKey="saldo" stroke="url(#linea-saldo)" strokeWidth={2.5} fill="url(#relleno-saldo)" isAnimationActive={false}
            dot={false} activeDot={{ r: 5 }} />
          <Tooltip formatter={(v) => pesos(Number(v))} labelFormatter={(l) => String(l)}
            contentStyle={{ background: "var(--superficie)", border: "1px solid var(--linea)", borderRadius: 12, fontSize: 13 }} />
        </AreaChart>
      </ResponsiveContainer>
      <span className="sr-only">Al final quedarías en {pesos(ultimo.saldo)}</span>
    </div>
  );
}

/** Lo que tienes hoy en tu cuenta o en efectivo: es el punto de partida del calendario. */
function Disponible({ actual, hoy }: { actual?: { monto: number; fecha: string }; hoy: string }) {
  const [texto, setTexto] = useState(actual ? String(actual.monto) : "");
  const [guardado, setGuardado] = useState(false);
  async function guardar() {
    const monto = aNumero(texto);
    const ajustes = await db.ajustes.get("ajustes");
    if (!ajustes) return;
    await db.ajustes.put({ ...ajustes, disponible: { monto, fecha: hoy } });
    setGuardado(true);
    setTimeout(() => setGuardado(false), 1500);
  }
  const viejo = actual && actual.fecha < hoy;
  return (
    <div>
      <label className="text-sm font-medium" htmlFor="disponible">¿Cuánto tienes hoy en tu cuenta y en efectivo?</label>
      <div className="mt-2 flex gap-2">
        <input id="disponible" className={claseCampo} inputMode="decimal" placeholder="$" value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()} />
        <button onClick={guardar} className="shrink-0 rounded-xl bg-acento px-4 font-semibold text-white dark:text-black">{guardado ? "✓" : "Listo"}</button>
      </div>
      <p className={`mt-1.5 text-xs ${viejo ? "text-aviso" : "text-suave"}`}>
        {!actual ? "Con esto el calendario te dice cuánto te quedaría después de cada pago."
          : viejo ? `Lo anotaste el ${fechaCorta(actual.fecha)}: actualízalo para que las cuentas salgan bien.`
          : "Sin tarjetas de crédito: solo el dinero que tienes disponible."}
      </p>
    </div>
  );
}
