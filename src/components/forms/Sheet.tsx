"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, CreditCard, Landmark, Smartphone, Wallet, X } from "lucide-react";
import Swal from "sweetalert2";
import { Field, MoneyField } from "./Fields";

const swalTheme = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" };

/** Pregunta antes de perder cambios sin guardar. */
export async function confirmDiscard() {
  const r = await Swal.fire({
    ...swalTheme, icon: "question", title: "¿Descartar los cambios?", text: "Tienes cambios sin guardar.",
    showCancelButton: true, confirmButtonText: "Descartar", cancelButtonText: "Seguir editando", reverseButtons: true, focusCancel: true,
  });
  return r.isConfirmed;
}

/**
 * Ventana inferior en el celular y centrada en el computador.
 * Con `dirty`, al cerrar (X, fondo o Escape) pregunta si se descartan los cambios.
 */
export function Sheet({ title, subtitle, icon, onClose, children, footer, wide, dirty }: {
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dirty?: boolean;
}) {
  const close = async () => {
    if (dirty && !(await confirmDiscard())) return;
    onClose();
  };
  return createPortal(
    <motion.div className="fixed inset-0 z-140 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { e.stopPropagation(); void close(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); void close(); } }}>
      <motion.div role="dialog" aria-modal="true" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[94dvh] w-full ${wide ? "max-w-4xl" : "max-w-xl"} flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl`}
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full sm:hidden" style={{ background: "var(--t-card-border)" }} aria-hidden />
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          {icon ? <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black">{title}</h2>
            {subtitle ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={() => void close()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer> : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export const PAY_METHODS: Array<{ value: string; label: string; icon: ReactNode }> = [
  { value: "cash", label: "Efectivo", icon: <Banknote size={14} /> },
  { value: "transfer", label: "Transferencia", icon: <Landmark size={14} /> },
  { value: "nequi", label: "Nequi / Daviplata", icon: <Smartphone size={14} /> },
  { value: "card", label: "Tarjeta", icon: <CreditCard size={14} /> },
  { value: "other", label: "Otro", icon: <Wallet size={14} /> },
];
const fmt = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");

export type PaymentInput = { amount: number; method: string; ref: string; key: string };

/** Registrar un pago (total o parcial). La llave se crea al abrir: si se reintenta no se duplica. */
export function PaymentSheet({ open, title, who, pending, hint, defaultMethod = "transfer", onClose, onConfirm }: {
  open: boolean; title: string; who?: ReactNode; pending: number; hint?: ReactNode; defaultMethod?: string;
  onClose: () => void; onConfirm: (p: PaymentInput) => Promise<boolean | void>;
}) {
  return <AnimatePresence>{open ? <PaymentInner key="pay" title={title} who={who} pending={pending} hint={hint} defaultMethod={defaultMethod} onClose={onClose} onConfirm={onConfirm} /> : null}</AnimatePresence>;
}

function PaymentInner({ title, who, pending, hint, defaultMethod, onClose, onConfirm }: { title: string; who?: ReactNode; pending: number; hint?: ReactNode; defaultMethod: string; onClose: () => void; onConfirm: (p: PaymentInput) => Promise<boolean | void> }) {
  const [amount, setAmount] = useState<number | null>(pending);
  const [method, setMethod] = useState(defaultMethod);
  const [ref, setRef] = useState("");
  const [key] = useState(() => `pay-${crypto.randomUUID()}`);
  const [saving, setSaving] = useState(false);
  const too = (amount ?? 0) > pending + 0.001;
  const ok = (amount ?? 0) > 0 && !too;
  async function go() {
    setSaving(true);
    const r = await onConfirm({ amount: amount ?? 0, method, ref: ref.trim(), key });
    setSaving(false);
    if (r !== false) onClose();
  }
  return (
    <Sheet title={title} subtitle={who} icon={<Banknote size={18} />} onClose={onClose} dirty={amount !== pending || ref !== ""}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
          <span className="flex-1" />
          <button type="button" disabled={!ok || saving} onClick={() => void go()} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-40" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}>
            <Banknote size={15} /> {saving ? "Registrando…" : `Registrar ${fmt(amount ?? 0)}`}
          </button>
        </>
      }>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Pendiente</p>
          <p className="text-xl font-black tabular-nums">{fmt(pending)}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Quedaría</p>
          <p className="text-xl font-black tabular-nums" style={{ color: too ? "#e66767" : undefined }}>{fmt(Math.max(0, pending - (amount ?? 0)))}</p>
        </div>
      </div>
      <Field label="¿Cuánto pagas?" error={too ? "No puede ser más de lo pendiente." : undefined}>
        <MoneyField big value={amount} onChange={setAmount} autoFocus />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {[1, 0.5].map((f) => (
          <button key={f} type="button" onClick={() => setAmount(Math.round(pending * f))} className="rounded-full border px-3 py-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>{f === 1 ? "Todo lo pendiente" : "La mitad"}</button>
        ))}
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-bold">¿Cómo se pagó?</span>
        <div className="flex flex-wrap gap-1.5">
          {PAY_METHODS.map((m) => (
            <button key={m.value} type="button" onClick={() => setMethod(m.value)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition"
              style={method === m.value ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>
              {m.icon}{m.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Referencia o comprobante (opcional)">
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ej.: transferencia 7781" className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
      </Field>
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint ?? "Queda registrado en RemHub; no confirma que el banco haya hecho la transferencia."}</p>
    </Sheet>
  );
}
