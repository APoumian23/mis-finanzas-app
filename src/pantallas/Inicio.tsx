import { useState } from "react";
import { AccionesRapidas, PagoTarjeta as PagoTarjetaHoja, minimoQueFalta } from "../componentes/Acciones";
import Barras from "../componentes/Barras";
import LibreDeDeudas from "../componentes/LibreDeDeudas";
import Pastel, { Centro, PastelSueldo } from "../componentes/Pastel";
import ProximoMes from "../componentes/ProximoMes";
import { Aviso, Barra, Boton, Fila, Hoja, Medidor, Pantalla, SelectorMes, Tarjeta, Titulo } from "../componentes/ui";
import type { Datos } from "../hooks";
import { estadoPrestamo, pagadoDe as pagadoMovs, resumenMes, tarjetasPorPagar, todosLosDeudores } from "../lib/calculos";
import { calendarioDePagos } from "../lib/calendario";
import { ultimoRespaldo } from "../lib/util";
import { useEstadoSync } from "./Cuenta";
import { categoriaCorta, colorCategoria } from "../lib/colores";
import type { EstadoCuenta } from "../lib/tipos";
import { etiquetaMes, fechaCorta, hoyISO, mesDe, nombreMes, pesos, pesosCorto, sumar, sumarMeses } from "../lib/util";

export const pagadoDe = (e: EstadoCuenta, d: Datos) => pagadoMovs(e, d.movimientos);

const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);

