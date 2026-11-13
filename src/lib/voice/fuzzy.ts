/**
 * REM: encontrar el producto aunque el reconocimiento de voz lo escriba mal.
 *   «cinco cámaras de la bts 30» → «CÁMARA DE SEGURIDAD TRIPLE SOLAR VTS30 W F».
 * Se busca con variantes que suenan igual (b/v, s/z/c, y/i…), en singular y por partes, y luego se ordena
 * lo encontrado por parecido. Sin IA: todo en el navegador, con el mismo buscador de productos.
 */

import { normalize, parseNumberAt } from "./spanish";

const STOP = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "a", "en", "con", "sin", "por", "para", "que",
  "mi", "me", "lo", "le", "se", "al", "referencia", "ref", "codigo", "cod", "numero", "modelo", "producto", "productos", "tipo",
]);

/** Letras dichas dentro de una referencia («be te ese treinta» → bts30). */
const LETTER_NAMES: Record<string, string> = {
  be: "b", ce: "c", efe: "f", ge: "g", hache: "h", jota: "j", ka: "k", ele: "l", eme: "m", ene: "n", pe: "p", cu: "q",
  erre: "r", ere: "r", ese: "s", te: "t", ve: "v", uve: "v", equis: "x", ye: "y", zeta: "z",
};

/** Cómo suena (en español): b=v, s=z=c(e,i), k=c=qu, y=ll, j=g(e,i), sin h ni letras repetidas. */
export function phonetic(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]/g, "")
    .replace(/ch/g, "x")
    .replace(/ll/g, "y")
    .replace(/qu/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/g(?=[ei])/g, "j")
    .replace(/h/g, "")
    .replace(/y$/, "i")
    .replace(/(.)\1+/g, "$1");
}

/** Singular sencillo: «cámaras» → «camaras» → «camara», «secadores» → «secador». */
export function singular(word: string): string {
  if (/\d/.test(word) || word.length <= 3) return word;
  if (word.length > 4 && /[rlndjz]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ces") && word.length > 4) return `${word.slice(0, -3)}z`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export type SpokenParts = { words: string[]; codes: string[] };

/**
 * Lo dicho en partes: palabras del nombre (en singular) y referencias (letras y números pegados).
 * «camaras de la bts 30» → { words: ["camara"], codes: ["bts30"] }.
 */
export function spokenParts(query: string): SpokenParts {
  const raw = normalize(query).replace(/[-./]/g, " ").split(" ").filter(Boolean);
  const toks: string[] = [];
  for (let i = 0; i < raw.length;) {
    const w = raw[i];
    if (w !== "un" && w !== "una" && !/\d/.test(w)) {
      const n = parseNumberAt(raw, i);
      if (n) { toks.push(String(n.value)); i += n.used; continue; }
    }
    toks.push(w);
    i++;
  }
  const codeish = (w: string) => /\d/.test(w) || w in LETTER_NAMES || (w.length <= 3 && !STOP.has(w));
  const words: string[] = [];
  const codes: string[] = [];
  for (let i = 0; i < toks.length;) {
    if (!codeish(toks[i])) {
      if (!STOP.has(toks[i])) words.push(singular(toks[i]));
      i++;
      continue;
    }
    let j = i;
    while (j < toks.length && codeish(toks[j])) j++;
    const run = toks.slice(i, j);
    if (run.some((w) => /\d/.test(w))) codes.push(run.map((w) => LETTER_NAMES[w] ?? w).join(""));
    else run.filter((w) => !STOP.has(w)).forEach((w) => words.push(w));
    i = j;
  }
  return { words, codes };
}

// Letras que el reconocimiento confunde entre sí.
const CONFUSED = [["b", "v"], ["s", "z", "c"], ["y", "i"], ["k", "c", "q"], ["g", "j"], ["m", "n"]];

/** La referencia y sus variantes por letras confundidas («bts30» → «vts30», «btz30»…). Máximo `max`. */
export function codeVariants(code: string, max = 6): string[] {
  const out = [code];
  for (let i = 0; i < code.length && out.length < max; i++) {
    const group = CONFUSED.find((g) => g.includes(code[i]));
    if (!group) continue;
    for (const alt of group) {
      if (alt === code[i] || out.length >= max) continue;
      out.push(code.slice(0, i) + alt + code.slice(i + 1));
    }
  }
  return out;
}

/** Qué buscar cuando lo dicho tal cual no dio nada (máximo 10 búsquedas). */
export function fuzzyQueries(query: string): string[] {
  const { words, codes } = spokenParts(query);
  const out: string[] = [];
  for (const c of codes) out.push(...codeVariants(c, 5).map((v) => v.toUpperCase()));
  if (words.length > 1) out.push(words.join(" "));
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  out.push(...[...words].filter((w) => w.length >= 4).sort((a, b) => b.length - a.length).slice(0, 3));
  if (words.length === 1 && words[0].length < 4) out.push(words[0]);
  return [...new Set(out.map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 10);
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Parecido de 0 a 1 entre dos palabras ya pasadas por `phonetic`. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 4 && b.startsWith(a)) return 0.9;
  return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length));
}

