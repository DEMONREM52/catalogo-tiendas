"use client";

/**
 * 🎙️ REM: asistente de voz del panel. Se toca (o se dice «Oye REM»), se habla y contesta con voz.
 * Sabe: traslados, conteos, pedidos internos, compras y POS (cada pantalla se registra en src/lib/voice/rem.ts).
 * Sin IA: entiende frases (src/lib/voice/spanish.ts). Solo escucha con el panel abierto, o esperando
 * «Oye REM» si se encendió esa opción en este equipo (y con la pestaña a la vista).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { announceUrlChange } from "@/lib/url-intent";
import { beep, capture, duplexCapable, duplexPref, echoDetected, fullDuplex, isEchoOf, listen, setDuplexPref, speak, startWake, stopListening, stopSpeaking, voiceSupported, VoiceError, wakeRest } from "@/lib/voice/speech";
import { onRemCall, onRemHandlerChange, onRemResume, remHandler, waitForRemHandler, type RemHandler, type RemReply } from "@/lib/voice/rem";
import { normalize } from "@/lib/voice/spanish";

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Turn = { who: "you" | "rem"; text: string };

const STOP = /^(?:(?:oye )?rem )?(?:para|parar|detente|cancela|cancelar|chao|adios|salir|gracias|nada)$/;
const WAKE_KEY = "remhub:rem-wake";

/** A dónde lleva REM según lo que se dice (si la pantalla no está abierta). */
const INTENTS: Array<{ re: RegExp; href: string; perms: string[]; name: string; title: string; wait?: string }> = [
  { re: /traslad|distribu|(?:mandar|enviar|despachar) (?:la )?mercancia/, href: "/dashboard/inventario?tab=transfers", perms: ["transfers"], name: "Traslados", title: "Traslado" },
  { re: /conteo|contar|inventario fisico/, href: "/dashboard/inventario?tab=conteos", perms: ["inventory_counts", "inventory_adjust"], name: "Conteos", title: "Conteo", wait: "Abre o empieza un conteo y sigo solo." },
  { re: /pedido interno|pedir mercancia|hacer un pedido|nuevo pedido|pedirle a|pedir a la bodega|pedido a/, href: "/dashboard/pedidos?tab=internos&nuevo=1", perms: ["stock_requests"], name: "Pedidos internos", title: "Pedido interno", wait: "Toca «Nuevo pedido» y sigo solo." },
  { re: /compra|factura de(?:l)? proveedor|ingres(?:o|ar) (?:de )?mercancia|llego mercancia|registrar factura/, href: "/dashboard/inventario?tab=purchases", perms: ["purchases"], name: "Compras", title: "Compra" },
  { re: /vend|venta|\bpos\b|caja|cobrar|facturar/, href: "/dashboard/pos", perms: ["pos"], name: "POS", title: "Venta" },
];

function readWake(): boolean {
  try { return localStorage.getItem(WAKE_KEY) === "1"; } catch { return false; }
}

