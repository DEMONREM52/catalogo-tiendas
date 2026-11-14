"use client";

/**
 * 🎙️ REM: asistente de voz del panel. Uno solo, siempre el mismo: una esfera de cristal que flota sobre todo
 * (src/components/rem/RemOrb.tsx) y reacciona al escuchar y al hablar.
 *   · Se enciende con el botón REM del encabezado; queda encendido (también al recargar) hasta «Apágate» o ⏻.
 *   · Se le llama diciendo «Rem…» (o «Oye REM…»), con el botón REM o con 🎙️ en la conversación.
 *   · Tocar la esfera abre o cierra la conversación (y si está hablando, lo calla y te escucha).
 *   · Mientras habla se le puede interrumpir hablando (computador).
 *   · Sabe: traslados, conteos, pedidos internos, compras y POS (cada pantalla se registra en src/lib/voice/rem.ts),
 *     y abrir cualquier página que la persona pueda abrir («abre los gastos»: src/lib/voice/navigate.ts).
 *   · Explica módulos, dice cómo se hacen las cosas, consulta ventas y entiende «crea uno nuevo» según la página
 *     (src/lib/rem: catálogo, comprensión, acciones y respuestas; ver docs/REM_ARQUITECTURA.md).
 *   · Aprende de los errores, por persona y tienda: productos (src/lib/voice/fuzzy.ts) y frases (navigate.ts),
 *     guardados con src/lib/rem/memory.ts. Lo aprendido nunca da permisos.
 * Sin IA de pago: todo corre en el navegador.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { announceUrlChange } from "@/lib/url-intent";
import { beep, capture, duplexCapable, duplexPref, fullDuplex, isAppleMobile, isEchoOf, isInstalledApp, listen, setDuplexPref, speak, startMicMeter, startWake, stopListening, stopSpeaking, unlockAudio, voiceSupported, VoiceError, wakeRest, withoutName } from "@/lib/voice/speech";
import { onRemCall, onRemHandlerChange, onRemResume, remHandler, waitForRemHandler, type RemHandler, type RemReply } from "@/lib/voice/rem";
import { normalize } from "@/lib/voice/spanish";
import { forgetLearnedProducts, forgetPhraseKey, phraseKey, learnedCount, learnedPhrase, learnedProductsCount, learnPhrase, listPhrases, navRequest, navTarget, readLog, smallTalk, writeLog, type LogTurn, type NavLink } from "@/lib/voice/navigate";
import { modulePerms, VOICE_SCREENS, type VoiceScreen } from "@/lib/rem/catalog";
import { aliasFor, forgetAlias, learnAlias, listAliases, pickSuggestion, suggestFor, suggestionReply, type Suggestion } from "@/lib/rem/suggest";
import { dismissTeamMiss, forgetStore, loadStorePhrases, reportMiss, reviewMisses, teachStore, type TeamMiss } from "@/lib/rem/team";
import { emptyBrain, think, type BrainState, type Thought } from "@/lib/rem/brain";
import { capabilitiesAnswer } from "@/lib/rem/respond";
import { forgetEverything, listStorePhrases, readMisses, recordMiss, resolveMiss, setRemScope } from "@/lib/rem/memory";
import type { ActionEnv } from "@/lib/rem/actions";
import type { RemContext } from "@/lib/rem/understand";
import { supabaseBrowser } from "@/lib/supabase/client";
import { RemOrb, type OrbPlace } from "./RemOrb";
import { searchRequest } from "@/lib/voice/products-voice";
import { applyPronunciations, PRONUNCIATIONS, pronunciationChoice, setPronunciationChoice } from "@/lib/voice/pronunciation";

type Phase = "idle" | "listening" | "thinking" | "speaking";

const STOP = /^(?:(?:oye )?rem )?(?:para|parar|detente|cancela|cancelar|chao|adios|salir|gracias|nada|eso es todo|ya no|ya esta|olvidalo)$/;
const POWER_OFF = /^(?:(?:oye )?rem )?(?:apagate|apaga(?:te)?(?: rem)?|desactivate|vete a dormir|a dormir|duermete)$/;
const HELP = /^(?:(?:oye )?rem )?(?:que (?:puedes|sabes) hacer|ayuda|ayudame|que te puedo decir|como funcionas)$/;
const ON_KEY = "remhub:rem-on";
const WAKE_KEY = "remhub:rem-wake";

/** A dónde lleva REM según lo que se dice (si la pantalla no está abierta): el catálogo (src/lib/rem/catalog.ts). */
const INTENTS = VOICE_SCREENS;
type Intent = VoiceScreen;

const MOVE = /^(?:(?:oye )?rem )?(?:quiero|vamos a|voy a|abre|abrir|ir a|llevame a)\b/;

function readFlag(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === "1"; } catch { return fallback; }
}
function writeFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* sin almacenamiento */ }
}

