// Webhook del proveedor tecnológico. La URL identifica la cuenta (token aleatorio), pero
// nunca se confía en ella: se valida la firma con el secreto de esa cuenta, el tiempo y que
// el evento no se haya recibido antes. El documento se busca SOLO dentro de esa cuenta.
import { NextResponse } from "next/server";
import { decryptSecret, sha256Hex, secretAad } from "@/lib/fiscal/crypto";
import { processWebhookEvent } from "@/lib/fiscal/engine";
import { getProvider } from "@/lib/fiscal/providers";
import { requestMeta, serviceClient } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 512_000;
const SAFE_HEADERS = ["content-type", "user-agent", "x-remhub-signature", "x-request-id", "x-event-id"];

type Account = { id: string; store_id: string; provider: string; environment: string; status: string };

export async function POST(request: Request, { params }: { params: Promise<{ provider: string; token: string }> }) {
  const { provider: providerCode, token } = await params;
  const meta = requestMeta(request);
  const admin = serviceClient(meta);
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "Evento demasiado grande." }, { status: 413 });
    if (!/^[a-f0-9]{32,128}$/i.test(token)) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });

    const { data: account } = await admin.from("fiscal_provider_accounts")
      .select("id,store_id,provider,environment,status").eq("webhook_token", token).maybeSingle<Account>();
    if (!account || account.provider !== providerCode) {
      await admin.rpc("erp__security_event", {
        p_store: account?.store_id ?? null, p_point: null, p_action: "security.webhook_unknown_account",
        p_detail: { provider: providerCode, ip: meta.ip }, p_severity: "warning",
      });
      return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
    }
    const provider = getProvider(account.provider);
    if (!provider) return NextResponse.json({ ok: false, error: "Proveedor sin adaptador." }, { status: 501 });

    const { data: secretRow } = await admin.from("fiscal_secrets").select("ciphertext")
      .eq("owner_type", "provider_account").eq("owner_id", account.id).eq("name", "webhook_secret").maybeSingle<{ ciphertext: string }>();
    let secret: string | null = null;
    try {
      secret = secretRow ? decryptSecret(secretRow.ciphertext, secretAad("provider_account", account.id, "webhook_secret")) : null;
    } catch {
      secret = null;
    }
    const verification = provider.verifyWebhook({ headers: request.headers, rawBody: raw, secret, now: new Date() });
    let payload: unknown = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    const headers = Object.fromEntries(SAFE_HEADERS.map((h) => [h, request.headers.get(h)]).filter(([, v]) => v));
    const { data: stored, error: storeError } = await admin.rpc("fiscal__webhook_store", {
      p_account: account.id,
      p_provider: account.provider,
      p_external_id: verification.eventId ?? null,
      p_type: verification.eventType ?? null,
      p_payload: verification.valid ? payload : null,
      p_hash: sha256Hex(raw),
      p_valid: verification.valid,
      p_headers: headers,
      p_ip: meta.ip,
    });
    if (storeError) {
      console.error("[fiscal] No se pudo guardar el webhook:", storeError.message);
      return NextResponse.json({ ok: false, error: "No se pudo registrar el evento." }, { status: 500 });
    }
    if (!verification.valid) {
      return NextResponse.json({ ok: false, error: "Firma inválida." }, { status: 401 });
    }
    const result = stored as { id: string; duplicate: boolean };
    if (result.duplicate) return NextResponse.json({ ok: true, duplicate: true });
    const processed = await processWebhookEvent(admin, result.id);
    // Se responde 200 aunque el procesamiento quede para reintento: el evento ya está guardado.
    return NextResponse.json({ ok: true, processed: processed.ok });
  } catch (error) {
    console.error("[fiscal] Error en webhook:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "Error al procesar el evento." }, { status: 500 });
  }
}
