import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Digest = { store_id: string; user_id: string; n: number; overdue: number; due_today: number; amount: number; first_name: string | null };

const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

/**
 * Resumen diario al celular (cron de Vercel, 8:00 a. m. Colombia): cuentas por pagar y deudas vencidas de los puntos con la bodega.
 * Cada persona recibe solo las cuentas de sus puntos que según las reglas tocan hoy.
 * Se envía una sola vez por persona y día (erp_push_log).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, skipped: "not-configured" });

  const { data, error } = await admin.rpc("erp_payable_push_digest");
  if (error) return NextResponse.json({ ok: false, error: "digest" }, { status: 500 });

  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as Digest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `payables:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const parts = [
      d.overdue ? `${d.overdue} vencida${d.overdue === 1 ? "" : "s"}` : "",
      d.due_today ? `${d.due_today} vence${d.due_today === 1 ? "" : "n"} hoy` : "",
    ].filter(Boolean);
    const payload: PushPayload = {
      title: d.overdue ? "🔴 Cuentas por pagar vencidas" : "💸 Cuentas por pagar por vencer",
      body: `${d.n === 1 ? `${d.first_name ?? "Un proveedor"}` : `${d.n} cuentas`} · ${money(d.amount)}${parts.length ? ` · ${parts.join(", ")}` : ""}. Toca para revisarlas.`,
      url: "/dashboard/inventario?tab=payables",
      tag: `payables-${day}`,
      urgent: d.overdue > 0,
    };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }

  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;

  // Deudas vencidas de los puntos con la bodega (20261126). Si la migración aún no está, se omite.
  const internal = await sendInternalDigest(admin, day);
  // Permisos temporales vencidos: se quitan de la lista (la base ya los bloqueaba desde que vencieron; 20261127).
  const { data: expired } = await admin.rpc("erp_permission_grants_cleanup");
  return NextResponse.json({ ok: true, people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent, internal, expired_permissions: expired ?? null });
}

type InternalDigest = { store_id: string; user_id: string; points: number; overdue: number; max_days: number; first_name: string | null };

async function sendInternalDigest(admin: NonNullable<ReturnType<typeof pushAdminClient>>, day: string) {
  const { data, error } = await admin.rpc("erp_internal_push_digest");
  if (error) return { skipped: true };
  const byStore = new Map<string, Map<string, PushPayload>>();
  for (const d of (data ?? []) as InternalDigest[]) {
    const { error: dup } = await admin.from("erp_push_log").insert({ key: `internal:${d.store_id}:${d.user_id}:${day}` });
    if (dup) continue;
    const payload: PushPayload = {
      title: "🤝 Deuda vencida con la bodega",
      body: d.points === 1
        ? `${d.first_name ?? "Un punto"} debe ${money(d.overdue)} vencido${d.max_days ? ` (hace ${d.max_days} día${d.max_days === 1 ? "" : "s"})` : ""}. Toca para ver la cuenta.`
        : `${d.points} puntos deben ${money(d.overdue)} vencido; el más alto: ${d.first_name ?? "—"}. Toca para ver las cuentas.`,
      url: "/dashboard/inventario?tab=internal",
      tag: `internal-${day}`,
      urgent: d.max_days >= 7,
    };
    if (!byStore.has(d.store_id)) byStore.set(d.store_id, new Map());
    byStore.get(d.store_id)!.set(d.user_id, payload);
  }
  let sent = 0;
  for (const [storeId, payloads] of byStore) sent += (await sendToUsers(admin, storeId, payloads)).sent;
  return { people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent };
}
