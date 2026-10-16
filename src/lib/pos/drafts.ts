"use client";

/**
 * Ventas del POS guardadas sin internet (borradores). Viven solo en este equipo/navegador hasta que se envían.
 * No guardan costos ni datos sensibles: solo lo que el cajero ya tenía en pantalla para la venta.
 * Un borrador NO es una venta: no descuenta inventario ni tiene número hasta que se registra en línea.
 */

export type PosDraftItem = { productId: string; name: string; qty: number; price: number; priceLevel: number; note: string };
export type PosDraft = {
  id: string;
  storeId: string;
  createdAt: string;
  cart: PosDraftItem[];
  total: number;
  customerName: string;
  customerNote: string;
  customerWhatsApp: string;
  customerDocument: string;
  selectedClientId: string;
  documentKind: "remision" | "factura";
  pointId: string;
  sellerId: string;
  /** Si el envío automático no se pudo hacer: el cajero la revisa y la registra a mano. */
  review?: string;
  /** Autorizaciones de precio que ya tenía la venta. */
  approvals?: import("./held").SavedApprovals;
};

const key = (storeId: string) => `remhub:pos-drafts:${storeId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, PosDraft[]>();
const EMPTY: PosDraft[] = [];

function read(storeId: string): PosDraft[] {
  const hit = cache.get(storeId);
  if (hit) return hit;
  let list: PosDraft[] = [];
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (raw) list = (JSON.parse(raw) as PosDraft[]).filter((d) => d && Array.isArray(d.cart));
  } catch {
    /* sin almacenamiento */
  }
  cache.set(storeId, list);
  return list;
}

function write(storeId: string, list: PosDraft[]) {
  cache.set(storeId, list);
  try {
    window.localStorage.setItem(key(storeId), JSON.stringify(list));
  } catch {
    /* sin almacenamiento: queda en memoria mientras la página siga abierta */
  }
  listeners.forEach((fn) => fn());
}

export function getDrafts(storeId: string | null | undefined): PosDraft[] {
  if (!storeId || typeof window === "undefined") return EMPTY;
  return read(storeId);
}

export function saveDraft(draft: Omit<PosDraft, "id" | "createdAt">): PosDraft {
  const d: PosDraft = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  write(draft.storeId, [...read(draft.storeId), d]);
  return d;
}

export function updateDraft(storeId: string, id: string, patch: Partial<PosDraft>) {
  write(storeId, read(storeId).map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export function removeDraft(storeId: string, id: string) {
  write(storeId, read(storeId).filter((d) => d.id !== id));
}

export function subscribeDrafts(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("remhub:pos-drafts:")) {
      cache.clear();
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
