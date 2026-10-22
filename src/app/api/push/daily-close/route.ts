import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient, pushConfigured, sendToUsers, type PushPayload } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cierre del día al celular (cron de Vercel, 9:00 p. m. Colombia): ventas por punto, quién vendió más,
 * cómo cerró cada caja, traslados pendientes y lo que se agotó. Una vez por persona y día (erp_push_log).
 * Al tocarlo se abre el resumen completo en el inicio, con botón para mandarlo por WhatsApp.
 */
type Summary = {
  total: number; count: number; points: Array<{ name: string; total: number }>; sellers: Array<{ name: string; total: number }>;
  cash: Array<{ point: string; difference: number }>; cash_open: string[]; transfers_pending: number; out_count: number; below_cost: number;
};
const money = (v: number) => `$ ${Math.round(Number(v) || 0).toLocaleString("es-CO")}`;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin || !pushConfigured()) return NextResponse.json({ ok: false, skipped: "not-configured" });
  const { data, error } = await admin.rpc("erp_daily_close_digest");
  if (error) return NextResponse.json({ ok: false, error: "digest" }, { status: 500 });

  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  let sent = 0;
  for (const row of (data ?? []) as Array<{ store_id: string; summary: Summary; users: string[] }>) {
    const s = row.summary;
    const top = s.points[0];
    const best = s.sellers[0];
    const short = s.cash.filter((c) => Number(c.difference) < 0);
    const parts = [
      top && s.points.length > 1 ? `${top.name} ${money(top.total)}` : "",
      best ? `más vendió ${best.name}` : "",
      short.length ? `🔴 ${short.length} caja(s) con faltante` : s.cash.length ? "cajas cuadradas" : "",
      s.cash_open.length ? `${s.cash_open.length} caja(s) sin cerrar` : "",
      s.transfers_pending ? `${s.transfers_pending} traslado(s) pendientes` : "",
      s.out_count ? `${s.out_count} agotado(s) hoy` : "",
      s.below_cost ? `⚠️ ${s.below_cost} venta(s) bajo costo` : "",
    ].filter(Boolean);
    const payload: PushPayload = {
      title: `📊 Cierre de hoy: ${money(s.total)}`,
      body: `${s.count} venta(s)${parts.length ? ` · ${parts.join(" · ")}` : ""}. Toca para ver el resumen.`,
      url: "/dashboard?cierre=1",
      tag: `daily-close-${day}`,
      urgent: short.length > 0 || s.below_cost > 0,
    };
    const payloads = new Map<string, PushPayload>();
    for (const u of row.users ?? []) {
      const { error: dup } = await admin.from("erp_push_log").insert({ key: `daily-close:${row.store_id}:${u}:${day}` });
      if (!dup) payloads.set(u, payload);
    }
    if (payloads.size) sent += (await sendToUsers(admin, row.store_id, payloads)).sent;
  }
  return NextResponse.json({ ok: true, stores: (data ?? []).length, sent });
}
