"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { BadgePercent, Flame, ShoppingCart, Star, TrendingUp } from "lucide-react";
import type { PublicDeal, PublicItem } from "@/lib/catalog/public-prices";

/**
 * Franja que se desliza con productos: «Lo más vendido» (con #1, #2…), «Ofertas especiales» (antes/ahora y %)
 * o «Destacados». Liviana: solo CSS (sin librerías de animación) y fotos con carga diferida.
 */
export function BestSellersStrip({ items, money, hrefFor, onAdd, title = "Lo más vendido", variant = "best", deals, subtitle, icon }: {
  items: PublicItem[];
  money: (n: number) => string;
  hrefFor: (id: string) => string | null;
  onAdd: (it: PublicItem) => void;
  title?: string;
  variant?: "best" | "offers" | "featured";
  deals?: Map<string, PublicDeal>;
  /** Texto pequeño de arriba y emoji del título (configurables en «Lo más vendido»). */
  subtitle?: string | null;
  icon?: string | null;
}) {
  const accent = variant === "offers" ? "#ef4444" : variant === "featured" ? "#eab308" : "#f59e0b";
  const kicker = subtitle?.trim() ? subtitle.trim() : variant === "offers" ? "Precios rebajados por tiempo limitado" : variant === "featured" ? "Escogidos para ti" : "Lo que todos están llevando";
  const KIcon = variant === "offers" ? BadgePercent : variant === "featured" ? Star : Flame;
  return (
    <section className="best-strip mt-7" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: accent }}>
            <KIcon size={14} className="best-flame" aria-hidden /> {kicker}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold sm:text-2xl">
            {icon ? <span className="best-crown inline-block" aria-hidden>{icon}</span> : null}{title} {variant === "best" && !icon ? <TrendingUp size={20} aria-hidden style={{ color: "#10b981" }} /> : null}
          </h2>
        </div>
        <span className="hidden text-xs sm:block" style={{ color: "var(--t-muted)" }}>Desliza →</span>
      </div>
      <ul className="best-strip-row mt-3 flex snap-x gap-3 overflow-x-auto pb-3">
        {items.map((it, i) => {
          const href = hrefFor(it.id);
          const deal = deals?.get(it.id);
          const now = deal?.now && deal.now > 0 ? deal.now : it.price;
          const img = it.image_url ? <img src={it.image_url} alt={it.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" /> : <span className="grid h-full place-items-center text-4xl">🛍️</span>;
          const top = variant === "best" && i < 3;
          return (
            <li key={it.id} className="best-card group relative w-[44vw] max-w-[220px] shrink-0 snap-start overflow-hidden rounded-[22px] border sm:w-52"
              style={{ borderColor: top || variant !== "best" ? `color-mix(in oklab, ${accent} 55%, var(--t-border))` : "var(--t-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", animationDelay: `${Math.min(i, 8) * 60}ms` }}>
              {variant === "best" ? (
                <span className={`absolute left-2 top-2 z-[1] grid min-w-8 place-items-center rounded-full px-2 py-1 text-[11px] font-black text-white shadow-lg ${i === 0 ? "best-crown" : ""}`}
                  style={{ background: i === 0 ? "linear-gradient(135deg,#f59e0b,#ef4444)" : i < 3 ? "linear-gradient(135deg,#f97316,#ec4899)" : "rgba(0,0,0,.6)" }}>
                  {i === 0 ? "👑 #1" : `#${i + 1}`}
                </span>
              ) : variant === "featured" ? (
                <span className="featured-badge absolute left-2 top-2 z-[1] rounded-full px-2 py-1 text-[11px] font-black shadow-lg">⭐ Destacado</span>
              ) : null}
              {deal?.pct ? <span className="offer-pct-badge absolute right-2 top-2 z-[1] rounded-xl px-2 py-1 text-xs font-black text-white">-{deal.pct}%</span> : null}
              <div className="aspect-square overflow-hidden" style={{ background: "color-mix(in oklab, var(--t-cta, #8b5cf6) 10%, transparent)" }}>
                {href ? <Link href={href} prefetch={false} aria-label={`Ver ${it.name}`}>{img}</Link> : img}
              </div>
              <div className="p-2.5">
                {deal?.label && deal.before ? <p className="mb-0.5 truncate text-[10px] font-black uppercase tracking-wide" style={{ color: "#ef4444" }}>{deal.label}</p> : null}
                <p className="line-clamp-2 min-h-[2.5em] text-[13px] font-extrabold leading-tight">{it.name}</p>
                <div className="mt-1.5 flex items-end justify-between gap-1">
                  <div className="min-w-0">
                    {deal?.before ? <p className="text-[11px] line-through opacity-60">{money(deal.before)}</p> : null}
                    <p className={`text-base font-black ${deal?.before ? "offer-price" : ""}`}>{money(now)}</p>
                  </div>
                  <button type="button" onClick={() => onAdd({ ...it, price: now })} className="best-add grid h-9 w-9 shrink-0 place-items-center rounded-xl"
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
