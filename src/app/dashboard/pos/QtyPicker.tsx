"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";

/**
 * Celular: al tocar un producto se pregunta la cantidad (− / + y atajos) antes de agregarlo al carrito.
 * Liviano a propósito (sin listas largas ni efectos pesados) para que funcione en celulares sencillos.
 */
export function QtyPicker({ product, price, stock, inCart, onAdd, onClose, money }: {
  product: { id: string; name: string; image_url?: string | null } | null;
  price: number;
  stock: number | null;
  inCart: number;
  onAdd: (qty: number) => void;
  onClose: () => void;
  money: (n: number) => string;
}) {
  const [qty, setQty] = useState(1);
  useEffect(() => { if (product) { const t = window.setTimeout(() => setQty(1), 0); return () => window.clearTimeout(t); } }, [product]);
  const max = stock === null ? 9999 : Math.max(0, stock - inCart);
  const set = (n: number) => setQty(Math.max(1, Math.min(max || 1, Math.round(n) || 1)));
  return (
    <AnimatePresence>
      {product ? (
        <>
          <motion.div key="qty-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/55" onClick={onClose} />
          <motion.div key="qty-sheet" role="dialog" aria-label={`Cantidad de ${product.name}`} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-0 z-[61] rounded-t-3xl border-t p-4 sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full" style={{ background: "var(--t-card-border)" }} />
            <div className="flex items-start gap-3">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl">🛍️</span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-black leading-tight">{product.name}</p>
                <p className="mt-1 text-lg font-black tabular-nums" style={{ color: "var(--t-accent)" }}>{money(price)}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {stock === null ? "Sin control de existencias" : `${stock} disponibles`}{inCart ? ` · ya llevas ${inCart}` : ""}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }}><X size={18} /></button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={() => set(qty - 1)} className="grid h-14 w-14 place-items-center rounded-2xl border text-xl active:scale-95" style={{ borderColor: "var(--t-card-border)" }} aria-label="Menos"><Minus size={22} /></button>
              <input value={qty} inputMode="numeric" onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")))} onFocus={(e) => e.currentTarget.select()}
                className="h-14 min-w-0 flex-1 rounded-2xl border text-center text-3xl font-black tabular-nums outline-none" style={{ borderColor: "var(--t-accent)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Cantidad" />
              <button type="button" onClick={() => set(qty + 1)} className="grid h-14 w-14 place-items-center rounded-2xl border text-xl active:scale-95" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más"><Plus size={22} /></button>
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {[1, 2, 3, 5, 6, 10, 12].filter((n) => n <= (max || 1)).map((n) => (
                <button key={n} type="button" onClick={() => set(n)} className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-bold"
                  style={qty === n ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{n}</button>
              ))}
            </div>
            {stock !== null && max <= 0 ? <p className="mt-2 text-xs font-semibold text-rose-500">Ya agregaste todas las unidades disponibles.</p> : null}
            <button type="button" disabled={stock !== null && max <= 0} onClick={() => onAdd(qty)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-black text-white shadow-lg active:scale-[0.99] disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6 55%,#6366f1)" }}>
              <ShoppingCart size={18} /> Agregar {qty} · {money(price * qty)}
            </button>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
