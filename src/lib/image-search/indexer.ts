"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_MODEL, embedImageBlob, fetchImageBlob, imageSearchSupported, loadImageEmbedder } from "./embed";

/**
 * Analiza en segundo plano las fotos de los productos (las que aún no tienen huella) para que la
 * búsqueda por foto las encuentre. Va de a pocas, en pausa si la pestaña no está visible.
 */

export type IndexStatus = {
  state: "idle" | "checking" | "running" | "done" | "error" | "unavailable";
  pending: number;
  total: number;
  ready: number;
  message?: string;
};

type Pending = { ok?: boolean; items: Array<{ product_id: string; image_url: string }>; pending: number; total: number; ready: number };

let status: IndexStatus = { state: "idle", pending: 0, total: 0, ready: 0 };
const listeners = new Set<(s: IndexStatus) => void>();
let running: string | null = null;

function set(next: Partial<IndexStatus>) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
}

export function onIndexStatus(fn: (s: IndexStatus) => void) {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

export const INDEX_EVENT = "remhub:image-index";

/** Pide analizar ya las fotos pendientes (p. ej. al guardar un producto con foto nueva). */
export function requestImageIndex() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INDEX_EVENT));
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const idle = () => new Promise<void>((r) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 400 });
  else window.setTimeout(r, 60);
});

async function pending(storeId: string, limit: number): Promise<Pending | null> {
  const { data, error } = await supabaseBrowser().rpc("product_image_pending", { p_store: storeId, p_model: IMAGE_MODEL, p_limit: limit });
  if (error) {
    // Falta ejecutar la migración: no se insiste.
    set({ state: "unavailable", message: /Could not find|schema cache|does not exist/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261031_codigo_y_busqueda_por_foto.sql." : error.message });
    return null;
  }
  const res = data as Pending;
  if (res?.ok === false) {
    set({ state: "unavailable", message: "Tu usuario no puede analizar fotos." });
    return null;
  }
  set({ pending: Number(res.pending ?? 0), total: Number(res.total ?? 0), ready: Number(res.ready ?? 0) });
  return res;
}

/** Revisa cuántas fotos faltan sin analizar nada. */
export async function refreshIndexStatus(storeId: string) {
  set({ state: status.state === "running" ? "running" : "checking" });
  const res = await pending(storeId, 1);
  if (res && status.state !== "running") set({ state: res.pending ? "idle" : "done" });
}

/** Analiza todas las fotos pendientes de la tienda. Si ya está corriendo no hace nada. */
export async function runImageIndex(storeId: string) {
  if (running === storeId || !imageSearchSupported()) return;
  running = storeId;
  try {
    set({ state: "checking", message: undefined });
    let batch = await pending(storeId, 6);
    if (!batch) return;
    if (!batch.items.length) {
      set({ state: "done" });
      return;
    }
    set({ state: "running" });
    await loadImageEmbedder();
    while (batch && batch.items.length) {
      const out: Array<Record<string, unknown>> = [];
      for (const item of batch.items) {
        while (document.hidden) await sleep(3000);
        try {
          const blob = await fetchImageBlob(item.image_url);
          out.push({ ...item, embedding: await embedImageBlob(blob) });
        } catch {
          // Imagen rota o que no deja descargarse: se marca para no reintentar cada vez.
          out.push({ ...item, failed: true });
        }
        await idle();
      }
      const { error } = await supabaseBrowser().rpc("product_image_save", { p_store: storeId, p_model: IMAGE_MODEL, p_items: out });
      if (error) throw error;
      batch = await pending(storeId, 6);
    }
    set({ state: "done" });
  } catch (error) {
    set({ state: "error", message: error instanceof Error ? error.message : "No se pudieron analizar las fotos." });
  } finally {
    running = null;
  }
}
