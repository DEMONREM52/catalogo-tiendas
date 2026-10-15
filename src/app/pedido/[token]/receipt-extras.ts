"use client";

import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/** Enlace público del comprobante (siempre el dominio de producción, sin parámetros). */
export const receiptUrl = (token: string) => `${PRODUCTION_ORIGIN}/pedido/${encodeURIComponent(token)}`;

/** Código QR como imagen (data URL) generado en el navegador. */
export async function qrDataUrl(text: string, size = 320): Promise<string | null> {
  try {
    const QR = (await import("qrcode")).default;
    return await QR.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: size, color: { dark: "#000000", light: "#ffffff" } });
  } catch {
    return null;
  }
}

export type ReceiptPayment = { method: string; parts: Array<{ method: string; amount: number }>; received: number | null; change: number | null };

export const PAY_LABEL: Record<string, { label: string; emoji: string }> = {
  efectivo: { label: "Efectivo", emoji: "💵" },
  transferencia: { label: "Transferencia", emoji: "🏦" },
  nequi: { label: "Nequi / Daviplata", emoji: "📱" },
  tarjeta: { label: "Tarjeta", emoji: "💳" },
  mixto: { label: "Pago mixto", emoji: "🔀" },
};
export const payLabel = (m: string) => PAY_LABEL[m]?.label ?? (m ? m[0].toUpperCase() + m.slice(1) : "—");

export function normalizePayment(v: unknown): ReceiptPayment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const method = String(o.method ?? "");
  if (!method) return null;
  const parts = Array.isArray(o.parts) ? (o.parts as Array<Record<string, unknown>>).map((p) => ({ method: String(p.method ?? ""), amount: Number(p.amount ?? 0) })).filter((p) => p.amount > 0) : [];
  const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
  return { method, parts, received: num(o.received), change: num(o.change) };
}

type PdfData = {
  fileName: string;
  businessName: string;
  businessLines: string[];
  docTitle: string;
  docNumber: string;
  date: string;
  customer: string;
  customerDoc: string | null;
  seller: string | null;
  note: string | null;
  items: Array<{ name: string; qty: number; price: number }>;
  total: number;
  payment: ReceiptPayment | null;
  resolution: string | null;
  footer: string;
  qr: string | null;
  cancelled: boolean;
  /** Documento electrónico DIAN: no lleva la nota de «no reemplaza la factura electrónica». */
  electronic: boolean;
  money: (n: number) => string;
};

