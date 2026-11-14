/**
 * El «cerebro» de REM para lo que no es de una pantalla: entiende (understand.ts), revisa y ejecuta (actions.ts)
 * y arma la respuesta (respond.ts). Recuerda lo justo de la conversación: de qué se hablaba, qué ofreció
 * («¿Te la abro?») y entre qué opciones preguntó. Ese recuerdo nunca da permisos: cada respuesta vuelve a mirar
 * la lista de lo que la persona puede abrir y lo que puede consultar, que se actualiza si le cambian los permisos.
 */

import { normalize } from "@/lib/voice/spanish";
import { runAction, type ActionEnv, type ActionResult } from "./actions";
import { capabilitiesAnswer, chooseAnswer, createAnswer, draftClientAnswer, draftExpenseAnswer, draftProductAnswer, explainAnswer, howtoAnswer, type Answer, type Offer } from "./respond";
import { CONFIDENT, resolveChoice, understand, unavailable, type RemContext, type Topic, type UnderstandingProvider, localRules } from "./understand";
import { moduleOfPath, type ModuleInfo } from "./modules";

export type BrainState = { topic: Topic | null; offer: Offer | null; choices: Answer["choices"] | null };
export const emptyBrain = (): BrainState => ({ topic: null, offer: null, choices: null });

export type Thought = Answer & { topic?: Topic | null };

const YES = /^(?:(?:oye )?(?:rem|ren) )?(?:si|claro|dale|de una|hagale|por favor|abrela|abrelo|abrelos|abrelas|abrela por favor|abre|hazlo|ok|okey|listo|bueno|va|vale|si por favor|si senor|si senora|si claro|si dale|si abrela|si abrelo|si abrelos|si abrelas|si muestramelos|muestramelos|si muestrame|si llevame|llevame|sii+)$/;
const NO = /^(?:(?:oye )?(?:rem|ren) )?(?:no|nop|no gracias|todavia no|aun no|despues|mejor no|asi esta bien|dejalo|no por ahora|no hace falta)$/;

export type ThinkOptions = {
  /** Hay una pantalla con voz atendiendo (traslado, venta…): solo responde preguntas, sin abrir nada. */
  inScreen?: boolean;
  providers?: UnderstandingProvider[];
};

/** Lo que devolvió una acción, como respuesta: solo ofrece abrir lo que la persona puede abrir. */
function fromAction(r: ActionResult, ctx: RemContext, env: ActionEnv): Answer {
  const offer = r.offer && ctx.links.some((l) => l.href === r.offer!.href) ? r.offer : undefined;
  const say = !offer && r.offer ? r.reply.say.replace(/\s*¿(?:Te (?:lo|la|los|las) (?:abro|muestro)|Te abro [^?]*)\?$/, "") : r.reply.say;
  const show = !offer && r.offer ? r.reply.show?.replace(/\n¿[^\n]*\?$/, "") : r.reply.show;
  return {
    reply: { ...r.reply, say, show },
    offer,
    choices: r.choices?.map((c) => ({ name: c.name, then: async () => fromAction(await runAction(c.action, c.params, env), ctx, env) })),
  };
}

/**
 * Lo que REM responde a una frase, o null si no es para este cerebro (entonces sigue el camino de siempre:
 * pantallas con voz y abrir páginas). Cambia `state` (tema, oferta, opciones).
 */
