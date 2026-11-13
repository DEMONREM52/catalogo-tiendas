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
import { normalize, parseNumberAt } from "@/lib/voice/spanish";
import type { NavLink } from "@/lib/voice/navigate";
import { createOptions, type Capability } from "./catalog";
import { MODULES, moduleOfPath, type HowTo, type ModuleInfo } from "./modules";
import { parsePeriod, parseRange, periodOf, bogotaToday, type Period, type Range } from "./period";
import { moneyIn } from "./money";

export type SalesScope = "all" | "mine" | "top";
/** `range`: si se pidió más de un día («este mes»). */
export type SalesQuery = { period: Period; scope: SalesScope; point: string | null; range?: Range | null };
export type StockQuery = { product: string };
export type ExpenseQuery = { range: Range; status: "all" | "open" | "overdue" };
export type DebtQuery = { customer: string | null };
export type ExpenseDraft = { amount: number | null; detail: string };

/** De qué se venía hablando (para «¿y las de ayer?», «¿y el mes pasado?»). */
export type Topic =
  | { kind: "sales"; q: SalesQuery }
  | { kind: "expenses"; q: ExpenseQuery }
  | { kind: "debts"; q: DebtQuery }
  | { kind: "stock"; q: StockQuery }
  | { kind: "module"; module: string };

export type RemContext = {
  /** Página actual con su ?tab=. */
  path: string;
  now: Date;
  topic: Topic | null;
  /** Lo que la persona puede abrir (ya filtrado por sus permisos y por el plan). */
  links: NavLink[];
  /** Si un módulo no está en `links`: ¿es por el plan de la tienda o por los permisos de la persona? */
  blockedBy?: (m: ModuleInfo) => "plan" | "permission";
};

export type Unavailable = "plan" | "permission" | null;

