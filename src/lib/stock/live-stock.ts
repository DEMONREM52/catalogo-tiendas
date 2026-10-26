"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isNetworkError } from "@/lib/net/status";
import { cacheLoad, cacheSave, withTimeout } from "@/lib/offline/cache";

/**
 * Existencias de una bodega o punto EN VIVO (20261220).
 * Carga todo (por páginas de 1.000) y luego escucha los cambios de erp_stock_levels:
 * si otra persona vende o traslada, el número baja aquí sin recargar.
 * Respaldo sin tiempo real: vuelve a leer al volver a la pestaña y cada minuto.
 */
export function useLiveStock(storeId: string | null | undefined, warehouseId: string | null | undefined) {
  const [stock, setStock] = useState<Map<string, number> | null>(null);
  const [live, setLive] = useState(false);
  const alive = useRef(0);

  const load = useCallback(async () => {
    if (!storeId || !warehouseId) return;
    const run = ++alive.current;
    const sb = supabaseBrowser();
    const map = new Map<string, number>();
    const cacheKey = `stock:${storeId}:${warehouseId}`;
    for (let from = 0; ; from += 1000) {
      let res: { data: unknown[] | null; error: unknown };
      try {
        res = await withTimeout(
          sb.from("erp_stock_levels").select("product_id,qty").eq("store_id", storeId).eq("warehouse_id", warehouseId).gt("qty", 0).order("product_id").range(from, from + 999),
          20_000, "carga de existencias",
        );
      } catch (e) {
        res = { data: null, error: e };
      }
      if (run !== alive.current) return;
      const { data, error } = res;
      if (error || !data) {
        if (isNetworkError(error)) {
          // Sin conexión o con la base caída se conservan las existencias que ya se veían (o las de la última vez).
          const cached = await cacheLoad<Array<[string, number]>>(cacheKey);
          if (run !== alive.current) return;
          setStock((cur) => cur ?? (cached ? new Map(cached.data) : new Map()));
          return;
        }
        // Sin acceso a existencias no se ofrece nada para no vender lo que no hay.
        setStock(new Map());
        return;
      }
      for (const row of data as { product_id: string; qty: number }[]) map.set(row.product_id, Number(row.qty));
      if (data.length < 1000) break;
    }
    if (run === alive.current) {
      void cacheSave(cacheKey, [...map]);
      setStock(map);
    }
  }, [storeId, warehouseId]);

  useEffect(() => {
    if (!storeId || !warehouseId) return;
    void Promise.resolve().then(load);
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`stock-${warehouseId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_stock_levels", filter: `warehouse_id=eq.${warehouseId}` }, (p) => {
        const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { product_id?: string; qty?: number } | null;
        if (!row?.product_id) return;
        const qty = p.eventType === "DELETE" ? 0 : Number(row.qty ?? 0);
        setStock((cur) => {
          if (!cur) return cur;
          const next = new Map(cur);
          if (qty > 0) next.set(row.product_id!, qty);
          else next.delete(row.product_id!);
          return next;
        });
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      alive.current++;
      void sb.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
      setLive(false);
    };
  }, [storeId, warehouseId, load]);

  return { stock, live, refresh: load, setStock };
}

export type StockShort = { product_id: string; name: string; wanted: number; available: number };

/**
 * Revisa contra la base, justo antes de guardar, si alcanzan las unidades.
 * Devuelve los productos que no alcanzan (vacío = todo bien). Sin la migración 20261220 lee las existencias directo.
 */
export async function checkStockNow(storeId: string, warehouseId: string, items: Array<{ product_id: string; qty: number; name?: string }>): Promise<StockShort[]> {
  const sb = supabaseBrowser();
  const want = new Map<string, { qty: number; name: string }>();
  for (const i of items) {
    if (!i.product_id || !(i.qty > 0)) continue;
    const cur = want.get(i.product_id);
    want.set(i.product_id, { qty: (cur?.qty ?? 0) + i.qty, name: cur?.name ?? i.name ?? "" });
  }
  if (!want.size) return [];
  const payload = [...want].map(([product_id, v]) => ({ product_id, qty: v.qty }));
  const { data, error } = await sb.rpc("erp_stock_check", { p_store: storeId, p_wh: warehouseId, p_items: payload });
  const res = data as { ok?: boolean; short?: StockShort[] } | null;
  if (!error && res && Array.isArray(res.short)) return res.short.map((s) => ({ ...s, wanted: Number(s.wanted), available: Number(s.available) }));
  // Respaldo: lectura directa (por partes de 200).
  const ids = [...want.keys()];
  const have = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb.from("erp_stock_levels").select("product_id,qty").eq("warehouse_id", warehouseId).in("product_id", ids.slice(i, i + 200));
    if (r.error) return [];
    for (const row of (r.data ?? []) as Array<{ product_id: string; qty: number }>) have.set(row.product_id, Number(row.qty));
  }
  return [...want].filter(([id, v]) => v.qty > (have.get(id) ?? 0)).map(([id, v]) => ({ product_id: id, name: v.name, wanted: v.qty, available: have.get(id) ?? 0 }));
}

/** Lista en HTML (para SweetAlert) de lo que no alcanza. */
export function shortListHtml(short: StockShort[]) {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<div style="text-align:left;font-size:13px;line-height:1.6">${short.map((s) =>
    `• <b>${esc(s.name || "Producto")}</b>: quieres ${s.wanted}, ${s.available > 0 ? `solo quedan <b>${s.available}</b>` : "<b>ya no hay</b>"}`).join("<br>")}</div>`;
}

/** Traduce el error de la base cuando otra persona se llevó las unidades primero. */
export function friendlyStockError(message: string) {
  const m = /Stock insuficiente en la bodega \(disponible (-?\d+), requerido (\d+)\)/i.exec(message);
  if (m) return `Otra persona acaba de usar esas unidades: quedan ${m[1]} y necesitas ${m[2]}. Revisa las cantidades y vuelve a intentar.`;
  if (/No hay unidades suficientes/i.test(message)) return "Otra persona acaba de vender esas unidades. Revisa las cantidades y vuelve a intentar.";
  return null;
}
