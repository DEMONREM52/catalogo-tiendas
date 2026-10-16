"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type ListPrice = { sku: string | null; price2: number; price3: number };
/** Por qué no hay precios: sin sesión en esta dirección o la tienda no los dejó leer. */
export type PricesReason = "loading" | "ok" | "no_session" | "denied";

/**
 * Precio por mayor (precio 2) y detal (precio 3) de productos, para valorar un traslado o pedido interno.
 * Solo con sesión en la tienda (la base lo revisa). Si aún no está la migración 20261207, se leen directo
 * de los productos (los precios ya son visibles para el equipo de la tienda; el costo nunca).
 */
export function useListPricesState(productIds: string[]) {
  const [state, setState] = useState<{ prices: Map<string, ListPrice> | null; reason: PricesReason }>({ prices: null, reason: "loading" });
  const key = [...new Set(productIds)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const { data: session } = await sb.auth.getSession();
      if (!session.session) return alive && setState({ prices: null, reason: "no_session" });
      const ids = key.split(",");
      const out = new Map<string, ListPrice>();
      const { data, error } = await sb.rpc("erp_product_list_prices", { p_ids: ids });
      if (!error && Array.isArray(data)) {
        for (const r of data as Array<{ product_id: string; sku: string | null; price_2: number; price_3: number }>) {
          out.set(r.product_id, { sku: r.sku, price2: Number(r.price_2 ?? 0), price3: Number(r.price_3 ?? 0) });
        }
      } else {
        // Sin la función (migración pendiente): lectura directa, por partes.
        for (let i = 0; i < ids.length; i += 200) {
          const res = await sb.from("products").select("id,sku,price_2,price_3").in("id", ids.slice(i, i + 200));
          if (res.error) break;
          for (const r of (res.data ?? []) as Array<{ id: string; sku: string | null; price_2: number | null; price_3: number | null }>) {
            out.set(r.id, { sku: r.sku, price2: Number(r.price_2 ?? 0), price3: Number(r.price_3 ?? 0) });
          }
        }
      }
      if (!alive) return;
      setState(out.size ? { prices: out, reason: "ok" } : { prices: null, reason: "denied" });
    })();
    return () => { alive = false; };
  }, [key]);
  return state;
}

/** Solo los precios (null si no se pueden ver). */
export function useListPrices(productIds: string[]) {
  return useListPricesState(productIds).prices;
}

export const cop = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");
