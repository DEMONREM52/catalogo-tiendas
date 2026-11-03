"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { applyUpdate, startPwa, takeUpdateNews } from "@/lib/pwa/client";
import type { Release } from "@/lib/pwa/changelog";
import { usePwa } from "./InstallSheet";
import { ConnectionBanner } from "./ConnectionBanner";

/**
 * Registra el Service Worker y avisa (sin interrumpir) cuando la versión nueva cambia algo de la página donde
 * está la persona. El aviso dice qué cambió y trae un simulador; después de actualizar, lo muestra otra vez.
 */
export function PwaProvider() {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState<null | "before" | "after">(null);
  const [after, setAfter] = useState<Release[]>([]);
  useEffect(() => startPwa(), []);
  // Recién actualizada: se muestra lo nuevo de esta página (lo dejó guardado el aviso o el cambio de sección).
  useEffect(() => {
    const t = window.setTimeout(() => { const n = takeUpdateNews(); if (n.length) { setAfter(n); setOpen("after"); } }, 600);
    return () => window.clearTimeout(t);
  }, []);

  const notes = open === "after" ? after : pwa.notes;
  const first = pwa.notes[0];

  return (
    <>
    <ConnectionBanner />
    <AnimatePresence>
      {pwa.updateReady && first && !hidden && !open ? (
        <motion.div
          key="sw-update"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[170] mx-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_50px_rgba(0,0,0,.4)]"
          style={{ borderColor: "rgba(168,85,247,.45)", background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}
          role="status"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            <Sparkles size={17} />
          </span>
          <button type="button" onClick={() => setOpen("before")} className="min-w-0 flex-1 text-left">
            <b className="block truncate">✨ {first.title}</b>
            <span className="text-xs opacity-75">{pwa.notes.length > 1 ? `y ${pwa.notes.length - 1} cambio${pwa.notes.length > 2 ? "s" : ""} más en esta página · ` : "Nuevo en esta página · "}<u>Ver qué cambió</u></span>
          </button>
          <button type="button" onClick={() => applyUpdate()} className="shrink-0 rounded-xl px-3 py-2.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            Actualizar
          </button>
          <button type="button" onClick={() => setHidden(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100" aria-label="Más tarde">
            <X size={18} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
    {open && notes.length ? <NewsDialog mode={open} notes={notes} onClose={() => { if (open === "before") setHidden(true); setOpen(null); }} /> : null}
    </>
  );
}

/** Qué cambió, con un simulador por novedad (antes de actualizar, o ya actualizada). */
function NewsDialog({ mode, notes, onClose }: { mode: "before" | "after"; notes: Release[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const note = notes[Math.min(i, notes.length - 1)];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="fixed inset-0 z-[180] grid place-items-end bg-black/55 p-3 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label="Novedades de RemHub" initial={{ y: 30, scale: 0.97 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="grid h-10 w-10 place-items-center rounded-2xl text-xl" style={{ background: mode === "after" ? "#16a34a" : "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{mode === "after" ? "✅" : "✨"}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{mode === "after" ? "Ya tienes la versión nueva" : "Nuevo en esta página"}</p>
            <h2 className="text-lg font-black leading-tight">{note.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>{note.summary}</p>
          {note.demo?.length ? <Simulator key={note.id} steps={note.demo} /> : null}
          {notes.length > 1 ? (
            <div className="flex items-center justify-center gap-1.5">
              {notes.map((n, k) => (
                <button key={n.id} type="button" onClick={() => setI(k)} aria-label={`Ver «${n.title}»`} className="grid h-8 w-8 place-items-center">
                  <span className="h-2.5 rounded-full transition-all" style={{ width: k === i ? 22 : 10, background: k === i ? "var(--t-accent)" : "var(--t-card-border)" }} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            {notes.length > 1 && i < notes.length - 1 ? (
              <button type="button" onClick={() => setI(i + 1)} className="min-h-12 flex-1 rounded-2xl border px-4 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Siguiente novedad →</button>
            ) : null}
            {mode === "before" ? (
              <button type="button" onClick={() => applyUpdate()} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
                <RefreshCw size={16} /> Actualizar ahora
              </button>
            ) : (
              <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-2xl px-4 text-sm font-black text-white" style={{ background: "#16a34a" }}>¡Entendido!</button>
            )}
          </div>
          {mode === "before" ? <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Actualiza cuando termines lo que estás haciendo. Si cambias de sección, se actualiza sola.</p> : null}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Simulador: los pasos del cambio aparecen uno a uno con un dedo que toca, en bucle. */
function Simulator({ steps }: { steps: Array<{ icon: string; text: string }> }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setAt((x) => (x + 1) % (steps.length + 2)), 1300);
    return () => window.clearInterval(t);
  }, [steps.length]);
  return (
    <div className="relative overflow-hidden rounded-[26px] border-4 p-3" aria-label="Simulador del cambio" role="img"
      style={{ borderColor: "color-mix(in oklab, var(--t-text) 18%, transparent)", background: "var(--t-card-bg)" }}>
      <div className="mx-auto mb-2 h-1.5 w-12 rounded-full" style={{ background: "var(--t-card-border)" }} aria-hidden />
      <ol className="space-y-2">
        {steps.map((s, k) => {
          const shown = k <= at;
          const now = k === at;
          return (
            <motion.li key={k} animate={{ opacity: shown ? 1 : 0.18, x: shown ? 0 : 8, scale: now ? 1.02 : 1 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="relative flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm"
              style={{ borderColor: now ? "var(--t-accent)" : "var(--t-card-border)", background: now ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent" }}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "var(--t-card-bg-soft)" }}>{s.icon}</span>
              <span className="min-w-0 flex-1 font-semibold">{s.text}</span>
              {now ? <motion.span aria-hidden className="text-xl" initial={{ y: 10, opacity: 0 }} animate={{ y: [6, -2, 6], opacity: 1 }} transition={{ duration: 0.9, repeat: Infinity }}>👆</motion.span> : null}
            </motion.li>
          );
        })}
      </ol>
      {at >= steps.length ? <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 text-center text-xs font-bold" style={{ color: "#22c55e" }}>✓ ¡Así de fácil!</motion.p> : null}
    </div>
  );
}
