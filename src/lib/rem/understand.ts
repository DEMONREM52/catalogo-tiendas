/**
 * Comprensión de REM: de lo dicho a QUÉ se pide (intención + datos + qué tan seguro está).
 *
 * Separado a propósito de lo demás:
 *   comprensión (aquí) → autorización y ejecución (actions.ts) → respuesta (respond.ts) → voz (src/lib/voice).
 * Un proveedor de comprensión solo devuelve una intención; nunca ejecuta nada ni decide permisos.
 * Hoy hay uno: reglas locales, gratis, en el navegador. Mañana se puede poner otro delante (semántico o un modelo
 * de lenguaje) con la misma interfaz: lo que devuelva pasa por los mismos controles.
 *
 * Esto cubre lo que no es de una pantalla: explicar módulos, cómo se hace algo, cuánto se ha vendido,
 * «crea uno nuevo» según dónde se está y «qué sabes hacer». Abrir páginas y las pantallas con voz
 * siguen en src/lib/voice (navigate.ts, rem.ts).
 */

import { parseQuery, scoreItem } from "@/lib/fuzzy-search";
import { normalize } from "@/lib/voice/spanish";
import type { NavLink } from "@/lib/voice/navigate";
import { createOptions, type Capability } from "./catalog";
import { MODULES, moduleOfPath, type HowTo, type ModuleInfo } from "./modules";
import { parsePeriod, periodOf, bogotaToday, type Period } from "./period";

export type SalesScope = "all" | "mine" | "top";
export type SalesQuery = { period: Period; scope: SalesScope; point: string | null };

/** De qué se venía hablando (para «¿y las de ayer?»). */
export type Topic = { kind: "sales"; q: SalesQuery } | { kind: "module"; module: string };

export type RemContext = {
  /** Página actual con su ?tab=. */
  path: string;
  now: Date;
  topic: Topic | null;
  /** Lo que la persona puede abrir (ya filtrado por sus permisos). */
  links: NavLink[];
};

export type Intent =
  | { kind: "explain"; module: ModuleInfo; available: boolean }
  | { kind: "howto"; module: ModuleInfo; howto: HowTo | null; available: boolean }
  | { kind: "sales"; q: SalesQuery }
  | { kind: "create"; options: Capability[]; hidden: number; module: ModuleInfo | null }
  | { kind: "capabilities" }
  | { kind: "choose"; ask: "explain" | "howto"; options: ModuleInfo[] };

export type Understanding = { intent: Intent; confidence: number; provider: string; why: string };

export interface UnderstandingProvider {
  id: string;
  understand(text: string, ctx: RemContext): Understanding | null;
}

/** Por debajo de esto REM no actúa: pregunta. */
export const CONFIDENT = 0.6;

// ---------------------------------------------------------------------------------------------

const NAME = /^(?:(?:oye |hey )?(?:rem|ren) )/;
const POLITE = /\b(?:por favor|porfa|porfavor)\b/g;
const clean = (text: string) => normalize(text).replace(NAME, "").replace(POLITE, " ").replace(/\s+/g, " ").trim();

const HERE = /^(?:esto|eso|esta|este|aqui|aca|esta (?:pantalla|seccion|pagina|parte|ventana)|este (?:modulo|menu|gestor))$/;

const EXPLAIN = /^(?:(?:me )?(?:puedes |podrias )?(?:explicame|explicar|explicarme|decirme|dime)\s+)?(?:para que (?:sirve|sirven|es|son|se usa|se usan)|que (?:es|son|hace|hacen|hay en|tiene|significa)|de que (?:se )?trata|en que consiste|como funciona|como funcionan|que puedo hacer en|que se hace en|explicame|explicame que es)\s*(.*)$/;
const HOWTO = /^(?:(?:me )?(?:puedes |podrias )?(?:explicarme|explicame|decirme|dime|ensename|ensenarme)\s+)?(?:como|de que forma|que pasos sigo para|que pasos hay para|cuales son los pasos para|que tengo que hacer para|que hago para|los pasos para)\s+(.+)$/;
const HOWTO_VERBS = /\b(?:se|le|lo|la|puedo|podria|debo|tengo que|hago|hacer|hace|registro|registrar|registra|creo|crear|crea|agrego|agregar|agrega|anado|anadir|ingreso|ingresar|ingresa|subo|subir|meto|meter|pongo|poner|saco|sacar|hago para|un|una|unos|unas|el|la|los|las|nuevo|nueva|nuevos|nuevas|mi|mis|de|del|en|para|a|al)\b/g;

