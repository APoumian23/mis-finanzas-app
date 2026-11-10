import { useState } from "react";
import { Barra, Boton, Campo, Hoja, Pantalla, Tarjeta, Titulo, Vacio, claseCampo } from "../componentes/ui";
import Pastel, { Centro } from "../componentes/Pastel";
import { personasDe, type Datos } from "../hooks";
import { colorPersona } from "../lib/colores";
import { compraMSIManual, msiDelMes, PLAZOS_MSI, pagosRestantes, ultimoCargo } from "../lib/calculos";
import { db } from "../lib/db";
import { cambiarResponsableMSI } from "../lib/importarEstado";
import { aNumero, etiquetaMes, fechaCorta, hoyISO, mesDe, pesos, pesosCorto, sumar, sumarMeses, uid } from "../lib/util";

export default function MesesSinIntereses({ d }: { d: Datos }) {
  const [verTerminadas, setVerTerminadas] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const nombreCuenta = new Map(d.cuentas.map((c) => [c.id, c.nombre]));
  const vivas = d.msi.filter((c) => pagosRestantes(c) > 0).sort((a, b) => ultimoCargo(a).localeCompare(ultimoCargo(b)));
  const terminadas = d.msi.filter((c) => pagosRestantes(c) === 0);
  const personas = personasDe(d);
  const siguiente = sumarMeses(mesDe(hoyISO()), 1);
  const tuyas = msiDelMes(d.msi, siguiente, "Yo");
  const deOtros = msiDelMes(d.msi, siguiente) - tuyas;

  return (
    <Pantalla titulo="Compras a meses" atras="mas"
      accion={<button onClick={() => setCapturando(true)} className="min-h-11 rounded-xl bg-acento px-4 font-semibold text-white dark:text-black">+ Agregar</button>}>
      <NuevaCompra d={d} abierta={capturando} onCerrar={() => setCapturando(false)} personas={personas} />
      <div className="grid grid-cols-2 gap-3">
        <Tarjeta><p className="text-sm text-suave">Tuyas el próximo mes</p><p className="cifras text-2xl font-bold">{pesosCorto(tuyas)}</p></Tarjeta>
        <Tarjeta><p className="text-sm text-suave">De otros (te las pagan)</p><p className="cifras text-2xl font-bold text-aviso">{pesosCorto(deOtros)}</p></Tarjeta>
      </div>
      {vivas.length > 0 && (
        <Tarjeta className="mt-3">
          <p className="mb-3 text-sm font-semibold">Lo que falta por pagar, de quién es</p>
          <Pastel centro={<Centro etiqueta="Falta" valor={sumar(vivas, (c) => c.saldoPendiente)} />}
            datos={personas.map((p) => ({ nombre: p === "Yo" ? "Tú" : p, valor: sumar(vivas.filter((c) => c.responsable === p), (c) => c.saldoPendiente), color: colorPersona(p, personas) }))} />
        </Tarjeta>
      )}
      <p className="mt-2 px-1 text-xs text-suave">Saldo pendiente total: {pesos(sumar(vivas, (c) => c.saldoPendiente))}. Se actualiza cada vez que subes un estado de cuenta.</p>

      <Titulo>Vigentes</Titulo>
      {vivas.length === 0 && <Vacio>No tienes compras a meses.</Vacio>}
      <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {vivas.map((c) => (
          <Tarjeta key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.descripcion}</p>
                <p className="text-sm text-suave">{nombreCuenta.get(c.cuentaId)} · termina en <span className="capitalize">{etiquetaMes(ultimoCargo(c))}</span></p>
              </div>
              <p className="cifras shrink-0 text-right font-bold">{pesos(c.pagoMensual)}<span className="block text-xs font-normal text-suave">al mes</span></p>
            </div>
            <div className="my-2.5"><Barra valor={c.pagoActual} maximo={c.totalPagos} alto="h-1.5" /></div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-suave">Pago {c.pagoActual} de {c.totalPagos} · faltan {pesosCorto(c.saldoPendiente)}</span>
              <select className={`${claseCampo} w-auto! shrink-0 py-1`} value={c.responsable} aria-label="De quién es"
                onChange={(e) => cambiarResponsableMSI(c, e.target.value)}>
                {personas.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            {c.manual && (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-linea pt-2 text-[13px] text-suave">
                <span>Capturada a mano · {c.actualizadoAl > hoyISO() ? `primer pago en el corte del ${fechaCorta(c.actualizadoAl)}` : "se actualiza con tu estado de cuenta"}</span>
                <button className="shrink-0 font-semibold text-alerta" onClick={() => { if (confirm(`¿Quitar "${c.descripcion}"?`)) void db.msi.delete(c.id); }}>Quitar</button>
              </div>
            )}
          </Tarjeta>
        ))}
      </div>

      {terminadas.length > 0 && (
        <button className="mt-4 w-full text-sm font-semibold text-acento" onClick={() => setVerTerminadas(!verTerminadas)}>
          {verTerminadas ? "Ocultar" : "Ver"} terminadas ({terminadas.length})
        </button>
      )}
      {verTerminadas && terminadas.map((c) => (
        <p key={c.id} className="cifras px-1 py-1 text-sm text-suave">{c.descripcion} · {pesos(c.montoOriginal)}</p>
      ))}
    </Pantalla>
  );
}

