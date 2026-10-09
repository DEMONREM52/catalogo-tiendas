"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Boxes, CreditCard, FileWarning, Loader2, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Qué puede anular el usuario en esta tienda (lo decide la base de datos). */
export type SaleVoidRights = { void: boolean; return: boolean };

export function useSaleVoidRights(storeId: string | null | undefined): SaleVoidRights | null {
  const [rights, setRights] = useState<SaleVoidRights | null>(null);
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    void supabaseBrowser()
      .rpc("erp_sale_void_rights", { p_store: storeId })
      .then(({ data, error }) => {
        if (!alive) return;
        // Sin la migración todavía: no se muestran los botones.
        setRights(error ? { void: false, return: false } : ((data ?? { void: false, return: false }) as SaleVoidRights));
      });
    return () => {
      alive = false;
    };
  }, [storeId]);
  return rights;
}

export type VoidTarget = {
  orderId: string;
  label: string;
  total: number;
  confirmed: boolean;
  pointName?: string | null;
  units?: number;
  customer?: string | null;
};

export type VoidResult = { ok: true; kind: "void" | "return"; doc_number: string; units_returned: number; receivables_voided: number; fiscal_voided: number };

const REASONS_VOID = ["Error al facturar", "El cliente desistió", "Precio equivocado", "Documento duplicado", "Cliente equivocado"];
const REASONS_RETURN = ["El cliente devolvió el producto", "Producto defectuoso", "Error al facturar", "Precio equivocado", "Documento duplicado"];

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;

/** Ventana para anular un documento sin confirmar o hacer la devolución de uno confirmado. */
export function VoidSaleDialog({ target, onClose, onDone }: { target: VoidTarget | null; onClose: () => void; onDone: (r: VoidResult) => void }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{target ? <Sheet key={target.orderId} target={target} onClose={onClose} onDone={onDone} /> : null}</AnimatePresence>,
    document.body,
  );
}

function Sheet({ target, onClose, onDone }: { target: VoidTarget; onClose: () => void; onDone: (r: VoidResult) => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReturn = target.confirmed;
  const accent = isReturn ? "#f97316" : "#ef4444";
  const reasons = isReturn ? REASONS_RETURN : REASONS_VOID;
  const ready = reason.trim().length >= 5;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, saving]);

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabaseBrowser().rpc("erp_sale_void", { p_order: target.orderId, p_reason: reason.trim() });
    setSaving(false);
    if (err) {
      return setError(/Could not find the function|schema cache/i.test(err.message) ? "Falta ejecutar en Supabase la migración 20261103_anular_ventas.sql." : err.message);
    }
    const res = data as (VoidResult & { ok: boolean; message?: string }) | null;
    if (!res?.ok) return setError(res?.message ?? "No se pudo anular el documento.");
    onDone(res);
  }

  const effects = isReturn
    ? [
        { icon: <Boxes size={16} />, text: `Las unidades vendidas vuelven al inventario${target.pointName ? ` de ${target.pointName}` : " del punto"}${target.units ? ` (${target.units} u.)` : ""}.` },
        { icon: <CreditCard size={16} />, text: "Si fue a crédito, la cuenta por cobrar queda anulada (si tiene abonos, primero hay que anularlos)." },
        { icon: <FileWarning size={16} />, text: "Si tiene factura electrónica sin enviar, también se anula. Si ya llegó a la DIAN, va con nota crédito." },
        { icon: <RotateCcw size={16} />, text: "Si el cliente pagó, recuerda devolverle el dinero." },
      ]
    : [
        { icon: <Boxes size={16} />, text: "Aún no se descontó inventario: no hay nada que devolver." },
        { icon: <Ban size={16} />, text: "El documento queda anulado y ya no se puede editar ni confirmar." },
      ];

  return (
    <motion.div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]" onClick={() => !saving && onClose()} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={isReturn ? "Devolución de venta" : "Anular documento"}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border shadow-[0_30px_90px_rgba(0,0,0,0.5)] sm:max-w-lg sm:rounded-[28px]"
        style={{ borderColor: `color-mix(in oklab, ${accent} 40%, var(--t-card-border))`, background: "var(--t-bg-base)", color: "var(--t-text)" }}
        initial={{ y: 50, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-3xl" style={{ background: `color-mix(in oklab, ${accent} 25%, transparent)` }} />
        <span className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full sm:hidden" style={{ background: "color-mix(in oklab, var(--t-text) 18%, transparent)" }} aria-hidden />
        <header className="relative flex items-start justify-between gap-3 px-5 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: accent }}>
              {isReturn ? <Undo2 size={22} /> : <Ban size={22} />}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>{isReturn ? "Devolución de venta" : "Anular documento"}</p>
              <h2 className="truncate text-lg font-black">{target.label}</h2>
              <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>
                {money(target.total)}{target.customer ? ` · ${target.customer}` : ""}{isReturn ? " · confirmado" : " · sin confirmar"}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        <div className="relative space-y-4 overflow-y-auto px-5 pb-4 sm:px-6">
          <ul className="space-y-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
            {effects.map((e, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex items-start gap-2.5 text-xs leading-5">
                <span className="mt-0.5 shrink-0" style={{ color: accent }}>{e.icon}</span>
                <span>{e.text}</span>
              </motion.li>
            ))}
          </ul>

          <div>
            <p className="text-xs font-bold">Motivo <span className="font-normal" style={{ color: "var(--t-muted)" }}>(queda en el historial)</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5"
                  style={reason === r ? { background: accent, color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Cuenta brevemente qué pasó…"
              className="mt-2 w-full resize-none rounded-2xl border px-3.5 py-3 text-base outline-none transition focus:ring-2 sm:text-sm"
              style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" }}
            />
          </div>

          {isReturn ? (
            <p className="flex items-start gap-2 text-[11px] leading-5" style={{ color: "var(--t-muted)" }}>
              <ShieldAlert size={14} className="mt-0.5 shrink-0" /> Solo usuarios con el permiso «Devolución de venta» pueden hacer esto. Queda registrado quién lo hizo y cuándo.
            </p>
          ) : null}

          <AnimatePresence>
            {error ? (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(239,68,68,.45)", background: "rgba(239,68,68,.1)", color: "#ef4444" }}>
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        <footer className="relative flex gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-2xl border px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            Volver
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready || saving}
            className="inline-flex flex-[1.5] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
            style={{ background: accent }}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : isReturn ? <Undo2 size={16} /> : <Ban size={16} />}
            {saving ? "Procesando…" : isReturn ? "Hacer devolución" : "Anular documento"}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
