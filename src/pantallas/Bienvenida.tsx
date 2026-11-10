import { useRef, useState } from "react";
import { Aviso, Boton, Tarjeta } from "../componentes/ui";
import { db, AJUSTES_INICIALES } from "../lib/db";
import { FormEntrar } from "./Cuenta";
import { restaurarArchivo } from "./Mas";

export default function Bienvenida() {
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function empezarVacio() {
    await db.transaction("rw", db.cuentas, db.ajustes, async () => {
      await db.cuentas.bulkPut([
        { id: "efectivo", nombre: "Efectivo o débito", banco: null, tipo: "efectivo" },
      ]);
      await db.ajustes.put(AJUSTES_INICIALES);
    });
    window.location.hash = "/ajustes";
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pt-seguro pb-seguro">
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-acento text-3xl font-bold text-white dark:text-black">$</div>
      <h1 className="text-3xl font-bold tracking-tight">Mis Finanzas</h1>
      <p className="mt-2 text-suave">Cuánto te queda para gastar este mes, tus tarjetas, préstamos y lo que te deben. Con tu cuenta, todo se guarda en tu servidor y se sincroniza entre tus dispositivos.</p>

      <Tarjeta className="mt-8">
        <p className="font-semibold">¿Ya tienes cuenta?</p>
        <p className="mb-3 mt-1 text-sm text-suave">Entra y se bajan tus datos.</p>
        <FormEntrar />
      </Tarjeta>

      <Tarjeta className="mt-3">
        <p className="font-semibold">¿Tienes tu respaldo?</p>
        <p className="mb-3 mt-1 text-sm text-suave">Elige el archivo <strong>respaldo-inicial.json</strong> (tiene todo lo de tu Excel).</p>
        <input ref={entrada} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // para poder elegir el mismo archivo otra vez si algo falla
          if (!f) return;
          try { await restaurarArchivo(f); } catch (x) { setError((x as Error).message); }
        }} />
        <Boton className="w-full" onClick={() => entrada.current?.click()}>Cargar respaldo</Boton>
        {error && <div className="mt-3"><Aviso tipo="alerta">{error}</Aviso></div>}
      </Tarjeta>
      <Boton tipo="secundario" className="mt-3 w-full" onClick={empezarVacio}>Empezar desde cero</Boton>
    </div>
  );
}
