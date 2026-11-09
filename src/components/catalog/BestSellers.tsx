"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Flame, ShoppingCart, TrendingUp } from "lucide-react";
import type { PublicItem } from "@/lib/catalog/public-prices";

/**
 * «Lo más vendido»: franja que se desliza con los productos que más salen (orden real de ventas de 60 días).
 * Liviana: solo CSS (sin librerías de animación) y fotos con carga diferida.
 */
export function BestSellersStrip({ items, money, hrefFor, onAdd, title = "Lo más vendido" }: {
  items: PublicItem[];
  money: (n: number) => string;
  hrefFor: (id: string) => string | null;
  onAdd: (it: PublicItem) => void;
  title?: string;
}) {
  return (
    <section className="best-strip mt-7" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: "#f59e0b" }}>
            <Flame size={14} className="best-flame" aria-hidden /> Lo que todos están llevando
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold sm:text-2xl">
            {title} <TrendingUp size={20} aria-hidden style={{ color: "#10b981" }} />
          </h2>
        </div>
        <span className="hidden text-xs sm:block" style={{ color: "var(--t-muted)" }}>Desliza →</span>
      </div>
      <ul className="best-strip-row mt-3 flex snap-x gap-3 overflow-x-auto pb-3">
        {items.map((it, i) => {
          const href = hrefFor(it.id);
          const img = it.image_url ? <img src={it.image_url} alt={it.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" /> : <span className="grid h-full place-items-center text-4xl">🛍️</span>;
          return (
            <li key={it.id} className="best-card group relative w-[44vw] max-w-[220px] shrink-0 snap-start overflow-hidden rounded-[22px] border sm:w-52"
              style={{ borderColor: i < 3 ? "color-mix(in oklab, #f59e0b 55%, var(--t-border))" : "var(--t-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", animationDelay: `${Math.min(i, 8) * 60}ms` }}>
              <span className={`absolute left-2 top-2 z-[1] grid min-w-8 place-items-center rounded-full px-2 py-1 text-[11px] font-black text-white shadow-lg ${i === 0 ? "best-crown" : ""}`}
                style={{ background: i === 0 ? "linear-gradient(135deg,#f59e0b,#ef4444)" : i < 3 ? "linear-gradient(135deg,#f97316,#ec4899)" : "rgba(0,0,0,.6)" }}>
                {i === 0 ? "👑 #1" : `#${i + 1}`}
              </span>
              <div className="aspect-square overflow-hidden" style={{ background: "color-mix(in oklab, var(--t-cta, #8b5cf6) 10%, transparent)" }}>
                {href ? <Link href={href} prefetch={false} aria-label={`Ver ${it.name}`}>{img}</Link> : img}
              </div>
              <div className="p-2.5">
                <p className="line-clamp-2 min-h-[2.5em] text-[13px] font-extrabold leading-tight">{it.name}</p>
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <p className="text-base font-black">{money(it.price)}</p>
                  <button type="button" onClick={() => onAdd(it)} className="best-add grid h-9 w-9 place-items-center rounded-xl"
                    style={{ background: "var(--t-cta)", color: "var(--t-cta-text, #fff)" }} aria-label={`Agregar ${it.name} al carrito`} title="Agregar al carrito">
                    <ShoppingCart size={16} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
