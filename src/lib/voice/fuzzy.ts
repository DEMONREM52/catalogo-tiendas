/**
 * REM: encontrar el producto aunque el reconocimiento de voz lo escriba mal.
 *   «cinco cámaras referencias vtf 30» → «CÁMARA DE SEGURIDAD TRIPLE SOLAR VTS30 W F».
 *
 * Cómo: busca lo dicho tal cual, como referencia y con variantes que suenan igual (b/v/p, s/z/c/f, t/d…),
 * en singular y por partes («cámara 30»). Luego ordena TODO lo encontrado por parecido con lo dicho
 * (nunca se queda con lo primero que devuelva el buscador) y decide: seguro, preguntar o leer opciones.
 * Lo que se le confirma o corrige lo aprende (en este equipo) y la próxima vez acierta solo.
 * Sin IA: todo en el navegador, con el mismo buscador de productos.
 */

import { compactCode, normalize, parseNumberAt, spokenReference } from "./spanish";

const STOP = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "a", "en", "con", "sin", "por", "para", "que",
  "mi", "me", "lo", "le", "se", "al", "referencia", "ref", "codigo", "cod", "numero", "modelo", "producto", "tipo", "unidad", "unidade",
  "pieza", "par", "caja", "favor", "porfa", "necesito", "quiero", "dame", "agrega", "pon", "mas", "otra", "otro", "esa", "ese",
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