export type Intent =
  | { kind: "explain"; module: ModuleInfo; available: boolean; why?: Unavailable }
  | { kind: "howto"; module: ModuleInfo; howto: HowTo | null; available: boolean; why?: Unavailable }
  | { kind: "sales"; q: SalesQuery }
  | { kind: "stock"; q: StockQuery }
  | { kind: "expenses"; q: ExpenseQuery }
  | { kind: "debts"; q: DebtQuery }
  | { kind: "draft_expense"; draft: ExpenseDraft }
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
const SALES_ASK = /\b(?:cuanto|cuanta|cuantos|cuantas|como (?:van|vamos|va|estan|estamos|nos fue|me fue|fue)|resumen|total|muestrame|muestra|dime|ver|quiero ver|que tal|lo que|lo mas|mas vendid\w*|informe|reporte|busca|buscame|hoy|ayer|antier|anteayer|hace|lunes|martes|miercoles|jueves|viernes|sabado|domingo|este mes|del mes|mes pasado|semana|este ano|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
const SALES_DO = /\b(?:hacer (?:una |la )?venta|nueva venta|quiero vender|vamos a vender|voy a vender|vender (?:un|una|el|la|unos|unas|dos|tres)\b|registrar (?:una )?venta|cobrar)\b/;
// «¿Cómo va la cartera?», «¿cómo van los gastos?»: preguntan cómo está algo, no cómo se hace.
const HOW_IS = /^como (?:funciona|funcionan|va|van|vamos|anda|andan|esta|estan|estamos|estas|te llamas|te va|nos fue|me fue|fue)\b/;
const HARD_NAV = /^(?:abre(?:me)?|abrir|abri|ir a|ve a|vete a|llevame|lleveme|entra a|entrar a|pasame a|navega a|quiero ir)\b/;
const MINE = /\b(?:yo|mis ventas|las mias|mias|he vendido|vendi|a mi nombre|lo mio)\b/;
const TOP = /\b(?:lo mas vendido|los mas vendidos|mas vendid\w*|lo que mas se vende|que se vende mas|que mas se vende|mas se vendio|top)\b/;
const POINT = /\b(?:en|de|del) (?:la |el )?(?:sede|punto|sucursal|tienda) (?:de |del )?([a-z0-9 ]{2,40}?)(?=$| de (?:hoy|ayer|antier)| hoy| ayer)/;
const FOLLOW = /^(?:y|y que tal|y como|y cuanto|y en|y de|y para)\b\s*(.*)$/;

// Existencias: «¿cuántas hay de la cámara sc30a?», «¿cuántas zapateras quedan?», «¿hay termos?», «stock de la vts30».
const STOCK = [
  /^(?:cuant[oa]s?|que tant[oa]s?) (?:unidades )?(?:hay|quedan|queda|tenemos|nos quedan|tengo|me quedan) (?:de |del )?(.+)$/,
  /^(?:cuant[oa]s?|cuantas unidades de|cuantos unidades de) (.+?) (?:hay|quedan|tenemos|nos quedan|tengo|me quedan)(?: en (?:total|bodega|inventario|existencia|stock))?$/,
  /^(?:hay|tenemos|quedan|nos quedan|todavia hay|aun hay|si hay) (?:existencias? de |unidades de )?(.+?)(?: en (?:bodega|inventario|existencia|stock))?$/,
  /^(?:existencias?|stock|unidades) (?:de|del) (.+)$/,
  /^(?:muestrame|dime|consulta|revisa|mira|busca|buscame) (?:las |el )?(?:existencias?|stock|inventario|unidades) (?:de|del) (.+)$/,
  /^(?:cuanto|que tanto) (?:stock|inventario) (?:hay |tenemos )?(?:de|del) (.+)$/,
];
const NOT_PRODUCT = /^(?:que|alguien|algo|algun|alguna|ventas?|gastos?|pedidos?|clientes?|traslados?|caja|deudas?|cartera|cotizaciones|apartados|usuarios|puntos|productos|empleados|facturas?|mensajes|pendientes|novedades|tareas|stock|inventario|existencias)\b/;

// Cartera: «¿cuánto nos deben?», «¿cuánto debe Juan Pérez?», «la deuda de Martha».
const DEBT_WHO = [
  /^(?:cuanto|que|cuanta plata|cuanto dinero) (?:nos |me |le )?debe (?:el |la |don |dona |el senor |la senora |el cliente |la clienta )?(.+)$/,
  /^(?:la |el )?(?:deuda|saldo|cartera|credito) (?:de|del) (?:el |la |don |dona |cliente |la clienta )?(.+)$/,
];
const DEBT_ALL = /\b(?:nos deben|me deben|la cartera|cartera|por cobrar|deudas? de (?:los )?clientes|fiados?|quien(?:es)? (?:nos |me )?deben?|que nos deben|que me deben)\b/;
const DEBT_NOT = /\b(?:debemos|debo|proveedor\w*|cuentas por pagar)\b/;

// Gastos: «¿cuánto hemos gastado este mes?», «gastos pendientes», «¿y el mes pasado?».
const EXPENSE_WORD = /\b(?:gast\w*|egresos?)\b/;
const EXPENSE_ASK = /\b(?:cuanto|cuanta|cuantos|cuantas|total|resumen|como van|como vamos|dime|muestrame|pendientes?|por pagar|sin pagar|vencid\w*|este mes|del mes|mes pasado|semana|hoy|ayer|antier|ano|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
// «Registra un gasto de 50 mil en arriendo»: abre el formulario lleno; la persona revisa y guarda.
const EXPENSE_DO = /^(?:(?:quiero|necesito|vamos a|voy a|puedes|me puedes|ayudame a|hay que) )?(?:registra|registrar|registrame|anota|anotar|anotame|apunta|apuntar|apuntame|agrega|agregar|crea|crear|mete|meter|pon|poner|haz|hazme|ingresa|ingresar)?\s*(?:me\s+)?(?:un |el |otro )?(?:nuevo )?gasto\b\s*(.*)$/;

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

/** Por qué no puede abrirlo (null si sí puede). */
export function unavailable(m: ModuleInfo, ctx: RemContext): Unavailable {
  if (available(m, ctx.links)) return null;
  return ctx.blockedBy?.(m) ?? "permission";
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
  const range = parseRange(t, ctx.now);
  const period = parsePeriod(t, ctx.now);
  const said = period || (range && range.days > 1);
  const scope: SalesScope = TOP.test(t) ? "top" : MINE.test(t) ? "mine" : base && !said ? base.scope : "all";
  const point = t.match(POINT)?.[1]?.trim() ?? (base && !said ? base.point : null);
  return { period: period ?? (range && range.days > 1 ? today : base?.period ?? today), scope, point, range: range && range.days > 1 ? range : said ? null : base?.range ?? null };
}

const ARTICLES = /^(?:la|el|los|las|un|una|unos|unas|de|del)\s+/;
function productOf(subject: string): string | null {
  let p = subject.replace(/\s+(?:en total|todavia|aun|ahora|ahorita|disponibles?|en bodega|en inventario|en existencia)$/, "").trim();
  for (let k = 0; k < 2; k++) p = p.replace(ARTICLES, "");
  if (!p || NOT_PRODUCT.test(p) || p.split(" ").length > 8) return null;
  // «Hay tres», «quedan 5»: es una cantidad, no un producto.
  const words = p.split(" ");
  const n = parseNumberAt(words, 0);
  if (n && n.used >= words.length - (/^(?:unidades|piezas|pares|cajas)$/.test(words.at(-1) ?? "") ? 1 : 0)) return null;
  return p;
}

/** `loose`: dicho sin «de» («hay termos», «cuántas zapateras quedan»): en medio de un traslado no se toma. */
function stockOf(t: string): (StockQuery & { loose: boolean }) | null {
  for (const [i, re] of STOCK.entries()) {
    const m = t.match(re);
    if (m) { const p = productOf(m[1]); if (p) return { product: p, loose: i === 1 || i === 2 }; }
  }
  return null;
}

function debtOf(t: string): DebtQuery | null {
  if (DEBT_NOT.test(t)) return null;
  for (const re of DEBT_WHO) {
    const m = t.match(re);
    if (m) {
      const who = m[1].replace(/\s+(?:todavia|aun|ahora|en total)$/, "").trim();
      if (/^(?:los clientes|clientes|todos|nosotros|la gente)$/.test(who)) return { customer: null };
      if (who) return { customer: who };
    }
  }
  return DEBT_ALL.test(t) ? { customer: null } : null;
}

function expensesOf(t: string, ctx: RemContext, base: ExpenseQuery | null): ExpenseQuery {
  const range = parseRange(t, ctx.now) ?? base?.range ?? parseRange("este mes", ctx.now)!;
  const status = /\bvencid/.test(t) ? "overdue" : /\b(?:pendientes?|por pagar|sin pagar|debemos pagar)\b/.test(t) ? "open" : base && !parseRange(t, ctx.now) ? base.status : "all";
  return { range, status };
}

function draftOf(rest: string): ExpenseDraft {
  const money = moneyIn(rest);
  let words = money ? [...money.words.slice(0, money.start), ...money.words.slice(money.end)] : rest.split(" ");
  words = words.filter(Boolean);
  let detail = words.join(" ").replace(/\b(?:pesos|por favor)\b/g, " ").replace(/\s+/g, " ").trim();
  for (let k = 0; k < 3; k++) detail = detail.replace(/^(?:de|en|por|para|del|la|el|los|las|un|una|que fue|que es|valor|por valor)\s+/, "").replace(/\s+(?:de|en|por|para)$/, "");
  return { amount: money?.value ?? null, detail: detail.slice(0, 80) };
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
    if (ctx.topic?.kind === "expenses") {
      const f = t.match(FOLLOW);
      const rest = f ? f[1] : t;
      if (parseRange(rest, ctx.now) && (f || rest.split(" ").length <= 4) && !HARD_NAV.test(rest) && !SALES_WORD.test(rest)) {
        return { intent: { kind: "expenses", q: expensesOf(rest, ctx, ctx.topic.q) }, confidence: 0.85, provider: this.id, why: "seguimiento de gastos" };
      }
    }
    if (ctx.topic?.kind === "module") {
      const f = t.match(/^y (?:como|que pasos)\b.*$/);
      if (f) {
        const m = MODULES.find((x) => x.id === (ctx.topic as { module: string }).module);
        if (m) return { intent: { kind: "howto", module: m, howto: m.howto?.[0] ?? null, available: available(m, ctx.links), why: unavailable(m, ctx) }, confidence: 0.7, provider: this.id, why: "seguimiento de módulo" };
      }
    }

    if (CAPS.test(t)) return { intent: { kind: "capabilities" }, confidence: 1, provider: this.id, why: "qué sabe hacer" };

    // «Registra un gasto de 50 mil en arriendo».
    const ed = t.match(EXPENSE_DO);
    if (ed && !/^(?:cuanto|como|que|cual)/.test(t)) {
      return { intent: { kind: "draft_expense", draft: draftOf(ed[1]) }, confidence: 0.85, provider: this.id, why: "llenar gasto" };
    }

    const stock = HARD_NAV.test(t) ? null : stockOf(t);
    if (stock) return { intent: { kind: "stock", q: { product: stock.product } }, confidence: stock.loose ? 0.65 : 0.85, provider: this.id, why: stock.loose ? "existencias (suelta)" : "existencias" };

    const howto = HOWTO.test(t) && !HOW_IS.test(t);
    const debt = HARD_NAV.test(t) || howto || EXPLAIN.test(t) ? null : debtOf(t);
    if (debt) return { intent: { kind: "debts", q: debt }, confidence: 0.8, provider: this.id, why: "cartera" };

    if (EXPENSE_WORD.test(t) && EXPENSE_ASK.test(t) && !HARD_NAV.test(t) && !howto && !EXPLAIN.test(t)) {
      return { intent: { kind: "expenses", q: expensesOf(t, ctx, null) }, confidence: 0.85, provider: this.id, why: "consulta de gastos" };
    }

    // Ventas: «¿cuánto vendimos hoy?», «muéstrame las ventas de ayer», «lo más vendido». No: «quiero hacer una venta».
    if (SALES_WORD.test(t) && SALES_ASK.test(t) && !SALES_DO.test(t) && !HARD_NAV.test(t)) {
      return { intent: { kind: "sales", q: salesOf(t, ctx, null) }, confidence: 0.85, provider: this.id, why: "consulta de ventas" };
    }

    const hm = t.match(HOWTO);
    if (hm && !HOW_IS.test(t)) {
      const h = howtoFor(hm[1]);
      if (h) return { intent: { kind: "howto", module: h.module, howto: h.howto, available: available(h.module, ctx.links), why: unavailable(h.module, ctx) }, confidence: conf(h.score + 2), provider: this.id, why: `cómo: ${h.howto.id}` };
      const m = moduleFor(hm[1].replace(HOWTO_VERBS, " ").replace(/\s+/g, " ").trim(), ctx);
      if (m && "choose" in m) return { intent: { kind: "choose", ask: "howto", options: m.choose }, confidence: 0.5, provider: this.id, why: "ambiguo" };
      if (m) return { intent: { kind: "howto", module: m.pick, howto: null, available: available(m.pick, ctx.links), why: unavailable(m.pick, ctx) }, confidence: m.confidence, provider: this.id, why: "cómo: sin pasos" };
      return null;
    }

    const em = t.match(EXPLAIN);
    if (em) {
      const m = moduleFor(em[1], ctx);
      if (m && "choose" in m) return { intent: { kind: "choose", ask: "explain", options: m.choose }, confidence: 0.5, provider: this.id, why: "ambiguo" };
      if (m) return { intent: { kind: "explain", module: m.pick, available: available(m.pick, ctx.links), why: unavailable(m.pick, ctx) }, confidence: m.confidence, provider: this.id, why: "explicar" };
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
