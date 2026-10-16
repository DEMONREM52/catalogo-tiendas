import webpush from "web-push";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeConfig, resolveEvent, type NotifEvent, type StoreNotifConfig } from "@/lib/sounds/prefs";

/** Cliente con la llave service_role (solo servidor, nunca llega al navegador). */
export function pushAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

let vapidReady: boolean | null = null;
export function pushConfigured() {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (vapidReady = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:soporte@remhub.co", pub, priv);
  return (vapidReady = true);
}

export type PushPayload = { title: string; body: string; url: string; tag?: string; urgent?: boolean; event?: NotifEvent; id?: string; point?: string | null };

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** Envía a todos los equipos de esos usuarios en la tienda. Limpia los equipos que ya no existen. */
export async function sendToUsers(admin: SupabaseClient, storeId: string, payloads: Map<string, PushPayload>) {
  const users = [...payloads.keys()];
  if (!users.length || !pushConfigured()) return { sent: 0, failed: 0 };
  const { data } = await admin.from("erp_push_subscriptions").select("id,user_id,endpoint,p256dh,auth").eq("store_id", storeId).in("user_id", users);
  const subs = (data ?? []) as Sub[];
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const payload = payloads.get(s.user_id);
      if (!payload) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: payload.urgent ? "high" : "normal" });
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id);
      }
    }),
  );
  if (gone.length) await admin.from("erp_push_subscriptions").delete().in("id", gone);
  if (sent) await admin.from("erp_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("store_id", storeId).in("user_id", users);
  return { sent, failed };
}

type Member = { user_id: string; role: string | null; permissions: string[] | null; point_id: string | null; point_ids: string[] | null; active: boolean };
const SR_PERMS = ["stock_requests", "stock_requests_manage", "transfers"];

/** Quién de la tienda participa en pedidos internos y en qué puntos. `points` vacío = toda la tienda. */
export async function stockRequestAudience(admin: SupabaseClient, storeId: string) {
  const [{ data: store }, { data: members }, { data: prefs }] = await Promise.all([
    admin.from("stores").select("owner_id").eq("id", storeId).maybeSingle(),
    admin.from("store_users").select("user_id,role,permissions,point_id,point_ids,active").eq("store_id", storeId).eq("active", true),
    admin.from("erp_notification_prefs").select("config").eq("store_id", storeId).maybeSingle(),
  ]);
  const people = new Map<string, string[]>();
  if (store?.owner_id) people.set(store.owner_id as string, []);
  for (const m of (members ?? []) as Member[]) {
    const allowed = m.role === "store_admin" || (m.permissions ?? []).some((p) => SR_PERMS.includes(p));
    if (!allowed) continue;
    const pts = [...new Set([m.point_id, ...(m.point_ids ?? [])].filter(Boolean) as string[])];
    people.set(m.user_id, pts);
  }
  const cfg: StoreNotifConfig = normalizeConfig(prefs?.config ?? null);
  return { people, cfg };
}

/**
 * Elige destinatarios: las personas del lado `sides` (puntos), más quienes ven toda la tienda si así está configurado.
 * Nunca se avisa a quien hizo la acción.
 */
export function pickRecipients(
  aud: { people: Map<string, string[]>; cfg: StoreNotifConfig },
  sides: string[],
  event: NotifEvent,
  exclude: Array<string | null | undefined>,
  build: (point: string | null) => PushPayload,
) {
  const out = new Map<string, PushPayload>();
  if (!aud.cfg.push) return out;
  for (const [userId, pts] of aud.people) {
    if (exclude.includes(userId)) continue;
    const side = pts.find((p) => sides.includes(p)) ?? null;
    if (!side && !(pts.length === 0 && aud.cfg.admins_all)) continue;
    if (!resolveEvent(aud.cfg, event, side).on) continue;
    out.set(userId, build(side));
  }
  return out;
}
