"use client";

import { draftKind, type PosDraft } from "./drafts";
import type { ContingencyInfo } from "./contingency";
import { ticketHtml, ticketMoney, type TicketData } from "@/lib/print/ticket";
import { printHtmlWindow } from "@/lib/print/transports";

/**
 * Comprobante que se imprime SIN conexión (no necesita el servidor):
 *   · Factura de contingencia: factura de venta en papel con su número y la resolución de contingencia;
 *     al volver la conexión se transmite a la DIAN como factura electrónica (plazo: 48 horas).
 *   · Remisión o factura que se numera al volver: comprobante provisional para el cliente.
 * Sale por la impresora de este equipo (ventana del navegador o térmica directa).
 */
export type OfflineReceiptContext = {
  storeName: string;
  contingency?: ContingencyInfo | null;
  size: "tirilla" | "carta";
};

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", nequi: "Nequi / Daviplata", tarjeta: "Tarjeta", mixto: "Mixto" };

/** Base e IVA por tarifa (precios con IVA incluido, como en el POS). */
function taxes(d: PosDraft, include: boolean) {
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const i of d.cart) {
    const rate = Number(i.taxRate ?? 0);
    const gross = i.qty * i.price;
    const base = include ? gross / (1 + rate / 100) : gross;
    const cur = byRate.get(rate) ?? { base: 0, tax: 0 };
    byRate.set(rate, { base: cur.base + base, tax: cur.tax + (include ? gross - base : base * rate / 100) });
  }
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]);
}

export function ticketFromDraft(d: PosDraft, ctx: Omit<OfflineReceiptContext, "size">): TicketData {
  const kind = draftKind(d);
  const contingency = kind === "contingencia" && d.fiscal ? d.fiscal : null;
  // Los datos del emisor van con la factura (del punto donde se hizo), no con el punto abierto ahora.
  const issuer = contingency ? contingency.issuer ?? ctx.contingency?.issuer : null;
  const include = contingency?.prices_include_tax ?? ctx.contingency?.prices_include_tax ?? true;
  const nit = issuer?.document_number ? `${issuer.document_type === "NIT" ? "NIT" : issuer.document_type} ${issuer.document_number}${issuer.verification_digit ? `-${issuer.verification_digit}` : ""}` : "";
  const header = issuer
    ? [
        issuer.trade_name || issuer.legal_name,
        [issuer.legal_name, nit].filter(Boolean).join(" · "),
        [[issuer.establishment?.address ?? issuer.fiscal_address, issuer.establishment?.city ?? issuer.city].filter(Boolean).join(" · "), issuer.phone ? `Tel. ${issuer.phone}` : ""].filter(Boolean).join(" · "),
        issuer.tax_regime
          ? `${issuer.tax_regime === "responsable_iva" ? "Responsable de IVA" : issuer.tax_regime === "no_responsable_iva" ? "No responsable de IVA" : issuer.tax_regime}${issuer.tax_responsibilities?.length ? ` · ${issuer.tax_responsibilities.join(", ")}` : ""}`
          : "",
      ].filter(Boolean)
    : [ctx.storeName];
  const r = contingency?.resolution;
  const legal = contingency
    ? [
        r?.number ? `Resolución DIAN de contingencia N.º ${r.number}${r.date ? ` del ${fmtDate(r.date)}` : ""}. Numeración autorizada del ${contingency.prefix}${r.from} al ${contingency.prefix}${r.to}${r.valid_until ? `, vigente hasta ${fmtDate(r.valid_until)}` : ""}.` : "",
        "Factura de talonario expedida en contingencia por inconvenientes tecnológicos del facturador electrónico. Se transmitirá a la DIAN como factura electrónica dentro de las 48 horas siguientes a superar el inconveniente.",
      ].filter(Boolean)
    : [kind === "remision"
        ? "Venta registrada sin conexión. El número definitivo de la remisión se asigna al volver la conexión."
        : "Venta registrada sin conexión. La factura (electrónica, si aplica) se emite apenas vuelva la conexión."];
  const customerDoc = d.customerDocument?.trim() || (contingency ? contingency.final_consumer_doc ?? ctx.contingency?.final_consumer?.doc ?? "222222222222" : "");
  const pay = d.payment;
  const payment: Array<[string, string]> = [];
  if (pay) {
    payment.push(["Pago", METHOD[pay.method] ?? pay.method]);
    if (pay.method === "mixto") for (const p of pay.parts) payment.push([`· ${METHOD[p.method] ?? p.method}`, ticketMoney(p.amount)]);
    if (pay.received && pay.received > d.total) {
      payment.push(["Recibido", ticketMoney(pay.received)]);
      payment.push(["Vuelto", ticketMoney(pay.change)]);
    }
  }
  const info: Array<[string, string]> = [["Fecha", fmtDateTime(d.createdAt)]];
  if (d.pointName) info.push(["Punto", d.pointName]);
  if (d.sellerName) info.push(["Vendedor", d.sellerName]);
  info.push(["Cliente", d.customerName || "CONSUMIDOR FINAL"]);
  if (customerDoc) info.push(["Documento", customerDoc]);
  return {
    docName: contingency ? contingency.full_number : "Comprobante",
    header,
    title: contingency ? `FACTURA DE VENTA N.º ${contingency.full_number}` : kind === "remision" ? "REMISIÓN (provisional)" : "FACTURA (se numera al volver la conexión)",
    subtitle: contingency ? "Factura de contingencia (talonario)" : "Hecha sin conexión",
    practice: d.practice,
    info,
    lines: d.cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price, taxRate: i.taxRate })),
    taxes: contingency ? taxes(d, include).flatMap(([rate, v]) => [[`Base ${rate}%`, v.base], ...(rate ? [[`IVA ${rate}%`, v.tax]] : [])] as Array<[string, number]>) : undefined,
    total: d.total,
    payment,
    legal,
    warning: contingency && (contingency.environment === "sandbox" || d.practice) ? "DOCUMENTO DE PRUEBAS: SIN VALIDEZ FISCAL." : undefined,
    note: d.customerNote || undefined,
    footer: `Elaborado con RemHub · ${d.id.slice(0, 8)}`,
    cash: Boolean(pay && (pay.method === "efectivo" || pay.parts.some((p) => p.method === "efectivo" && p.amount > 0))),
  };
}

export function offlineReceiptHtml(d: PosDraft, ctx: OfflineReceiptContext) {
  return ticketHtml(ticketFromDraft(d, ctx), ctx.size);
}

/** Abre el comprobante en otra ventana para imprimir (modo navegador). Debe llamarse justo después de un toque. */
export function printOfflineReceipt(html: string) {
  return printHtmlWindow(html);
}
