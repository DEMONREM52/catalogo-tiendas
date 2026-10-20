import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTransaction, remhubWompi, verifyEventChecksum } from "@/lib/saas/wompi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Avisos (eventos) del Wompi DE REMHUB. Configurar en el panel de Wompi de RemHub como URL de eventos:
 *   https://remhub.co/api/saas/wompi/webhook
 * (Los avisos del Wompi de cada tienda siguen llegando a /api/payments/wompi/webhook: no se mezclan.)
 *
 * Pasos: 1) se verifica el checksum con WOMPI_REMHUB_EVENTS_SECRET; 2) se consulta a Wompi la transacción real;
 * 3) la base la aplica UNA sola vez (saas_payment_apply revisa referencia, monto, moneda y entorno).
 * Siempre responde 200 a eventos válidos para que Wompi no los reenvíe sin fin.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const wompi = remhubWompi();
  if (!url || !service || !wompi.eventsSecret) return NextResponse.json({ ok: false }, { status: 503 });
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const text = await request.text();
  let body: { event?: string; data?: { transaction?: { id?: string; reference?: string } }; environment?: string; signature?: { checksum?: string }; timestamp?: number };
  try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const checksum = request.headers.get("x-event-checksum") ?? body.signature?.checksum ?? "";
  const eventKey = `${body.data?.transaction?.id ?? "sin-id"}:${checksum}`.slice(0, 200);

  if (!verifyEventChecksum(body as Parameters<typeof verifyEventChecksum>[0], wompi.eventsSecret, checksum)) {
    await admin.rpc("saas_webhook_reject", { p_provider: "wompi", p_event_key: eventKey, p_result: "invalid", p_detail: "Checksum no válido", p_payload: null });
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Un evento de producción no se aplica en pruebas ni al revés.
  const evEnv = body.environment === "prod" ? "production" : "sandbox";
  if (evEnv !== wompi.env) {
    await admin.rpc("saas_webhook_reject", { p_provider: "wompi", p_event_key: eventKey, p_result: "ignored", p_detail: `Evento de ${evEnv} en servidor ${wompi.env}`, p_payload: null });
    return NextResponse.json({ ok: true });
  }
  if (body.event !== "transaction.updated" || !body.data?.transaction?.id) return NextResponse.json({ ok: true });

  const reference = String(body.data.transaction.reference ?? "");
  // Las referencias de RemHub empiezan por «RH-». Lo demás no es de este comercio.
  if (!reference.startsWith("RH-")) {
    await admin.rpc("saas_webhook_reject", { p_provider: "wompi", p_event_key: eventKey, p_result: "ignored", p_detail: "Referencia que no es de RemHub", p_payload: null });
    return NextResponse.json({ ok: true });
  }

  // Estado REAL consultado a Wompi.
  const tx = await fetchTransaction(wompi.apiBase, wompi.privateKey || wompi.publicKey, body.data.transaction.id).catch(() => null);
  if (!tx || tx.reference !== reference) {
    await admin.rpc("saas_webhook_reject", { p_provider: "wompi", p_event_key: eventKey, p_result: "error", p_detail: "No se pudo confirmar la transacción con Wompi", p_payload: null });
    // 500: Wompi lo vuelve a intentar más tarde.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const { data, error } = await admin.rpc("saas_payment_apply", {
    p_provider: "wompi", p_event_key: eventKey, p_reference: tx.reference, p_tx_id: tx.id, p_status: tx.status,
    p_amount_cents: tx.amount_in_cents, p_currency: tx.currency, p_method: tx.payment_method_type ?? null, p_environment: wompi.env,
    // Solo lo necesario (sin datos de tarjeta).
    p_payload: { id: tx.id, status: tx.status, reference: tx.reference, amount_in_cents: tx.amount_in_cents, currency: tx.currency, method: tx.payment_method_type ?? null },
  });
  if (error) {
    console.error("saas_payment_apply:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: (data as { result?: string } | null)?.result ?? null });
}
