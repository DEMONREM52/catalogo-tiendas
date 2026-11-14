/**
 * «¿Quisiste decir…?»: cuando REM no entiende, propone lo más parecido (máximo 3) entre lo que la persona puede usar,
 * en vez de solo decir «no te entendí». Nunca lo hace solo: pregunta, y con «sí», «la dos» o el nombre lo hace.
 *
 *   1. Corrige palabras mal oídas o mal dichas contra el vocabulario de RemHub, por cómo suenan
 *      («rentavilidad» → rentabilidad, «bendimos» → vendimos, «nomina» → nómina) y vuelve a intentar entender.
 *   2. Páginas parecidas de la lista de la persona (ya filtrada por permisos y plan).
 *   3. Consultas y formularios por voz del catálogo que se parecen a lo dicho.
 *
 * Si se elige una sugerencia, la frase original queda como atajo de esa persona (memory.ts → «aliases»):
 * la próxima vez entiende directo. Un atajo solo cambia lo que REM entiende; nunca da permisos.
 */

import { parseQuery, scoreItem } from "@/lib/fuzzy-search";
import { normalize } from "@/lib/voice/spanish";
import { phonetic, similarity, singular } from "@/lib/voice/fuzzy";
import { navTarget, type NavLink } from "@/lib/voice/navigate";
import { CAPABILITIES, VOICE_SCREENS } from "./catalog";
import { MODULES } from "./modules";
import { CONFIDENT, understand, type RemContext } from "./understand";
import { readJson, writeJson } from "./memory";

export type Suggestion = {
  /** Cómo se muestra y se dice («abrir Rentabilidad», «¿cuánto vendimos hoy?»). */
  say: string;
  /** Lo que REM procesa si se elige (como si se hubiera dicho). */
  phrase: string;
};

// Palabras que no se corrigen (de relleno o muy comunes): corregirlas daría sugerencias raras.
const KEEP = new Set(("el la los las un una unos unas de del al a en y o que como cuanto cuanta cuantos cuantas para por con sin mi mis tu tus su sus " +
  "me te se le les lo nos es son hay esta este esto eso esa ese quiero quisiera necesito puedes podrias dime muestrame abre abrir ver hoy ayer mes semana " +
  "ano todo toda todos todas otro otra mas menos muy bien rem ren oye hola gracias favor porfa entre entro salio tengo tenemos dame quien donde cuando " +
  "algo cosa cosas ahora aqui alla eso pues bueno entonces tambien solo cual cuales").split(" "));

// Palabras cortas que el dictado escribe mal seguido.
const SHORT: Record<string, string> = { oy: "hoy", ai: "hay", ago: "hago", ase: "hace", aser: "hacer", ber: "ver", beo: "veo", ize: "hice", ise: "hice", aller: "ayer", ayier: "ayer", aora: "ahora", ke: "que", q: "que", xq: "porque", tb: "tambien" };

/** De la intención a su capacidad en el catálogo (para revisar permisos antes de sugerir). */
export const INTENT_CAP: Record<string, string> = {
  sales: "query:sales", stock: "query:stock", expenses: "query:expenses", debts: "query:debts", profit: "query:profit", payables: "query:payables",
  cash: "query:cash", goals: "query:goals", tasks: "query:tasks", draft_expense: "form:gasto-por-voz", draft_client: "form:tercero-por-voz", draft_product: "form:producto-por-voz",
};

let vocabCache: Map<string, string> | null = null;
let accentCache: Map<string, string> | null = null;

/** Cómo se escribe cada palabra con tilde, según los textos de RemHub («cuanto» → «cuánto»). */
function accents(): Map<string, string> {
  if (accentCache) return accentCache;
  const raw = [...CAPABILITIES.flatMap((c) => [c.label, ...c.examples]), ...MODULES.map((m) => m.name), ...VOICE_SCREENS.flatMap((v) => v.examples)].join(" ");
  const m = new Map<string, string>();
  for (const w of raw.toLowerCase().replace(/[¿?¡!,.;:«»()]/g, " ").split(/\s+/)) {
    if (w && /[áéíóúñ]/.test(w)) m.set(normalize(w), w);
  }
  accentCache = m;
  return m;
}

/** Frase para mostrar y decir: con tildes y, si pregunta, entre «¿…?». */
function polish(t: string): string {
  const a = accents();
  const ASK: Record<string, string> = { quien: "quién", quienes: "quiénes", que: "qué", como: "cómo", cual: "cuál", cuales: "cuáles", donde: "dónde", cuando: "cuándo", cuanto: "cuánto", cuanta: "cuánta", cuantos: "cuántos", cuantas: "cuántas" };
  const words = t.split(" ").map((w, i) => (i === 0 && ASK[w]) || a.get(w) || w);
  const text = words.join(" ");
  const q = /^(?:cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|quien|quienes|hay|para que)\b/.test(t);
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  return q ? `¿${cap}?` : cap;
}

