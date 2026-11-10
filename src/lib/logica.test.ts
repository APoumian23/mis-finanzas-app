import { describe, expect, it } from "vitest";
import { compraMSIManual, diasDeCorte, mesContable, mismoDiaMesSiguiente, movimientosPorEstado, detalleMensualidad, estadoPrestamo, estimarProximoMes, msiDelMes, resumenMes, tablaPagos, ultimoCargo } from "./calculos";
import { clasificar, normalizar } from "./categorizar";
import type { Prestamo, Regla } from "./tipos";

const prestamo: Prestamo = {
  id: "p", nombre: "Préstamo", montoOriginal: 50000, saldoInicial: 50000, fechaSaldoInicial: "2026-10-14",
  tasaAnual: 0.36, ivaSobreInteres: false, pagoMensual: 2952.38, plazoMeses: 24, primerPago: "2026-11-14", pagos: [],
};

describe("préstamos", () => {
  it("lo que alguien pagó por ti sale como atraso, no alarga el plazo del contrato", () => {
    // 24 meses de $2,400 desde el 30-jun; otra persona pagó 4 al banco y tú le has dado $4,000
    const p: Prestamo = { id: "q", nombre: "Préstamo familiar", montoOriginal: 48000, saldoInicial: 50000, fechaSaldoInicial: "2026-06-14",
      tasaAnual: 0.12, ivaSobreInteres: true, pagoMensual: 2400, plazoMeses: 24, primerPago: "2026-06-30", ultimoPago: "2028-06-15",
      pagos: [{ fecha: "2026-10-16", monto: 4000 }] };
    const e = estadoPrestamo(p, "2026-10-20");
    expect(e.atraso).toBeCloseTo(4 * 2400 - 4000, 2);
    expect(e.terminaEn).toBe("2028-06");
    // Si abonas de más, termina antes que el contrato
    const conAbono = estadoPrestamo({ ...p, pagos: [...p.pagos, { fecha: "2026-10-18", monto: 30000 }] }, "2026-10-20");
    expect(conAbono.atraso).toBe(0);
    expect(conAbono.terminaEn! < "2028-06").toBe(true);
  });

  it("la tabla de pagos: interés del mes sobre el saldo y 24 pagos hasta cero", () => {
    const t = tablaPagos(prestamo, "2026-10-20");
    expect(t[0]).toMatchObject({ interes: 1500, abono: 1452.38, saldo: 48547.62 });
    expect(t.length).toBe(24);
    expect(t[23].saldo).toBe(0);
  });

  it("aplica pagos e intereses mes a mes y avisa del atraso", () => {
    const conPago = { ...prestamo, pagos: [{ fecha: "2026-11-14", monto: 2952.38 }] };
    expect(estadoPrestamo(conPago, "2026-11-20").saldo).toBeCloseTo(48547.62, 1);
    expect(estadoPrestamo(conPago, "2026-11-20").atraso).toBe(0);
    expect(estadoPrestamo(prestamo, "2026-11-20").atraso).toBeCloseTo(2952.38, 2);
    expect(estadoPrestamo(prestamo, "2026-11-10").atraso).toBe(0);
  });

  it("la tabla incluye el pago de este mes si aún no lo anotas (y no si el préstamo se dio de alta este mes)", () => {
    const enNov = tablaPagos(prestamo, "2026-11-20");
    expect(enNov[0]).toMatchObject({ mes: "2026-11", pago: 2952.38 });
    const conPago = tablaPagos({ ...prestamo, pagos: [{ fecha: "2026-11-14", monto: 2952.38 }] }, "2026-11-20");
    expect(conPago[0].mes).toBe("2026-12");
    expect(tablaPagos({ ...prestamo, primerPago: undefined }, "2026-10-20")[0].mes).toBe("2026-11");
  });

  it("intereses por pagar con un último pago parcial y atraso desde el alta", () => {
    const chico: Prestamo = { ...prestamo, saldoInicial: 1000, montoOriginal: 1000, tasaAnual: 0.12, pagoMensual: 900, primerPago: undefined };
    const e = estadoPrestamo(chico, "2026-10-20");
    expect(e.mesesRestantes).toBe(2);
    expect(e.interesesPorPagar!).toBeLessThan(25);
    // Dado de alta a la mitad (oct-26) con primer pago original en ene-26: no está atrasado
    const medio: Prestamo = { ...prestamo, primerPago: "2026-01-14", fechaSaldoInicial: "2026-10-20" };
    expect(estadoPrestamo(medio, "2026-10-25").atraso).toBe(0);
    expect(estadoPrestamo(medio, "2026-11-20").atraso).toBeCloseTo(2952.38, 2);
  });

  it("detecta cuando el pago no alcanza ni para el interés", () => {
    const malo = { ...prestamo, pagoMensual: 1000, primerPago: undefined };
    expect(estadoPrestamo(malo, "2026-10-20").mesesRestantes).toBeNull();
  });

  it("un préstamo al 14% con $1,000 al mes tarda años", () => {
    const largo: Prestamo = { ...prestamo, saldoInicial: 50000, fechaSaldoInicial: "2026-10-20", tasaAnual: 0.14, pagoMensual: 1000, primerPago: undefined };
    expect(estadoPrestamo(largo, "2026-10-20").mesesRestantes).toBeGreaterThan(60);
  });
});

