import { useRef, useState } from "react";
import { Aviso, Boton, Fila, Pantalla, Tarjeta, Titulo } from "../componentes/ui";
import type { Datos } from "../hooks";
import { aprenderDeHistorial } from "../lib/categorizar";
import { borrarTodo, db, restaurar } from "../lib/db";
import type { Respaldo } from "../lib/tipos";
import { buscarActualizacion, VERSION, type Resultado } from "../lib/actualizar";
import { conectado, salir, sincronizar, subirReemplazando } from "../lib/sync";
import { fechaCorta, ultimoRespaldo } from "../lib/util";
import { haceCuanto, useEstadoSync } from "./Cuenta";

/** Restaura un respaldo y, si no trae reglas, las aprende del historial. */
export async function restaurarArchivo(archivo: File): Promise<void> {
  const r = JSON.parse(await archivo.text()) as Respaldo;
  await restaurar(r);
  // Las reglas del respaldo mandan; las aprendidas del historial solo llenan lo que falte
  const propias = new Set((r.reglas ?? []).map((x) => x.clave));
  await db.reglas.bulkPut(aprenderDeHistorial(r.movimientos).filter((x) => !propias.has(x.clave)));
  // Con cuenta: el respaldo también reemplaza lo de tu servidor (y de tus otros dispositivos)
  if (await conectado()) await subirReemplazando();
}

export default function Mas({ d }: { d: Datos }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const ultimo = [...d.estados].sort((a, b) => b.fechaCorte.localeCompare(a.fechaCorte))[0];
  const sync = useEstadoSync();
  const usuario = sync?.meta.usuario;

  async function alElegir(f?: File) {
    if (!f) return;
    if (!confirm(usuario
      ? "Esto reemplaza TODOS tus datos por los del respaldo, aquí y en tu cuenta (también en tus otros dispositivos). ¿Seguir?"
      : "Esto reemplaza TODOS los datos de la app por los del respaldo. ¿Seguir?")) return;
    try {
      await restaurarArchivo(f);
      setMensaje("Respaldo restaurado.");
    } catch (e) {
      setMensaje((e as Error).message);
    }
  }

  const ir = (r: string) => () => (window.location.hash = `/${r}`);
  return (
    <Pantalla titulo="Más">
      <Tarjeta className="py-1">
        <Fila onClick={ir("cuenta")} izquierda="Tu cuenta y sincronización"
          sub={usuario ? `${usuario} · ${sync?.meta.error ? "no se pudo sincronizar" : sync?.pendientes ? `${sync.pendientes} cambios por subir` : "al día"}` : "Entra para ver tus datos en el celular y la computadora"}
          derecha="›" />
        <Fila onClick={ir("calendario")} izquierda="Calendario de pagos" sub="Qué entra y qué sale, fecha por fecha" derecha="›" />
        <Fila onClick={ir("estados")} izquierda="Estados de cuenta" sub={ultimo ? `Último: corte ${fechaCorta(ultimo.fechaCorte, true)}` : "Sube tus PDF"} derecha="›" />
        <Fila onClick={ir("prestamos")} izquierda="Préstamos" sub={`${d.prestamos.length} registrados`} derecha="›" />
        <Fila onClick={ir("por-cobrar")} izquierda="Te deben" sub={`${d.deudores.length} personas`} derecha="›" />
        <Fila onClick={ir("meses")} izquierda="Compras a meses" sub={`${d.msi.length} compras`} derecha="›" />
        <Fila onClick={ir("cuentas")} izquierda="Cuentas y tarjetas" sub={`${d.cuentas.filter((c) => !c.archivada).length} activas`} derecha="›" />
        <Fila onClick={ir("ajustes")} izquierda="Ingresos, gastos fijos y topes" derecha="›" />
      </Tarjeta>

      <Titulo>App</Titulo>
      <Tarjeta><ActualizarApp /></Tarjeta>

      <Titulo>Respaldo</Titulo>
      <Tarjeta>
        <p className="mb-3 text-sm text-suave">
          {usuario
            ? `Tus datos están guardados en tu servidor (una base de datos en línea) y en este dispositivo; se sincronizan solos. Última sincronización: ${haceCuanto(sync?.meta.ultima)}. El respaldo a mano es opcional: una copia tuya en Archivos o iCloud Drive.`
            : "Sin cuenta, tus datos viven solo en este dispositivo. Entra con tu cuenta para guardarlos en tu servidor, o guarda un respaldo cada mes en Archivos o iCloud Drive."}
          {ultimoRespaldo() && <> Último: <strong>{fechaCorta(ultimoRespaldo()!, true)}</strong>.</>}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Boton tipo="secundario" onClick={async () => (await import("../lib/exportar")).descargarRespaldo()}>Guardar respaldo</Boton>
          <Boton tipo="secundario" onClick={async () => (await import("../lib/exportar")).descargarExcel()}>Exportar a Excel</Boton>
        </div>
        <input ref={entrada} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void alElegir(f); }} />
        <Boton tipo="secundario" className="mt-2 w-full" onClick={() => entrada.current?.click()}>Restaurar un respaldo</Boton>
        {mensaje && <div className="mt-3"><Aviso tipo="info">{mensaje}</Aviso></div>}
      </Tarjeta>

      <Titulo>Zona de peligro</Titulo>
      <Boton tipo="peligro" className="w-full" onClick={async () => {
        const aviso = usuario
          ? "¿Borrar tus datos de este dispositivo? Siguen guardados en tu cuenta; para no volver a bajarlos aquí, también sales de tu cuenta."
          : "¿Borrar TODOS tus datos de este teléfono? Guarda un respaldo antes.";
        if (confirm(aviso) && confirm("¿Seguro? No se puede deshacer.")) { if (usuario) await salir(); await borrarTodo(); }
      }}>Borrar todos los datos</Boton>
      <p className="mt-6 text-center text-xs text-suave">Mis Finanzas · {usuario ? "tus datos se guardan en tu propio servidor" : "tus datos no salen de este dispositivo"}</p>
    </Pantalla>
  );
}

/** Versión instalada y botón para buscar e instalar la nueva (y de paso sincronizar). */
function ActualizarApp() {
  const [estado, setEstado] = useState<Resultado | "buscando" | null>(null);
  async function buscar() {
    setEstado("buscando");
    void sincronizar().catch(() => undefined);
    setEstado(await buscarActualizacion());
  }
  const texto = {
    buscando: "Buscando…",
    "al-dia": "Ya tienes la versión más nueva ✓",
    descargando: "Hay una versión nueva y se está descargando. Cuando esté lista te sale un aviso arriba.",
    "sin-conexion": "Sin internet: inténtalo cuando tengas conexión.",
    "sin-servicio": "Aquí no se puede revisar (modo privado o de prueba). Recarga la página para ver lo más nuevo.",
    actualizada: "Instalando la versión nueva…",
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Actualizar app</p>
          <p className="text-sm text-suave">Versión del {VERSION}</p>
        </div>
        <Boton className="min-h-12 shrink-0" onClick={buscar} deshabilitado={estado === "buscando"}>
          {estado === "buscando" ? "Buscando…" : "Buscar"}
        </Boton>
      </div>
      {estado && estado !== "buscando" && <p className={`mt-2 text-sm ${estado === "al-dia" ? "text-bien" : "text-suave"}`}>{texto[estado]}</p>}
      <p className="mt-2 text-xs text-suave">También se actualiza sola: cuando haya una versión nueva te sale un aviso arriba.</p>
    </div>
  );
}
