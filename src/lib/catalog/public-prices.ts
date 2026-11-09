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
