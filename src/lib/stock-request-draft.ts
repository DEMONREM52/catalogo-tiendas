"use client";

/**
 * Borrador del pedido interno (Pedidos → Internos → Nuevo), guardado solo en este equipo y por tienda.
 * Se guarda con cada cambio; si se cierra la ventana, se recarga o se sale por error, al volver a abrir
 * «Nuevo pedido» se recupera tal cual. Se borra al enviar el pedido, con «Empezar de cero» o a los 14 días.
 */
export type StockDraftLine = {
  product_id: string; name: string; sku: string | null; qty: number; there: number; here: number | null; levels?: Record<string, number>;
};
export type StockRequestDraft = {
  at: string;
  from: string;
  to: string;
  lines: StockDraftLine[];
  note: string;
  urgent: boolean;
  neededBy: string;
};

const MAX_AGE_MS = 14 * 24 * 3600_000;
const key = (storeId: string) => `remhub:sr-draft:${storeId}`;
const EVENT = "remhub-sr-draft";

export function readStockDraft(storeId: string): StockRequestDraft | null {
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (!raw) return null;
    const d = JSON.parse(raw) as StockRequestDraft;
    if (!d || !Array.isArray(d.lines) || (!d.lines.length && !d.note)) return null;
    if (Date.now() - new Date(d.at).getTime() > MAX_AGE_MS) { window.localStorage.removeItem(key(storeId)); return null; }
    return d;
  } catch {
    return null;
  }
}

export function saveStockDraft(storeId: string, draft: Omit<StockRequestDraft, "at"> | null) {
  try {
    if (!draft || (!draft.lines.length && !draft.note.trim())) window.localStorage.removeItem(key(storeId));
    else window.localStorage.setItem(key(storeId), JSON.stringify({ ...draft, at: new Date().toISOString() }));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* sin almacenamiento: el formulario sigue funcionando */
  }
}

export function onStockDraftChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

/** «hace 5 min», «hace 2 h», «hace 3 días». */
export function draftAge(at: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}
