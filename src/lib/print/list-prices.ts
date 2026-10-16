"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type ListPrice = { sku: string | null; price2: number; price3: number };

/**
 * Precio por mayor (precio 2) y detal (precio 3) de productos, para valorar un traslado o pedido interno.
 * Solo con sesión en la tienda (la base lo revisa): sin sesión devuelve null y la pantalla muestra solo unidades.
 */
export function useListPrices(productIds: string[]) {
  const [prices, setPrices] = useState<Map<string, ListPrice> | null>(null);
  const key = [...new Set(productIds)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return alive && setPrices(null);
      const { data, error } = await sb.rpc("erp_product_list_prices", { p_ids: key.split(",") });
      if (!alive) return;
      if (error || !Array.isArray(data) || data.length === 0) return setPrices(null);
      setPrices(new Map((data as Array<{ product_id: string; sku: string | null; price_2: number; price_3: number }>)
        .map((r) => [r.product_id, { sku: r.sku, price2: Number(r.price_2 ?? 0), price3: Number(r.price_3 ?? 0) }])));
    })();
    return () => { alive = false; };
  }, [key]);
  return prices;
}

export const cop = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");
