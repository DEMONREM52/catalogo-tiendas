/**
 * QR y códigos de barras para etiquetas, pensados para térmicas:
 *  - Cada módulo (cuadrito del QR o barra más delgada) mide un número ENTERO de puntos de la impresora
 *    (a 203 dpi, 1 punto = 0,125 mm). Así salen nítidos, sin barras de distinto grosor.
 *  - El QR siempre es cuadrado; nunca se estira.
 *  - Si no cabe de forma legible, se dice por qué y qué hacer; nunca se corta ni se cambia el contenido.
 *
 * Generan: QR con «qrcode» (el que ya usa RemHub) y barras con «jsbarcode» (sus codificaciones, sin dibujar).
 */
import { create as createQr } from "qrcode";
import JsBarcode from "jsbarcode";
import { dotsToMm, mmToDots, type BarcodeFormat, type Ecc } from "./types";

export type CodeIssue = { level: "error" | "warn"; message: string };

// ------------------------------------------------------------------ QR
export type QrMatrix = { size: number; dark: (x: number, y: number) => boolean };

export function qrMatrix(content: string, ecc: Ecc = "M"): QrMatrix {
  const qr = createQr(content, { errorCorrectionLevel: ecc });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return { size, dark: (x, y) => Boolean(data[y * size + x]) };
}

export type QrLayout =
  | { ok: true; n: number; moduleDots: number; moduleMm: number; sideMm: number; quiet: number; matrix: QrMatrix; issues: CodeIssue[] }
  | { ok: false; issues: CodeIssue[] };

/** Cuánto mide el QR en una caja de boxW × boxH mm a esa resolución. */
export function layoutQr(content: string, ecc: Ecc, quiet: number, boxW: number, boxH: number, dpi: number): QrLayout {
  if (!content.trim()) return { ok: false, issues: [{ level: "error", message: "El QR está vacío: dile qué debe llevar." }] };
  let matrix: QrMatrix;
  try {
    matrix = qrMatrix(content, ecc);
  } catch {
    return { ok: false, issues: [{ level: "error", message: `Es demasiado texto para un QR (${content.length} caracteres). Acórtalo o usa un enlace.` }] };
  }
  const q = Math.max(0, Math.min(8, Math.round(quiet)));
  const n = matrix.size;
  const sideDots = Math.floor(mmToDots(Math.min(boxW, boxH), dpi) + 1e-6);
  const moduleDots = Math.floor(sideDots / (n + 2 * q));
  const issues: CodeIssue[] = [];
  if (moduleDots < 1) {
    const need = dotsToMm((n + 2 * q) * 2, dpi);
    return { ok: false, issues: [{ level: "error", message: `El QR no cabe: con ${n}×${n} cuadritos necesita al menos ${need.toFixed(1)} mm. Agrándalo, baja la corrección de errores o pon menos texto.` }] };
  }
  const moduleMm = dotsToMm(moduleDots, dpi);
  if (moduleDots < 2 || moduleMm < 0.25) {
    issues.push({ level: "warn", message: `QR muy denso: cada cuadrito mide ${moduleMm.toFixed(2)} mm (${moduleDots} punto). Puede no leerse; agrándalo o pon menos texto.` });
  }
  return { ok: true, n, moduleDots, moduleMm, sideMm: moduleMm * (n + 2 * q), quiet: q, matrix, issues };
}

/** Los cuadritos oscuros como un solo trazo SVG en unidades de módulo (se escala con transform). */
export function qrPath(m: QrMatrix, quiet: number): string {
  let d = "";
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark(x, y)) { x++; continue; }
      const start = x;
      while (x < m.size && m.dark(x, y)) x++;
      d += `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`;
    }
  }
  return d;
}

