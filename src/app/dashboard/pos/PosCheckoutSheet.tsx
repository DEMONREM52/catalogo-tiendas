"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
  total: number;
  /** Total antes de descuentos (si es mayor, se muestra el descuento). */
  listTotal: number;
  money: (n: number) => string;
  /** Cliente: botón con el nombre o el buscador. */
  client: ReactNode;
  documentKind: "remision" | "factura";
  onDocumentKind: (k: "remision" | "factura") => void;
  /** La factura va a la DIAN (factura electrónica encendida en el punto). */
  electronic: boolean;
  paymentType: "contado" | "credito";
  onPaymentType: (t: "contado" | "credito") => void;
  creditLocked: boolean;
  /** «¿Cómo paga?» (contado) o el cupo y los días (crédito). */
  pay: ReactNode;
  /** La frase de lo que va a pasar. */
  summary: ReactNode;
  /** Vendedor, impresión y nota: escondidos hasta que se pidan. */
  more: ReactNode;
  moreHint: string;
  confirmLabel: string;
};

/**
 * Celular: cobrar en una sola hoja. Solo lo que hace falta para cobrar (cliente, documento, cómo paga) y una frase
 * con lo que va a pasar; lo demás queda en «Más opciones».
 */
export function PosCheckoutSheet(p: Props) {
  const { open, onClose } = p;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const seg = (on: boolean) => (on
    ? { background: "var(--t-accent)", color: "#fff", boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 35%, transparent)" }
    : { color: "var(--t-text)" });

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div key="checkout-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/55" onClick={onClose} />
          <motion.div key="checkout" role="dialog" aria-modal="true" aria-label="Cobrar" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92vh] max-w-lg flex-col rounded-t-3xl border-t"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full" style={{ background: "var(--t-card-border)" }} />
            <div className="flex items-start justify-between gap-2 px-4 pt-2">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>💰 Cobrar</p>
                <p className="text-3xl font-black tabular-nums leading-tight">{p.money(p.total)}</p>
                {p.listTotal > p.total ? <p className="text-[11px] text-amber-400">🏷️ Descuento −{p.money(p.listTotal - p.total)}</p> : null}
              </div>
              <button type="button" onClick={onClose} aria-label="Volver al carrito" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }}><X size={18} /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-2 pt-3">
              {p.client}

              <div className="grid grid-cols-2 gap-1 rounded-2xl border p-1" role="radiogroup" aria-label="Documento" style={{ borderColor: "var(--t-card-border)" }}>
                {([
                  { value: "remision", label: "📄 Remisión", hint: "No va a la DIAN" },
                  { value: "factura", label: "🧾 Factura", hint: p.electronic ? "Electrónica · DIAN" : "No electrónica" },
                ] as const).map((o) => (
                  <button key={o.value} type="button" role="radio" aria-checked={p.documentKind === o.value} onClick={() => p.onDocumentKind(o.value)}
                    className="rounded-xl px-3 py-2 text-left transition" style={seg(p.documentKind === o.value)}>
                    <span className="block text-sm font-black">{o.label}</span>
                    <span className="block text-[11px]" style={{ opacity: p.documentKind === o.value ? 0.9 : 0.6 }}>{o.hint}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-2xl border p-1" role="radiogroup" aria-label="Tipo de pago" style={{ borderColor: "var(--t-card-border)" }}>
                {([
                  { value: "contado", label: "💵 De contado" },
                  { value: "credito", label: p.creditLocked ? "🔒 A crédito" : "💳 A crédito" },
                ] as const).map((o) => {
                  const locked = o.value === "credito" && p.creditLocked;
                  return (
                    <button key={o.value} type="button" role="radio" aria-checked={p.paymentType === o.value} disabled={locked} onClick={() => p.onPaymentType(o.value)}
                      title={locked ? "Necesitas el permiso «Vender a crédito»" : undefined}
                      className="rounded-xl px-3 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50" style={seg(p.paymentType === o.value)}>
                      {o.label}
                    </button>
                  );
                })}
              </div>

              <div className="[&>*:first-child]:mt-0!">{p.pay}</div>

              <details className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="font-black">⚙️ Más opciones</span>
                    <span className="block truncate" style={{ color: "var(--t-muted)" }}>{p.moreHint}</span>
                  </span>
                  <span className="shrink-0 font-bold" style={{ color: "var(--t-muted)" }}>▾</span>
                </summary>
                <div className="mt-3 space-y-3">{p.more}</div>
              </details>
            </div>

            <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
              {p.summary}
              <button type="button" disabled={p.saving} onClick={p.onConfirm}
                className="w-full rounded-2xl px-3 py-3.5 text-base font-black text-white transition active:scale-[.99] disabled:opacity-60" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6 55%,#6366f1)" }}>
                {p.saving ? "Creando…" : p.confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
