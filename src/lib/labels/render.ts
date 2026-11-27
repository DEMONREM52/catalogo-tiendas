/**
 * Dibuja una etiqueta como SVG en milímetros. Lo usan la vista previa, el editor y la impresión:
 * una sola representación, para que lo que se ve sea lo que sale.
 *
 * Seguridad: todo texto y atributo se escapa; las imágenes solo pueden ser https, una ruta de RemHub
 * o una imagen subida (png, jpeg, webp, gif; nunca SVG); los colores se validan. No se ejecuta nada.
 */
import { barsPath, layoutBarcode, layoutQr, qrPath, type CodeIssue } from "./codes";
import { resolveTokens, type LabelData } from "./data";
import { FONT_FAMILY, fitText, type Measure } from "./text-fit";
import { MM_PER_PT, snapMm, type Align, type LabelDesign, type LabelElement, type VAlign } from "./types";

export type ElementIssue = CodeIssue & { elementId: string; elementName: string };
export type RenderInput = {
  design: LabelDesign;
  data: LabelData;
  dpi: number;
  measure: Measure;
  /** Imágenes de «{logo}» y «{foto}». */
  images?: { logo?: string | null; foto?: string | null };
};
export type Rendered = { body: string; issues: ElementIssue[] };

export function escapeXml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function safeColor(c: string | null | undefined, fallback = "#000000") {
  return typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fallback;
}
const MAX_DATA_URL = 600_000;
/** Solo imágenes seguras: https, una ruta de RemHub o una imagen subida (nunca SVG ni javascript:). */
export function safeImageUrl(src: string | null | undefined): string | null {
  const s = String(src ?? "").trim();
  if (!s) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s.length <= MAX_DATA_URL ? s : null;
  if (/^\/(?!\/)[^\s"'<>]*$/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !/[\s"'<>]/.test(s) ? u.toString() : null;
  } catch {
    return null;
  }
}

const n = (v: number) => String(Math.round(v * 10000) / 10000);
const alignOff = (a: Align | VAlign, free: number) => (a === "center" || a === "middle" ? free / 2 : a === "right" || a === "bottom" ? free : 0);

/** Caja que ocupa un elemento girado (para saber si se sale). */
function rotatedBox(el: LabelElement) {
  const r = el.rotation ?? 0;
  if (r === 90 || r === 270) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    return { x: cx - el.h / 2, y: cy - el.w / 2, w: el.h, h: el.w };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

export function elementLabel(el: LabelElement) {
  if (el.name) return el.name;
  return { text: "Texto", qr: "QR", barcode: "Código de barras", rect: "Rectángulo", ellipse: "Círculo", line: "Línea", image: "Imagen" }[el.type];
}

export function renderLabel(input: RenderInput): Rendered {
  const { design, data, dpi, measure } = input;
  const issues: ElementIssue[] = [];
  let body = "";
  for (const raw of design.elements) {
    if (raw.hidden) continue;
    // Posición en puntos enteros de la impresora (los códigos quedan nítidos).
    const el = { ...raw, x: snapMm(raw.x, dpi), y: snapMm(raw.y, dpi) } as LabelElement;
    const add = (level: CodeIssue["level"], message: string) => issues.push({ level, message, elementId: raw.id, elementName: elementLabel(raw) });
    const box = rotatedBox(raw);
    if (box.x < -0.05 || box.y < -0.05 || box.x + box.w > design.w + 0.05 || box.y + box.h > design.h + 0.05) {
      add("warn", "Se sale de la etiqueta: lo que quede afuera no se imprime.");
    }
    let inner = "";
    switch (el.type) {
      case "text": inner = drawText(el, resolveTokens(el.content, data), measure, add); break;
      case "qr": inner = drawQr(el, resolveTokens(el.content, data).trim(), dpi, add); break;
      case "barcode": inner = drawBarcode(el, resolveTokens(el.content, data).trim(), dpi, measure, add); break;
      case "rect": {
        const sw = Math.max(0, el.stroke);
        inner = `<rect x="${n(el.x + sw / 2)}" y="${n(el.y + sw / 2)}" width="${n(Math.max(0.01, el.w - sw))}" height="${n(Math.max(0.01, el.h - sw))}" rx="${n(Math.max(0, el.radius))}" fill="${el.fill ? safeColor(el.fill) : "none"}" stroke="${sw ? safeColor(el.strokeColor) : "none"}" stroke-width="${n(sw)}"/>`;
        break;
      }
      case "ellipse": {
        const sw = Math.max(0, el.stroke);
        inner = `<ellipse cx="${n(el.x + el.w / 2)}" cy="${n(el.y + el.h / 2)}" rx="${n(Math.max(0.01, (el.w - sw) / 2))}" ry="${n(Math.max(0.01, (el.h - sw) / 2))}" fill="${el.fill ? safeColor(el.fill) : "none"}" stroke="${sw ? safeColor(el.strokeColor) : "none"}" stroke-width="${n(sw)}"/>`;
        break;
      }
      case "line":
        inner = `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x + el.w)}" y2="${n(el.y + el.h)}" stroke="${safeColor(el.color)}" stroke-width="${n(Math.max(0.05, el.stroke))}" stroke-linecap="square"/>`;
        break;
      case "image": {
        const want = el.src === "{logo}" ? input.images?.logo : el.src === "{foto}" ? input.images?.foto : el.src;
        const url = safeImageUrl(want);
        if (!url) {
          if (want) add("error", "Esa imagen no se puede usar: debe ser https, una imagen subida (PNG, JPG, WEBP) o el logo o la foto del producto.");
          else if (el.src === "{foto}") add("warn", "Este producto no tiene foto.");
          else if (el.src === "{logo}") add("warn", "La tienda no tiene logo.");
          break;
        }
        inner = `<image href="${escapeXml(url)}" x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" preserveAspectRatio="${el.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}"${el.mono ? ' filter="url(#rh-mono)"' : ""}/>`;
        break;
      }
    }
    if (!inner) continue;
    const r = raw.rotation ?? 0;
    body += r ? `<g transform="rotate(${r} ${n(el.x + el.w / 2)} ${n(el.y + el.h / 2)})">${inner}</g>` : inner;
  }
  return { body, issues };
}

type Add = (level: CodeIssue["level"], message: string) => void;

function drawText(el: Extract<LabelElement, { type: "text" }>, text: string, measure: Measure, add: Add) {
  const fit = fitText(text, el, measure);
  let out = el.background ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="${safeColor(el.background, "#ffffff")}"/>` : "";
  if (!fit.lines.length) return out;
  if (fit.overflow) add("warn", `El texto no cabe ni con letra de ${fit.size} pt: agranda la caja, permite más líneas o acórtalo. No se corta: se imprime saliéndose.`);
  else if (fit.brokeWords) add("warn", "Se partió una palabra para que cupiera (lo pediste en «Partir palabras largas»).");
  const pad = Math.max(0, el.padding || 0);
  const ix = el.x + pad, iy = el.y + pad, iw = el.w - 2 * pad, ih = el.h - 2 * pad;
  const sizeMm = fit.size * MM_PER_PT;
  const total = fit.lines.length * fit.lineH;
  const top = iy + alignOff(el.valign, ih - total);
  const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
  const x = el.align === "center" ? ix + iw / 2 : el.align === "right" ? ix + iw : ix;
  const deco = [el.underline ? "underline" : "", el.strike ? "line-through" : ""].filter(Boolean).join(" ");
  // La línea de base deja las mayúsculas centradas en su renglón.
  const capH = 0.716 * sizeMm;
  const tspans = fit.lines.map((line, i) => `<tspan x="${n(x)}" y="${n(top + i * fit.lineH + fit.lineH / 2 + capH / 2)}">${escapeXml(line)}</tspan>`).join("");
  out += `<text font-family="${escapeXml(FONT_FAMILY[el.font] ?? FONT_FAMILY.sans)}" font-size="${n(sizeMm)}" font-weight="${el.bold ? 700 : 400}"${el.italic ? ' font-style="italic"' : ""}${deco ? ` text-decoration="${deco}"` : ""}${el.letterSpacing ? ` letter-spacing="${n(el.letterSpacing)}"` : ""} text-anchor="${anchor}" fill="${safeColor(el.color)}" xml:space="preserve">${tspans}</text>`;
  return out;
}

function drawQr(el: Extract<LabelElement, { type: "qr" }>, content: string, dpi: number, add: Add) {
  const lay = layoutQr(content, el.ecc, el.quiet, el.w, el.h, dpi);
  lay.issues.forEach((i) => add(i.level, i.message));
  if (!lay.ok) return "";
  const ox = snapMm(el.x + alignOff(el.align, el.w - lay.sideMm), dpi);
  const oy = snapMm(el.y + alignOff(el.valign, el.h - lay.sideMm), dpi);
  return `<rect x="${n(ox)}" y="${n(oy)}" width="${n(lay.sideMm)}" height="${n(lay.sideMm)}" fill="#ffffff"/>`
    + `<path d="${qrPath(lay.matrix, lay.quiet)}" transform="translate(${n(ox)} ${n(oy)}) scale(${lay.moduleMm})" fill="${safeColor(el.color)}" shape-rendering="crispEdges"/>`;
}

function drawBarcode(el: Extract<LabelElement, { type: "barcode" }>, content: string, dpi: number, measure: Measure, add: Add) {
  const lay = layoutBarcode(content, el.format, el.quiet, el.w, dpi);
  lay.issues.forEach((i) => add(i.level, i.message));
  if (!lay.ok) return "";
  const textH = el.showText ? Math.max(1, el.textSize) * MM_PER_PT * 1.15 : 0;
  const barsH = Math.max(0.5, el.h - textH - (el.showText ? 0.3 : 0));
  if (barsH < 3) add("warn", `Barras muy bajitas (${barsH.toFixed(1)} mm): agranda el alto para que el lector las tome bien.`);
  const bx = snapMm(el.x + alignOff(el.align, el.w - lay.widthMm), dpi);
  const color = safeColor(el.color);
  let out = `<rect x="${n(bx)}" y="${n(el.y)}" width="${n(lay.widthMm)}" height="${n(barsH)}" fill="#ffffff"/>`
    + `<path d="${barsPath(lay.bits, lay.quiet)}" transform="translate(${n(bx)} ${n(el.y)}) scale(${lay.moduleMm} ${n(barsH)})" fill="${color}" shape-rendering="crispEdges"/>`;
  if (el.showText) {
    const fit = fitText(lay.text, {
      w: el.w, h: textH + 0.01, font: "sans", size: el.textSize, minSize: Math.min(el.textSize, 4), bold: false, italic: false, maxLines: 1,
      lineHeight: 1.15, letterSpacing: 0, autoFit: true, breakWords: false, balance: false, transform: "none", padding: 0,
    }, measure);
    if (fit.overflow) add("warn", "El texto bajo las barras no cabe a lo ancho.");
    const sizeMm = fit.size * MM_PER_PT;
    const cx = el.align === "left" ? bx + lay.widthMm / 2 : el.align === "right" ? bx + lay.widthMm / 2 : el.x + el.w / 2;
    out += `<text x="${n(cx)}" y="${n(el.y + barsH + 0.3 + fit.lineH / 2 + 0.716 * sizeMm / 2)}" font-family="${escapeXml(FONT_FAMILY.sans)}" font-size="${n(sizeMm)}" text-anchor="middle" fill="${color}" xml:space="preserve">${escapeXml(fit.lines[0] ?? lay.text)}</text>`;
  }
  return out;
}

/** Filtro de blanco y negro para fotos (una vez por documento). */
export const MONO_DEFS = `<defs><filter id="rh-mono"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.4" intercept="-0.2"/><feFuncG type="linear" slope="1.4" intercept="-0.2"/><feFuncB type="linear" slope="1.4" intercept="-0.2"/></feComponentTransfer></filter></defs>`;

/** Una etiqueta como SVG completo de w × h mm. */
export function labelSvg(input: RenderInput, opts: { outline?: boolean } = {}): { svg: string; issues: ElementIssue[] } {
  const { design } = input;
  const r = renderLabel(input);
  const outline = opts.outline ? `<rect x="0.05" y="0.05" width="${n(design.w - 0.1)}" height="${n(design.h - 0.1)}" fill="none" stroke="#cbd5e1" stroke-width="0.1"/>` : "";
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${n(design.w)}mm" height="${n(design.h)}mm" viewBox="0 0 ${n(design.w)} ${n(design.h)}">${MONO_DEFS}<rect width="${n(design.w)}" height="${n(design.h)}" fill="#ffffff"/>${r.body}${outline}</svg>`,
    issues: r.issues,
  };
}
