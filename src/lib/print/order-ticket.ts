"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { ticketMoney, type TicketData } from "./ticket";

/**
 * Tiquete de una venta ya registrada, con los mismos datos del comprobante en línea (/pedido/…):
 * número del punto o fiscal, emisor, resolución, CUFE y QR, forma de pago y vuelto.
 */
const PAY: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", nequi: "Nequi / Daviplata", tarjeta: "Tarjeta", mixto: "Mixto", credito: "CRÉDITO" };
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

type Point = {
  name: string; legal_name?: string | null; nit?: string | null; address: string | null; city?: string | null; phone: string | null; email?: string | null;
  receipt_footer?: string | null; resolution?: string | null; resolution_date?: string | null; resolution_from?: number | null; resolution_to?: number | null; resolution_valid_to?: string | null;
};
type ErpDoc = { doc_number: string | null; doc_prefix?: string | null; doc_kind: "factura" | "remision" | null; seller_name: string | null; customer_doc: string | null; point: Point | null };
type FiscalDoc = {
  full_number: string; document_type: string; environment: string; status: string; cufe: string | null; qr_data: string | null; subtotal: number; tax_total: number; total: number;
  issuer: { legal_name: string; trade_name: string | null; document_type: string; document_number: string; verification_digit: string | null; tax_regime: string | null; tax_responsibilities: string[] | null; fiscal_address: string | null; city: string | null; email: string | null };
  resolution: { number: string | null; date: string | null; from: number; to: number; valid_until: string | null; prefix: string };
};

