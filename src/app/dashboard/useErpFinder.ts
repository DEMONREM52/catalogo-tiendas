"use client";

import { useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_MODEL } from "@/lib/image-search/embed";
import type { FinderHit, FinderSource } from "@/components/product-finder/ProductFinder";

type Row = { id: string; name: string; sku: string | null; product_no?: number | null; image_url: string | null; active: boolean | null; price_1?: number | null; price_3?: number | null; stock?: number | null; score?: number };

const toHit = (r: Row, priceLevel: 1 | 3): FinderHit => ({
  id: r.id,
  name: r.name,
  image_url: r.image_url,
  code: r.sku ?? (r.product_no ? String(r.product_no) : null),
  price: Number((priceLevel === 1 ? r.price_1 : r.price_3) ?? 0),
  meta: [r.product_no ? `N.º ${r.product_no}` : null, r.active === false ? "Inactivo" : null].filter(Boolean).join(" · ") || null,
  score: r.score ?? null,
});

/** Buscador del panel: todos los productos de la tienda por nombre, código o foto. */
export function useErpFinderSource(storeId: string | null | undefined, opts: { activeOnly?: boolean; priceLevel?: 1 | 3 } = {}): FinderSource {
  const { activeOnly = false, priceLevel = 3 } = opts;
  return useMemo<FinderSource>(() => ({
    async searchText(q) {
      if (!storeId) return [];
      const { data, error } = await supabaseBrowser().rpc("erp_product_finder", { p_store: storeId, p_q: q, p_active_only: activeOnly, p_limit: 30 });
      if (error) throw error;
      return (((data ?? {}) as { items?: Row[] }).items ?? []).map((r) => toHit(r, priceLevel));
    },
    async searchPhoto(embedding) {
      if (!storeId) return { items: [], indexed: 0 };
      const { data, error } = await supabaseBrowser().rpc("erp_product_image_search", {
        p_store: storeId, p_embedding: embedding, p_model: IMAGE_MODEL, p_limit: 24, p_active_only: activeOnly,
      });
      if (error) throw error;
      const res = (data ?? {}) as { indexed?: number; items?: Row[] };
      return { indexed: Number(res.indexed ?? 0), items: (res.items ?? []).map((r) => toHit(r, priceLevel)) };
    },
  }), [storeId, activeOnly, priceLevel]);
}