export async function think(text: string, ctx: RemContext, env: ActionEnv | null, state: BrainState, opts: ThinkOptions = {}): Promise<Thought | null> {
  const t = normalize(text);

  // ¿Contesta lo que REM ofreció o preguntó?
  if (state.offer && !opts.inScreen) {
    const offer = state.offer;
    state.offer = null;
    // Se vuelve a mirar: si en el camino le quitaron el permiso, ya no se abre.
    if (YES.test(t)) return ctx.links.some((l) => l.href === offer.href)
      ? { reply: { say: `Listo: ${offer.label}.`, end: true }, go: offer }
      : { reply: { say: "Eso ya no lo puedes abrir con tu usuario." } };
    if (NO.test(t)) return { reply: { say: "Bueno. ¿Algo más?" } };
  }
  if (state.choices) {
    const choices = state.choices;
    state.choices = null;
    const picked = resolveChoice(text, choices);
    if (picked) return keep(await picked.then(), state, opts);
    if (NO.test(t)) return { reply: { say: "Bueno. ¿Algo más?" } };
  }

  const u = understand(text, { ...ctx, topic: state.topic }, opts.providers ?? [localRules]);
  if (!u) return null;
  const i = u.intent;
  if (u.confidence < CONFIDENT && i.kind !== "choose") return null;
  if (opts.inScreen && (i.kind === "create" || i.kind === "choose" || i.kind === "draft_expense" || i.kind === "draft_client" || i.kind === "draft_product")) return null;
  // En medio de un traslado o una venta, «hay termos» o «quedan cinco» son de la pantalla: solo la pregunta completa.
  if (opts.inScreen && u.confidence < 0.8) return null;
  const isAvailable = (m: ModuleInfo) => ctx.links.some((l) => moduleOfPath(l.href)?.id === m.id);
  const noStore = { reply: { say: "Para consultar eso tengo que estar dentro de una tienda." } };

  const act = async (id: string, params: unknown, topic: Topic | null): Promise<Thought> => {
    if (!env) return noStore;
    const r = await runAction(id, params, env);
    state.topic = r.topic ?? topic ?? state.topic;
    return { ...keep(fromAction(r, ctx, env), state, opts), topic: state.topic };
  };

  switch (i.kind) {
    case "sales": return act("sales.summary", i.q, { kind: "sales", q: i.q });
    case "stock": return act("stock.product", i.q, { kind: "stock", q: i.q });
    case "expenses": return act("expenses.summary", i.q, { kind: "expenses", q: i.q });
    case "debts": return act("debts.summary", i.q, { kind: "debts", q: i.q });
    case "draft_expense": return keep(draftExpenseAnswer(i.draft, ctx.links), state, opts);
    case "draft_client": return keep(draftClientAnswer(i.draft, ctx.links), state, opts);
    case "draft_product": return keep(draftProductAnswer(i.name, ctx.links), state, opts);
    case "profit": return act("profit.summary", i.q, { kind: "profit", q: i.q });
    case "payables": return act("payables.summary", i.q, { kind: "payables", q: i.q });
    case "tasks": return act("tasks.mine", {}, null);
    case "cash": return act("cash.status", {}, null);
    case "goals": return act("goals.progress", i.q, null);
    case "explain":
      state.topic = { kind: "module", module: i.module.id };
      return keep(explainAnswer(i.module, i.available, ctx.links, i.why), state, opts);
    case "howto":
      state.topic = { kind: "module", module: i.module.id };
      return keep(howtoAnswer(i.module, i.howto, i.available, ctx.links, i.why), state, opts);
    case "create":
      return keep(createAnswer(i.options, i.hidden, i.module), state, opts);
    case "capabilities":
      return { reply: capabilitiesAnswer(env?.can ?? (() => false)).reply };
    case "choose":
      return keep(chooseAnswer(i.ask, i.options, ctx.links, isAvailable, (m) => unavailable(m, ctx)), state, opts);
  }
}

/** Guarda lo ofrecido o preguntado para el siguiente turno. En una pantalla con voz no ofrece abrir nada. */
function keep(a: Answer, state: BrainState, opts: ThinkOptions): Thought {
  if (opts.inScreen) {
    const say = a.reply.say.replace(/\s*¿(?:Te (?:la|lo|los|las) (?:abro|muestro)|Quieres que (?:la|lo) abra|Te llevo|Lo abrimos|Te abro [^?]*)\?$/, "");
    // Elegir entre varios productos sí se puede en medio de algo (no abre nada).
    state.choices = a.choices ?? null;
    return { reply: { say: a.choices ? say : `${say} ¿Seguimos?`, show: a.reply.show?.replace(/\n¿[^\n]*\?$/, "") } };
  }
  state.offer = a.offer ?? null;
  state.choices = a.choices ?? null;
  return a;
}
