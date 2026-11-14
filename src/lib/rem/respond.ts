/**
 * Cómo responde REM a lo que no es de una pantalla: explicar, cómo se hace, crear aquí, qué sabe hacer.
 * Plantillas con variaciones (para no sonar igual siempre), armadas con datos del catálogo. Nada inventado:
 * si no hay pasos verificados, explica para qué sirve y ofrece abrirlo.
 */

import type { RemReply } from "@/lib/voice/rem";
import type { NavLink } from "@/lib/voice/navigate";
import { CAPABILITIES, VOICE_SCREENS, type Capability } from "./catalog";
import type { HowTo, ModuleInfo } from "./modules";
import type { ClientDraft, ExpenseDraft, Unavailable } from "./understand";

/** Lo que REM ofreció hacer enseguida («¿Te lo abro?»): con «sí», se hace. */
export type Offer = { href: string; label: string };
export type Answer = {
  reply: RemReply;
  /** Ofrecido: se hace si dice «sí». */
  offer?: Offer;
  /** Se abre ya (solo abrir una página o un formulario vacío: riesgo bajo o medio, nada se guarda). */
  go?: Offer;
  /** Preguntó «¿cuál?»: lo siguiente que diga elige una. */
  choices?: Array<{ name: string; then: () => Answer | Promise<Answer> }>;
};

let turn = 0;
/** Una de las variantes, rotando (no al azar: así las pruebas son estables). */
export function vary(variants: string[]): string {
  turn = (turn + 1) % 9973;
  return variants[turn % variants.length];
}

const NO_ACCESS = "Tu usuario no tiene acceso a esa sección. Si la necesitas, pídesela al administrador de la tienda.";
const NO_PLAN = "El plan de la tienda no incluye esa sección. El dueño la puede activar mejorando el plan en Mi plan.";
const blocked = (why: Unavailable | undefined) => (why === "plan" ? NO_PLAN : NO_ACCESS);
const ORDER = ["Primero", "Luego", "Después", "Después", "Por último"];

/** El enlace de la sección en la lista de la persona (si no está, no se ofrece abrirla). */
function linkFor(links: NavLink[], href: string | undefined, path: string): NavLink | null {
  return (href ? links.find((l) => l.href === href) : null)
    ?? links.find((l) => l.href === path)
    ?? links.find((l) => l.href.split("?")[0] === path)
    ?? null;
}

export function explainAnswer(m: ModuleInfo, available: boolean, links: NavLink[], why?: Unavailable): Answer {
  if (!available) return { reply: { say: `${m.name}: ${m.about} ${blocked(why)}` } };
  const link = linkFor(links, undefined, m.path);
  const ask = link ? ` ${vary(["¿Te la abro?", "¿Quieres que la abra?", "¿Te llevo?"])}` : "";
  return { reply: { say: `${m.about}${ask}`, show: `${m.name}\n${m.about}${ask ? `\n${ask.trim()}` : ""}` }, offer: link ? { href: link.href, label: link.label } : undefined };
}

export function howtoAnswer(m: ModuleInfo, h: HowTo | null, available: boolean, links: NavLink[], why?: Unavailable): Answer {
  if (!available) return { reply: { say: `Eso se hace en ${m.name}. ${blocked(why)}` } };
  const link = linkFor(links, h?.href, m.path);
  const ask = link ? ` ${vary(["¿Te lo abro?", "¿Quieres que lo abra?", "¿Lo abrimos?"])}` : "";
  const offer = link ? { href: link.href, label: link.label } : undefined;
  if (h && h.verified && h.steps.length) {
    const said = h.steps.map((s, i) => `${i === h.steps.length - 1 && i > 0 ? ORDER[4] : ORDER[Math.min(i, 3)]}: ${s.charAt(0).toLowerCase()}${s.slice(1)}`).join(" ");
    return {
      reply: {
        say: `Para ${h.goal}: ${said}${h.voice ? ` ${h.voice}` : ""}${ask}`,
        show: `Para ${h.goal}:\n${h.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}${h.voice ? `\n🎙️ ${h.voice}` : ""}${ask ? `\n${ask.trim()}` : ""}`,
      },
      offer,
    };
  }
  if (h?.voice) return { reply: { say: `${h.voice}${ask}` }, offer };
  // Sin pasos revisados: no los invento.
  return { reply: { say: `Eso se hace en ${m.name}. ${m.about} Los pasos exactos todavía no me los sé.${ask}` }, offer };
}

