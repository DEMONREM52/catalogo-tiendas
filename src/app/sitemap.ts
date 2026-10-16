import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { storeBase, storeUrl } from "@/lib/seo/store-public";

export const revalidate = 3600;

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

type StoreRow = { id: string; slug: string; updated_at: string | null };

/** Catálogo y productos públicos de una tienda, con su dirección única. */
async function storeEntries(store: StoreRow, limit: number): Promise<MetadataRoute.Sitemap> {
  const client = sb();
  if (!client) return [];
  const base = await storeBase(store.slug);
  const out: MetadataRoute.Sitemap = [{ url: storeUrl(base, "/detal"), lastModified: store.updated_at ?? undefined, changeFrequency: "daily", priority: 1 }];
  const products = (cols: string) => client.from("products").select(cols).eq("store_id", store.id).eq("active", true).or("stock.is.null,stock.gt.0").limit(limit);
  // Si el público no puede leer la fecha de cambio, el sitemap sale igual, sin fechas.
  const first = await products("id,updated_at");
  const data = first.error ? (await products("id")).data : first.data;
  for (const p of (data ?? []) as unknown as Array<{ id: string; updated_at?: string | null }>) {
    out.push({ url: storeUrl(base, `/producto/${p.id}`), lastModified: p.updated_at ?? undefined, changeFrequency: "weekly", priority: 0.7 });
  }
  return out;
}

/**
 * sitemap.xml según el dominio:
 *   · dominio de una tienda (o mitienda.remhub.co): su catálogo y todos sus productos;
 *   · remhub.co: las páginas de RemHub y las tiendas que aún no tienen dominio propio.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const client = sb();
  const storeSlug = h.get("x-store-slug");
  if (storeSlug && client) {
    const one = (cols: string) => client.from("stores").select(cols).eq("slug", storeSlug).eq("active", true).eq("catalog_retail", true).maybeSingle();
    const first = await one("id,slug,updated_at");
    const data = first.error ? (await one("id,slug")).data : first.data;
    return data ? storeEntries(data as unknown as StoreRow, 5000) : [];
  }

  const out: MetadataRoute.Sitemap = [
    { url: `${PRODUCTION_ORIGIN}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${PRODUCTION_ORIGIN}/instalar`, changeFrequency: "monthly", priority: 0.5 },
  ];
  if (!client) return out;
  const all = (cols: string) => client.from("stores").select(cols).eq("active", true).eq("catalog_retail", true).limit(500);
  const first = await all("id,slug,updated_at");
  const stores = first.error ? (await all("id,slug")).data : first.data;
  for (const s of (stores ?? []) as unknown as StoreRow[]) {
    const base = await storeBase(s.slug);
    // Las tiendas con dominio propio se anuncian en su propio dominio (su sitemap); aquí solo su inicio.
    if (base.ownDomain) { out.push({ url: storeUrl(base, "/detal"), changeFrequency: "daily", priority: 0.8 }); continue; }
    out.push(...(await storeEntries(s, 300)));
    if (out.length > 40000) break;
  }
  return out;
}
