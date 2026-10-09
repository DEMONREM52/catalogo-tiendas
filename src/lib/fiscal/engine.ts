// Motor de envío (solo servidor): reserva el documento en la base, lo transmite con el adaptador
// del proveedor, guarda XML/PDF en el bucket privado y registra la respuesta.
// La base decide si se puede enviar; aquí nunca se cambia NIT, resolución ni consecutivo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, FiscalConfigError, secretAad } from "./crypto";
import { ProviderError, sanitizePayload, submitDocument, type ClaimedDocument, type ProviderFile, type ProviderResult } from "./provider";
import { getProvider } from "./providers";
import { FiscalApiError } from "./server";

export const FISCAL_BUCKET = "fiscal-docs";
const PROVIDER_TIMEOUT_MS = 25_000;

export type SendOutcome = {
  ok: boolean;
  status: string | null;
  code?: string;
  message: string;
  full_number?: string | null;
  cufe?: string | null;
  next_attempt_at?: string | null;
};

type ClaimResponse =
  | { ok: false; code: string; message: string }
  | { ok: true; done: true; status: string; full_number: string | null; cufe: string | null }
  | (ClaimedDocument & { ok: true; done?: undefined });

async function call<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    if (/Could not find the function|schema cache/i.test(error.message)) {
      throw new FiscalApiError("Falta ejecutar la migración 20261027_fiscal_multipunto.sql en Supabase.", 500, "MIGRATION");
    }
    throw new FiscalApiError(error.message, 500, "DB_ERROR");
  }
  return data as T;
}

/** Secretos descifrados de un dueño (cuenta del proveedor, numeración…). */
export async function loadSecrets(admin: SupabaseClient, ownerType: string, ownerId: string): Promise<Record<string, string>> {
  const { data, error } = await admin.from("fiscal_secrets").select("name,ciphertext").eq("owner_type", ownerType).eq("owner_id", ownerId);
  if (error) throw new FiscalApiError("No se pudieron leer las credenciales cifradas.", 500, "DB_ERROR");
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    out[row.name as string] = decryptSecret(row.ciphertext as string, secretAad(ownerType, ownerId, row.name as string));
  }
  return out;
}

export async function storeSecret(admin: SupabaseClient, input: { storeId: string; ownerType: string; ownerId: string; name: string; ciphertext: string; last4: string; createdBy: string }) {
  const { error } = await admin.from("fiscal_secrets").upsert(
    {
      store_id: input.storeId, owner_type: input.ownerType, owner_id: input.ownerId, name: input.name,
      ciphertext: input.ciphertext, last4: input.last4, created_by: input.createdBy, rotated_at: new Date().toISOString(),
    },
    { onConflict: "owner_type,owner_id,name" },
  );
  if (error) throw new FiscalApiError("No se pudo guardar la credencial cifrada.", 500, "DB_ERROR");
}

