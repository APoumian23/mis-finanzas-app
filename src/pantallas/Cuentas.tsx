import { useState } from "react";
import { Boton, Campo, claseCampo, Fila, Hoja, Pantalla, Tarjeta } from "../componentes/ui";
import type { Datos } from "../hooks";
import { db } from "../lib/db";
import type { Banco, Cuenta, TipoCuenta } from "../lib/tipos";
import { uid } from "../lib/util";

const BANCOS: (Banco | "")[] = ["", "BBVA", "Banamex", "HSBC", "Amex", "Revolut", "Otro"];
const TIPOS: { valor: TipoCuenta; nombre: string }[] = [
  { valor: "credito", nombre: "Tarjeta de crédito" },
  { valor: "debito", nombre: "Débito / cuenta" },
  { valor: "efectivo", nombre: "Efectivo" },
  { valor: "ajena", nombre: "De otra persona" },
];

export default function Cuentas({ d }: { d: Datos }) {
  const [editando, setEditando] = useState<Cuenta | "nueva" | null>(null);
  const usos = (id: string) => d.movimientos.filter((m) => m.cuentaId === id).length;
  const activas = d.cuentas.filter((c) => !c.archivada);
  const archivadas = d.cuentas.filter((c) => c.archivada);

  return (
    <Pantalla titulo="Cuentas" atras="mas" accion={<Boton tipo="secundario" className="text-sm" onClick={() => setEditando("nueva")}>+ Nueva</Boton>}>
      <p className="mb-3 px-1 text-sm text-suave">
        Las tarjetas se crean solas al subir su estado de cuenta. Aquí puedes agregar otras (débito, efectivo, una tarjeta sin
        estado o la de otra persona, como la de tu abuela), cambiarles el nombre o archivarlas.
      </p>
      <Tarjeta className="py-1">
        {activas.map((c) => (
          <Fila key={c.id} onClick={() => setEditando(c)} izquierda={c.nombre}
            sub={`${TIPOS.find((t) => t.valor === c.tipo)?.nombre}${c.terminacion ? ` · ••${c.terminacion}` : ""} · ${usos(c.id)} movimientos`} derecha="›" />
        ))}
      </Tarjeta>
      {archivadas.length > 0 && (
        <>
          <p className="mb-1 mt-5 px-1 text-[13px] font-semibold uppercase tracking-wide text-suave">Archivadas</p>
          <Tarjeta className="py-1">
            {archivadas.map((c) => (
              <Fila key={c.id} onClick={() => setEditando(c)} izquierda={<span className="text-suave">{c.nombre}</span>} sub={`${usos(c.id)} movimientos`} derecha="›" />
            ))}
          </Tarjeta>
        </>
      )}

      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando === "nueva" ? "Nueva cuenta" : "Editar cuenta"}>
        {editando && (
          <FormCuenta key={editando === "nueva" ? "nueva" : editando.id} cuenta={editando === "nueva" ? undefined : editando}
            usos={editando === "nueva" ? 0 : usos(editando.id) + d.estados.filter((e) => e.cuentaId === editando.id).length + d.msi.filter((x) => x.cuentaId === editando.id).length}
            esLaUltima={d.cuentas.length <= 1}
            cerrar={() => setEditando(null)} />
        )}
      </Hoja>
    </Pantalla>
  );
}

function FormCuenta({ cuenta, usos, cerrar, esLaUltima }: { cuenta?: Cuenta; usos: number; cerrar: () => void; esLaUltima?: boolean }) {
  const [nombre, setNombre] = useState(cuenta?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoCuenta>(cuenta?.tipo ?? "credito");
  const [banco, setBanco] = useState<Banco | "">(cuenta?.banco ?? "");
  const [terminacion, setTerminacion] = useState(cuenta?.terminacion ?? "");

  async function guardar() {
    await db.cuentas.put({
      ...cuenta,
      id: cuenta?.id ?? uid(),
      nombre: nombre.trim() || "Cuenta",
      tipo,
      banco: banco || null,
      terminacion: terminacion.replace(/\D/g, "").slice(-4) || undefined,
    });
    cerrar();
  }
  async function archivar(archivada: boolean) {
    if (cuenta) await db.cuentas.update(cuenta.id, { archivada });
    cerrar();
  }
  async function borrar() {
    if (cuenta && usos === 0 && !esLaUltima && confirm(`¿Borrar "${cuenta.nombre}"?`)) { await db.cuentas.delete(cuenta.id); cerrar(); }
  }

  return (
    <div>
      <Campo etiqueta="Nombre"><input className={claseCampo} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === "ajena" ? "Ej. Tarjeta de la abuela" : "Ej. Revolut, Débito BBVA"} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Tipo">
          <select className={claseCampo} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCuenta)}>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Banco">
          <select className={claseCampo} value={banco} onChange={(e) => setBanco(e.target.value as Banco | "")}>
            {BANCOS.map((b) => <option key={b} value={b}>{b === "" ? "Ninguno" : b === "Amex" ? "American Express" : b}</option>)}
          </select>
        </Campo>
      </div>
      {tipo === "ajena" ? (
        <p className="mb-3 px-1 text-xs text-suave">Lo que pagues con ella cuenta como gasto tuyo en tu mes, pero no va a ninguna de tus tarjetas ni a sus estados de cuenta.</p>
      ) : (
        <Campo etiqueta="Últimos 4 dígitos (opcional)" ayuda="Sirven para que el estado de cuenta se junte con esta tarjeta.">
          <input className={claseCampo} inputMode="numeric" value={terminacion} onChange={(e) => setTerminacion(e.target.value)} />
        </Campo>
      )}
      <Boton className="w-full" onClick={guardar}>Guardar</Boton>
      {cuenta && (
        cuenta.archivada
          ? <Boton tipo="secundario" className="mt-2 w-full" onClick={() => archivar(false)}>Volver a usarla</Boton>
          : <Boton tipo="secundario" className="mt-2 w-full" onClick={() => archivar(true)}>Archivar (ya no la uso)</Boton>
      )}
      {cuenta && (esLaUltima
        ? <p className="mt-3 px-1 text-xs text-suave">Es tu única cuenta: necesitas al menos una.</p>
        : usos === 0
        ? <Boton tipo="peligro" className="mt-2 w-full" onClick={borrar}>Borrar cuenta</Boton>
        : <p className="mt-3 px-1 text-xs text-suave">No se puede borrar porque tiene {usos} registros. Archívala para ocultarla.</p>)}
    </div>
  );
}
