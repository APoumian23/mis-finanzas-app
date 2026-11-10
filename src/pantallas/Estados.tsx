import { useRef, useState } from "react";
import { Aviso, Boton, Pantalla, Tarjeta, Titulo, Vacio } from "../componentes/ui";
import type { Datos } from "../hooks";
import { importarEstado, quitarEstado, soloTuParte, yaImportado, type ResultadoImportacion } from "../lib/importarEstado";
import type { EstadoLeido } from "../lib/tipos";
import { fechaCorta, hoyISO, pesos, sumar } from "../lib/util";
import { pagadoDe } from "./Inicio";

interface Leido {
  archivo: string;
  estado?: EstadoLeido;
  error?: string;
  repetido?: boolean;
  resultado?: ResultadoImportacion;
  importando?: boolean;
  /** En tarjetas con adicionales: el nombre cuyos cargos son tuyos. */
  soloDe?: string;
}

/** Los errores de pdf.js vienen en inglés; los del lector ya están en español. */
function mensajeDeError(e: Error): string {
  if (e?.name === "PasswordException" || /password/i.test(e?.message ?? "")) return "El PDF tiene contraseña. Ábrelo, guárdalo sin contraseña y vuelve a subirlo.";
  if (/Invalid PDF|InvalidPDF|Missing PDF|unexpected/i.test(e?.message ?? "") || e?.name === "InvalidPDFException") return "Este archivo no es un PDF válido o está dañado.";
  return e?.message || "No se pudo leer el PDF.";
}

/** "Soy el titular": se carga todo el estado (los cargos de adicionales quedan anotados con su nombre). */
const TODOS = "*";

const conVarios = (e?: EstadoLeido) => (e?.tarjetahabientes?.length ?? 0) > 1;

