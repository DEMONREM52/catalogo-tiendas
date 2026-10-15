"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type FloorInfo = {
  mode: "list" | "mother" | "margin" | "cost" | "free";
  margin_pct: number;
  source: string;
  free: boolean;
  can_approve: boolean;
  floors: Record<string, { floor: number; list: number }>;
};
export type ApprovalState = { id: string; status: "pending" | "approved" | "rejected" | "used" | "cancelled" | "expired"; price: number; by?: string | null; note?: string | null };

export const LIMIT_LABEL: Record<FloorInfo["mode"], string> = {
  list: "No puedes bajar del precio de lista",
  mother: "Puedes bajar hasta el precio de la madre",
  margin: "Puedes bajar hasta el mínimo con ganancia",
  cost: "Puedes bajar hasta el precio mínimo",
  free: "Puedes vender a cualquier precio",
};

/**
 * Hasta cuánto puede bajar el precio quien vende (lo calcula la base, sin mostrar el costo).
 * null = la base todavía no tiene la migración 20261115 (no hay límites en pantalla).
 */
export function usePriceFloors(storeId: string | undefined, pointId: string, productIds: string[]) {
  const [info, setInfo] = useState<FloorInfo | null>(null);
  const key = [...new Set(productIds)].sort().join(",");
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("erp_pos_price_floors", { p_store: storeId, p_point: pointId || null, p_ids: key ? key.split(",") : [] });
      if (!alive) return;
      if (error) return setInfo(null);
      const d = data as FloorInfo;
      setInfo({ ...d, floors: Object.fromEntries(Object.entries(d.floors ?? {}).map(([k, v]) => [k, { floor: Number(v.floor), list: Number(v.list) }])) });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [storeId, pointId, key]);
  return info;
}

/** Solicitudes de autorización del carrito: pedir y seguir su estado (cada 4 s mientras haya pendientes). */
export function useApprovals(storeId: string | undefined, pointId: string) {
  const [map, setMap] = useState<Record<string, ApprovalState>>({});
  const ref = useRef(map);
  useEffect(() => { ref.current = map; }, [map]);

  const request = useCallback(async (productId: string, price: number, qty: number, note: string) => {
    if (!storeId) return { ok: false, message: "Sin tienda" };
    const { data, error } = await supabaseBrowser().rpc("erp_price_approval_request", {
      p_store: storeId, p_point: pointId || null, p_product: productId, p_price: price, p_qty: qty, p_note: note,
    });
    if (error) return { ok: false, message: error.message };
    const res = data as { ok: boolean; id?: string; not_needed?: boolean };
    if (res.not_needed) return { ok: true, notNeeded: true };
    if (res.id) setMap((m) => ({ ...m, [productId]: { id: res.id!, status: "pending", price } }));
    return { ok: true };
  }, [storeId, pointId]);

  const forget = useCallback((productId?: string) => setMap((m) => {
    if (!productId) return {};
    const next = { ...m };
    delete next[productId];
    return next;
  }), []);

  const pending = Object.values(map).some((a) => a.status === "pending");
  useEffect(() => {
    if (!pending) return;
    const tick = async () => {
      const ids = Object.values(ref.current).filter((a) => a.status === "pending").map((a) => a.id);
      if (!ids.length) return;
      const { data } = await supabaseBrowser().rpc("erp_price_approval_get", { p_ids: ids });
      const rows = (data ?? []) as Array<{ id: string; status: ApprovalState["status"]; decided_by_name: string | null; decision_note: string | null }>;
      if (!rows.length) return;
      setMap((m) => {
        const next = { ...m };
        for (const [pid, a] of Object.entries(m)) {
          const r = rows.find((x) => x.id === a.id);
          if (r && r.status !== a.status) next[pid] = { ...a, status: r.status, by: r.decided_by_name, note: r.decision_note };
        }
        return next;
      });
    };
    const timer = window.setInterval(() => void tick(), 4000);
    return () => window.clearInterval(timer);
  }, [pending]);

  return { approvals: map, request, forget };
}
