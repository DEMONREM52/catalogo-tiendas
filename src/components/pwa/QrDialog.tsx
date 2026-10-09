"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, QrCode, Share2, X } from "lucide-react";

const ORIGIN = "https://remhub.store";

/** Ventana con el código QR de una página pública de RemHub (siempre en remhub.store). */
export function QrDialog({ open, onClose, path, title, subtitle }: { open: boolean; onClose: () => void; path: string; title: string; subtitle?: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return createPortal(<AnimatePresence>{open ? <Sheet key="qr" onClose={onClose} path={path} title={title} subtitle={subtitle} /> : null}</AnimatePresence>, document.body);
}

function Sheet({ onClose, path, title, subtitle }: { onClose: () => void; path: string; title: string; subtitle?: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${ORIGIN}${path}`;
  const qr = `/api/qr?${new URLSearchParams({ path, format: "png", size: "640" }).toString()}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copia el enlace:", url);
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* cancelado */
      }
    } else void copy();
  }

  return (
    <motion.div className="fixed inset-0 z-[160] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={`Código QR de ${title}`}
        className="relative w-full overflow-hidden rounded-t-[28px] border p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center shadow-[0_30px_90px_rgba(0,0,0,0.5)] sm:max-w-sm sm:rounded-[28px]"
        style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.14))", background: "var(--t-bg-base, #0b0b0b)", color: "var(--t-text, #fff)" }}
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      >
        <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border transition hover:rotate-90" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }} aria-label="Cerrar">
          <X size={16} />
        </button>
        <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "#a78bfa" }}><QrCode size={14} /> Código QR</p>
        <h2 className="mt-1 text-xl font-black">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>{subtitle}</p> : null}
        <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08 }} className="mx-auto mt-5 w-fit rounded-3xl bg-white p-3 shadow-[0_18px_50px_rgba(139,92,246,.35)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR de ${url}`} width={240} height={240} className="h-60 w-60" />
        </motion.div>
        <p className="mt-3 break-all font-mono text-[11px]" style={{ color: "var(--t-muted, rgba(255,255,255,.7))" }}>{url}</p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted, rgba(255,255,255,.6))" }}>Al escanearlo se abre la página; desde ahí se puede instalar.</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <a href={`${qr}&download=1`} download className="inline-flex flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-[11px] font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }}>
            <Download size={16} /> Descargar
          </a>
          <button type="button" onClick={() => void copy()} className="inline-flex flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-[11px] font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border, rgba(255,255,255,.2))" }}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
          </button>
          <button type="button" onClick={() => void share()} className="inline-flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-bold text-white transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>
            <Share2 size={16} /> Compartir
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
