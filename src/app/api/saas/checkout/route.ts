import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { checkoutUrl, integritySignature, remhubWompi } from "@/lib/saas/wompi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contratar un plan de RemHub: el dueño de la tienda pide el pago y recibe la dirección del Web Checkout de Wompi.
 * El precio y la referencia los pone la base (saas_checkout_create) con la sesión del dueño; el navegador solo dice
 * qué plan y periodo quiere. La firma de integridad se calcula aquí (el secreto nunca sale del servidor).
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const wompi = remhubWompi();
  if (!url || !anon) return NextResponse.json({ error: "Falta configurar Supabase." }, { status: 503 });
  if (!wompi.ready) {
    console.error("Wompi de RemHub sin configurar:", wompi.problems.join(", "));
    return NextResponse.json({ error: "Los pagos en línea todavía no están activos. Escríbenos por WhatsApp para activar tu plan.", reason: "not_configured" }, { status: 503 });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Inicia sesión para contratar." }, { status: 401 });

  let body: { storeId?: string; plan?: string; period?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 }); }
  const storeId = String(body.storeId ?? "");
  const plan = String(body.plan ?? "");
  const period = body.period === "year" ? "year" : "month";
  if (!/^[0-9a-f-]{36}$/i.test(storeId) || !/^[a-z0-9_]{2,30}$/.test(plan)) return NextResponse.json({ error: "Plan o tienda no válidos." }, { status: 400 });

  // Con la sesión del usuario: la base revisa que sea el dueño y pone el precio.
  const sb = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await sb.rpc("saas_checkout_create", { p_store: storeId, p_plan: plan, p_period: period, p_environment: wompi.env });
  if (error) return NextResponse.json({ error: /saas_checkout_create|Could not find/i.test(error.message) ? "Falta la migración 20261211 en Supabase." : "No se pudo preparar el pago." }, { status: 500 });
  const res = data as { ok: boolean; error?: string; reference: string; amount_cents: number; currency: string; email?: string | null };
  if (!res?.ok) return NextResponse.json({ error: res?.error ?? "No se pudo preparar el pago." }, { status: 400 });

  // El link vence en 1 hora (si alguien lo guarda, no sirve después).
  const expirationTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const signature = integritySignature(res.reference, Number(res.amount_cents), res.currency, wompi.integritySecret, expirationTime);
  const origin = process.env.NODE_ENV === "production" ? PRODUCTION_ORIGIN : new URL(request.url).origin;
  return NextResponse.json({
    url: checkoutUrl({
      publicKey: wompi.publicKey, reference: res.reference, amountInCents: Number(res.amount_cents), currency: res.currency,
      signature, expirationTime, email: res.email ?? null, redirectUrl: `${origin}/dashboard/plan?ref=${encodeURIComponent(res.reference)}`,
    }),
    reference: res.reference,
    environment: wompi.env,
  });
}
