"use client";

/**
 * 🎙️ REM: asistente de voz del panel. Se toca, se habla y contesta con voz.
 * Por ahora sabe armar traslados (useTransferVoice). Sin IA: entiende frases (src/lib/voice/spanish.ts).
 * No escucha a escondidas: solo mientras el panel de REM está abierto.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { announceUrlChange } from "@/lib/url-intent";
import { beep, listen, speak, stopListening, stopSpeaking, voiceSupported, VoiceError } from "@/lib/voice/speech";
import { onRemHandlerChange, remHandler, waitForRemHandler, type RemHandler, type RemReply } from "@/lib/voice/rem";
import { normalize } from "@/lib/voice/spanish";

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Turn = { who: "you" | "rem"; text: string };

const STOP = /^(?:(?:oye )?rem )?(?:para|parar|detente|cancela|cancelar|chao|adios|salir|gracias)$/;
const TRANSFER = /traslad|distribu|(?:mandar|enviar|despachar) mercancia/;

export function RemButton({ canTransfer }: { canTransfer: boolean }) {
  const supported = useSyncExternalStore(() => () => {}, voiceSupported, () => false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const session = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => onRemHandlerChange(() => { const h = remHandler(); setTitle(h?.title ?? null); setExamples(h?.examples ?? []); }), []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [turns, interim]);
  // Si se cierra la pestaña o se sale del panel, REM se calla.
  useEffect(() => () => { session.current++; stopListening(); stopSpeaking(); }, []);

  if (!supported) return null;

  const add = (who: Turn["who"], text: string) => setTurns((t) => [...t.slice(-14), { who, text }]);

  function stop() {
    session.current++;
    stopListening();
    stopSpeaking();
    setPhase("idle");
    setInterim("");
  }

  function close() {
    stop();
    setOpen(false);
  }

  async function say(id: number, r: RemReply) {
    if (session.current !== id) return;
    add("rem", r.show ?? r.say);
    setPhase("speaking");
    await speak(r.say);
  }

  /** Escucha una frase. null si se canceló la conversación. */
  async function hearOnce(id: number): Promise<string[] | null> {
    if (session.current !== id) return null;
    setPhase("listening");
    setInterim("");
    beep("listen");
    try {
      const alts = await listen({ onInterim: (t) => { if (session.current === id) setInterim(t); } });
      if (session.current !== id) return null;
      setInterim("");
      if (alts[0]) add("you", alts[0]);
      return alts;
    } catch (err) {
      if (session.current !== id) return null;
      const msg = err instanceof VoiceError && err.code === "permission"
        ? "Dale permiso al micrófono: toca el candado junto a la dirección → Micrófono → Permitir."
        : err instanceof Error ? err.message : "No se pudo escuchar.";
      setError(msg);
      setPhase("idle");
      return null;
    }
  }

  function openTransfers() {
    const href = "/dashboard/inventario?tab=transfers";
    if (window.location.pathname === "/dashboard/inventario") {
      window.history.pushState(null, "", href);
      announceUrlChange();
      window.dispatchEvent(new Event("remhub-tab-change"));
    } else router.push(href);
  }

  async function run() {
    const id = ++session.current;
    setError(null);
    setTurns([]);
    let h: RemHandler | null = remHandler();
    let reply: RemReply;

    if (h) reply = await h.start();
    else {
      // Sin pantalla que atienda: preguntar qué se quiere hacer.
      let tries = 0;
      for (;;) {
        await say(id, { say: tries ? "Por ahora sé hacer traslados. Di: quiero hacer un traslado." : "Hola, soy REM. ¿Qué hacemos?" });
        const alts = await hearOnce(id);
        if (!alts) return;
        const t = normalize(alts[0] ?? "");
        if (!t || STOP.test(t)) {
          if (!t && tries < 1) { tries++; continue; }
          await say(id, { say: "Listo. Toca REM cuando me necesites." });
          return stop();
        }
        if (TRANSFER.test(t)) {
          if (!canTransfer) { await say(id, { say: "No tienes permiso para hacer traslados. Pídeselo al administrador." }); return stop(); }
          openTransfers();
          setPhase("thinking");
          h = await waitForRemHandler();
          if (session.current !== id) return;
          if (!h) { await say(id, { say: "No pude abrir Traslados. Ábrelo y vuelve a tocar REM." }); return stop(); }
          reply = await h.start(alts);
          break;
        }
        if (++tries >= 3) { await say(id, { say: "Toca REM cuando quieras intentarlo de nuevo." }); return stop(); }
      }
    }

    let misses = 0;
    for (;;) {
      await say(id, reply);
      if (session.current !== id) return;
      if (reply.end) return stop();
      const alts = await hearOnce(id);
      if (!alts) return;
      if (!alts.length) {
        if (++misses >= 2) { await say(id, { say: "Te espero. Toca REM cuando quieras seguir." }); return stop(); }
        reply = { say: "¿Sigues ahí? Dime." };
        continue;
      }
      misses = 0;
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

  function toggle() {
    if (!open) { setOpen(true); void run(); return; }
    if (phase === "idle") void run();
    else stop();
  }

  const color = phase === "listening" ? "#ef4444" : phase === "speaking" ? "#8b5cf6" : phase === "thinking" ? "#f59e0b" : "var(--t-accent, #8b5cf6)";
  const status = phase === "listening" ? "Te escucho…" : phase === "speaking" ? "Hablando…" : phase === "thinking" ? "Buscando…" : "En pausa";

  return (
    <>
      <button type="button" onClick={toggle} title="REM: dile lo que necesitas (por ahora, traslados)" aria-label="Hablar con REM"
        className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5"
        style={{ borderColor: open ? color : "var(--t-card-border)", background: open ? `color-mix(in oklab, ${color} 14%, var(--t-card-bg))` : "var(--t-card-bg)", color: "var(--t-text)" }}>
        <span aria-hidden className={phase === "listening" ? "animate-pulse" : undefined}>🎙️</span>
        <span>REM</span>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div role="dialog" aria-label="REM, asistente de voz"
          className="fixed bottom-3 right-3 z-[185] flex max-h-[70vh] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border shadow-2xl sm:bottom-5 sm:right-5"
          style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--t-card-border))`, background: "var(--t-bg-base, var(--t-card-bg))", color: "var(--t-text)" }}>
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" onClick={() => (phase === "idle" ? void run() : stop())} aria-label={phase === "idle" ? "Hablar" : "Pausar"}
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
              {(examples.length ? examples : ["Quiero hacer un traslado", "Quiero hacer un traslado de bodega principal a Zamora"]).map((e) => <li key={e}>{e}</li>)}
            </ul>
            <p className="mt-1">Nada se envía sin que digas «sí». Habla cuando suene el pitido.</p>
          </details>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
