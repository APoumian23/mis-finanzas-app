import { useState } from "react";
import { Anillo, Aviso, Barra, Boton, Campo, claseCampo, Hoja, Pantalla, Tarjeta, Titulo, Vacio } from "../componentes/ui";
import Pastel, { Centro } from "../componentes/Pastel";
import type { Datos } from "../hooks";
import { COLOR_OTROS, SERIE } from "../lib/colores";
import { estadoPrestamo, tablaPagos, tasaMensual } from "../lib/calculos";
import { db } from "../lib/db";
import type { Prestamo } from "../lib/tipos";
import { aNumero, etiquetaMes, fechaCorta, hoyISO, pesos, pesosCorto, sumar, uid } from "../lib/util";

export default function Prestamos({ d }: { d: Datos }) {
  const [abierto, setAbierto] = useState<Prestamo | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const hoy = hoyISO();
  const lista = [...d.prestamos].sort((a, b) => b.tasaAnual - a.tasaAnual);

  return (
    <Pantalla titulo="Préstamos" atras="mas" accion={<Boton tipo="secundario" className="text-sm" onClick={() => setNuevo(true)}>+ Nuevo</Boton>}>
      {lista.length > 1 && (
        <div className="mb-3"><Aviso tipo="info">Paga lo de cada mes a todos. Lo que te sobre, abónalo al de <strong>tasa más alta</strong> (el primero de la lista).</Aviso></div>
      )}
      {lista.length === 0 && <Vacio>No tienes préstamos registrados.</Vacio>}
      {lista.length > 1 && (
        <Tarjeta className="mb-3">
          <Pastel centro={<Centro etiqueta="Debes" valor={sumar(d.prestamos, (p) => estadoPrestamo(p, hoy).saldo)} />}
            datos={d.prestamos.map((p, i) => ({ nombre: p.nombre, valor: estadoPrestamo(p, hoy).saldo, color: SERIE[i] ?? COLOR_OTROS }))} />
        </Tarjeta>
      )}
      <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {lista.map((p, i) => {
          const e = estadoPrestamo(p, hoy);
          // Con plazo fijo: lo que llevas pagado contra el total del contrato; si no, lo que ha bajado la deuda
          const total = p.plazoMeses ? p.pagoMensual * p.plazoMeses : p.montoOriginal;
          const avance = p.plazoMeses ? e.pagado : p.montoOriginal > 0 ? Math.max(0, p.montoOriginal - e.saldo) : 0;
          return (
            <Tarjeta key={p.id} onClick={() => setAbierto(p)}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-lg font-semibold">{p.nombre}</p>
                <p className="cifras shrink-0 text-xl font-bold">{pesosCorto(e.saldo)}</p>
              </div>
              <p className="text-sm text-suave">
                {p.tasaAnual > 0 ? `${(p.tasaAnual * 100).toFixed(2).replace(/\.00$/, "")}% anual${p.ivaSobreInteres ? " + IVA" : ""}` : "Sin intereses"}
                {" · "}{p.pagoMensual > 0 ? `${pesos(p.quincenal ? p.pagoMensual / 2 : p.pagoMensual)} ${p.quincenal ? "por quincena" : "al mes"}` : "sin pago fijo"}
              </p>
              {i === 0 && lista.length > 1 && <span className="mt-1.5 inline-block rounded-full bg-acento-suave px-2.5 py-0.5 text-sm font-semibold text-acento">Abonar extra aquí: es la tasa más alta</span>}
              <div className="mt-3 flex items-center gap-3">
                <Anillo valor={avance} maximo={total} />
                <div className="min-w-0 text-sm">
                  <p className="cifras font-medium">Llevas {pesosCorto(avance)} de {pesosCorto(total)}</p>
                  <p className="text-suave">
                    {p.pagoMensual <= 0 ? "Abónale cuando puedas: no tiene fecha ni pago fijo."
                      : e.terminaEn ? <>Terminas en <strong className="capitalize text-tinta">{etiquetaMes(e.terminaEn)}</strong>{e.atraso > 1 ? " si te pones al corriente" : ""} · faltan {pesosCorto(e.interesesPorPagar ?? 0)} de intereses</>
                      : <span className="font-semibold text-alerta">Con {pesos(p.pagoMensual)} al mes no se termina: el interés ({pesos(e.interesEsteMes)}) es igual o mayor.</span>}
                  </p>
                </div>
              </div>
              {e.atraso > 1 && <p className="mt-1 text-sm font-semibold text-alerta">Te falta cubrir {pesos(e.atraso)} de pagos que ya tocaban</p>}
            </Tarjeta>
          );
        })}
      </div>

      <Hoja abierta={!!abierto} onCerrar={() => setAbierto(null)} titulo={abierto?.nombre ?? ""}>
        {abierto && <DetallePrestamo p={d.prestamos.find((x) => x.id === abierto.id) ?? abierto} cerrar={() => setAbierto(null)} />}
      </Hoja>
      <Hoja abierta={nuevo} onCerrar={() => setNuevo(false)} titulo="Nuevo préstamo">
        {nuevo && <FormPrestamo cerrar={() => setNuevo(false)} />}
      </Hoja>
    </Pantalla>
  );
}

