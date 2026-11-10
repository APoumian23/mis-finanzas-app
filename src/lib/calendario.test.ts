import { describe, expect, it } from "vitest";
import { alcancePorBanco, calendarioDePagos, saldoPorFecha, type DatosCalendario } from "./calendario";

const base = (): DatosCalendario => ({
  ajustes: { id: "ajustes", ahorroPct: 0.1, topes: {}, fijos: [], ingresos: [
    { concepto: "Sueldo del 30", monto: 10000, dia: 30 }, { concepto: "Sueldo del 13", monto: 8000, dia: 13 }, { concepto: "Sin día", monto: 2000 },
  ] },
  cuentas: [{ id: "t1", nombre: "Tarjeta A", banco: "BBVA", tipo: "credito" }, { id: "t2", nombre: "Tarjeta B", banco: "HSBC", tipo: "credito" }],
  estados: [
    { id: "e1", cuentaId: "t1", banco: "BBVA", fechaCorte: "2026-10-18", fechaLimite: "2026-11-09", pagoNoIntereses: 5000, pagoMinimo: 600 },
    { id: "e2", cuentaId: "t2", banco: "HSBC", fechaCorte: "2026-10-13", fechaLimite: "2026-10-13", pagoNoIntereses: 3000, pagoMinimo: 900 },
  ] as DatosCalendario["estados"],
  movimientos: [],
  msi: [],
  prestamos: [{ id: "p", nombre: "Préstamo", montoOriginal: 10000, saldoInicial: 9000, fechaSaldoInicial: "2026-10-01", tasaAnual: 0.13,
    ivaSobreInteres: false, pagoMensual: 1000, quincenal: true, pagos: [] }],
});

describe("calendario de pagos", () => {
  const ev = calendarioDePagos(base(), "2026-10-20", 30);

  it("pone ingresos en su día, tarjetas en su fecha límite y lo vencido hoy", () => {
    expect(ev.filter((e) => e.tipo === "ingreso").map((e) => e.fecha)).toEqual(["2026-10-30", "2026-11-13"]);
    expect(ev.find((e) => e.concepto === "Tarjeta A")).toMatchObject({ fecha: "2026-11-09", monto: -5000, minimo: 600 });
    expect(ev.find((e) => e.concepto === "Tarjeta B")).toMatchObject({ fecha: "2026-10-20", vencido: true, minimo: 900 });
    expect(ev.some((e) => e.concepto === "Sin día")).toBe(false);
  });

  it("los préstamos quincenales pagan la mitad el 15 y el fin de mes", () => {
    expect(ev.filter((e) => e.tipo === "prestamo").map((e) => [e.fecha, e.monto])).toEqual([["2026-10-31", -500], ["2026-11-15", -500]]);
  });

  it("lleva lo que te quedaría después de cada fecha, con todo o solo con mínimos", () => {
    const todo = saldoPorFecha(ev, 4000);
    expect(todo.get("2026-10-20")).toBe(1000); // 4000 − 3000 de la vencida
    expect(todo.get("2026-11-09")).toBe(1000 + 10000 - 500 - 5000);
    const minimos = saldoPorFecha(ev, 4000, true);
    expect(minimos.get("2026-11-09")).toBe(4000 - 900 + 10000 - 500 - 600);
  });

  it("estima el próximo estado de una tarjeta al corriente con lo que ya lleva cargado", () => {
    const d = base();
    d.estados = [{ id: "e3", cuentaId: "t1", banco: "BBVA", fechaCorte: "2026-10-02", fechaLimite: "2026-10-23", pagoNoIntereses: 800 }] as DatosCalendario["estados"];
    d.movimientos = [
      { id: "pago", cuentaId: "t1", fecha: "2026-10-08", descripcion: "SU PAGO", monto: -800, categoria: "Pago a tarjeta", tipo: "Pago", responsable: "Yo", origen: "importado", creado: 0 },
      { id: "c1", cuentaId: "t1", fecha: "2026-10-09", descripcion: "AMAZON", monto: 344, categoria: "Compras en línea", tipo: "Variable", responsable: "Yo", origen: "importado", creado: 0 },
      { id: "c2", cuentaId: "t1", fecha: "2026-10-09", descripcion: "01 DE 18 TELEFONO", monto: 1111, categoria: "Por cobrar - Ana", tipo: "A meses (MSI)", responsable: "Ana", origen: "importado", creado: 0 },
    ];
    d.msi = [{ id: "m", cuentaId: "t1", descripcion: "TELEFONO", montoOriginal: 19998, saldoPendiente: 18887, pagoMensual: 1111, pagoActual: 1, totalPagos: 18, responsable: "Ana", fechaCompra: "2026-10-09", actualizadoAl: "2026-10-02" }] as DatosCalendario["msi"];
    const est = calendarioDePagos(d, "2026-10-20", 40).find((e) => e.tipo === "estimado")!;
    expect(est).toMatchObject({ fecha: "2026-11-23", monto: -(344 + 1111) }); // la mensualidad ya cargada no se cuenta dos veces
    expect(est.detalle).toContain("1,111");
  });
});

describe("¿alcanza para cada banco?", () => {
  it("paga completa si alcanza; si no, el mínimo, y dice cuánto falta", () => {
    const d = base();
    d.estados[1].tasaAnual = 0.709;
    const filas = alcancePorBanco(d, "2026-10-20", 1000, 30);
    const b = filas.find((f) => f.concepto === "Tarjeta B")!; // vencida: 3000, mínimo 900, con 1000 hoy
    expect(b).toMatchObject({ vencido: true, alcance: "minimo", antes: 1000, entran: 0, faltaria: 2000, tasaAnual: 0.709 });
    expect(b.interesesSiMinimo).toBeCloseTo(2100 * (0.709 / 12) * 1.16, 1);
    const a = filas.find((f) => f.concepto === "Tarjeta A")!; // 9-nov: 1000 − 900 + 10000 − 500 = 9600 ≥ 5000
    expect(a).toMatchObject({ alcance: "completa", antes: 9600, entran: 10000, faltaria: 0 });
  });

  it("si no alcanza ni el mínimo lo dice; sin mínimo hay que pagarla completa", () => {
    const d = base();
    d.estados[1].pagoMinimo = undefined;
    const b = alcancePorBanco(d, "2026-10-20", 500, 30).find((f) => f.concepto === "Tarjeta B")!;
    expect(b).toMatchObject({ alcance: "no", minimo: undefined, faltaria: 2500 });
  });

  it("muestra como pagada la que ya cubriste y aún no vence", () => {
    const d = base();
    d.estados = [{ id: "e", cuentaId: "t1", banco: "BBVA", fechaCorte: "2026-10-02", fechaLimite: "2026-10-23", pagoNoIntereses: 800 }] as DatosCalendario["estados"];
    d.movimientos = [{ id: "p", cuentaId: "t1", fecha: "2026-10-08", descripcion: "SU PAGO", monto: -800, categoria: "Pago a tarjeta", tipo: "Pago", responsable: "Yo", origen: "importado", creado: 0 }];
    expect(alcancePorBanco(d, "2026-10-20", 0, 30).find((f) => f.alcance === "pagada")).toMatchObject({ concepto: "Tarjeta A", fecha: "2026-10-23" });
  });
});