describe("atraso de un préstamo quincenal", () => {
  const quincenal: Prestamo = { id: "i", nombre: "Préstamo por quincenas", montoOriginal: 48000, saldoInicial: 50000, fechaSaldoInicial: "2026-06-14",
    tasaAnual: 0.12, ivaSobreInteres: true, pagoMensual: 2400, quincenal: true, plazoMeses: 24, primerPago: "2026-06-30",
    pagos: [{ fecha: "2026-10-16", monto: 4000 }] };

  it("cuenta las quincenas que de verdad tocaban (empezó en la segunda de junio)", () => {
    // 30-jun, 15 y 31-jul, 15 y 31-ago, 15 y 30-sep, 15-oct = 8 quincenas de $1,200 al 21-oct
    expect(estadoPrestamo(quincenal, "2026-10-21")).toMatchObject({ esperadoAHoy: 9600, atraso: 5600 });
    // + 31-oct = 9 al 1-nov
    expect(estadoPrestamo(quincenal, "2026-11-01")).toMatchObject({ esperadoAHoy: 10800, atraso: 6800 });
    expect(estadoPrestamo(quincenal, "2026-11-15").esperadoAHoy).toBe(12000);
  });
});

describe("estimado del próximo mes", () => {
  it("mezcla el promedio de los meses pasados con el ritmo de este mes", () => {
    const g = (fecha: string, monto: number, categoria = "Comida fuera y bares") => ({ id: fecha + monto, cuentaId: "c", fecha, descripcion: "x", monto,
      categoria, tipo: "Variable" as const, responsable: "Yo", origen: "manual" as const, creado: 0 });
    const d = {
      ajustes: { id: "ajustes" as const, ingresos: [{ concepto: "Sueldo", monto: 20000 }], fijos: [{ concepto: "Renta", monto: 5000 }], ahorroPct: 0.1, topes: {} },
      prestamos: [], msi: [],
      movimientos: [g("2026-07-10", 6000), g("2026-08-10", 6000), g("2026-09-10", 6000), g("2026-10-10", 5000, "Entretenimiento")],
    };
    const e = estimarProximoMes(d, "2026-10-10");
    expect(e.mes).toBe("2026-11");
    expect(e.promedio).toBe(6000);
    expect(e.ritmo).toBe(15500); // 5,000 en 10 días → 31 días
    expect(e.gasto).toBe(10750);
    expect(e.quedaria).toBe(20000 - 5000 - 2000 - 10750);
    expect(e.porCategoria.map((c) => c.categoria)).toEqual(["Entretenimiento", "Comida fuera y bares"]);
  });

  it("lo de mascotas fue de una vez: no se proyecta al mes que viene", () => {
    const g = (fecha: string, monto: number, categoria = "Comida fuera y bares") => ({ id: fecha + monto + categoria, cuentaId: "c", fecha, descripcion: "x", monto,
      categoria, tipo: "Variable" as const, responsable: "Yo", origen: "manual" as const, creado: 0 });
    const d = {
      ajustes: { id: "ajustes" as const, ingresos: [{ concepto: "Sueldo", monto: 20000 }], fijos: [], ahorroPct: 0, topes: {} },
      prestamos: [], msi: [],
      movimientos: [g("2026-09-10", 6000), g("2026-09-12", 3000, "Mascotas"), g("2026-10-10", 2000), g("2026-10-11", 7745, "Mascotas")],
    };
    const e = estimarProximoMes(d, "2026-10-10");
    expect(e.promedio).toBe(6000);
    expect(e.ritmo).toBe(6200); // solo los 2,000 de comida
    expect(e.porCategoria.map((c) => c.categoria)).toEqual(["Comida fuera y bares"]);
    expect(e.excluidas).toEqual(["Mascotas"]);
  });

  it("un ingreso extra anotado suma a tus ingresos de ese mes (si es tuyo)", () => {
    const m = (id: string, fecha: string, monto: number, categoria: string, responsable = "Yo") => ({ id, cuentaId: "efectivo", fecha, descripcion: id, monto,
      categoria, tipo: "Abono" as const, responsable, origen: "manual" as const, creado: 0 });
    const d = {
      ajustes: { id: "ajustes" as const, ingresos: [{ concepto: "Sueldo", monto: 10000 }], fijos: [], ahorroPct: 0, topes: {} },
      prestamos: [], msi: [],
      movimientos: [m("venta", "2026-10-23", -1000, "Ingreso extra"), m("de papá", "2026-10-23", -500, "Ingreso extra", "Papá"),
        m("reembolso", "2026-10-23", -200, "Reembolsos y puntos"), m("otro mes", "2026-11-02", -300, "Ingreso extra")],
    };
    expect(resumenMes("2026-10", d, "2026-10-23")).toMatchObject({ ingresos: 11000, ingresosExtra: 1000, paraTi: 11000 });
    expect(resumenMes("2026-11", d, "2026-10-23")).toMatchObject({ ingresosExtra: 300, ingresos: 10300 });
  });

  it("lo que te pasas en un mes se descuenta del que sigue, desde el mes en curso", () => {
    const g = (fecha: string, monto: number) => ({ id: fecha + monto, cuentaId: "c", fecha, descripcion: "x", monto,
      categoria: "Comida fuera y bares", tipo: "Variable" as const, responsable: "Yo", origen: "manual" as const, creado: 0 });
    const d = {
      ajustes: { id: "ajustes" as const, ingresos: [{ concepto: "Sueldo", monto: 10000 }], fijos: [], ahorroPct: 0, topes: {} },
      prestamos: [], msi: [],
      movimientos: [g("2026-09-10", 15000), g("2026-10-10", 12000)],
    };
    // Octubre (en curso) descuenta los 5,000 que te pasaste en septiembre; septiembre ya cerró y no arrastra lo de agosto
    expect(resumenMes("2026-09", d, "2026-10-21")).toMatchObject({ arrastre: 0, disponible: -5000 });
    const oct = resumenMes("2026-10", d, "2026-10-21");
    expect(oct).toMatchObject({ arrastre: -5000, disponible: -7000 });
    expect(resumenMes("2026-11", d, "2026-10-21")).toMatchObject({ paraTi: 10000, arrastre: -7000, disponible: 3000 });
    expect(resumenMes("2026-12", d, "2026-10-21")).toMatchObject({ arrastre: 0, disponible: 10000 }); // noviembre aún no tiene gastos
    expect(estimarProximoMes(d, "2026-10-21").quedaria).toBe(10000 - 7000 - estimarProximoMes(d, "2026-10-21").gasto);
    // Ya en noviembre: octubre cerró, noviembre descuenta lo de octubre (que no arrastra lo de septiembre)
    expect(resumenMes("2026-11", d, "2026-11-01")).toMatchObject({ arrastre: -2000, disponible: 8000 });
  });
});