function DetallePrestamo({ p, cerrar }: { p: Prestamo; cerrar: () => void }) {
  const hoy = hoyISO();
  const e = estadoPrestamo(p, hoy);
  const [monto, setMonto] = useState(String(p.pagoMensual));
  const [fecha, setFecha] = useState(hoy);
  const [editar, setEditar] = useState(false);
  const tabla = tablaPagos(p, hoy, 36);

  const [guardando, setGuardando] = useState(false);
  async function registrar() {
    const m = aNumero(monto);
    if (!m || !fecha || guardando) return;
    setGuardando(true);
    await db.prestamos.update(p.id, { pagos: [...p.pagos, { fecha, monto: m }] });
    setGuardando(false);
  }
  async function quitarPago(i: number) {
    if (!confirm(`¿Quitar el pago de ${pesos(p.pagos[i].monto)} del ${fechaCorta(p.pagos[i].fecha, true)}?`)) return;
    await db.prestamos.update(p.id, { pagos: p.pagos.filter((_, k) => k !== i) });
  }

  if (editar) return <FormPrestamo prestamo={p} cerrar={cerrar} />;
  return (
    <div>
      <div className="cifras mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-superficie p-3"><p className="text-suave">Debes hoy</p><p className="text-lg font-bold">{pesos(e.saldo)}</p></div>
        <div className="rounded-xl bg-superficie p-3"><p className="text-suave">Interés de este mes</p><p className="text-lg font-bold text-alerta">{pesos(e.interesEsteMes)}</p></div>
        <div className="rounded-xl bg-superficie p-3"><p className="text-suave">Le has pagado</p><p className="text-lg font-bold">{pesos(e.pagado)}</p></div>
        <div className="rounded-xl bg-superficie p-3"><p className="text-suave">Tasa real al mes</p><p className="text-lg font-bold">{(tasaMensual(p) * 100).toFixed(2)}%</p></div>
      </div>
      {p.nota && <p className="mb-3 text-sm text-suave">{p.nota}</p>}

      <Titulo>Anotar un pago</Titulo>
      <div className="flex gap-2">
        <input className={claseCampo} inputMode="decimal" value={monto} onChange={(x) => setMonto(x.target.value)} aria-label="Monto del pago" />
        <input type="date" className={claseCampo} value={fecha} onChange={(x) => setFecha(x.target.value)} aria-label="Fecha del pago" />
      </div>
      <Boton className="mt-2 w-full" onClick={registrar} deshabilitado={!aNumero(monto) || !fecha || guardando}>Guardar pago</Boton>

      {p.pagos.length > 0 && (
        <>
          <Titulo>Pagos hechos</Titulo>
          <div className="rounded-2xl bg-superficie px-4">
            {[...p.pagos].map((x, i) => (
              <div key={i} className="flex items-center justify-between border-b border-linea py-2.5 last:border-0">
                <span>{fechaCorta(x.fecha, true)}</span>
                <span className="cifras flex items-center gap-3">{pesos(x.monto)}
                  <button onClick={() => quitarPago(i)} className="text-sm text-alerta" aria-label="Quitar pago">✕</button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Titulo>Cómo baja la deuda</Titulo>
      <div className="cifras overflow-x-auto rounded-2xl bg-superficie px-3 text-sm">
        <table className="w-full">
          <thead><tr className="text-left text-suave"><th className="py-2">Mes</th><th>Pago</th><th>Interés</th><th className="text-right">Debes</th></tr></thead>
          <tbody>
            {tabla.map((f) => (
              <tr key={f.mes} className="border-t border-linea">
                <td className="py-1.5 capitalize">{etiquetaMes(f.mes)}</td><td>{pesosCorto(f.pago)}</td>
                <td className="text-alerta">{pesosCorto(f.interes)}</td><td className="text-right">{pesosCorto(f.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {tabla.length === 36 && <p className="py-2 text-xs text-suave">Mostrando los primeros 3 años.</p>}
      </div>
      <Boton tipo="secundario" className="mt-4 w-full" onClick={() => setEditar(true)}>Editar datos del préstamo</Boton>
    </div>
  );
}

function FormPrestamo({ prestamo, cerrar }: { prestamo?: Prestamo; cerrar: () => void }) {
  const [f, setF] = useState({
    nombre: prestamo?.nombre ?? "",
    // Al editar se muestra lo que debes HOY (no el saldo con que se registró)
    saldo: prestamo ? String(estadoPrestamo(prestamo).saldo) : "",
    original: String(prestamo?.montoOriginal ?? ""),
    tasa: prestamo ? String(+(prestamo.tasaAnual * 100).toFixed(2)) : "",
    iva: prestamo?.ivaSobreInteres ?? false,
    quincenal: prestamo?.quincenal ?? false,
    pago: String(prestamo?.pagoMensual ?? ""),
    primerPago: prestamo?.primerPago ?? "",
    nota: prestamo?.nota ?? "",
  });
  const cambiar = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function guardar() {
    const saldo = aNumero(f.saldo);
    const datos: Prestamo = {
      id: prestamo?.id ?? uid(),
      nombre: f.nombre || "Préstamo",
      montoOriginal: aNumero(f.original) || saldo,
      // Si no tocaste el saldo, la cuenta sigue igual; si lo corriges, sigue desde hoy con ese saldo.
      // Los pagos anotados se conservan (los anteriores a hoy ya no se vuelven a restar).
      ...(prestamo && Math.abs(saldo - estadoPrestamo(prestamo).saldo) < 0.01
        ? { saldoInicial: prestamo.saldoInicial, fechaSaldoInicial: prestamo.fechaSaldoInicial }
        : { saldoInicial: saldo, fechaSaldoInicial: hoyISO() }),
      tasaAnual: aNumero(f.tasa) / 100,
      ivaSobreInteres: f.iva,
      pagoMensual: aNumero(f.pago),
      primerPago: f.primerPago || undefined,
      plazoMeses: prestamo?.plazoMeses,
      ultimoPago: prestamo?.ultimoPago,
      ...(f.quincenal ? { quincenal: true } : {}),
      pagos: prestamo?.pagos ?? [],
      nota: f.nota || undefined,
    };
    await db.prestamos.put(datos);
    cerrar();
  }
  async function borrar() {
    if (prestamo && confirm(`¿Borrar "${prestamo.nombre}"?`)) { await db.prestamos.delete(prestamo.id); cerrar(); }
  }
  return (
    <div>
      <Campo etiqueta="Nombre"><input className={claseCampo} value={f.nombre} onChange={cambiar("nombre")} placeholder="Ej. Mamá, Crédito banco" /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Lo que debes hoy" ayuda={prestamo ? "Si lo corriges, la cuenta sigue desde hoy con ese saldo. Tus pagos anotados se conservan." : undefined}>
          <input className={claseCampo} inputMode="decimal" value={f.saldo} onChange={cambiar("saldo")} />
        </Campo>
        <Campo etiqueta="Monto que te prestaron"><input className={claseCampo} inputMode="decimal" value={f.original} onChange={cambiar("original")} /></Campo>
        <Campo etiqueta="Tasa anual (%)"><input className={claseCampo} inputMode="decimal" value={f.tasa} onChange={cambiar("tasa")} /></Campo>
        <Campo etiqueta="Pago al mes"><input className={claseCampo} inputMode="decimal" value={f.pago} onChange={cambiar("pago")} /></Campo>
      </div>
      <label className="mb-3 flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" checked={f.iva} onChange={cambiar("iva")} className="size-5 accent-[var(--acento)]" /> Cobran IVA sobre los intereses (bancos)
      </label>
      <label className="mb-3 flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" checked={f.quincenal} onChange={cambiar("quincenal")} className="size-5 accent-[var(--acento)]" /> Se paga por quincenas (el 15 y fin de mes, la mitad cada una)
      </label>
      <Campo etiqueta="Fecha del primer pago (opcional)" ayuda="Sirve para avisarte si vas atrasado">
        <input type="date" className={claseCampo} value={f.primerPago} onChange={cambiar("primerPago")} />
      </Campo>
      <Campo etiqueta="Nota"><input className={claseCampo} value={f.nota} onChange={cambiar("nota")} /></Campo>
      <Boton className="w-full" onClick={guardar} deshabilitado={!aNumero(f.saldo) || !aNumero(f.pago)}>Guardar</Boton>
      {prestamo && <Boton tipo="peligro" className="mt-2 w-full" onClick={borrar}>Borrar préstamo</Boton>}
    </div>
  );
}