/** Capturar a mano una compra a meses que todavía no sale en el estado de cuenta. */
function NuevaCompra({ d, abierta, onCerrar, personas }: { d: Datos; abierta: boolean; onCerrar: () => void; personas: string[] }) {
  const tarjetas = d.cuentas.filter((c) => c.tipo === "credito" && !c.archivada);
  const [cuentaId, setCuentaId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [meses, setMeses] = useState(12);
  const [fecha, setFecha] = useState(hoyISO());
  const [responsable, setResponsable] = useState("Yo");
  const cuenta = cuentaId || tarjetas[0]?.id || "";
  const total = aNumero(monto);
  const lista = cuenta && descripcion.trim() && total > 0 && meses > 0 && fecha;
  const vista = lista ? compraMSIManual({ cuentaId: cuenta, descripcion, monto: total, meses, fechaCompra: fecha, responsable }, d.estados, "vista") : null;

  async function guardar() {
    if (!vista) return;
    await db.msi.put({ ...vista, id: uid() });
    setDescripcion(""); setMonto(""); setMeses(12); setFecha(hoyISO()); setResponsable("Yo");
    onCerrar();
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Nueva compra a meses">
      {tarjetas.length === 0 ? <Vacio>Primero agrega una tarjeta de crédito en Cuentas y tarjetas.</Vacio> : (
        <form onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
          <Campo etiqueta="Tarjeta">
            <select className={claseCampo} value={cuenta} onChange={(e) => setCuentaId(e.target.value)}>
              {tarjetas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Qué compraste">
            <input className={claseCampo} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Pantalla Liverpool" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Precio total">
              <input className={claseCampo} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$" />
            </Campo>
            <Campo etiqueta="Meses">
              <select className={claseCampo} value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
                {PLAZOS_MSI.map((p) => <option key={p} value={p}>{p} meses</option>)}
              </select>
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha de compra">
              <input type="date" className={claseCampo} value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <Campo etiqueta="De quién es">
              <select className={claseCampo} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                {personas.map((p) => <option key={p} value={p}>{p === "Yo" ? "Mía" : p}</option>)}
              </select>
            </Campo>
          </div>
          {vista && (
            <div className="cifras mb-3 rounded-xl bg-hundido p-3 text-sm">
              <p className="flex justify-between"><span>Mensualidad</span><strong>{pesos(vista.pagoMensual)}</strong></p>
              <p className="mt-1 text-suave">
                Primer pago en el corte del {fechaCorta(vista.actualizadoAl)}; el último, en <span className="capitalize">{etiquetaMes(ultimoCargo(vista))}</span>.
              </p>
            </div>
          )}
          <p className="mb-3 px-1 text-xs text-suave">Cuando subas el estado de cuenta que la traiga, se reemplaza con lo que diga el banco (no se duplica).</p>
          <Boton submit className="w-full" deshabilitado={!vista}>Guardar compra</Boton>
        </form>
      )}
    </Hoja>
  );
}
