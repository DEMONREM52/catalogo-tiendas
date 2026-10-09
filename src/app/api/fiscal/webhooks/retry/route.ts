// Reintento manual de un webhook fallido desde el centro fiscal (permiso del proveedor tecnológico).
import { processWebhookEvent } from "@/lib/fiscal/engine";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ event_id?: string }>(request);
    if (!isUuid(body.event_id)) throw new FiscalApiError("Falta el evento.", 400, "INVALID");
    assertOk(await rpc<{ ok: true }>(ctx.db, "fiscal_webhook_retry", { p_event: body.event_id }));
    const result = await processWebhookEvent(ctx.admin(), body.event_id);
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
