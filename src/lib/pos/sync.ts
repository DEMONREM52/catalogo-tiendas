"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { getDrafts, removeDraft, updateDraft, type PosDraft } from "./drafts";

let running = false;

export type SyncResult = { sent: Array<{ draft: PosDraft; doc: string }>; review: number };

/**
 * Envía las remisiones guardadas sin internet. Cada borrador se registra una sola vez en el servidor
 * (aunque se reintente). Las facturas y los borradores con precios cambiados quedan para revisión manual.
 */
export async function syncOfflineDrafts(storeId: string, skipId?: string | null): Promise<SyncResult> {
  const out: SyncResult = { sent: [], review: 0 };
  if (running) return out;
  running = true;
  try {
    for (const d of getDrafts(storeId)) {
      if (d.review || d.id === skipId) continue;
      if (d.documentKind !== "remision") {
        updateDraft(storeId, d.id, { review: "Las facturas se registran a mano para emitirlas en la DIAN." });
        out.review++;
        continue;
      }
      if (!d.pointId) {
        updateDraft(storeId, d.id, { review: "Elige el punto de venta y regístrala a mano." });
        out.review++;
        continue;
      }
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
      if (error) {
        // Sin la migración o sin red: se deja como estaba y se reintenta después.
        if (/Could not find the function|schema cache|Failed to fetch|NetworkError|Load failed/i.test(error.message)) break;
        updateDraft(storeId, d.id, { review: error.message });
        out.review++;
        continue;
      }
      const res = data as { ok: boolean; code?: string; message?: string; doc_number?: string; changed?: Array<{ name: string; draft: number; now: number }> };
      if (!res.ok) {
        const detail = res.changed?.map((c) => `${c.name}: $${Number(c.draft).toLocaleString("es-CO")} → $${Number(c.now).toLocaleString("es-CO")}`).join(" · ");
        updateDraft(storeId, d.id, { review: `${res.message ?? "Revísala a mano."}${detail ? ` (${detail})` : ""}` });
        out.review++;
        continue;
      }
      removeDraft(storeId, d.id);
      out.sent.push({ draft: d, doc: res.doc_number ?? "" });
    }
  } finally {
    running = false;
  }
  return out;
}
