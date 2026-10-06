"use client";

/* eslint-disable @next/next/no-img-element */
import { motion } from "framer-motion";
import { Lock, MapPin, MessageCircle, ShoppingBag } from "lucide-react";
import { catalogPrice, PRICE_LEVELS, type StoreCatalog } from "@/lib/catalogs";
import type { PreviewItem, ThemeOption } from "./types";
import { money } from "./ui";

function themeColors(theme: ThemeOption | undefined) {
  const cfg = (theme?.config ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof cfg[key] === "string" && String(cfg[key]).trim() ? String(cfg[key]) : undefined);
  const accent = str("accent") ?? "#a855f7";
  const accent2 = str("accent2") ?? "#ec4899";
  const rawBg = str("bg");
  return {
    bg: rawBg && !/gradient\(/i.test(rawBg) ? rawBg : "#0f0a1a",
    bgImage: rawBg && /gradient\(/i.test(rawBg) ? rawBg : `radial-gradient(420px 260px at 20% 0%, ${accent}55, transparent 70%)`,
    card: str("card") ?? "rgba(255,255,255,0.08)",
    text: str("text") ?? "#ffffff",
    muted: str("muted") ?? "rgba(255,255,255,0.7)",
    accent,
    cta: str("cta") ?? `linear-gradient(135deg, ${accent}, ${accent2})`,
  };
}

export function CatalogPreview({
  draft,
  storeName,
  storeLogo,
  storeBanner,
  theme,
  categories,
  products,
  pointName,
}: {
  draft: StoreCatalog;
  storeName: string;
  storeLogo: string | null;
  storeBanner: string | null;
  theme: ThemeOption | undefined;
  categories: Array<{ id: string; name: string; image_url: string | null }>;
  products: PreviewItem[];
  pointName: string | null;
}) {
  const c = themeColors(theme);
  const logo = draft.logo_url || storeLogo;
  const banner = draft.banner_url || storeBanner;
  const level = PRICE_LEVELS.find((p) => p.level === draft.price_level);
  const shown = products
    .map((p) => ({ product: p, price: catalogPrice(p, draft, p.price_override) }))
    .filter((x) => x.price > 0)
    .slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--t-muted)" }}>Vista previa en vivo</p>
      <div className="rounded-[2.4rem] border-[6px] border-black/80 bg-black p-1 shadow-2xl">
        <div className="relative h-[560px] overflow-hidden rounded-[2rem]" style={{ background: c.bg, backgroundImage: c.bgImage, color: c.text }}>
          <div className="absolute left-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black/80" />
          <div className="h-full overflow-y-auto pb-16 [scrollbar-width:none]">
            <div className="sticky top-0 z-[5] flex items-center gap-2 px-3 pb-2 pt-7 backdrop-blur" style={{ background: "rgba(0,0,0,0.25)" }}>
              {logo ? <img src={logo} alt="" className="h-8 w-8 rounded-xl object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-xl text-sm" style={{ background: c.cta }}>🛍️</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-extrabold">{draft.name || "Tu catálogo"}</p>
                <p className="truncate text-[9px]" style={{ color: c.muted }}>{storeName}</p>
              </div>
              {draft.access_key ? <Lock size={13} /> : null}
            </div>

            <motion.div key={banner ?? "no-banner"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-3 mt-2 overflow-hidden rounded-2xl" style={{ background: c.card }}>
              {banner ? (
                <img src={banner} alt="" className="h-28 w-full object-cover" />
              ) : (
                <div className="grid h-28 place-items-center text-[11px]" style={{ color: c.muted }}>Portada del catálogo</div>
              )}
            </motion.div>

            <div className="mx-3 mt-2 rounded-xl px-3 py-2 text-[10px]" style={{ background: c.card }}>
              <p className="font-bold">{draft.headline || "Explora los productos"}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2" style={{ color: c.muted }}>
                <span>{level?.label} · {level?.hint}</span>
                {pointName ? <span className="inline-flex items-center gap-0.5"><MapPin size={9} /> {pointName}</span> : null}
              </p>
            </div>

            {categories.length ? (
              <div className="mt-2 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
                {categories.slice(0, 8).map((cat) => (
                  <div key={cat.id} className="w-16 shrink-0 rounded-xl p-1 text-center" style={{ background: c.card }}>
                    {cat.image_url ? <img src={cat.image_url} alt="" className="aspect-square w-full rounded-lg object-cover" /> : <div className="aspect-square w-full rounded-lg" style={{ background: "rgba(255,255,255,0.08)" }} />}
                    <p className="mt-1 line-clamp-2 text-[8px] font-bold leading-tight">{cat.name}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-2 grid grid-cols-2 gap-2 px-3">
              {shown.length ? shown.map(({ product, price }) => (
                <motion.div layout key={product.id} className="overflow-hidden rounded-xl" style={{ background: c.card }}>
                  {product.image_url ? <img src={product.image_url} alt="" className="aspect-square w-full object-cover" /> : <div className="grid aspect-square place-items-center text-xl">📦</div>}
                  <div className="p-1.5">
                    <p className="line-clamp-2 text-[9px] font-bold leading-tight">{product.name}</p>
                    <motion.p key={price} initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-0.5 text-[11px] font-black">{money(price)}</motion.p>
                    {draft.show_stock && product.catalog_stock !== null ? (
                      <p className="text-[8px]" style={{ color: c.muted }}>{product.catalog_stock} disponibles</p>
                    ) : null}
                    <div className="mt-1 rounded-md py-0.5 text-center text-[8px] font-bold text-white" style={{ background: c.cta }}>Agregar</div>
                  </div>
                </motion.div>
              )) : (
                <p className="col-span-2 rounded-xl p-3 text-center text-[10px]" style={{ background: c.card, color: c.muted }}>
                  {pointName
                    ? `Aquí aparecen los productos del catálogo con unidades en ${pointName}.`
                    : "Aquí aparecen los productos del catálogo que tienen precio y existencias."}
                </p>
              )}
            </div>
          </div>
          <div className="absolute inset-x-3 bottom-3 flex gap-2">
            <div className="flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-[10px] font-bold text-white shadow-lg" style={{ background: c.cta }}>
              <ShoppingBag size={12} /> Ver carrito
            </div>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white shadow-lg"><MessageCircle size={14} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
