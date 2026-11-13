/**
 * Valores dichos dentro de una frase: «un gasto de 50 mil en arriendo», «cincuenta mil», «$20.000»,
 * «1 millón 200 mil», «1.5 millones». Devuelve el valor y dónde estaba, para sacar lo demás (el detalle).
 */

import { normalize, parseNumberAt } from "@/lib/voice/spanish";

export type Money = { value: number; start: number; end: number; words: string[] };

const DIGITS = /^\d[\d.,]*$/;
const MILLION = /^(?:millon|millones)$/;

/** Número en cifras con puntos de mil («50.000», «50,000», «1.5»). */
function digits(w: string): number {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(w)) return Number(w.replace(/[.,]/g, ""));
  return Number(w.replace(",", "."));
}

function readAt(words: string[], i: number): { value: number; used: number } | null {
  let value: number;
  let used: number;
  if (DIGITS.test(words[i])) { value = digits(words[i]); used = 1; }
  else {
    const n = parseNumberAt(words, i);
    if (!n) return null;
    value = n.value; used = n.used;
  }
  if (!Number.isFinite(value)) return null;
  const next = words[i + used];
  if (next === "mil") { value *= 1000; used++; }
  else if (next && MILLION.test(next)) {
    value *= 1_000_000; used++;
    // «1 millón 200 mil»
    const rest = words[i + used] ? readAt(words, i + used) : null;
    if (rest && rest.value < 1_000_000) { value += rest.value; used += rest.used; }
  }
  return { value: Math.round(value), used };
}

/** El primer valor en pesos de la frase (sin tildes ni mayúsculas). null si no hay. */
export function moneyIn(text: string): Money | null {
  const words = normalize(text.replace(/\$/g, " $ ")).replace(/\$/g, " ").split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    // «un gasto»: «un» suelto no es un valor.
    if ((words[i] === "un" || words[i] === "una") && !MILLION.test(words[i + 1] ?? "") && words[i + 1] !== "mil") continue;
    const r = readAt(words, i);
    if (r && r.value > 0) {
      let end = i + r.used;
      if (/^(?:pesos|peso|barras|lucas)$/.test(words[end] ?? "")) end++;
      return { value: r.value, start: i, end, words };
    }
  }
  return null;
}
