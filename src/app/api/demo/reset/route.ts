import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient } from "@/lib/push/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reinicio de la tienda demo (cron de Vercel cada 10 min): solo actúa cuando ya pasó el tiempo que escogió el admin. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin) return NextResponse.json({ ok: false, skipped: "not-configured" });
  const { data, error } = await admin.rpc("erp_demo_reset", { p_force: false });
  if (error) return NextResponse.json({ ok: false, skipped: /Could not find|does not exist/i.test(error.message) ? "migration" : "error" });
  const r = data as { ok?: boolean; skipped?: string; deleted?: number; restored?: number; errors?: unknown[] } | null;
  return NextResponse.json({ ok: Boolean(r?.ok), skipped: r?.skipped ?? null, deleted: r?.deleted ?? 0, restored: r?.restored ?? 0, errors: r?.errors?.length ?? 0 });
}
