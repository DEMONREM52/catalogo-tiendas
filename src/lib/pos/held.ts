"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Ventas en espera del POS: el cliente fue por la billetera y se atiende a otro.
 * Viven solo en este equipo, por tienda y punto. No son ventas: no descuentan inventario ni tienen número.
 */
export type HeldItem = { productId: string; name: string; qty: number; price: number; priceLevel: number; note: string; manual?: boolean };
export type HeldSale = {
  id: string;
  at: string;
  cart: HeldItem[];
  total: number;
  customerName: string;
  selectedClientId: string;
  customerDocument: string;
  customerWhatsApp: string;
  customerNote: string;
};

const MAX = 12;
const key = (store: string, point: string) => `remhub:pos-held:${store}:${point || "-"}`;

function read(k: string): HeldSale[] {
  try {
    const raw = window.localStorage.getItem(k);
    const list = raw ? (JSON.parse(raw) as HeldSale[]) : [];
    return Array.isArray(list) ? list.filter((h) => h && Array.isArray(h.cart)) : [];
  } catch {
    return [];
  }
}
function write(k: string, list: HeldSale[]) {
  try { window.localStorage.setItem(k, JSON.stringify(list.slice(0, MAX))); } catch { /* sin almacenamiento */ }
}

export function useHeldSales(storeId: string | undefined, pointId: string) {
  const k = storeId ? key(storeId, pointId) : null;
  const [list, setList] = useState<HeldSale[]>([]);
  useEffect(() => {
    if (!k) return;
    const sync = () => setList(read(k));
    sync();
    const onStorage = (e: StorageEvent) => { if (e.key === k) sync(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [k]);

  const hold = useCallback((sale: Omit<HeldSale, "id" | "at">) => {
    if (!k) return;
    const next = [{ ...sale, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() }, ...read(k)];
    write(k, next);
    setList(next.slice(0, MAX));
  }, [k]);

  const take = useCallback((id: string) => {
    if (!k) return null;
    const all = read(k);
    const hit = all.find((h) => h.id === id) ?? null;
    const next = all.filter((h) => h.id !== id);
    write(k, next);
    setList(next);
    return hit;
  }, [k]);

  return { held: list, hold, take };
}
