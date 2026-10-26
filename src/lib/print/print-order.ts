"use client";

import Swal from "sweetalert2";
import { loadOrderTicket } from "./order-ticket";
import { getPrinterSettings, isDirect } from "./settings";
import { printTicket, type PrintResult } from "./transports";
import type { TicketData } from "./ticket";

const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;

/** Imprime directo una venta ya registrada (lee los mismos datos del comprobante en línea). */
export async function printOrderDirect(token: string, size: "tirilla" | "carta"): Promise<PrintResult> {
  const t = await loadOrderTicket(token).catch(() => null);
  if (!t) return { ok: false, message: "No se pudo leer el comprobante para imprimirlo." };
  return printTicket(t, size);
}

/** Si la impresión directa falla, lo dice y ofrece imprimir con la ventana del navegador. */
export async function reportPrintFailure(result: PrintResult, fallback: () => void) {
  if (result.ok) return;
  const r = await Swal.fire({
    ...swalTheme,
    icon: "warning",
    title: "No se pudo imprimir directo",
    text: result.message ?? "Revisa que la impresora esté prendida y conectada.",
    showCancelButton: true,
    confirmButtonText: "Imprimir con el navegador",
    cancelButtonText: "Cerrar",
    confirmButtonColor: "#f59e0b",
  });
  if (r.isConfirmed) fallback();
}

/**
 * Reimprimir una venta registrada: directo si este equipo tiene impresora directa;
 * si no (o si falla), el comprobante en línea de siempre en otra pestaña.
 */
export async function reprintOrder(token: string, size: "tirilla" | "carta") {
  const url = `${window.location.origin}/pedido/${token}?formato=${size === "carta" ? "carta" : "t80"}`;
  if (!isDirect(getPrinterSettings())) {
    window.open(url, "_blank");
    return;
  }
  await reportPrintFailure(await printOrderDirect(token, size), () => window.open(url, "_blank"));
}

/** Imprime un tiquete armado en el equipo (venta sin conexión) y avisa si falla. */
export async function printLocalTicket(t: TicketData, size: "tirilla" | "carta", fallbackHtml: () => void) {
  const r = await printTicket(t, size);
  await reportPrintFailure(r, fallbackHtml);
  return r;
}