export function createAnswer(options: Capability[], hidden: number, m: ModuleInfo | null): Answer {
  if (!options.length) {
    return { reply: { say: hidden
      ? "Aquí hay cosas para crear, pero tu usuario no tiene permiso para crearlas. Pídeselo al administrador."
      : m ? `En ${m.name} no tengo un formulario para crear. Dime qué quieres crear: por ejemplo, un producto o un gasto.` : "¿Qué quieres crear? Por ejemplo: un producto, un gasto o un traslado." } };
  }
  if (options.length === 1) {
    const c = options[0];
    return { reply: { say: `Te abro ${c.label.toLowerCase()}. Lo llenas y lo guardas tú; yo no guardo nada sin que lo veas.`, end: true }, go: { href: c.href, label: c.label } };
  }
  const few = options.slice(0, 4);
  return {
    reply: { say: `¿Qué quieres crear? ${few.map((c) => c.label).join(", ")}.` },
    choices: few.map((c) => ({ name: c.label, then: () => createAnswer([c], 0, m) })),
  };
}

const FORM_SAY: Record<string, string> = { "form:gasto-por-voz": "un gasto", "form:tercero-por-voz": "un cliente o proveedor", "form:producto-por-voz": "un producto" };

/** «¿Qué sabes hacer?», según lo que esta persona puede usar. */
/** Lo que se le puede preguntar, en pocas palabras (para «¿qué sabes hacer?»). Sale del catálogo: si se agrega una consulta, aparece. */
const ASK_SAY: Record<string, string> = {
  "query:sales": "las ventas", "query:stock": "las existencias", "query:expenses": "los gastos", "query:debts": "la cartera",
  "query:profit": "la ganancia", "query:tasks": "tus pendientes", "query:payables": "lo que se les debe a los proveedores",
  "query:cash": "la caja", "query:goals": "las metas",
};

