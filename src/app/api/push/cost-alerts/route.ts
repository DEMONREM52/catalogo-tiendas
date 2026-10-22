import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * La base (pg_net, 20261225) llama aquí cuando una venta del POS lleva productos por debajo del costo.
 * Solo recibe {order_id}: todo se lee de la base. Una sola vez por venta (erp_push_log) y solo si es reciente.
 */
const FRESH_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

type Alert = {
  store_id: string; created_at: string; doc: string | null; seller: string | null; point: string | null; loss: number;
  items: Array<{ product: string; qty: number; price: number; cost: number }>; users: string[];
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { order_id?: string } | null;
  const id = body?.order_id ?? "";
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, skipped: "not-configured" });

  const { data, error } = await admin.rpc("erp_cost_alert_push", { p_order: id });
  const a = data as Alert | null;
  if (error || !a?.store_id) return NextResponse.json({ ok: false, skipped: "not-found" });
  if (Date.now() - new Date(a.created_at).getTime() > FRESH_MS) return NextResponse.json({ ok: false, skipped: "old" });
  const { error: dup } = await admin.from("erp_push_log").insert({ key: `cost:${id}` });
  if (dup) return NextResponse.json({ ok: true, skipped: "duplicate" });

  const first = a.items[0];
  const payload: PushPayload = {
    title: "⚠️ Venta por debajo del costo",
    body: `${a.seller ?? "Alguien"}${a.point ? ` en ${a.point}` : ""} vendió ${first?.product ?? "un producto"} a ${money(first?.price ?? 0)}`
      + `${a.items.length > 1 ? ` y ${a.items.length - 1} más` : ""} · pérdida ${money(a.loss)}${a.doc ? ` · ${a.doc}` : ""}.`,
    url: "/dashboard?alertas=costo",
    tag: `cost-${id}`,
    urgent: true,
  };
  const payloads = new Map<string, PushPayload>((a.users ?? []).map((u) => [u, payload]));
  const res = await sendToUsers(admin, a.store_id, payloads);
  return NextResponse.json({ ok: true, ...res });
}
