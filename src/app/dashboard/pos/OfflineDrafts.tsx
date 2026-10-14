"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CloudOff, Trash2, Upload } from "lucide-react";
import Swal from "sweetalert2";
import { getDrafts, removeDraft, subscribeDrafts, updateDraft, type PosDraft } from "@/lib/pos/drafts";
import { syncOfflineDrafts } from "@/lib/pos/sync";
import { useNetStatus } from "@/lib/net/status";

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;

/** Bandeja de ventas guardadas sin internet: se cargan al POS para registrarlas cuando vuelve la conexión. */
export function OfflineDrafts({ storeId, activeId, onLoad }: { storeId: string | undefined; activeId: string | null; onLoad: (d: PosDraft) => void }) {
  const drafts = useSyncExternalStore(subscribeDrafts, () => getDrafts(storeId), () => getDrafts(null));
  const net = useNetStatus();
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const pendingAuto = drafts.filter((d) => !d.review && d.id !== activeId).length;

  // Al volver internet se envían solas las remisiones guardadas (una sola vez cada una).
  useEffect(() => {
    if (!storeId || !net.online || pendingAuto === 0) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setSending(true);
      void syncOfflineDrafts(storeId, activeId)
        .then((res) => {
          if (!alive || (!res.sent.length && !res.review)) return;
          void Swal.fire({
            toast: true,
            position: "top-end",
            timer: 5000,
            showConfirmButton: false,
            icon: res.review ? "warning" : "success",
            title: res.sent.length ? `${res.sent.length} venta${res.sent.length === 1 ? "" : "s"} sin internet registrada${res.sent.length === 1 ? "" : "s"}` : "Ventas por revisar",
            text: [res.sent.map((s) => s.doc).filter(Boolean).join(", "), res.review ? `${res.review} necesita${res.review === 1 ? "" : "n"} revisión` : ""].filter(Boolean).join(" · "),
            background: "var(--t-bg-base)",
            color: "var(--t-text)",
          });
        })
        .finally(() => alive && setSending(false));
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [storeId, net.online, pendingAuto, activeId]);

  if (!storeId || drafts.length === 0) return null;
  const total = drafts.reduce((s, d) => s + d.total, 0);

  async function discard(d: PosDraft) {
    const ok = await Swal.fire({
      icon: "warning",
      title: "¿Descartar este borrador?",
      text: `${d.customerName} · ${money(d.total)}. No se registrará la venta.`,
      showCancelButton: true,
      confirmButtonText: "Descartar",
      cancelButtonText: "Conservar",
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
      confirmButtonColor: "#ef4444",
    });
    if (ok.isConfirmed) removeDraft(storeId!, d.id);
  }

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border p-3"
      style={{ borderColor: "rgba(245,158,11,.5)", background: "color-mix(in oklab, #f59e0b 9%, var(--t-card-bg))" }}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: "#f59e0b" }}>
          <CloudOff size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm">
            {drafts.length} venta{drafts.length === 1 ? "" : "s"} guardada{drafts.length === 1 ? "" : "s"} sin internet · {money(total)}
          </b>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>
            {!net.online
              ? "Se quedan en este equipo y se envían solas cuando vuelva internet. Aún no descuentan inventario."
              : sending
                ? "Enviando…"
                : "Las que necesitan revisión: cárgalas al carrito y regístralas a mano."}
          </span>
        </span>
        <ChevronDown size={16} className={open ? "rotate-180 transition" : "transition"} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="mt-2 space-y-1.5 overflow-hidden">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: d.id === activeId ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{d.customerName}</b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                    {new Date(d.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} · {d.cart.reduce((s, i) => s + i.qty, 0)} und. · {d.documentKind === "factura" ? "Factura" : "Remisión"}
                  </span>
                  {d.review ? (
                    <span className="mt-0.5 block text-xs text-amber-400">
                      ⚠️ {d.review}{" "}
                      {d.documentKind === "remision" ? (
                        <button type="button" onClick={() => updateDraft(storeId, d.id, { review: undefined })} className="font-bold underline">Reintentar envío</button>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <b className="tabular-nums">{money(d.total)}</b>
                <button type="button" disabled={!net.online || d.id === activeId} onClick={() => onLoad(d)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: "#22c55e" }}>
                  <Upload size={13} /> {d.id === activeId ? "En el carrito" : "Registrar"}
                </button>
                <button type="button" onClick={() => void discard(d)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Descartar borrador">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
