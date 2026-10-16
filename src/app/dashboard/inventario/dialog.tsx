"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

/** Piezas comunes de las ventanas del ERP (cuentas por pagar, cuenta con puntos…). */

export function Modal({ title, subtitle, children, footer, onClose, wide }: { title: string; subtitle?: string; children: ReactNode; footer: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <motion.div className="fixed inset-0 z-150 grid place-items-center bg-black/55 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog" aria-modal="true"
        className={`flex max-h-[92vh] flex-col ${wide ? "w-[min(920px,100%)]" : "w-[min(560px,100%)]"} overflow-hidden rounded-3xl border text-sm shadow-2xl`}
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <h3 className="text-base font-bold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{subtitle}</p> : null}
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer>
      </motion.div>
    </motion.div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold">{label}</p>
      {hint ? <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : <div className="mb-2" />}
      {children}
    </div>
  );
}

export function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border px-3 py-1.5 font-semibold transition"
      style={on ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--t-card-border)" }}>
      <span>{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-violet-500" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
