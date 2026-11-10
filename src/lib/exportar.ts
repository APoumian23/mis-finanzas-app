import * as XLSX from "xlsx";
import { estadoPrestamo, resumenMes, todosLosDeudores } from "./calculos";
import { exportarTodo } from "./db";
import { CLAVE_ULTIMO_RESPALDO, hoyISO, mesDe } from "./util";

/** En iPhone abre la hoja de "Compartir" (Guardar en Archivos, AirDrop…); en la Mac descarga el archivo. */
export async function compartirArchivo(nombre: string, datos: BlobPart, tipo: string): Promise<void> {
  const archivo = new File([datos], nombre, { type: tipo });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(archivo);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function descargarRespaldo(): Promise<void> {
  const r = await exportarTodo();
  await compartirArchivo(`mis-finanzas-respaldo-${hoyISO()}.json`, JSON.stringify(r), "application/json");
  try { localStorage.setItem(CLAVE_ULTIMO_RESPALDO, hoyISO()); } catch { /* sin almacenamiento local */ }
}

export async function descargarExcel(): Promise<void> {
  const r = await exportarTodo();
  const nombreCuenta = new Map(r.cuentas.map((c) => [c.id, c.nombre]));
  const libro = XLSX.utils.book_new();
  const hoja = (nombre: string, filas: Record<string, unknown>[]) =>
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), nombre);

  const mes = mesDe(hoyISO());
  const m = resumenMes(mes, { ajustes: r.ajustes, prestamos: r.prestamos, msi: r.msi, movimientos: r.movimientos, estados: r.estados });
  hoja("Mi mes", [
    { Concepto: "Ingresos", Monto: m.ingresos },
    { Concepto: "Préstamos", Monto: m.prestamos },
    { Concepto: "Tus compras a meses", Monto: m.msiPropio },
    { Concepto: "Otros gastos fijos", Monto: m.fijos },
    { Concepto: "Libre", Monto: m.libre },
    { Concepto: "Ahorro", Monto: m.ahorro },
    { Concepto: "Para tus cosas", Monto: m.paraTi },
    { Concepto: "Gastado este mes", Monto: m.gastado },
    { Concepto: "Disponible", Monto: m.disponible },
  ]);
  hoja("Movimientos", [...r.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((x) => ({
    Fecha: x.fecha, Cuenta: nombreCuenta.get(x.cuentaId) ?? "", Descripción: x.descripcion, Monto: x.monto,
    Categoría: x.categoria, Tipo: x.tipo, Responsable: x.responsable, Nota: x.nota ?? "", Origen: x.origen,
  })));
  hoja("Estados de cuenta", r.estados.map((e) => ({
    Cuenta: nombreCuenta.get(e.cuentaId) ?? e.banco, "Fecha de corte": e.fechaCorte, "Fecha límite": e.fechaLimite ?? "",
    "Pago para no generar intereses": e.pagoNoIntereses ?? "", "Pago mínimo": e.pagoMinimo ?? "",
    Intereses: e.intereses ?? "", Comisiones: e.comisiones ?? "", IVA: e.iva ?? "",
  })));
  hoja("Meses sin intereses", r.msi.map((c) => ({
    Compra: c.descripcion, Cuenta: nombreCuenta.get(c.cuentaId) ?? "", "Monto original": c.montoOriginal,
    "Saldo pendiente": c.saldoPendiente, "Pago mensual": c.pagoMensual, Pago: `${c.pagoActual} de ${c.totalPagos}`,
    Responsable: c.responsable,
  })));
  hoja("Préstamos", r.prestamos.map((p) => {
    const e = estadoPrestamo(p);
    return {
      Préstamo: p.nombre, "Saldo hoy": e.saldo, "Tasa anual": p.tasaAnual, "Pago al mes": p.pagoMensual,
      Pagado: e.pagado, Termina: e.terminaEn ?? "Nunca con ese pago",
    };
  }));
  const deudores = todosLosDeudores(r.deudores, r.movimientos, r.msi);
  hoja("Por cobrar", [...deudores.lista, ...deudores.sinLista].map((c) => ({
    Persona: c.deudor.nombre, "Te debe hoy": c.debeHoy, "Falta por cargarse": c.porCargar, Compromiso: c.compromiso, Reembolsado: c.reembolsado,
  })));
  const datos = XLSX.write(libro, { type: "array", bookType: "xlsx" });
  await compartirArchivo(`mis-finanzas-${hoyISO()}.xlsx`, datos,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
