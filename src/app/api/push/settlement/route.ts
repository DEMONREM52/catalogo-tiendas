import { NextResponse } from "next/server";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Aviso al celular de una liquidación (20261290):
 *   · «submitted»: a quienes pueden aprobarla (menos quien la preparó).
 *   · «approved» / «rejected»: a quien la preparó y a quien la envió a revisión.
 * La pantalla solo manda {id, event}; el estado se lee de la base y debe coincidir con el evento y ser reciente.
 * Cada aviso sale una sola vez (erp_push_log). Quien llama debe ser de la tienda.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRESH_MS = 15 * 60 * 1000;
const money = (v: unknown) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

type Settlement = { id: string; store_id: string; point_id: string | null; number: number; status: string; pool_total: number; carried_total: number; advances_total: number | null;
  submitted_at: string | null; decided_at: string | null; created_by_name: string | null; submitted_by_name: string | null; decided_by_name: string | null; decision_note: string | null };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string; event?: string } | null;
  const id = body?.id ?? "";
  const event = body?.event ?? "";
  if (!UUID.test(id) || !["submitted", "approved", "rejected"].includes(event)) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, skipped: "not-configured" });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: who } = await admin.auth.getUser(token);
  const userId = who.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: s } = await admin.from("erp_settlements")
    .select("id,store_id,point_id,number,status,pool_total,carried_total,advances_total,submitted_at,decided_at,created_by_name,submitted_by_name,decided_by_name,decision_note")
    .eq("id", id).maybeSingle();
  const st = s as Settlement | null;
  if (!st) return NextResponse.json({ ok: false }, { status: 404 });

  // Quien avisa debe ser de la tienda.
  const [{ data: store }, { data: member }] = await Promise.all([
    admin.from("stores").select("owner_id,name").eq("id", st.store_id).maybeSingle(),
    admin.from("store_users").select("user_id").eq("store_id", st.store_id).eq("user_id", userId).eq("active", true).maybeSingle(),
  ]);
  if ((store as { owner_id?: string } | null)?.owner_id !== userId && !member) return NextResponse.json({ ok: false }, { status: 403 });

  // El evento debe ser el estado real y reciente.
  const ok = event === "submitted" ? st.status === "review" && st.submitted_at
    : event === "approved" ? ["approved", "partially_paid", "paid"].includes(st.status) && st.decided_at
      : st.status === "rejected" && st.decided_at;
  const at = event === "submitted" ? st.submitted_at : st.decided_at;
  if (!ok || !at || Date.now() - new Date(at).getTime() > FRESH_MS) return NextResponse.json({ ok: false, skipped: "stale" });
  const { error: dup } = await admin.from("erp_push_log").insert({ key: `settlement:${id}:${event}:${at}` });
  if (dup) return NextResponse.json({ ok: true, skipped: "duplicate" });

  const { data: aud } = await admin.rpc("erp_settlement_push_audience", { p_id: id, p_event: event });
  const users = ((aud ?? []) as Array<{ user_id: string }>).map((a) => a.user_id).filter((u) => u && u !== userId);
  if (!users.length) return NextResponse.json({ ok: true, sent: 0 });

  let point = "Madre";
  if (st.point_id) {
    const { data: w } = await admin.from("erp_warehouses").select("name").eq("id", st.point_id).maybeSingle();
    point = (w as { name?: string } | null)?.name ?? "Punto";
  }
  const total = Number(st.pool_total) + Number(st.carried_total) - Number(st.advances_total ?? 0);
  const payload: PushPayload = event === "submitted"
    ? { title: `📋 Liquidación #${st.number} por aprobar`, body: `${point} · ${money(total)} a repartir. La envió ${st.submitted_by_name ?? "alguien del equipo"}. Toca para revisarla y aprobarla.`, url: "/dashboard/rentabilidad?tab=settle", tag: `settlement-${id}`, urgent: true }
    : event === "approved"
      ? { title: `✅ Liquidación #${st.number} aprobada`, body: `${point} · la aprobó ${st.decided_by_name ?? "—"}. Ya se puede pagar y firmar.`, url: "/dashboard/rentabilidad?tab=settle", tag: `settlement-${id}` }
      : { title: `⛔ Liquidación #${st.number} rechazada`, body: `${point} · la rechazó ${st.decided_by_name ?? "—"}${st.decision_note ? `: «${st.decision_note}»` : ""}.`, url: "/dashboard/rentabilidad?tab=settle", tag: `settlement-${id}`, urgent: true };
  const r = await sendToUsers(admin, st.store_id, new Map(users.map((u) => [u, payload])));
  return NextResponse.json({ ok: true, sent: r.sent });
}
