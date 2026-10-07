/**
 * Búsqueda inteligente (misma lógica que rh_score en Supabase).
 *
 * - Sin importar mayúsculas, tildes, ñ ni el orden de las palabras.
 * - Pedazos de palabras: "ro cas" encuentra "casa rosa".
 * - Raíces simples: "rose" ≈ "rosa", "roja" ≈ "rojo", "zapatos" ≈ "zapatera".
 * - Tolera un error de escritura en palabras de 4+ letras ("camizeta").
 * - Primero lo que tiene TODAS las palabras; si no hay, lo más parecido.
 */

export function normalizeSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchStem(token: string): string {
  if (token.length < 4 || /\d/.test(token)) return token;
  const stem = token.replace(/s$/, "").replace(/[aeiou]$/, "");
  return stem.length >= 3 ? stem : token;
}

export function searchTokens(query: string): string[] {
  const words = [...new Set(normalizeSearch(query).split(" ").filter(Boolean))];
  const useful = words.filter((w) => w.length > 1 || /^\d$/.test(w));
  return (useful.length ? useful : words).slice(0, 8);
}

/** Distancia de edición con tope (sale apenas supera `max`). */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

function tokenQuality(hay: string, words: string[], token: string): number {
  if (hay.startsWith(token) || hay.includes(` ${token}`)) return 1;
  if (hay.includes(token)) return 0.75;
  if (token.length >= 4 && hay.includes(searchStem(token))) return 0.6;
  // Palabra partida con espacios: "agua cate" ≈ "aguacate".
  if (token.length >= 4 && hay.replace(/ /g, "").includes(token)) return 0.55;
  if (token.length >= 4) {
    const max = token.length >= 7 ? 2 : 1;
    // También 2 y 3 palabras seguidas pegadas: "agua de cate" ≈ "aguacate".
    const joined = words.flatMap((_, i) => [words.slice(i, i + 2), words.slice(i, i + 3)].filter((g) => g.length > 1).map((g) => g.join("")));
    for (const word of [...words, ...joined]) {
      if (word.length >= 3 && (withinEdits(token, word, max) || withinEdits(token, word.slice(0, token.length), max))) return 0.45;
    }
  }
  return 0;
}

export type PreparedQuery = { tokens: string[]; phrase: string };

export function prepareQuery(query: string): PreparedQuery {
  return { tokens: searchTokens(query), phrase: normalizeSearch(query) };
}

/** Parte entera = palabras que coinciden; parte decimal = calidad (para ordenar). */
export function searchScore(text: unknown, query: string | PreparedQuery): number {
  const { tokens, phrase } = typeof query === "string" ? prepareQuery(query) : query;
  if (!tokens.length) return 0;
  const hay = normalizeSearch(text);
  if (!hay) return 0;
  const words = hay.split(" ");
  let matched = 0;
  let quality = 0;
  for (const token of tokens) {
    const q = tokenQuality(hay, words, token);
    if (q > 0) matched += 1;
    quality += q;
  }
  if (phrase.length > 2 && hay.includes(phrase)) quality += 1;
  return matched + Math.min(0.99, quality / (tokens.length + 2));
}

/** true si el texto contiene todas las palabras (con tolerancia). */
export function matchesSearch(text: unknown, query: string): boolean {
  const prepared = prepareQuery(query);
  if (!prepared.tokens.length) return true;
  return Math.floor(searchScore(text, prepared)) >= prepared.tokens.length;
}

/**
 * Filtra y ordena por parecido. Si ningún elemento tiene todas las palabras,
 * devuelve los que más se acercan. Con búsqueda vacía devuelve la lista igual.
 */
export function smartFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => unknown,
  options: { keepOrder?: boolean } = {},
): T[] {
  const prepared = prepareQuery(query);
  if (!prepared.tokens.length) return [...items];
  const scored = items.map((item, index) => ({ item, index, score: searchScore(getText(item), prepared) }));
  const need = scored.reduce((max, s) => Math.max(max, Math.floor(s.score)), 0);
  if (need === 0) return [];
  const kept = scored.filter((s) => Math.floor(s.score) >= need);
  if (!options.keepOrder) kept.sort((a, b) => b.score - a.score || a.index - b.index);
  return kept.map((s) => s.item);
}

/**
 * Filtros para PostgREST: una condición por palabra (todas deben cumplirse),
 * cada una acepta la palabra o su raíz en cualquiera de las columnas.
 * Uso: for (const f of ilikeTokenFilters(["name"], q)) query = query.or(f);
 */
export function ilikeTokenFilters(columns: string[], query: string): string[] {
  return searchTokens(query).map((token) => {
    const variants = [...new Set([token, searchStem(token)])];
    return columns.flatMap((column) => variants.map((v) => `${column}.ilike.*${v}*`)).join(",");
  });
}
