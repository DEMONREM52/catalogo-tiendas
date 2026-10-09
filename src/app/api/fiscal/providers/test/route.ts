// «Probar conexión» con el proveedor tecnológico (permiso del proveedor; queda auditado).
import { loadSecrets } from "@/lib/fiscal/engine";
import { sanitizePayload } from "@/lib/fiscal/provider";
import { getProvider } from "@/lib/fiscal/providers";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";
import type { FiscalEnvironment } from "@/lib/fiscal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Access = { ok: true; store_id: string; provider: string; environment: FiscalEnvironment; external_account_id: string | null; settings: Record<string, unknown> };

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ account_id?: string }>(request);
    if (!isUuid(body.account_id)) throw new FiscalApiError("Falta la cuenta del proveedor.", 400, "INVALID");
    const access = assertOk(await rpc<Access>(ctx.db, "fiscal_provider_access", { p_account: body.account_id }));
    const provider = getProvider(access.provider);
    let health: { ok: boolean; message: string; details?: Record<string, unknown> };
    if (!provider) {
      health = { ok: false, message: "Este proveedor aún no tiene adaptador en RemHub." };
    } else {
      try {
        const credentials = await loadSecrets(ctx.admin(), "provider_account", body.account_id);
        health = await provider.healthCheck({
          account: { id: body.account_id, provider: access.provider, environment: access.environment, external_account_id: access.external_account_id, settings: access.settings ?? {}, store_id: access.store_id },
          environment: access.environment,
          credentials,
          requestId: ctx.meta.requestId,
        });
      } catch (error) {
        health = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
    await rpc(ctx.admin(), "fiscal__provider_test_result", {
      p_account: body.account_id, p_ok: health.ok, p_message: health.message, p_details: sanitizePayload(health.details ?? {}),
    });
    return jsonOk({ health });
  } catch (error) {
    return jsonError(error);
  }
}
