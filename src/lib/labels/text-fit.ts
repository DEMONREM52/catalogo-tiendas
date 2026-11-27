/**
 * Ajuste de texto en una caja de w × h mm: saltos manuales (Enter), saltos automáticos por palabras,
 * máximo de líneas, letra que se achica sola y líneas parejas. Nunca parte una palabra (una referencia)
 * salvo que se pida; si no cabe ni con la letra mínima, lo dice (overflow) en vez de cortarla.
 *
 * La medida del ancho la pone quien llama: en el navegador, la del lienzo (canvas) con la misma letra
 * que se imprime; en las pruebas, una tabla aproximada (approxMeasure).
 */
import { MM_PER_PT, type FontKey, type TextElement } from "./types";

export type FontSpec = { font: FontKey; size: number; bold: boolean; italic: boolean };
/** Ancho en mm de un texto en una línea. */
export type Measure = (text: string, f: FontSpec, letterSpacingMm: number) => number;

export const FONT_FAMILY: Record<FontKey, string> = {
  sans: "Arial, Helvetica, 'Liberation Sans', sans-serif",
  condensed: "'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', Arial, sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "Consolas, 'Courier New', 'Liberation Mono', monospace",
};
export const FONT_LABEL: Record<FontKey, string> = { sans: "Arial (normal)", condensed: "Angosta", serif: "Con serifa", mono: "Monoespaciada" };

// Anchos de Arial en «em» (aproximados): para pruebas y como respaldo sin navegador.
const W: Record<string, number> = {
  A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5, K: 0.667, L: 0.556, M: 0.833,
  N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
  " ": 0.278, ".": 0.278, ",": 0.278, ":": 0.278, ";": 0.278, "-": 0.333, "/": 0.278, "$": 0.556, "%": 0.889, "(": 0.333, ")": 0.333, "#": 0.556,
};
export const approxMeasure: Measure = (text, f, ls) => {
  let em = 0;
  for (const ch of text) {
    if (f.font === "mono") { em += 0.6; continue; }
    em += W[ch] ?? (/[0-9]/.test(ch) ? 0.556 : /[a-záéíóúñ]/.test(ch) ? 0.52 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.7 : 0.6);
  }
  const factor = (f.bold ? 1.06 : 1) * (f.font === "condensed" ? 0.82 : f.font === "serif" ? 0.95 : 1);
  return em * factor * f.size * MM_PER_PT + Math.max(0, [...text].length - 1) * ls;
};

export type TextBox = Pick<TextElement, "w" | "h" | "font" | "size" | "minSize" | "bold" | "italic" | "maxLines" | "lineHeight" | "letterSpacing" | "autoFit" | "breakWords" | "balance" | "transform" | "padding">;

export type TextFit = {
  lines: string[];
  /** Tamaño final en puntos. */
  size: number;
  /** Alto de cada línea en mm. */
  lineH: number;
  /** No cupo ni con la letra mínima (se dibuja igual y se avisa). */
  overflow: boolean;
  /** Se partió alguna palabra (solo con breakWords). */
  brokeWords: boolean;
};

export function applyTransform(text: string, t: TextBox["transform"]) {
  return t === "upper" ? text.toLocaleUpperCase("es-CO") : t === "lower" ? text.toLocaleLowerCase("es-CO") : text;
}

/** Parte en líneas con un ancho máximo. Devuelve null si una palabra no cabe y no se pueden partir palabras. */
function wrap(paragraphs: string[][], maxW: number, width: (s: string) => number, breakWords: boolean, allowOverflow = false): { lines: string[]; broke: boolean } | null {
  const lines: string[] = [];
  let broke = false;
  for (const words of paragraphs) {
    if (!words.length) { lines.push(""); continue; }
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (width(next) <= maxW + 1e-6) { cur = next; continue; }
      if (cur) { lines.push(cur); cur = ""; }
      if (width(word) <= maxW + 1e-6) { cur = word; continue; }
      if (!breakWords) {
        if (!allowOverflow) return null;
        lines.push(word);
        continue;
      }
      // Partir la palabra en trozos que quepan.
      broke = true;
      let piece = "";
      for (const ch of word) {
        if (piece && width(piece + ch) > maxW + 1e-6) { lines.push(piece); piece = ch; } else piece += ch;
      }
      cur = piece;
    }
    lines.push(cur);
  }
  return { lines, broke };
}

