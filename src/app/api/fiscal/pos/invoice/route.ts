// POS: emite el documento electrónico de una venta y lo transmite enseguida.
// El navegador solo manda la venta (token) y el punto elegido; la base resuelve y valida
// NIT, resolución, prefijo, consecutivo, proveedor y ambiente.
import { sendDocument } from "@/lib/fiscal/engine";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireOrganizationAccess, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IssueResult = {
  ok: true;
  reused?: boolean;
  document_id: string;
  full_number: string;
  status: string;
  environment: string;
  document_type: string;
  total: number;
  point_name?: string;
  warnings?: string[];
  provider?: string;
  contingency?: boolean;
};

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{
      store_id?: string; token?: string; point_id?: string | null; seller_id?: string | null; customer_id?: string | null;
      customer_doc?: string | null; idempotency_key?: string; payment_form?: string; due_date?: string | null;
    }>(request);
    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    if (!body.token || typeof body.token !== "string" || body.token.length > 120) throw new FiscalApiError("Falta la venta.", 400, "INVALID");
    if (!body.idempotency_key || body.idempotency_key.length > 120) throw new FiscalApiError("Falta la llave de idempotencia.", 400, "INVALID");
    await requireOrganizationAccess(ctx, body.store_id);

    const issued = assertOk(await rpc<IssueResult>(ctx.db, "fiscal_issue_from_order", {
      p_store: body.store_id,
      p_token: body.token,
      p_point: isUuid(body.point_id) ? body.point_id : null,
      p_seller: isUuid(body.seller_id) ? body.seller_id : null,
      p_customer: isUuid(body.customer_id) ? body.customer_id : null,
      p_customer_doc: typeof body.customer_doc === "string" ? body.customer_doc.slice(0, 40) : null,
      p_idempotency_key: body.idempotency_key,
      p_payment_form: body.payment_form === "credit" ? "credit" : "cash",
      p_due_date: typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null,
    }));

    // Se transmite de inmediato (si falla, queda en cola y se reintenta solo).
    let send = null;
    if (issued.status === "QUEUED") {
      const can = await rpc<{ ok: boolean }>(ctx.db, "fiscal_can_send", { p_document: issued.document_id });
      if (can.ok) send = await sendDocument(ctx.admin(), issued.document_id, ctx.meta.requestId);
    }
    return jsonOk({ document: issued, send });
  } catch (error) {
    return jsonError(error);
  }
}
