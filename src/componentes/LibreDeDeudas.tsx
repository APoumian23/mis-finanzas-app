import { useEffect, useState } from "react";
import type { Datos } from "../hooks";
import { GASTO_PLANEADO_INICIAL, proyectarLibreDeDeudas } from "../lib/calculos";
import { diferenciaMeses, etiquetaMes, hoyISO, mesDe, nombreMes, pesosCorto } from "../lib/util";

const CLAVE = "libre-de-deudas";

/** Recuerda la última fecha calculada para decir si tu último abono o gasto la movió. */
function useCambio(fin: string | null, hayDeudas: boolean): number {
  const [cambio, setCambio] = useState(0);
  useEffect(() => {
    if (!fin || !hayDeudas) return; // sin deudas no hay contra qué comparar (app vacía o recién restaurada)
    try {
      const previo = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as { fin: string; cambio: number } | null;
      const nuevo = previo && previo.fin !== fin ? diferenciaMeses(fin, previo.fin) : previo?.cambio ?? 0;
      localStorage.setItem(CLAVE, JSON.stringify({ fin, cambio: nuevo }));
      setCambio(nuevo);
    } catch {
      // sin almacenamiento local no hay comparación; la fecha se muestra igual
    }
  }, [fin, hayDeudas]);
  return cambio;
}

export default function LibreDeDeudas({ d }: { d: Datos }) {
  const hoy = hoyISO();
  const p = proyectarLibreDeDeudas(d, hoy);
  const cambio = useCambio(p.fin, p.deudaTotal > 0);
  if (p.deudaTotal <= 0 && !p.finMSI) return null;
  const faltan = p.fin ? diferenciaMeses(mesDe(hoy), p.fin) : null;
  const plan = d.ajustes.gastoPlaneado ?? GASTO_PLANEADO_INICIAL;

  return (
    <section className="mb-3 rounded-2xl bg-acento p-4 text-white dark:text-black">
      <p className="text-sm font-medium opacity-90">Libre de deudas en</p>
      {p.fin ? (
        <p className="text-[30px] font-bold capitalize leading-tight tracking-tight">{nombreMes(p.fin)}</p>
      ) : (
        <p className="text-xl font-bold leading-tight">Con este ritmo no se terminan</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-90">
        {faltan !== null && <span>Faltan {faltan} {faltan === 1 ? "mes" : "meses"}</span>}
        <span className="cifras">Debes {pesosCorto(p.deudaTotal)}</span>
        {cambio !== 0 && (
          <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold">
            {cambio > 0 ? `▲ ${cambio} ${cambio === 1 ? "mes" : "meses"} antes` : `▼ ${-cambio} ${cambio === -1 ? "mes" : "meses"} después`}
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-1.5 text-sm">
        {[...p.porPrestamo].sort((a, b) => (a.fin ?? "9999").localeCompare(b.fin ?? "9999")).map((x) => (
          <div key={x.id} className="flex justify-between gap-2">
            <span className="truncate">{x.nombre}</span>
            <span className="cifras shrink-0 font-semibold capitalize">{x.fin ? (x.saldo <= 0.01 ? "Pagado ✓" : etiquetaMes(x.fin)) : "—"}</span>
          </div>
        ))}
        {p.finMSI && (
          <div className="flex justify-between gap-2">
            <span>Tus compras a meses</span><span className="shrink-0 font-semibold capitalize">{etiquetaMes(p.finMSI)}</span>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs opacity-85">
        Si gastas {pesosCorto(plan)} al mes en tus cosas y abonas lo que sobre al préstamo más caro.
        {p.extraEsteMes > 0 && <> Este mes puedes abonar extra {pesosCorto(p.extraEsteMes)}.</>}
        {" "}<a href="#/ajustes" className="underline">Cambiar</a>
      </p>
    </section>
  );
}