describe("mes en que cuenta cada gasto", () => {
  const mov = (fecha: string, cuentaId = "bbva", extra: Record<string, unknown> = {}) => ({ id: fecha + cuentaId, cuentaId, fecha, descripcion: "x", monto: 100,
    categoria: "Comida fuera y bares", tipo: "Variable" as const, responsable: "Yo", origen: "manual" as const, creado: 0, ...extra });
  const estados = [{ id: "e", cuentaId: "bbva", banco: "BBVA" as const, fechaCorte: "2026-10-18", importado: 0 }, { id: "e2", cuentaId: "joy", banco: "Banamex" as const, fechaCorte: "2026-10-31", importado: 0 }];
  const cortes = diasDeCorte(estados as never);

  it("lo de tarjeta de crédito cuenta en el mes de su corte; lo demás, en el de su fecha", () => {
    expect(mesContable(mov("2026-10-18"), cortes)).toBe("2026-10"); // el día del corte entra en ese estado
    expect(mesContable(mov("2026-10-19"), cortes)).toBe("2026-11");
    expect(mesContable(mov("2026-11-18"), cortes)).toBe("2026-11");
    expect(mesContable(mov("2026-11-19"), cortes)).toBe("2026-12");
    expect(mesContable(mov("2026-10-21", "efectivo"), cortes)).toBe("2026-10");
    expect(mesContable(mov("2026-02-28", "joy"), cortes)).toBe("2026-02"); // corte el 31 en un mes de 28 días
    expect(mesContable(mov("2026-09-25", "bbva", { periodo: "2026-10" }), cortes)).toBe("2026-10"); // lo que trajo el estado
    expect(mesContable(mov("2026-10-20", "bbva", { monto: -3733.58 }), cortes)).toBe("2026-10"); // un pago se queda en su fecha
  });

  it("el resumen del mes usa esa regla", () => {
    const d = {
      ajustes: { id: "ajustes" as const, ingresos: [{ concepto: "Sueldo", monto: 10000 }], fijos: [], ahorroPct: 0, topes: {} },
      prestamos: [], msi: [], estados: estados as never,
      movimientos: [mov("2026-10-15"), mov("2026-10-21"), mov("2026-10-25", "efectivo")],
    };
    expect(resumenMes("2026-10", d, "2026-11-01").gastado).toBe(200);
    expect(resumenMes("2026-11", d, "2026-11-01").gastado).toBe(100);
  });
});

