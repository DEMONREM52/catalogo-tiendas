"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ShieldCheck, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { playTone, unlockAudioOnFirstTouch } from "@/lib/sounds/tones";

type Req = {
  id: string; product_name: string; qty: number; list_price: number; floor_price: number; requested_price: number;
  note: string | null; point_name: string | null; requested_by_name: string | null; created_at: string; expires_at: string; mine: boolean;
};

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Solicitudes de vender por debajo del límite (para quien tiene «Autorizar precios»).
 * Suena al llegar una nueva y se aprueba o rechaza con un toque. Revisa cada 8 s.
 */
export function PriceApprovalWatcher({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const heard = useRef(new Set<string>());

  const check = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_price_approvals_pending", { p_store: storeId });
    const res = data as { ok?: boolean; rows?: Req[] } | null;
    if (error || !res?.ok) return setRows([]);
    const list = (res.rows ?? []).filter((r) => !r.mine);
    if (list.some((r) => !heard.current.has(r.id))) playTone("caja-registradora", 0.9);
    list.forEach((r) => heard.current.add(r.id));
    setRows(list);
  }, [storeId]);

  useEffect(() => {
    unlockAudioOnFirstTouch();
    const first = window.setTimeout(() => void check(), 2500);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 8000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [check]);

  async function decide(r: Req, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      const res = await Swal.fire({
        title: "¿Por qué la rechazas?", input: "text", inputPlaceholder: "Ej.: ese precio deja pérdida", showCancelButton: true,
        confirmButtonText: "Rechazar", cancelButtonText: "Volver", confirmButtonColor: "#ef4444", background: "var(--t-bg-base)", color: "var(--t-text)",
        inputValidator: (v) => (v.trim().length < 3 ? "Escribe el motivo (mínimo 3 letras)" : undefined),
      });
      if (!res.isConfirmed) return;
      note = String(res.value).trim();
    }
    setBusy(r.id);
    const { data, error } = await supabaseBrowser().rpc("erp_price_approval_decide", { p_id: r.id, p_approve: approve, p_note: note });
    setBusy(null);
    const out = data as { ok?: boolean; message?: string } | null;
    if (error || out?.ok === false) {
      void Swal.fire({ icon: "warning", title: "No se pudo", html: esc(error?.message ?? out?.message), background: "var(--t-bg-base)", color: "var(--t-text)" });
    }
    setRows((cur) => cur.filter((x) => x.id !== r.id));
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-130 flex w-[min(380px,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-5 sm:right-5" aria-live="polite">
      <AnimatePresence initial={false}>
        {rows.slice(0, 3).map((r) => {
          const pct = r.list_price > 0 ? Math.round(((r.list_price - r.requested_price) / r.list_price) * 1000) / 10 : 0;
          return (
            <motion.div key={r.id} layout initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }} role="alert"
              className="pointer-events-auto overflow-hidden rounded-2xl border shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              style={{ borderColor: "color-mix(in oklab, #f59e0b 55%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-bg-base) 93%, transparent)", color: "var(--t-text)" }}>
              <div className="flex gap-3 p-3.5">
                <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "rgba(245,158,11,.18)", color: "#f59e0b" }}>
                  <ShieldCheck size={20} />
                </motion.span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">🔓 Autorizar precio</p>
                  <p className="mt-0.5 text-xs"><b>{r.requested_by_name ?? "Un vendedor"}</b>{r.point_name ? ` · 📍 ${r.point_name}` : ""} quiere vender</p>
                  <p className="mt-1 line-clamp-2 text-xs font-bold">{r.qty} × {r.product_name}</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[11px]">
                    <span className="rounded-lg border px-1 py-1" style={{ borderColor: "var(--t-card-border)" }}>Lista<br /><b className="tabular-nums">{money(r.list_price)}</b></span>
                    <span className="rounded-lg border px-1 py-1" style={{ borderColor: "var(--t-card-border)" }}>Su mínimo<br /><b className="tabular-nums">{money(r.floor_price)}</b></span>
                    <span className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-1 py-1">Pide<br /><b className="tabular-nums">{money(r.requested_price)}</b></span>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>−{pct.toLocaleString("es-CO")} % del precio de lista{r.note ? ` · 💬 ${r.note}` : ""}</p>
                  <div className="mt-2 flex gap-2 text-xs">
                    <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-black text-white disabled:opacity-60" style={{ background: "#22c55e" }}>
                      <Check size={14} /> Aprobar
                    </button>
                    <button type="button" disabled={busy === r.id} onClick={() => void decide(r, false)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60" style={{ borderColor: "rgba(239,68,68,.5)" }}>
                      <X size={14} /> Rechazar
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {rows.length > 3 ? <p className="pointer-events-auto rounded-full border px-3 py-1 text-center text-[11px] font-bold backdrop-blur" style={{ borderColor: "var(--t-card-border)" }}>+{rows.length - 3} solicitudes más</p> : null}
    </div>
  );
}