/** El PDF se arma con texto real (se puede buscar y copiar) y se descarga directo, sin diálogo de impresión. */
export async function downloadReceiptPdf(d: PdfData) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  let y = M;
  // jsPDF con fuentes estándar no tiene emojis: se limpian del texto.
  const clean = (s: string) => s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();

  // Encabezado
  doc.setFont("helvetica", "bold").setFontSize(17).text(clean(d.businessName), M, y + 5);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(70);
  d.businessLines.filter(Boolean).forEach((l, i) => doc.text(clean(l), M, y + 11 + i * 4.2, { maxWidth: W - M * 2 - 70 }));
  doc.setTextColor(0);
  const boxW = 64;
  doc.setDrawColor(0).setLineWidth(0.6).roundedRect(W - M - boxW, y - 1, boxW, 24, 2.5, 2.5);
  doc.setFont("helvetica", "bold").setFontSize(8).text(clean(d.docTitle).toUpperCase(), W - M - boxW / 2, y + 5, { align: "center", maxWidth: boxW - 4 });
  doc.setFontSize(15).text(clean(d.docNumber), W - M - boxW / 2, y + 13, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(70).text(d.date, W - M - boxW / 2, y + 19, { align: "center" });
  doc.setTextColor(0);
  y += 30 + Math.max(0, d.businessLines.length - 3) * 4;

  if (d.cancelled) {
    doc.setFillColor(254, 226, 226).setDrawColor(220, 38, 38).roundedRect(M, y, W - M * 2, 9, 2, 2, "FD");
    doc.setTextColor(185, 28, 28).setFont("helvetica", "bold").setFontSize(10).text("DOCUMENTO ANULADO: NO TIENE VALIDEZ", W / 2, y + 6, { align: "center" });
    doc.setTextColor(0);
    y += 13;
  }

  // Datos
  doc.setDrawColor(160).setLineWidth(0.3).roundedRect(M, y, W - M * 2, 16, 2, 2);
  doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(90).text("CLIENTE", M + 3, y + 5);
  doc.text("ATENDIÓ", M + 95, y + 5);
  doc.setTextColor(0).setFontSize(10).text(clean(d.customer || "—"), M + 3, y + 10.5, { maxWidth: 88 });
  doc.text(clean(d.seller || "—"), M + 95, y + 10.5, { maxWidth: W - M * 2 - 98 });
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  if (d.customerDoc) doc.text(`Doc.: ${d.customerDoc}`, M + 3, y + 14.5);
  y += 20;
  if (d.note) {
    const lines = doc.splitTextToSize(`Observaciones: ${clean(d.note)}`, W - M * 2);
    doc.setFontSize(9).text(lines, M, y + 3);
    y += lines.length * 4 + 3;
  }

  // Tabla
  const cols = { n: M, desc: M + 9, qty: W - M - 72, unit: W - M - 36, sub: W - M };
  const header = () => {
    doc.setLineWidth(0.6).setDrawColor(0).line(M, y, W - M, y);
    doc.setFont("helvetica", "bold").setFontSize(8).text("#", cols.n + 2, y + 5);
    doc.text("DESCRIPCIÓN", cols.desc, y + 5);
    doc.text("CANT.", cols.qty, y + 5, { align: "center" });
    doc.text("VR. UNITARIO", cols.unit, y + 5, { align: "right" });
    doc.text("SUBTOTAL", cols.sub, y + 5, { align: "right" });
    doc.line(M, y + 7.5, W - M, y + 7.5);
    y += 11;
  };
  header();
  doc.setLineWidth(0.2).setDrawColor(190);
  d.items.forEach((it, i) => {
    const lines = doc.splitTextToSize(clean(it.name), cols.qty - cols.desc - 12);
    const h = Math.max(6, lines.length * 4.2 + 2);
    if (y + h > H - 40) { doc.addPage(); y = M; header(); doc.setLineWidth(0.2).setDrawColor(190); }
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90).text(String(i + 1), cols.n + 2, y + 1);
    doc.setTextColor(0).text(lines, cols.desc, y + 1);
    doc.setFont("helvetica", "bold").text(String(it.qty), cols.qty, y + 1, { align: "center" });
    doc.setFont("helvetica", "normal").text(d.money(it.price), cols.unit, y + 1, { align: "right" });
    doc.setFont("helvetica", "bold").text(d.money(it.price * it.qty), cols.sub, y + 1, { align: "right" });
    doc.line(M, y + h - 3, W - M, y + h - 3);
    y += h;
  });

  // Totales y pago
  if (y > H - 70) { doc.addPage(); y = M; }
  y += 3;
  const units = d.items.reduce((s, i) => s + i.qty, 0);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90).text(`${d.items.length} producto${d.items.length === 1 ? "" : "s"} · ${units} unidad${units === 1 ? "" : "es"}`, M, y + 4);
  doc.setTextColor(0);
  const tW = 70;
  doc.setDrawColor(0).setLineWidth(0.6).roundedRect(W - M - tW, y, tW, 12, 2, 2);
  doc.setFont("helvetica", "bold").setFontSize(12).text("TOTAL", W - M - tW + 4, y + 8);
  doc.text(d.money(d.total), W - M - 4, y + 8, { align: "right" });
  let py = y + 17;
  if (d.payment) {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(90).text("FORMA DE PAGO", W - M - tW, py);
    doc.setTextColor(0).setFont("helvetica", "normal").setFontSize(9);
    py += 4.5;
    const parts = d.payment.method === "mixto" ? d.payment.parts : [{ method: d.payment.method, amount: d.total }];
    for (const p of parts) { doc.text(payLabel(p.method), W - M - tW, py); doc.text(d.money(p.amount), W - M, py, { align: "right" }); py += 4.5; }
    if (d.payment.received && d.payment.received > d.total) { doc.text("Recibido", W - M - tW, py); doc.text(d.money(d.payment.received), W - M, py, { align: "right" }); py += 4.5; }
    if (d.payment.change && d.payment.change > 0) { doc.setFont("helvetica", "bold").text("Vuelto", W - M - tW, py); doc.text(d.money(d.payment.change), W - M, py, { align: "right" }); py += 4.5; }
  }
  if (d.qr) {
    doc.addImage(d.qr, "PNG", M, y + 8, 26, 26);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(70).text(["Escanea para ver", "este comprobante", "en tu celular"], M + 29, y + 16);
    doc.setTextColor(0);
  }
  y = Math.max(py, y + 38) + 4;
  if (d.resolution) {
    const lines = doc.splitTextToSize(clean(d.resolution), W - M * 2);
    doc.setFontSize(7.5).setTextColor(70).text(lines, M, y);
    y += lines.length * 3.4 + 3;
  }

  // Pie
  doc.setDrawColor(190).setLineWidth(0.2).line(M, y, W - M, y);
  doc.setTextColor(0).setFont("helvetica", "bold").setFontSize(9).text(doc.splitTextToSize(clean(d.footer), W - M * 2), W / 2, y + 5, { align: "center" });
  if (!d.electronic) doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(90).text("Documento de venta generado por la tienda. No reemplaza una factura electrónica validada por la DIAN.", W / 2, y + 13, { align: "center", maxWidth: W - M * 2 });
  doc.save(d.fileName);
}
