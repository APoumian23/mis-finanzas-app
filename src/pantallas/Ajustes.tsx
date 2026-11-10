import { useEffect, useRef, useState } from "react";
import { Boton, Pantalla, Tarjeta, Titulo, claseCampo } from "../componentes/ui";
import type { Datos } from "../hooks";
import { GASTO_PLANEADO_INICIAL, proyectarLibreDeDeudas, resumenMes } from "../lib/calculos";
import { db } from "../lib/db";
import type { Ajustes as TAjustes, GastoFijo, Ingreso } from "../lib/tipos";
import { cambiarTema, temaGuardado, type Tema } from "../lib/tema";
import { aNumero, hoyISO, mesDe, nombreMes, pesos, sumar } from "../lib/util";

const TOPES = [
  "Comida fuera y bares", "OXXO y tiendas de conveniencia", "Súper y despensa", "Farmacia y salud", "Gasolina y auto",
  "Transporte (Uber/Didi/bus)", "Entretenimiento", "Mascotas", "Compras en línea", "Hogar, oficina y servicios",
  "Viajes y hospedaje", "Otros / sin identificar",
];

type Renglon = { concepto: string; monto: string; nota?: string; dia?: number | string };

function Lista({ filas, setFilas, placeholder, conDia }: { filas: Renglon[]; setFilas: (f: Renglon[]) => void; placeholder: string; conDia?: boolean }) {
  const cambiar = (i: number, k: keyof Renglon, v: string) => setFilas(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  return (
    <div className="space-y-2">
      {filas.map((f, i) => (
        <div key={i}>
          <div className="flex gap-2">
            <input className={claseCampo} value={f.concepto} onChange={(e) => cambiar(i, "concepto", e.target.value)} placeholder={placeholder} aria-label="Concepto" />
            {conDia && (
              <input className={`${claseCampo} w-16! shrink-0 text-center`} inputMode="numeric" placeholder="Día" value={f.dia ?? ""}
                onChange={(e) => cambiar(i, "dia", e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="Día del mes en que llega" />
            )}
            <input className={`${claseCampo} w-28! shrink-0 text-right`} inputMode="decimal" value={f.monto} onChange={(e) => cambiar(i, "monto", e.target.value)} aria-label="Monto" />
            <button onClick={() => setFilas(filas.filter((_, j) => j !== i))} className="px-2 text-alerta" aria-label="Quitar">✕</button>
          </div>
          {f.nota && <p className="mt-0.5 px-1 text-xs text-suave">{f.nota}</p>}
        </div>
      ))}
      <button onClick={() => setFilas([...filas, { concepto: "", monto: "" }])} className="text-sm font-semibold text-acento">+ Agregar</button>
    </div>
  );
}

const aRenglones = (xs: (Ingreso | GastoFijo)[]): Renglon[] =>
  xs.map((x) => ({ concepto: x.concepto, monto: String(x.monto), nota: "nota" in x ? x.nota : undefined, dia: "dia" in x ? x.dia : undefined }));

export default function Ajustes({ d }: { d: Datos }) {
  const [ingresos, setIngresos] = useState<Renglon[]>([]);
  const [fijos, setFijos] = useState<Renglon[]>([]);
  const [topes, setTopes] = useState<Record<string, string>>({});
  const [ahorro, setAhorro] = useState("10");
  const [plan, setPlan] = useState(String(GASTO_PLANEADO_INICIAL));
  const [guardado, setGuardado] = useState(false);
  const [listo, setListo] = useState(false);
  const pendiente = useRef<TAjustes | null>(null);

  useEffect(() => {
    setIngresos(aRenglones(d.ajustes.ingresos));
    setFijos(aRenglones(d.ajustes.fijos));
    setTopes(Object.fromEntries(TOPES.map((t) => [t, d.ajustes.topes[t] ? String(d.ajustes.topes[t]) : ""])));
    setAhorro(String(Math.round(d.ajustes.ahorroPct * 100)));
    setPlan(String(d.ajustes.gastoPlaneado ?? GASTO_PLANEADO_INICIAL));
    setListo(true);
    // Si sales antes de que se guarde solo, se guarda al salir
    return () => { if (pendiente.current) void db.ajustes.put(pendiente.current); };
    // solo al abrir la pantalla
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nuevos: TAjustes = {
    ...d.ajustes, // lo que no se edita aquí (p. ej. lo disponible del calendario) se conserva
    id: "ajustes",
    ingresos: ingresos.filter((f) => f.concepto || aNumero(f.monto)).map((f) => ({ concepto: f.concepto || "Ingreso", monto: aNumero(f.monto), ...(Number(f.dia) >= 1 && Number(f.dia) <= 31 ? { dia: Number(f.dia) } : {}) })),
    fijos: fijos.filter((f) => f.concepto || aNumero(f.monto)).map((f) => ({ concepto: f.concepto || "Gasto fijo", monto: aNumero(f.monto), ...(f.nota ? { nota: f.nota } : {}) })),
    ahorroPct: Math.min(90, Math.max(0, aNumero(ahorro))) / 100,
    topes: Object.fromEntries(Object.entries(topes).filter(([, v]) => aNumero(v) > 0).map(([k, v]) => [k, aNumero(v)])),
    gastoPlaneado: aNumero(plan),
  };
  const vista = resumenMes(mesDe(hoyISO()), { ...d, ajustes: nuevos });
  const libre = proyectarLibreDeDeudas({ ...d, ajustes: nuevos });

  async function guardar(datos: TAjustes = nuevos) {
    pendiente.current = null;
    await db.ajustes.put(datos);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 1500);
  }

  // Se guarda solo medio segundo después del último cambio: salir de la pantalla no pierde nada
  const firma = JSON.stringify(nuevos);
  const firmaInicial = useRef<string | null>(null);
  useEffect(() => {
    if (!listo) return;
    if (firmaInicial.current === null) { firmaInicial.current = firma; return; } // abrir la pantalla no guarda nada
    if (firma === firmaInicial.current && !pendiente.current) return;
    const datos = JSON.parse(firma) as TAjustes;
    pendiente.current = datos;
    const t = setTimeout(() => void guardar(datos), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, listo]);

  return (
    <Pantalla titulo="Ajustes" atras="mas">
      <Tarjeta className="sticky top-2 z-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-suave">Con esto te quedan para tus cosas <span className="text-xs">(se guarda solo)</span></p>
            <p className={`cifras text-2xl font-bold ${vista.paraTi < 0 ? "text-alerta" : "text-acento"}`}>{pesos(vista.paraTi)}</p>
          </div>
          <Boton tipo="secundario" onClick={() => guardar()}>{guardado ? "Guardado ✓" : "Guardar"}</Boton>
        </div>
      </Tarjeta>

      <Titulo extra={<span className="cifras text-sm text-suave">{pesos(sumar(nuevos.ingresos, (i) => i.monto))}</span>}>Ingresos al mes</Titulo>
      <Tarjeta>
        <Lista filas={ingresos} setFilas={setIngresos} placeholder="Sueldo, freelance…" conDia />
        <p className="mt-2 text-xs text-suave">El día es cuándo te llega cada mes: así aparece en tu calendario de pagos.</p>
      </Tarjeta>

      <Titulo extra={<span className="cifras text-sm text-suave">{pesos(sumar(nuevos.fijos, (i) => i.monto))}</span>}>Gastos fijos al mes</Titulo>
      <Tarjeta>
        <p className="mb-3 text-xs text-suave">Sin préstamos ni compras a meses (esos se calculan solos). Pon 0 o quita lo que canceles.</p>
        <Lista filas={fijos} setFilas={setFijos} placeholder="Escuela, suscripción…" />
      </Tarjeta>

      <Titulo>Plan para salir de deudas</Titulo>
      <Tarjeta>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Lo que planeas gastar al mes en tus cosas</span>
          <input className={`${claseCampo} w-28! shrink-0 text-right`} inputMode="decimal" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </label>
        <p className="mt-2 text-sm">
          {libre.fin ? <>Así terminas de pagar todo en <strong className="capitalize">{nombreMes(libre.fin)}</strong>.</> : <strong className="text-alerta">Con ese gasto no terminas de pagar.</strong>}
        </p>
        <p className="mt-1 text-xs text-suave">Lo que sobre después de tus fijos, préstamos y esto, se abona al préstamo más caro.</p>
      </Tarjeta>

      <Titulo>Ahorro</Titulo>
      <Tarjeta>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Porcentaje del ingreso que apartas</span>
          <span className="flex items-center gap-1"><input className={`${claseCampo} w-20! shrink-0 text-right`} inputMode="numeric" value={ahorro} onChange={(e) => setAhorro(e.target.value)} />%</span>
        </label>
      </Tarjeta>

      <Titulo>Topes por categoría</Titulo>
      <Tarjeta>
        <p className="mb-3 text-xs text-suave">Si te pasas, la barra se pone roja en Inicio.</p>
        <div className="space-y-2">
          {TOPES.map((t) => (
            <label key={t} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t}</span>
              <input className={`${claseCampo} w-28! shrink-0 text-right`} inputMode="decimal" placeholder="Sin tope" value={topes[t] ?? ""}
                onChange={(e) => setTopes({ ...topes, [t]: e.target.value })} />
            </label>
          ))}
        </div>
      </Tarjeta>

      <Titulo>Apariencia</Titulo>
      <Tarjeta><SelectorTema /></Tarjeta>
    </Pantalla>
  );
}

function SelectorTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado());
  const opciones: { valor: Tema; nombre: string }[] = [
    { valor: "claro", nombre: "Claro" }, { valor: "oscuro", nombre: "Oscuro" }, { valor: "auto", nombre: "Como el teléfono" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-hundido p-1" role="radiogroup" aria-label="Tema">
      {opciones.map((o) => (
        <button key={o.valor} role="radio" aria-checked={tema === o.valor}
          className={`rounded-lg px-2 py-2 text-sm font-medium ${tema === o.valor ? "bg-superficie shadow-sm" : "text-suave"}`}
          onClick={() => { cambiarTema(o.valor); setTema(o.valor); }}>{o.nombre}</button>
      ))}
    </div>
  );
}
