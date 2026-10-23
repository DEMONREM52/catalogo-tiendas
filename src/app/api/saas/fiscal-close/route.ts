import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/audit/anchor";
import { pushAdminClient } from "@/lib/push/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cierre del mes de facturación electrónica (cron de Vercel, día 1 a las 3:00 a. m. Colombia):
 * cuenta los documentos aceptados por la DIAN del mes que terminó y crea los cobros de documentos extra
 * (saas_fiscal_close_month, 20261241). Idempotente: si corre dos veces no duplica cobros.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = pushAdminClient();
  if (!admin) return NextResponse.json({ ok: false, skipped: "not-configured" });
  const { data, error } = await admin.rpc("saas_fiscal_close_month", { p_period: null });
  if (error) return NextResponse.json({ ok: false, error: /saas_fiscal_close_month|Could not find/i.test(error.message) ? "missing-migration" : "close" }, { status: 500 });
  return NextResponse.json(data);
}
