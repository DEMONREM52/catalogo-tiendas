"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, m as motion } from "framer-motion";
import { waLink } from "@/lib/features";
import { reprintOrder } from "@/lib/print/print-order";

type Tone = "ok" | "warn" | "bad" | "info";

/** Lo que quedó de la venta, para la pantalla de «Listo». */
export type DoneSale = {
  kindLabel: string;
  docNumber: string;
  total: number;
  /** Vuelto (solo de contado en efectivo). */
  change: number;
  payLabel: string | null;
  customerName: string;
  customerPhone: string;
  sellerName: string | null;
  /** Estado de la factura electrónica, en palabras. */
  dian: { tone: Tone; text: string; fix?: { href: string; label: string } } | null;
  notes: Array<{ tone: Tone; text: string }>;
  token: string;
  receiptUrl: string;
  direct: boolean;
  autoPrint: boolean;
  printSize: "tirilla" | "carta";
  storeName: string;
};

const COLOR: Record<Tone, string> = { ok: "#22c55e", warn: "#f59e0b", bad: "#ef4444", info: "var(--t-muted)" };

/** Al terminar: el número, el vuelto grande, el estado de la DIAN y tres botones (imprimir, WhatsApp, nueva venta). */
export function PosDoneSheet({ sale, onClose, money }: { sale: DoneSale | null; onClose: () => void; money: (n: number) => string }) {
  useEffect(() => {
    if (!sale) return;
    // Esc o F2 cierran; en computador, escanear o escribir el siguiente producto también (el buscador recibe la tecla).
    const onKey = (e: KeyboardEvent) => {
      const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ";
      if (e.key === "Escape" || e.key === "F2" || typing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sale, onClose]);

  function shareWhatsApp(s: DoneSale) {
    const shareUrl = `${window.location.origin}/pedido/${s.token}`;
    const hello = s.customerName && !/consumidor final/i.test(s.customerName) ? `Hola ${s.customerName}, ` : "Hola, ";
    const text = `${hello}aquí está tu ${s.kindLabel.toLowerCase()}${s.docNumber ? ` ${s.docNumber}` : ""} de ${s.storeName} por ${money(s.total)}: ${shareUrl}`;
    window.open(waLink(s.customerPhone, text), "_blank", "noopener");
  }

  return (
    <AnimatePresence>
      {sale ? (
        <>
          <motion.div key="done-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-60 bg-black/60" onClick={onClose} />
          <motion.div key="done" role="dialog" aria-modal="true" aria-label={`${sale.kindLabel} creada`}
            initial={{ y: "100%", opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }} transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-60 mx-auto w-full max-w-md rounded-t-3xl border-t sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="space-y-3 p-5 text-center">
              <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 16 }}
                className="mx-auto grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: "rgba(34,197,94,.15)" }}>✅</motion.div>
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--t-muted)" }}>{sale.kindLabel} creada</p>
                <p className="text-2xl font-black tabular-nums">{sale.docNumber || "Sin número"}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {sale.customerName} · {money(sale.total)}{sale.payLabel ? ` · ${sale.payLabel}` : ""}{sale.sellerName ? ` · 🧑‍💼 ${sale.sellerName}` : ""}
                </p>
              </div>

              {sale.change > 0 ? (
                <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(34,197,94,.12)" }}>
                  <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>💵 Vuelto</p>
                  <p className="text-4xl font-black tabular-nums text-emerald-400">{money(sale.change)}</p>
                </div>
              ) : null}

              {sale.dian ? (
                <div className="flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left text-sm font-bold" style={{ borderColor: `color-mix(in oklab, ${COLOR[sale.dian.tone]} 45%, var(--t-card-border))` }}>
                  <span style={{ color: COLOR[sale.dian.tone] }}>{sale.dian.text}</span>
                  {sale.dian.fix ? <Link href={sale.dian.fix.href} onClick={onClose} className="shrink-0 rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>{sale.dian.fix.label} →</Link> : null}
                </div>
              ) : null}
              {sale.notes.map((n, i) => (
                <p key={i} className="text-left text-xs font-semibold" style={{ color: COLOR[n.tone] }}>{n.text}</p>
              ))}

              <div className="grid grid-cols-2 gap-2 pt-1">
                {sale.direct ? (
                  <button type="button" onClick={() => void reprintOrder(sale.token, sale.printSize)} className="rounded-2xl border px-3 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    🖨️ {sale.autoPrint ? "Reimprimir" : "Imprimir"}
                  </button>
                ) : (
                  <button type="button" onClick={() => window.open(sale.receiptUrl, "_blank")} className="rounded-2xl border px-3 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    🖨️ Comprobante
                  </button>
                )}
                <button type="button" onClick={() => shareWhatsApp(sale)} className="rounded-2xl px-3 py-3 text-sm font-bold text-white" style={{ background: "#25d366" }}>
                  💬 WhatsApp
                </button>
              </div>
              {sale.direct ? (
                <button type="button" onClick={() => window.open(sale.receiptUrl, "_blank")} className="text-xs font-semibold underline" style={{ color: "var(--t-muted)" }}>Ver el comprobante</button>
              ) : null}
              <button type="button" autoFocus onClick={onClose}
                className="w-full rounded-2xl px-3 py-3.5 text-base font-black text-white" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6 55%,#6366f1)" }}>
                ➕ Nueva venta
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
