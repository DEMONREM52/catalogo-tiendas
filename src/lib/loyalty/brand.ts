"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Nombre del programa de Cliente fiel (20261233): «Puntos La Vitrina», con su unidad («puntos», «estrellas»…).
 * Cada punto de venta puede tener el suyo; sin migración o sin nombre propio queda «Puntos» / «puntos».
 */
export type LoyaltyBrand = { name: string; unit: string };
export const DEFAULT_LOYALTY_BRAND: LoyaltyBrand = { name: "Puntos", unit: "puntos" };

export function useLoyaltyBrand(storeId: string | null | undefined, pointId?: string | null): LoyaltyBrand {
  const [brand, setBrand] = useState<LoyaltyBrand>(DEFAULT_LOYALTY_BRAND);
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_loyalty_brand", { p_store: storeId, p_point: pointId || null }).then(({ data, error }) => {
      if (!alive) return;
      const b = error ? null : (data as Partial<LoyaltyBrand> | null);
      setBrand({ name: b?.name?.trim() || DEFAULT_LOYALTY_BRAND.name, unit: b?.unit?.trim() || DEFAULT_LOYALTY_BRAND.unit });
    });
    return () => { alive = false; };
  }, [storeId, pointId]);
  return brand;
}