export default function Inicio({ d }: { d: Datos }) {
  const hoy = hoyISO();
  const [mes, setMes] = useState(mesDe(hoy));
  const [pagando, setPagando] = useState<string | null>(null);
  const sync = useEstadoSync();
  const r = resumenMes(mes, d, hoy);
  const mesAnterior = nombreMes(sumarMeses(mes, -1)).split(" ")[0].toLowerCase(); // "octubre"
  const esteMes = mes === mesDe(hoy);
  const nombreCuenta = new Map(d.cuentas.map((c) => [c.id, c.nombre]));

  const porPagar = tarjetasPorPagar(d.estados, d.movimientos, hoy);

  const deudores = todosLosDeudores(d.deudores, d.movimientos, d.msi);
  const teDeben = deudores.total;
  const meses = Array.from({ length: 6 }, (_, i) => sumarMeses(mesDe(hoy), i - 5));
  const tendencia = meses.map((m) => ({ mes: etiquetaMes(m), mesLargo: nombreMes(m), gastado: resumenMes(m, d, hoy).gastado }));

  return (
    <Pantalla titulo="Mis finanzas" amplia>
      <SelectorMes mes={mes} setMes={setMes} />

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div>
          <Tarjeta>
            {/* Lo que te pasaste el mes anterior cuenta como ya usado de lo que te alcanza este mes */}
            <Medidor gastado={r.gastado - r.arrastre} limite={r.paraTi} />
            <div className="-mt-1 text-center">
              <p className="text-base font-medium text-suave">{r.disponible >= 0 ? "Te quedan para tus cosas" : "Te pasaste por"}</p>
              <p className={`cifras text-5xl font-bold leading-tight tracking-tight ${r.disponible < 0 ? "text-alerta" : ""}`}>{pesosCorto(Math.abs(r.disponible))}</p>
              <p className="cifras mt-1 text-base text-suave">
                {r.paraTi + r.arrastre > 0
                  ? `Gastaste ${pesosCorto(r.gastado)} de ${pesosCorto(r.paraTi + r.arrastre)}`
                  : `Gastaste ${pesosCorto(r.gastado)}; empezaste el mes ${pesosCorto(-(r.paraTi + r.arrastre))} abajo`}
              </p>
              {r.arrastre < 0 && (
                <p className="cifras mt-1 text-sm text-alerta">
                  Tenías {pesosCorto(r.paraTi)} para tus cosas; le quité {pesosCorto(-r.arrastre)} que te pasaste en {mesAnterior}
                </p>
              )}
              {esteMes && r.diasRestantes > 0 && r.disponible > 0 && (
                <p className="mt-2 inline-block rounded-full bg-acento-suave px-3 py-1 text-base font-semibold text-acento">
                  <span className="cifras">{pesosCorto(r.porDia)}</span> al día · {r.diasRestantes} {r.diasRestantes === 1 ? "día" : "días"}
                </p>
              )}
            </div>
            {r.ingresos <= 0 ? (
              <div className="mt-3"><Aviso tipo="info">Anota tus ingresos en <a href="#/ajustes" className="underline">Ajustes</a> para saber cuánto te queda cada mes.</Aviso></div>
            ) : r.paraTi <= 0 && (
              <div className="mt-3"><Aviso tipo="alerta">Tus gastos fijos y préstamos se comen todo tu ingreso. Revisa tus fijos en <a href="#/ajustes" className="underline">Ajustes</a>.</Aviso></div>
            )}
          </Tarjeta>

          {esteMes && <div className="mt-3"><AccionesRapidas d={d} /></div>}

          {esteMes && <LoQueSigue d={d} />}

          {porPagar.length > 0 && (
            <>
              <Titulo extra={<a href="#/calendario" className="text-sm font-semibold text-acento">Calendario</a>}>Por pagar</Titulo>
              <div className="space-y-2.5">
                {porPagar.map(({ e, falta, vencido }) => {
                  const quedan = dias(hoy, e.fechaLimite!);
                  const minimo = minimoQueFalta(e, d);
                  const urgente = vencido || quedan <= 3;
                  return (
                    <Tarjeta key={e.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold">{nombreCuenta.get(e.cuentaId)}</p>
                          <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${urgente ? "bg-alerta-suave text-alerta" : "bg-hundido text-suave"}`}>
                            {vencido ? "Vencida" : quedan === 0 ? "Vence hoy" : quedan === 1 ? "Vence mañana" : `Vence en ${quedan} días · ${fechaCorta(e.fechaLimite!)}`}
                          </span>
                        </div>
                        <p className="cifras shrink-0 text-2xl font-bold">{pesosCorto(falta)}</p>
                      </div>
                      <p className="mt-2 text-sm text-suave">
                        {e.soloDe ? "Tu parte de la tarjeta." : "Para no pagar intereses."}
                        {minimo !== undefined && minimo > 0 && minimo < falta ? <> Mínimo <strong className="cifras text-tinta">{pesos(minimo)}</strong>.</> : null}
                        {minimo === 0 ? " El mínimo ya está cubierto." : null}
                        {vencido && e.tasaAnual ? ` Cobra ${(e.tasaAnual * 100).toFixed(1)}% al año.` : null}
                      </p>
                      <Boton tipo={urgente ? "primario" : "secundario"} className="mt-3 min-h-12 w-full" onClick={() => setPagando(e.cuentaId)}>Anotar pago</Boton>
                    </Tarjeta>
                  );
                })}
              </div>
              <Hoja abierta={!!pagando} onCerrar={() => setPagando(null)} titulo="¿Cuánto pagaste?">
                {pagando && <PagoTarjetaHoja d={d} cuentaId={pagando} cerrar={() => setPagando(null)} />}
              </Hoja>
            </>
          )}

          {esteMes && <div className="mt-6"><LibreDeDeudas d={d} /></div>}

          {/* Con tu cuenta conectada los datos ya están en tu servidor: el respaldo a mano es opcional */}
          {d.movimientos.length > 0 && sync && !sync.meta.usuario && (() => {
            const ultimo = ultimoRespaldo();
            const dias = ultimo ? Math.round((Date.parse(hoy) - Date.parse(ultimo)) / 86_400_000) : null;
            return dias === null || dias > 30 ? (
              <div className="mt-3"><Aviso tipo="info">
                {dias === null ? "Aún no guardas un respaldo." : `Tu último respaldo fue hace ${dias} días.`} Sin cuenta, tus datos viven solo en este teléfono:{" "}
                <a href="#/cuenta" className="underline">entra con tu cuenta</a> o <a href="#/mas" className="underline">guarda un respaldo</a>.
              </Aviso></div>
            ) : null;
          })()}

          {r.fuga > 0 && (
            <div className="mt-3"><Aviso tipo="alerta">Este mes pagaste {pesos(r.fuga)} de intereses y comisiones. Pagando a tiempo, eso es $0.</Aviso></div>
          )}

        </div>
        <div className="lg:-mt-6">
          <Titulo extra={<a href="#/ajustes" className="text-sm font-semibold text-acento">Editar</a>}>Tu mes</Titulo>
          <Tarjeta>
            <PastelSueldo r={r} />
            <div className="my-3 border-t border-linea" />
            <Fila izquierda="Ingresos" sub={r.ingresosExtra > 0 ? `Incluye ${pesos(r.ingresosExtra)} de ingresos extra` : undefined} derecha={pesos(r.ingresos)} />
            <Fila izquierda="Préstamos" derecha={`− ${pesos(r.prestamos)}`} />
            <Fila izquierda="Tus compras a meses" derecha={`− ${pesos(r.msiPropio)}`} />
            <Fila izquierda="Otros gastos fijos" sub="Escuela, suscripciones, seguros…" derecha={`− ${pesos(r.fijos)}`} />
            <Fila izquierda={<strong>Libre</strong>} derecha={<strong>{pesos(r.libre)}</strong>} />
            <Fila izquierda={`Ahorro (${Math.round(d.ajustes.ahorroPct * 100)}%)`} sub="Fondo de emergencia o abono extra a préstamos" derecha={`− ${pesos(r.ahorro)}`} />
            {r.arrastre < 0 && (
              <Fila izquierda={`Te pasaste en ${mesAnterior}`} sub="Se descuenta de este mes" derecha={<span className="text-alerta">− {pesos(-r.arrastre)}</span>} />
            )}
            <Fila izquierda={<strong>Para tus cosas</strong>} derecha={<strong className="text-acento">{pesos(r.paraTi + r.arrastre)}</strong>} />
          </Tarjeta>

          {esteMes && <ProximoMes d={d} />}

          <Titulo extra={<a href={`#/movimientos?mes=${mes}`} className="text-sm font-semibold text-acento">Ver todo</a>}>En qué se va</Titulo>
          <Tarjeta>
            {r.porCategoria.length === 0 && <p className="py-4 text-center text-suave">Aún no hay gastos este mes.</p>}
            {r.porCategoria.length > 0 && (
              <>
                <Pastel centro={<Centro etiqueta="Gastado" valor={r.gastado} />}
                  datos={r.porCategoria.map((c) => ({ nombre: categoriaCorta(c.categoria), valor: c.monto, color: colorCategoria(c.categoria) }))} />
                {r.porCategoria.some((c) => c.tope) && <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-suave">Contra tus topes</p>}
              </>
            )}
            {r.porCategoria.filter((c) => c.tope).map((c) => (
              <div key={c.categoria} className="py-2">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="flex items-center gap-2"><i className="inline-block size-2.5 rounded-full" style={{ background: colorCategoria(c.categoria) }} />{categoriaCorta(c.categoria)}</span>
                  <span className="cifras">{pesosCorto(c.monto)}{c.tope ? <span className="text-suave"> / {pesosCorto(c.tope)}</span> : null}</span>
                </div>
                {c.tope ? <Barra valor={c.monto} maximo={c.tope} alto="h-1.5" /> : null}
              </div>
            ))}
          </Tarjeta>

          <Titulo extra={<a href="#/graficas" className="text-sm font-semibold text-acento">Gráficas</a>}>Lo que gastas en tus cosas</Titulo>
          <Tarjeta>
            <p className="mb-1 text-sm text-suave">Cada barra es un mes. Si pasa la línea, gastaste más de lo que te alcanzaba.</p>
            <Barras datos={tendencia} etiquetaLarga="mesLargo" series={[{ clave: "gastado", nombre: "Gastado en tus cosas", color: "var(--acento)" }]}
              referencia={{ valor: r.paraTi, texto: `Lo que te alcanza al mes: ${pesos(r.paraTi)}` }}
              colorDe={(f) => (Number(f.gastado) > r.paraTi ? "var(--alerta)" : "var(--acento)")} />
          </Tarjeta>

          <Titulo>Préstamos y lo que te deben</Titulo>
          <div className="grid grid-cols-2 gap-3">
            <Tarjeta onClick={() => (window.location.hash = "/prestamos")}>
              <p className="text-sm text-suave">Debes</p>
              <p className="cifras text-xl font-bold">{pesosCorto(sumar(d.prestamos, (p) => estadoPrestamo(p, hoy).saldo))}</p>
              <p className="text-xs text-suave">{d.prestamos.length} préstamos</p>
            </Tarjeta>
            <Tarjeta onClick={() => (window.location.hash = "/por-cobrar")}>
              <p className="text-sm text-suave">Te deben</p>
              <p className="cifras text-xl font-bold text-acento">{pesosCorto(teDeben)}</p>
              <p className="text-xs text-suave">{deudores.lista.length + deudores.sinLista.length} personas</p>
            </Tarjeta>
          </div>
        </div>
      </div>
    </Pantalla>
  );
}

/** Lo próximo que entra y los pagos de préstamos (las tarjetas ya tienen su sección en Por pagar). */
function LoQueSigue({ d }: { d: Datos }) {
  const hoy = hoyISO();
  const proximos = calendarioDePagos(d, hoy, 31).filter((e) => e.tipo === "ingreso" || e.tipo === "prestamo").slice(0, 4);
  if (proximos.length === 0) return null;
  return (
    <>
      <Titulo extra={<a href="#/calendario" className="text-sm font-semibold text-acento">Calendario</a>}>Lo que viene</Titulo>
      <Tarjeta className="py-1" onClick={() => (window.location.hash = "/calendario")}>
        {proximos.map((ev, i) => {
          const enDias = dias(hoy, ev.fecha);
          return (
            <div key={i} className="flex items-center gap-3 border-b border-linea py-3 last:border-0">
              <div className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-xl ${ev.monto > 0 ? "bg-acento-suave text-acento" : ev.vencido ? "bg-alerta-suave text-alerta" : "bg-hundido"}`}>
                <span className="text-lg font-bold leading-none">{Number(ev.fecha.slice(8))}</span>
                <span className="text-xs">{fechaCorta(ev.fecha).split(" ")[1]}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{ev.concepto}</p>
                <p className="text-sm text-suave">{ev.vencido ? "Vencida" : enDias === 0 ? "Hoy" : enDias === 1 ? "Mañana" : `En ${enDias} días`}</p>
              </div>
              <p className={`cifras shrink-0 text-lg font-semibold ${ev.monto > 0 ? "text-acento" : ""}`}>{ev.monto > 0 ? "+" : "−"}{pesosCorto(Math.abs(ev.monto))}</p>
            </div>
          );
        })}
      </Tarjeta>
    </>
  );
}