describe("movimientos por estado de cuenta", () => {
  const mov = (id: string, fecha: string, monto: number, extra: Record<string, unknown> = {}) => ({ id, cuentaId: "bbva", fecha, descripcion: id, monto,
    categoria: monto < 0 ? "Pago a tarjeta" : "Comida fuera y bares", tipo: (monto < 0 ? "Pago" : "Variable") as never, responsable: "Yo", origen: "importado" as const, creado: 0, ...extra });
  const est = (fechaCorte: string, fechaLimite: string, extra: Record<string, unknown> = {}) =>
    ({ id: fechaCorte, cuentaId: "bbva", banco: "BBVA" as const, fechaCorte, fechaLimite, pagoNoIntereses: 5000, pagoMinimo: 600, importado: 0, ...extra });
  const estados = [est("2026-09-18", "2026-10-08"), est("2026-10-18", "2026-11-09")];
  const movs = [
    mov("del-corte-anterior", "2026-09-18", 100),
    mov("primero", "2026-09-19", 200),
    mov("pago-al-de-sept", "2026-10-06", -3000),
    mov("del-corte", "2026-10-18", 300),
    mov("informativo", "2026-10-10", 9999, { tipo: "Informativo" }),
    mov("pago-al-de-oct", "2026-10-20", -1000),
    mov("pizza", "2026-10-21", 99),
  ];

  it("separa lo que ya cortó de lo que va del siguiente, con lo que falta pagar", () => {
    const [g] = movimientosPorEstado(estados as never, movs, "2026-10-22");
    expect(g.desde).toBe("2026-09-19");
    expect(g.cerrado.map((m) => m.id)).toEqual(["primero", "pago-al-de-sept", "del-corte"]);
    expect(g.abierto.map((m) => m.id)).toEqual(["pago-al-de-oct", "pizza"]);
    expect(g).toMatchObject({ falta: 4000, minimoFalta: 0, vencido: false, cargosCerrado: 500, cargosAbierto: 99, pagadoDespues: 1000,
      proximoCorte: "2026-11-18", proximoLimite: "2026-12-09" });
  });

  it("marca vencida la que pasó su fecha límite sin pagarse, y la pone primero", () => {
    const otra = { ...est("2026-10-13", "2026-10-13", { pagoNoIntereses: 800 }), cuentaId: "hsbc", banco: "HSBC" as const };
    const grupos = movimientosPorEstado([...estados, otra] as never, movs, "2026-10-22");
    expect(grupos.map((g) => [g.estado.cuentaId, g.vencido])).toEqual([["hsbc", true], ["bbva", false]]);
    expect(grupos[0].proximoLimite).toBeUndefined(); // vencida: su próxima fecha depende de cuándo te pongas al corriente
  });

  it("el mismo día del mes siguiente, aunque el mes sea más corto", () => {
    expect(mismoDiaMesSiguiente("2026-10-31")).toBe("2026-11-30");
    expect(mismoDiaMesSiguiente("2026-12-18")).toBe("2027-01-18");
  });
});

