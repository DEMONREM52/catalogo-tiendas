/**
 * El «cerebro» de REM para lo que no es de una pantalla: entiende (understand.ts), revisa y ejecuta (actions.ts)
 * y arma la respuesta (respond.ts). Recuerda lo justo de la conversación: de qué se hablaba, qué ofreció
 * («¿Te la abro?») y entre qué opciones preguntó. Ese recuerdo nunca da permisos: cada respuesta vuelve a mirar
 * la lista de lo que la persona puede abrir y lo que puede consultar, que se actualiza si le cambian los permisos.
 */

import { normalize } from "@/lib/voice/spanish";
import { runAction, type ActionEnv } from "./actions";
import { capabilitiesAnswer, chooseAnswer, createAnswer, explainAnswer, howtoAnswer, type Answer, type Offer } from "./respond";
import { CONFIDENT, resolveChoice, understand, type RemContext, type Topic, type UnderstandingProvider, localRules } from "./understand";
import { moduleOfPath, type ModuleInfo } from "./modules";

export type BrainState = { topic: Topic | null; offer: Offer | null; choices: Answer["choices"] | null };
export const emptyBrain = (): BrainState => ({ topic: null, offer: null, choices: null });

export type Thought = Answer & { topic?: Topic | null };

const YES = /^(?:(?:oye )?(?:rem|ren) )?(?:si|claro|dale|de una|hagale|por favor|abrela|abrelo|abrela por favor|abre|hazlo|ok|okey|listo|bueno|va|vale|si por favor|si senor|si senora|si claro|si dale|si abrela|si abrelo|sii+)$/;
const NO = /^(?:(?:oye )?(?:rem|ren) )?(?:no|nop|no gracias|todavia no|aun no|despues|mejor no|asi esta bien|dejalo|no por ahora|no hace falta)$/;

export type ThinkOptions = {
  /** Hay una pantalla con voz atendiendo (traslado, venta…): solo responde preguntas, sin abrir nada. */
  inScreen?: boolean;
  providers?: UnderstandingProvider[];
};

/**
 * Lo que REM responde a una frase, o null si no es para este cerebro (entonces sigue el camino de siempre:
 * pantallas con voz y abrir páginas). Cambia `state` (tema, oferta, opciones).
 */
export async function think(text: string, ctx: RemContext, env: ActionEnv | null, state: BrainState, opts: ThinkOptions = {}): Promise<Thought | null> {
  const t = normalize(text);

  // ¿Contesta lo que REM ofreció o preguntó?
  if (state.offer && !opts.inScreen) {
    const offer = state.offer;
    if (YES.test(t)) { state.offer = null; return { reply: { say: `Listo: ${offer.label}.`, end: true }, go: offer }; }
    if (NO.test(t)) { state.offer = null; return { reply: { say: "Bueno. ¿Algo más?" } }; }
    state.offer = null;
  }
  if (state.choices) {
    const choices = state.choices;
    state.choices = null;
    const picked = resolveChoice(text, choices);
    if (picked) return keep(picked.then(), state, ctx, opts);
    if (NO.test(t)) return { reply: { say: "Bueno. ¿Algo más?" } };
  }

  const u = understand(text, { ...ctx, topic: state.topic }, opts.providers ?? [localRules]);
  if (!u) return null;
  const i = u.intent;
  if (u.confidence < CONFIDENT && i.kind !== "choose") return null;
  if (opts.inScreen && (i.kind === "create" || i.kind === "choose")) return null;
  const isAvailable = (m: ModuleInfo) => ctx.links.some((l) => moduleOfPath(l.href)?.id === m.id);

  switch (i.kind) {
    case "sales": {
      if (!env) return { reply: { say: "Para consultar ventas tengo que estar dentro de una tienda." } };
      const r = await runAction("sales.summary", i.q, env);
      state.topic = r.topic ?? state.topic;
      return { reply: r.reply, topic: state.topic };
    }
    case "explain":
      state.topic = { kind: "module", module: i.module.id };
      return keep(explainAnswer(i.module, i.available, ctx.links), state, ctx, opts);
    case "howto":
      state.topic = { kind: "module", module: i.module.id };
      return keep(howtoAnswer(i.module, i.howto, i.available, ctx.links), state, ctx, opts);
    case "create":
      return keep(createAnswer(i.options, i.hidden, i.module), state, ctx, opts);
    case "capabilities":
      return { reply: capabilitiesAnswer(env?.can ?? (() => false)).reply };
    case "choose":
      return keep(chooseAnswer(i.ask, i.options, ctx.links, isAvailable), state, ctx, opts);
  }
}

/** Guarda lo ofrecido o preguntado para el siguiente turno. En una pantalla con voz no ofrece abrir nada. */
function keep(a: Answer, state: BrainState, _ctx: RemContext, opts: ThinkOptions): Thought {
  if (opts.inScreen) {
    const say = a.reply.say.replace(/\s*¿(?:Te (?:la|lo) abro|Quieres que (?:la|lo) abra|Te llevo|Lo abrimos)\?$/, "");
    return { reply: { say: `${say} ¿Seguimos?`, show: a.reply.show?.replace(/\n¿[^\n]*\?$/, "") } };
  }
  state.offer = a.offer ?? null;
  state.choices = a.choices ?? null;
  return a;
}
