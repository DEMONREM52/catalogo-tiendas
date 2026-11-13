/**
 * REM en todo el panel: «abre los gastos», «llévame a la nómina», «muéstrame rentabilidad por punto».
 * Usa la misma lista del buscador Ctrl+K (ya filtrada por los permisos de quien habla): REM no abre
 * nada que la persona no pueda abrir a mano.
 *
 * Y aprende frases: si algo no lo entendió y enseguida, dicho de otra forma, sí, la frase que falló
 * queda guardada (en este equipo) y la próxima vez lleva directo.
 */

import { parseQuery, scoreItem } from "@/lib/fuzzy-search";
import { normalize } from "./spanish";

export type NavLink = { href: string; label: string; emoji?: string; hint?: string; keywords?: string; action?: boolean };

const NAV_VERB = /^(?:(?:oye |hey )?rem )?(?:por favor )?(?:(?:yo )?(?:quiero|quisiera|necesito|puedes|podrias|me puedes|me podrias|me quieres|vamos|hay que)\s+)?(?:abre(?:me)?|abrir|abri|ir a|ve a|vete a|vamos a|llevame a|lleveme a|muestrame|muestra|ensename|quiero ver|entra a|entrar a|entremos a|pasa a|pasame a|cambia a|navega a)\s+(.+)$/;

const NAV_FILLER = new Set(["gestor", "modulo", "seccion", "pagina", "pestana", "parte", "menu", "ventana", "pantalla", "panel", "opcion"]);

/** «abre los gastos» → «los gastos». null si no pide ir a algún lado. */
export function navRequest(text: string): string | null {
  const m = normalize(text).match(NAV_VERB);
  return m ? m[1].replace(/^(?:la pagina|la seccion|la pestana|el modulo|la parte)\s+(?:de\s+)?/, "").trim() || null : null;
}

/**
 * A qué página lleva lo dicho. Con verbo («abre…») basta un parecido normal; sin verbo («la nómina»)
 * tiene que parecerse mucho. `strict`: en medio de un traslado o una venta, para no salirse por una frase de la pantalla.
 * null si nada se parece lo suficiente.
 */
export function navTarget<T extends NavLink>(text: string, links: T[], strict = false): { link: T; score: number } | null {
  const asked = navRequest(text);
  const parsed = parseQuery(asked ?? normalize(text));
  // «El gestor de campañas», «el módulo de nómina»: esas palabras no dicen a dónde, solo «una página».
  const q = { ...parsed, words: parsed.words.filter((w) => !NAV_FILLER.has(w)) };
  if (!q.words.length) return null;
  let best: { link: T; score: number } | null = null;
  for (const l of links) {
    const score = scoreItem(l, q);
    if (score > 0 && (!best || score > best.score)) best = { link: l, score };
  }
  if (!best) return null;
  return best.score >= (asked ? (strict ? 9 : 6) : 10) ? best : null;
}

// ---------------------------------------------------------------------------------------------
// Frases aprendidas: «la plata de los muchachos» → Nómina (porque enseguida se dijo «nómina»).

const PHRASE_KEY = "remhub:rem-phrases";
type Phrase = { href: string; label: string; at: number; uses: number };

/** Llave de una frase: sin «oye REM», sin relleno, sin tildes. */
export function phraseKey(text: string): string {
  return normalize(text)
    .replace(/^(?:(?:oye |hey )?rem )/, "")
    .replace(/\b(?:por favor|porfa|porfavor|ahora|ya|pues|bueno|este|eh|em)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readPhrases(): Record<string, Phrase> {
  try { return JSON.parse(localStorage.getItem(PHRASE_KEY) ?? "{}") as Record<string, Phrase>; } catch { return {}; }
}

export function learnedPhrase(text: string): Phrase | null {
  const k = phraseKey(text);
  return k ? readPhrases()[k] ?? null : null;
}

/** Guarda que «esta frase» lleva a «esta página» (máximo 300 frases en este equipo). */
export function learnPhrase(text: string, href: string, label: string) {
  const k = phraseKey(text);
  // Una palabra suelta («hola», «eh») no se aprende: podría ser ruido y llevaría a una página sin querer.
  const n = k.split(" ").length;
  if (!k || n < 2 || n > 12) return;
  try {
    const all = readPhrases();
    all[k] = { href, label, at: Date.now(), uses: (all[k]?.uses ?? 0) + 1 };
    const keys = Object.keys(all);
    if (keys.length > 300) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 300).forEach((x) => delete all[x]);
    localStorage.setItem(PHRASE_KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento */ }
}

export function forgetPhrase(text: string) {
  const k = phraseKey(text);
  try {
    const all = readPhrases();
    if (all[k]) { delete all[k]; localStorage.setItem(PHRASE_KEY, JSON.stringify(all)); }
  } catch { /* sin almacenamiento */ }
}

/** Cuántas cosas lleva aprendidas en este equipo (frases + productos). */
export function learnedCount(): number {
  try {
    const p = Object.keys(JSON.parse(localStorage.getItem(PHRASE_KEY) ?? "{}")).length;
    const r = Object.keys(JSON.parse(localStorage.getItem("remhub:rem-learned") ?? "{}")).length;
    return p + r;
  } catch { return 0; }
}

// ---------------------------------------------------------------------------------------------
// La conversación queda guardada (en este equipo) para verla al tocar la esfera, aunque se recargue.

const LOG_KEY = "remhub:rem-log";
export type LogTurn = { who: "you" | "rem"; text: string; at: number };

export function readLog(): LogTurn[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as LogTurn[];
    return Array.isArray(v) ? v.slice(-60) : [];
  } catch { return []; }
}

export function writeLog(turns: LogTurn[]) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(turns.slice(-60))); } catch { /* sin almacenamiento */ }
}