export async function loadOrderTicket(token: string): Promise<TicketData | null> {
  const sb = supabaseBrowser();
  const [orderRes, docRes, fiscalRes, payRes] = await Promise.all([
    sb.rpc("get_order_by_token_v2", { p_token: token }),
    sb.rpc("erp_order_doc_by_token", { p_token: token }),
    sb.rpc("fiscal_public_receipt", { p_token: token }),
    sb.rpc("erp_order_payment_by_token", { p_token: token }),
  ]);
  if (orderRes.error || !orderRes.data) return null;
  const data = orderRes.data as { store?: { name?: string } | null; order?: Record<string, unknown> | null; items?: Array<{ name: string; qty: number; price: number }> };
  const order = data.order ?? {};
  const doc = (docRes.error ? null : docRes.data) as ErpDoc | null;
  const fiscal = (fiscalRes.error ? null : fiscalRes.data) as FiscalDoc | null;
  const pay = (payRes.error ? null : payRes.data) as {
    method?: string; parts?: Array<{ method: string; amount: number }>; received?: number | null; change?: number | null;
    credit?: {
      balance: number; paid: number; due_date: string | null; days: number | null; status: string;
      notes?: Array<{ number: string; kind: string; amount: number; items: Array<{ name: string; qty: number }> | null }>;
    } | null;
  } | null;
  const point = doc?.point ?? null;
  const items = (data.items ?? []).map((i) => ({ name: String(i.name ?? "Producto"), qty: Number(i.qty), price: Number(i.price) }));
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);

  const header: string[] = [];
  if (fiscal) {
    const f = fiscal.issuer;
    header.push(f.trade_name || f.legal_name);
    header.push(`${f.trade_name ? `${f.legal_name} · ` : ""}${f.document_type === "NIT" ? "NIT" : f.document_type} ${f.document_number}${f.verification_digit ? `-${f.verification_digit}` : ""}`);
    if (f.fiscal_address || f.city) header.push([f.fiscal_address, f.city].filter(Boolean).join(" · "));
    if (f.tax_regime) header.push(f.tax_regime === "responsable_iva" ? "Responsable de IVA" : f.tax_regime === "no_responsable_iva" ? "No responsable de IVA" : f.tax_regime);
  } else if (point) {
    header.push(point.legal_name || point.name);
    if (point.legal_name && point.legal_name !== point.name) header.push(point.name);
    if (point.nit) header.push(`NIT ${point.nit}`);
    if (point.address || point.city) header.push([point.address, point.city].filter(Boolean).join(" · "));
    if (point.phone) header.push(`Tel. ${point.phone}`);
  } else {
    header.push(String(data.store?.name ?? "Tienda"));
  }

  const kind = fiscal
    ? fiscal.document_type === "pos_equivalent" ? "DOCUMENTO EQUIVALENTE POS" : fiscal.document_type === "contingency_invoice" ? "FACTURA DE VENTA" : "FACTURA ELECTRÓNICA DE VENTA"
    : doc?.doc_kind === "remision" ? "REMISIÓN" : doc?.doc_kind === "factura" ? "FACTURA DE VENTA" : "COMPROBANTE";
  const number = fiscal?.full_number || doc?.doc_number || (order.receipt_no ? `#${order.receipt_no}` : "");

  const legal: string[] = [];
  if (fiscal) {
    const r = fiscal.resolution;
    if (r.number) legal.push(`Resolución DIAN N.º ${r.number}${r.date ? ` del ${fmtDate(r.date)}` : ""}. Numeración del ${r.prefix}${r.from} al ${r.prefix}${r.to}${r.valid_until ? `, vigente hasta ${fmtDate(r.valid_until)}` : ""}.`);
    if (fiscal.document_type === "contingency_invoice") legal.push("Factura expedida en contingencia y transmitida a la DIAN como factura electrónica.");
    legal.push(fiscal.cufe ? `CUFE: ${fiscal.cufe}` : "Documento electrónico en validación ante la DIAN.");
  } else if (doc?.doc_kind === "factura" && point?.resolution) {
    const pre = doc.doc_prefix ? `${doc.doc_prefix}-` : "";
    legal.push(`Resolución de facturación N.º ${point.resolution}${point.resolution_date ? ` del ${fmtDate(point.resolution_date)}` : ""}.${point.resolution_from || point.resolution_to ? ` Numeración del ${pre}${point.resolution_from ?? "—"} al ${pre}${point.resolution_to ?? "—"}.` : ""}${point.resolution_valid_to ? ` Vigente hasta ${fmtDate(point.resolution_valid_to)}.` : ""}`);
  }

  const payment: Array<[string, string]> = [];
  if (pay?.method) {
    payment.push(["Pago", PAY[pay.method] ?? pay.method]);
    if (pay.method === "mixto") for (const p of pay.parts ?? []) if (Number(p.amount) > 0) payment.push([`· ${PAY[p.method] ?? p.method}`, ticketMoney(Number(p.amount))]);
    if (pay.received && Number(pay.received) > total) {
      payment.push(["Recibido", ticketMoney(Number(pay.received))]);
      payment.push(["Vuelto", ticketMoney(Number(pay.change ?? 0))]);
    }
  }
  // Venta a crédito (20261334): plazo, vence, abonado y saldo, y la firma del cliente.
  const credit = pay?.credit ?? null;
  if (credit) {
    if (credit.days) payment.push(["Plazo", `${credit.days} día${credit.days === 1 ? "" : "s"}`]);
    payment.push(["Vence", fmtDate(credit.due_date)]);
    for (const n of credit.notes ?? []) {
      payment.push([n.items?.length ? `${n.number} devolución` : n.number, `${n.kind === "credit" ? "-" : "+"}${ticketMoney(Number(n.amount))}`]);
      for (const i of n.items ?? []) payment.push([`  ${i.qty} x ${i.name}`, ""]);
    }
    if (Number(credit.paid) > 0) payment.push(["Abonado", ticketMoney(Number(credit.paid))]);
    payment.push([credit.status === "paid" ? "Saldo (pagado)" : "Saldo", ticketMoney(Number(credit.balance))]);
    if (order.status !== "cancelled") {
      legal.push(`Recibí la mercancía y me comprometo a pagar ${ticketMoney(total)} a más tardar el ${fmtDate(credit.due_date)}.`);
      legal.push("");
      legal.push("Firma: ______________________");
      legal.push("C.C.:  ______________________");
    }
  }
  const cash = Boolean(pay?.method === "efectivo" || pay?.parts?.some((p) => p.method === "efectivo" && Number(p.amount) > 0));
  const customer = String(order.customer_name ?? "CONSUMIDOR FINAL");
  const consulta = `${PRODUCTION_ORIGIN}/pedido/${encodeURIComponent(token)}`;

  return {
    docName: `${kind} ${number}`.trim(),
    header,
    title: `${kind}${number ? ` N.º ${number}` : ""}`,
    subtitle: order.status === "cancelled" ? "ANULADO" : credit ? (credit.status === "paid" ? "CRÉDITO - PAGADO" : "*** A CRÉDITO ***") : undefined,
    info: [
      ["Fecha", new Date(String(order.created_at ?? Date.now())).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })],
      ...(point?.name ? ([["Punto", point.name]] as Array<[string, string]>) : []),
      ...(doc?.seller_name ? ([["Vendedor", doc.seller_name]] as Array<[string, string]>) : []),
      ["Cliente", customer],
      ...(doc?.customer_doc ? ([["Documento", doc.customer_doc]] as Array<[string, string]>) : []),
    ],
    lines: items,
    taxes: fiscal && Number(fiscal.tax_total) > 0 ? [["Subtotal", Number(fiscal.subtotal)], ["IVA", Number(fiscal.tax_total)]] : undefined,
    total,
    payment,
    legal,
    warning: fiscal?.environment === "sandbox" ? "DOCUMENTO DE PRUEBAS: SIN VALIDEZ FISCAL." : undefined,
    note: order.customer_note ? String(order.customer_note) : undefined,
    // QR de la DIAN si ya está; si no, el de consulta del comprobante (allí aparece el CUFE cuando la DIAN lo acepta).
    qr: { data: fiscal?.qr_data || consulta, caption: fiscal?.qr_data ? "Consulta en la DIAN" : "Consulta tu comprobante" },
    footer: point?.receipt_footer || "Gracias por tu compra",
    cash,
  };
}