export default function Estados({ d }: { d: Datos }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [leidos, setLeidos] = useState<Leido[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const nombreCuenta = new Map(d.cuentas.map((c) => [c.id, c.nombre]));

  async function leer(archivos: FileList | null) {
    if (!archivos?.length) return;
    setTrabajando(true);
    const nuevos: Leido[] = [];
    try {
    const { leerPDFConOCR } = await import("../lib/estados");
    for (const f of Array.from(archivos)) {
      try {
        setProgreso(`Leyendo ${f.name}…`);
        const estado = await leerPDFConOCR(await f.arrayBuffer(), (p, t) => setProgreso(`${f.name}: es una imagen, reconociendo el texto (página ${p} de ${t})…`));
        // Si ya elegiste tu nombre en esa tarjeta antes, se usa el mismo
        const previa = d.cuentas.find((c) => c.banco === estado.banco && c.terminacion === estado.terminacion && c.soloDe);
        nuevos.push({ archivo: f.name, estado, repetido: await yaImportado(estado), soloDe: conVarios(estado) ? previa?.soloDe : undefined });
      } catch (e) {
        nuevos.push({ archivo: f.name, error: mensajeDeError(e as Error) });
      }
    }
    } catch (e) {
      nuevos.push({ archivo: "", error: `No se pudo cargar el lector de PDF (${(e as Error).message}). Revisa tu conexión e inténtalo de nuevo.` });
    } finally {
      nuevos.sort((a, b) => (a.estado?.fechaCorte ?? "").localeCompare(b.estado?.fechaCorte ?? ""));
      setLeidos(nuevos);
      setTrabajando(false);
      setProgreso(null);
      if (entrada.current) entrada.current.value = "";
    }
  }

  const cambiar = (i: number, cambio: Partial<Leido>) => setLeidos((xs) => xs.map((x, k) => (k === i ? { ...x, ...cambio } : x)));

  async function importar(i: number) {
    const l = leidos[i];
    if (!l.estado || l.importando || l.resultado) return;
    if (conVarios(l.estado) && !l.soloDe) return;
    cambiar(i, { importando: true });
    try {
      const resultado = await importarEstado(l.estado, l.archivo, { soloDe: l.soloDe === TODOS ? undefined : l.soloDe });
      cambiar(i, { resultado, repetido: true, importando: false });
    } catch (e) {
      const repetido = /ya lo hab/.test((e as Error).message);
      cambiar(i, { error: repetido ? undefined : (e as Error).message, repetido, importando: false });
    }
  }

  async function importarTodos() {
    setTrabajando(true);
    try {
      for (let i = 0; i < leidos.length; i++) {
        const l = leidos[i];
        if (l.estado && !l.repetido && !(conVarios(l.estado) && !l.soloDe)) await importar(i);
      }
    } finally {
      setTrabajando(false);
    }
  }

  async function quitar(id: string, nombre: string) {
    if (!confirm(`¿Quitar el estado de ${nombre}? Se borran los movimientos que trajo y regresan los gastos que habías anotado a mano.`)) return;
    await quitarEstado(id);
  }

  const historial = [...d.estados].sort((a, b) => b.fechaCorte.localeCompare(a.fechaCorte));
  const pendientes = leidos.filter((l) => l.estado && !l.repetido).length;

  return (
    <Pantalla titulo="Estados de cuenta" atras="mas">
      <Tarjeta>
        <p className="mb-3 text-sm text-suave">
          Sube el PDF tal como lo descargas de la app del banco. La app lee los cargos, los acomoda por categoría y
          actualiza tus compras a meses. Hoy lee <strong>BBVA</strong>, <strong>Banamex</strong>, <strong>American Express</strong>, <strong>HSBC</strong> y <strong>Revolut</strong>.
          Los PDF escaneados (como los de HSBC) tardan más: se leen con reconocimiento de texto aquí mismo, sin salir del teléfono.
        </p>
        <input ref={entrada} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => leer(e.target.files)} />
        <Boton className="w-full" onClick={() => entrada.current?.click()} deshabilitado={trabajando}>
          {trabajando ? "Leyendo…" : "Elegir PDF"}
        </Boton>
        {progreso && <p className="mt-2 text-sm text-suave">{progreso}</p>}
      </Tarjeta>

      {leidos.length > 0 && (
        <>
          <Titulo extra={pendientes > 1 && <button onClick={importarTodos} disabled={trabajando} className="text-sm font-semibold text-acento disabled:opacity-40">Agregar todos</button>}>Lo que leí</Titulo>
          <div className="space-y-3">
            {leidos.map((l, i) => {
              const soloMios = !!l.soloDe && l.soloDe !== TODOS;
              const vista = l.estado && soloMios ? soloTuParte(l.estado, l.soloDe!) : l.estado;
              return (
              <Tarjeta key={l.archivo + i}>
                <p className="truncate text-xs text-suave">{l.archivo}</p>
                {l.error && <div className="mt-2"><Aviso tipo="alerta">{l.error}</Aviso></div>}
                {l.estado && (
                  <>
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{l.estado.banco}{l.estado.terminacion ? ` ••${l.estado.terminacion}` : ""}</p>
                        <p className="text-sm text-suave">Corte {fechaCorta(l.estado.fechaCorte, true)}{l.estado.fechaLimite ? ` · pagar antes del ${fechaCorta(l.estado.fechaLimite, true)}` : ""}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.estado.cuadra ? "bg-acento-suave text-acento" : "bg-aviso-suave text-aviso"}`}>
                        {l.estado.cuadra ? "Cuadra con el banco" : "Revisar"}
                      </span>
                    </div>
                    {conVarios(l.estado) && !l.resultado && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-sm font-medium">La tarjeta es de {l.estado.titular ?? "otra persona"}. ¿Cuáles cargos son tuyos?</p>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => cambiar(i, { soloDe: TODOS })}
                            className={`rounded-xl px-3 py-1.5 text-left text-sm ${l.soloDe === TODOS ? "bg-acento text-white dark:text-black" : "bg-hundido"}`}>
                            <span className="block font-medium">Soy el titular: todo</span>
                            <span className="text-xs opacity-80">Pagas el estado completo</span>
                          </button>
                          {l.estado.tarjetahabientes!.map((t) => (
                            <button key={t.nombre} onClick={() => setLeidos((xs) => xs.map((x, k) => (k === i ? { ...x, soloDe: t.nombre } : x)))}
                              className={`rounded-xl px-3 py-1.5 text-left text-sm ${l.soloDe === t.nombre ? "bg-acento text-white dark:text-black" : "bg-hundido"}`}>
                              <span className="block font-medium">{t.nombre}</span>
                              <span className="cifras text-xs opacity-80">{pesos(t.total)}</span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-1.5 text-xs text-suave">
                          {l.soloDe === TODOS ? "Se carga todo; los cargos de las adicionales quedan anotados con su nombre." : "Solo se cargan los de ese nombre. Lo que te toca pagar es la suma de tus cargos."}
                        </p>
                      </div>
                    )}
                    <div className="cifras mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">Movimientos{soloMios ? " tuyos" : ""}</p><p className="font-bold">{vista!.movimientos.length}</p></div>
                      <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">Cargos</p><p className="font-bold">{pesos(sumar(vista!.movimientos.filter((m) => m.monto > 0), (m) => m.monto))}</p></div>
                      <div className="rounded-xl bg-hundido p-2"><p className="text-xs text-suave">{soloMios ? "Te toca pagar" : "Para no generar intereses"}</p><p className="font-bold">{pesos(vista!.pagoNoIntereses ?? 0)}</p></div>
                    </div>
                    {l.estado.avisos.map((a) => <p key={a} className="mt-2 text-xs text-aviso">{a}</p>)}
                    {l.resultado ? (
                      <div className="mt-3"><Aviso tipo="info">
                        Listo: {l.resultado.agregados} nuevos
                        {l.resultado.conciliados > 0 && `, ${l.resultado.conciliados} que ya habías anotado`}
                        {l.resultado.repetidos > 0 && `, ${l.resultado.repetidos} que ya estaban`}
                        {l.resultado.msiActualizadas > 0 && ` y ${l.resultado.msiActualizadas} compras a meses actualizadas`}.
                      </Aviso></div>
                    ) : l.repetido ? (
                      <p className="mt-3 text-sm font-medium text-suave">Este estado ya lo habías subido.</p>
                    ) : (
                      <Boton className="mt-3 w-full" onClick={() => importar(i)} deshabilitado={(conVarios(l.estado) && !l.soloDe) || l.importando}>
                        {l.importando ? "Agregando…" : conVarios(l.estado) && !l.soloDe ? "Elige arriba de quién son los cargos" : "Agregar a mis movimientos"}
                      </Boton>
                    )}
                  </>
                )}
              </Tarjeta>
              );
            })}
          </div>
        </>
      )}

      <Titulo>Ya subidos</Titulo>
      {historial.length === 0 && <Vacio>Aún no subes ningún estado.</Vacio>}
      <Tarjeta className="py-1">
        {historial.map((e) => {
          const pagado = pagadoDe(e, d);
          const total = e.pagoNoIntereses ?? 0;
          const vencido = e.fechaLimite && e.fechaLimite < hoyISO();
          const estatus = total <= 0 ? "Sin pago" : pagado >= total - 0.5 ? "Pagado" : vencido ? "Vencido" : "Pendiente";
          return (
            <div key={e.id} className="flex items-center gap-3 border-b border-linea py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{nombreCuenta.get(e.cuentaId)} · corte {fechaCorta(e.fechaCorte, true)}</p>
                <p className="cifras text-[13px] text-suave">
                  {pesos(total)}{e.fechaLimite ? ` antes del ${fechaCorta(e.fechaLimite, true)}` : ""}
                  {estatus !== "Pagado" && pagado > 0.5 && <span className="font-semibold text-aviso"> · faltan {pesos(total - pagado)}</span>}
                  {(e.intereses ?? 0) > 0 && <span className="text-alerta"> · intereses {pesos((e.intereses ?? 0) + (e.iva ?? 0))}</span>}
                </p>
              </div>
              <button onClick={() => quitar(e.id, `${nombreCuenta.get(e.cuentaId)} (corte ${fechaCorta(e.fechaCorte, true)})`)}
                className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-alerta" aria-label="Quitar este estado">Quitar</button>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                estatus === "Pagado" ? "bg-acento-suave text-acento" : estatus === "Pendiente" ? "bg-aviso-suave text-aviso"
                  : estatus === "Vencido" ? "bg-alerta-suave text-alerta" : "bg-hundido text-suave"}`}>{estatus}</span>
            </div>
          );
        })}
      </Tarjeta>
      <p className="mt-2 px-1 text-xs text-suave">"Pagado" sale de los pagos a la tarjeta que ya están en tus movimientos después del corte.</p>
    </Pantalla>
  );
}