/** Acomoda el texto en la caja. */
export function fitText(rawText: string, box: TextBox, measure: Measure): TextFit {
  const text = applyTransform(String(rawText ?? ""), box.transform).replace(/\r\n?/g, "\n");
  const paragraphs = text.split("\n").map((p) => p.split(/[ \t]+/).filter(Boolean));
  while (paragraphs.length && !paragraphs[paragraphs.length - 1].length) paragraphs.pop();
  const lh = Math.max(0.7, Math.min(3, box.lineHeight || 1.1));
  const maxLines = Math.max(1, Math.min(20, Math.round(box.maxLines || 1)));
  const innerW = Math.max(0.5, box.w - 2 * (box.padding || 0));
  const innerH = Math.max(0.5, box.h - 2 * (box.padding || 0));
  const top = Math.max(1, Math.min(200, box.size || 8));
  const bottom = box.autoFit ? Math.max(1, Math.min(top, box.minSize || top)) : top;
  if (!paragraphs.length) return { lines: [], size: top, lineH: top * MM_PER_PT * lh, overflow: false, brokeWords: false };

  // Con saltos de línea a mano (Enter), primero se respeta cada renglón tal cual y se achica la letra.
  if (paragraphs.length > 1) {
    const asTyped = paragraphs.map((p) => p.join(" "));
    for (let s = top; s >= bottom - 1e-9; s = Math.round((s - 0.25) * 100) / 100) {
      const lineH = s * MM_PER_PT * lh;
      if (asTyped.length > Math.min(maxLines, Math.floor((innerH + 1e-6) / lineH))) continue;
      const spec = { font: box.font, size: s, bold: box.bold, italic: box.italic };
      if (asTyped.every((l) => measure(l, spec, box.letterSpacing || 0) <= innerW + 1e-6)) return { lines: asTyped, size: s, lineH, overflow: false, brokeWords: false };
    }
  }

  for (let s = top; s >= bottom - 1e-9; s = Math.round((s - 0.25) * 100) / 100) {
    const spec = { font: box.font, size: s, bold: box.bold, italic: box.italic };
    const cache = new Map<string, number>();
    const width = (str: string) => {
      let v = cache.get(str);
      if (v === undefined) { v = measure(str, spec, box.letterSpacing || 0); cache.set(str, v); }
      return v;
    };
    const lineH = s * MM_PER_PT * lh;
    const limit = Math.min(maxLines, Math.floor((innerH + 1e-6) / lineH));
    if (limit < 1) continue;
    const res = wrap(paragraphs, innerW, width, box.breakWords);
    if (!res || res.lines.length > limit) continue;
    let lines = res.lines;
    if (box.balance && lines.length > 1 && !res.broke) lines = balanceLines(paragraphs, lines.length, innerW, width) ?? lines;
    return { lines, size: s, lineH, overflow: false, brokeWords: res.broke };
  }
  // No cupo: con la letra más pequeña permitida, sin cortar palabras, y se avisa.
  const spec = { font: box.font, size: bottom, bold: box.bold, italic: box.italic };
  const width = (str: string) => measure(str, spec, box.letterSpacing || 0);
  const res = wrap(paragraphs, innerW, width, box.breakWords, true)!;
  return { lines: res.lines.slice(0, Math.max(maxLines, 1)), size: bottom, lineH: bottom * MM_PER_PT * lh, overflow: true, brokeWords: res.broke };
}

/** El ancho más angosto que deja el mismo número de líneas: líneas parejas. */
function balanceLines(paragraphs: string[][], n: number, maxW: number, width: (s: string) => number): string[] | null {
  let lo = 0;
  for (const p of paragraphs) for (const w of p) lo = Math.max(lo, width(w));
  let hi = maxW;
  if (lo > hi) return null;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const r = wrap(paragraphs, mid, width, false);
    if (r && r.lines.length <= n) hi = mid; else lo = mid;
  }
  const r = wrap(paragraphs, hi, width, false);
  return r && r.lines.length <= n ? r.lines : null;
}
