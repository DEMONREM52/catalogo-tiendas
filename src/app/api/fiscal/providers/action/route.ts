// Acciones de configuración con el proveedor tecnológico (permiso del proveedor; quedan auditadas):
//   create_company   → crea la compañía emisora en el proveedor y guarda su id en la cuenta.
//   register_webhooks → registra en el proveedor la dirección de avisos de esta cuenta con su secreto.
//   test_set / test_set_status / resolutions → habilitación ante la DIAN y numeración.
//   intelligent_start / intelligent_status → habilitación automática (Alanube hace los sets de pruebas con el AuthToken de la DIAN).
import { loadSecrets } from "@/lib/fiscal/engine";
import { sanitizePayload, type IssuerSnapshot, type ProviderContext } from "@/lib/fiscal/provider";
import { getProvider } from "@/lib/fiscal/providers";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";
import type { FiscalEnvironment } from "@/lib/fiscal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Access = { ok: true; store_id: string; provider: string; environment: FiscalEnvironment; external_account_id: string | null; settings: Record<string, unknown> };
type Entity = {
  id: string; person_type: "natural" | "juridica"; legal_name: string; trade_name: string | null; document_type: string; document_number: string | null; verification_digit: string | null;
  tax_regime: string | null; tax_responsibilities: string[] | null; economic_activities: string[] | null; fiscal_address: string | null; city: string | null; city_code: string | null;
  department: string | null; department_code: string | null; country: string | null; postal_code: string | null; phone: string | null; email: string | null; dian_email: string | null;
};

function issuerOf(e: Entity): IssuerSnapshot {
  return {
    entity_id: e.id, legal_name: e.legal_name, trade_name: e.trade_name, person_type: e.person_type, document_type: e.document_type, document_number: e.document_number,
    verification_digit: e.verification_digit, tax_regime: e.tax_regime, tax_responsibilities: e.tax_responsibilities ?? [], economic_activities: e.economic_activities ?? [],
    fiscal_address: e.fiscal_address, city: e.city, city_code: e.city_code, department: e.department, department_code: e.department_code, country: e.country ?? "CO",
    postal_code: e.postal_code, phone: e.phone, email: e.dian_email || e.email, establishment: null, point: null,
  };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ account_id?: string; action?: string; input?: Record<string, unknown> }>(request);
    if (!isUuid(body.account_id)) throw new FiscalApiError("Falta la cuenta del proveedor.", 400, "INVALID");
    const action = String(body.action ?? "");
    if (!["create_company", "register_webhooks", "test_set", "test_set_status", "resolutions", "intelligent_start", "intelligent_status"].includes(action)) throw new FiscalApiError("Acción no reconocida.", 400, "INVALID");
    const access = assertOk(await rpc<Access>(ctx.db, "fiscal_provider_access", { p_account: body.account_id }));
    const provider = getProvider(access.provider);
    if (!provider) throw new FiscalApiError("Este proveedor aún no tiene adaptador en RemHub.", 422, "PROVIDER_PENDING");
    const admin = ctx.admin();
    const { data: account } = await admin.from("fiscal_provider_accounts").select("fiscal_entity_id,webhook_token").eq("id", body.account_id).maybeSingle<{ fiscal_entity_id: string; webhook_token: string }>();
    if (!account) throw new FiscalApiError("Cuenta no encontrada.", 404, "NOT_FOUND");
    const { data: entity } = await admin.from("fiscal_entities").select("*").eq("id", account.fiscal_entity_id).maybeSingle<Entity>();
    if (!entity) throw new FiscalApiError("La cuenta no tiene un contribuyente válido.", 422, "INVALID");
    const credentials = await loadSecrets(admin, "provider_account", body.account_id);
    const pctx: ProviderContext = {
      account: { id: body.account_id, provider: access.provider, environment: access.environment, external_account_id: access.external_account_id, settings: { ...(access.settings ?? {}), nit: entity.document_number }, store_id: access.store_id },
      environment: access.environment,
      credentials,
      requestId: ctx.meta.requestId,
    };

    let result: { ok: boolean; message: string; details?: Record<string, unknown> };
    if (action === "create_company") {
      if (access.external_account_id) throw new FiscalApiError("Esta cuenta ya tiene una compañía en el proveedor.", 409, "DUPLICATE");
      const missing = [!entity.document_number && "NIT", !entity.fiscal_address && "dirección fiscal", !entity.city_code && "código de municipio", !entity.department_code && "código de departamento"].filter(Boolean);
      if (missing.length) throw new FiscalApiError(`Completa en el contribuyente: ${missing.join(", ")}.`, 422, "VALIDATION");
      const created = await provider.createCompany(pctx, issuerOf(entity));
      if (!created.provider_document_id) throw new FiscalApiError("El proveedor no devolvió el id de la compañía.", 502, "BAD_RESPONSE");
      // Se guarda el id en la cuenta (el resto de la configuración no cambia).
      await admin.from("fiscal_provider_accounts").update({ external_account_id: created.provider_document_id }).eq("id", body.account_id);
      result = { ok: true, message: `${created.provider_message ?? "Compañía creada"} (id ${created.provider_document_id}).`, details: { company_id: created.provider_document_id } };
    } else if (action === "register_webhooks") {
      if (!credentials.webhook_secret) throw new FiscalApiError("Primero genera el secreto del webhook.", 422, "VALIDATION");
      const origin = new URL(request.url).origin;
      if (!origin.startsWith("https://")) throw new FiscalApiError("Los avisos solo se conectan desde la página publicada (https).", 422, "VALIDATION");
      const url = `${origin}/api/fiscal/webhooks/${access.provider}/${account.webhook_token}`;
      const done = await provider.configureCompany(pctx, issuerOf(entity), { webhook_url: url, webhook_secret: credentials.webhook_secret });
      result = { ok: true, message: done.provider_message ?? "Avisos conectados.", details: { url } };
    } else {
      if (!provider.runAction) throw new FiscalApiError("Este proveedor no tiene esa acción.", 422, "INVALID");
      result = await provider.runAction(pctx, action, body.input ?? {});
      // Se guarda el proceso de habilitación automática para consultar su avance después (el enlace de la DIAN nunca se guarda).
      const processId = result.details?.process_id;
      if (action === "intelligent_start" && result.ok && typeof processId === "string" && processId) {
        await admin.from("fiscal_provider_accounts").update({ settings: { ...(access.settings ?? {}), intelligent_process_id: processId, intelligent_started_at: new Date().toISOString() } }).eq("id", body.account_id);
      }
    }
    await rpc(admin, "fiscal__provider_test_result", { p_account: body.account_id, p_ok: result.ok, p_message: `[${action}] ${result.message}`.slice(0, 500), p_details: sanitizePayload(result.details ?? {}) });
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