/** Vocabulario de RemHub (palabras de módulos, páginas, consultas y frases de ejemplo), por cómo suenan. */
function vocabulary(): Map<string, string> {
  if (vocabCache) return vocabCache;
  const text = [
    ...MODULES.flatMap((m) => [m.name, m.aliases, m.keys?.replace(/\|/g, " ") ?? "", ...(m.howto ?? []).flatMap((h) => [h.goal, h.keywords])]),
    ...CAPABILITIES.flatMap((c) => [c.label, c.synonyms, ...c.examples]),
    ...VOICE_SCREENS.flatMap((v) => [v.name, ...v.examples]),
    "vendimos vendido vender ventas gastamos gastado gastos ganamos ganancia deben debemos cartera caja metas comision pendiente pendientes existencias quedan cuantas hay abre muestrame registra anota crea",
    // Verbos y palabras de preguntas («sirbe» = sirve).
    "sirve sirven hago hacer haces hacen veo quiero quisiera puedo creo crear registro registrar abro cierro cerrar busco buscar ensename explicame necesito llevame tengo tenemos vendo vende vendio compro compre",
    // Números dichos («sinkuenta» = cincuenta).
    "cero once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos millon millones",
  ].join(" ");
  const map = new Map<string, string>();
  for (const w of normalize(text).split(/[^a-z0-9]+/)) {
    if (w.length < 4 || /\d/.test(w)) continue;
    const p = phonetic(w);
    if (!map.has(p)) map.set(p, w);
  }
  vocabCache = map;
  return map;
}

/** Corrige las palabras que no son de RemHub por la más parecida que sí es. Devuelve la frase corregida (o la misma). */
export function correctWords(text: string): string {
  const vocab = vocabulary();
  const known = new Set(vocab.values());
  return normalize(text).split(" ").map((w) => {
    if (SHORT[w]) return SHORT[w];
    if (w.length < 4 || KEEP.has(w) || known.has(w) || known.has(singular(w)) || /\d/.test(w)) return w;
    const p = phonetic(w);
    const same = vocab.get(p);
    if (same) return same; // suena igual («bendimos» = «vendimos»)
    let best: { w: string; s: number } | null = null;
    for (const [vp, vw] of vocab) {
      // Mismo sonido al empezar: «entro» no es «centro».
      if (Math.abs(vp.length - p.length) > 2 || vp[0] !== p[0]) continue;
      const s = similarity(p, vp);
      if (s >= (p.length >= 7 ? 0.75 : 0.8) && (!best || s > best.s)) best = { w: vw, s };
    }
    return best?.w ?? w;
  }).join(" ");
}


/** Hasta 3 sugerencias para lo que no se entendió, solo con lo que la persona puede usar. */
export function suggestFor(text: string, ctx: RemContext, can: (p: string) => boolean): Suggestion[] {
  const t = normalize(text).replace(/^(?:(?:oye |hey )?(?:rem|ren) )/, "").trim();
  if (!t || t.split(" ").length > 14) return [];
  const out: Suggestion[] = [];
  const same = (a: string, b: string) => normalize(a).replace(/[¿?¡!]/g, "").trim() === normalize(b).replace(/[¿?¡!]/g, "").trim();
  const add = (s: Suggestion) => { if (out.length < 3 && !out.some((x) => same(x.phrase, s.phrase) || same(x.say, s.say))) out.push(s); };
  const page = (l: NavLink): Suggestion => ({ say: l.action || /^(?:abrir|nuevo|nueva|registrar|ingresar|preparar|importar)\b/i.test(l.label) ? l.label : `Abrir ${l.label}`, phrase: `abre ${l.label}` });
  const ok = (perms: string[]) => !perms.length || perms.some((p) => can(p));

  // 1. Con las palabras corregidas, ¿ahora sí se entiende?
  const fixed = correctWords(t);
  if (fixed !== t) {
    const u = understand(fixed, ctx);
    // Solo si la persona lo puede usar (la consulta tiene sus permisos en el catálogo).
    const cap = u ? CAPABILITIES.find((c) => c.id === INTENT_CAP[u.intent.kind]) : null;
    if (u && u.confidence >= CONFIDENT && (!cap || ok(cap.perms))) add({ say: polish(fixed), phrase: fixed });
    else {
      const nav = navTarget(fixed, ctx.links);
      if (nav) add(page(nav.link));
    }
  }

  // 2. Páginas que se parecen (más flojo que «abre…», por eso se pregunta).
  const q = parseQuery(fixed);
  q.words = q.words.filter((w) => !KEEP.has(w));
  if (q.words.length) {
    q.raw = q.words.join(" ");
    const pages = ctx.links
      .map((l) => ({ l, s: scoreItem(l, { ...q, create: false }) }))
      .filter((x) => x.s >= 6)
      .sort((a, b) => b.s - a.s || Number(Boolean(a.l.action)) - Number(Boolean(b.l.action)));
    for (const p of pages.slice(0, 2)) add(page(p.l));

    // 3. Consultas y formularios por voz parecidos (con su frase de ejemplo).
    const qs = CAPABILITIES
      .filter((c) => (c.kind === "query" || c.id.endsWith("-por-voz")) && c.examples.length && ok(c.perms))
      .map((c) => ({ c, s: scoreItem({ label: c.label, keywords: `${c.synonyms} ${c.examples.join(" ")}` }, { ...q, create: false }) }))
      .filter((x) => x.s >= 6)
      .sort((a, b) => b.s - a.s);
    for (const x of qs.slice(0, 2)) add({ say: x.c.examples[0], phrase: x.c.examples[0] });
  }
  return out;
}

