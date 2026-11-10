import { useState } from "react";
import { Boton, Campo, claseCampo, Fila, Hoja, Pantalla, Tarjeta, Titulo, Vacio } from "../componentes/ui";
import Pastel, { Centro } from "../componentes/Pastel";
import { personasDe, type Datos } from "../hooks";
import { colorPersona } from "../lib/colores";
import { cuentaDeudor, pagosRestantes, todosLosDeudores } from "../lib/calculos";
import { db } from "../lib/db";
import type { Deudor } from "../lib/tipos";
import { aNumero, fechaCorta, hoyISO, pesos, pesosCorto, sumar, uid } from "../lib/util";

export default function PorCobrar({ d }: { d: Datos }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const todos = todosLosDeudores(d.deudores, d.movimientos, d.msi);
  const cuentas = [...todos.lista].sort((a, b) => b.debeHoy - a.debeHoy);
  const { sinLista, total } = todos;
  const todas = personasDe(d);
  const cadaMes = sumar(cuentas, (c) => c.proximoMes);
  const actual = d.deudores.find((x) => x.id === abierto);

  const [aviso, setAviso] = useState<string | null>(null);
  async function agregarPersona(nombre = nombreNuevo.trim()) {
    if (!nombre) return;
    if (d.deudores.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) { setAviso(`${nombre} ya está en la lista.`); return; }
    await db.deudores.add({ id: uid(), nombre, adeudos: [], reembolsos: [] });
    setNombreNuevo(""); setAviso(null);
  }

  return (
    <Pantalla titulo="Te deben" atras="mas">
      <Tarjeta>
        <p className="text-sm text-suave">En total te deben hoy</p>
        <p className="cifras text-4xl font-bold text-acento">{pesosCorto(total)}</p>
        {cadaMes > 0 && <p className="mt-1 text-sm text-suave">Y el próximo mes se cargan {pesos(cadaMes)} más a tus tarjetas por ellos.</p>}
      </Tarjeta>

      {total > 0 && (
        <Tarjeta className="mt-3">
          <Pastel centro={<Centro etiqueta="Te deben" valor={total} />}
            datos={[...cuentas, ...sinLista].map((c) => ({ nombre: c.deudor.nombre, valor: Math.max(0, c.debeHoy), color: colorPersona(c.deudor.nombre, todas) }))} />
        </Tarjeta>
      )}

      <Titulo>Por persona</Titulo>
      {cuentas.length === 0 && <Vacio>Nadie te debe. 🎉</Vacio>}
      <Tarjeta className="py-1">
        {cuentas.map((c) => (
          <Fila key={c.deudor.id} onClick={() => setAbierto(c.deudor.id)}
            izquierda={<span className="font-medium">{c.deudor.nombre}</span>}
            sub={c.porCargar > 0 ? `+ ${pesosCorto(c.porCargar)} que faltan a meses` : c.reembolsado > 0 ? `Te ha pagado ${pesosCorto(c.reembolsado)}` : undefined}
            derecha={<span className={`font-semibold ${c.debeHoy <= 0 ? "text-bien" : ""}`}>{c.debeHoy <= 0 ? "Al corriente" : pesos(c.debeHoy)}</span>} />
        ))}
      </Tarjeta>

      {sinLista.length > 0 && (
        <>
          <Titulo>Les cargaste algo, pero no están en la lista</Titulo>
          <Tarjeta className="py-1">
            {sinLista.map((c) => (
              <Fila key={c.deudor.id} izquierda={<span className="font-medium">{c.deudor.nombre}</span>}
                sub={`Te debe ${pesos(c.debeHoy)}${c.porCargar > 0 ? ` + ${pesosCorto(c.porCargar)} a meses` : ""}`}
                derecha={<button className="text-sm font-semibold text-acento" onClick={() => agregarPersona(c.deudor.nombre)}>Agregar</button>} />
            ))}
          </Tarjeta>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <input className={claseCampo} placeholder="Agregar persona" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
        <Boton tipo="secundario" onClick={() => agregarPersona()}>Agregar</Boton>
      </div>
      {aviso && <p className="mt-2 px-1 text-sm text-aviso">{aviso}</p>}
      <p className="mt-2 px-1 text-xs text-suave">Lo que cargues a tu tarjeta por alguien: en el movimiento elige "¿De quién es el gasto?" y se suma aquí solo.</p>

      <Hoja abierta={!!actual} onCerrar={() => setAbierto(null)} titulo={actual?.nombre ?? ""}>
        {actual && <DetalleDeudor d={d} dd={actual} />}
      </Hoja>
    </Pantalla>
  );
}

function DetalleDeudor({ d, dd }: { d: Datos; dd: Deudor }) {
  const c = cuentaDeudor(dd, d.movimientos, d.msi);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [concepto, setConcepto] = useState("");
  const [montoAdeudo, setMontoAdeudo] = useState("");
  const cargos = d.movimientos
    .filter((m) => m.responsable === dd.nombre && m.tipo !== "Informativo" && m.categoria !== "Pago a tarjeta")
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const msi = d.msi.filter((x) => x.responsable === dd.nombre && pagosRestantes(x) > 0);

  const [guardando, setGuardando] = useState(false);
  async function registrarPago() {
    const m = aNumero(monto);
    if (!m || !fecha || guardando) return;
    setGuardando(true);
    await db.deudores.update(dd.id, { reembolsos: [...dd.reembolsos, { fecha, monto: m }] });
    setMonto(""); setGuardando(false);
  }
  async function agregarAdeudo() {
    const m = aNumero(montoAdeudo);
    if (!m) return;
    await db.deudores.update(dd.id, { adeudos: [...dd.adeudos, { concepto: concepto || "Préstamo", monto: m }] });
    setConcepto(""); setMontoAdeudo("");
  }

  return (
    <div>
      <div className="cifras mb-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-superficie p-2"><p className="text-xs text-suave">Te debe hoy</p><p className="font-bold">{pesosCorto(c.debeHoy)}</p></div>
        <div className="rounded-xl bg-superficie p-2"><p className="text-xs text-suave">Falta a meses</p><p className="font-bold">{pesosCorto(c.porCargar)}</p></div>
        <div className="rounded-xl bg-superficie p-2"><p className="text-xs text-suave">Ya te pagó</p><p className="font-bold text-bien">{pesosCorto(c.reembolsado)}</p></div>
      </div>
      {dd.nota && <p className="mb-2 text-sm text-suave">{dd.nota}</p>}

      <Titulo>Anotar que te pagó</Titulo>
      <div className="flex gap-2">
        <input className={claseCampo} inputMode="decimal" placeholder="$" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto" />
        <input type="date" className={claseCampo} value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
      </div>
      <Boton className="mt-2 w-full" onClick={registrarPago} deshabilitado={!aNumero(monto) || !fecha || guardando}>Guardar pago</Boton>

      {dd.reembolsos.length > 0 && (
        <>
          <Titulo>Pagos que te ha hecho</Titulo>
          <div className="rounded-2xl bg-superficie px-4">
            {dd.reembolsos.map((r, i) => (
              <Fila key={i} izquierda={fechaCorta(r.fecha, true)} sub={r.nota} derecha={
                <span className="flex items-center gap-3">{pesos(r.monto)}
                  <button className="text-sm text-alerta" aria-label="Quitar" onClick={() => confirm(`¿Quitar el pago de ${pesos(r.monto)}?`) && db.deudores.update(dd.id, { reembolsos: dd.reembolsos.filter((_, k) => k !== i) })}>✕</button>
                </span>} />
            ))}
          </div>
        </>
      )}

      <Titulo>Lo que te debe fuera de tarjetas</Titulo>
      <div className="rounded-2xl bg-superficie px-4">
        {dd.adeudos.length === 0 && <p className="py-3 text-sm text-suave">Nada.</p>}
        {dd.adeudos.map((a, i) => (
          <Fila key={i} izquierda={a.concepto} derecha={
            <span className="flex items-center gap-3">{pesos(a.monto)}
              <button className="text-sm text-alerta" aria-label="Quitar" onClick={() => confirm(`¿Quitar "${a.concepto}"?`) && db.deudores.update(dd.id, { adeudos: dd.adeudos.filter((_, k) => k !== i) })}>✕</button>
            </span>} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className={claseCampo} placeholder="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        <input className={`${claseCampo} w-28! shrink-0`} inputMode="decimal" placeholder="$" value={montoAdeudo} onChange={(e) => setMontoAdeudo(e.target.value)} />
        <Boton tipo="secundario" onClick={agregarAdeudo}>+</Boton>
      </div>

      {msi.length > 0 && (
        <>
          <Titulo>Compras a meses suyas</Titulo>
          <div className="rounded-2xl bg-superficie px-4">
            {msi.map((x) => <Fila key={x.id} izquierda={x.descripcion} sub={`Pago ${x.pagoActual} de ${x.totalPagos}`} derecha={`${pesos(x.pagoMensual)}/mes`} />)}
          </div>
        </>
      )}

      {cargos.length > 0 && (
        <>
          <Titulo>Cargos en tus tarjetas ({cargos.length})</Titulo>
          <div className="rounded-2xl bg-superficie px-4">
            {cargos.slice(0, 40).map((m) => <Fila key={m.id} izquierda={m.descripcion} sub={fechaCorta(m.fecha, true)} derecha={pesos(m.monto)} />)}
          </div>
        </>
      )}
      <Boton tipo="peligro" className="mt-4 w-full" onClick={async () => {
        const aviso = cargos.length || msi.length
          ? ` Sus ${cargos.length} cargos en tus tarjetas siguen a su nombre y aparecerán en "Les cargaste algo".`
          : "";
        if (confirm(`¿Quitar a ${dd.nombre} de la lista? Se borran sus pagos y adeudos anotados aquí.${aviso}`)) await db.deudores.delete(dd.id);
      }}>Quitar persona</Boton>
    </div>
  );
}
