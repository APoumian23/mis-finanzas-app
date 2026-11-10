import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { compraMSIManual } from "./calculos";
import { cambiarResponsableMSI, importarEstado, quitarEstado } from "./importarEstado";
import type { EstadoLeido } from "./tipos";

const estado = (cambios: Partial<EstadoLeido> = {}): EstadoLeido => ({
  banco: "BBVA", terminacion: "1234", fechaCorte: "2026-11-18", fechaLimite: "2026-12-08", pagoNoIntereses: 1000,
  movimientos: [
    { fecha: "2026-11-02", descripcion: "OXXO CENTRO", monto: 80 },
    { fecha: "2026-11-05", descripcion: "TACOS EL GUERO", monto: 250 },
    { fecha: "2026-11-18", descripcion: "03 DE 12 WALMART VENTA EN LIN", monto: 708 },
  ],
  msi: [{ fechaCompra: "2026-09-10", descripcion: "WALMART VENTA EN LIN", montoOriginal: 8496, saldoPendiente: 6372, pagoMensual: 708, pagoActual: 3, totalPagos: 12 }],
  cuadra: true, avisos: [], ...cambios,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.cuentas.add({ id: "bbva", nombre: "BBVA", banco: "BBVA", tipo: "credito", terminacion: "1234" });
});

describe("importar estados", () => {
  it("no duplica el mismo estado (doble toque)", async () => {
    await importarEstado(estado());
    await expect(importarEstado(estado())).rejects.toThrow(/ya lo hab/);
    expect(await db.estados.count()).toBe(1);
    expect(await db.movimientos.count()).toBe(3);
  });

  it("junta el gasto anotado a mano y lo recupera si quitas el estado", async () => {
    await db.movimientos.add({ id: "mano", cuentaId: "bbva", fecha: "2026-11-04", descripcion: "Tacos con Luis", monto: 250,
      categoria: "Comida fuera y bares", tipo: "Variable", responsable: "Yo", origen: "manual", creado: 1 });
    const r = await importarEstado(estado());
    expect(r.conciliados).toBe(1);
    expect(await db.movimientos.get("mano")).toBeUndefined();
    await quitarEstado(r.estadoId);
    expect(await db.estados.count()).toBe(0);
    const quedan = await db.movimientos.toArray();
    expect(quedan.map((m) => m.id)).toEqual(["mano"]);
  });

  it("las mensualidades heredan de quién es la compra a meses, también al cambiarlo después", async () => {
    await importarEstado(estado());
    const compra = (await db.msi.toArray())[0];
    await cambiarResponsableMSI(compra, "Papá");
    const mensualidad = (await db.movimientos.toArray()).find((m) => m.descripcion.startsWith("03 DE 12"))!;
    expect(mensualidad).toMatchObject({ responsable: "Papá", categoria: "Por cobrar - Papá" });

    // El mes siguiente, la nueva mensualidad entra directo a nombre de papá
    await importarEstado(estado({
      fechaCorte: "2026-12-18",
      movimientos: [{ fecha: "2026-12-18", descripcion: "04 DE 12 WALMART VENTA EN LIN", monto: 708 }],
      msi: [{ ...estado().msi[0], saldoPendiente: 5664, pagoActual: 4 }],
    }));
    const nueva = (await db.movimientos.toArray()).find((m) => m.descripcion.startsWith("04 DE 12"))!;
    expect(nueva.responsable).toBe("Papá");
    expect(await db.msi.count()).toBe(1);
  });

  it("la compra a meses capturada a mano se reemplaza con la del estado de cuenta (no se duplica)", async () => {
    // Capturada con otro nombre, monto redondeado y fecha un día distinta; conserva de quién es
    const a_mano = compraMSIManual({ cuentaId: "bbva", descripcion: "Pantalla Walmart", monto: 8496.4, meses: 12, fechaCompra: "2026-09-11", responsable: "Papá" }, [], "mano");
    await db.msi.put(a_mano);
    await importarEstado(estado());
    const compras = await db.msi.toArray();
    expect(compras).toHaveLength(1);
    expect(compras[0]).toMatchObject({ id: "mano", descripcion: "WALMART VENTA EN LIN", montoOriginal: 8496, pagoActual: 3, responsable: "Papá", actualizadoAl: "2026-11-18" });
    expect(compras[0].manual).toBeUndefined();
  });

  it("dos compras a meses distintas del mismo monto y sin fecha no se juntan", async () => {
    const base = estado().msi[0];
    await importarEstado(estado({ msi: [
      { ...base, fechaCompra: undefined, descripcion: "AMAZON UNO", totalPagos: 6, pagoMensual: 1416 },
      { ...base, fechaCompra: undefined, descripcion: "LIVERPOOL DOS", totalPagos: 6, pagoMensual: 1416 },
    ], movimientos: [] }));
    expect(await db.msi.count()).toBe(2);
  });
});