describe("compra a meses capturada a mano", () => {
  const corte = (fechaCorte: string) => ({ id: fechaCorte, cuentaId: "bbva", banco: "BBVA" as const, fechaCorte, movimientos: 0 });
  const captura = { cuentaId: "bbva", descripcion: "  Pantalla  ", monto: 12000, meses: 12, responsable: "Yo" };

  it("el primer pago cae en el siguiente corte de la tarjeta", () => {
    const estados = [corte("2026-09-18"), corte("2026-10-18")] as never;
    // Antes del corte del mes: entra en ese corte
    expect(compraMSIManual({ ...captura, fechaCompra: "2026-10-22" }, estados, "a")).toMatchObject({
      actualizadoAl: "2026-11-18", pagoActual: 1, totalPagos: 12, pagoMensual: 1000, saldoPendiente: 11000, descripcion: "Pantalla", manual: true,
    });
    expect(compraMSIManual({ ...captura, fechaCompra: "2026-11-18" }, estados, "a").actualizadoAl).toBe("2026-11-18");
    expect(compraMSIManual({ ...captura, fechaCompra: "2026-11-19" }, estados, "a").actualizadoAl).toBe("2026-12-18");
  });

  it("cuenta 12 mensualidades, ni una más", () => {
    const c = compraMSIManual({ ...captura, fechaCompra: "2026-10-22" }, [corte("2026-10-18")] as never, "a");
    expect(ultimoCargo(c)).toBe("2027-10");
    expect(msiDelMes([c], "2026-10")).toBe(0);
    expect(msiDelMes([c], "2026-11")).toBe(1000);
    expect(msiDelMes([c], "2027-10")).toBe(1000);
    expect(msiDelMes([c], "2027-11")).toBe(0);
  });

  it("sin estados de esa tarjeta, el primer pago va en el mes de la compra", () => {
    expect(compraMSIManual({ ...captura, fechaCompra: "2026-10-22" }, [], "a").actualizadoAl).toBe("2026-10-22");
  });
});

describe("mensualidades", () => {
  const mov = (descripcion: string, monto: number) => ({ id: "m", cuentaId: "bbva", fecha: "2026-10-18", descripcion, monto,
    categoria: "Compras a meses (propias)", tipo: "A meses (MSI)" as const, responsable: "Yo", origen: "importado" as const, creado: 0 });
  it("da el total de la compra y lo que falta", () => {
    const compra = { id: "c", cuentaId: "bbva", descripcion: "WALMART", montoOriginal: 8496, saldoPendiente: 6372, pagoMensual: 708, pagoActual: 3, totalPagos: 12, responsable: "Yo", actualizadoAl: "2026-10-18" };
    expect(detalleMensualidad(mov("03 DE 12 WALMART VENTA EN LIN", 708), [compra])).toMatchObject({ pago: 3, de: 12, total: 8496, aprox: false, falta: 708 * 9 });
    // Sin la compra registrada: se estima con la mensualidad × plazo
    expect(detalleMensualidad(mov("05 DE 06 LIVERPOOL", 1000), [])).toMatchObject({ pago: 5, de: 6, total: 6000, aprox: true, falta: 1000 });
    expect(detalleMensualidad(mov("OXXO CENTRO", 80), [])).toBeNull();
  });
});