function errorToResult(error: unknown): ProviderResult {
  if (error instanceof ProviderError) {
    return { status: "ERROR", error_code: error.code, error_message: error.message, retryable: error.retryable, transmitted: error.transmitted };
  }
  if (error instanceof FiscalConfigError) {
    return { status: "ERROR", error_code: "SERVER_CONFIG", error_message: error.message, retryable: false };
  }
  if (error instanceof Error && error.name === "AbortError") {
    // No sabemos si el proveedor alcanzó a recibirlo: se consulta antes de cualquier anulación.
    return { status: "ERROR", error_code: "TIMEOUT", error_message: "El proveedor tardó demasiado en responder; se reintentará.", retryable: true, transmitted: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: "ERROR", error_code: "NETWORK", error_message: `No se pudo comunicar con el proveedor: ${message}`, retryable: true };
}

async function storeFile(admin: SupabaseClient, doc: ClaimedDocument, kind: "xml" | "pdf", file: ProviderFile): Promise<string | null> {
  const safeNumber = (doc.document.full_number ?? doc.document.id).replace(/[^A-Za-z0-9_-]/g, "");
  const path = `${doc.document.store_id}/${doc.document.id}/${safeNumber}.${kind}`;
  const body = typeof file.content === "string" ? new Blob([file.content], { type: file.contentType }) : new Blob([file.content as BlobPart], { type: file.contentType });
  const { error } = await admin.storage.from(FISCAL_BUCKET).upload(path, body, { contentType: file.contentType, upsert: true });
  if (error) {
    console.error(`[fiscal] No se pudo guardar el ${kind.toUpperCase()} de ${doc.document.full_number}:`, error.message);
    return null;
  }
  return path;
}

/** Envía (o consulta el estado de) un documento. Idempotente: si ya se está enviando, lo informa. */
export async function sendDocument(admin: SupabaseClient, documentId: string, requestId: string): Promise<SendOutcome> {
  const claim = await call<ClaimResponse>(admin, "fiscal__claim", { p_document: documentId });
  if (claim.ok === false) return { ok: false, status: null, code: claim.code, message: claim.message };
  if (claim.done) {
    return { ok: true, status: claim.status, message: "El documento ya estaba aceptado.", full_number: claim.full_number, cufe: claim.cufe };
  }
  const doc = claim;
  const provider = getProvider(doc.account.provider);
  let result: ProviderResult;
  if (!provider) {
    result = { status: "ERROR", error_code: "NO_ADAPTER", error_message: `RemHub aún no tiene adaptador para «${doc.account.provider}».`, retryable: false };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const credentials = await loadSecrets(admin, "provider_account", doc.account.id);
      const rangeSecrets = await loadSecrets(admin, "numbering_range", doc.range.id);
      result = await submitDocument(provider, {
        account: doc.account,
        environment: doc.document.environment,
        credentials,
        technicalKey: rangeSecrets.technical_key ?? null,
        requestId,
        signal: controller.signal,
      }, doc);
    } catch (error) {
      result = errorToResult(error);
    } finally {
      clearTimeout(timer);
    }
  }

  const xmlPath = result.xml ? await storeFile(admin, doc, "xml", result.xml) : null;
  const pdfPath = result.pdf ? await storeFile(admin, doc, "pdf", result.pdf) : null;
  const record = {
    status: result.status,
    provider_document_id: result.provider_document_id ?? null,
    provider_request_id: result.provider_request_id ?? null,
    provider_status: result.provider_status ?? null,
    provider_message: result.provider_message ?? null,
    dian_status: result.dian_status ?? null,
    dian_message: result.dian_message ?? null,
    cufe: result.cufe ?? null,
    qr_data: result.qr_data ?? null,
    xml_path: xmlPath,
    pdf_path: pdfPath,
    error_code: result.error_code ?? null,
    error_message: result.error_message ?? null,
    retryable: Boolean(result.retryable),
    transmitted: Boolean(result.transmitted),
    payload: sanitizePayload({ ...(result.payload ?? {}), request_id: requestId }),
  };
  const saved = await call<{ ok: boolean; status?: string; next_attempt_at?: string | null; code?: string; message?: string }>(
    admin, "fiscal__record_result", { p_document: documentId, p_result: record },
  );
  const status = saved.status ?? result.status;
  const message =
    status === "ACCEPTED" ? "Documento aceptado."
      : status === "REJECTED" ? `El proveedor tecnológico rechazó el documento: ${result.error_message ?? "revisa el detalle"}.`
        : status === "SENT" ? "El proveedor recibió el documento; la validación llegará en unos minutos."
          : result.retryable ? `No se pudo transmitir todavía: ${result.error_message}. Se reintentará automáticamente.`
            : `No se pudo transmitir: ${result.error_message}.`;
  return { ok: status !== "ERROR" && status !== "REJECTED", status, code: result.error_code ?? undefined, message, full_number: doc.document.full_number, cufe: result.cufe ?? doc.document.cufe, next_attempt_at: saved.next_attempt_at ?? null };
}

/** Procesa la cola (reintentos con espera creciente). storeId limita a una tienda. */
export async function processDueDocuments(admin: SupabaseClient, requestId: string, limit = 20, storeId: string | null = null) {
  const ids = await call<string[]>(admin, "fiscal__due_documents", { p_limit: limit, p_store: storeId });
  const results: Array<{ id: string; status: string | null; message: string }> = [];
  for (const id of ids ?? []) {
    try {
      const outcome = await sendDocument(admin, id, requestId);
      results.push({ id, status: outcome.status, message: outcome.message });
    } catch (error) {
      results.push({ id, status: null, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

type WebhookEventRow = { id: string; provider: string; provider_account_id: string | null; payload: unknown; signature_valid: boolean };

/** Procesa un webhook ya guardado y verificado. Si falla, la base lo deja para reintento. */
export async function processWebhookEvent(admin: SupabaseClient, eventId: string) {
  const { data: event, error } = await admin.from("fiscal_webhook_events")
    .select("id,provider,provider_account_id,payload,signature_valid").eq("id", eventId).maybeSingle<WebhookEventRow>();
  if (error || !event) return { ok: false, message: "Evento no encontrado." };
  if (!event.signature_valid) return { ok: false, message: "Evento con firma inválida: no se procesa." };
  const provider = getProvider(event.provider);
  if (!provider) {
    await call(admin, "fiscal__webhook_fail", { p_event: eventId, p_error: `Sin adaptador para ${event.provider}.` });
    return { ok: false, message: "Proveedor sin adaptador." };
  }
  try {
    const parsed = provider.processWebhook(event.payload);
    const applied = await call<{ ok: boolean; message?: string }>(admin, "fiscal__webhook_apply", { p_event: eventId, p_parsed: parsed });
    return { ok: Boolean(applied.ok), message: applied.message ?? "Procesado." };
  } catch (err) {
    await call(admin, "fiscal__webhook_fail", { p_event: eventId, p_error: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "No se pudo procesar; quedó para reintento." };
  }
}

export async function processDueWebhooks(admin: SupabaseClient, limit = 20) {
  const ids = await call<string[]>(admin, "fiscal__due_webhooks", { p_limit: limit });
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const id of ids ?? []) results.push({ id, ...(await processWebhookEvent(admin, id)) });
  return results;
}
