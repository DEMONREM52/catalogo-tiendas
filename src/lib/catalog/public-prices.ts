import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Precio, existencias y datos básicos de unos productos tal como los vende un catálogo público.
 *   · Catálogo de RemHub Social: catalog_public_stock (precio y existencias del catálogo/punto).
 *   · Catálogo clásico (detal / mayor): la tabla de productos (precio al detal o al por mayor).
 * Solo devuelve los que se pueden vender (precio > 0 y con unidades o ilimitados).
 */
export type PublicItem = { id: string; name: string; image_url: string | null; price: number; stock: number | null; min_wholesale: number | null };

const isClassic = (catalog: string) => catalog === "detal" || catalog === "mayor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function fetchPublicItems(sb: SupabaseClient, store: { id: string; slug: string }, catalog: string, key: string | null, ids: string[]): Promise<Map<string, PublicItem>> {
  const out = new Map<string, PublicItem>();
  const list = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 60);
  if (!list.length) return out;
  const { data: base } = await sb.from("products").select("id,name,image_url,min_wholesale,price_retail,price_wholesale,stock,active").eq("store_id", store.id).in("id", list);
  const info = new Map(((base ?? []) as Array<{ id: string; name: string; image_url: string | null; min_wholesale: number | null; price_retail: number | null; price_wholesale: number | null; stock: number | null; active: boolean | null }>).map((r) => [r.id, r]));

  if (!isClassic(catalog)) {
    const { data, error } = await sb.rpc("catalog_public_stock", { p_store: store.slug, p_catalog: catalog, p_key: key, p_ids: list });
    if (!error) {
      for (const r of rowsOf(data)) {
        const id = String(r?.id ?? r?.product_id ?? "");
        const b = info.get(id);
        const price = Number(r?.price ?? 0);
        const stock = r?.stock === null || r?.stock === undefined ? null : Number(r.stock);
        if (!b || !(price > 0) || (stock !== null && stock <= 0)) continue;
        out.set(id, { id, name: String(r?.name ?? b.name), image_url: b.image_url, price, stock, min_wholesale: b.min_wholesale ?? null });
      }
      return out;
    }
  }
  for (const b of info.values()) {
    const price = Number((catalog === "mayor" ? b.price_wholesale : b.price_retail) ?? 0);
    const stock = b.stock === null || b.stock === undefined ? null : Number(b.stock);
    if (b.active === false || !(price > 0) || (stock !== null && stock <= 0)) continue;
    out.set(b.id, { id: b.id, name: b.name, image_url: b.image_url, price, stock, min_wholesale: b.min_wholesale ?? null });
  }
  return out;
}

/** Oferta o destacado de un producto en un catálogo (20261309): precio de antes, de ahora, % y fin. */
export type PublicDeal = { id: string; now: number; before: number | null; pct: number | null; ends_at: string | null; label: string | null; featured: boolean };

export async function fetchPublicDeals(sb: SupabaseClient, storeSlug: string, catalog: string, key: string | null): Promise<Map<string, PublicDeal>> {
  const out = new Map<string, PublicDeal>();
  const { data, error } = await sb.rpc("store_public_offers", { p_store: storeSlug, p_catalog: catalog, p_key: key });
  if (error || !data) return out;
  for (const r of rowsOf((data as { items?: unknown }).items ?? data)) {
    const id = String(r?.id ?? "");
    if (!id) continue;
    out.set(id, {
      id, now: Number(r.now ?? 0), before: r.before == null ? null : Number(r.before), pct: r.pct == null ? null : Number(r.pct),
      ends_at: r.ends_at ?? null, label: r.label ?? null, featured: Boolean(r.featured),
    });
  }
  return out;
}

/** «Termina en 2 d 5 h» / «Termina en 3 h 20 min» (null si no tiene fin o ya pasó). */
export function endsInText(endsAt: string | null, now: number): string | null {
  if (!endsAt) return null;
  const ms = Date.parse(endsAt) - now;
  if (!(ms > 0)) return null;
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `Termina en ${d} d ${h % 24} h`;
  if (h >= 1) return `Termina en ${h} h ${m % 60} min`;
  return `Termina en ${m} min`;
}
