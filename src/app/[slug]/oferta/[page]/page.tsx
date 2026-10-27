import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeLanding } from "@/lib/landing/config";
import { fillText } from "@/lib/landing/templates";
import { LandingView, type LandingData } from "./LandingView";

// Landing de un producto para pauta: sin menú, sin buscador y sin enlaces al catálogo.
// Solo deja comprar ese producto o escribir por WhatsApp.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; page: string }> };

const load = cache(async (slug: string, page: string): Promise<LandingData | null> => {
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/i.test(page)) return null;
  const { data, error } = await supabaseServer().rpc("landing_public", { p_store: decodeURIComponent(slug), p_slug: page.toLowerCase() });
  if (error || !data || !(data as { ok?: boolean }).ok) return null;
  const d = data as LandingData;
  return { ...d, items: (d.items ?? []).map((i) => ({ ...i, price: Number(i.price) || 0, stock: i.stock === null ? null : Number(i.stock) })), upsell: d.upsell ? { ...d.upsell, price: Number(d.upsell.price) || 0, stock: d.upsell.stock === null ? null : Number(d.upsell.stock) } : null };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, page } = await params;
  const d = await load(slug, page);
  if (!d) return { title: "Oferta no disponible", robots: { index: false, follow: false } };
  const cfg = normalizeLanding(d.page.config);
  const item = d.items[0];
  const price = item ? `$${Math.round(item.price).toLocaleString("es-CO")}` : "";
  const title = `${fillText(cfg.headline || d.page.name, d.page.name, price)} · ${d.store.name}`.slice(0, 120);
  const description = (cfg.subheadline || `${d.page.name} ${price ? `a ${price}` : ""}. ${cfg.shipping.text}.`).slice(0, 200);
  const image = cfg.images[0] ?? item?.image ?? undefined;
  return {
    title: { absolute: title },
    description,
    // Las landings son para pauta: no compiten en Google con la ficha del producto.
    robots: { index: false, follow: false },
    openGraph: { type: "website", title, description, images: image ? [{ url: image, alt: d.page.name }] : undefined },
    twitter: { card: "summary_large_image", title, description, images: image ? [image] : undefined },
  };
}

export default async function LandingPage({ params }: Props) {
  const { slug, page } = await params;
  const d = await load(slug, page);
  if (!d) notFound();
  return <LandingView data={d} />;
}
