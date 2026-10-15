"use client";

import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Lock, Minus, Plus, Trash2 } from "lucide-react";
import { MoneyField } from "@/components/forms/Fields";
import type { ApprovalState, FloorInfo } from "./usePriceFloors";

export type CartLine = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  priceLevel: number;
  note: string;
  /** El precio lo cambió el vendedor a mano (no lo pisa el cambio de lista). */
  manual?: boolean;
  image?: string | null;
  stock?: number | null;
  /** Precios 1 a 5 de este producto en el punto. */
  levels: number[];
};

export type LineStatus = "list" | "discount" | "approved" | "pending" | "blocked" | "unknown";

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
/** Campo «desnudo» (anula el estilo global de inputs). */
const bare: CSSProperties = { border: "none", background: "transparent", boxShadow: "none", minHeight: 0, padding: 0, borderRadius: 0, outline: "none" };

/** Semáforo de una línea: 🟢 precio de lista · 🟡 con descuento permitido · 🔴 necesita autorización. */
export function lineStatus(line: CartLine, floors: FloorInfo | null, approval?: ApprovalState): LineStatus {
  const list = line.levels[line.priceLevel - 1] ?? line.price;
  if (line.price >= list) return "list";
  if (!floors) return "unknown";
  if (floors.free) return "discount";
  const floor = floors.floors[line.productId]?.floor;
  if (floor === undefined) return "unknown";
  if (line.price >= floor) return "discount";
  if (approval?.status === "approved" && line.price >= approval.price) return "approved";
  if (approval?.status === "pending" && line.price >= approval.price) return "pending";
  return "blocked";
}

const STATUS: Record<LineStatus, { dot: string; label: string; color: string }> = {
  list: { dot: "🟢", label: "Precio de lista", color: "#22c55e" },
  discount: { dot: "🟡", label: "Con descuento", color: "#f59e0b" },
  approved: { dot: "✅", label: "Autorizado", color: "#22c55e" },
  pending: { dot: "⏳", label: "Esperando autorización", color: "#38bdf8" },
  blocked: { dot: "🔴", label: "Necesita autorización", color: "#ef4444" },
  unknown: { dot: "⚪", label: "Precio editado", color: "var(--t-muted)" },
};

function QtyStepper({ qty, max, onChange }: { qty: number; max?: number | null; onChange: (n: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const over = max !== null && max !== undefined && qty > max;
  return (
    <div className="flex items-center rounded-full border" style={{ borderColor: over ? "rgba(239,68,68,.6)" : "var(--t-card-border)" }}>
      <button type="button" aria-label="Quitar uno" onClick={() => onChange(Math.max(1, qty - 1))} className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10 active:scale-90">
        <Minus size={14} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Cantidad"
        value={typed ?? String(qty)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 5);
          setTyped(t);
          if (t && Number(t) > 0) onChange(Number(t));
        }}
        onBlur={() => setTyped(null)}
        className="w-10 text-center text-sm font-black tabular-nums"
        style={bare}
      />
      <button type="button" aria-label="Agregar uno" onClick={() => onChange(qty + 1)} className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10 active:scale-90">
        <Plus size={14} />
      </button>
    </div>
  );
}

