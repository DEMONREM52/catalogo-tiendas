// Enviar o reenviar un documento fiscal (la base decide si el usuario puede hacerlo).
import { sendDocument } from "@/lib/fiscal/engine";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ document_id?: string }>(request);
    if (!isUuid(body.document_id)) throw new FiscalApiError("Falta el documento.", 400, "INVALID");
    assertOk(await rpc<{ ok: true }>(ctx.db, "fiscal_can_send", { p_document: body.document_id }));
    const result = await sendDocument(ctx.admin(), body.document_id, ctx.meta.requestId);
    if (!result.ok && result.code === "BUSY") throw new FiscalApiError(result.message, 409, "BUSY");
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
