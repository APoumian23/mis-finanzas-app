import type { Datos } from "../hooks";
import { estimarProximoMes } from "../lib/calculos";
import { categoriaCorta, colorCategoria, SERIE } from "../lib/colores";
import { hoyISO, nombreMes, pesos, pesosCorto, sumarMeses } from "../lib/util";
import { Barra, Tarjeta, Titulo } from "./ui";

/** Estimado del mes que viene: lo fijo es exacto; tu gasto del día a día, según cómo vas. */
export default function ProximoMes({ d }: { d: Datos }) {
  const e = estimarProximoMes(d, hoyISO());
  const r = e.resumen;
  if (r.ingresos <= 0) return null;
  const partes = [
    { nombre: `Te pasaste en ${nombreMes(sumarMeses(e.mes, -1)).split(" ")[0].toLowerCase()}`, monto: -r.arrastre, color: "var(--alerta)" },
    { nombre: "Préstamos", monto: r.prestamos, color: SERIE[0] },
    { nombre: "Tus compras a meses", monto: r.msiPropio, color: SERIE[1] },
    { nombre: "Gastos fijos", monto: r.fijos, color: SERIE[2] },
    { nombre: "Ahorro", monto: r.ahorro, color: SERIE[3] },
    { nombre: "Tus cosas (estimado)", monto: e.gasto, color: SERIE[4] },
    { nombre: "Intereses (si sigues igual)", monto: e.intereses, color: "var(--alerta)" },
  ].filter((p) => p.monto > 0.5);
  const total = Math.max(r.ingresos, partes.reduce((s, p) => s + p.monto, 0));
  const falta = e.quedaria < 0;

  return (
    <>
      <Titulo>{`${nombreMes(e.mes)} · estimado`}</Titulo>
      <Tarjeta>
        <p className="text-base font-medium text-suave">{falta ? "Si sigues así, te faltarían" : "Si sigues así, te quedarían"}</p>
        <p className={`cifras text-4xl font-bold tracking-tight ${falta ? "text-alerta" : "text-acento"}`}>≈ {pesosCorto(Math.abs(e.quedaria))}</p>
        <p className="cifras mt-1 text-sm text-suave">De tus {pesosCorto(r.ingresos)} de ingresos</p>

        {/* A dónde se iría el ingreso: una barra con cada parte; lo que pasa del ingreso se ve en rojo */}
        <div className="mt-4 flex h-5 w-full overflow-hidden rounded-full bg-hundido" role="img" aria-label="Reparto estimado del ingreso">
          {partes.map((p) => (
            <span key={p.nombre} style={{ width: `${(p.monto / total) * 100}%`, background: p.color }} className="h-full border-r-2 border-superficie last:border-0" />
          ))}
        </div>
        {falta && <p className="mt-1 text-right text-xs font-semibold text-alerta">Lo que pasa de tu ingreso: {pesos(-e.quedaria)}</p>}
        <ul className="mt-3 space-y-1.5 text-sm">
          {partes.map((p) => (
            <li key={p.nombre} className="flex justify-between gap-2">
              <span className="flex items-center gap-2"><i className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />{p.nombre}</span>
              <span className="cifras">{pesos(p.monto)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl bg-hundido p-3 text-sm">
          <p className="font-semibold">Cómo sale lo de tus cosas</p>
          <div className="cifras mt-1.5 space-y-1 text-suave">
            {e.promedio !== null && <p className="flex justify-between"><span>Promedio de {e.mesesPromedio === 1 ? "tu último mes" : `tus últimos ${e.mesesPromedio} meses`}</span><span>{pesos(e.promedio)}</span></p>}
            {e.ritmo !== null && <p className="flex justify-between"><span>A tu ritmo de este mes</span><span>{pesos(e.ritmo)}</span></p>}
            <p className="flex justify-between font-semibold text-tinta"><span>Estimado</span><span>{pesos(e.gasto)}</span></p>
          </div>
          {e.excluidas.length > 0 && <p className="mt-1.5 text-xs text-suave">No cuenta {e.excluidas.join(" ni ")}: fue de una vez; si vuelve a haber, anótalo como gasto.</p>}
          <p className="mt-1.5 text-xs text-suave">Si este mes hubo una compra grande que no se repite, el estimado sale alto: tómalo como el peor caso.</p>
        </div>

        {e.porCategoria.length > 0 && (
          <>
            <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-suave">Por categoría</p>
            {e.porCategoria.slice(0, 6).map((c) => (
              <div key={c.categoria} className="py-1.5">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: colorCategoria(c.categoria) }} />{categoriaCorta(c.categoria)}</span>
                  <span className="cifras">≈ {pesosCorto(c.estimado)}{c.tope ? <span className="text-suave"> / {pesosCorto(c.tope)}</span> : null}</span>
                </div>
                {c.tope ? <Barra valor={c.estimado} maximo={c.tope} alto="h-1.5" /> : null}
              </div>
            ))}
          </>
        )}
      </Tarjeta>
    </>
  );
}
