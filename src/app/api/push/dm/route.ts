import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Aviso de un mensaje directo (20261271) a los demás del chat, aunque tengan RemHub cerrada.
 * Solo quien escribió el mensaje puede pedir el aviso.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = (await request.json().catch(() => null)) as { message_id?: string } | null;
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, sent: 0 });
  if (!token || !body?.message_id || !UUID.test(body.message_id)) return NextResponse.json({ ok: false }, { status: 400 });
  const { data: auth } = await admin.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: m } = await admin.from("erp_dm_messages").select("*").eq("id", body.message_id).maybeSingle();
  const msg = m as { id: string; thread_id: string; store_id: string; user_id: string | null; user_name: string | null; body: string; created_at: string; mentions?: string[] | null } | null;
  // Solo el autor, y solo mensajes recientes (no se puede re-enviar avisos viejos).
  if (!msg || msg.user_id !== userId || Date.now() - new Date(msg.created_at).getTime() > 5 * 60_000) return NextResponse.json({ ok: false }, { status: 403 });

  const [{ data: t }, { data: members }, { data: muted }] = await Promise.all([
    admin.from("erp_dm_threads").select("kind,title").eq("id", msg.thread_id).maybeSingle(),
    admin.from("erp_dm_members").select("user_id").eq("thread_id", msg.thread_id).neq("user_id", userId),
    // Sin la migración 20261273 no hay silenciados: avisa a todos como antes.
    admin.rpc("erp_chat_muted_users", { p_scope: "dm", p_chat: msg.thread_id }),
  ]);
  const thread = t as { kind?: string; title?: string | null } | null;
  const announce = thread?.kind === "announce";
  const group = (thread?.kind === "group" || announce) && thread?.title ? thread.title : null;
  const mentioned = new Set(msg.mentions ?? []);
  const silenced = new Set(Array.isArray(muted) ? (muted as string[]) : []);
  // Chat silenciado: no avisa, salvo que te mencionen con @.
  const to = ((members ?? []) as Array<{ user_id: string }>).filter((x) => !silenced.has(x.user_id) || mentioned.has(x.user_id));
  const res = await sendToUsers(admin, msg.store_id, new Map(to.map((x) => [x.user_id, {
    title: mentioned.has(x.user_id) ? `📣 ${msg.user_name ?? "Alguien"} te mencionó${group ? ` en ${group}` : ""}` : announce ? `📢 ${group}` : group ? `💬 ${group}` : `💬 ${msg.user_name ?? "Mensaje del equipo"}`,
    body: `${group && !mentioned.has(x.user_id) ? `${msg.user_name ?? "Alguien"}: ` : ""}${msg.body.slice(0, 160)}`,
    url: `/dashboard/mensajes?chat=${msg.thread_id}`,
    tag: `dm-${msg.thread_id}`,
    reply: !announce,
  }])));
  return NextResponse.json({ ok: true, sent: res.sent });
}
