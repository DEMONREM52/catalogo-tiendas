"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ChevronDown, CreditCard, Download, MessageCircle, Rocket, Search, ShieldCheck, Store, Tags, Target, type LucideIcon } from "lucide-react";

/**
 * Preguntas frecuentes como un chat de soporte: cada pregunta con su ícono; al abrirla, RemHub «escribe» y responde.
 * Mientras nadie toque, un buscador escribe las preguntas solo y las va abriendo una a una (demostración).
 */

const ICONS: LucideIcon[] = [Download, Store, Tags, Rocket, Target, CreditCard, ShieldCheck];

export function FaqSection({ items, waHref }: { items: Array<{ q: string; a: string }>; waHref: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-100px" });
  const still = useReducedMotion();
  const [open, setOpen] = useState<number | null>(0);
  const [auto, setAuto] = useState(true);
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState(0);

  // Demostración: escribe la siguiente pregunta en el buscador y la abre.
  useEffect(() => {
    if (!inView || !auto || still) return;
    const q = items[cursor % items.length].q;
    let i = 0;
    const ids: number[] = [];
    const type = () => {
      i += 1;
      setTyped(q.slice(0, i));
      if (i < q.length) ids.push(window.setTimeout(type, 35));
      else ids.push(window.setTimeout(() => { setOpen(cursor % items.length); ids.push(window.setTimeout(() => setCursor((c) => c + 1), 4200)); }, 350));
    };
    ids.push(window.setTimeout(type, 600));
    return () => ids.forEach((t) => window.clearTimeout(t));
  }, [inView, auto, still, cursor, items]);

  const take = () => { if (auto) { setAuto(false); setTyped(""); } };

  return (
    <div ref={ref} className="space-y-3">
      {/* buscador que escribe solo */}
      <div className="rh-glow flex items-center gap-2 rounded-2xl border px-4 py-3 font-mono text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }} aria-hidden>
        <Search size={16} style={{ color: "var(--t-accent)" }} />
        <span className="min-w-0 flex-1 truncate" style={{ color: typed ? "var(--t-text)" : "var(--t-muted)" }}>
          {typed || (auto ? "buscando tu duda…" : "toca una pregunta")}
          <span className="dfx-caret ml-0.5 inline-block h-4 w-1.5 translate-y-0.5" style={{ background: "var(--t-accent)" }} />
        </span>
        <span className="hidden rounded-full px-2 py-0.5 text-[10px] sm:inline" style={{ background: "var(--t-card-bg-soft)", color: "var(--t-muted)" }}>{auto ? "▶ demostración" : "✋ tú tienes el control"}</span>
      </div>

      {items.map((f, i) => {
        const Icon = ICONS[i % ICONS.length];
        const isOpen = open === i;
        return (
          <motion.div key={f.q} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}
            className="rh-glow overflow-hidden rounded-2xl border" style={{ borderColor: isOpen ? "color-mix(in oklab, var(--t-accent) 55%, transparent)" : "var(--t-card-border)", background: "var(--t-card-bg)", transition: "border-color .3s" }}>
            <button type="button" onClick={() => { take(); setOpen(isOpen ? null : i); }} className="flex w-full items-center justify-between gap-3 p-4 text-left font-semibold" aria-expanded={isOpen}>
              <span className="flex items-center gap-3">
                <motion.span animate={{ rotate: isOpen ? [0, -12, 12, 0] : 0, scale: isOpen ? 1.08 : 1 }} transition={{ duration: 0.5 }} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: isOpen ? "var(--t-cta)" : "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: isOpen ? "#fff" : "var(--t-accent)" }}>
                  <Icon size={17} />
                </motion.span>
                <span><span className="mr-2 font-mono text-xs" style={{ color: "var(--t-accent)" }}>{String(i + 1).padStart(2, "0")}</span>{f.q}</span>
              </span>
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }}><ChevronDown size={18} /></motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div key="a" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 pb-4">
                  <Answer text={f.a} still={!!still} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        );
      })}

      <motion.a href={waHref} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="rh-glow flex items-center gap-3 rounded-2xl border p-4 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-emerald-500/40" />
          <MessageCircle size={18} className="relative" />
        </span>
        <span className="min-w-0 flex-1"><b className="block">¿Otra duda?</b><span className="text-sm" style={{ color: "var(--t-muted)" }}>Escríbenos por WhatsApp y te respondemos.</span></span>
        <span className="font-mono text-xs" style={{ color: "var(--t-accent)" }}>{"→ abrir chat"}</span>
      </motion.a>
    </div>
  );
}

/** Respuesta como burbuja de chat: primero «escribiendo…», luego el texto y «✓ resuelto». */
function Answer({ text, still }: { text: string; still: boolean }) {
  const [ready, setReady] = useState(still);
  useEffect(() => {
    if (still) return;
    const t = window.setTimeout(() => setReady(true), 650);
    return () => window.clearTimeout(t);
  }, [still]);
  return (
    <div className="flex items-start gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0b0716] ring-2 ring-fuchsia-500/40">
        <Image src="/remhub-icon-64.png" alt="" width={28} height={28} className="h-[90%] w-[90%] object-contain" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm" style={{ background: "var(--t-card-bg-soft)" }}>
        {ready ? (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <p style={{ color: "var(--t-text)" }}>{text}</p>
            <motion.p initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 }} className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500">✓ resuelto</motion.p>
          </motion.div>
        ) : (
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>RemHub está escribiendo<span className="dh-dot">.</span><span className="dh-dot" style={{ animationDelay: ".2s" }}>.</span><span className="dh-dot" style={{ animationDelay: ".4s" }}>.</span></p>
        )}
      </div>
    </div>
  );
}
