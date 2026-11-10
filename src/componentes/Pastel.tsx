import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { COLOR_OTROS, SERIE } from "../lib/colores";
import type { ResumenMes } from "../lib/calculos";
import { nombreMes, pesos, pesosCorto, sumarMeses } from "../lib/util";

export interface Rebanada { nombre: string; valor: number; color: string }

const estiloTooltip = { background: "var(--superficie)", border: "1px solid var(--linea)", borderRadius: 12, fontSize: 13, color: "var(--tinta)" };

/** Junta las rebanadas chicas en "Otros" para que el pastel se lea (máximo `cuantas` rebanadas). */
function agrupar(datos: Rebanada[], cuantas: number): Rebanada[] {
  const limpias = datos.filter((x) => x.valor > 0.5);
  if (limpias.length <= cuantas) return limpias;
  // La categoría "Otros" (sin identificar) también va dentro de la rebanada "Otros": si no, salen dos con el mismo nombre
  const orden = [...limpias].sort((a, b) => b.valor - a.valor).sort((a, b) => Number(a.nombre === "Otros") - Number(b.nombre === "Otros"));
  const resto = orden.slice(cuantas - 1).reduce((s, x) => s + x.valor, 0);
  return [...orden.slice(0, cuantas - 1), { nombre: "Otros", valor: resto, color: COLOR_OTROS }];
}

/**
 * Gráfica de pastel (o dona, si lleva algo al centro) con su leyenda: monto y porcentaje de cada rebanada.
 * La leyenda siempre va: así no hay que adivinar por el color.
 */
export default function Pastel({ datos, centro, cuantas = 7, vacio = "Nada que mostrar todavía.", total: totalFijo }: {
  datos: Rebanada[]; centro?: ReactNode; cuantas?: number; vacio?: string; total?: number;
}) {
  const rebanadas = agrupar(datos, cuantas);
  const total = totalFijo ?? rebanadas.reduce((s, x) => s + x.valor, 0);
  if (rebanadas.length === 0 || total <= 0) return <p className="py-6 text-center text-suave">{vacio}</p>;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;

  return (
    // Se acomoda según el espacio de su tarjeta (no de la pantalla): en columnas angostas la leyenda va abajo
    <div className="@container">
    <div className="flex flex-col items-center gap-4 @md:flex-row">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie isAnimationActive={false} data={rebanadas} dataKey="valor" nameKey="nombre" startAngle={90} endAngle={-270}
              innerRadius={centro ? "60%" : 0} outerRadius="100%" stroke="var(--superficie)" strokeWidth={2}>
              {rebanadas.map((x) => <Cell key={x.nombre} fill={x.color} />)}
            </Pie>
            <Tooltip contentStyle={estiloTooltip} formatter={(v, n) => [`${pesos(Number(v))} · ${pct(Number(v))}`, n]} />
          </PieChart>
        </ResponsiveContainer>
        {centro && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{centro}</div>}
      </div>
      <ul className="w-full space-y-2 text-sm">
        {rebanadas.map((x) => (
          <li key={x.nombre} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <i className="size-3 shrink-0 rounded-full" style={{ background: x.color }} />
              <span className="truncate">{x.nombre}</span>
            </span>
            <span className="cifras shrink-0">{pesosCorto(x.valor)} <span className="inline-block w-9 text-right text-suave">{pct(x.valor)}</span></span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}

/** Centro de la dona: una etiqueta y una cifra. */
export function Centro({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <>
      <span className="text-xs text-suave">{etiqueta}</span>
      <span className="cifras text-lg font-bold">{pesosCorto(valor)}</span>
    </>
  );
}

/** A dónde se va tu sueldo del mes: lo fijo, el ahorro, lo que ya gastaste y lo que te queda. */
export function PastelSueldo({ r }: { r: ResumenMes }) {
  const gastado = r.gastado;
  return (
    <Pastel cuantas={8} vacio="Agrega tus ingresos en Ajustes para ver a dónde se va tu sueldo."
      total={Math.max(r.ingresos, r.prestamos + r.msiPropio + r.fijos + r.ahorro - r.arrastre + gastado)}
      centro={<Centro etiqueta="Ingresos" valor={r.ingresos} />}
      datos={r.ingresos > 0 ? [
        { nombre: "Préstamos", valor: r.prestamos, color: SERIE[0] },
        { nombre: "Tus compras a meses", valor: r.msiPropio, color: SERIE[1] },
        { nombre: "Gastos fijos", valor: r.fijos, color: SERIE[2] },
        { nombre: "Ahorro", valor: r.ahorro, color: SERIE[3] },
        { nombre: `Te pasaste en ${nombreMes(sumarMeses(r.mes, -1)).split(" ")[0].toLowerCase()}`, valor: -r.arrastre, color: "var(--alerta)" },
        { nombre: r.disponible < 0 ? "Gastado (te pasaste)" : "Ya gastaste", valor: gastado, color: SERIE[4] },
        { nombre: "Te queda", valor: Math.max(0, r.disponible), color: "var(--linea)" },
      ] : []} />
  );
}
