"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { MoneyField } from "@/components/forms/Fields";

export type PayMethod = "efectivo" | "transferencia" | "nequi" | "tarjeta" | "mixto";
export type PayPart = { method: Exclude<PayMethod, "mixto">; amount: number | null };
export type PaymentState = { method: PayMethod; received: number | null; parts: PayPart[] };

export const EMPTY_PAYMENT: PaymentState = { method: "efectivo", received: null, parts: [] };

const METHODS: Array<{ value: PayMethod; label: string; icon: string }> = [
  { value: "efectivo", label: "Efectivo", icon: "💵" },
  { value: "transferencia", label: "Transferencia", icon: "🏦" },
  { value: "nequi", label: "Nequi / Daviplata", icon: "📱" },
  { value: "tarjeta", label: "Tarjeta", icon: "💳" },
  { value: "mixto", label: "Mixto", icon: "🔀" },
];
const SINGLE = METHODS.filter((m) => m.value !== "mixto") as Array<{ value: PayPart["method"]; label: string; icon: string }>;
const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;

/** Billetes sugeridos: el exacto y los siguientes redondeos útiles. */
function quickBills(total: number) {
  const out = new Set<number>([total]);
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** Resultado para guardar con la venta (método, partes, recibido y vuelto). */
export function paymentSummary(p: PaymentState, total: number) {
  if (p.method === "mixto") {
    const parts = p.parts.filter((x) => (x.amount ?? 0) > 0).map((x) => ({ method: x.method, amount: x.amount ?? 0 }));
    const paid = parts.reduce((s, x) => s + x.amount, 0);
    const cash = parts.filter((x) => x.method === "efectivo").reduce((s, x) => s + x.amount, 0);
    return { method: "mixto", parts, received: paid, change: Math.max(0, paid - total), missing: Math.max(0, total - paid), cash };
  }
  const received = p.method === "efectivo" ? (p.received ?? total) : total;
  return { method: p.method, parts: [{ method: p.method, amount: total }], received, change: Math.max(0, received - total), missing: Math.max(0, total - received), cash: p.method === "efectivo" ? total : 0 };
}

export function PosPayment({ total, value, onChange }: { total: number; value: PaymentState; onChange: (p: PaymentState) => void }) {
  const sum = paymentSummary(value, total);
  return (
    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
      <p className="text-xs font-black">💰 ¿Cómo paga?</p>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 text-xs [scrollbar-width:none]">
        {METHODS.map((m) => (
          <button key={m.value} type="button"
            onClick={() => onChange({ ...value, method: m.value, parts: m.value === "mixto" && !value.parts.length ? [{ method: "efectivo", amount: null }, { method: "transferencia", amount: null }] : value.parts })}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition"
            style={value.method === m.value ? { background: "var(--t-accent)", color: "#fff", boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 35%, transparent)" } : { border: "1px solid var(--t-card-border)" }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {value.method === "efectivo" ? (
        <div className="mt-2.5 space-y-2">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {quickBills(total).map((b) => (
              <button key={b} type="button" onClick={() => onChange({ ...value, received: b })} className="rounded-xl border px-2.5 py-1.5 text-xs font-bold tabular-nums transition active:scale-95"
                style={value.received === b ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                {b === total ? "✨ Exacto" : money(b)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <MoneyField value={value.received} onChange={(v) => onChange({ ...value, received: v })} placeholder="Recibido" ariaLabel="Dinero recibido" />
            <div className="rounded-xl px-3 py-2 text-right" style={{ background: sum.missing > 0 ? "rgba(239,68,68,.12)" : "rgba(34,197,94,.12)" }}>
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{sum.missing > 0 ? "Falta" : "Vuelto"}</p>
              <motion.p key={sum.change - sum.missing} initial={{ scale: 1.2 }} animate={{ scale: 1 }} className={`text-lg font-black tabular-nums ${sum.missing > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {money(sum.missing > 0 ? sum.missing : sum.change)}
              </motion.p>
            </div>
          </div>
        </div>
      ) : value.method === "mixto" ? (
        <div className="mt-2.5 space-y-2">
          <AnimatePresence initial={false}>
            {value.parts.map((part, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
                <select value={part.method} onChange={(e) => onChange({ ...value, parts: value.parts.map((p, j) => (j === i ? { ...p, method: e.target.value as PayPart["method"] } : p)) })}
                  className="rounded-xl border px-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)", minHeight: 42, padding: "0 8px", width: "auto" }}>
                  {SINGLE.map((m) => <option key={m.value} value={m.value}>{m.icon} {m.label}</option>)}
                </select>
                <MoneyField value={part.amount} onChange={(v) => onChange({ ...value, parts: value.parts.map((p, j) => (j === i ? { ...p, amount: v } : p)) })} ariaLabel="Valor" />
                <button type="button" aria-label="Quitar" onClick={() => onChange({ ...value, parts: value.parts.filter((_, j) => j !== i) })} className="grid h-8 w-8 place-items-center rounded-full opacity-60 hover:opacity-100"><X size={14} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="flex items-center justify-between gap-2 text-xs">
            <button type="button" onClick={() => onChange({ ...value, parts: [...value.parts, { method: "efectivo", amount: sum.missing || null }] })} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>
              <Plus size={12} /> Otra forma
            </button>
            {sum.missing > 0 ? (
              <button type="button" onClick={() => { const i = value.parts.findIndex((p) => !p.amount); const idx = i >= 0 ? i : value.parts.length - 1; onChange({ ...value, parts: value.parts.map((p, j) => (j === idx ? { ...p, amount: (p.amount ?? 0) + sum.missing } : p)) }); }}
                className="text-xs font-black text-red-400">Falta {money(sum.missing)} · completar</button>
            ) : (
              <span className="text-xs font-black text-emerald-400">✅ Completo{sum.change > 0 ? ` · vuelto ${money(sum.change)}` : ""}</span>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Recibe {money(total)} por {METHODS.find((m) => m.value === value.method)?.label.toLowerCase()}.</p>
      )}
    </div>
  );
}