function Line({ line, floors, approval, onQty, onPrice, onLevel, onRemove, onRequest }: {
  line: CartLine; floors: FloorInfo | null; approval?: ApprovalState;
  onQty: (n: number) => void; onPrice: (p: number) => void; onLevel: (l: number) => void; onRemove: () => void; onRequest: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const status = lineStatus(line, floors, approval);
  const st = STATUS[status];
  const list = line.levels[line.priceLevel - 1] ?? line.price;
  const floor = floors?.free ? 0 : floors?.floors[line.productId]?.floor;
  const pct = list > 0 && line.price < list ? Math.round(((list - line.price) / list) * 1000) / 10 : 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: status === "blocked" ? "rgba(239,68,68,.55)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}
    >
      <div className="flex gap-2.5 p-2.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border text-xl" style={{ borderColor: "var(--t-card-border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {line.image ? <img src={line.image} alt="" className="h-full w-full object-cover" /> : "🛍️"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-bold leading-tight">{line.name}</p>
            <button type="button" onClick={onRemove} aria-label={`Quitar ${line.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-red-400 transition hover:bg-red-500/15">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="text-[11px]">
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left" style={{ color: "var(--t-muted)" }} aria-expanded={open}>
              <span><b style={{ color: "var(--t-text)" }}>{money(line.price)}</b> c/u · P{line.priceLevel}{pct > 0 ? ` · −${pct.toLocaleString("es-CO")} %` : ""}</span>
              <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-bold" style={{ color: st.color, background: `color-mix(in oklab, ${st.color} 14%, transparent)` }}>
                {st.dot} {st.label} <ChevronDown size={11} className={`transition ${open ? "rotate-180" : ""}`} />
              </span>
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <QtyStepper qty={line.qty} max={line.stock} onChange={onQty} />
            <motion.b key={line.qty * line.price} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className="text-base font-black tabular-nums">{money(line.qty * line.price)}</motion.b>
          </div>
          {line.stock !== null && line.stock !== undefined && line.qty > line.stock ? (
            <p className="mt-1 text-[11px] font-semibold text-red-400">Solo hay {line.stock} en este punto.</p>
          ) : null}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open || status === "blocked" ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t px-2.5 pb-2.5 pt-2" style={{ borderColor: "var(--t-card-border)" }}>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {line.levels.map((p, i) => (
                <button key={i} type="button" onClick={() => onLevel(i + 1)} className="rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums transition"
                  style={line.priceLevel === i + 1 && !line.manual ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                  P{i + 1} · {money(p)}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
              <MoneyField value={line.price} onChange={(v) => onPrice(v ?? 0)} allowEmpty={false} ariaLabel={`Precio de ${line.name}`} />
              <div className="flex gap-1 text-[11px]">
                {[5, 10].map((d) => (
                  <button key={d} type="button" onClick={() => onPrice(Math.round(list * (1 - d / 100) / 100) * 100)} className="rounded-xl border px-2 py-2 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    −{d}%
                  </button>
                ))}
              </div>
            </div>
            {floors && !floors.free && floor !== undefined ? (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                <Lock size={10} className="mr-0.5 inline" /> Puedes bajar hasta <b style={{ color: "var(--t-text)" }}>{money(floor)}</b>
                {floor < list ? ` (−${(Math.round(((list - floor) / list) * 1000) / 10).toLocaleString("es-CO")} %)` : " · sin descuento"}
              </p>
            ) : floors?.free ? (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>🔓 Tienes permiso para vender a cualquier precio.</p>
            ) : null}

            {status === "blocked" ? (
              <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5">
                <p className="text-xs font-semibold">🔴 Este precio está por debajo de tu límite. Pide autorización o súbelo.</p>
                {approval?.status === "rejected" ? <p className="mt-1 text-[11px] text-red-300">❌ {approval.by ?? "Rechazada"}: {approval.note ?? "sin motivo"}</p> : null}
                {approval?.status === "expired" ? <p className="mt-1 text-[11px] text-amber-300">⌛ La solicitud venció. Pídela otra vez.</p> : null}
                <div className="mt-2 flex gap-2 text-xs">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (opcional): cliente frecuente…" className="min-w-0 flex-1 rounded-xl border px-2.5 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", minHeight: 34, padding: "0 10px", fontSize: 12 }} />
                  <button type="button" disabled={asking} onClick={async () => { setAsking(true); try { await onRequest(note); } finally { setAsking(false); } }}
                    className="shrink-0 rounded-xl px-3 text-xs font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#ef4444,#f59e0b)", minHeight: 34 }}>
                    {asking ? "Enviando…" : "🔓 Pedir autorización"}
                  </button>
                </div>
              </div>
            ) : status === "pending" ? (
              <p className="mt-2 flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-2.5 text-xs font-semibold">
                <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}>⏳</motion.span>
                Esperando que un encargado apruebe {money(approval!.price)}… (le llegó el aviso con sonido)
              </p>
            ) : status === "approved" ? (
              <p className="mt-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs font-semibold">✅ Autorizado por {approval?.by ?? "el encargado"}. Vale para esta venta.</p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

export function PosCartLines({ lines, floors, approvals, onQty, onPrice, onLevel, onRemove, onRequest }: {
  lines: CartLine[]; floors: FloorInfo | null; approvals: Record<string, ApprovalState>;
  onQty: (id: string, n: number) => void; onPrice: (id: string, p: number) => void; onLevel: (id: string, l: number) => void;
  onRemove: (id: string) => void; onRequest: (id: string, note: string) => Promise<void>;
}) {
  if (!lines.length) {
    return (
      <div className="mt-3 grid place-items-center rounded-2xl border border-dashed px-4 py-8 text-center" style={{ borderColor: "var(--t-card-border)" }}>
        <motion.span animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2.2 }} className="text-4xl">🛒</motion.span>
        <p className="mt-2 text-sm font-bold">El carrito está vacío</p>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Toca un producto o escanea su código para empezar.</p>
      </div>
    );
  }
  return (
    <ul className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <Line key={l.productId} line={l} floors={floors} approval={approvals[l.productId]}
            onQty={(n) => onQty(l.productId, n)} onPrice={(p) => onPrice(l.productId, p)} onLevel={(lv) => onLevel(l.productId, lv)}
            onRemove={() => onRemove(l.productId)} onRequest={(note) => onRequest(l.productId, note)} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