const SALES_WORD = /\b(?:vend\w*|ventas?|facturad[oa]s?|facturamos|facturado)\b/;
const SALES_ASK = /\b(?:cuanto|cuanta|cuantos|cuantas|como (?:van|vamos|va|estan|estamos|nos fue|me fue|fue)|resumen|total|muestrame|muestra|dime|ver|quiero ver|que tal|lo que|lo mas|mas vendid\w*|informe|reporte|busca|buscame|hoy|ayer|antier|anteayer|hace|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
const SALES_DO = /\b(?:hacer (?:una |la )?venta|nueva venta|quiero vender|vamos a vender|voy a vender|vender (?:un|una|el|la|unos|unas|dos|tres)\b|registrar (?:una )?venta|cobrar)\b/;
const HARD_NAV = /^(?:abre(?:me)?|abrir|abri|ir a|ve a|vete a|llevame|lleveme|entra a|entrar a|pasame a|navega a|quiero ir)\b/;
const MINE = /\b(?:yo|mis ventas|las mias|mias|he vendido|vendi|a mi nombre|lo mio)\b/;
const TOP = /\b(?:lo mas vendido|los mas vendidos|mas vendid\w*|lo que mas se vende|que se vende mas|que mas se vende|mas se vendio|top)\b/;
const POINT = /\b(?:en|de|del) (?:la |el )?(?:sede|punto|sucursal|tienda) (?:de |del )?([a-z0-9 ]{2,40}?)(?=$| de (?:hoy|ayer|antier)| hoy| ayer)/;
const FOLLOW = /^(?:y|y que tal|y como|y cuanto|y en|y de|y para)\b\s*(.*)$/;

const CREATE_HERE = /^(?:(?:ayudame|ayudeme|me ayudas|me puedes ayudar) a |quiero |puedes |podrias |vamos a |necesito |hay que )?(?:crear|crea|creame|hacer|haz|hazme|registrar|registra|agregar|agrega|anadir|anade|abrir|abre)?\s*(?:me\s+)?(?:uno|una|otro|otra)?\s*(?:nuevo|nueva)?$/;
const CAPS = /^(?:que (?:sabes|puedes) hacer|que haces|en que (?:me )?(?:puedes )?ayudar|en que me ayudas|que cosas (?:sabes|puedes) hacer|para que sirves|cuales son tus funciones|que te puedo pedir)$/;

type Scored = { m: ModuleInfo; score: number };

/** Módulos que se parecen a lo dicho, el más parecido primero. */
export function matchModules(text: string): Scored[] {
  const q = parseQuery(text);
  q.words = q.words.filter((w) => !["modulo", "seccion", "pagina", "pantalla", "parte", "menu", "gestor", "opcion"].includes(w));
  if (!q.words.length) return [];
  q.raw = q.words.join(" ");
  return MODULES
    .map((m) => ({ m, score: scoreItem({ label: m.name, keywords: m.aliases }, { ...q, create: false }) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

const conf = (score: number) => Math.max(0, Math.min(1, score / 12));

function available(m: ModuleInfo, links: NavLink[]): boolean {
  return links.some((l) => moduleOfPath(l.href)?.id === m.id);
}

/** El módulo del que se habla: «esto» = donde se está; si no, el más parecido. Ambiguo si dos se parecen igual. */
function moduleFor(subject: string, ctx: RemContext): { pick: ModuleInfo; confidence: number } | { choose: ModuleInfo[] } | null {
  const s = subject.replace(/^(?:el|la|los|las|lo) /, "").replace(/^(?:modulo|seccion|pagina|parte|menu|gestor) (?:de |del )?/, "").trim();
  if (!s || HERE.test(s)) {
    const here = moduleOfPath(ctx.path);
    return here ? { pick: here, confidence: 0.9 } : null;
  }
  const byKey = MODULES.find((m) => m.keys?.split("|").includes(s));
  if (byKey) return { pick: byKey, confidence: 1 };
  const hits = matchModules(s);
  if (!hits.length) return null;
  const [a, b] = hits;
  if (b && b.score >= 8 && a.score - b.score < 1) return { choose: [a.m, b.m] };
  return { pick: a.m, confidence: conf(a.score) };
}

function howtoFor(subject: string): { howto: HowTo; module: ModuleInfo; score: number } | null {
  const rest = subject.replace(HOWTO_VERBS, " ").replace(/\s+/g, " ").trim();
  if (!rest) return null;
  const q = { ...parseQuery(rest), create: false };
  let best: { howto: HowTo; module: ModuleInfo; score: number } | null = null;
  for (const m of MODULES) for (const h of m.howto ?? []) {
    const score = scoreItem({ label: h.goal, keywords: h.keywords }, q);
    if (score > 0 && (!best || score > best.score)) best = { howto: h, module: m, score };
  }
  return best && best.score >= 7 ? best : null;
}

function salesOf(t: string, ctx: RemContext, base: SalesQuery | null): SalesQuery {
  const today = periodOf(bogotaToday(ctx.now), bogotaToday(ctx.now));
  const period = parsePeriod(t, ctx.now);
  const scope: SalesScope = TOP.test(t) ? "top" : MINE.test(t) ? "mine" : base && !period ? base.scope : "all";
  const point = t.match(POINT)?.[1]?.trim() ?? (base && !period ? base.point : null);
  return { period: period ?? base?.period ?? today, scope, point };
}

/** Reglas locales: gratis, en el navegador, sin IA. */
export const localRules: UnderstandingProvider = {
  id: "reglas",
  understand(text, ctx) {
    const t = clean(text);
    if (!t) return null;

    // «¿Y las de ayer?», «¿y las mías?»: sigue el tema de antes.
    if (ctx.topic?.kind === "sales") {
      const f = t.match(FOLLOW);
      const rest = f ? f[1] : t;
      const onlyMore = parsePeriod(rest, ctx.now) || MINE.test(rest) || TOP.test(rest) || POINT.test(rest);
      if ((f && onlyMore) || (!f && onlyMore && rest.split(" ").length <= 4 && !SALES_DO.test(rest) && !HARD_NAV.test(rest))) {
        return { intent: { kind: "sales", q: salesOf(rest, ctx, ctx.topic.q) }, confidence: 0.85, provider: this.id, why: "seguimiento de ventas" };
      }
    }
    if (ctx.topic?.kind === "module") {
      const f = t.match(/^y (?:como|que pasos)\b.*$/);
      if (f) {
        const m = MODULES.find((x) => x.id === (ctx.topic as { module: string }).module);
        if (m) return { intent: { kind: "howto", module: m, howto: m.howto?.[0] ?? null, available: available(m, ctx.links) }, confidence: 0.7, provider: this.id, why: "seguimiento de módulo" };
      }
    }

    if (CAPS.test(t)) return { intent: { kind: "capabilities" }, confidence: 1, provider: this.id, why: "qué sabe hacer" };

    // Ventas: «¿cuánto vendimos hoy?», «muéstrame las ventas de ayer», «lo más vendido». No: «quiero hacer una venta».
    if (SALES_WORD.test(t) && SALES_ASK.test(t) && !SALES_DO.test(t) && !HARD_NAV.test(t)) {
      return { intent: { kind: "sales", q: salesOf(t, ctx, null) }, confidence: 0.85, provider: this.id, why: "consulta de ventas" };
    }

    const hm = t.match(HOWTO);
    if (hm && !/^(?:funciona|funcionan|van|vamos|estas|esta|te llamas|te va)\b/.test(hm[1])) {
      const h = howtoFor(hm[1]);
      if (h) return { intent: { kind: "howto", module: h.module, howto: h.howto, available: available(h.module, ctx.links) }, confidence: conf(h.score + 2), provider: this.id, why: `cómo: ${h.howto.id}` };
      const m = moduleFor(hm[1].replace(HOWTO_VERBS, " ").replace(/\s+/g, " ").trim(), ctx);
      if (m && "choose" in m) return { intent: { kind: "choose", ask: "howto", options: m.choose }, confidence: 0.5, provider: this.id, why: "ambiguo" };
      if (m) return { intent: { kind: "howto", module: m.pick, howto: null, available: available(m.pick, ctx.links) }, confidence: m.confidence, provider: this.id, why: "cómo: sin pasos" };
      return null;
    }

    const em = t.match(EXPLAIN);
    if (em) {
      const m = moduleFor(em[1], ctx);
      if (m && "choose" in m) return { intent: { kind: "choose", ask: "explain", options: m.choose }, confidence: 0.5, provider: this.id, why: "ambiguo" };
      if (m) return { intent: { kind: "explain", module: m.pick, available: available(m.pick, ctx.links) }, confidence: m.confidence, provider: this.id, why: "explicar" };
      return null;
    }

    // «Ayúdame a crear uno nuevo» estando en Productos = nuevo producto; en Gastos, un gasto…
    if (CREATE_HERE.test(t) && /\b(?:uno|una|otro|otra|nuevo|nueva)\b/.test(t)) {
      let all = createOptions(ctx.path);
      // «Uno nuevo»: si hay «Nuevo producto» e «Importar productos», es el nuevo.
      if (all.some((c) => /^nuev/i.test(c.label))) all = all.filter((c) => /^nuev/i.test(c.label));
      const ok = all.filter((c) => ctx.links.some((l) => l.href === c.href));
      return { intent: { kind: "create", options: ok, hidden: all.length - ok.length, module: moduleOfPath(ctx.path) }, confidence: all.length ? 0.85 : 0.6, provider: this.id, why: "crear aquí" };
    }
    return null;
  },
};

/** Pasa lo dicho por los proveedores en orden; gana el primero que esté seguro. */
export function understand(text: string, ctx: RemContext, providers: UnderstandingProvider[] = [localRules]): Understanding | null {
  let unsure: Understanding | null = null;
  for (const p of providers) {
    const u = p.understand(text, ctx);
    if (!u) continue;
    if (u.confidence >= CONFIDENT) return u;
    unsure ??= u;
  }
  return unsure;
}

/** «La primera», «la de nómina»: cuál de las opciones que REM ofreció. null si no se entiende. */
export function resolveChoice<T extends { name?: string; label?: string }>(text: string, options: T[]): T | null {
  const t = clean(text);
  const ord = t.match(/\b(?:la |el )?(primera|primero|1|uno|una|segunda|segundo|2|dos|tercera|tercero|3|tres|ultima|ultimo)\b/);
  if (ord) {
    const i = ({ primera: 0, primero: 0, "1": 0, uno: 0, una: 0, segunda: 1, segundo: 1, "2": 1, dos: 1, tercera: 2, tercero: 2, "3": 2, tres: 2 } as Record<string, number>)[ord[1]];
    const hit = i === undefined ? options.at(-1) : options[i];
    if (hit) return hit;
  }
  const q = { ...parseQuery(t), create: false };
  if (!q.words.length) return null;
  let best: { o: T; s: number } | null = null;
  for (const o of options) {
    const s = scoreItem({ label: o.name ?? o.label ?? "" }, q);
    if (s > 0 && (!best || s > best.s)) best = { o, s };
  }
  return best && best.s >= 6 ? best.o : null;
}
