import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Digest = { store_id: string; user_id: string; n: number; overdue: number; due_today: number; amount: number; first_name: string | null };

const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

/**
 * Resumen diario de cuentas por pagar al celular (cron de Vercel, 8:00 a. m. Colombia).
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
  return NextResponse.json({ ok: true, people: [...byStore.values()].reduce((s, m) => s + m.size, 0), sent });
}
