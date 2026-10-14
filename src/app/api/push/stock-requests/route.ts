import { NextResponse } from "next/server";
import { pickRecipients, pushAdminClient, pushConfigured, sendToUsers, stockRequestAudience, type PushPayload } from "@/lib/push/server";
import { statusEvent } from "@/lib/sounds/prefs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * La base de datos (pg_net) llama aquí cuando se crea un pedido interno, llega un mensaje o cambia un estado.
 * Solo recibe {type, id}: todo lo demás se lee de la base. Cada evento se envía una sola vez (erp_push_log)
 * y solo si es reciente, así una llamada falsa o repetida no puede mandar avisos.
 */
const FRESH_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Req = {
  id: string; store_id: string; number: number; status: string; priority: string; from_point_id: string; to_point_id: string;
  requested_by: string | null; handled_by: string | null; created_at: string; updated_at: string;
};

const STATUS_TEXT: Record<string, [string, string]> = {
  preparing: ["🧑‍🔧 Están preparando tu pedido", "ya lo está preparando"],
  dispatched: ["🚚 Tu pedido va en camino", "ya lo despachó. Confírmalo al recibir"],
  received: ["✅ Pedido recibido", "confirmó que le llegó la mercancía"],
  rejected: ["⛔ Pedido rechazado", "no pudo atender el pedido"],
  cancelled: ["🚫 Pedido cancelado", "canceló el pedido"],
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { type?: string; id?: string; status?: string } | null;
  const type = body?.type;
  const id = body?.id ?? "";
  if (!body || !UUID.test(id) || (type !== "request" && type !== "message" && type !== "status")) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, skipped: "not-configured" });

  // 1. Leer de la base el evento real.
  let req: Req | null = null;
  let msg: { id: string; request_id: string; user_id: string | null; user_name: string | null; point_name: string | null; body: string; kind: string; created_at: string } | null = null;
  const reqCols = "id,store_id,number,status,priority,from_point_id,to_point_id,requested_by,handled_by,created_at,updated_at";
  if (type === "message") {
    const { data } = await admin.from("erp_stock_request_messages").select("id,request_id,user_id,user_name,point_name,body,kind,created_at").eq("id", id).maybeSingle();
    msg = data;
    if (!msg || msg.kind !== "message") return NextResponse.json({ ok: false, skipped: "not-found" });
    const { data: r } = await admin.from("erp_stock_requests").select(reqCols).eq("id", msg.request_id).maybeSingle();
    req = r as Req | null;
  } else {
    const { data: r } = await admin.from("erp_stock_requests").select(reqCols).eq("id", id).maybeSingle();
    req = r as Req | null;
  }
  if (!req) return NextResponse.json({ ok: false, skipped: "not-found" });
  const when = type === "message" ? msg!.created_at : type === "request" ? req.created_at : req.updated_at;
  if (Date.now() - new Date(when).getTime() > FRESH_MS) return NextResponse.json({ ok: false, skipped: "old" });
  if (type === "status" && (!statusEvent(req.status) || (body.status && body.status !== req.status))) return NextResponse.json({ ok: false, skipped: "status" });

  // 2. Una sola vez por evento.
  const key = type === "message" ? `message:${id}` : type === "request" ? `request:${id}` : `status:${id}:${req.status}`;
  const { error: dup } = await admin.from("erp_push_log").insert({ key });
  if (dup) return NextResponse.json({ ok: true, skipped: "duplicate" });

  // 3. Destinatarios y texto.
  const [aud, { data: wh }] = await Promise.all([
    stockRequestAudience(admin, req.store_id),
    admin.from("erp_warehouses").select("id,name").in("id", [req.from_point_id, req.to_point_id]),
  ]);
  const name = (pid: string) => (wh ?? []).find((w) => w.id === pid)?.name ?? "Otro punto";
  const from = name(req.from_point_id);
  const to = name(req.to_point_id);
  const url = `/dashboard/pedidos?tab=internos&pedido=${req.id}`;
  const tag = `sr-${req.id}`;
  let recipients: Map<string, PushPayload>;

  if (type === "request") {
    const urgent = req.priority === "urgent";
    const { count } = await admin.from("erp_stock_request_items").select("id", { count: "exact", head: true }).eq("request_id", req.id);
    const n = count ?? 0;
    const event = urgent ? "urgent_request" : "new_request";
    recipients = pickRecipients(aud, [req.to_point_id], event, [req.requested_by], (point) => ({
      title: `${urgent ? "⚡ Pedido URGENTE" : "📦 Nuevo pedido interno"} #${req!.number}`,
      body: `${from} le pide ${n || ""} producto${n === 1 ? "" : "s"} a ${to}. Revisa y prepáralo.`.replace("  ", " "),
      url, tag, urgent, event, id: req!.id, point,
    }));
  } else if (type === "message") {
    recipients = pickRecipients(aud, [req.from_point_id, req.to_point_id], "message", [msg!.user_id], (point) => ({
      title: `💬 ${msg!.user_name ?? "Nuevo mensaje"}${msg!.point_name ? ` · ${msg!.point_name}` : ""}`,
      body: `Pedido #${req!.number}: ${msg!.body.slice(0, 160)}`,
      url, tag: `${tag}-chat`, event: "message", id: req!.id, point,
    }));
  } else {
    const event = statusEvent(req.status)!;
    // Avisa al otro lado: recibido/cancelado → quien atiende; lo demás → quien pidió.
    const toAttender = req.status === "received" || req.status === "cancelled";
    const side = toAttender ? req.to_point_id : req.from_point_id;
    const actor = toAttender ? (req.status === "cancelled" ? req.requested_by : null) : req.handled_by;
    const [title, verb] = STATUS_TEXT[req.status];
    const who = toAttender ? from : to;
    recipients = pickRecipients(aud, [side], event, [actor], (point) => ({
      title: `${title} · #${req!.number}`,
      body: `${who} ${verb}.`,
      url, tag, urgent: req!.status === "dispatched", event, id: req!.id, point,
    }));
  }

  const result = await sendToUsers(admin, req.store_id, recipients);
  return NextResponse.json({ ok: true, recipients: recipients.size, ...result });
}
