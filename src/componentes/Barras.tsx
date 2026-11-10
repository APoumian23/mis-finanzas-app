import { useState } from "react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pesos, pesosK } from "../lib/util";

export interface Serie { clave: string; nombre: string; color: string }
type Fila = Record<string, number | string>;

/**
 * Barras (apiladas si hay varias series) con el total arriba de cada una. Al tocar una barra,
 * abajo se desglosa ese mes: cuánto fue de cada serie. Así las cantidades siempre se ven,
 * sin depender de pasar el dedo o el mouse por encima.
 */
export default function Barras({ datos, series, etiqueta = "mes", etiquetaLarga = etiqueta, inicial, referencia, colorDe, alto = "h-52" }: {
  datos: Fila[]; series: Serie[]; etiqueta?: string;
  /** Campo con el nombre completo del mes para el desglose (el eje usa `etiqueta`, que puede ir corta). */
  etiquetaLarga?: string;
  /** Barra que se desglosa al abrir (por defecto la última). */
  inicial?: number;
  /** Línea punteada de referencia ("Te alcanza $7,562"). */
  referencia?: { valor: number; texto: string };
  /** Color por barra (solo con una serie): p. ej. rojo si se pasó del límite. */
  colorDe?: (fila: Fila) => string;
  alto?: string;
}) {
  const [elegida, setElegida] = useState(inicial ?? datos.length - 1);
  const filas: (Fila & { _total: number })[] = datos.map((f) => ({ ...f, _total: series.reduce((s, x) => s + (Number(f[x.clave]) || 0), 0) }));
  const muchas = filas.length > 8;
  const arriba = (f: Fila) => [...series].reverse().find((x) => Number(f[x.clave]) > 0)?.clave;
  const maximo = Math.max(...filas.map((f) => f._total), referencia?.valor ?? 0);
  const fila = filas[elegida] ?? filas[filas.length - 1];

  return (
    <div>
      <div className={alto}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={filas} margin={{ top: 20, right: 4, left: 4, bottom: 0 }} barCategoryGap="18%"
            onClick={(e) => { const i = Number(e?.activeTooltipIndex ?? e?.activeIndex); if (Number.isInteger(i) && i >= 0) setElegida(i); }}>
            {/* Sin cuadro flotante: solo sirve para saber qué mes se tocó (el desglose va abajo) */}
            <Tooltip content={() => null} cursor={{ fill: "var(--hundido)" }} />
            <XAxis dataKey={etiqueta} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: "var(--suave)" }} />
            <YAxis hide domain={[0, maximo * 1.08]} />
            {referencia && (
              <ReferenceLine y={referencia.valor} stroke="var(--suave)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            )}
            {series.map((s, i) => (
              <Bar key={s.clave} isAnimationActive={false} dataKey={s.clave} stackId="a" fill={s.color} className="cursor-pointer"
                stroke="var(--superficie)" strokeWidth={series.length > 1 ? 1 : 0}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}>
                {filas.map((f, k) => (
                  <Cell key={k} fill={colorDe ? colorDe(f) : s.color} fillOpacity={k === elegida ? 1 : 0.55} />
                ))}
                {/* El total va sobre el pedazo de más arriba de cada barra */}
                <LabelList dataKey={s.clave} content={(p) => {
                  const k = Number(p.index);
                  const f = filas[k];
                  if (!f || f._total <= 0 || arriba(f) !== s.clave) return null;
                  const x = Number(p.x) + Number(p.width) / 2;
                  return (
                    <text x={x} y={Number(p.y) - 5} textAnchor="middle" fontSize={muchas ? 9.5 : 10.5} fontWeight={600} fill="var(--tinta)">
                      {muchas ? pesosK(f._total).replace("$", "") : pesosK(f._total)}
                    </text>
                  );
                }} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {referencia && (
        <p className="mt-1 flex items-center gap-2 text-xs text-suave">
          <i className="inline-block w-5 border-t-2 border-dashed border-suave" />{referencia.texto}
        </p>
      )}

      {fila && (
        <div className="mt-3 rounded-xl bg-hundido px-3 py-2.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold capitalize">{String(fila[etiquetaLarga])}</span>
            <span className="cifras font-bold">{pesos(fila._total)}</span>
          </div>
          {series.length > 1 && (
            <ul className="mt-1.5 space-y-1 text-sm">
              {series.filter((s) => Number(fila[s.clave]) > 0).map((s) => (
                <li key={s.clave} className="flex justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2"><i className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.nombre}</span></span>
                  <span className="cifras shrink-0">{pesos(Number(fila[s.clave]))}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-suave">Toca otra barra para ver ese mes.</p>
        </div>
      )}
    </div>
  );
}
