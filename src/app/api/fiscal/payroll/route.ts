// Nómina electrónica: transmite (o consulta) un documento por Alanube. Módulo aparte de la nómina interna.
// La base decide quién puede y numera; aquí solo se arma el documento, se envía y se guarda la respuesta.
import { loadSecrets } from "@/lib/fiscal/engine";
import { EMPTY_EPAYROLL, buildPayrollBody, epayrollProblems, profileFromEmployee, type EPayrollData, type EPayrollProfile } from "@/lib/fiscal/epayroll";
import { ProviderError, sanitizePayload, type ClaimedDocument, type ProviderResult } from "@/lib/fiscal/provider";
import { AlegraProvider, uuidFrom } from "@/lib/fiscal/providers/alegra";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Claim =
  | { ok: false; code: string; message: string }
  | { ok: true; done: true; status: string; cune: string | null }
  | {
    ok: true; done?: undefined;
    doc: { id: string; kind: "individual" | "replace" | "cancel"; status: string; prefix: string; number: number; period: string; environment: "sandbox" | "production"; data: Partial<EPayrollData>; provider_document_id: string | null; attempts: number };
    related: { provider_document_id: string | null } | null;
    settings: { city_code: string | null; address: string | null; payment_method: string };
    employer: { legal_name: string; person_type: string; document_number: string | null; verification_digit: string | null };
    employee: { full_name: string; document: string | null; document_type: string | null; contract_type: string | null; base_salary: number; pay_frequency: string | null; hired_on: string | null; terminated_on: string | null; bank_name: string | null; bank_account: string | null; profile: Partial<EPayrollProfile> };
    account: ClaimedDocument["account"];
  };

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ doc_id?: string; action?: string }>(request);
    if (!isUuid(body.doc_id)) throw new FiscalApiError("Falta el documento.", 400, "INVALID");
    assertOk(await rpc<{ ok: true }>(ctx.db, "erp_epayroll_can_send", { p_doc: body.doc_id }));
    const admin = ctx.admin();

    const { data: claimed, error } = await admin.rpc("erp_epayroll__claim", { p_doc: body.doc_id });
    if (error) throw new FiscalApiError(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261250_nomina_electronica.sql en Supabase." : error.message, 500, "DB_ERROR");
    const c = claimed as Claim;
    if (c.ok === false) throw new FiscalApiError(c.message, c.code === "BUSY" ? 409 : 400, c.code);
    if (c.done) return jsonOk({ result: { ok: true, status: c.status, message: "Ya estaba aceptada por la DIAN.", cune: c.cune } });

    let result: ProviderResult;
    const profile = profileFromEmployee(c.employee, c.employee.profile);
    const data: EPayrollData = { ...EMPTY_EPAYROLL, ...(c.doc.data ?? {}) } as EPayrollData;
    const problems = c.doc.kind === "cancel" ? [] : epayrollProblems(data, profile);
    if (problems.length) {
      result = { status: "ERROR", error_code: "VALIDATION", error_message: problems.join(" "), retryable: false };
    } else if (c.account.provider !== "alegra") {
      result = { status: "ERROR", error_code: "PROVIDER", error_message: "La nómina electrónica se transmite con una cuenta de Alanube.", retryable: false };
    } else {
      const provider = new AlegraProvider();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      try {
        const credentials = await loadSecrets(admin, "provider_account", c.account.id);
        const pctx = { account: c.account, environment: c.doc.environment, credentials, requestId: ctx.meta.requestId, signal: controller.signal };
        const statusOnly = body.action === "status" || (c.doc.status === "SENT" && c.doc.provider_document_id);
        if (statusOnly) {
          result = await provider.payroll(pctx, "status", { id: c.doc.provider_document_id });
        } else {
          const payload = c.doc.kind === "cancel"
            ? { prefix: c.doc.prefix, number: String(c.doc.number) }
            : buildPayrollBody({ prefix: c.doc.prefix, number: Number(c.doc.number), companyId: c.account.external_account_id, period: c.doc.period, employer: c.employer, settings: c.settings, employee: c.employee, profile, data });
          const op = c.doc.kind === "individual" ? "create" : c.doc.kind;
          result = await provider.payroll(pctx, op, { body: payload, relatedId: c.related?.provider_document_id ?? null, idempotencyKey: uuidFrom(`${c.doc.id}:${c.doc.attempts}`) });
        }
      } catch (err) {
        result = err instanceof ProviderError
          ? { status: "ERROR", error_code: err.code, error_message: err.message, retryable: err.retryable }
          : { status: "ERROR", error_code: "NETWORK", error_message: err instanceof Error ? err.message : String(err), retryable: true };
      } finally {
        clearTimeout(timer);
      }
    }

    await admin.rpc("erp_epayroll__record", { p_doc: c.doc.id, p_result: {
      status: result.status, provider_document_id: result.provider_document_id ?? null, cune: result.cufe ?? null,
      provider_status: result.provider_status ?? null, dian_message: result.dian_message ?? null, error_message: result.error_message ?? null,
      payload: sanitizePayload({ request_id: ctx.meta.requestId }),
    } });
    const message = result.status === "ACCEPTED" ? "Aceptada por la DIAN."
      : result.status === "SENT" ? "Alanube la recibió; la respuesta de la DIAN llega en unos minutos (toca «Consultar»)."
        : result.status === "REJECTED" ? `La DIAN la rechazó: ${result.error_message ?? result.dian_message ?? "revisa el detalle"}.`
          : `No se pudo transmitir: ${result.error_message ?? "error"}.`;
    return jsonOk({ result: { ok: result.status === "ACCEPTED" || result.status === "SENT", status: result.status, message, cune: result.cufe ?? null } });
  } catch (error) {
    return jsonError(error);
  }
}
