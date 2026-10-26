import { EscPos } from "./escpos";
import type { PrinterSettings } from "./settings";

/**
 * Un comprobante listo para imprimir, sin importar cómo: como página (navegador o Chrome directo)
 * o como bytes ESC/POS para una térmica. Lo arman la venta en línea (order-ticket) y la venta sin conexión.
 */
export type TicketLine = { name: string; qty: number; price: number; taxRate?: number };
export type TicketData = {
  /** Nombre del archivo / título de la página. */
  docName: string;
  /** Encabezado centrado; el primero va en negrilla. */
  header: string[];
  title: string;
  subtitle?: string;
  /** Venta de práctica: lleva la marca «no es una venta real». */
  practice?: boolean;
  info: Array<[string, string]>;
  lines: TicketLine[];
  /** Base e IVA por tarifa (solo facturas). */
  taxes?: Array<[string, number]>;
  total: number;
  payment?: Array<[string, string]>;
  /** Texto legal en recuadro (resolución, contingencia…). */
  legal?: string[];
  /** Advertencia en negrilla dentro del recuadro (documento de pruebas). */
  warning?: string;
  note?: string;
  qr?: { data: string; caption?: string } | null;
  footer?: string;
  /** Hubo efectivo: si el equipo lo tiene activado, se abre el cajón monedero. */
  cash?: boolean;
};

