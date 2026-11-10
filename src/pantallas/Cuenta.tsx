import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Aviso, Boton, Campo, Pantalla, Tarjeta, claseCampo } from "../componentes/ui";
import { db } from "../lib/db";
import { entrar, leerMeta, salir, sincronizar, subirReemplazando, usarDatosDelServidor, type AlEntrar } from "../lib/sync";

/** Estado de la sincronización, en vivo. */
export function useEstadoSync() {
  return useLiveQuery(async () => ({ meta: await leerMeta(), pendientes: await db.pendientes.count() }), []);
}

export const haceCuanto = (iso?: string) => {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
};

export default function Cuenta() {
  const estado = useEstadoSync();
  if (!estado) return null;
  const { meta, pendientes } = estado;
  return (
    <Pantalla titulo="Tu cuenta" atras="mas">
      {meta.usuario ? <Conectado usuario={meta.usuario} ultima={meta.ultima} error={meta.error} pendientes={pendientes} /> : (
        <>
          <p className="mb-3 px-1 text-suave">
            Entra para guardar tus datos en tu servidor y verlos igual en el celular y en la computadora. Sin internet la app sigue
            funcionando: lo que anotes se sube después.
          </p>
          {meta.error && <div className="mb-3"><Aviso tipo="aviso">{meta.error}</Aviso></div>}
          <Tarjeta><FormEntrar /></Tarjeta>
        </>
      )}
    </Pantalla>
  );
}

function Conectado({ usuario, ultima, error, pendientes }: { usuario: string; ultima?: string; error?: string; pendientes: number }) {
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  async function ahora() {
    setTrabajando(true); setMensaje(null);
    try { await sincronizar(); setMensaje("Todo al día."); } catch (e) { setMensaje((e as Error).message); } finally { setTrabajando(false); }
  }
  return (
    <div className="space-y-3">
      <Tarjeta>
        <div className="flex items-center gap-3">
          <span className={`flex size-12 items-center justify-center rounded-full text-xl font-bold ${error ? "bg-aviso-suave text-aviso" : "bg-acento-suave text-acento"}`} aria-hidden="true">
            {error ? "!" : "✓"}
          </span>
          <div>
            <p className="text-lg font-semibold">{usuario}</p>
            <p className="text-sm text-suave">{error ? "No se pudo sincronizar" : "Sincronizado"} · {haceCuanto(ultima)}</p>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-aviso">{error}</p>}
        <p className="mt-3 text-sm text-suave">
          {pendientes === 0 ? "No hay cambios por subir." : `${pendientes} ${pendientes === 1 ? "cambio" : "cambios"} por subir: se mandan solos cuando hay internet.`}
        </p>
        <Boton className="mt-3 min-h-12 w-full" onClick={ahora} deshabilitado={trabajando}>{trabajando ? "Sincronizando…" : "Sincronizar ahora"}</Boton>
        {mensaje && <p className="mt-2 text-center text-sm text-suave">{mensaje}</p>}
      </Tarjeta>
      <p className="px-1 text-sm text-suave">Tus datos se guardan en este dispositivo y en tu servidor. Lo que cambies aquí aparece en tus otros dispositivos al abrir la app.</p>
      <Boton tipo="secundario" className="min-h-12 w-full" onClick={async () => {
        if (confirm("¿Salir de tu cuenta en este dispositivo? Tus datos se quedan aquí, pero dejan de sincronizarse.")) await salir();
      }}>Salir de mi cuenta</Boton>
    </div>
  );
}

/** Chrome y Edge guardan la contraseña con esta API; Safari y Firefox la ofrecen solos al enviar el formulario. */
async function guardarEnNavegador(usuario: string, contrasena: string) {
  const PC = (window as unknown as { PasswordCredential?: new (d: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
  if (!PC || !navigator.credentials?.store) return;
  try { await navigator.credentials.store(new PC({ id: usuario.trim(), password: contrasena, name: "Mis Finanzas" })); } catch { /* el usuario dijo que no */ }
}

/** Usuario y contraseña; al entrar decide con qué datos se queda este dispositivo. */
export function FormEntrar({ alTerminar }: { alTerminar?: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [eleccion, setEleccion] = useState<AlEntrar | null>(null);
  const [vacia, setVacia] = useState(false);

  async function terminar(paso: () => Promise<void>) {
    setTrabajando(true); setError(null);
    try { await paso(); alTerminar?.(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !contrasena || trabajando) return;
    setTrabajando(true); setError(null);
    try {
      const r = await entrar(usuario, contrasena);
      await guardarEnNavegador(usuario, contrasena);
      setContrasena("");
      if (!r.servidorTieneDatos && !r.dispositivoTieneDatos) { await subirReemplazando(r.usuario); setVacia(true); return; }
      if (!r.servidorTieneDatos) await subirReemplazando(r.usuario);           // cuenta nueva: se sube lo de aquí
      else if (!r.dispositivoTieneDatos) await usarDatosDelServidor(r.respuesta, r.usuario); // dispositivo nuevo: baja todo
      else { setEleccion(r); return; }                                          // hay datos en los dos: decides tú
      alTerminar?.();
    } catch (x) {
      setError((x as Error).message === "Failed to fetch" ? "No hay conexión con tu servidor. Revisa tu internet." : (x as Error).message);
    } finally { setTrabajando(false); }
  }

  if (vacia) {
    return (
      <Aviso tipo="info">
        Ya entraste, pero tu cuenta todavía no tiene datos. Carga tu respaldo o empieza desde cero: lo que hagas se guarda en tu cuenta.
      </Aviso>
    );
  }

  if (eleccion) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">Hay datos en tu cuenta y también en este dispositivo. ¿Con cuáles te quedas?</p>
        <Boton className="min-h-14 w-full" deshabilitado={trabajando} onClick={() => terminar(() => usarDatosDelServidor(eleccion.respuesta, eleccion.usuario))}>
          Usar los de mi cuenta
        </Boton>
        <p className="px-1 text-sm text-suave">Lo de este dispositivo se reemplaza por lo que ya tienes guardado. Es lo normal en un teléfono o navegador nuevo.</p>
        <Boton tipo="secundario" className="min-h-14 w-full" deshabilitado={trabajando} onClick={() => {
          if (confirm("Lo que hay en tu cuenta se reemplaza por lo de este dispositivo, también en tus otros dispositivos. ¿Seguir?")) {
            void terminar(() => subirReemplazando(eleccion.usuario));
          }
        }}>Subir los de este dispositivo</Boton>
        {error && <Aviso tipo="alerta">{error}</Aviso>}
      </div>
    );
  }

  return (
    // method/action y nombres estándar: así Safari, Firefox y Chrome reconocen el formulario y ofrecen guardar la contraseña
    <form onSubmit={enviar} method="post" action="/api/entrar" autoComplete="on">
      <Campo etiqueta="Usuario">
        <input className={claseCampo} id="usuario" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={usuario} onChange={(e) => setUsuario(e.target.value)} />
      </Campo>
      <Campo etiqueta="Contraseña">
        <input className={claseCampo} id="contrasena" name="password" type="password" autoComplete="current-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
      </Campo>
      {error && <div className="mb-3"><Aviso tipo="alerta">{error}</Aviso></div>}
      <Boton submit className="min-h-12 w-full" deshabilitado={trabajando || !usuario.trim() || !contrasena}>{trabajando ? "Entrando…" : "Entrar"}</Boton>
    </form>
  );
}
