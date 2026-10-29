import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, stockRequestAudience } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Revisión de las notificaciones (lo que se ve desde el servidor): llaves, si este equipo quedó registrado,
 * si al usuario le llegan los avisos de pedidos internos, si la tienda los tiene activados y si la base
 * avisa a la dirección correcta. Solo datos del propio usuario.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = (await request.json().catch(() => null)) as { store_id?: string; endpoint?: string | null } | null;
  const admin = pushAdminClient();
  const keys = pushConfigured();
  if (!admin) return NextResponse.json({ ok: false, keys });
  if (!token || !body?.store_id || !UUID.test(body.store_id)) return NextResponse.json({ ok: false }, { status: 400 });
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const [subs, aud, hook] = await Promise.all([
    admin.from("erp_push_subscriptions").select("endpoint,last_used_at,created_at").eq("store_id", body.store_id).eq("user_id", userId),
    stockRequestAudience(admin, body.store_id).catch(() => null),
    admin.from("app_private_config").select("value").eq("key", "push_webhook_url").maybeSingle(),
  ]);
  const list = (subs.data ?? []) as Array<{ endpoint: string; last_used_at: string | null; created_at: string }>;
  const mine = body.endpoint ? list.find((s) => s.endpoint === body.endpoint) ?? null : null;
  const url = (hook.data as { value?: string } | null)?.value ?? "";
  return NextResponse.json({
    ok: true,
    keys,
    subscribed: Boolean(mine),
    lastDelivered: mine?.last_used_at ?? null,
    devices: list.length,
    audience: aud ? aud.people.has(userId) : null,
    storePush: aud ? aud.cfg.push : null,
    webhook: hook.error ? "unknown" : !url ? "missing" : /remhub\.store/i.test(url) ? "old-domain" : "ok",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
