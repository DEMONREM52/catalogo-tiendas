import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Timbre de una llamada (20261268) en los celulares y computadores de quienes la reciben, aunque RemHub esté cerrada.
 * Solo quien hizo la llamada puede hacerla timbrar, y solo mientras sigue timbrando.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = (await request.json().catch(() => null)) as { call_id?: string; ended?: boolean } | null;
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, sent: 0, message: "Las notificaciones aún no están configuradas en el servidor (faltan las llaves VAPID)." });
  if (!token || !body?.call_id || !UUID.test(body.call_id)) return NextResponse.json({ ok: false }, { status: 400 });
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: c } = await admin.from("erp_calls").select("id,store_id,request_id,caller_id,caller_name,video,status").eq("id", body.call_id).maybeSingle();
  const call = c as { id: string; store_id: string; request_id: string | null; caller_id: string; caller_name: string | null; video: boolean; status: string } | null;
  if (!call || call.caller_id !== userId) return NextResponse.json({ ok: false }, { status: 403 });
  // ended: la llamada ya se canceló o nadie contestó → se cambia la notificación por «Llamada perdida» (sin «Contestar»).
  const ended = body.ended === true;
  if (ended ? call.status === "ringing" || call.status === "active" : call.status !== "ringing") return NextResponse.json({ ok: false }, { status: 409 });

  const [{ data: inv }, { data: r }] = await Promise.all([
    ended
      ? admin.from("erp_call_invites").select("user_id").eq("call_id", call.id).in("status", ["missed", "ringing"])
      : admin.from("erp_call_invites").select("user_id").eq("call_id", call.id).eq("status", "ringing"),
    call.request_id ? admin.from("erp_stock_requests").select("number,from_point_id").eq("id", call.request_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const req = r as { number?: number; from_point_id?: string } | null;
  let where = "";
  if (req?.from_point_id) {
    const { data: w } = await admin.from("erp_warehouses").select("name").eq("id", req.from_point_id).maybeSingle();
    where = (w as { name?: string } | null)?.name ?? "";
  }
  const payload: PushPayload = ended ? {
    title: `${call.video ? "🎥 Videollamada" : "📞 Llamada"} perdida de ${call.caller_name ?? "tu equipo"}`,
    body: `${req?.number ? `Pedido interno #${req.number}` : "Pedido interno"}${where ? ` · ${where}` : ""}. Toca para abrir el pedido.`,
    url: "/dashboard/pedidos?tab=internos",
    tag: `call-${call.id}`,
    quiet: true,
    ttl: 300,
  } : {
    title: `${call.video ? "🎥 Videollamada" : "📞 Llamada"} de ${call.caller_name ?? "tu equipo"}`,
    body: `${req?.number ? `Pedido interno #${req.number}` : "Pedido interno"}${where ? ` · ${where}` : ""}. Toca para contestar.`,
    url: `/dashboard/pedidos?tab=internos&llamada=${call.id}`,
    tag: `call-${call.id}`,
    urgent: true,
    call: { id: call.id, video: call.video },
    ttl: 45,
  };
  const users = ((inv ?? []) as Array<{ user_id: string }>).map((x) => x.user_id);
  const res = await sendToUsers(admin, call.store_id, new Map(users.map((u) => [u, payload])));
  return NextResponse.json({ ok: true, sent: res.sent });
}
