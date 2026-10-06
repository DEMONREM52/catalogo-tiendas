"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Printer, X } from "lucide-react";
import type { PrintFormat } from "./PrintReceipt";

const OPTIONS: Array<{ key: PrintFormat; title: string; hint: string; paperW: number; paperH: number }> = [
  { key: "carta", title: "Hoja carta", hint: "Impresora normal · 21,6 × 27,9 cm", paperW: 44, paperH: 56 },
  { key: "t80", title: "Tirilla 80 mm", hint: "Impresora POS estándar", paperW: 26, paperH: 64 },
  { key: "t58", title: "Tirilla 58 mm", hint: "Impresora POS pequeña", paperW: 19, paperH: 64 },
];

/** Miniatura del papel con líneas simuladas del comprobante. */
function Paper({ w, h, active, ticket }: { w: number; h: number; active: boolean; ticket: boolean }) {
  return (
    <div className="flex h-[72px] items-end justify-center">
      <motion.div
        animate={{ y: active ? -4 : 0, rotate: active ? -2 : 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
        className="relative overflow-hidden rounded-[5px] bg-white shadow-md"
        style={{ width: w, height: h, boxShadow: active ? "0 10px 24px rgba(0,0,0,.28)" : "0 4px 10px rgba(0,0,0,.18)" }}
      >
        <div className="space-y-[3px] p-[4px]">
          <div className="mx-auto h-[4px] rounded-full bg-slate-700" style={{ width: ticket ? "70%" : "45%", marginLeft: ticket ? "auto" : 0 }} />
          {Array.from({ length: ticket ? 7 : 6 }).map((_, i) => (
            <div key={i} className="flex justify-between gap-[2px]">
              <div className="h-[2px] rounded-full bg-slate-300" style={{ width: `${55 - (i % 3) * 10}%` }} />
              <div className="h-[2px] w-[22%] rounded-full bg-slate-400" />
            </div>
          ))}
          <div className="ml-auto h-[4px] w-[40%] rounded-full" style={{ background: "var(--t-accent, #a855f7)" }} />
        </div>
        {ticket ? (
          <div
            className="absolute inset-x-0 bottom-0 h-[5px]"
            style={{ background: "radial-gradient(circle at 3px -1px, transparent 3px, white 3.5px) 0 0 / 6px 5px repeat-x", filter: "brightness(.92)" }}
          />
        ) : null}
      </motion.div>
    </div>
  );
}

export function PrintFormatPicker({
  open, initial, onCancel, onConfirm,
}: {
  open: boolean; initial: PrintFormat; onCancel: () => void; onConfirm: (format: PrintFormat) => void;
}) {
  const [selected, setSelected] = useState<PrintFormat>(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setSelected(initial);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm(selected);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const i = OPTIONS.findIndex((o) => o.key === selected);
        const next = (i + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
        setSelected(OPTIONS[next].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, onCancel, onConfirm]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="no-print fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
          style={{ background: "color-mix(in oklab, black 55%, transparent)", backdropFilter: "blur(6px)" }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-picker-title"
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-3xl border p-5 sm:p-6"
            style={{
              background: "color-mix(in oklab, var(--t-bg-base) 88%, var(--t-card-bg))",
              borderColor: "var(--t-card-border)",
              color: "var(--t-text)",
              boxShadow: "0 30px 90px rgba(0,0,0,.45)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="print-picker-title" className="flex items-center gap-2 text-xl font-extrabold">
                  <Printer className="h-5 w-5" style={{ color: "var(--t-accent)" }} /> ¿En qué papel vas a imprimir?
                </h2>
                <p className="mt-0.5 text-sm" style={{ color: "var(--t-muted)" }}>El comprobante se ajusta automáticamente al tamaño elegido.</p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90"
                style={{ borderColor: "var(--t-card-border)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3" role="radiogroup" aria-label="Tamaño de impresión">
              {OPTIONS.map((opt) => {
                const active = selected === opt.key;
                return (
                  <motion.button
                    key={opt.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setSelected(opt.key)}
                    onDoubleClick={() => onConfirm(opt.key)}
                    className="relative flex flex-col items-center rounded-2xl border-2 px-2 pb-3 pt-2 text-center transition-colors"
                    style={{
                      borderColor: active ? "var(--t-accent)" : "var(--t-card-border)",
                      background: active
                        ? "color-mix(in oklab, var(--t-accent) 14%, transparent)"
                        : "color-mix(in oklab, var(--t-card-bg-soft) 100%, transparent)",
                    }}
                  >
                    {active ? (
                      <motion.span
                        layoutId="print-check"
                        className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-[11px] font-black text-white"
                        style={{ background: "var(--t-accent)" }}
                      >
                        ✓
                      </motion.span>
                    ) : null}
                    <Paper w={opt.paperW} h={opt.paperH} active={active} ticket={opt.key !== "carta"} />
                    <span className="mt-2 text-sm font-bold leading-tight">{opt.title}</span>
                    <span className="mt-0.5 text-[11px] leading-tight" style={{ color: "var(--t-muted)" }}>{opt.hint}</span>
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-2xl border px-5 py-2.5 text-sm font-semibold transition hover:brightness-110"
                style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
              >
                Cancelar
              </button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => onConfirm(selected)}
                className="flex items-center justify-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                style={{ background: "var(--t-cta)" }}
              >
                <Printer className="h-4 w-4" /> Imprimir {OPTIONS.find((o) => o.key === selected)?.title.toLowerCase()}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
