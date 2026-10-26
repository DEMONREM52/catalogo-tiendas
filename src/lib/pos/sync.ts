"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { isNetworkError } from "@/lib/net/status";
import { fiscalApi } from "@/lib/fiscal/client";
import { draftKind, getDrafts, removeDraft, updateDraft, type PosDraft } from "./drafts";

let running = false;
/** Venta guardada que el cajero tiene cargada en el carrito: no se envía sola mientras tanto. */
let skipDraft: string | null = null;
export function setSyncSkip(id: string | null) {
  skipDraft = id;
}

export type SyncSent = { draft: PosDraft; doc: string; warnings: string[]; fiscal: { document_id: string; full_number: string; status: string } | null };
export type SyncResult = { sent: SyncSent[]; review: number; waiting: boolean };

type SubmitResult = {
  ok: boolean;
  code?: string;
  message?: string;
  already?: boolean;
  doc_number?: string | null;
  warnings?: string[];
  fiscal?: { document_id: string; full_number: string; status: string } | null;
  changed?: Array<{ name: string; draft: number; now: number }>;
};

const missingFn = (msg: string) => /Could not find the function|schema cache/i.test(msg);

/** Lo que se manda a la base (el borrador tal como se cobró). */
export function draftPayload(d: PosDraft) {
  return {
    id: d.id,
    point_id: d.pointId,
    seller_id: d.sellerId || null,
    kind: draftKind(d),
    created_at: d.createdAt,
    total: d.total,
    device_id: d.deviceId ?? null,
    items: d.cart.map((i) => ({ product_id: i.productId, qty: i.qty, price: i.price, level: i.priceLevel, name: i.name })),
    customer: { client_id: d.selectedClientId || null, name: d.customerName, doc: d.customerDocument || null, note: d.customerNote, whatsapp: d.customerWhatsApp || null },
    payment: d.payment ?? null,
    fiscal: d.fiscal ? { block_id: d.fiscal.block_id, number: d.fiscal.number, full_number: d.fiscal.full_number } : null,
  };
}

/** Versión anterior (sin la migración 20261243): solo remisiones, al precio de hoy. */
async function submitV1(storeId: string, d: PosDraft): Promise<{ data: SubmitResult | null; error: { message: string } | null }> {
  const { data, error } = await supabaseBrowser().rpc("erp_pos_submit_offline", {
    p_store: storeId,
    p_client_id: d.id,
    p_point: d.pointId,
    p_seller: d.sellerId || null,
    p_items: d.cart.map((i) => ({ product_id: i.productId, qty: i.qty, level: i.priceLevel, price: i.price })),
    p_customer_name: d.customerName,
    p_customer_note: d.customerNote,
    p_customer_whatsapp: d.customerWhatsApp || null,
    p_customer_doc: d.customerDocument || null,
    p_created_offline_at: d.createdAt,
  });
  if (error) return { data: null, error };
  const res = data as SubmitResult;
  if (!res.ok && res.changed?.length) {
    const detail = res.changed.map((c) => `${c.name}: $${Number(c.draft).toLocaleString("es-CO")} → $${Number(c.now).toLocaleString("es-CO")}`).join(" · ");
    return { data: { ...res, message: `${res.message ?? "Revísala a mano."} (${detail})` }, error: null };
  }
  return { data: res, error: null };
}

async function withSyncLock<T>(storeId: string, empty: T, work: () => Promise<T>): Promise<T> {
  // Una sola pestaña envía a la vez (la base igual registra cada borrador una sola vez).
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return work();
  return (await locks.request(`remhub-sync-${storeId}`, { ifAvailable: true }, async (lock) => (lock ? work() : empty))) as T;
}

/**
 * Envía las ventas guardadas sin conexión. Cada borrador se registra una sola vez en el servidor
 * (aunque se reintente). Si la red o la base fallan a mitad, se detiene y se reintenta después; lo que
 * la base rechaza (inventario, precio, permisos) queda «por revisar» aquí y en el panel del administrador.
 */
export async function syncOfflineDrafts(storeId: string, skipId?: string | null): Promise<SyncResult> {
  const out: SyncResult = { sent: [], review: 0, waiting: false };
  if (running) return out;
  running = true;
  try {
    return await withSyncLock(storeId, out, async () => {
      for (const d of getDrafts(storeId)) {
        if (d.review || d.practice || d.id === (skipId ?? skipDraft)) continue;
        if (!d.pointId) {
          await updateDraft(storeId, d.id, { review: "Elige el punto de venta y regístrala a mano.", reviewCode: "NO_POINT" });
          out.review++;
          continue;
        }
        const first = await supabaseBrowser().rpc("erp_pos_submit_offline_v2", { p_store: storeId, p_draft: draftPayload(d) });
        let data: unknown = first.data;
        let error: { message: string } | null = first.error;
        if (error && missingFn(error.message)) {
          if (draftKind(d) !== "remision") {
            await updateDraft(storeId, d.id, { review: "Falta ejecutar la migración 20261243 en Supabase para registrar facturas hechas sin conexión.", reviewCode: "MIGRATION" });
            out.review++;
            continue;
          }
          ({ data, error } = await submitV1(storeId, d));
        }
        if (error) {
          // Sin red o la base no contesta: se deja como estaba y se reintenta después.
          if (isNetworkError(error) || missingFn(error.message)) {
            out.waiting = true;
            break;
          }
          await updateDraft(storeId, d.id, { review: error.message, reviewCode: "ERROR" });
          out.review++;
          continue;
        }
        const res = data as SubmitResult;
        if (!res.ok) {
          await updateDraft(storeId, d.id, { review: res.message ?? "Revísala a mano.", reviewCode: res.code ?? "ERROR" });
          out.review++;
          continue;
        }
        await removeDraft(storeId, d.id);
        out.sent.push({ draft: d, doc: res.doc_number ?? "", warnings: res.warnings ?? [], fiscal: res.fiscal ?? null });
        // La factura electrónica (o de contingencia) se transmite de inmediato; si falla, la cola del servidor reintenta.
        if (res.fiscal?.document_id && res.fiscal.status === "QUEUED") {
          void fiscalApi("/api/fiscal/documents/send", { document_id: res.fiscal.document_id }).catch(() => undefined);
        }
      }
      return out;
    });
  } finally {
    running = false;
  }
}

/** Avisa al panel que una venta por revisar se resolvió a mano (registrada o descartada). */
export async function resolveOfflineIssue(draftId: string, note: string) {
  const { error } = await supabaseBrowser().rpc("erp_pos_offline_issue_resolve", { p_client: draftId, p_note: note });
  return !error;
}