/** Singular sencillo: «cámaras» → «camara», «secadores» → «secador», «luces» → «luz». */
export function singular(word: string): string {
  if (/\d/.test(word) || word.length <= 3) return word;
  if (word.length > 4 && /[rlndj]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ces") && word.length > 4) return `${word.slice(0, -3)}z`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export type SpokenParts = { words: string[]; codes: string[] };

/**
 * Lo dicho en partes: palabras del nombre (en singular) y referencias (letras y números pegados).
 * «camaras referencias vtf 30» → { words: ["camara"], codes: ["vtf30"] }.
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
      const w = singular(toks[i]);
      if (!STOP.has(toks[i]) && !STOP.has(w)) words.push(w);
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

// Letras que el reconocimiento confunde entre sí («vts» → «bts», «vtf», «btz»…).
const CONFUSED = [["b", "v", "p"], ["s", "z", "c", "f"], ["t", "d"], ["y", "i", "e"], ["k", "c", "q", "g"], ["g", "j"], ["m", "n"], ["o", "u"]];

/** La referencia y sus variantes por letras confundidas («bts30» → «vts30», «pts30»…). Máximo `max`. */
export function codeVariants(code: string, max = 6): string[] {
  const out = [code];
  for (let i = 0; i < code.length && out.length < max; i++) {
    const alts = [...new Set(CONFUSED.filter((g) => g.includes(code[i])).flat())];
    for (const alt of alts) {
      if (alt === code[i] || out.length >= max) continue;
      out.push(code.slice(0, i) + alt + code.slice(i + 1));
    }
  }
  return out;
}

/** Qué más buscar además de lo dicho tal cual (máximo 12 búsquedas). */
export function fuzzyQueries(query: string): string[] {
  const { words, codes } = spokenParts(query);
  const out: string[] = [];
  for (const c of codes) {
    out.push(...codeVariants(c, 5).map((v) => v.toUpperCase()));
    // El número de la referencia con el nombre: «cámara 30» encuentra «CÁMARA … VTS30» aunque las letras salieran mal.
    const digits = c.replace(/\D/g, "");
    if (digits.length >= 2) words.slice(0, 2).forEach((w) => out.push(`${w} ${digits}`));
  }
  if (words.length > 1) out.push(words.join(" "));
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  out.push(...[...words].filter((w) => w.length >= 4).sort((a, b) => b.length - a.length).slice(0, 3));
  if (words.length === 1 && words[0].length < 4) out.push(words[0]);
  return [...new Set(out.map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 12);
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

/** Referencias del producto como suenan: [0] código, [1] código de barras, luego desde cada palabra con números del nombre. */
function productCodes(hit: Named): string[] {
  const nameToks = normalize(`${hit.name} ${hit.sku ?? ""}`).replace(/[-./]/g, " ").split(" ").filter(Boolean);
  const fromName = nameToks.map((w, i) => (/\d/.test(w) ? phonetic(nameToks.slice(i).join("")) : "")).filter(Boolean);
  return [phonetic(hit.sku ?? ""), phonetic(hit.barcode ?? ""), ...fromName];
}

/**
 * Parecido de una referencia dicha con las del producto (0 a 1). 1 = está tal cual (sonando igual).
 * Si el número coincide completo, las letras pueden venir mal («vtf30» ≈ «VTS30»).
 */
function codeScore(spoken: string, codes: string[]): number {
  const p = phonetic(spoken);
  const digits = spoken.replace(/\D/g, "");
  const letters = phonetic(spoken.replace(/\d/g, ""));
  let best = 0;
  codes.forEach((code, i) => {
    if (!code || best === 1) return;
    // El código de barras solo cuenta con un buen pedazo (6+ cifras), no por «30» en medio.
    if (i === 1 && p.length < 6) return;
    if (code.includes(p)) { best = 1; return; }
    best = Math.max(best, similarity(p, code.slice(0, p.length)));
    // El código de barras solo cuenta completo; el número suelto sí sirve en el código y el nombre.
    if (i !== 1 && digits.length >= 2 && new RegExp(`(^|\\D)${digits}(\\D|$)`).test(code)) {
      const theirs = code.split(digits)[0].slice(-Math.max(letters.length, 1));
      best = Math.max(best, letters ? 0.55 + 0.45 * similarity(letters, theirs) : 0.7);
    }
  });
  return best;
}

/** Qué tanto se parece un producto a lo dicho (0 a 1). Las referencias pesan el doble que cada palabra. */
export function fuzzyScore(parts: SpokenParts, hit: Named): number {
  const nameToks = normalize(`${hit.name} ${hit.sku ?? ""}`).replace(/[-./]/g, " ").split(" ").filter(Boolean);
  const toks = [...new Set(nameToks.map((w) => phonetic(singular(w))).filter(Boolean))];
  const codes = productCodes(hit);
  const total = parts.words.length + parts.codes.length * 2;
  if (!total) return 0;
  let got = 0;
  for (const w of parts.words) {
    const p = phonetic(w);
    const best = Math.max(0, ...toks.map((t) => similarity(p, t)));
    if (best >= 0.7) got += best;
  }
  for (const c of parts.codes) {
    const best = codeScore(c, codes);
    if (best >= 0.6) got += best * 2;
  }
  return got / total;
}

/** ¿Todas las referencias dichas están tal cual (sonando igual) en el producto? */
export function codeMatches(query: string, hit: Named): boolean {
  const { codes } = spokenParts(query);
  if (!codes.length) return false;
  const mine = productCodes(hit);
  return codes.every((c) => { const p = phonetic(c); return mine.some((m, i) => m && (i !== 1 || p.length >= 6) && m.includes(p)); });
}

export type Ranked<T> = { hit: T; score: number };

/** Los productos ordenados por parecido con lo dicho (solo los que se parecen algo). */
export function rankFuzzy<T extends Named>(query: string, hits: T[], min = 0.34): Ranked<T>[] {
  return rankAll([query], hits, min);
}

/** Ordena por el mejor parecido con cualquiera de las lecturas (la primera pesa un poco más). */
function rankAll<T extends Named>(said: string[], hits: T[], min = 0.34): Ranked<T>[] {
  const parts = said.map((q) => spokenParts(q));
  return hits
    .map((hit) => ({ hit, score: Math.max(...parts.map((p, i) => fuzzyScore(p, hit) * (i === 0 ? 1 : 0.95))) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name));
}

// ---------------------------------------------------------------------------------------------
// Lo que REM aprendió: cuando se le confirma («sí, esa») o se le corrige, la próxima vez acierta solo.

const LEARN_KEY = "remhub:rem-learned";
type Learned = { id: string; name: string; sku: string | null };

/** Llave de una frase: palabras y referencias como suenan («cámaras de la bts 30» = «camara bts treinta»). */
export function learnKey(query: string): string {
  const { words, codes } = spokenParts(query);
  return [...words.map((w) => phonetic(w)), ...codes.map((c) => phonetic(c))].join("|");
}

function readLearned(): Record<string, Learned & { at: number }> {
  try { return JSON.parse(localStorage.getItem(LEARN_KEY) ?? "{}") as Record<string, Learned & { at: number }>; } catch { return {}; }
}

export function learnedFor(query: string): Learned | null {
  const k = learnKey(query);
  return k ? readLearned()[k] ?? null : null;
}

/** Guarda que «esta frase» es «este producto» (en este equipo; máximo 500 frases). */
export function learn(query: string, hit: Learned) {
  const k = learnKey(query);
  if (!k) return;
  try {
    const all = readLearned();
    all[k] = { id: hit.id, name: hit.name, sku: hit.sku, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 500) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 500).forEach((x) => delete all[x]);
    localStorage.setItem(LEARN_KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento */ }
}

/** Olvida lo aprendido para esa frase (se dijo «no» a lo que REM puso por lo aprendido). */
export function forget(query: string) {
  const k = learnKey(query);
  try {
    const all = readLearned();
    if (all[k]) { delete all[k]; localStorage.setItem(LEARN_KEY, JSON.stringify(all)); }
  } catch { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------------------------------------
// Resolver: de lo dicho al producto

export type Resolution<T> =
  /** Seguro: se agrega sin preguntar. */
  | { kind: "sure"; hit: T; ranked: Ranked<T>[] }
  /** Uno se parece claramente más: «¿Estás intentando decir…?» (si dice no, el siguiente). */
  | { kind: "ask"; ranked: Ranked<T>[] }
  /** Varios igual de parecidos: se leen opciones. */
  | { kind: "choose"; ranked: Ranked<T>[] }
  | { kind: "none" };

/**
 * Decide con lo ya ordenado. Seguro solo si se parece casi del todo, le saca ventaja al segundo y, si se dijo
 * una referencia, la referencia está tal cual. Si no, pregunta o lee opciones.
 */
export function decide<T>(ranked: Ranked<T>[], exactCode: boolean, hadCode: boolean, learned = false): Resolution<T> {
  const [a, b] = ranked;
  if (!a || a.score < 0.34) return { kind: "none" };
  if (learned) return { kind: "sure", hit: a.hit, ranked };
  const clear = !b || a.score - b.score >= 0.2;
  if (clear && a.score >= 0.9 && (!hadCode || exactCode)) return { kind: "sure", hit: a.hit, ranked };
  if (a.score >= 0.5 && (!b || a.score - b.score >= 0.08)) {
    return { kind: "ask", ranked: ranked.filter((r) => r.score >= Math.max(0.45, a.score - 0.35)).slice(0, 3) };
  }
  return { kind: "choose", ranked: ranked.slice(0, 3) };
}

/** De lo dicho (con sus otras lecturas) al producto. Ver el comentario del archivo. */
export async function resolveSpoken<T extends Named & { id: string }>(
  search: (q: string, limit?: number) => Promise<T[]>, queries: string[],
): Promise<Resolution<T>> {
  const said = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
  if (!said.length) return { kind: "none" };
  // Solo un número corto («tres», «30») no es un producto: no se inventan opciones.
  const first = spokenParts(said[0]);
  if (!first.words.length && first.codes.every((c) => /^\d{1,2}$/.test(c))) return { kind: "none" };
  const learned = said.map((q) => learnedFor(q)).find(Boolean) ?? null;
  const qs = new Map<string, number>();
  const add = (q: string, limit: number) => { const t = q.trim(); if (t.length >= 2 && !qs.has(t)) qs.set(t, limit); };
  if (learned) add(learned.sku || learned.name, 10);
  for (const q of said) {
    add(q, 8);
    const ref = spokenReference(q);
    add(ref, 8);
    add(ref.replace(/[-./]/g, ""), 8);
  }
  fuzzyQueries(said[0]).forEach((q) => add(q, 20));
  said.slice(1).forEach((q) => fuzzyQueries(q).slice(0, 4).forEach((x) => add(x, 12)));
  const results = await Promise.all([...qs.entries()].slice(0, 16).map(([q, limit]) => search(q, limit).catch(() => [] as T[])));
  const all = new Map<string, T>();
  results.flat().forEach((h) => { if (!all.has(h.id)) all.set(h.id, h); });
  const hits = [...all.values()];
  if (learned) {
    const hit = all.get(learned.id);
    if (hit) return decide([{ hit, score: 1 }, ...rankAll(said, hits).filter((r) => r.hit.id !== hit.id)], true, true, true);
  }
  // Código exacto (sin guiones ni espacios) de un solo producto: ese es.
  const code = compactCode(spokenReference(said[0]));
  if (code.length >= 3) {
    const exact = hits.filter((h) => compactCode(h.sku) === code || compactCode(h.barcode) === code);
    if (exact.length === 1) return { kind: "sure", hit: exact[0], ranked: [{ hit: exact[0], score: 1 }] };
  }
  const ranked = rankAll(said, hits);
  const hadCode = said.some((q) => spokenParts(q).codes.length > 0);
  return decide(ranked, ranked[0] ? said.some((q) => codeMatches(q, ranked[0].hit)) : false, hadCode);
}
