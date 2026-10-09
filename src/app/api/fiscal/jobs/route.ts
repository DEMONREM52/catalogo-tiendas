// Cola automática: reintentos de documentos y webhooks con espera creciente.
//  · GET  con «Authorization: Bearer CRON_SECRET» → todas las tiendas (cron de Vercel u otro programador).
//  · POST con la sesión del usuario y store_id → solo esa tienda («Procesar pendientes» en el centro fiscal).
import { timingSafeEqual } from "node:crypto";
import { processDueDocuments, processDueWebhooks } from "@/lib/fiscal/engine";
import { isUuid, jsonError, jsonOk, readJson, requestMeta, requireFiscalPermission, requireUser, serviceClient, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAllowed(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  try {
    if (!cronAllowed(request)) throw new FiscalApiError("No autorizado.", 401, "AUTH");
    const meta = requestMeta(request);
    const admin = serviceClient(meta);
    const documents = await processDueDocuments(admin, meta.requestId, 40);
    const webhooks = await processDueWebhooks(admin, 40);
    return jsonOk({ documents: documents.length, webhooks: webhooks.length, detail: { documents, webhooks } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ store_id?: string }>(request);
    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    await requireFiscalPermission(ctx, body.store_id, "fiscal_send");
    const documents = await processDueDocuments(ctx.admin(), ctx.meta.requestId, 20, body.store_id);
    return jsonOk({ documents });
  } catch (error) {
    return jsonError(error);
  }
}