type Named = { name: string; sku: string | null; barcode?: string | null };

/** Qué tanto se parece un producto a lo dicho (0 a 1). Las referencias pesan el doble que cada palabra. */
export function fuzzyScore(parts: SpokenParts, hit: Named): number {
  const nameToks = normalize(`${hit.name} ${hit.sku ?? ""}`).replace(/[-./]/g, " ").split(" ").filter(Boolean);
  const toks = [...new Set(nameToks.map((w) => phonetic(singular(w))).filter(Boolean))];
  const compact = (s: string | null | undefined) => phonetic(s ?? "");
  // Referencias del producto: el código, el de barras, palabras con números y el nombre desde ahí («vts30 w f» → «bts30uf»).
  const codes = [compact(hit.sku), compact(hit.barcode)].filter((c) => c.length >= 2);
  nameToks.forEach((w, i) => { if (/\d/.test(w)) codes.push(phonetic(nameToks.slice(i).join(""))); });
  const total = parts.words.length + parts.codes.length * 2;
  if (!total) return 0;
  let got = 0;
  for (const w of parts.words) {
    const p = phonetic(w);
    const best = Math.max(0, ...toks.map((t) => similarity(p, t)));
    if (best >= 0.7) got += best;
  }
  for (const c of parts.codes) {
    const p = phonetic(c);
    let best = 0;
    for (const pc of codes) {
      if (pc.includes(p)) { best = 1; break; }
      best = Math.max(best, similarity(p, pc.slice(0, p.length)));
    }
    if (best >= 0.6) got += best * 2;
  }
  return got / total;
}

/** Los productos encontrados ordenados por parecido con lo dicho (solo los que se parecen algo). */
export function rankFuzzy<T extends Named>(query: string, hits: T[], min = 0.4): Array<{ hit: T; score: number }> {
  const parts = spokenParts(query);
  return hits
    .map((hit) => ({ hit, score: fuzzyScore(parts, hit) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name));
}

/** Busca con las variantes y devuelve los más parecidos (máximo 5). */
export async function guessSpoken<T extends Named & { id: string }>(search: (q: string) => Promise<T[]>, query: string): Promise<Array<{ hit: T; score: number }>> {
  const qs = fuzzyQueries(query);
  if (!qs.length) return [];
  const results = await Promise.all(qs.map((q) => search(q).catch(() => [] as T[])));
  const all = new Map<string, T>();
  results.flat().forEach((h) => { if (!all.has(h.id)) all.set(h.id, h); });
  return rankFuzzy(query, [...all.values()]).slice(0, 5);
}

/** ¿Pregunta «¿estás intentando decir…?» por el primero, o lee opciones? */
export function guessMode(guesses: Array<{ score: number }>): "ask" | "choose" | "none" {
  const [a, b] = guesses;
  if (!a) return "none";
  if (a.score >= 0.6 && (!b || a.score - b.score >= 0.12)) return "ask";
  return "choose";
}
