"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { IMPLEMENTATION_EXTRAS, IMPLEMENTATION_PACKAGES, IMPLEMENTATION_TERMS, TRADITIONAL_VS_REMHUB } from "@/lib/saas/implementation";

const cop = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");

/** Paso que avanza cada `ms` mientras se ve (quieto con «reducir movimiento»). */
function useStep(ref: React.RefObject<HTMLDivElement | null>, ms: number) {
  const inView = useInView(ref, { margin: "-40px" });
  const still = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || still) return;
    const t = window.setInterval(() => setStep((s) => s + 1), ms);
    return () => window.clearInterval(t);
  }, [inView, still, ms]);
  return step;
}

const box = { borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" } as const;
const muted = { color: "var(--t-muted)" } as const;

/* ------------------------------------------------ ejemplo de cada paquete (decorativo) */

function SelfServiceDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStep(ref, 700);
  const guide = (Math.floor(step / 6) % 12) + 1;
  const pct = ((step % 6) + 1) * (100 / 6);
  const rows = Math.min(248, (step % 12) * 31);
  return (
    <div ref={ref} aria-hidden className="mt-4 space-y-2 rounded-2xl border p-3 text-[11px]" style={box}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-11 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">▶</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">Guía {guide} de 12 · crear un catálogo</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
            <motion.div animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full" style={{ background: "var(--t-cta)" }} />
          </div>
        </div>
      </div>
      <p className="flex items-center justify-between font-mono">
        <span>📗 plantilla_productos.xlsx</span>
        <b className={rows >= 248 ? "text-emerald-500" : ""}>{rows >= 248 ? "✓ 248 filas" : `${rows} filas…`}</b>
      </p>
    </div>
  );
}

function SetupDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStep(ref, 650);
  const s = step % 12;
  const files = ["productos.xlsx", "terceros.xlsx", "cartera.xlsx"];
  return (
    <div ref={ref} aria-hidden className="mt-4 space-y-2 rounded-2xl border p-3 text-[11px]" style={box}>
      <div className="flex flex-wrap gap-1.5 font-mono">
        {files.map((f, i) => (
          <motion.span key={f} animate={{ opacity: s > i ? 1 : 0.35, y: s > i ? 0 : 4 }} className="rounded-md px-1.5 py-0.5" style={{ background: "var(--t-card-bg)" }}>
            📗 {f}{s > i + 3 ? <b className="ml-1 text-emerald-500">✓</b> : null}
          </motion.span>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
        <motion.div animate={{ width: `${Math.min(100, (s / 7) * 100)}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full bg-emerald-500" />
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1" style={muted}>
        <span>{s >= 7 ? <b className="text-emerald-500">✓ 1.240 productos cargados</b> : "cargando tus datos…"}</span>
        <span>🖨 impresora {s >= 9 ? <b className="text-emerald-500">✓</b> : "…"}</span>
        <span>▮▮▮ lector {s >= 10 ? <b className="text-emerald-500">✓</b> : "…"}</span>
      </p>
    </div>
  );
}

function FullDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStep(ref, 800);
  const s = step % 10;
  const steps = ["Registro", "Pruebas", "Producción"];
  const day = Math.min(30, 1 + (step % 10) * 3);
  return (
    <div ref={ref} aria-hidden className="mt-4 space-y-2 rounded-2xl border p-3 text-[11px]" style={box}>
      <p className="font-bold">Habilitación DIAN</p>
      <div className="flex items-center gap-1">
        {steps.map((t, i) => (
          <span key={t} className="flex flex-1 items-center gap-1">
            <motion.span animate={{ background: s > i * 2 ? "#10b981" : "var(--t-card-border)", scale: s === i * 2 + 1 ? [1, 1.2, 1] : 1 }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black text-white">{s > i * 2 ? "✓" : i + 1}</motion.span>
            <span className="truncate" style={muted}>{t}</span>
            {i < steps.length - 1 ? <span className="h-0.5 flex-1 rounded" style={{ background: s > i * 2 + 1 ? "#10b981" : "var(--t-card-border)" }} /> : null}
          </span>
        ))}
      </div>
      <p className="flex items-center justify-between" style={muted}>
        <span>Acompañamiento</span>
        <b className="tabular-nums" style={{ color: "var(--t-text)" }}>día {day} de 30</b>
      </p>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
        <motion.div animate={{ width: `${(day / 30) * 100}%` }} className="h-full rounded-full" style={{ background: "var(--t-cta)" }} />
      </div>
    </div>
  );
}

const DEMOS: Record<string, () => React.ReactNode> = { autoservicio: SelfServiceDemo, "puesta-en-marcha": SetupDemo, completa: FullDemo };

/** Paquetes de implementación (pago único, opcional). Sirve en la página de inicio y en «Mi plan». */
export function ImplementationPackages({ contactHref }: { contactHref: (text: string) => string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {IMPLEMENTATION_PACKAGES.map((p, pi) => {
          const Demo = DEMOS[p.id];
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.5, delay: pi * 0.12 }} className="h-full">
              <motion.div className="h-full" animate={p.highlight ? { y: [0, -5, 0] } : undefined} transition={p.highlight ? { repeat: Infinity, duration: 4, ease: "easeInOut" } : undefined}>
                <div className={`${p.highlight ? "rh-ring" : "rh-glow"} relative h-full rounded-3xl p-[1.5px] transition hover:-translate-y-1`} style={{ background: p.highlight ? "var(--t-cta)" : "var(--t-card-border)" }}>
                  {p.highlight ? <span className="absolute -top-3 left-5 z-10"><span className="rh-sweep block rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: "var(--t-cta)" }}>Recomendado</span></span> : null}
                  <div className="flex h-full flex-col rounded-[calc(1.5rem-1.5px)] p-5" style={{ background: "var(--t-card-bg)" }}>
                    <p className="text-lg font-black">{p.name}</p>
                    <p className="text-xs" style={muted}>{p.tagline}</p>
                    <p className="mt-3 text-2xl font-black">{p.price ? <>{p.from ? <span className="text-sm font-semibold">desde </span> : null}{cop(p.price)}</> : "Gratis"}</p>
                    <p className="text-xs" style={muted}>{p.price ? "pago único" : "incluido en todos los planes"}</p>
                    <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                      {p.includes.map((i, ii) => (
                        <motion.li key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + pi * 0.12 + ii * 0.07 }} className="flex gap-2">
                          <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.35 + pi * 0.12 + ii * 0.07, type: "spring", stiffness: 400 }} className="text-emerald-500">✓</motion.span>
                          {i}
                        </motion.li>
                      ))}
                    </ul>
                    {Demo ? <Demo /> : null}
                    {p.price ? (
                      <a href={contactHref(`Hola! Me interesa el paquete «${p.name}» de RemHub para mi negocio. ¿Me cuentas cómo sería?`)} target="_blank" rel="noopener noreferrer"
                        className={`${p.highlight ? "rh-sweep text-white" : ""} mt-4 rounded-2xl border px-4 py-2.5 text-center text-sm font-bold transition hover:-translate-y-0.5`} style={p.highlight ? { background: "var(--t-cta)", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                        💬 Lo quiero
                      </a>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" style={muted}>
        {IMPLEMENTATION_EXTRAS.map((e) => <span key={e.name}>{e.name}: <b style={{ color: "var(--t-text)" }}>{e.from ? "desde " : ""}{cop(e.price)}</b> {e.unit}</span>)}
      </div>
      <p className="text-xs" style={muted}>{IMPLEMENTATION_TERMS}</p>
    </div>
  );
}

/**
 * «RemHub vs. sistemas tradicionales», sin nombrar a ninguna empresa. Las filas entran una a una al bajar:
 * lo tradicional se tacha con ✗ y lo de RemHub se ilumina con ✓; el marcador cuenta lo que gana RemHub.
 */
export function TraditionalComparison() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const still = useReducedMotion();
  const total = TRADITIONAL_VS_REMHUB.length;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (still) { const t = window.setTimeout(() => setShown(total), 0); return () => window.clearTimeout(t); }
    const t = window.setInterval(() => setShown((n) => (n >= total ? n : n + 1)), 420);
    return () => window.clearInterval(t);
  }, [inView, still, total]);

  return (
    <div ref={ref} className="space-y-3">
      {/* encabezado: los dos contendores */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="rounded-2xl border p-3 text-center opacity-80" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <p className="text-2xl grayscale">🏢</p>
          <p className="text-sm font-bold" style={muted}>Sistemas tradicionales</p>
        </div>
        <motion.span animate={still ? undefined : { scale: [1, 1.15, 1], rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }} className="grid h-12 w-12 place-items-center rounded-full text-sm font-black text-white shadow-lg" style={{ background: "var(--t-cta)" }}>VS</motion.span>
        <div className="rh-ring rounded-2xl p-[1.5px]">
          <div className="rounded-[calc(1rem-1.5px)] p-3 text-center" style={{ background: "var(--t-card-bg)" }}>
            <p className="text-2xl">🚀</p>
            <p className="text-sm font-black" style={{ color: "var(--t-accent)" }}>RemHub</p>
          </div>
        </div>
      </div>

      <div className="rh-glow overflow-hidden rounded-3xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        {TRADITIONAL_VS_REMHUB.map((r, i) => {
          const on = i < shown;
          return (
            <div key={r.topic} className="grid gap-x-4 gap-y-1.5 border-t px-4 py-3 text-sm first:border-t-0 md:grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="font-semibold">{r.topic}</p>
              <motion.p initial={false} animate={{ opacity: on ? 1 : 0.25 }} className="relative flex items-start gap-2" style={muted}>
                <motion.span initial={false} animate={{ scale: on ? 1 : 0, rotate: on ? 0 : -90 }} transition={{ type: "spring", stiffness: 400 }} className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-500/15 text-[11px] font-black text-rose-500">✗</motion.span>
                <span className="relative">
                  {r.traditional}
                  <motion.span aria-hidden initial={false} animate={{ scaleX: on ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="absolute left-0 top-1/2 h-px w-full origin-left bg-rose-500/70" />
                </span>
              </motion.p>
              <motion.p initial={false} animate={{ opacity: on ? 1 : 0.25, x: on ? 0 : 12 }} transition={{ delay: 0.15 }} className="flex items-start gap-2 rounded-xl px-2 py-1 font-semibold" style={{ background: on ? "rgba(16,185,129,.08)" : "transparent", boxShadow: on && i === shown - 1 ? "0 0 0 1px rgba(16,185,129,.5), 0 0 22px rgba(16,185,129,.25)" : "none", transition: "box-shadow .4s, background .4s" }}>
                <motion.span initial={false} animate={{ scale: on ? [0, 1.35, 1] : 0 }} transition={{ duration: 0.45, delay: 0.2 }} className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-[11px] font-black text-white">✓</motion.span>
                {r.remhub}
              </motion.p>
            </div>
          );
        })}
      </div>

      {/* marcador */}
      <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-sm">
        <span className="rounded-full px-3 py-1" style={{ background: "var(--t-card-bg)" }}>Tradicionales <b>0</b></span>
        <span style={muted}>—</span>
        <span className="rounded-full px-3 py-1 font-bold text-white" style={{ background: "var(--t-cta)" }}>
          RemHub{" "}
          <AnimatePresence mode="popLayout">
            <motion.b key={shown} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="inline-block tabular-nums">{shown}</motion.b>
          </AnimatePresence>
        </span>
        {shown >= total ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-lg">🏆</motion.span> : null}
      </div>
    </div>
  );
}
