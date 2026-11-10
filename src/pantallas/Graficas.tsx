import { useState } from "react";
import Barras from "../componentes/Barras";
import Pastel, { Centro, PastelSueldo } from "../componentes/Pastel";
import { Pantalla, SelectorMes, Tarjeta, Titulo } from "../componentes/ui";
import { personasDe, type Datos } from "../hooks";
import { diasDeCorte, historialPorTipo, mesContable, msiDelMes, resumenMes } from "../lib/calculos";
import { categoriaCorta, colorCategoria, colorPersona, COLOR_OTROS, COLOR_TIPO, SERIE } from "../lib/colores";
import { etiquetaMes, hoyISO, mesDe, nombreMes, pesos, sumar, sumarMeses } from "../lib/util";


/** Nombres claros de cada tipo de gasto. */
const NOMBRE_TIPO: Record<string, string> = {
  "Fuga financiera": "Intereses y comisiones",
  Recurrente: "Suscripciones y seguros",
  "A meses (MSI)": "Mensualidades a meses",
  "Gasto fuerte": "Gastos de $1,000 o más",
  Variable: "Día a día",
  Hormiga: "Gastos hormiga",
};

export default function Graficas({ d }: { d: Datos }) {
  const hoy = hoyISO();
  const [mes, setMes] = useState(mesDe(hoy));
  const r = resumenMes(mes, d, hoy);
  const ultimos = Array.from({ length: 6 }, (_, i) => sumarMeses(mesDe(hoy), i - 5));

  const pastel = r.porCategoria.map((c) => ({ nombre: categoriaCorta(c.categoria), valor: c.monto, color: colorCategoria(c.categoria) }));
  const todas = personasDe(d);
  const cortes = diasDeCorte(d.estados);
  const cargosDelMes = d.movimientos.filter((m) => mesContable(m, cortes) === mes && m.monto > 0 && m.tipo !== "Informativo" && m.categoria !== "Pago a tarjeta");
  const deQuien = todas.map((p) => ({ nombre: p === "Yo" ? "Tú" : p, valor: sumar(cargosDelMes.filter((m) => m.responsable === p), (m) => m.monto), color: colorPersona(p, todas) }));
  const fijos = [
    { nombre: "Préstamos", valor: r.prestamos },
    { nombre: "Tus compras a meses", valor: r.msiPropio },
    ...d.ajustes.fijos.map((f) => ({ nombre: f.concepto, valor: f.monto })),
  ].map((x, i) => ({ ...x, color: SERIE[i] ?? COLOR_OTROS }));
  const porTipo = historialPorTipo(d.movimientos, ultimos, d.estados).map((f) => ({ ...f, mes: etiquetaMes(f.mes as string), mesLargo: nombreMes(f.mes as string) }));
  const tendencia = ultimos.map((m) => ({ mes: etiquetaMes(m), mesLargo: nombreMes(m), gastado: resumenMes(m, d, hoy).gastado }));
  const proximos = Array.from({ length: 12 }, (_, i) => sumarMeses(mesDe(hoy), i + 1));
  const personas = [...new Set(d.msi.map((c) => c.responsable))];
  const msi = proximos.map((m) => {
    const fila: Record<string, number | string> = { mes: etiquetaMes(m).slice(0, 3), mesLargo: nombreMes(m) };
    for (const p of personas) fila[p] = msiDelMes(d.msi, m, p);
    return fila;
  });

  return (
    <Pantalla titulo="Gráficas" amplia>
      <SelectorMes mes={mes} setMes={setMes} />

      <div className="md:grid md:grid-cols-2 md:gap-x-6">
        <section>
          <Titulo>A dónde se va tu sueldo</Titulo>
          <Tarjeta><PastelSueldo r={r} /></Tarjeta>
        </section>
        <section>
          <Titulo>Tus gastos por categoría</Titulo>
          <Tarjeta>
            <Pastel vacio="Sin gastos este mes." centro={<Centro etiqueta="Gastado" valor={r.gastado} />} datos={pastel} />
          </Tarjeta>
        </section>
        <section>
          <Titulo>De quién son los cargos a tus tarjetas</Titulo>
          <Tarjeta>
            <Pastel vacio="Sin cargos este mes." centro={<Centro etiqueta="Cargado" valor={sumar(deQuien, (x) => x.valor)} />} datos={deQuien} />
            <p className="mt-3 text-xs text-suave">Todo lo que se cargó este mes (compras, mensualidades, servicios), según de quién es.</p>
          </Tarjeta>
        </section>
        <section>
          <Titulo>Tus gastos fijos al mes</Titulo>
          <Tarjeta>
            <Pastel vacio="Agrega tus gastos fijos en Ajustes." centro={<Centro etiqueta="Fijos" valor={r.totalFijos} />} datos={fijos} />
          </Tarjeta>
        </section>
        <section>
          <Titulo>Lo que gastas en tus cosas</Titulo>
          <Tarjeta>
            <p className="mb-1 text-sm text-suave">Cada barra es un mes. Si pasa la línea, gastaste más de lo que te alcanzaba.</p>
            <Barras datos={tendencia} etiquetaLarga="mesLargo" series={[{ clave: "gastado", nombre: "Gastado en tus cosas", color: "var(--acento)" }]}
              referencia={{ valor: r.paraTi, texto: `Lo que te alcanza al mes: ${pesos(r.paraTi)}` }}
              colorDe={(f: Record<string, number | string>) => (Number(f.gastado) > r.paraTi ? "var(--alerta)" : "var(--acento)")} />
          </Tarjeta>
        </section>
        <section>
          <Titulo>Todo lo que sale de tu bolsa, por tipo</Titulo>
          <Tarjeta>
            <Barras datos={porTipo} etiquetaLarga="mesLargo" series={Object.entries(COLOR_TIPO).map(([t, c]) => ({ clave: t, nombre: NOMBRE_TIPO[t] ?? t, color: c }))} />
          </Tarjeta>
        </section>
        <section className="md:col-span-2">
          <Titulo>Compras a meses: lo que se cargará cada mes</Titulo>
          <Tarjeta>
            <Barras datos={msi} inicial={0} etiquetaLarga="mesLargo"
              series={personas.map((p) => ({ clave: p, nombre: p === "Yo" ? "Tú" : p, color: colorPersona(p, todas) }))} />
          </Tarjeta>
        </section>
      </div>
    </Pantalla>
  );
}