/** «¿Qué sabes hacer?», según lo que esta persona puede usar. */
export function capabilitiesAnswer(can: (p: string) => boolean): Answer {
  const ok = (perms: string[]) => !perms.length || perms.some((p) => can(p));
  const screens = VOICE_SCREENS.filter((v) => ok(v.perms)).map((v) => v.name.toLowerCase());
  const queries = CAPABILITIES.filter((c) => c.kind === "query" && c.status === "ready" && ok(c.perms));
  const forms = CAPABILITIES.filter((c) => c.id.endsWith("-por-voz") && ok(c.perms));
  const asks = queries.map((q) => ASK_SAY[q.id] ?? q.label.toLowerCase());
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}` : xs[0] ?? "");
  const parts = [
    "Te explico para qué sirve cualquier sección y cómo se usa",
    "abro la sección que necesites",
    asks.length ? `te digo ${list(asks)}` : null,
    forms.length ? `te lleno hablando ${list(forms.map((c) => FORM_SAY[c.id] ?? c.label.toLowerCase()))}, para que tú lo guardes` : null,
    screens.length ? `y trabajo contigo por voz en ${list(screens)}` : null,
  ].filter(Boolean);
  return { reply: {
    say: `${parts.join(", ")}. Lo que guarda o cambia algo siempre te lo pregunto antes. ¿Qué hacemos?`,
    show: [
      "Puedo:",
      "• Explicarte cualquier sección y cómo se usa («¿para qué sirve la rentabilidad?»)",
      "• Abrir secciones («abre los gastos»)",
      ...queries.map((q) => `• ${q.label}: «${q.examples[0] ?? ""}»`),
      ...forms.map((c) => `• ${c.label}: «${c.examples[0] ?? ""}»`),
      screens.length ? `• Trabajar por voz: ${screens.join(", ")}` : "",
      "• Crear según donde estés («crea uno nuevo»)",
      "Lo que guarda o cambia algo, siempre te lo pregunto antes.",
    ].filter(Boolean).join("\n"),
  } };
}

export function chooseAnswer(ask: "explain" | "howto", options: ModuleInfo[], links: NavLink[], available: (m: ModuleInfo) => boolean, why: (m: ModuleInfo) => Unavailable = () => null): Answer {
  return {
    reply: { say: `¿Te refieres a ${options.map((o) => o.name).join(" o a ")}?` },
    choices: options.map((m) => ({ name: m.name, then: () => (ask === "explain" ? explainAnswer(m, available(m), links, why(m)) : howtoAnswer(m, m.howto?.[0] ?? null, available(m), links, why(m))) })),
  };
}

/** «Registra un gasto de 50 mil en arriendo»: abre «Nuevo gasto» con el valor y el detalle. Guarda la persona. */
export const EXPENSE_FORM = "/dashboard/gastos?tab=expenses&nuevo=gasto";
export function draftExpenseAnswer(d: ExpenseDraft, links: NavLink[]): Answer {
  if (!links.some((l) => l.href === EXPENSE_FORM)) return { reply: { say: "Tu usuario no tiene permiso para registrar gastos. Pídeselo al administrador de la tienda." } };
  const url = new URL(EXPENSE_FORM, "https://x");
  if (d.amount) url.searchParams.set("valor", String(d.amount));
  if (d.detail) url.searchParams.set("detalle", d.detail);
  const value = d.amount ? ` de ${d.amount.toLocaleString("es-CO")} pesos` : "";
  const detail = d.detail ? ` en «${d.detail}»` : "";
  return {
    reply: { say: `Te abro un gasto${value}${detail}. Revisa la categoría y lo demás, y guárdalo tú.`, end: true },
    go: { href: url.pathname + url.search, label: "Nuevo gasto" },
  };
}

/** «Crea un cliente que se llama Juan Pérez con cédula…»: abre «Nuevo tercero» lleno. Guarda la persona. */
export const CLIENT_FORM = "/dashboard/clientes";
export function draftClientAnswer(d: ClientDraft, links: NavLink[]): Answer {
  if (!links.some((l) => l.href === CLIENT_FORM && l.action)) return { reply: { say: "Tu usuario no tiene permiso para crear clientes o proveedores. Pídeselo al administrador de la tienda." } };
  const url = new URL(CLIENT_FORM, "https://x");
  url.searchParams.set("nuevo", "tercero");
  url.searchParams.set("tipo", d.kind);
  if (d.name) url.searchParams.set("nombre", d.name);
  if (d.document) url.searchParams.set("documento", d.document);
  if (d.mobile) url.searchParams.set("celular", d.mobile);
  if (d.nit) url.searchParams.set("nit", "1");
  const who = d.kind === "supplier" ? "proveedor" : "cliente";
  const extra = [d.document ? `${d.nit ? "NIT" : "documento"} ${d.document}` : null, d.mobile ? `celular ${d.mobile}` : null].filter(Boolean).join(" y ");
  return {
    reply: { say: `Te abro un ${who} nuevo${d.name ? `, ${d.name}` : ""}${extra ? `, con ${extra}` : ""}. Revisa los datos y guárdalo tú.`, end: true },
    go: { href: url.pathname + url.search, label: `Nuevo ${who}` },
  };
}

/** «Crea un producto que se llama zapatera negra»: abre «Nuevo producto» con el nombre. Guarda la persona. */
export const PRODUCT_FORM = "/dashboard/products/crear";
export function draftProductAnswer(name: string, links: NavLink[]): Answer {
  if (!links.some((l) => l.href === PRODUCT_FORM)) return { reply: { say: "Tu usuario no tiene permiso para crear productos. Pídeselo al administrador de la tienda." } };
  const href = name ? `${PRODUCT_FORM}?nombre=${encodeURIComponent(name)}` : PRODUCT_FORM;
  return {
    reply: { say: `Te abro un producto nuevo${name ? `: ${name}` : ""}. Completa lo demás y créalo tú.`, end: true },
    go: { href, label: "Nuevo producto" },
  };
}
