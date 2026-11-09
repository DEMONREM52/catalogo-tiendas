/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Flame, Plus, Sparkles } from "lucide-react";
import type { PublicItem } from "@/lib/catalog/public-prices";

/**
 * Recomendaciones en la página del producto (se arma en el servidor, sin JavaScript extra):
 * «Lo más vendido» y «También te puede gustar». Cada tarjeta lleva a su página y el «+» lo deja en el carrito.
 */
export function RelatedProducts({ title, kind, items, productHref, addHref }: {
  title: string; kind: "best" | "related"; items: PublicItem[];
  productHref: (id: string) => string; addHref: (id: string) => string;
}) {
  if (!items.length) return null;
  const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  return (
    <section className="product-landing-section mt-7 rounded-[30px] border p-5 shadow-xl sm:p-8" aria-label={title}>
      <p className="product-landing-kicker inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.18em]">
        {kind === "best" ? <Flame size={14} className="best-flame" aria-hidden /> : <Sparkles size={14} aria-hidden />}
        {kind === "best" ? "Lo que todos están llevando" : "Arma tu pedido completo"}
      </p>
      <h2 className="mt-1 text-2xl font-black sm:text-3xl">{title}</h2>
      <ul className="best-strip-row mt-4 flex snap-x gap-3 overflow-x-auto pb-3">
        {items.map((it, i) => (
          <li key={it.id} className="best-card group relative w-[44vw] max-w-[220px] shrink-0 snap-start overflow-hidden rounded-[22px] border sm:w-52"
            style={{ borderColor: kind === "best" && i < 3 ? "color-mix(in oklab, #f59e0b 55%, var(--t-card-border))" : "var(--t-card-border)", animationDelay: `${Math.min(i, 8) * 60}ms` }}>
            {kind === "best" ? (
              <span className={`absolute left-2 top-2 z-[1] rounded-full px-2 py-1 text-[11px] font-black text-white shadow-lg ${i === 0 ? "best-crown" : ""}`}
                style={{ background: i === 0 ? "linear-gradient(135deg,#f59e0b,#ef4444)" : i < 3 ? "linear-gradient(135deg,#f97316,#ec4899)" : "rgba(0,0,0,.6)" }}>
                {i === 0 ? "👑 #1" : `#${i + 1}`}
              </span>
            ) : null}
            <Link href={productHref(it.id)} prefetch={false} className="block aspect-square overflow-hidden" aria-label={`Ver ${it.name}`}>
              {it.image_url ? <img src={it.image_url} alt={it.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" /> : <span className="grid h-full place-items-center text-4xl">🛍️</span>}
            </Link>
            <div className="p-2.5">
              <Link href={productHref(it.id)} prefetch={false} className="line-clamp-2 min-h-[2.5em] text-[13px] font-extrabold leading-tight hover:underline">{it.name}</Link>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <p className="text-base font-black">{money(it.price)}</p>
                <a href={addHref(it.id)} className="best-add grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--t-cta, #8b5cf6)", color: "var(--t-cta-text, #fff)" }}
                  aria-label={`Agregar ${it.name} al carrito`} title="Agregar al carrito y seguir comprando"><Plus size={18} /></a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