export function RemButton({ can, links = [], userId = null, storeId = null, canByRole, canTeach = false }: {
  can: (permission: string) => boolean;
  links?: NavLink[];
  userId?: string | null;
  storeId?: string | null;
  /** Permisos sin contar el plan: si con esto sí y con `can` no, lo frena el plan. */
  canByRole?: (permission: string) => boolean;
  /** Dueño o administrador: le enseña a REM para toda la tienda (la base lo vuelve a revisar). */
  canTeach?: boolean;
}) {
  const supported = useSyncExternalStore(() => () => {}, voiceSupported, () => false);
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [panel, setPanel] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<LogTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [wakeOn, setWakeOn] = useState(false);
  const [visible, setVisible] = useState(true);
  const [lastHeard, setLastHeard] = useState("");
  const [wakeBlocked, setWakeBlocked] = useState(false);
  const [duplexOn, setDuplexOn] = useState(true);
  const [place, setPlace] = useState<OrbPlace | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [learned, setLearned] = useState(0);
  // Cómo dice «REM» en este equipo (cada teléfono trae voces distintas): se oyen las opciones y se elige.
  const [nameSay, setNameSay] = useState("");
  const session = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<(initial?: RemReply, first?: string[]) => Promise<void>>(async () => {});
  const callRef = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>("idle");
  const captionTimer = useRef(0);
  // La pantalla pedida tardó en abrir (o falta tocar «Nuevo pedido»): cuando aparezca, REM sigue solo.
  const pending = useRef<{ title: string; said: string[]; until: number } | null>(null);
  // De qué se venía hablando, qué ofreció («¿Te la abro?») y entre qué preguntó (src/lib/rem/brain.ts).
  const brain = useRef<BrainState>(emptyBrain());
  // Para «Lo que REM sabe de ti»: se vuelve a leer al cambiar algo.
  const [memTick, setMemTick] = useState(0);
  const [wipeAsk, setWipeAsk] = useState(false);
  // Dueño o administrador: lo que REM no le entendió al equipo (sin nombres) y las frases de la tienda.
  const [team, setTeam] = useState<{ rows: TeamMiss[]; error: string | null } | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setOn(readFlag(ON_KEY, false));
      // «Rem» para llamarlo: encendido en computador; en celular gasta batería y suena al reiniciar, se enciende a mano.
      setWakeOn(readFlag(WAKE_KEY, duplexCapable()));
      setDuplexOn(duplexPref());
      setNameSay(pronunciationChoice("rem"));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  // Lo guardado es de cada persona en cada tienda: al entrar (o cambiar de usuario) se lee lo suyo.
  useEffect(() => {
    setRemScope(userId, storeId);
    brain.current = emptyBrain();
    setTeam(null);
    const t = window.setTimeout(() => { setTurns(readLog()); setLearned(learnedCount()); setMemTick((n) => n + 1); }, 0);
    // Lo que la tienda le enseñó (si la migración 20261322 está corrida).
    if (storeId && userId) void loadStorePhrases(storeId).then(() => setMemTick((n) => n + 1));
    return () => window.clearTimeout(t);
  }, [userId, storeId]);
  useEffect(() => onRemHandlerChange(() => {
    const h = remHandler();
    setTitle(h?.title ?? null);
    setExamples(h?.examples ?? []);
    const p = pending.current;
    if (!h || !p || h.title !== p.title) return;
    pending.current = null;
    if (Date.now() > p.until || phaseRef.current !== "idle") return;
    void runRef.current(undefined, p.said);
  }), []);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // Botón 🎙️ REM dentro de una ventana (RemCallButton): igual que tocar el del encabezado.
  useEffect(() => onRemCall(() => callRef.current()), []);
  useEffect(() => { if (panel) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [turns, interim, panel]);
  useEffect(() => () => { session.current++; stopListening(); stopSpeaking(); }, []);
  // Después de elegir con la foto, la pantalla pide seguir: «Zapatera negra. ¿Cuántas?».
  useEffect(() => onRemResume((r) => { setOn(true); void runRef.current(r); }), []);
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  // «Rem…»: con REM encendido, en reposo y con la pestaña a la vista.
  useEffect(() => {
    if (!supported || !on || !wakeOn || !visible || phase !== "idle" || wakeBlocked) return;
    return startWake((rest) => {
      void runRef.current(undefined, rest ? [rest] : []);
    }, () => setWakeBlocked(true), (heard) => { if (heard) setLastHeard(heard); });
  }, [supported, on, wakeOn, visible, phase, wakeBlocked]);
  useEffect(() => {
    if (!wakeBlocked) return;
    const retry = () => setWakeBlocked(false);
    window.addEventListener("pointerdown", retry, { once: true });
    return () => window.removeEventListener("pointerdown", retry);
  }, [wakeBlocked]);
  // La esfera reacciona al micrófono mientras conversa (solo computador).
  const talking = phase !== "idle";
  useEffect(() => {
    if (!on || !talking) return;
    return startMicMeter();
  }, [on, talking]);
  // En reposo, el texto junto a la esfera se va solo.
  useEffect(() => {
    if (talking) return;
    const t = window.setTimeout(() => setCaption(null), 4000);
    return () => window.clearTimeout(t);
  }, [talking]);
  const onPlace = useCallback((p: OrbPlace) => setPlace(p), []);

  /** Texto junto a la esfera cuando la conversación está cerrada. */
  function flash(text: string, ms = 4500) {
    window.clearTimeout(captionTimer.current);
    setCaption(text);
    if (ms > 0) captionTimer.current = window.setTimeout(() => setCaption(null), ms);
  }

  const add = (who: LogTurn["who"], text: string) => setTurns((t) => {
    const last = t.at(-1);
    if (last && last.who === who && last.text === text && Date.now() - last.at < 8000) return t;
    const next = [...t, { who, text, at: Date.now() }].slice(-60);
    writeLog(next);
    return next;
  });

  function stop() {
    session.current++;
    stopListening();
    stopSpeaking();
    setPhase("idle");
    setInterim("");
  }

  function setPower(v: boolean) {
    writeFlag(ON_KEY, v);
    setOn(v);
    if (!v) { pending.current = null; stop(); setPanel(false); setCaption(null); }
  }

  /** Dice algo sin esperar respuesta. */
  async function say(id: number, r: RemReply) {
    if (session.current !== id) return;
    add("rem", r.show ?? r.say);
    flash(r.show ?? r.say, 0);
    setPhase("speaking");
    await speak(r.say);
  }

  function heard(id: number, alts: string[]): string[] | null {
    if (session.current !== id) return null;
    setInterim("");
    if (alts[0]) { add("you", alts[0]); flash(`«${alts[0]}»`, 2500); }
    // «Ren, quiero ir a productos» en medio de la conversación: el nombre sobra, se entiende el resto.
    return alts.map((a) => withoutName(a));
  }

  function failed(id: number, err: unknown): null {
    if (session.current !== id) return null;
    const msg = err instanceof VoiceError && err.code === "permission"
      ? (isAppleMobile()
        ? `En iPhone: Ajustes → General → Teclado → activa «Dictado»; y Ajustes → Safari → Micrófono → Permitir.${isInstalledApp() ? " Si aun así no escucha, abre RemHub en Safari (no desde el ícono): en algunos iPhone el dictado no funciona en apps instaladas." : ""}`
        : "Dale permiso al micrófono: toca el candado junto a la dirección → Micrófono → Permitir.")
      : err instanceof Error ? err.message : "No se pudo escuchar.";
    setError(msg);
    flash(msg, 8000);
    setPhase("idle");
    setInterim("");
    return null;
  }

  const onInterim = (id: number) => (t: string) => {
    if (session.current !== id) return;
    setInterim(t);
    window.clearTimeout(captionTimer.current);
    setCaption(`${t}…`);
  };

  /** Escucha una frase. null si se canceló la conversación. */
  async function hearOnce(id: number): Promise<string[] | null> {
    if (session.current !== id) return null;
    setPhase("listening");
    setInterim("");
    beep("listen");
    try {
      return heard(id, await listen({ onInterim: onInterim(id) }));
    } catch (err) {
      return failed(id, err);
    }
  }

  /**
   * Dice la respuesta y escucha la contestación. En computador escucha desde que empieza a hablar:
   * si la persona habla encima, REM se calla al instante y oye la frase completa (con pausas).
   * En celular escucha al terminar (tocar la esfera lo calla antes). null si se canceló la conversación.
   */
  async function turn(id: number, r: RemReply): Promise<string[] | null> {
    if (!fullDuplex()) { await say(id, r); return hearOnce(id); }
    if (session.current !== id) return null;
    add("rem", r.show ?? r.say);
    flash(r.show ?? r.say, 0);
    setPhase("speaking");
    setInterim("");
    const cap = capture({
      echo: r.say,
      onUserStart: () => { if (session.current !== id) return; stopSpeaking(); setPhase("listening"); },
      onInterim: onInterim(id),
    });
    await speak(r.say);
    if (session.current !== id) { cap.cancel(); return null; }
    if (!cap.started()) beep("listen");
    setPhase("listening");
    cap.listening();
    let alts: string[];
    try {
      alts = await cap.result;
    } catch (err) {
      return failed(id, err);
    }
    if (session.current !== id) return null;
    // Segundo filtro: si lo que «oyó» es casi todo lo que REM acaba de decir, era su propia voz: escucha otra vez.
    if (alts[0] && isEchoOf(alts[0], r.say)) { setInterim(""); return hearOnce(id); }
    return heard(id, alts);
  }

  function go(href: string) {
    const target = new URL(href, window.location.origin);
    if (target.pathname === window.location.pathname) {
      window.history.pushState(null, "", target.pathname + target.search);
      announceUrlChange();
      window.dispatchEvent(new Event("remhub-tab-change"));
    } else router.push(href);
  }

  /** Qué pantalla con voz pide lo dicho (por las frases conocidas o por una frase que aprendió). */
  function intentOf(text: string): Intent | null {
    const t = normalize(text);
    // «Búscame la cámara sc30a» va a Productos aunque el nombre del producto diga «compra» o «venta».
    if (searchRequest(t) !== null) return INTENTS.find((i) => i.title === "Productos") ?? null;
    const byWords = INTENTS.find((i) => i.match.test(t));
    if (byWords) return byWords;
    const learnedHref = learnedPhrase(t)?.href;
    return learnedHref ? INTENTS.find((i) => i.href === learnedHref) ?? null : null;
  }

  /** Lleva a la pantalla que se pidió y espera a que esté lista para hablar. */
  async function route(id: number, alts: string[], intent: Intent | null = intentOf(alts[0] ?? "")): Promise<{ h: RemHandler } | { say: string } | null> {
    if (!intent) return null;
    if (!intent.perms.some((p) => can(p))) return { say: `No tienes permiso para ${intent.name}. Pídeselo al administrador.` };
    const current = remHandler();
    if (current?.title === intent.title) return { h: current };
    go(intent.href);
    setPhase("thinking");
    const h = await waitForRemHandler(15000, intent.title);
    if (session.current !== id) return { say: "" };
    if (!h) {
      pending.current = { title: intent.title, said: alts, until: Date.now() + 120000 };
      return { say: intent.wait ?? `${intent.name} está tardando en abrir. Cuando aparezca, sigo solo.` };
    }
    return { h };
  }

  /** «Abre los gastos»: cualquier página que la persona pueda abrir. */
  function navigateTo(text: string, strict = false): { href: string; label: string } | null {
    const learnedNav = learnedPhrase(text);
    if (learnedNav && links.some((l) => l.href === learnedNav.href)) return learnedNav;
    const hit = navTarget(text, links, strict);
    return hit ? { href: hit.link.href, label: hit.link.label } : null;
  }

  /** Dónde está y qué puede abrir quien habla (se lee en cada frase: si le cambian los permisos, cuenta al instante). */
  function remCtx(): RemContext {
    return {
      path: window.location.pathname + window.location.search, now: new Date(), topic: brain.current.topic, links,
      // Si el rol lo deja pero no aparece, es el plan de la tienda.
      blockedBy: (m) => (canByRole && modulePerms(m.id).some((p) => canByRole(p)) ? "plan" : "permission"),
    };
  }
  function remEnv(): ActionEnv | null {
    if (!storeId) return null;
    return {
      storeId,
      can,
      rpc: async (fn, args) => {
        const { data, error } = await supabaseBrowser().rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
    };
  }
  /** Explicar, cómo se hace, ventas, «crea uno nuevo», «qué sabes hacer». null si no es de eso. */
  async function answer(id: number, text: string, inScreen: boolean): Promise<Thought | null> {
    const r = await think(text, remCtx(), remEnv(), brain.current, { inScreen });
    if (session.current !== id) return null;
    return r;
  }

  const idleHint = () => (wakeOn ? "Aquí estoy: di «Rem» cuando me necesites." : "Aquí estoy: toca REM cuando me necesites.");

  async function run(initial?: RemReply, first?: string[]) {
    const id = ++session.current;
    setError(null);
    let reply: RemReply;

    if (initial) reply = initial;
    else {
      const found: { h: RemHandler | null } = { h: null };
      let said = first;
      const byWake = first !== undefined;
      let helpNext = false;
      let talkNext: RemReply | null = null;
      // Lo que no entendió en esta conversación: si enseguida, dicho de otra forma, sí, aprende la frase.
      let missed: string | null = null;
      const learnMissed = (href: string, label: string) => { if (missed) { learnPhrase(missed, href, label); resolveMiss(missed); setLearned(learnedCount()); missed = null; } };
      // «¿Quisiste decir…?» que REM acaba de ofrecer (src/lib/rem/suggest.ts).
      let offered: { from: string; options: Suggestion[] } | null = null;
      const miss = (text: string) => {
        missed = text;
        recordMiss(text, window.location.pathname);
        // Para que el dueño o un administrador le enseñe (sin el nombre de quien lo dijo).
        if (storeId) reportMiss(storeId, phraseKey(text), window.location.pathname);
        // En vez de solo «no te entendí»: lo más parecido entre lo que esta persona puede usar.
        const options = suggestFor(text, remCtx(), can);
        if (options.length) { offered = { from: text, options }; talkNext = suggestionReply(options); }
      };
      const opener = async (alts: string[]): Promise<"done" | "handler" | "miss" | "talk"> => {
        // ¿Contesta «¿Quisiste decir…?»? Con «sí», «la dos» o el nombre se hace; la frase queda como atajo suyo.
        if (offered) {
          const o: { from: string; options: Suggestion[] } = offered;
          offered = null;
          const pick = pickSuggestion(alts[0] ?? "", o.options);
          if (pick === "no") { missed = null; talkNext = { say: "Bueno. Dímelo de otra forma y lo intento." }; return "talk"; }
          if (pick) { learnAlias(o.from, pick.phrase); setMemTick((n) => n + 1); return openerCore([pick.phrase]); }
        }
        // Atajo aprendido de esta persona: «la plata que entró hoy» → «¿cuánto vendimos hoy?».
        const alias = aliasFor(alts[0] ?? "");
        return openerCore(alias ? [alias, ...alts] : alts);
      };
      const openerCore = async (alts: string[]): Promise<"done" | "handler" | "miss" | "talk"> => {
        const t = normalize(alts[0] ?? "");
        const talk = smallTalk(t);
        if (talk) { talkNext = { say: talk }; return "talk"; }
        if (POWER_OFF.test(t)) { await say(id, { say: "Me apago. Toca REM arriba cuando me necesites." }); setPower(false); return "done"; }
        if (HELP.test(t)) { missed = null; helpNext = true; return "miss"; }
        // Preguntas y consultas: «¿para qué sirve la nómina?», «¿cuánto vendimos hoy?», «crea uno nuevo».
        // Con una pantalla con voz abierta, responde sin ofrecer abrir otra cosa (el «sí» siguiente es de la pantalla).
        const smart = await answer(id, alts[0] ?? "", Boolean(remHandler()));
        if (session.current !== id) return "done";
        if (smart) {
          if (smart.go) {
            go(smart.go.href);
            await say(id, smart.reply);
            if (session.current === id) stop();
            return "done";
          }
          if (missed) { resolveMiss(missed); missed = null; }
          talkNext = smart.reply;
          return "talk";
        }
        // La pantalla abierta reclama la frase («Ren, muéstrame solo los agotados» estando en Productos): se queda aquí.
        if (remHandler()?.claims?.(alts[0] ?? "")) return "miss";
        const intent = intentOf(alts[0] ?? "");
        if (intent) {
          const r = await route(id, alts, intent);
          if (r && "say" in r) { if (r.say) await say(id, { say: r.say }); stop(); return "done"; }
          if (r) { learnMissed(intent.href, intent.name); found.h = r.h; return "handler"; }
        }
        const nav = navigateTo(alts[0] ?? "");
        if (nav) {
          learnMissed(nav.href, nav.label);
          go(nav.href);
          await say(id, { say: `Listo: ${nav.label}.` });
          if (session.current === id) stop();
          return "done";
        }
        return "miss";
      };
      // Si lo dicho pide algo («quiero hacer un traslado», «abre los gastos»), se va allá.
      if (said?.length) {
        const r = await opener(said);
        if (r === "done") return;
        if (r === "miss" && !remHandler()) miss(said[0]);
        else if (r === "talk") missed = null;
      }
      const h = found.h ?? remHandler();
      // Si respondió una pregunta («¿cuánto vendimos hoy?») con la pantalla abierta, dice eso y sigue con la pantalla.
      if (h) reply = talkNext ?? await h.start(said?.length ? said : undefined);
      else {
        let tries = 0;
        for (;;) {
          const ask: RemReply = talkNext ?? (helpNext
            ? capabilitiesAnswer(can).reply
            : tries === 0 && !missed
            ? { say: byWake ? "¿Sí? Dime." : "Hola, soy REM. ¿En qué te ayudo?" }
            : missed
              ? { say: "No te entendí bien. Dímelo de otra forma: por ejemplo, abre los gastos, ¿cuánto vendimos hoy? o quiero hacer un traslado." }
              : capabilitiesAnswer(can).reply);
          helpNext = false;
          talkNext = null;
          said = (await turn(id, ask)) ?? undefined;
          if (!said) return;
          const t = normalize(said[0] ?? "");
          if (!t || STOP.test(t)) {
            if (!t && tries < 1) { tries++; talkNext = { say: "¿Sigues ahí? Dime qué necesitas." }; continue; }
            await say(id, { say: idleHint() });
            return stop();
          }
          const r = await opener(said);
          if (r === "done") return;
          if (r === "handler" && found.h) { reply = await found.h.start(said); break; }
          if (r === "talk") { missed = null; continue; }
          // miss() puede dejar listo un «¿Quisiste decir…?» (talkNext) para la siguiente vuelta.
          if (HELP.test(t)) missed = null; else miss(said[0]);
          if (++tries >= 4) { await say(id, { say: idleHint() }); return stop(); }
        }
      }
    }

    let misses = 0;
    for (;;) {
      if (reply.end) { await say(id, reply); if (session.current === id) stop(); return; }
      const alts = await turn(id, reply);
      if (!alts) return;
      if (!alts.length) {
        if (++misses >= 2) { await say(id, { say: idleHint() }); return stop(); }
        reply = { say: "¿Sigues ahí? Dime." };
        continue;
      }
      misses = 0;
      const t = normalize(alts[0]);
      if (POWER_OFF.test(t)) { await say(id, { say: "Me apago. Lo que llevas queda en pantalla." }); setPower(false); return; }
      // La pantalla reclama sus frases («muéstrame solo los agotados» en Productos): no es ir a otra página.
      const mine = remHandler()?.claims?.(alts[0]) ?? false;
      // Una pregunta en medio de algo («¿cuánto vendimos hoy?», «¿para qué sirve la caja?»): responde y sigue ahí.
      if (!mine) {
        const smart = await answer(id, alts[0], true);
        if (session.current !== id) return;
        if (smart) { reply = smart.reply; continue; }
      }
      // «Quiero hacer un conteo» en medio de un traslado: cambia de pantalla.
      if (!mine && MOVE.test(t)) {
        const intent = intentOf(alts[0]);
        const r = intent ? await route(id, alts, intent) : null;
        if (r && "say" in r) { reply = { say: r.say || "Dime." }; continue; }
        if (r) { reply = await r.h.start(alts); continue; }
      }
      // «Abre los gastos» en medio de algo: va allá (lo que llevaba queda en su pantalla).
      if (!mine && navRequest(alts[0])) {
        const nav = navigateTo(alts[0], true);
        if (nav) { go(nav.href); await say(id, { say: `Listo: ${nav.label}.` }); if (session.current === id) stop(); return; }
      }
      const talk = smallTalk(t);
      if (talk) { reply = { say: talk.replace(/ ¿(?:En qué te ayudo|Qué hacemos)\?$/, " ¿Seguimos?") }; continue; }
      const now = remHandler();
      if (!now) { await say(id, { say: `Saliste de la pantalla. ${idleHint()}` }); return stop(); }
      setPhase("thinking");
      try {
        reply = await now.hear(alts);
      } catch {
        reply = { say: "Algo falló al buscar. Inténtalo otra vez." };
      }
      setLearned(learnedCount());
    }
  }

  /** Botón REM (encabezado o dentro de una ventana): enciende y escucha; si ya está conversando, muestra la conversación. */
  function call() {
    unlockAudio(); // iPhone: el sonido se desbloquea dentro del toque
    pending.current = null;
    if (!on) setPower(true);
    if (phaseRef.current === "idle") void run();
    else if (phaseRef.current === "speaking") stopSpeaking();
    else setPanel(true);
  }
  useEffect(() => { runRef.current = run; callRef.current = call; });

  if (!supported) return null;

  /** Tocar la esfera: si habla, se calla y escucha; si no, abre o cierra la conversación. */
  function tapOrb() {
    unlockAudio();
    if (phaseRef.current === "speaking") { stopSpeaking(); return; }
    setPanel((v) => !v);
  }

  /** Prueba del llamado: escucha una vez y dice si así se despierta. */
  async function testWake() {
    unlockAudio();
    pending.current = null;
    const id = ++session.current;
    setError(null);
    const alts = await turn(id, { say: "Prueba: llámame como lo harías, por ejemplo, Rem, abre los gastos." });
    if (!alts) return;
    const hit = alts.find((a) => wakeRest(a) !== null);
    await say(id, hit
      ? { say: "¡Así sí me llamas!", show: `✓ Te oí «${hit}». Así sí me llamas.` }
      : alts.length
        ? { say: "Así no me despierto. Prueba otra vez, más despacio.", show: `✗ Te oí «${alts[0]}». Así no me despierto: di «Rem» un poco más despacio, al empezar la frase.` }
        : { say: "No te oí." });
    if (session.current === id) stop();
  }

  function toggleWake(v: boolean) {
    setWakeOn(v);
    setWakeBlocked(false);
    writeFlag(WAKE_KEY, v);
  }

  function clearLog() {
    setTurns([]);
    writeLog([]);
  }

  /** Lo que REM guardó de esta persona, para verlo, corregirlo o borrarlo. */
  const memory = panel ? { phrases: listPhrases(), aliases: listAliases(), products: learnedProductsCount(), misses: readMisses(), tick: memTick } : null;
  const memChanged = () => { setMemTick((n) => n + 1); setLearned(learnedCount()); };
  function teach(text: string, href: string) {
    const l = links.find((x) => x.href === href);
    if (!l) return;
    learnPhrase(text, l.href, l.label);
    resolveMiss(text);
    memChanged();
  }
  async function openTeam() {
    if (!storeId) return;
    setTeamBusy(true);
    const r = await reviewMisses(storeId);
    setTeamBusy(false);
    setTeam(r.ok ? { rows: r.data, error: null } : { rows: [], error: r.error });
  }
  async function teachTeam(phrase: string, href: string) {
    const l = links.find((x) => x.href === href);
    if (!storeId || !l) return;
    setTeamBusy(true);
    const r = await teachStore(storeId, phrase, l.href, l.label);
    setTeamBusy(false);
    if (!r.ok) { setTeam((t) => ({ rows: t?.rows ?? [], error: r.error })); return; }
    setTeam((t) => ({ rows: (t?.rows ?? []).filter((x) => x.phrase !== phrase), error: null }));
    memChanged();
  }
  async function dismissTeam(phrase: string) {
    if (!storeId) return;
    const r = await dismissTeamMiss(storeId, phrase);
    if (r.ok) setTeam((t) => ({ rows: (t?.rows ?? []).filter((x) => x.phrase !== phrase), error: null }));
  }
  async function forgetTeam(phrase: string) {
    if (!storeId) return;
    const r = await forgetStore(storeId, phrase);
    if (r.ok) memChanged();
    else setTeam((t) => ({ rows: t?.rows ?? [], error: r.error }));
  }

  function wipeMemory() {
    if (!wipeAsk) { setWipeAsk(true); window.setTimeout(() => setWipeAsk(false), 5000); return; }
    setWipeAsk(false);
    forgetEverything();
    brain.current = emptyBrain();
    setTurns([]);
    memChanged();
  }

  const status = phase === "listening" ? "Te escucho…"
    : phase === "speaking" ? (fullDuplex() ? "Hablando · interrúmpeme cuando quieras" : "Hablando · toca la esfera para interrumpir")
    : phase === "thinking" ? "Pensando…"
    : wakeOn ? (wakeBlocked ? "Toca la pantalla una vez para poder oír «Rem»" : "Di «Rem» y lo que necesitas") : "Toca 🎙️ para hablar";
  const orbLabel = phase === "speaking" ? "REM está hablando: toca para interrumpir" : panel ? "Cerrar la conversación con REM" : "REM: toca para ver la conversación";

  // Dónde sale la conversación: pegada a la esfera, hacia donde haya espacio.
  const panelStyle: React.CSSProperties = (() => {
    if (!place || typeof window === "undefined") return { right: 12, bottom: 100 };
    const W = window.innerWidth; const H = window.innerHeight;
    const narrow = W < 640;
    const s: React.CSSProperties = {};
    const below = place.cy < H / 2;
    if (narrow) { s.left = 12; s.right = 12; }
    else if (place.cx > W / 2) s.right = Math.max(12, W - place.cx - place.size / 2);
    else s.left = Math.max(12, place.cx - place.size / 2);
    if (below) s.top = place.cy + place.size / 2 + 14;
    else s.bottom = H - place.cy + place.size / 2 + 14;
    s.maxHeight = Math.min(H * 0.72, (below ? H - place.cy - place.size / 2 : place.cy - place.size / 2) - 28);
    return s;
  })();

  const dotColor = phase === "listening" ? "#f472b6" : phase === "speaking" ? "#a78bfa" : phase === "thinking" ? "#fbbf24" : "#10b981";

  return (
    <>
      <button type="button" onClick={call} title={on ? (wakeOn ? "REM: di «Rem» o toca aquí para hablar" : "REM: toca para hablar") : "Encender REM"} aria-label={on ? "Hablar con REM" : "Encender REM"}
        className="relative inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5"
        style={{ borderColor: on ? "color-mix(in oklab, #8b5cf6 55%, var(--t-card-border))" : "var(--t-card-border)", background: on ? "color-mix(in oklab, #8b5cf6 14%, var(--t-card-bg))" : "var(--t-card-bg)", color: "var(--t-text)" }}>
        <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #fff 0 8%, #c084fc 30%, #6d28d9 75%, #3b0764)", boxShadow: on ? "0 0 8px rgba(168,85,247,.8)" : undefined }} />
        <span>REM</span>
        {on ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: dotColor }} title={status} /> : null}
      </button>
      {on && typeof document !== "undefined" ? createPortal(
        <>
          <RemOrb phase={phase} awake={wakeOn && !wakeBlocked && visible} onTap={tapOrb} onPlace={onPlace}
            caption={panel ? null : caption} label={orbLabel} />
          {panel ? (
            <div role="dialog" aria-label="Conversación con REM" className="rem-panel fixed z-[2147483000] flex w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[26px] border"
              style={{
                ...panelStyle,
                borderColor: "rgba(196,181,253,.32)",
                background: "linear-gradient(160deg, color-mix(in oklab, #4c1d95 30%, var(--t-bg-base, #0f0a1f)) 0%, color-mix(in oklab, #1e0b3a 20%, var(--t-bg-base, #0f0a1f)) 100%)",
                boxShadow: "0 24px 60px rgba(30,7,60,.55), inset 0 1px 0 rgba(255,255,255,.08)",
                backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                color: "var(--t-text)",
              }}>
              <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(196,181,253,.18)" }}>
                <span aria-hidden className="relative h-9 w-9 shrink-0 rounded-full" style={{ background: "radial-gradient(circle at 34% 28%, #fff 0 7%, #d8b4fe 22%, #8b5cf6 55%, #3b0764)", boxShadow: "0 0 16px rgba(168,85,247,.55)" }}>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2" style={{ background: dotColor, borderColor: "var(--t-bg-base, #0f0a1f)" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">REM{title ? ` · ${title}` : ""}</div>
                  <div className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{status}</div>
                </div>
                <button type="button" onClick={() => setPower(false)} title="Apagar REM (deja de escuchar)" aria-label="Apagar REM"
                  className="grid h-8 w-8 place-items-center rounded-full text-sm transition hover:bg-white/10">⏻</button>
                <button type="button" onClick={() => setPanel(false)} title="Ocultar la conversación (REM sigue encendido)" aria-label="Ocultar conversación"
                  className="grid h-8 w-8 place-items-center rounded-full text-sm transition hover:bg-white/10">✕</button>
              </div>

              <div ref={logRef} className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
                {!turns.length && !interim ? (
                  <div className="py-6 text-center text-xs" style={{ color: "var(--t-muted)" }}>
                    Aquí queda lo que hablemos.<br />Di «Rem, abre los gastos» o «Rem, quiero hacer un traslado».
                  </div>
                ) : null}
                {turns.map((t, i) => (
                  <div key={`${t.at}-${i}`} className={t.who === "you" ? "flex justify-end" : "flex"}>
                    <div className="max-w-[86%] whitespace-pre-line rounded-2xl px-3 py-2 leading-snug"
                      style={t.who === "you"
                        ? { background: "linear-gradient(135deg, rgba(139,92,246,.45), rgba(236,72,153,.3))", color: "#fff", borderBottomRightRadius: 6 }
                        : { background: "color-mix(in oklab, var(--t-text) 8%, transparent)", borderBottomLeftRadius: 6 }}>
                      {t.text}
                    </div>
                  </div>
                ))}
                {interim ? <div className="flex justify-end"><div className="max-w-[86%] rounded-2xl px-3 py-2 italic opacity-75" style={{ background: "rgba(139,92,246,.22)" }}>{interim}…</div></div> : null}
                {error ? <div className="rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: "#ef4444", color: "#f87171" }}>{error}</div> : null}
              </div>

              <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: "rgba(196,181,253,.18)" }}>
                <button type="button"
                  onClick={() => { unlockAudio(); if (phase === "idle") void run(); else if (phase === "speaking") stopSpeaking(); else stop(); }}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                  style={{ background: phase === "idle" ? "linear-gradient(135deg,#8b5cf6,#d946ef)" : phase === "speaking" ? "linear-gradient(135deg,#6d28d9,#8b5cf6)" : "linear-gradient(135deg,#be185d,#db2777)" }}>
                  {phase === "idle" ? "🎙️ Hablar" : phase === "speaking" ? "✋ Interrumpir" : "■ Detener"}
                </button>
                <button type="button" role="switch" aria-checked={wakeOn} onClick={() => toggleWake(!wakeOn)}
                  title={wakeOn ? "Dejar de responder a «Rem»" : "Responder cuando digan «Rem» (sin tocar)"}
                  className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-bold"
                  style={{ borderColor: wakeOn ? "rgba(16,185,129,.5)" : "rgba(196,181,253,.25)", background: wakeOn ? "rgba(16,185,129,.12)" : "transparent" }}>
                  <span className="relative h-4 w-7 rounded-full transition" style={{ background: wakeOn ? "#10b981" : "color-mix(in oklab, var(--t-text) 25%, transparent)" }}>
                    <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all" style={{ left: wakeOn ? "0.875rem" : "0.125rem" }} />
                  </span>
                  «Rem»
                </button>
              </div>
              {wakeOn && lastHeard && phase === "idle" ? (
                <div className="truncate px-4 pb-1 text-[11px]" style={{ color: "var(--t-muted)" }} title={lastHeard}>Último que oí esperando: «{lastHeard}»</div>
              ) : null}

              <details className="border-t px-4 py-2 text-xs" style={{ borderColor: "rgba(196,181,253,.18)", color: "var(--t-muted)" }}>
                <summary className="cursor-pointer font-semibold">¿Qué le puedo decir?</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {(examples.length ? examples : ["¿Cuánto vendimos hoy? ¿Y ayer?", "¿Para qué sirve la rentabilidad?", "¿Cómo registro un producto?", "Quiero hacer un traslado", "Vender"]).map((e) => <li key={e}>{e}</li>)}
                  <li>«Abre los gastos», «llévame a la nómina», «muéstrame la caja»</li>
                  <li>«Foto»: busca el producto con la cámara</li>
                  <li>«Apágate»: deja de escuchar</li>
                </ul>
                <p className="mt-1">
                  Nada se guarda ni se envía sin que digas «sí». {fullDuplex() ? "Puedes hablarle encima: se calla y te escucha." : "Toca la esfera para que se calle y te escuche."}
                </p>
                <p className="mt-1">
                  Aprende solo en este equipo: si te corrige mal o no te entiende y lo dices de otra forma, la próxima vez acierta.
                  {learned ? ` Lleva ${learned} ${learned === 1 ? "cosa aprendida" : "cosas aprendidas"}.` : ""}
                </p>
                {isAppleMobile() ? (
                  <p className="mt-1">iPhone: si no lo oyes, sube el volumen y revisa que no esté en silencio (interruptor del lado). Toca «🔊 Probar sonido».</p>
                ) : null}
                <p className="mt-1">«Rem» escucha solo con RemHub abierto y a la vista. Gasta más batería: mejor en computador o tablet fija. Arrastra la esfera a donde no estorbe.</p>
                {duplexCapable() ? (
                  <label className="mt-2 flex items-start gap-2 rounded-xl border p-2" style={{ borderColor: "rgba(196,181,253,.2)", color: "var(--t-text)" }}>
                    <input type="checkbox" className="mt-0.5" checked={duplexOn} onChange={(e) => { setDuplexPref(e.target.checked); setDuplexOn(e.target.checked); }} />
                    <span>
                      <b>Interrumpirlo hablando</b>
                      <span className="block" style={{ color: "var(--t-muted)" }}>Escucha mientras habla y se calla apenas le hablas. Ignora su propia voz si sale por el parlante; con audífonos va mejor.</span>
                    </span>
                  </label>
                ) : null}
                <div className="mt-2 rounded-xl border p-2" style={{ borderColor: "rgba(196,181,253,.2)", color: "var(--t-text)" }}>
                  <b>Cómo dice su nombre</b>
                  <span className="block" style={{ color: "var(--t-muted)" }}>Toca cada opción, escucha y deja la que suene «rem» en español. Solo cambia la voz; el nombre escrito sigue igual.</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(PRONUNCIATIONS.find((p) => p.id === "rem")?.options ?? []).map((o, i) => (
                      <button key={o} type="button" disabled={phase !== "idle"}
                        onClick={() => {
                          unlockAudio();
                          setPronunciationChoice("rem", o);
                          setNameSay(o);
                          void speak("Hola, soy REM. ¿En qué te ayudo?", { spoken: applyPronunciations("Hola, soy REM. ¿En qué te ayudo?", () => o) });
                        }}
                        className="rounded-lg border px-2 py-1 font-bold disabled:opacity-50"
                        style={nameSay === o ? { borderColor: "#a78bfa", background: "rgba(139,92,246,.25)" } : { borderColor: "rgba(196,181,253,.25)" }}>
                        {nameSay === o ? "✓ " : "🔈 "}Opción {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void testWake()} disabled={phase !== "idle"} className="rounded-lg border px-2 py-1 font-bold disabled:opacity-50" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>
                    🧪 Probar el llamado
                  </button>
                  <button type="button" disabled={phase !== "idle"} onClick={() => { unlockAudio(); void speak("Hola, soy REM. Si me oyes, el sonido funciona."); }}
                    className="rounded-lg border px-2 py-1 font-bold disabled:opacity-50" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>
                    🔊 Probar sonido
                  </button>
                  <button type="button" onClick={clearLog} disabled={!turns.length} className="rounded-lg border px-2 py-1 font-bold disabled:opacity-50" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>
                    🧹 Borrar conversación
                  </button>
                </div>
              </details>
              {memory ? (
                <details className="border-t px-4 py-2 text-xs" style={{ borderColor: "rgba(196,181,253,.18)", color: "var(--t-muted)" }}>
                  <summary className="cursor-pointer font-semibold">Lo que REM sabe de ti{memory.phrases.length + memory.aliases.length + memory.products ? ` (${memory.phrases.length + memory.aliases.length + memory.products})` : ""}</summary>
                  <p className="mt-1">Solo en este equipo, solo tuyo y solo en esta tienda. No da permisos: lo que no puedes abrir, no lo abre.</p>
                  <p className="mt-1">Lo que no te entiende se le muestra al dueño o al administrador <b>sin tu nombre</b>, para que le enseñe a REM. Se borra solo a los 90 días.</p>
                  {memory.misses.length ? (
                    <div className="mt-2">
                      <b style={{ color: "var(--t-text)" }}>Lo que no te entendí</b>
                      <span className="block">Elige a dónde querías ir y la próxima vez lo entiende.</span>
                      <ul className="mt-1 space-y-1">
                        {memory.misses.slice(0, 6).map((m) => (
                          <li key={m.text} className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate" title={m.text}>«{m.text}»{m.times > 1 ? ` ×${m.times}` : ""}</span>
                            <select aria-label={`A dónde lleva «${m.text}»`} defaultValue="" onChange={(e) => { if (e.target.value) teach(m.text, e.target.value); }}
                              className="max-w-[9rem] rounded-lg border bg-transparent px-1 py-0.5" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>
                              <option value="">Enseñar…</option>
                              {links.filter((l) => !l.action).map((l) => <option key={l.href + l.label} value={l.href}>{l.label}</option>)}
                            </select>
                            <button type="button" aria-label={`Descartar «${m.text}»`} onClick={() => { resolveMiss(m.text); memChanged(); }} className="rounded px-1 hover:bg-white/10">✕</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {memory.phrases.length ? (
                    <div className="mt-2">
                      <b style={{ color: "var(--t-text)" }}>Frases aprendidas</b>
                      <ul className="mt-1 space-y-1">
                        {memory.phrases.slice(0, 12).map((p) => (
                          <li key={p.key} className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate" title={`«${p.key}» → ${p.label}`}>«{p.key}» → {p.label}</span>
                            <button type="button" aria-label={`Olvidar «${p.key}»`} onClick={() => { forgetPhraseKey(p.key); memChanged(); }} className="rounded px-1 hover:bg-white/10">✕</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {memory.aliases.length ? (
                    <div className="mt-2">
                      <b style={{ color: "var(--t-text)" }}>Cómo le dices tú</b>
                      <span className="block">Frases tuyas que REM corrigió con «¿Quisiste decir…?».</span>
                      <ul className="mt-1 space-y-1">
                        {memory.aliases.slice(0, 12).map((a) => (
                          <li key={a.key} className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate" title={`«${a.key}» = «${a.to}»`}>«{a.key}» = «{a.to}»</span>
                            <button type="button" aria-label={`Olvidar «${a.key}»`} onClick={() => { forgetAlias(a.key); memChanged(); }} className="rounded px-1 hover:bg-white/10">✕</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {memory.products ? (
                    <p className="mt-2 flex items-center gap-2">
                      <span className="flex-1">{memory.products} {memory.products === 1 ? "producto aprendido" : "productos aprendidos"} (cómo los nombras).</span>
                      <button type="button" onClick={() => { forgetLearnedProducts(); memChanged(); }} className="rounded-lg border px-2 py-0.5 font-bold" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>Olvidar</button>
                    </p>
                  ) : null}
                  {!memory.phrases.length && !memory.aliases.length && !memory.products && !memory.misses.length ? <p className="mt-1">Todavía no ha aprendido nada.</p> : null}
                  {listStorePhrases().length ? (
                    <p className="mt-2">La tienda le enseñó {listStorePhrases().length} {listStorePhrases().length === 1 ? "frase" : "frases"}; también te sirven a ti.</p>
                  ) : null}
                  <button type="button" onClick={wipeMemory} className="mt-2 rounded-lg border px-2 py-1 font-bold" style={{ borderColor: wipeAsk ? "#ef4444" : "rgba(196,181,253,.25)", color: wipeAsk ? "#f87171" : "var(--t-text)" }}>
                    {wipeAsk ? "¿Seguro? Toca otra vez para borrar todo" : "🗑️ Borrar todo lo que sabe de mí"}
                  </button>
                </details>
              ) : null}
              {memory && canTeach && storeId ? (
                <details className="border-t px-4 py-2 text-xs" style={{ borderColor: "rgba(196,181,253,.18)", color: "var(--t-muted)" }}
                  onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !team) void openTeam(); }}>
                  <summary className="cursor-pointer font-semibold">👑 Enseñarle a REM para toda la tienda</summary>
                  <p className="mt-1">Lo que REM no le entendió al equipo, sin decir quién. Elige a dónde lleva y REM lo entiende con todos. No da permisos: cada quien solo abre lo que puede.</p>
                  {teamBusy && !team ? <p className="mt-1">Cargando…</p> : null}
                  {team?.error ? <p className="mt-1" style={{ color: "#f87171" }}>{team.error}</p> : null}
                  {team && !team.error && !team.rows.length ? <p className="mt-1">El equipo no tiene frases sin entender. 🎉</p> : null}
                  {team?.rows.length ? (
                    <ul className="mt-1 space-y-1">
                      {team.rows.slice(0, 15).map((m) => (
                        <li key={m.phrase} className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate" title={`«${m.phrase}» · ${m.times} ${m.times === 1 ? "vez" : "veces"}, ${m.people} ${m.people === 1 ? "persona" : "personas"}`}>«{m.phrase}» <span className="opacity-70">×{m.times}</span></span>
                          <select aria-label={`A dónde lleva «${m.phrase}» para toda la tienda`} defaultValue="" disabled={teamBusy} onChange={(e) => { if (e.target.value) void teachTeam(m.phrase, e.target.value); }}
                            className="max-w-[9rem] rounded-lg border bg-transparent px-1 py-0.5" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>
                            <option value="">Enseñar…</option>
                            {links.filter((l) => !l.action).map((l) => <option key={l.href + l.label} value={l.href}>{l.label}</option>)}
                          </select>
                          <button type="button" aria-label={`Descartar «${m.phrase}»`} onClick={() => void dismissTeam(m.phrase)} className="rounded px-1 hover:bg-white/10">✕</button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {listStorePhrases().length ? (
                    <div className="mt-2">
                      <b style={{ color: "var(--t-text)" }}>Frases de la tienda</b>
                      <ul className="mt-1 space-y-1">
                        {listStorePhrases().slice(0, 20).map((p) => (
                          <li key={p.key} className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate" title={`«${p.key}» → ${p.label}`}>«{p.key}» → {p.label}</span>
                            <button type="button" aria-label={`Olvidar «${p.key}» para toda la tienda`} onClick={() => void forgetTeam(p.key)} className="rounded px-1 hover:bg-white/10">✕</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <button type="button" onClick={() => void openTeam()} disabled={teamBusy} className="mt-2 rounded-lg border px-2 py-1 font-bold disabled:opacity-50" style={{ borderColor: "rgba(196,181,253,.25)", color: "var(--t-text)" }}>↻ Actualizar</button>
                </details>
              ) : null}
            </div>
          ) : null}
        </>,
        document.body,
      ) : null}
    </>
  );
}
