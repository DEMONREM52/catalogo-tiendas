import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNoticeWhatsApp, type WaProvider } from "./whatsapp";

export type StoreWaEvent = "payables" | "daily_close";

/**
 * Manda un aviso por WhatsApp a los números de la tienda, si eligió ese aviso (20261245).
 * Una sola vez por llave (`dedupe`); si falla, la llave queda libre para el próximo intento.
 */
export async function notifyStoreWhatsApp(admin: SupabaseClient, storeId: string, event: StoreWaEvent, storeName: string, text: string, dedupe: string) {
  const { data: cfg } = await admin.from("erp_whatsapp_settings").select("enabled,provider,numbers,events").eq("store_id", storeId).maybeSingle();
  if (!cfg?.enabled || !((cfg.events as string[] | null) ?? []).includes(event)) return { sent: 0, failed: 0 };
  const provider = cfg.provider as WaProvider;
  const keys = new Map<string, string>();
  if (provider === "callmebot") {
    const { data: k } = await admin.from("erp_whatsapp_keys").select("number,apikey").eq("store_id", storeId);
    for (const x of (k ?? []) as Array<{ number: string; apikey: string }>) keys.set(x.number, x.apikey);
  }
  let sent = 0;
  let failed = 0;
  for (const number of (cfg.numbers as string[] | null) ?? []) {
    const key = `wa:${event}:${storeId}:${dedupe}:${number}`;
    const { data: ins, error: dup } = await admin.from("erp_whatsapp_log").insert({ store_id: storeId, key, number, event, status: "pending" }).select("id").single();
    if (dup || !ins) continue;
    const r = await sendNoticeWhatsApp(provider, number, storeName, text, keys.get(number));
    await admin.from("erp_whatsapp_log")
      .update(r.ok ? { status: "sent" } : { status: "failed", error: r.error ?? null, key: `${key}:failed:${Date.now()}` })
      .eq("id", (ins as { id: number }).id);
    if (r.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
