"use client";

import { idbGet, idbSet } from "@/lib/offline/idb";
import type { ContingencyIssuer } from "./contingency";

/**
 * Ventas del POS guardadas sin conexión (borradores). Viven en este equipo hasta que se registran.
 * Cada una se guarda DOS veces (localStorage y el almacén grande del equipo, IndexedDB): si uno se llena
 * o falla, queda la otra copia. Si no quedó en ninguna, saveDraft lo dice para no perder la venta.
 * No guardan costos ni datos sensibles: solo lo que el cajero ya tenía en pantalla para la venta.
 * Un borrador NO es una venta: no descuenta inventario hasta que se registra en línea.
 */

export type PosDraftItem = { productId: string; name: string; qty: number; price: number; priceLevel: number; note: string; taxRate?: number };
/** remision · factura (interna, o electrónica que se emite al volver) · contingencia (factura en papel con número separado). */
export type PosDraftKind = "remision" | "factura" | "contingencia";
export type PosDraftPayment = { method: string; parts: Array<{ method: string; amount: number }>; received: number | null; change: number };
/** Número de la factura de contingencia (separado antes por este equipo) y lo que se imprimió con ella. */
export type PosDraftFiscal = {
  block_id: string;
  range_id: string;
  number: number;
  prefix: string;
  full_number: string;
  environment?: string;
  resolution?: { number: string | null; date: string | null; valid_from: string | null; valid_until: string | null; from: number; to: number };
  /** Emisor del punto donde se hizo la venta (la reimpresión sale igual aunque se cambie de punto). */
  issuer?: ContingencyIssuer | null;
  prices_include_tax?: boolean;
  final_consumer_doc?: string;
};
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
  /** Tipo con que se registra (si falta, se toma documentKind). */
  kind?: PosDraftKind;
  pointId: string;
  pointName?: string;
  sellerId: string;
  sellerName?: string;
  payment?: PosDraftPayment;
  fiscal?: PosDraftFiscal;
  deviceId?: string;
  /** Si el envío automático no se pudo hacer: el cajero la revisa (y el administrador la ve en el panel). */
  review?: string;
  reviewCode?: string;
  /** Autorizaciones de precio que ya tenía la venta. */
  approvals?: import("./held").SavedApprovals;
  /** Venta del modo práctica: nunca se envía y se borra al terminar la práctica. */
  practice?: boolean;
};

const key = (storeId: string) => `remhub:pos-drafts:${storeId}`;
const idbKey = (storeId: string) => `drafts:${storeId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, PosDraft[]>();
const EMPTY: PosDraft[] = [];
const restored = new Set<string>();

export const draftKind = (d: Pick<PosDraft, "kind" | "documentKind">): PosDraftKind => d.kind ?? d.documentKind;

function readLocal(storeId: string): PosDraft[] | null {
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (raw === null) return null;
    return (JSON.parse(raw) as PosDraft[]).filter((d) => d && Array.isArray(d.cart));
  } catch {
    return null;
  }
}

function read(storeId: string): PosDraft[] {
  const hit = cache.get(storeId);
  if (hit) return hit;
  const list = readLocal(storeId) ?? [];
  cache.set(storeId, list);
  return list;
}

function notify() {
  listeners.forEach((fn) => fn());
}

/** Guarda la lista en las dos copias. Devuelve si quedó en el equipo (en al menos una). */
async function write(storeId: string, list: PosDraft[]): Promise<boolean> {
  cache.set(storeId, list);
  let local = false;
  try {
    window.localStorage.setItem(key(storeId), JSON.stringify(list));
    local = true;
  } catch {
    /* sin espacio o bloqueado: queda la copia de IndexedDB */
  }
  notify();
  const big = await idbSet(idbKey(storeId), list);
  return local || big;
}

/**
 * Recupera la copia de respaldo si localStorage se perdió o se dañó (una vez por tienda y sesión).
 * Si localStorage tiene su lista, manda ella y el respaldo se actualiza con lo de localStorage.
 */
export async function restoreDrafts(storeId: string | null | undefined) {
  if (!storeId || typeof window === "undefined" || restored.has(storeId)) return;
  restored.add(storeId);
  const local = readLocal(storeId);
  const backup = await idbGet<PosDraft[]>(idbKey(storeId));
  if (local === null && Array.isArray(backup) && backup.length) {
    await write(storeId, backup.filter((d) => d && Array.isArray(d.cart)));
  } else if (local !== null) {
    await idbSet(idbKey(storeId), local);
  }
}

export function getDrafts(storeId: string | null | undefined): PosDraft[] {
  if (!storeId || typeof window === "undefined") return EMPTY;
  return read(storeId);
}

/** Guarda una venta. `durable: false` = el navegador no dejó guardarla en el equipo (anótala en papel). */
export async function saveDraft(draft: Omit<PosDraft, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<{ draft: PosDraft; durable: boolean }> {
  const d: PosDraft = { ...draft, id: draft.id ?? crypto.randomUUID(), createdAt: draft.createdAt ?? new Date().toISOString() };
  const durable = await write(draft.storeId, [...read(draft.storeId).filter((x) => x.id !== d.id), d]);
  return { draft: d, durable };
}

export function updateDraft(storeId: string, id: string, patch: Partial<PosDraft>) {
  return write(storeId, read(storeId).map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export function removeDraft(storeId: string, id: string) {
  return write(storeId, read(storeId).filter((d) => d.id !== id));
}

/** Ventas reales guardadas en este equipo (sin las de práctica), para avisar antes de cerrar sesión. */
export function pendingDraftCount(storeId: string | null | undefined) {
  return getDrafts(storeId).filter((d) => !d.practice).length;
}

/** Borra las ventas de la práctica «sin internet». */
export function clearPracticeDrafts(storeId: string) {
  const list = read(storeId);
  if (!list.some((d) => d.practice)) return Promise.resolve(true);
  return write(storeId, list.filter((d) => !d.practice));
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
