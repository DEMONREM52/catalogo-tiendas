"use client";

import type { HeldItem } from "./held";

/**
 * Venta en curso del POS guardada sola en este equipo (por tienda y por usuario).
 * Si la página se recarga, se cierra la pestaña, se va el internet o se actualiza el sistema,
 * al volver al POS se recupera el carrito y el cliente tal como estaban.
 * No es una venta: no descuenta inventario ni tiene número hasta que se registra.
 * Se borra sola al registrar la venta, ponerla en espera o vaciar el carrito; y a los 3 días.
 */
export type CurrentSale = {
  at: string;
  cart: HeldItem[];
  total: number;
  customerName: string;
  selectedClientId: string;
  customerDocument: string;
  customerWhatsApp: string;
  customerNote: string;
  documentKind: "remision" | "factura";
  pointId: string;
  sellerId: string;
};

const MAX_AGE_MS = 3 * 24 * 3600_000;
const key = (storeId: string, userId: string) => `remhub:pos-current:${storeId}:${userId || "-"}`;

export function readCurrentSale(storeId: string, userId: string): CurrentSale | null {
  try {
    const raw = window.localStorage.getItem(key(storeId, userId));
    if (!raw) return null;
    const sale = JSON.parse(raw) as CurrentSale;
    if (!sale || !Array.isArray(sale.cart) || sale.cart.length === 0) return null;
    if (Date.now() - new Date(sale.at).getTime() > MAX_AGE_MS) {
      window.localStorage.removeItem(key(storeId, userId));
      return null;
    }
    return sale;
  } catch {
    return null;
  }
}

/** Guarda la venta en curso (o la borra si el carrito quedó vacío). */
export function saveCurrentSale(storeId: string, userId: string, sale: Omit<CurrentSale, "at"> | null) {
  try {
    if (!sale || sale.cart.length === 0) window.localStorage.removeItem(key(storeId, userId));
    else window.localStorage.setItem(key(storeId, userId), JSON.stringify({ ...sale, at: new Date().toISOString() }));
  } catch {
    /* sin almacenamiento (modo privado lleno): el POS sigue funcionando */
  }
}