// ------------------------------------------------------------------ códigos de barras
export const BARCODE_FORMATS: Array<{ key: BarcodeFormat; label: string; hint: string; commercial?: boolean }> = [
  { key: "CODE128", label: "CODE128 (automático)", hint: "Letras, números, espacios y signos. El más usado para referencias." },
  { key: "CODE128A", label: "CODE128 A", hint: "Mayúsculas, números y signos de control." },
  { key: "CODE128B", label: "CODE128 B", hint: "Mayúsculas, minúsculas, números y signos." },
  { key: "CODE128C", label: "CODE128 C", hint: "Solo números en cantidad par (más compacto)." },
  { key: "CODE39", label: "CODE39", hint: "Mayúsculas, números, espacio y - . $ / + %. Más ancho que CODE128." },
  { key: "EAN13", label: "EAN-13", hint: "12 o 13 números. Solo si el código está registrado en GS1.", commercial: true },
  { key: "EAN8", label: "EAN-8", hint: "7 u 8 números. Solo si está registrado en GS1.", commercial: true },
  { key: "UPC", label: "UPC-A", hint: "11 o 12 números. Solo si está registrado en GS1.", commercial: true },
  { key: "UPCE", label: "UPC-E", hint: "6 u 8 números. Solo si está registrado en GS1.", commercial: true },
  { key: "ITF14", label: "ITF-14", hint: "13 o 14 números (cajas). Solo si está registrado en GS1.", commercial: true },
  { key: "ITF", label: "ITF (2 de 5 intercalado)", hint: "Números en cantidad par." },
  { key: "codabar", label: "Codabar", hint: "Números y - $ : / . + (bibliotecas, laboratorios)." },
  { key: "MSI", label: "MSI", hint: "Solo números (estanterías)." },
  { key: "pharmacode", label: "Pharmacode", hint: "Un número de 3 a 131070 (farmacéutico)." },
];

const FORMAT_RULE: Partial<Record<BarcodeFormat, string>> = {
  CODE128: "CODE128 admite letras sin tilde, números, espacios y signos básicos (sin Ñ ni tildes).",
  CODE128A: "CODE128 A admite mayúsculas sin tilde, números y signos.",
  CODE128B: "CODE128 B admite letras sin tilde, números y signos.",
  CODE128C: "CODE128 C solo admite números en cantidad par.",
  CODE39: "CODE39 solo admite mayúsculas, números, espacio y - . $ / + %.",
  EAN13: "EAN-13 son 12 números (el dígito de control se calcula) o 13 con el dígito correcto.",
  EAN8: "EAN-8 son 7 números (el dígito se calcula) u 8 con el dígito correcto.",
  UPC: "UPC-A son 11 números (el dígito se calcula) o 12 con el dígito correcto.",
  UPCE: "UPC-E son 6 u 8 números válidos.",
  ITF14: "ITF-14 son 13 números (el dígito se calcula) o 14 con el dígito correcto.",
  ITF: "ITF solo admite números en cantidad par.",
  codabar: "Codabar solo admite números y - $ : / . +",
  MSI: "MSI solo admite números.",
  pharmacode: "Pharmacode es un número de 3 a 131070.",
};

const CHARSET: Partial<Record<BarcodeFormat, RegExp>> = {
  CODE128: /^[\x20-\x7E]+$/,
  CODE128B: /^[\x20-\x7E]+$/,
  CODE128A: /^[\x20-\x5F]+$/,
  CODE128C: /^(\d\d)+$/,
  CODE39: /^[0-9A-Z \-.$/+%]+$/,
  EAN13: /^\d{12,13}$/, EAN8: /^\d{7,8}$/, UPC: /^\d{11,12}$/, UPCE: /^\d{6}$|^\d{8}$/, ITF14: /^\d{13,14}$/,
  ITF: /^(\d\d)+$/, MSI: /^\d+$/, pharmacode: /^\d{1,6}$/,
  codabar: /^[A-D]?[0-9\-$:/.+]+[A-D]?$/,
};

export type Encoded ={ ok: true; bits: string; text: string } | { ok: false; error: string };

