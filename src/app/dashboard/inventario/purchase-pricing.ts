"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * % de ganancia desde el ingreso de factura: lo que hoy tiene cada producto (precios P1-P5 y su %),
 * la regla de redondeo de la tienda y el cálculo del precio de venta, igual que en la base (erp__product_autoprice).
 */

export type ProductPriceInfo = { prices: number[]; markups: Array<number | null> };
export type PurchasePricing = {
  step: number;
  dir: "nearest" | "up" | "down";
  basis: "last" | "average";
  info: Record<string, ProductPriceInfo>;
};

/** Precio de venta con el % (al peso y luego al paso de redondeo de la tienda). */
export function priceFromMarkup(cost: number, pct: number, step: number, dir: PurchasePricing["dir"]) {
  if (!(cost > 0)) return 0;
  const raw = Math.round(cost * (1 + pct / 100));
  if (!step) return raw;
  const q = raw / step;
  const r = dir === "up" ? Math.ceil(q - 1e-9) : dir === "down" ? Math.floor(q + 1e-9) : Math.floor(q + 0.5);
  return r * step;
}

/** El % que hoy tiene el producto si es el mismo en los 5 precios (si no, null). */
export function uniformMarkup(info?: ProductPriceInfo): number | null {
  const m = info?.markups ?? [];
  if (!m.length || m.some((x) => x === null)) return null;
  return m.every((x) => x === m[0]) ? (m[0] as number) : null;
}

export function usePurchasePricing(storeId: string, productIds: string[], enabled: boolean): PurchasePricing | null {
  const [cfg, setCfg] = useState<Omit<PurchasePricing, "info"> | null>(null);
  const [info, setInfo] = useState<Record<string, ProductPriceInfo>>({});
  const key = useMemo(() => [...new Set(productIds)].sort().join(","), [productIds]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_product_pricing_get", { p_store: storeId }).then(({ data }) => {
      if (!alive) return;
      const d = (data ?? {}) as { round_step?: number; round_dir?: PurchasePricing["dir"]; cost_basis?: PurchasePricing["basis"] };
      setCfg({ step: Number(d.round_step ?? 100), dir: d.round_dir ?? "nearest", basis: d.cost_basis ?? "last" });
    });
    return () => { alive = false; };
  }, [storeId, enabled]);

  useEffect(() => {
    if (!enabled || !key) return;
    const missing = key.split(",").filter((id) => id && !info[id]);
    if (!missing.length) return;
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const next: Record<string, ProductPriceInfo> = {};
      for (let i = 0; i < missing.length; i += 200) {
        const ids = missing.slice(i, i + 200);
        const [prices, marks] = await Promise.all([
          sb.from("products").select("id,price_1,price_2,price_3,price_4,price_5").in("id", ids),
          sb.rpc("erp_product_markups", { p_store: storeId, p_ids: ids }),
        ]);
        let markRows = (marks.data ?? []) as Array<Record<string, unknown>>;
        if (marks.error) {
          // Sin «Ver costos» o sin la migración: se leen directo (si se puede).
          const direct = await sb.from("products").select("id,markup_1,markup_2,markup_3,markup_4,markup_5").in("id", ids);
          markRows = ((direct.data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, product_id: r.id }));
        }
        const markBy = new Map(markRows.map((r) => [String(r.product_id), r]));
        for (const p of (prices.data ?? []) as Array<Record<string, unknown>>) {
          const id = String(p.id);
          const m = markBy.get(id);
          next[id] = {
            prices: [1, 2, 3, 4, 5].map((l) => Number(p[`price_${l}`] ?? 0)),
            markups: [1, 2, 3, 4, 5].map((l) => { const v = m?.[`markup_${l}`]; return v === null || v === undefined ? null : Number(v); }),
          };
        }
      }
      if (alive) setInfo((cur) => ({ ...cur, ...next }));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, key, enabled]);

  return useMemo(() => (enabled && cfg ? { ...cfg, info } : null), [enabled, cfg, info]);
}
