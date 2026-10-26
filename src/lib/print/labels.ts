// Etiquetas de precio y rótulos de despacho para la térmica (ESC/POS), sin ventana del navegador.
// Las impresoras de etiquetas adhesivas (TSPL/ZPL) siguen con la ventana de impresión normal.
import { EscPos } from "./escpos";
import type { PrinterSettings } from "./settings";

export type PriceLabel = { name: string; code: string; price: number };
export type CodeKind = "barcode" | "qr";

export type Rotulo = {
  store: string;
  number: number | string;
  date: string;
  from: string;
  to: string;
  units: number;
  products: number;
  notes?: string | null;
  /** Enlace que abre el traslado al escanear (seguimiento / recibir). */
  url?: string | null;
};

const cop = (n: number) => "$ " + Math.round(Number(n || 0)).toLocaleString("es-CO");

/** Una etiqueta tras otra con una línea punteada entre ellas y un solo corte al final. */
export function labelsEscpos(labels: PriceLabel[], s: PrinterSettings, opts: { code: CodeKind; showName: boolean }): Uint8Array {
  const p = new EscPos(s.codepage, s.width);
  labels.forEach((l, i) => {
    p.align("center");
    if (opts.showName) p.bold(true).para(l.name).bold(false);
    if (l.code) {
      if (opts.code === "qr") p.qr(l.code, 5).line(l.code);
      else p.barcode(l.code, 56);
    }
    p.size(3).bold(true).line(cop(l.price)).size(1).bold(false);
    if (i < labels.length - 1) p.line("- ".repeat(Math.floor(s.width / 2)));
  });
  p.feed(3);
  if (s.cut) p.cut();
  return p.build();
}

/** Rótulo para pegar en cada bulto: para quién va, de dónde sale, bulto N de M y QR del traslado. */
export function rotuloEscpos(r: Rotulo, boxes: number, s: PrinterSettings): Uint8Array {
  const p = new EscPos(s.codepage, s.width);
  const n = Math.max(1, Math.min(99, Math.round(boxes)));
  for (let b = 1; b <= n; b++) {
    p.align("center").bold(true).line(r.store).bold(false).rule("=");
    p.align("left").line("PARA:").size(3).bold(true).para(r.to.toUpperCase(), Math.floor(s.width / 2)).size(1).bold(false);
    p.line(`DE: ${r.from}`).rule();
    p.lr(`Traslado N.º ${r.number}`, r.date);
    p.lr(`${r.products} producto(s)`, `${r.units} unidad(es)`);
    if (r.notes) p.para(`Nota: ${r.notes}`);
    p.rule().align("center").size(3).bold(true).line(`BULTO ${b} DE ${n}`).size(1).bold(false);
    if (r.url) p.feed(1).qr(r.url, 6).line("Escanea para ver y recibir");
    p.feed(3);
    if (s.cut) p.cut();
  }
  return p.build();
}
