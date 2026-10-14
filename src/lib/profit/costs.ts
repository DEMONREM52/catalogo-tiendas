"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Costos de productos solo para quien tiene permiso (erp_product_costs revisa permisos en la base).
 * Mientras no exista la migración 20261107 se lee como antes, directo de la tabla.
 * Devuelve null si el usuario no tiene permiso para ver costos.
 */
export async function fetchProductCosts(storeId: string, ids: string[]): Promise<Map<string, number> | null> {
  const sb = supabaseBrowser();
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await sb.rpc("erp_product_costs", { p_store: storeId, p_ids: chunk });
    if (error) {
      if (/permiso/i.test(error.message)) return null;
      if (!/Could not find the function|schema cache|does not exist/i.test(error.message)) throw error;
      // Migración aún no aplicada: lectura anterior.
      const legacy = await sb.from("products").select("id,cost_price").eq("store_id", storeId).in("id", chunk);
      if (legacy.error) return null;
      for (const r of legacy.data as Array<{ id: string; cost_price: number | null }>) out.set(r.id, Number(r.cost_price ?? 0));
      continue;
    }
    for (const r of (data ?? []) as Array<{ product_id: string; cost_price: number | null }>) out.set(r.product_id, Number(r.cost_price ?? 0));
  }
  return out;
}
