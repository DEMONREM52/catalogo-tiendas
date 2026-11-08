import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";
import { sendContingencyWhatsApp, type WaProvider } from "@/lib/notify/whatsapp";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vigilancia de trabajo sin conexión (cron de Vercel, cada hora):
 *  · Facturas de contingencia cerca del plazo de 48 h de la DIAN (24 h, 6 h y vencido): WhatsApp al dueño
 *    (y los números que él eligió) + notificación al celular del dueño, administradores y facturación.
 *    Cada etapa se avisa una sola vez (erp_whatsapp_log / erp_push_log); un WhatsApp que falla se reintenta
 *    la hora siguiente (máximo 3 veces).
 *  (El simulacro mensual sin internet y sus recordatorios se quitaron el 2026-11-08.)
 */
type Watch = { store_id: string; store_name: string; slug: string; stage: "h24" | "h6" | "overdue"; docs: number; issues: number; hours_left: number; deadline: string; first_id: string; recipients: string[] };

const bogota = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" });

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin) return NextResponse.json({ ok: false, skipped: "not-configured" });
  const contingency = await contingencyWatch(admin);
  // El simulacro mensual se quitó (2026-11-08): ya no se mandan sus recordatorios.
  return NextResponse.json({ ok: true, contingency });
}

async function contingencyWatch(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("erp_contingency_watch");
  if (error) return { skipped: /Could not find the function|schema cache/i.test(error.message) ? "migration" : error.message };
  let whatsapp = 0;
  let failed = 0;
  let push = 0;
  for (const row of (data ?? []) as Watch[]) {
    const count = row.docs + row.issues;
    const hours = row.stage === "overdue" ? "Ya pasó el plazo de 48 horas" : `Quedan ${Math.max(0, Math.floor(Number(row.hours_left)))} horas`;
    const vars = { store: row.store_name, count: String(count), hours, deadline: bogota(row.deadline) };
    const link = `${PRODUCTION_ORIGIN}/dashboard/fiscal?tab=contingencias`;

    // WhatsApp (si la tienda lo activó).
    const { data: cfg } = await admin.from("erp_whatsapp_settings").select("enabled,provider,numbers,events").eq("store_id", row.store_id).maybeSingle();
    if (cfg?.enabled && ((cfg.events as string[] | null) ?? []).includes("contingency")) {
      const provider = cfg.provider as WaProvider;
      const keys = new Map<string, string>();
      if (provider === "callmebot") {
        const { data: k } = await admin.from("erp_whatsapp_keys").select("number,apikey").eq("store_id", row.store_id);
        for (const x of (k ?? []) as Array<{ number: string; apikey: string }>) keys.set(x.number, x.apikey);
      }
      for (const number of (cfg.numbers as string[] | null) ?? []) {
        const key = `wa:contingency:${row.store_id}:${row.stage}:${row.first_id}:${number}`;
        const { count: tries } = await admin.from("erp_whatsapp_log").select("id", { count: "exact", head: true }).like("key", `${key}:failed:%`);
        if ((tries ?? 0) >= 3) continue;
        const { data: ins, error: dup } = await admin.from("erp_whatsapp_log")
          .insert({ store_id: row.store_id, key, number, event: `contingency_${row.stage}`, status: "pending" }).select("id").single();
        if (dup || !ins) continue; // ya se avisó en esta etapa
        const r = await sendContingencyWhatsApp(provider, number, vars, link, keys.get(number));
        // Si falla, la llave queda libre para reintentar la próxima hora (y el error queda a la vista del dueño).
        await admin.from("erp_whatsapp_log")
          .update(r.ok ? { status: "sent" } : { status: "failed", error: r.error ?? null, key: `${key}:failed:${Date.now()}` })
          .eq("id", (ins as { id: number }).id);
        if (r.ok) whatsapp++;
        else failed++;
      }
    }

    // Notificación al celular (gratis, si instalaron la app y la activaron).
    if (pushConfigured()) {
      const payload: PushPayload = {
        title: row.stage === "overdue" ? "🔴 Factura de contingencia vencida" : row.stage === "h6" ? "⏰ Facturas de contingencia: quedan pocas horas" : "⚠️ Facturas de contingencia por transmitir",
        body: `${count} sin aceptar por la DIAN · ${hours} (vence ${vars.deadline}). Toca para revisarlas.`,
        url: "/dashboard/fiscal?tab=contingencias",
        tag: `contingency-${row.store_id}`,
        urgent: row.stage !== "h24",
      };
      const payloads = new Map<string, PushPayload>();
      for (const u of row.recipients ?? []) {
        const { error: dup } = await admin.from("erp_push_log").insert({ key: `contingency:${row.store_id}:${row.stage}:${row.first_id}:${u}` });
        if (!dup) payloads.set(u, payload);
      }
      if (payloads.size) push += (await sendToUsers(admin, row.store_id, payloads)).sent;
    }
  }
  return { stores: (data ?? []).length, whatsapp, failed, push };
}