export function RemButton({ can }: { can: (permission: string) => boolean }) {
  const supported = useSyncExternalStore(() => () => {}, voiceSupported, () => false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [wakeOn, setWakeOn] = useState(false);
  const [visible, setVisible] = useState(true);
  // «Oye REM»: lo último que oyó esperando (para saber cómo lo escribe el reconocedor) y si el navegador
  // no dejó usar el micrófono sin tocar la pantalla (se reintenta al primer toque).
  const [lastHeard, setLastHeard] = useState("");
  const [wakeBlocked, setWakeBlocked] = useState(false);
  const [duplexOn, setDuplexOn] = useState(true);
  const session = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<(initial?: RemReply, first?: string[]) => Promise<void>>(async () => {});
  const toggleRef = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>("idle");
  // La pantalla pedida tardó en abrir (o falta tocar «Nuevo pedido»): cuando aparezca, REM sigue solo.
  const pending = useRef<{ title: string; said: string[]; until: number } | null>(null);

  useEffect(() => { const t = window.setTimeout(() => { setWakeOn(readWake()); setDuplexOn(duplexPref()); }, 0); return () => window.clearTimeout(t); }, []);
  useEffect(() => onRemHandlerChange(() => {
    const h = remHandler();
    setTitle(h?.title ?? null);
    setExamples(h?.examples ?? []);
    const p = pending.current;
    if (!h || !p || h.title !== p.title) return;
    pending.current = null;
    if (Date.now() > p.until || phaseRef.current !== "idle") return;
    setOpen(true);
    void runRef.current(undefined, p.said);
  }), []);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // Botón 🎙️ REM dentro de una ventana (RemCallButton): igual que tocar el del encabezado.
  useEffect(() => onRemCall(() => toggleRef.current()), []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [turns, interim]);
  useEffect(() => () => { session.current++; stopListening(); stopSpeaking(); }, []);
  // Después de elegir con la foto, la pantalla pide seguir: «Zapatera negra. ¿Cuántas?».
  useEffect(() => onRemResume((r) => { setOpen(true); void runRef.current(r); }), []);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  // «Oye REM»: solo en reposo, con la opción encendida y la pestaña a la vista.
  useEffect(() => {
    if (!supported || !wakeOn || !visible || phase !== "idle" || wakeBlocked) return;
    return startWake((rest) => {
      setOpen(true);
      void runRef.current(undefined, rest ? [rest] : undefined);
    }, () => setWakeBlocked(true), (heard) => { if (heard) setLastHeard(heard); });
  }, [supported, wakeOn, visible, phase, wakeBlocked]);
  useEffect(() => {
    if (!wakeBlocked) return;
    const retry = () => setWakeBlocked(false);
    window.addEventListener("pointerdown", retry, { once: true });
    return () => window.removeEventListener("pointerdown", retry);
  }, [wakeBlocked]);

  const add = (who: Turn["who"], text: string) => setTurns((t) => [...t.slice(-14), { who, text }]);

  function stop() {
    session.current++;
    stopListening();
    stopSpeaking();
    setPhase("idle");
    setInterim("");
  }

  function close() {
    pending.current = null;
    stop();
    setOpen(false);
  }

  /** Dice algo sin esperar respuesta. */
  async function say(id: number, r: RemReply) {
    if (session.current !== id) return;
    add("rem", r.show ?? r.say);
    setPhase("speaking");
    await speak(r.say);
  }

  function heard(id: number, alts: string[]): string[] | null {
    if (session.current !== id) return null;
    setInterim("");
    if (alts[0]) add("you", alts[0]);
    return alts;
  }

  function failed(id: number, err: unknown): null {
    if (session.current !== id) return null;
    const msg = err instanceof VoiceError && err.code === "permission"
      ? "Dale permiso al micrófono: toca el candado junto a la dirección → Micrófono → Permitir."
      : err instanceof Error ? err.message : "No se pudo escuchar.";
    setError(msg);
    setPhase("idle");
    setInterim("");
    return null;
  }

  /** Escucha una frase. null si se canceló la conversación. */
  async function hearOnce(id: number): Promise<string[] | null> {
    if (session.current !== id) return null;
    setPhase("listening");
    setInterim("");
    beep("listen");
    try {
      return heard(id, await listen({ onInterim: (t) => { if (session.current === id) setInterim(t); } }));
    } catch (err) {
      return failed(id, err);
    }
  }

  /**
   * Dice la respuesta y escucha la contestación. En computador escucha desde que empieza a hablar:
   * si la persona habla encima, REM se calla al instante y oye la frase completa (con pausas).
   * En celular escucha al terminar (tocar 🔊 lo calla antes). null si se canceló la conversación.
   */
  async function turn(id: number, r: RemReply): Promise<string[] | null> {
    if (!fullDuplex()) { await say(id, r); return hearOnce(id); }
    if (session.current !== id) return null;
    add("rem", r.show ?? r.say);
    setPhase("speaking");
    setInterim("");
    const cap = capture({
      echo: r.say,
      onUserStart: () => { if (session.current !== id) return; stopSpeaking(); setPhase("listening"); },
      onInterim: (t) => { if (session.current === id) setInterim(t); },
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

  /** Lleva a la pantalla que se pidió y espera a que esté lista para hablar. */
  async function route(id: number, alts: string[]): Promise<{ h: RemHandler } | { say: string } | null> {
    const t = normalize(alts[0] ?? "");
    const intent = INTENTS.find((i) => i.re.test(t));
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

  async function run(initial?: RemReply, first?: string[]) {
    const id = ++session.current;
    setError(null);
    if (!initial) setTurns([]);
    let reply: RemReply;

    if (initial) reply = initial;
    else {
      let h: RemHandler | null = null;
      let said = first;
      // Si lo dicho pide otra pantalla («quiero hacer un traslado» estando en el POS), se va allá.
      if (said?.length) {
        const r = await route(id, said);
        if (r && "say" in r) { if (r.say) await say(id, { say: r.say }); return stop(); }
        if (r) h = r.h;
      }
      h = h ?? remHandler();
      if (h) reply = await h.start(said);
      else {
        let tries = 0;
        for (;;) {
          said = (await turn(id, { say: tries ? "Puedo ayudarte con traslados, conteos, pedidos internos, compras y ventas. ¿Cuál?" : "Hola, soy REM. ¿Qué hacemos?" })) ?? undefined;
          if (!said) return;
          const t = normalize(said[0] ?? "");
          if (!t || STOP.test(t)) {
            if (!t && tries < 1) { tries++; continue; }
            await say(id, { say: "Listo. Toca REM cuando me necesites." });
            return stop();
          }
          const r = await route(id, said);
          if (r && "say" in r) { if (r.say) await say(id, { say: r.say }); return stop(); }
          if (r) { reply = await r.h.start(said); break; }
          if (++tries >= 3) { await say(id, { say: "Toca REM cuando quieras intentarlo de nuevo." }); return stop(); }
        }
      }
    }

    let misses = 0;
    for (;;) {
      if (reply.end) { await say(id, reply); if (session.current === id) stop(); return; }
      const alts = await turn(id, reply);
      if (!alts) return;
      if (!alts.length) {
        if (++misses >= 2) { await say(id, { say: "Te espero. Toca REM cuando quieras seguir." }); return stop(); }
        reply = { say: "¿Sigues ahí? Dime." };
        continue;
      }
      misses = 0;
      // «Quiero hacer un conteo» en medio de un traslado: cambia de pantalla.
      const moved = INTENTS.some((i) => i.re.test(normalize(alts[0])) && /^(?:(?:oye )?rem )?(?:quiero|vamos a|voy a|abre|abrir|ir a|llevame a)\b/.test(normalize(alts[0])));
      if (moved) {
        const r = await route(id, alts);
        if (r && "say" in r) { reply = { say: r.say || "Dime." }; continue; }
        if (r) { reply = await r.h.start(alts); continue; }
      }
      const now = remHandler();
      if (!now) { await say(id, { say: "Saliste de la pantalla. Hasta luego." }); return stop(); }
      setPhase("thinking");
      try {
        reply = await now.hear(alts);
      } catch {
        reply = { say: "Algo falló al buscar. Inténtalo otra vez." };
      }
    }
  }
  useEffect(() => { runRef.current = run; toggleRef.current = toggle; });

  if (!supported) return null;

  function toggle() {
    pending.current = null;
    if (!open) { setOpen(true); void run(); return; }
    if (phase === "idle") void run();
    else stop();
  }

  /** Prueba del llamado: escucha una vez y dice si así se despierta. */
  async function testWake() {
    pending.current = null;
    const id = ++session.current;
    setError(null);
    const alts = await turn(id, { say: "Prueba: di «Oye REM» como lo dirías." });
    if (!alts) return;
    const hit = alts.find((a) => wakeRest(a) !== null);
    await say(id, hit
      ? { say: "¡Así sí me llamas!", show: `✓ Te oí «${hit}». Así sí me llamas.` }
      : alts.length
        ? { say: "Así no me despierto. Prueba otra vez, más despacio.", show: `✗ Te oí «${alts[0]}». Así no me despierto: prueba «Oye REM» más despacio, o mándale esta frase a soporte.` }
        : { say: "No te oí." });
    if (session.current === id) stop();
  }

  function toggleWake(on: boolean) {
    setWakeOn(on);
    setWakeBlocked(false);
    try { if (on) localStorage.setItem(WAKE_KEY, "1"); else localStorage.removeItem(WAKE_KEY); } catch { /* sin almacenamiento */ }
  }

  const color = phase === "listening" ? "#ef4444" : phase === "speaking" ? "#8b5cf6" : phase === "thinking" ? "#f59e0b" : "var(--t-accent, #8b5cf6)";
  const status = phase === "listening" ? "Te escucho…" : phase === "speaking" ? (fullDuplex() ? "Hablando… puedes interrumpirlo" : echoDetected() ? "Hablando… (me oigo por el parlante: toca 🔊 para interrumpir)" : "Hablando… toca 🔊 para contestar ya") : phase === "thinking" ? "Buscando…" : wakeOn ? (wakeBlocked ? "Toca la pantalla para que escuche «Oye REM»" : "Esperando «Oye REM»") : "En pausa";

  return (
    <>
      <button type="button" onClick={toggle} title={wakeOn ? "REM: di «Oye REM» o toca aquí" : "REM: toca y dile lo que necesitas"} aria-label="Hablar con REM"
        className="relative inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5"
        style={{ borderColor: open ? color : "var(--t-card-border)", background: open ? `color-mix(in oklab, ${color} 14%, var(--t-card-bg))` : "var(--t-card-bg)", color: "var(--t-text)" }}>
        <span aria-hidden className={phase === "listening" ? "animate-pulse" : undefined}>🎙️</span>
        <span>REM</span>
        {wakeOn && phase === "idle" ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" title="Esperando «Oye REM»" /> : null}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div role="dialog" aria-label="REM, asistente de voz"
          className="fixed bottom-3 right-3 z-[185] flex max-h-[70vh] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border shadow-2xl sm:bottom-5 sm:right-5"
          style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--t-card-border))`, background: "var(--t-bg-base, var(--t-card-bg))", color: "var(--t-text)" }}>
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" onClick={() => (phase === "idle" ? void run() : phase === "speaking" ? stopSpeaking() : stop())}
              aria-label={phase === "idle" ? "Hablar" : phase === "speaking" ? "Callar y escuchar" : "Pausar"} title={phase === "speaking" ? "Toca para que se calle y te escuche" : undefined}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-white"
              style={{ background: color, boxShadow: phase === "listening" ? `0 0 0 6px color-mix(in oklab, ${color} 25%, transparent)` : undefined, transition: "box-shadow .3s, background .3s" }}>
              {phase === "listening" ? <span className="absolute inset-0 animate-ping rounded-full" style={{ background: color, opacity: 0.35 }} /> : null}
              <span className="relative">{phase === "idle" ? "🎙️" : phase === "speaking" ? "🔊" : phase === "thinking" ? "⏳" : "👂"}</span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black">REM{title ? ` · ${title}` : ""}</div>
              <div className="text-xs" style={{ color: "var(--t-muted)" }}>{status}</div>
            </div>
            <button type="button" onClick={close} className="rounded-full px-2 py-1 text-sm" aria-label="Cerrar REM">✕</button>
          </div>
          {/* «Oye REM» a la vista: encendido / apagado y lo último que oyó esperando. */}
          <div className="flex items-center gap-2 border-b px-4 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", background: wakeOn ? "color-mix(in oklab, #10b981 8%, transparent)" : undefined }}>
            <button type="button" role="switch" aria-checked={wakeOn} onClick={() => toggleWake(!wakeOn)}
              className="relative h-5 w-9 shrink-0 rounded-full transition" style={{ background: wakeOn ? "#10b981" : "color-mix(in oklab, var(--t-text) 25%, transparent)" }}
              title={wakeOn ? "Apagar «Oye REM»" : "Encender «Oye REM»: llamarlo sin tocar"}>
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: wakeOn ? "1.125rem" : "0.125rem" }} />
            </button>
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--t-muted)" }} title={lastHeard || undefined}>
              <b style={{ color: "var(--t-text)" }}>«Oye REM»</b>{" "}
              {!wakeOn ? "apagado · enciéndelo para llamarme sin tocar"
                : wakeBlocked ? "· toca la pantalla una vez para que pueda escuchar"
                : phase !== "idle" ? "· vuelve a escuchar al terminar"
                : lastHeard ? `· oí: «${lastHeard}»` : "· escuchando… di «Oye REM»"}
            </span>
          </div>
          <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
            {turns.map((t, i) => (
              <div key={i} className={t.who === "you" ? "flex justify-end" : "flex"}>
                <div className="max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2"
                  style={t.who === "you"
                    ? { background: "color-mix(in oklab, var(--t-accent, #8b5cf6) 18%, transparent)" }
                    : { background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }}>
                  {t.text}
                </div>
              </div>
            ))}
            {interim ? <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-3 py-2 italic opacity-70" style={{ background: "color-mix(in oklab, var(--t-accent, #8b5cf6) 10%, transparent)" }}>{interim}…</div></div> : null}
            {error ? <div className="rounded-2xl border px-3 py-2 text-xs" style={{ borderColor: "#ef4444", color: "#ef4444" }}>{error}</div> : null}
          </div>
          <details className="border-t px-4 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            <summary className="cursor-pointer font-semibold">¿Qué le puedo decir?</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {(examples.length ? examples : ["Quiero hacer un traslado", "Quiero hacer un conteo", "Quiero hacer un pedido interno", "Registrar una compra", "Vender"]).map((e) => <li key={e}>{e}</li>)}
              <li>«Foto»: busca el producto con la cámara</li>
            </ul>
            <p className="mt-1">
              Nada se guarda ni se envía sin que digas «sí». {fullDuplex() ? "Puedes hablarle encima: se calla y te escucha." : "Toca 🔊 para que se calle y te escuche."}
              {" "}Si no encuentra algo exacto, te pregunta; si le corriges («no, es la VTS 30»), aprende en este equipo.
            </p>
            <p className="mt-1">«Oye REM» escucha solo con RemHub abierto y a la vista. Gasta más batería; mejor en computador o tablet fija.</p>
            {duplexCapable() ? (
              <label className="mt-2 flex items-start gap-2 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
                <input type="checkbox" className="mt-0.5" checked={duplexOn} onChange={(e) => { setDuplexPref(e.target.checked); setDuplexOn(e.target.checked); }} />
                <span>
                  <b>Interrumpirlo hablando</b>
                  <span className="block" style={{ color: "var(--t-muted)" }}>
                    {echoDetected() && duplexOn
                      ? "Se estaba oyendo a sí mismo por el parlante, así que ahora escucha al terminar de hablar. Con audífonos funciona; vuelve a marcar para probar otra vez."
                      : "Escucha mientras habla y se calla cuando le hablas. Si se oye a sí mismo por el parlante, se apaga solo; con audífonos funciona mejor."}
                  </span>
                </span>
              </label>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void testWake()} disabled={phase !== "idle"} className="rounded-lg border px-2 py-1 font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
                🧪 Probar «Oye REM»
              </button>
            </div>
          </details>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
