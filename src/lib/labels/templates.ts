/**
 * Plantillas que trae RemHub (se acomodan al tamaño de la etiqueta) y validación de diseños
 * que llegan de la base o de un archivo importado (nunca se confía en ellos).
 */
import {
  LABEL_FORMAT_VERSION, type BarcodeElement, type BarcodeFormat, type ElementType, type EllipseElement, type ImageElement, type LabelDesign,
  type LabelElement, type LabelTemplate, type LineElement, type QrElement, type RectElement, type TextElement,
} from "./types";

let seq = 0;
export const newId = () => `e${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ------------------------------------------------------------------ elementos nuevos
export function newText(p: Partial<TextElement> = {}): TextElement {
  return {
    id: newId(), type: "text", x: 1, y: 1, w: 20, h: 5, content: "Texto", font: "sans", size: 9, minSize: 4.5, bold: true, italic: false,
    underline: false, strike: false, align: "center", valign: "middle", maxLines: 2, lineHeight: 1.08, letterSpacing: 0, autoFit: true,
    breakWords: false, balance: true, transform: "none", color: "#000000", background: null, padding: 0, ...p,
  };
}
export function newQr(p: Partial<QrElement> = {}): QrElement {
  return { id: newId(), type: "qr", x: 1, y: 1, w: 14, h: 14, content: "{codigo}", ecc: "M", quiet: 1, color: "#000000", align: "center", valign: "middle", ...p };
}
export function newBarcode(p: Partial<BarcodeElement> = {}): BarcodeElement {
  return { id: newId(), type: "barcode", x: 1, y: 1, w: 29, h: 10, content: "{codigo}", format: "CODE128", showText: false, textSize: 6, quiet: 10, color: "#000000", align: "center", ...p };
}
export const newRect = (p: Partial<RectElement> = {}): RectElement => ({ id: newId(), type: "rect", x: 1, y: 1, w: 10, h: 6, stroke: 0.3, strokeColor: "#000000", fill: null, radius: 0, ...p });
export const newEllipse = (p: Partial<EllipseElement> = {}): EllipseElement => ({ id: newId(), type: "ellipse", x: 1, y: 1, w: 8, h: 8, stroke: 0.3, strokeColor: "#000000", fill: null, ...p });
export const newLine = (p: Partial<LineElement> = {}): LineElement => ({ id: newId(), type: "line", x: 1, y: 5, w: 20, h: 0, stroke: 0.3, color: "#000000", ...p });
export const newImage = (p: Partial<ImageElement> = {}): ImageElement => ({ id: newId(), type: "image", x: 1, y: 1, w: 10, h: 6, src: "{logo}", fit: "contain", mono: true, ...p });

// ------------------------------------------------------------------ plantillas de RemHub
const r = (v: number) => Math.round(v * 100) / 100;

/** Las plantillas incluidas para una etiqueta de w × h mm (editables con «Duplicar»). */
export function builtinTemplates(w: number, h: number): LabelTemplate[] {
  const pad = r(Math.max(0.6, Math.min(w, h) * 0.04));
  const iw = r(w - 2 * pad);
  const make = (id: string, name: string, category: string, elements: LabelElement[]): LabelTemplate =>
    ({ id: `builtin:${id}`, name, category, builtin: true, design: { v: LABEL_FORMAT_VERSION, w, h, elements } });
  return [
    make("qr-ref", "QR con referencia", "QR", [
      newQr({ id: "qr", x: pad, y: pad, w: iw, h: r(h * 0.66), content: "{codigo}" }),
      newText({ id: "ref", name: "Referencia", x: pad, y: r(h * 0.7), w: iw, h: r(h * 0.27), content: "{referencia|codigo}", size: 11, minSize: 5, maxLines: 1 }),
    ]),
    make("qr-nombre", "QR con nombre (2 o 3 líneas)", "QR", [
      newQr({ id: "qr", x: pad, y: pad, w: iw, h: r(h * 0.56), content: "{codigo}" }),
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.6), w: iw, h: r(h * 0.38), content: "{nombre}", size: 9, minSize: 4.5, maxLines: 3 }),
    ]),
    make("nombre-qr-ref-precio", "Nombre, QR, referencia y precio", "QR", [
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.02), w: iw, h: r(h * 0.15), content: "{nombre}", size: 8, minSize: 4.5, maxLines: 1 }),
      newQr({ id: "qr", x: pad, y: r(h * 0.18), w: iw, h: r(h * 0.47), content: "{codigo}" }),
      newText({ id: "ref", name: "Referencia", x: pad, y: r(h * 0.66), w: iw, h: r(h * 0.16), content: "REF. {referencia|codigo}", size: 8, minSize: 4.5, maxLines: 1 }),
      newText({ id: "precio", name: "Precio", x: pad, y: r(h * 0.82), w: iw, h: r(h * 0.17), content: "{precio}", size: 9, minSize: 5, maxLines: 1 }),
    ]),
    make("qr-catalogo", "QR al catálogo con nombre", "QR", [
      newQr({ id: "qr", x: pad, y: pad, w: iw, h: r(h * 0.56), content: "{url_producto}" }),
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.6), w: iw, h: r(h * 0.24), content: "{nombre}", size: 8, minSize: 4.5, maxLines: 2 }),
      newText({ id: "ref", name: "Referencia", x: pad, y: r(h * 0.84), w: iw, h: r(h * 0.14), content: "{referencia|codigo}", size: 7, minSize: 4.5, maxLines: 1, bold: false }),
    ]),
    make("barras-ref", "Código de barras con referencia", "Barras", [
      newBarcode({ id: "barras", x: pad, y: pad, w: iw, h: r(h * 0.62), content: "{codigo}" }),
      newText({ id: "ref", name: "Referencia", x: pad, y: r(h * 0.68), w: iw, h: r(h * 0.28), content: "{referencia|codigo}", size: 10, minSize: 5, maxLines: 1 }),
    ]),
    make("producto-precio", "Producto con precio", "Precio", [
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.02), w: iw, h: r(h * 0.27), content: "{nombre}", size: 8, minSize: 4.5, maxLines: 2 }),
      newQr({ id: "qr", x: pad, y: r(h * 0.31), w: r(h * 0.66), h: r(h * 0.66), content: "{codigo}" }),
      newText({ id: "precio", name: "Precio", x: r(pad + h * 0.66 + 0.6), y: r(h * 0.33), w: r(w - pad * 2 - h * 0.66 - 0.6), h: r(h * 0.3), content: "{precio}", size: 11, minSize: 5, maxLines: 1 }),
      newText({ id: "ref", name: "Referencia", x: r(pad + h * 0.66 + 0.6), y: r(h * 0.64), w: r(w - pad * 2 - h * 0.66 - 0.6), h: r(h * 0.32), content: "{referencia|codigo}", size: 7, minSize: 4, maxLines: 2, bold: false }),
    ]),
    make("mayorista", "Por mayor", "Precio", [
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.02), w: iw, h: r(h * 0.34), content: "{nombre}", size: 8, minSize: 4.5, maxLines: 2 }),
      newText({ id: "ref", name: "Referencia", x: pad, y: r(h * 0.37), w: iw, h: r(h * 0.18), content: "REF. {referencia|codigo}", size: 7, minSize: 4.5, maxLines: 1, bold: false }),
      newText({ id: "precio", name: "Precio por mayor", x: pad, y: r(h * 0.56), w: iw, h: r(h * 0.26), content: "{precio2}", size: 12, minSize: 6, maxLines: 1 }),
      newText({ id: "rotulo", name: "Rótulo", x: pad, y: r(h * 0.83), w: iw, h: r(h * 0.15), content: "POR MAYOR", size: 6, minSize: 4, maxLines: 1 }),
    ]),
    make("logo", "Con logo de la tienda", "Marca", [
      newImage({ id: "logo", x: pad, y: pad, w: iw, h: r(h * 0.22), src: "{logo}" }),
      newQr({ id: "qr", x: pad, y: r(h * 0.26), w: iw, h: r(h * 0.48), content: "{codigo}" }),
      newText({ id: "nombre", name: "Nombre", x: pad, y: r(h * 0.75), w: iw, h: r(h * 0.23), content: "{nombre}", size: 7, minSize: 4.5, maxLines: 2 }),
    ]),
    make("whatsapp", "QR de WhatsApp", "Libre", [
      newQr({ id: "qr", x: pad, y: pad, w: iw, h: r(h * 0.62), content: "{url_whatsapp}" }),
      newText({ id: "texto", name: "Texto", x: pad, y: r(h * 0.66), w: iw, h: r(h * 0.32), content: "Escríbenos\n{whatsapp}", size: 8, minSize: 4.5, maxLines: 2 }),
    ]),
    make("vacia", "En blanco (diseño libre)", "Libre", []),
  ];
}

/** Separador entre productos: etiqueta en blanco con una franja negra gruesa (marca dónde termina un producto). */
export function separatorDesign(w: number, h: number): LabelDesign {
  const bar = Math.min(4, Math.max(2, h * 0.14));
  return { v: LABEL_FORMAT_VERSION, w, h, elements: [newRect({ id: "separador", x: 0, y: r(h / 2 - bar / 2), w, h: r(bar), stroke: 0, fill: "#000000" })] };
}

// ------------------------------------------------------------------ validación (de la base o de un archivo)
const MAX_ELEMENTS = 300;
const num = (v: unknown, d: number, min: number, max: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
};
const str = (v: unknown, d: string, max: number) => (typeof v === "string" ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[], d: T) => (list.includes(v as T) ? (v as T) : d);
const color = (v: unknown, d: string) => (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : d);
const colorOrNull = (v: unknown) => (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null);
const FORMATS: BarcodeFormat[] = ["CODE128", "CODE128A", "CODE128B", "CODE128C", "CODE39", "EAN13", "EAN8", "UPC", "UPCE", "ITF", "ITF14", "codabar", "MSI", "pharmacode"];
const TYPES: ElementType[] = ["text", "qr", "barcode", "rect", "ellipse", "line", "image"];

/** Limpia un diseño: medidas dentro de rangos, opciones válidas, identificadores únicos, sin campos raros. */
export function normalizeDesign(raw: unknown): LabelDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = num(d.w, 31, 5, 500), h = num(d.h, 25, 5, 500);
  const seen = new Set<string>();
  const elements: LabelElement[] = [];
  for (const e of Array.isArray(d.elements) ? d.elements.slice(0, MAX_ELEMENTS) : []) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const type = oneOf(o.type, TYPES, "text");
    if (!TYPES.includes(o.type as ElementType)) continue;
    let id = str(o.id, "", 40).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const base = {
      id, name: str(o.name, "", 60) || undefined,
      x: num(o.x, 0, -500, 1000), y: num(o.y, 0, -500, 1000),
      w: num(o.w, 10, type === "line" ? -1000 : 0.1, 1000), h: num(o.h, type === "line" ? 0 : 5, type === "line" ? -1000 : 0.1, 1000),
      rotation: oneOf(o.rotation, [0, 90, 180, 270] as const, 0), hidden: bool(o.hidden, false), locked: bool(o.locked, false),
    };
    switch (type) {
      case "text": {
        const t = newText();
        elements.push({
          ...t, ...base, content: str(o.content, "", 2000), font: oneOf(o.font, ["sans", "condensed", "serif", "mono"] as const, "sans"),
          size: num(o.size, t.size, 1, 200), minSize: num(o.minSize, t.minSize, 1, 200), bold: bool(o.bold, t.bold), italic: bool(o.italic, false),
          underline: bool(o.underline, false), strike: bool(o.strike, false), align: oneOf(o.align, ["left", "center", "right"] as const, "center"),
          valign: oneOf(o.valign, ["top", "middle", "bottom"] as const, "middle"), maxLines: Math.round(num(o.maxLines, 2, 1, 20)),
          lineHeight: num(o.lineHeight, t.lineHeight, 0.7, 3), letterSpacing: num(o.letterSpacing, 0, -2, 10), autoFit: bool(o.autoFit, true),
          breakWords: bool(o.breakWords, false), balance: bool(o.balance, true), transform: oneOf(o.transform, ["none", "upper", "lower"] as const, "none"),
          color: color(o.color, "#000000"), background: colorOrNull(o.background), padding: num(o.padding, 0, 0, 20),
        });
        break;
      }
      case "qr":
        elements.push({ ...newQr(), ...base, content: str(o.content, "", 2000), ecc: oneOf(o.ecc, ["L", "M", "Q", "H"] as const, "M"), quiet: Math.round(num(o.quiet, 1, 0, 8)), color: color(o.color, "#000000"), align: oneOf(o.align, ["left", "center", "right"] as const, "center"), valign: oneOf(o.valign, ["top", "middle", "bottom"] as const, "middle") });
        break;
      case "barcode":
        elements.push({ ...newBarcode(), ...base, content: str(o.content, "", 200), format: oneOf(o.format, FORMATS, "CODE128"), showText: bool(o.showText, false), textSize: num(o.textSize, 6, 2, 30), quiet: Math.round(num(o.quiet, 10, 0, 20)), color: color(o.color, "#000000"), align: oneOf(o.align, ["left", "center", "right"] as const, "center") });
        break;
      case "rect":
        elements.push({ ...newRect(), ...base, stroke: num(o.stroke, 0.3, 0, 10), strokeColor: color(o.strokeColor, "#000000"), fill: colorOrNull(o.fill), radius: num(o.radius, 0, 0, 100) });
        break;
      case "ellipse":
        elements.push({ ...newEllipse(), ...base, stroke: num(o.stroke, 0.3, 0, 10), strokeColor: color(o.strokeColor, "#000000"), fill: colorOrNull(o.fill) });
        break;
      case "line":
        elements.push({ ...newLine(), ...base, stroke: num(o.stroke, 0.3, 0.05, 10), color: color(o.color, "#000000") });
        break;
      case "image":
        elements.push({ ...newImage(), ...base, src: str(o.src, "", 600_000), fit: oneOf(o.fit, ["contain", "cover"] as const, "contain"), mono: bool(o.mono, true) });
        break;
    }
  }
  return { v: LABEL_FORMAT_VERSION, w, h, elements };
}

/** Pasa un diseño a otro tamaño de etiqueta escalando posiciones y tamaños (el texto se reajusta solo). */
export function resizeDesign(d: LabelDesign, w: number, h: number): LabelDesign {
  const sx = w / d.w, sy = h / d.h;
  return {
    ...d, w, h,
    elements: d.elements.map((e) => {
      const base = { ...e, x: r(e.x * sx), y: r(e.y * sy), w: r(e.w * sx), h: r(e.h * sy) };
      if (e.type === "text") return { ...base, size: r((e as TextElement).size * Math.min(sx, sy)) } as LabelElement;
      return base as LabelElement;
    }),
  };
}