describe("categorías", () => {
  const sinReglas = new Map<string, Regla>();
  it("normaliza quitando mensualidades, números y sufijos", () => {
    expect(normalizar("05 DE 13 SEARS CE COMERCIO ELE ; Tarjeta Digital ***8347")).toBe("SEARS CE COMERCIO ELE");
    expect(normalizar("FARM2510 CENTRO13")).toBe("FARM CENTRO");
  });
  it("altas a meses no suman", () => {
    for (const d of ["AMAZON A MESES A 12 MESES S/I", "CLINICA BELEZO A 03 MESES S/I", "ALTA PARA MESES S/INTERESES", "AMAZON A MESES"]) {
      expect(clasificar(d, 100, sinReglas).tipo).toBe("Informativo");
    }
    expect(clasificar("05 DE 12 AMAZON A MESES", 100, sinReglas).tipo).toBe("A meses (MSI)");
  });
  it("reglas que bastan con contener la palabra (servicios de otra persona en tu tarjeta)", () => {
    const reglas = new Map<string, Regla>(["CFE", "AGUA", "TELMEX"].map((c) => [c, { clave: c, categoria: "Familia - Papá", responsable: "Papá", contiene: true }]));
    for (const d of ["CSS 160330CP7 CFE SUM SERV BASMU MEX", "JMA 840106356 AGUA WEB", "TME 840315KT6 PAGO MI TELMEX MEX"]) {
      expect(clasificar(d, 384, reglas)).toMatchObject({ categoria: "Familia - Papá", responsable: "Papá" });
    }
    expect(clasificar("APPLE.COM/BILL CUPERTINO CA", 49.25, reglas).responsable).toBe("Yo");
    // Regla limitada a una cuenta: el seguro en esa tarjeta es de Luis; en otra tarjeta, tuyo
    reglas.set("QUALITAS", { clave: "QUALITAS", categoria: "Por cobrar - Luis", responsable: "Luis", contiene: true, cuentaId: "banamex-joy" });
    expect(clasificar("QUALITAS SEG MEXICO QCS 931209G49MX", 600, reglas, "banamex-joy").responsable).toBe("Luis");
    expect(clasificar("QCS 931209G49 QUALITAS MEX", 500, reglas, "hsbc").responsable).toBe("Yo");
  });

  it("palabras completas: sin falsos positivos por pedazos de palabra", () => {
    const cat = (d: string) => clasificar(d, 300, sinReglas).categoria;
    expect(cat("MERCADO LIBRE")).toBe("Compras en línea");
    expect(cat("TACOS EL ASADO")).toBe("Comida fuera y bares");
    expect(cat("DIDI FOOD")).toBe("Comida fuera y bares");
    expect(cat("UBER EATS")).toBe("Comida fuera y bares");
    expect(cat("UBER TRIP")).toBe("Transporte (Uber/Didi/bus)");
    expect(cat("INMOBILIARIA SIL")).toBe("Hogar, oficina y servicios");
    expect(cat("COMISION FEDERAL DE ELECTRICIDAD")).toBe("Hogar, oficina y servicios");
    expect(cat("ACEITE DE OLIVA GOURMET")).not.toBe("Intereses y comisiones");
    expect(cat("IVA POR INTERESES Y/O COMISIONES")).toBe("Intereses y comisiones");
  });

  it("una regla de otra persona no se contagia por parecido a todo el comercio", () => {
    const reglas = new Map<string, Regla>([["OXXO CENTRO", { clave: "OXXO CENTRO", categoria: "Familia - Papá", responsable: "Papá" }]]);
    expect(clasificar("OXXO CENTRO", 80, reglas).responsable).toBe("Papá");
    expect(clasificar("OXXO ALAMEDA", 80, reglas)).toMatchObject({ responsable: "Yo", categoria: "OXXO y tiendas de conveniencia" });
  });

  it("palabras clave y reglas de hormiga / gasto fuerte", () => {
    expect(clasificar("OXXO ALAMEDA", 76, sinReglas)).toMatchObject({ categoria: "OXXO y tiendas de conveniencia", tipo: "Hormiga" });
    expect(clasificar("BMOVIL.PAGO TDC", -4000, sinReglas)).toMatchObject({ categoria: "Pago a tarjeta", tipo: "Pago" });
    expect(clasificar("PAGOS INTERBANCARIOS", -1500, sinReglas)).toMatchObject({ categoria: "Pago a tarjeta", tipo: "Pago" });
    expect(clasificar("TCI121023F10 APP TICKETS Cu", 102, sinReglas).categoria).toBe("Entretenimiento");
    expect(clasificar("MUEVE CIUDAD CIUDAD DE MEX MEX", 100, sinReglas).categoria).toBe("Transporte (Uber/Didi/bus)");
    expect(clasificar("CLAUDE.AI SUBSCRIPTION", 1714.95, sinReglas)).toMatchObject({ categoria: "Suscripciones digitales", tipo: "Recurrente" });
    expect(clasificar("OXXO ALAMEDA", 76, sinReglas).tipo).toBe("Hormiga");
    expect(clasificar("RESTAURANTE BAR MONACO", 1595, sinReglas)).toMatchObject({ categoria: "Comida fuera y bares", tipo: "Gasto fuerte" });
    expect(clasificar("INTERES GRAVABLE", 78.45, sinReglas).tipo).toBe("Fuga financiera");
  });
});