export const ticketMoney = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Página HTML del tiquete (tirilla 80 mm o carta). `qrImage` = imagen del QR ya generada (opcional). */
export function ticketHtml(t: TicketData, size: "tirilla" | "carta", qrImage?: string | null, autoPrint = true) {
  const narrow = size === "tirilla";
  const lines = t.lines.map((i) => `
    <tr><td colspan="3" class="desc">${esc(i.name)}</td></tr>
    <tr class="sub"><td>${i.qty} × ${ticketMoney(i.price)}${i.taxRate ? ` · IVA ${i.taxRate}%` : ""}</td><td></td><td class="r">${ticketMoney(i.qty * i.price)}</td></tr>`).join("");
  const rows = (pairs: Array<[string, string]> | undefined) => (pairs ?? []).map(([a, b]) => `<tr><td>${esc(a)}</td><td class="r">${esc(b)}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(t.docName)}</title>
<style>
  @page { size: ${narrow ? "80mm auto" : "letter"}; margin: ${narrow ? "3mm" : "14mm"}; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: ${narrow ? "11px" : "13px"}; color: #000; margin: 0 auto; width: ${narrow ? "74mm" : "auto"}; max-width: ${narrow ? "74mm" : "180mm"}; }
  h1 { font-size: ${narrow ? "13px" : "17px"}; margin: 6px 0 2px; text-align: center; }
  .c { text-align: center; } .r { text-align: right; } .muted { color: #333; } .small { font-size: ${narrow ? "9.5px" : "11px"}; }
  table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
  .desc { padding-top: 4px; font-weight: 600; } .sub td { color: #222; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .total td { font-size: ${narrow ? "13px" : "16px"}; font-weight: 800; padding-top: 4px; }
  .box { border: 1px solid #000; padding: 4px 6px; margin: 6px 0; }
  .qr { display: block; margin: 6px auto 0; width: ${narrow ? "34mm" : "38mm"}; height: auto; }
</style></head><body>
  ${t.header.map((h, i) => `<div class="c${i ? " small muted" : ""}">${i ? esc(h) : `<b>${esc(h)}</b>`}</div>`).join("\n  ")}
  ${t.practice ? `<div class="box c"><b>PRÁCTICA · NO ES UNA VENTA REAL</b></div>` : ""}
  <h1>${esc(t.title)}</h1>
  ${t.subtitle ? `<div class="c small"><b>${esc(t.subtitle)}</b></div>` : ""}
  <hr/>
  <table class="small">${rows(t.info)}</table>
  <hr/>
  <table>${lines}</table>
  <hr/>
  <table>
    ${(t.taxes ?? []).map(([label, v]) => `<tr><td>${esc(label)}</td><td class="r">${ticketMoney(v)}</td></tr>`).join("")}
    <tr class="total"><td>TOTAL</td><td class="r">${ticketMoney(t.total)}</td></tr>
    ${rows(t.payment)}
  </table>
  ${t.legal?.length || t.warning ? `<div class="box small">${[...(t.legal ?? []).map(esc), t.warning ? `<b>${esc(t.warning)}</b>` : ""].filter(Boolean).join("<br/>")}</div>` : ""}
  ${t.note ? `<div class="small">Nota: ${esc(t.note)}</div>` : ""}
  ${qrImage ? `<img class="qr" src="${qrImage}" alt="QR"/>${t.qr?.caption ? `<div class="c small">${esc(t.qr.caption)}</div>` : ""}` : ""}
  ${t.footer ? `<div class="c small muted" style="margin-top:6px">${esc(t.footer)}</div>` : ""}
  ${autoPrint ? `<script>window.onload = function () { setTimeout(function () { window.print(); }, 150); };</script>` : ""}
</body></html>`;
}

/** Bytes ESC/POS del tiquete para la térmica (ancho, tildes, corte, cajón y copias según el equipo). */
export function ticketEscpos(t: TicketData, s: PrinterSettings): Uint8Array {
  const p = new EscPos(s.codepage, s.width);
  if (t.cash && s.drawer) p.drawer();
  for (let copy = 0; copy < s.copies; copy++) {
    p.align("center");
    t.header.forEach((h, i) => {
      if (i === 0) p.bold(true).para(h).bold(false);
      else p.para(h);
    });
    if (t.practice) p.bold(true).line("*** PRÁCTICA: NO ES UNA VENTA REAL ***").bold(false);
    p.feed(1).bold(true).size(2).para(t.title).size(1).bold(false);
    if (t.subtitle) p.para(t.subtitle);
    if (copy > 0) p.line("(COPIA)");
    p.align("left").rule();
    for (const [a, b] of t.info) p.lr(a, b);
    p.rule();
    for (const i of t.lines) {
      p.para(i.name);
      p.lr(`  ${i.qty} x ${ticketMoney(i.price)}${i.taxRate ? ` IVA ${i.taxRate}%` : ""}`, ticketMoney(i.qty * i.price));
    }
    p.rule();
    for (const [label, v] of t.taxes ?? []) p.lr(label, ticketMoney(v));
    p.bold(true).size(2).lr("TOTAL", ticketMoney(t.total)).size(1).bold(false);
    for (const [a, b] of t.payment ?? []) p.lr(a, b);
    if (t.legal?.length || t.warning) {
      p.rule();
      for (const l of t.legal ?? []) p.para(l);
      if (t.warning) p.bold(true).para(t.warning).bold(false);
    }
    if (t.note) p.rule().para(`Nota: ${t.note}`);
    if (s.qr && t.qr?.data) {
      p.feed(1).align("center").qr(t.qr.data, s.width >= 42 ? 6 : 5);
      if (t.qr.caption) p.para(t.qr.caption);
      p.align("left");
    }
    if (t.footer) p.feed(1).align("center").para(t.footer).align("left");
    p.feed(4);
    if (s.cut) p.cut();
  }
  return p.build();
}

/** Tiquete de prueba: tildes, eñes, QR y corte (para elegir la página de códigos y el ancho). */
export function testTicket(): TicketData {
  return {
    docName: "Prueba RemHub",
    header: ["RemHub · Prueba de impresión", "Si ves bien estas letras, quedó listo:", "Ñandú, café, acción, pingüino ¿listo? ¡sí! N.º 1"],
    title: "PRUEBA DE IMPRESIÓN",
    subtitle: new Date().toLocaleString("es-CO"),
    info: [["Equipo", navigatorName()], ["Revisa", "tildes, corte y QR"]],
    lines: [{ name: "Producto de ejemplo con un nombre largo para ver cómo se corta", qty: 2, price: 12500 }, { name: "Otro producto", qty: 1, price: 3000 }],
    total: 28000,
    payment: [["Pago", "Efectivo"], ["Recibido", ticketMoney(30000)], ["Vuelto", ticketMoney(2000)]],
    legal: ["Así se ve el recuadro de la resolución y los textos legales."],
    qr: { data: "https://remhub.co", caption: "Código QR de prueba" },
    footer: "Gracias por tu compra",
  };
}

function navigatorName() {
  if (typeof navigator === "undefined") return "Este equipo";
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Este equipo";
}