/** Las barras (1 = barra, 0 = espacio) de un contenido; el contenido nunca se cambia. */
export function encodeBarcode(content: string, format: BarcodeFormat): Encoded {
  if (!content) return { ok: false, error: "El código de barras está vacío." };
  // Revisión propia: la librería pasa CODE39 a mayúsculas y toma «É» como control en CODE128 (cambiaría el
  // contenido sin avisar). Aquí solo pasa lo que se puede codificar tal cual.
  const allowed = CHARSET[format];
  if (allowed && !allowed.test(content)) return { ok: false, error: FORMAT_RULE[format] ?? "Ese contenido no se puede poner en este formato." };
  let valid = true;
  const target: { encodings?: Array<{ data: string; text?: string }> } = {};
  try {
    JsBarcode(target as unknown as SVGElement, content, { format, valid: (v: boolean) => { valid = v; }, displayValue: false } as never);
  } catch {
    valid = false;
  }
  const enc = target.encodings ?? [];
  if (!valid || !enc.length) return { ok: false, error: FORMAT_RULE[format] ?? "Ese contenido no se puede poner en este formato." };
  const bits = enc.map((e) => e.data).join("");
  if (!/^[01]+$/.test(bits)) return { ok: false, error: "No se pudo generar el código." };
  // Texto legible: en EAN/UPC/ITF-14 con el dígito de control (calculado si no venía).
  const full: Partial<Record<BarcodeFormat, number>> = { EAN13: 13, EAN8: 8, UPC: 12, ITF14: 14 };
  const len = full[format];
  const text = len && content.length === len - 1 ? content + gs1CheckDigit(content) : content;
  return { ok: true, bits, text };
}

/** Dígito de control GS1 (EAN, UPC, ITF-14): pesos 3 y 1 desde la derecha. */
export function gs1CheckDigit(digits: string): string {
  let sum = 0;
  [...digits].reverse().forEach((d, i) => { sum += Number(d) * (i % 2 === 0 ? 3 : 1); });
  return String((10 - (sum % 10)) % 10);
}

export type BarcodeLayout =
  | { ok: true; bits: string; text: string; moduleDots: number; moduleMm: number; widthMm: number; quiet: number; issues: CodeIssue[] }
  | { ok: false; issues: CodeIssue[] };

/** Cuánto mide el código a lo ancho con módulos de puntos enteros; si no cabe, por qué y qué hacer. */
export function layoutBarcode(content: string, format: BarcodeFormat, quiet: number, boxW: number, dpi: number): BarcodeLayout {
  const enc = encodeBarcode(content, format);
  if (!enc.ok) return { ok: false, issues: [{ level: "error", message: enc.error }] };
  const q = Math.max(0, Math.min(20, Math.round(quiet)));
  const L = enc.bits.length;
  const avail = Math.floor(mmToDots(boxW, dpi) + 1e-6);
  const moduleDots = Math.floor(avail / (L + 2 * q));
  if (moduleDots < 1) {
    const need = dotsToMm(L + 2 * q, dpi);
    return {
      ok: false,
      issues: [{
        level: "error",
        message: `«${content}» no cabe en ${boxW.toFixed(1)} mm: este código necesita al menos ${need.toFixed(1)} mm a ${dpi} dpi. `
          + "Usa un QR (cabe en menos espacio), una etiqueta más ancha, menos margen blanco o un formato más compacto.",
      }],
    };
  }
  const moduleMm = dotsToMm(moduleDots, dpi);
  const issues: CodeIssue[] = [];
  if (moduleMm < 0.19) {
    issues.push({ level: "warn", message: `Barras muy delgadas (${moduleMm.toFixed(3)} mm). Algunos lectores no las leen: prueba con tu lector, ensancha el código o usa un QR.` });
  }
  if (q < 10) issues.push({ level: "warn", message: `Margen blanco de ${q} módulos (el estándar pide 10). Si el lector falla, súbelo.` });
  return { ok: true, bits: enc.bits, text: enc.text, moduleDots, moduleMm, widthMm: moduleMm * (L + 2 * q), quiet: q, issues };
}

/** Las barras como rectángulos SVG en unidades de módulo (alto 1; se escala con transform). */
export function barsPath(bits: string, quiet: number): string {
  let d = "";
  let i = 0;
  while (i < bits.length) {
    if (bits[i] !== "1") { i++; continue; }
    const s = i;
    while (i < bits.length && bits[i] === "1") i++;
    d += `M${s + quiet} 0h${i - s}v1h-${i - s}z`;
  }
  return d;
}