/** Cómo lo pregunta REM. */
export function suggestionReply(s: Suggestion[]): { say: string; show: string } {
  if (s.length === 1) return { say: `No te entendí bien. ¿Quisiste decir «${s[0].say}»? Di sí o no.`, show: `¿Quisiste decir «${s[0].say}»?\nDi sí o no.` };
  const n = ["uno", "dos", "tres"];
  return {
    say: `No te entendí bien. ¿Quisiste decir: ${s.map((x, i) => `${n[i]}, ${x.say}`).join("; ")}? Dime cuál, o dímelo de otra forma.`,
    show: `¿Quisiste decir…?\n${s.map((x, i) => `${i + 1}. ${x.say}`).join("\n")}\nDime cuál, o dímelo de otra forma.`,
  };
}

const YES = /^(?:si|claro|dale|eso|esa|ese|exacto|correcto|asi es|si senor|si senora|si eso|si esa|si ese|eso mismo|esa misma|ok|okey|listo|va|vale|de una)$/;
const NO = /^(?:no|nop|ninguna|ninguno|ninguna de esas|no gracias|otra cosa|nada|tampoco)$/;
const ORD: Record<string, number> = { uno: 0, una: 0, primera: 0, primero: 0, "1": 0, dos: 1, segunda: 1, segundo: 1, "2": 1, tres: 2, tercera: 2, tercero: 2, "3": 2 };

/** Qué contestó a «¿Quisiste decir…?»: la sugerencia elegida, "no", o null (dijo otra cosa: se procesa normal). */
export function pickSuggestion(text: string, s: Suggestion[]): Suggestion | "no" | null {
  const t = normalize(text).replace(/^(?:(?:oye |hey )?(?:rem|ren) )/, "").replace(/^(?:la |el |si,? (?:la |el )?)/, "").replace(/\s+(?:por favor|porfa)$/, "").trim();
  if (NO.test(t)) return "no";
  if (YES.test(t)) return s.length === 1 ? s[0] : null;
  const ord = t.match(/^(?:opcion |numero )?(uno|una|primera|primero|1|dos|segunda|segundo|2|tres|tercera|tercero|3)$/);
  if (ord) return s[ORD[ord[1]]] ?? null;
  const q = { ...parseQuery(t), create: false };
  if (!q.words.length) return null;
  const best = s.map((x) => ({ x, sc: scoreItem({ label: x.say }, q) })).sort((a, b) => b.sc - a.sc)[0];
  return best && best.sc >= 9 ? best.x : null;
}

// ---------------------------------------------------------------------------------------------
// Atajos de cada persona: «la plata que entró hoy» → «cuánto vendimos hoy» (porque lo eligió en una sugerencia).

type Alias = { to: string; at: number; uses: number };
const aliasKey = (text: string) => normalize(text).replace(/^(?:(?:oye |hey )?(?:rem|ren) )/, "").replace(/\b(?:por favor|porfa)\b/g, " ").replace(/\s+/g, " ").trim();

export function learnAlias(from: string, to: string) {
  const k = aliasKey(from);
  const n = k.split(" ").length;
  if (!k || n < 2 || n > 14 || k === aliasKey(to)) return;
  const all = readJson<Record<string, Alias>>("aliases", {});
  all[k] = { to, at: Date.now(), uses: (all[k]?.uses ?? 0) + 1 };
  const keys = Object.keys(all);
  if (keys.length > 200) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 200).forEach((x) => delete all[x]);
  writeJson("aliases", all);
}

export function aliasFor(text: string): string | null {
  const all = readJson<Record<string, Alias>>("aliases", {});
  return all[aliasKey(text)]?.to ?? null;
}

export function listAliases(): Array<{ key: string; to: string }> {
  return Object.entries(readJson<Record<string, Alias>>("aliases", {})).map(([key, a]) => ({ key, to: a.to })).sort((a, b) => a.key.localeCompare(b.key));
}

export function forgetAlias(key: string) {
  const all = readJson<Record<string, Alias>>("aliases", {});
  if (all[key]) { delete all[key]; writeJson("aliases", all); }
}

/** Para las pruebas: el vocabulario se arma una vez. */
export function _resetVocabulary() { vocabCache = null; accentCache = null; }
export type { NavLink };
