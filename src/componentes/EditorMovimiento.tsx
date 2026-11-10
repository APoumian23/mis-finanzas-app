import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { personasDe, type Datos } from "../hooks";
import { compraMSIManual, detalleMensualidad, INGRESO_EXTRA, PLAZOS_MSI, ultimoCargo } from "../lib/calculos";
import { clasificar, tipoPara } from "../lib/categorizar";
import { db } from "../lib/db";
import { aprender } from "../lib/importarEstado";
import { todasLasCategorias, type Movimiento, type Regla } from "../lib/tipos";
import { aNumero, etiquetaMes, fechaCorta, hoyISO, pesos, uid } from "../lib/util";
import { Boton, Campo, claseCampo } from "./ui";

const RAPIDAS = [
  "Comida fuera y bares", "Súper y despensa", "OXXO y tiendas de conveniencia", "Gasolina y auto",
  "Mascotas", "Farmacia y salud", "Transporte (Uber/Didi/bus)", "Entretenimiento",
];
/** Lo que entra: un ingreso aparte de tu sueldo, un reembolso o un pago a una tarjeta. */
const RAPIDAS_ENTRADA = [INGRESO_EXTRA, "Reembolsos y puntos", "Pago a tarjeta"];

export default function EditorMovimiento({ d, movimiento, alTerminar }: {
  d: Datos; movimiento?: Movimiento; alTerminar: () => void;
}) {
  const reglas = useLiveQuery(async () => new Map<string, Regla>((await db.reglas.toArray()).map((r) => [r.clave, r])), []);
  const activas = d.cuentas.filter((c) => !c.archivada);
  const efectivo = activas.find((c) => c.tipo === "efectivo" || c.tipo === "debito") ?? activas[0] ?? d.cuentas[0];
  const [monto, setMonto] = useState(movimiento ? String(Math.abs(movimiento.monto)) : "");
  const [esAbono, setEsAbono] = useState(movimiento ? movimiento.monto < 0 : false);
  const [descripcion, setDescripcion] = useState(movimiento?.descripcion ?? "");
  const [categoria, setCategoria] = useState<string | null>(movimiento?.categoria ?? null);
  const [cuentaId, setCuentaId] = useState(movimiento?.cuentaId ?? efectivo?.id ?? "");
  const [fecha, setFecha] = useState(movimiento?.fecha ?? hoyISO());
  const [responsable, setResponsable] = useState(movimiento?.responsable ?? "Yo");
  const [nota, setNota] = useState(movimiento?.nota ?? "");
  const [guardando, setGuardando] = useState(false);
  const [aMeses, setAMeses] = useState(false);
  const [nuevoMetodo, setNuevoMetodo] = useState<string | null>(null);
  const [meses, setMeses] = useState(12);

  const valor = aNumero(monto) * (esAbono ? -1 : 1);
  const sugerida = useMemo(
    () => (descripcion.length >= 3 && reglas ? clasificar(descripcion, valor || 1, reglas, cuentaId) : null),
    [descripcion, reglas, valor, cuentaId],
  );
  // Una entrada anotada a mano sin categoría elegida es un ingreso extra: así suma a tu mes. (Al leer un estado de
  // cuenta, un abono sin categoría se toma como reembolso; aquí no: lo que anotas a mano casi siempre es dinero que te entró.)
  const sinSugerencia = !sugerida || sugerida.categoria === "Otros / sin identificar" || sugerida.categoria === "Reembolsos y puntos";
  const categoriaFinal = categoria ?? (esAbono && sinSugerencia ? INGRESO_EXTRA : sugerida?.categoria) ?? "Otros / sin identificar";
  const personas = personasDe(d);
  // Compra a meses: solo al anotar un gasto nuevo con tarjeta de crédito. Se guarda como compra a meses, no como gasto:
  // a tu mes le toca cada mensualidad, no el total.
  const tipoCuenta = d.cuentas.find((c) => c.id === cuentaId)?.tipo;
  const conCredito = tipoCuenta === "credito";
  const esMSI = aMeses && conCredito && !movimiento && !esAbono;
  const compraMSI = esMSI && valor > 0 && fecha
    ? compraMSIManual({ cuentaId, descripcion: descripcion.trim() || "Compra a meses", monto: valor, meses, fechaCompra: fecha, responsable }, d.estados, uid())
    : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valor || !cuentaId || !fecha) return;
    setGuardando(true);
    if (esMSI) {
      if (compraMSI) await db.msi.put(compraMSI);
      alTerminar();
      return;
    }
    const datos: Movimiento = {
      id: movimiento?.id ?? uid(),
      cuentaId, fecha, monto: valor,
      descripcion: descripcion.trim() || categoriaFinal,
      categoria: categoriaFinal,
      tipo: movimiento && movimiento.categoria === categoriaFinal && movimiento.monto === valor
        ? movimiento.tipo : tipoPara(categoriaFinal, valor, descripcion),
      responsable,
      nota: nota.trim() || undefined,
      origen: movimiento?.origen ?? "manual",
      estadoId: movimiento?.estadoId,
      periodo: movimiento?.periodo,
      creado: movimiento?.creado ?? Date.now(),
    };
    await db.movimientos.put(datos);
    if (movimiento && (movimiento.categoria !== datos.categoria || movimiento.responsable !== datos.responsable)) {
      await aprender(datos);
    } else if (!movimiento && categoria && descripcion.trim().length >= 3) {
      await aprender(datos);
    }
    alTerminar();
  }

  /** Alta rápida de un método de pago de otra persona (p. ej. "Tarjeta de la abuela") sin salir del formulario. */
  async function agregarMetodo() {
    const nombre = nuevoMetodo?.trim();
    if (!nombre) return;
    const id = uid();
    await db.cuentas.put({ id, nombre, banco: null, tipo: "ajena" });
    setCuentaId(id);
    setNuevoMetodo(null);
  }

  async function borrar() {
    if (!movimiento || !confirm("¿Borrar este movimiento?")) return;
    await db.movimientos.delete(movimiento.id);
    alTerminar();
  }

  const mensualidad = movimiento ? detalleMensualidad(movimiento, d.msi) : null;
  return (
    <form onSubmit={guardar}>
      {mensualidad && (
        <div className="mb-3 rounded-2xl bg-acento-suave p-4 text-acento">
          <p className="text-sm font-semibold">Mensualidad de una compra a meses</p>
          <p className="cifras mt-1 text-2xl font-bold">{mensualidad.aprox ? "≈ " : ""}{pesos(mensualidad.total)}</p>
          <p className="text-sm">Compra total{mensualidad.compra ? ` · ${mensualidad.compra.descripcion}` : ""}</p>
          <div className="cifras mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-superficie p-2 text-tinta"><p className="text-xs text-suave">Este pago</p><p className="font-bold">{mensualidad.pago} de {mensualidad.de}</p></div>
            <div className="rounded-xl bg-superficie p-2 text-tinta"><p className="text-xs text-suave">Cada mes</p><p className="font-bold">{pesos(movimiento!.monto)}</p></div>
            <div className="rounded-xl bg-superficie p-2 text-tinta"><p className="text-xs text-suave">Falta</p><p className="font-bold">{pesos(mensualidad.falta ?? 0)}</p></div>
          </div>
          {mensualidad.aprox && <p className="mt-2 text-xs">Calculado con la mensualidad × {mensualidad.de}: la compra no está en tus compras a meses.</p>}
        </div>
      )}
      <div className="mb-4 rounded-2xl bg-superficie p-4 text-center">
        <div className="mb-2 inline-flex rounded-full bg-hundido p-1 text-sm font-semibold">
          <button type="button" onClick={() => { setEsAbono(false); setCategoria(null); }} className={`rounded-full px-3 py-1 ${!esAbono ? "bg-superficie shadow" : "text-suave"}`}>Gasto</button>
          <button type="button" onClick={() => { setEsAbono(true); setCategoria(null); }} className={`rounded-full px-3 py-1 ${esAbono ? "bg-superficie shadow" : "text-suave"}`}>Ingreso o abono</button>
        </div>
        <div className="flex items-center justify-center gap-1">
          <span className={`text-3xl font-bold ${esAbono ? "text-bien" : "text-suave"}`}>{esAbono ? "+$" : "$"}</span>
          <input
            autoFocus={!movimiento} inputMode="decimal" placeholder="0" value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
            className="cifras w-48 bg-transparent text-center text-[44px] font-bold outline-none" aria-label="Monto"
          />
        </div>
      </div>

      <Campo etiqueta={esAbono ? "¿De qué?" : "¿En qué?"}>
        <input className={claseCampo} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
          placeholder={esAbono ? "Ej. venta, trabajo extra, me regalaron" : "Ej. tacos, ratones, gasolina"} />
      </Campo>

      {!esMSI && <div className="mb-3">
        <span className="mb-1 block px-1 text-[13px] font-medium text-suave">
          Categoría{!categoria && sugerida ? " (sugerida)" : ""}
        </span>
        <div className="flex flex-wrap gap-2">
          {[...new Set([categoriaFinal, ...(esAbono ? RAPIDAS_ENTRADA : RAPIDAS)])].map((c) => (
            <button key={c} type="button" onClick={() => setCategoria(c)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${categoriaFinal === c ? "bg-acento text-white dark:text-black" : "bg-superficie"}`}>
              {c.replace(" y tiendas de conveniencia", "").replace(" (Uber/Didi/bus)", "").replace("Reembolsos y puntos", "Reembolso")}
            </button>
          ))}
        </div>
        <select className={`${claseCampo} mt-2`} value={categoriaFinal} onChange={(e) => setCategoria(e.target.value)} aria-label="Todas las categorías">
          {todasLasCategorias(d.movimientos.map((m) => m.categoria)).map((c) => <option key={c}>{c}</option>)}
        </select>
        {esAbono && categoriaFinal === INGRESO_EXTRA && (
          <p className="mt-2 px-1 text-xs text-suave">Suma a lo que te alcanza este mes. Tu sueldo y tus ingresos fijos ya están en Ajustes: no los anotes aquí.</p>
        )}
      </div>}

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta={categoriaFinal === "Pago a tarjeta" ? "Tarjeta" : esAbono ? "¿Dónde entró?" : "Con qué pagaste"}>
          <select className={claseCampo} value={nuevoMetodo !== null ? "__nuevo" : cuentaId}
            onChange={(e) => { if (e.target.value === "__nuevo") setNuevoMetodo(""); else { setNuevoMetodo(null); setCuentaId(e.target.value); } }}>
            {d.cuentas.filter((c) => !c.archivada || c.id === cuentaId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value="__nuevo">+ Otro método de pago…</option>
          </select>
        </Campo>
        <Campo etiqueta="Fecha">
          <input type="date" className={claseCampo} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
      </div>

      {conCredito && !movimiento && !esAbono && (
        <div className="mb-3 rounded-2xl bg-superficie p-3">
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="font-medium">¿Es a meses sin intereses?</span>
            <input type="checkbox" className="size-6 accent-[var(--acento)]" checked={aMeses} onChange={(e) => setAMeses(e.target.checked)} />
          </label>
          {aMeses && (
            <>
              <select className={`${claseCampo} mt-2`} value={meses} onChange={(e) => setMeses(Number(e.target.value))} aria-label="Meses">
                {PLAZOS_MSI.map((p) => <option key={p} value={p}>{p} meses</option>)}
              </select>
              {compraMSI && (
                <div className="cifras mt-2 text-sm">
                  <p className="flex justify-between"><span>Mensualidad</span><strong>{pesos(compraMSI.pagoMensual)}</strong></p>
                  <p className="mt-1 text-suave">
                    Primer pago en el corte del {fechaCorta(compraMSI.actualizadoAl)}; el último, en <span className="capitalize">{etiquetaMes(ultimoCargo(compraMSI))}</span>.
                    A tu mes solo le toca la mensualidad.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {nuevoMetodo !== null && (
        <div className="mb-3 rounded-2xl bg-superficie p-3">
          <p className="text-sm font-medium">Nuevo método de pago de otra persona</p>
          <p className="mb-2 text-xs text-suave">Para lo que pagas con la tarjeta o el dinero de alguien más: cuenta como gasto tuyo, pero no va a tus tarjetas.</p>
          <div className="flex gap-2">
            <input className={claseCampo} autoFocus value={nuevoMetodo} onChange={(e) => setNuevoMetodo(e.target.value)} placeholder="Ej. Tarjeta de la abuela"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void agregarMetodo(); } }} />
            <Boton className="shrink-0" onClick={agregarMetodo} deshabilitado={!nuevoMetodo.trim()}>Agregar</Boton>
          </div>
        </div>
      )}
      {tipoCuenta === "ajena" && nuevoMetodo === null && (
        <p className="-mt-1 mb-3 px-1 text-xs text-suave">Pagado con dinero de otra persona: cuenta como gasto tuyo, pero no va a ninguna de tus tarjetas.</p>
      )}

      <Campo etiqueta={esAbono ? "¿De quién es?" : "¿De quién es el gasto?"}
        ayuda={responsable !== "Yo" ? (esAbono ? "No cuenta en tu dinero del mes." : "No cuenta en tu dinero del mes: se suma a lo que te debe.") : undefined}>
        <select className={claseCampo} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
          {personas.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Campo>

      {!esMSI && (
        <Campo etiqueta="Nota (opcional)">
          <input className={claseCampo} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
      )}

      {conCredito && !movimiento && (
        <p className="mb-3 px-1 text-xs text-suave">
          {esMSI ? "Queda en Compras a meses. Cuando subas el estado de cuenta, se reemplaza con lo que diga el banco (no se duplica)."
            : `Cuando subas el estado de cuenta, este ${esAbono ? "abono" : "gasto"} se junta solo con el del banco (no se duplica).`}
        </p>
      )}

      <Boton submit className="w-full" deshabilitado={!valor || !fecha || guardando || nuevoMetodo !== null}>{movimiento ? "Guardar cambios" : esMSI ? "Guardar compra a meses" : esAbono ? "Guardar ingreso" : "Guardar gasto"}</Boton>
      {movimiento && <Boton tipo="peligro" className="mt-2 w-full" onClick={borrar}>Borrar</Boton>}
    </form>
  );
}
