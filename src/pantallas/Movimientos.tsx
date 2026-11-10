import { useMemo, useState, type ReactNode } from "react";
import EditorMovimiento from "../componentes/EditorMovimiento";
import { Hoja, Pantalla, Tarjeta, Vacio, claseCampo } from "../componentes/ui";
import type { Datos } from "../hooks";
import { detalleMensualidad, diasDeCorte, mesContable, movimientosPorEstado, type GrupoEstado } from "../lib/calculos";
import { colorCategoria } from "../lib/colores";
import { todasLasCategorias, type Movimiento } from "../lib/tipos";
import { etiquetaMes, fechaCorta, hoyISO, mesDe, nombreMes, pesos, pesosCorto, sumar, sumarMeses } from "../lib/util";

type Vista = "mes" | "estado";

export default function Movimientos({ d, params }: { d: Datos; params: URLSearchParams }) {
  const [vista, setVista] = useState<Vista>(params.get("vista") === "estado" ? "estado" : "mes");
  const [mes, setMes] = useState(params.get("mes") ?? mesDe(hoyISO()));
  const [buscar, setBuscar] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [categoria, setCategoria] = useState(params.get("categoria") ?? "");
  const [persona, setPersona] = useState("");
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const nombreCuenta = new Map(d.cuentas.map((c) => [c.id, c.nombre]));
  const meses = Array.from({ length: 18 }, (_, i) => sumarMeses(mesDe(hoyISO()), 1 - i));

  // Los filtros (menos el mes) aplican igual en las dos vistas
  const pasa = useMemo(() => {
    const q = buscar.trim().toUpperCase();
    return (m: Movimiento) => (!cuenta || m.cuentaId === cuenta)
      && (!categoria || m.categoria === categoria)
      && (!persona || m.responsable === persona)
      && (!q || m.descripcion.toUpperCase().includes(q) || (m.nota ?? "").toUpperCase().includes(q));
  }, [cuenta, categoria, persona, buscar]);
  // "Por mes" cuenta como tu presupuesto: lo de tarjeta de crédito, en el mes de su corte
  const cortes = useMemo(() => diasDeCorte(d.estados), [d.estados]);
  const lista = useMemo(() => d.movimientos
    .filter((m) => (!mes || mesContable(m, cortes) === mes) && pasa(m))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado), [d.movimientos, mes, pasa, cortes]);
  const grupos = useMemo(() => movimientosPorEstado(d.estados, d.movimientos), [d.estados, d.movimientos]);
  const fila = (m: Movimiento) => <FilaMovimiento key={m.id} m={m} d={d} cuenta={nombreCuenta.get(m.cuentaId)} onClick={() => setEditando(m)} />;
  // Por estado de cuenta: ya no van agrupados por día, así que cada uno lleva su fecha
  const filaConFecha = (m: Movimiento) => <FilaMovimiento key={m.id} m={m} d={d} conFecha onClick={() => setEditando(m)} />;
  const filaConFechaYCuenta = (m: Movimiento) => <FilaMovimiento key={m.id} m={m} d={d} conFecha cuenta={nombreCuenta.get(m.cuentaId)} onClick={() => setEditando(m)} />;

  const porDia = new Map<string, Movimiento[]>();
  for (const m of lista) porDia.set(m.fecha, [...(porDia.get(m.fecha) ?? []), m]);
  const cargos = sumar(lista.filter((m) => m.monto > 0 && m.tipo !== "Informativo"), (m) => m.monto);
  const personas = [...new Set(d.movimientos.map((m) => m.responsable))];

  return (
    <Pantalla titulo="Movimientos">
      {/* "Todos" es la vista por mes sin mes elegido: todos tus movimientos, separados por mes */}
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-hundido p-1" role="tablist" aria-label="Cómo verlos">
        {([["mes", "Por mes"], ["todos", "Todos"], ["estado", "Por estado"]] as const).map(([v, texto]) => {
          const activa = v === "estado" ? vista === "estado" : vista === "mes" && (v === "todos") === (mes === "");
          return (
            <button key={v} role="tab" aria-selected={activa}
              onClick={() => {
                if (v === "estado") { setVista("estado"); return; }
                setVista("mes");
                setMes(v === "todos" ? "" : mes || mesDe(hoyISO()));
              }}
              className={`min-h-10 rounded-lg px-2 text-sm font-semibold ${activa ? "bg-superficie text-tinta shadow-sm" : "text-suave"}`}>{texto}</button>
          );
        })}
      </div>
      <input type="search" placeholder="Buscar (OXXO, Amazon…)" value={buscar} onChange={(e) => setBuscar(e.target.value)} className={claseCampo} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {vista === "mes" && (
          <select className={claseCampo} value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">
            <option value="">Todos los meses</option>
            {meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
          </select>
        )}
        <select className={claseCampo} value={cuenta} onChange={(e) => setCuenta(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {d.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className={claseCampo} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {todasLasCategorias(d.movimientos.map((m) => m.categoria)).map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={claseCampo} value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="De quién">
          <option value="">De todos</option>
          {personas.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      {vista === "estado" ? (
        <PorEstado grupos={grupos} nombreCuenta={nombreCuenta} pasa={pasa} fila={filaConFecha} filaSinEstado={filaConFechaYCuenta}
          sinTarjeta={d.movimientos.filter((m) => !grupos.some((g) => g.estado.cuentaId === m.cuentaId) && mesDe(m.fecha) === mesDe(hoyISO()) && pasa(m))
            .sort((a, b) => a.fecha.localeCompare(b.fecha))} />
      ) : (
        <>
          <p className="cifras mt-3 px-1 text-sm text-suave">{lista.length} movimientos · cargos {pesos(cargos)}</p>
          {lista.length > 0 && (
            <p className="px-1 text-xs text-suave">
              Toca un movimiento para editarlo o borrarlo.{mes ? " Lo de tarjeta de crédito cuenta en el mes de su corte (cuando lo pagas)." : ""}
            </p>
          )}
          {lista.length === 0 && <Vacio>No hay movimientos con esos filtros.</Vacio>}
          {[...porDia.entries()].map(([fecha, ms], i, dias) => {
            // En "Todos", un encabezado al empezar cada mes con cuántos son y sus cargos
            const nuevoMes = !mes && (i === 0 || mesDe(dias[i - 1][0]) !== mesDe(fecha));
            const delMes = nuevoMes ? lista.filter((m) => mesDe(m.fecha) === mesDe(fecha)) : [];
            return (
              <div key={fecha}>
                {nuevoMes && (
                  <div className="mt-6 flex items-baseline justify-between gap-2 border-b border-linea px-1 pb-1">
                    <p className="text-lg font-bold capitalize">{nombreMes(mesDe(fecha))}</p>
                    <p className="cifras text-xs text-suave">{delMes.length} · cargos {pesosCorto(sumar(delMes.filter((m) => m.monto > 0 && m.tipo !== "Informativo"), (m) => m.monto))}</p>
                  </div>
                )}
                <div className="mt-4">
                  <p className="mb-1 px-1 text-[13px] font-semibold text-suave">{fechaCorta(fecha)}</p>
                  <Tarjeta className="py-1">{ms.map(fila)}</Tarjeta>
                </div>
              </div>
            );
          })}
        </>
      )}

      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo="Editar movimiento">
        {editando && <EditorMovimiento key={editando.id} d={d} movimiento={editando} alTerminar={() => setEditando(null)} />}
      </Hoja>
    </Pantalla>
  );
}

/** Un movimiento de la lista; al tocarlo se edita. */
function FilaMovimiento({ m, d, cuenta, onClick, conFecha }: { m: Movimiento; d: Datos; cuenta?: string; onClick: () => void; conFecha?: boolean }) {
  const ms = detalleMensualidad(m, d.msi);
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 border-b border-linea py-3 text-left last:border-0">
      <i className="size-2.5 shrink-0 rounded-full" style={{ background: colorCategoria(m.categoria) }} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{m.descripcion}</p>
        {ms && <p className="cifras text-[13px] font-medium leading-snug text-acento">{ms.pago} de {ms.de} · compra de {ms.aprox ? "≈" : ""}{pesosCorto(ms.total)}</p>}
        <p className="truncate text-[13px] text-suave">
          {conFecha ? `${fechaCorta(m.fecha)} · ${m.categoria}${cuenta ? ` · ${cuenta}` : ""}` : `${m.categoria} · ${cuenta ?? ""}`}
          {m.responsable !== "Yo" && <span className="font-semibold text-aviso"> · {m.responsable}</span>}
          {m.origen === "manual" && " · a mano"}
        </p>
      </div>
      <span className={`cifras shrink-0 font-semibold ${m.monto < 0 ? "text-bien" : ""} ${m.tipo === "Informativo" ? "text-suave line-through" : ""}`}>
        {m.monto < 0 ? "+" : ""}{pesos(Math.abs(m.monto))}
      </span>
    </button>
  );
}

/** Cada tarjeta con su último estado de cuenta (lo que ya cortó) y lo que va del siguiente. */
function PorEstado({ grupos, nombreCuenta, pasa, fila, filaSinEstado, sinTarjeta }: {
  grupos: GrupoEstado[]; nombreCuenta: Map<string, string>; pasa: (m: Movimiento) => boolean;
  fila: (m: Movimiento) => ReactNode; filaSinEstado: (m: Movimiento) => ReactNode; sinTarjeta: Movimiento[];
}) {
  const visibles = grupos.filter((g) => g.cerrado.some(pasa) || g.abierto.some(pasa));
  if (visibles.length === 0 && sinTarjeta.length === 0) {
    return <Vacio>{grupos.length === 0 ? "Sube un estado de cuenta para ver tus movimientos por corte." : "No hay movimientos con esos filtros."}</Vacio>;
  }
  return (
    <div className="mt-3 space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      {visibles.map((g) => <GrupoTarjeta key={g.estado.cuentaId} g={g} nombre={nombreCuenta.get(g.estado.cuentaId) ?? g.estado.banco} pasa={pasa} fila={fila} />)}
      {sinTarjeta.length > 0 && (
        <Tarjeta className="pb-1">
          <p className="font-semibold">Sin estado de cuenta</p>
          <p className="text-[13px] text-suave">Este mes · efectivo, débito o lo que pagaste con dinero de otra persona</p>
          <p className="cifras mt-1 text-sm">Gastaste {pesos(sumar(sinTarjeta.filter((m) => m.monto > 0), (m) => m.monto))}</p>
          <div className="mt-1">{sinTarjeta.map(filaSinEstado)}</div>
        </Tarjeta>
      )}
    </div>
  );
}

function GrupoTarjeta({ g, nombre, pasa, fila }: { g: GrupoEstado; nombre: string; pasa: (m: Movimiento) => boolean; fila: (m: Movimiento) => ReactNode }) {
  const e = g.estado;
  const cerrado = g.cerrado.filter(pasa);
  const abierto = g.abierto.filter(pasa);
  const pagosDespues = abierto.filter((m) => m.categoria === "Pago a tarjeta");
  const cargosDespues = abierto.filter((m) => m.categoria !== "Pago a tarjeta");
  const etiqueta = g.falta <= 0.5 ? { texto: "Pagada", clase: "bg-hundido text-bien" }
    : g.vencido ? { texto: "Vencida", clase: "bg-alerta-suave text-alerta" }
    : { texto: `Vence ${fechaCorta(e.fechaLimite ?? e.fechaCorte)}`, clase: "bg-aviso-suave text-aviso" };
  return (
    <Tarjeta>
      <div className="flex items-start justify-between gap-2">
        <p className={`min-w-0 font-semibold ${g.vencido ? "text-alerta" : ""}`}>{nombre}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${etiqueta.clase}`}>{etiqueta.texto}</span>
      </div>

      <details className="group mt-2 rounded-xl bg-hundido px-3 py-2">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
          <span>
            <span className="block text-sm font-semibold">Ya cortó · estado del {fechaCorta(e.fechaCorte)}</span>
            <span className="block text-[13px] text-suave">Del {fechaCorta(g.desde)} al {fechaCorta(e.fechaCorte)} · {cerrado.length} movimientos</span>
          </span>
          <span className="cifras shrink-0 text-right">
            <span className={`block font-bold ${g.vencido ? "text-alerta" : g.falta <= 0.5 ? "text-bien" : ""}`}>{g.falta <= 0.5 ? "✓" : pesos(g.falta)}</span>
            <span className="block text-[11px] text-suave">{g.falta <= 0.5 ? "pagado" : e.soloDe ? "falta (tu parte)" : "falta"}</span>
          </span>
        </summary>
        <div className="cifras mt-2 space-y-0.5 border-t border-linea pt-2 text-[13px] text-suave">
          {e.pagoNoIntereses !== undefined && <p className="flex justify-between"><span>Para no generar intereses</span><span>{pesos(e.pagoNoIntereses)}</span></p>}
          {g.pagadoDespues > 0 && <p className="flex justify-between"><span>Ya pagaste</span><span className="text-bien">− {pesos(g.pagadoDespues)}</span></p>}
          {g.minimoFalta !== undefined && g.falta > 0.5 && <p className="flex justify-between"><span>Mínimo que falta</span><span>{g.minimoFalta > 0 ? pesos(g.minimoFalta) : "ya cubierto"}</span></p>}
          <p className="flex justify-between"><span>Cargos del periodo</span><span>{pesos(g.cargosCerrado)}</span></p>
          <p className="pt-1 text-[12px]">Los pagos dentro de este periodo cubrieron el estado anterior.</p>
        </div>
        <div className="mt-1 rounded-lg bg-superficie px-2">{cerrado.length ? cerrado.map(fila) : <p className="py-3 text-sm text-suave">Sin movimientos con esos filtros.</p>}</div>
      </details>

      <div className="mt-3 px-1">
        <div className="flex items-start justify-between gap-2">
          <span>
            <span className="block text-sm font-semibold">Va del siguiente · corte ~{fechaCorta(g.proximoCorte)}</span>
            <span className="block text-[13px] text-suave">{g.proximoLimite ? `Se paga ~${fechaCorta(g.proximoLimite)}` : "Aún no hay fecha límite"}</span>
          </span>
          <span className="cifras shrink-0 text-right">
            <span className="block font-bold">{pesos(g.cargosAbierto)}</span>
            <span className="block text-[11px] text-suave">van</span>
          </span>
        </div>
        {cargosDespues.length > 0 ? <div className="mt-1">{cargosDespues.map(fila)}</div>
          : <p className="mt-1 text-[13px] text-suave">Nada todavía. Lo que no anotes a mano aparece al subir el estado de cuenta.</p>}
        {pagosDespues.length > 0 && (
          <>
            <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-suave">Pagos al estado que ya cortó</p>
            <div>{pagosDespues.map(fila)}</div>
          </>
        )}
      </div>
    </Tarjeta>
  );
}
