"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, ShoppingBag, ShoppingCart, Zap } from "lucide-react";
import { WhatsAppProductLink } from "@/components/WhatsAppProductLink";

/**
 * Caja de compra de la página del producto:
 *   · «Comprar ahora»: lleva al catálogo con el producto ya en el carrito y el carrito abierto para pedir.
 *   · «Agregar y seguir comprando»: lo deja en el carrito del catálogo para sumar más productos.
 * El precio final lo pone el catálogo (el mismo con el que se vende); allá se registra «agregar al carrito».
 * En el celular, una barra fija abajo.
 */
export function BuyBox({ productId, name, price, stock, catalogPath, accessKey, whatsapp, shareText, money }: {
  productId: string; name: string; price: number; stock: number | null;
  catalogPath: string; accessKey: string | null; whatsapp: string | null; shareText: string;
  money?: (n: number) => string;
}) {
  const fmt = money ?? ((n: number) => `$${Math.round(n).toLocaleString("es-CO")}`);
  const max = stock === null ? 99 : Math.max(1, Math.floor(stock));
  const [qty, setQty] = useState(1);
  const [showBar, setShowBar] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // La barra de abajo aparece cuando los botones grandes ya no se ven.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShowBar(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const href = (buyNow: boolean) => {
    const p = new URLSearchParams();
    if (accessKey) p.set("key", accessKey);
    p.set("agregar", productId);
    p.set("cant", String(qty));
    if (buyNow) p.set("comprar", "1");
    return `${catalogPath}?${p.toString()}`;
  };
  const go = (buyNow: boolean) => {
    window.location.href = href(buyNow);
  };

  return (
    <>
      <div ref={box} className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }} role="group" aria-label="Cantidad">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="grid h-12 w-12 place-items-center disabled:opacity-30" aria-label="Menos"><Minus size={18} /></button>
            <span className="min-w-10 text-center text-lg font-black tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} className="grid h-12 w-12 place-items-center disabled:opacity-30" aria-label="Más"><Plus size={18} /></button>
          </div>
          {qty > 1 ? <p className="text-sm font-bold opacity-80">Total: <span className="text-lg font-black">{fmt(price * qty)}</span></p> : null}
        </div>
        <button type="button" onClick={() => go(true)} className="buy-now-btn buy-pulse flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black shadow-xl transition hover:-translate-y-0.5 active:scale-[.98]"
          style={{ background: "var(--t-cta, linear-gradient(135deg,#8b5cf6,#ec4899))", color: "var(--t-cta-text, #fff)" }}>
          <Zap size={20} aria-hidden /> Comprar ahora
        </button>
        <button type="button" onClick={() => go(false)} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 px-6 py-3.5 text-base font-extrabold transition hover:-translate-y-0.5 active:scale-[.98]"
          style={{ borderColor: "color-mix(in oklab, var(--t-accent, #8b5cf6) 60%, transparent)" }}>
          <ShoppingCart size={18} aria-hidden /> Agregar y seguir comprando
        </button>
        {whatsapp ? <div className="[&>button]:w-full [&>button]:justify-center"><WhatsAppProductLink phone={whatsapp} productText={shareText} /></div> : null}
      </div>

      {/* Celular: barra fija con precio y «Comprar ahora» */}
      <div className={`fixed inset-x-0 bottom-0 z-40 border-t p-3 shadow-2xl backdrop-blur-xl transition-transform duration-300 lg:hidden ${showBar ? "translate-y-0" : "translate-y-full"}`}
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base, #120a24) 92%, transparent)", paddingBottom: "max(.75rem, env(safe-area-inset-bottom))" }} aria-hidden={!showBar}>
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold opacity-75">{name}</p>
            <p className="text-lg font-black leading-tight">{fmt(price * qty)}{qty > 1 ? <span className="text-xs font-bold opacity-70"> · {qty} und</span> : null}</p>
          </div>
          <button type="button" onClick={() => go(false)} tabIndex={showBar ? 0 : -1} className="grid h-12 w-12 place-items-center rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Agregar y seguir comprando"><ShoppingBag size={20} /></button>
          <button type="button" onClick={() => go(true)} tabIndex={showBar ? 0 : -1} className="buy-now-btn inline-flex h-12 items-center gap-1.5 rounded-2xl px-5 text-base font-black"
            style={{ background: "var(--t-cta, linear-gradient(135deg,#8b5cf6,#ec4899))", color: "var(--t-cta-text, #fff)" }}>
            <Zap size={18} aria-hidden /> Comprar
          </button>
        </div>
      </div>
    </>
  );
}
