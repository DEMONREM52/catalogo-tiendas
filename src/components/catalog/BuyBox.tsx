"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingCart, Zap } from "lucide-react";
import { WhatsAppProductLink } from "@/components/WhatsAppProductLink";

/**
 * Compra en la página del producto: una barra fija abajo que SIEMPRE se ve (celular y computador) con la
 * cantidad, el total, «Agregar al carrito» (el carrito se mueve suave para invitar) y «Comprar ahora».
 *   · «Comprar ahora»: lleva al catálogo con el producto ya en el carrito y el carrito abierto para pedir.
 *   · Carrito: lo deja en el carrito del catálogo para seguir agregando productos.
 * El precio final lo pone el catálogo (el mismo con el que se vende); allá se registra «agregar al carrito».
 * En la ficha queda además el botón de WhatsApp para preguntar.
 */
export function BuyBox({ productId, name, price, stock, catalogPath, accessKey, whatsapp, shareText, money }: {
  productId: string; name: string; price: number; stock: number | null;
  catalogPath: string; accessKey: string | null; whatsapp: string | null; shareText: string;
  money?: (n: number) => string;
}) {
  const fmt = money ?? ((n: number) => `$${Math.round(n).toLocaleString("es-CO")}`);
  const max = stock === null ? 99 : Math.max(1, Math.floor(stock));
  const [qty, setQty] = useState(1);

  const go = (buyNow: boolean) => {
    const p = new URLSearchParams();
    if (accessKey) p.set("key", accessKey);
    p.set("agregar", productId);
    p.set("cant", String(qty));
    if (buyNow) p.set("comprar", "1");
    window.location.href = `${catalogPath}?${p.toString()}`;
  };

  const stepper = (big: boolean) => (
    <div className={`buy-stepper inline-flex shrink-0 items-center rounded-2xl ${big ? "" : ""}`} role="group" aria-label="Cantidad">
      <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className={`grid place-items-center rounded-xl transition active:scale-90 disabled:opacity-30 ${big ? "h-12 w-12" : "h-10 w-9"}`} aria-label="Una menos"><Minus size={18} /></button>
      <span className={`text-center font-black tabular-nums ${big ? "min-w-10 text-xl" : "min-w-7 text-lg"}`} aria-live="polite">{qty}</span>
      <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} className={`grid place-items-center rounded-xl transition active:scale-90 disabled:opacity-30 ${big ? "h-12 w-12" : "h-10 w-9"}`} aria-label="Una más"><Plus size={18} /></button>
    </div>
  );

  return (
    <>
      {/* En la ficha: cantidad, total y preguntar por WhatsApp (los botones de compra van en la barra fija) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {stepper(true)}
          <p className="text-sm font-bold opacity-80">Total: <span className="text-xl font-black">{fmt(price * qty)}</span></p>
        </div>
        <button type="button" onClick={() => go(true)} className="buy-now-btn buy-cta flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black text-white shadow-xl transition hover:-translate-y-0.5 active:scale-[.98]">
          <Zap size={20} aria-hidden /> Comprar ahora
        </button>
        {whatsapp ? <div className="[&>button]:w-full [&>button]:justify-center"><WhatsAppProductLink phone={whatsapp} productText={shareText} /></div> : null}
      </div>

      {/* Barra fija: siempre visible */}
      <div className="buy-bar fixed inset-x-0 bottom-0 z-40 border-t px-3 pt-2.5 shadow-[0_-12px_40px_-12px_rgba(0,0,0,.5)] backdrop-blur-xl"
        style={{ borderColor: "color-mix(in oklab, #22c55e 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-bg-base, #120a24) 94%, transparent)", paddingBottom: "max(.65rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-xs font-bold opacity-75">{name}</p>
            <p className="text-lg font-black leading-tight">{fmt(price * qty)}{qty > 1 ? <span className="text-xs font-bold opacity-70"> · {qty} und</span> : null}</p>
          </div>
          {stepper(false)}
          <button type="button" onClick={() => go(false)} className="buy-cart-btn relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg transition active:scale-90"
            aria-label="Agregar al carrito y seguir comprando" title="Agregar al carrito y seguir comprando">
            <ShoppingCart size={22} className="buy-cart-icon" aria-hidden />
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-black text-emerald-700 shadow">+{qty}</span>
          </button>
          <button type="button" onClick={() => go(true)} className="buy-now-btn buy-cta inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl px-3 text-base font-black text-white shadow-lg transition active:scale-[.97] sm:flex-none sm:px-6">
            <Zap size={18} aria-hidden /> <span className="truncate">Comprar <span className="sm:hidden">· {fmt(price * qty)}</span><span className="hidden sm:inline">ahora</span></span>
          </button>
        </div>
      </div>
    </>
  );
}
