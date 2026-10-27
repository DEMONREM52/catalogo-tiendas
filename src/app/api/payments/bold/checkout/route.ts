// Abre un cobro con Bold para un pedido: desde la página del pedido (con su enlace) o para reintentar
// un pago de landing (con la referencia del intento anterior). Cobra la cuenta Bold del punto del pedido.
import { jsonError, jsonOk, readJson, serviceClient, FiscalApiError } from "@/lib/fiscal/server";
import { boldAccount, boldReturnUrl, createBoldCheckout } from "@/lib/payments/bold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Order = { id: string; token: string; store_id: string; receipt_no: number | null; status: string; total: number; customer_name: string | null; customer_whatsapp: string | null; payment_status?: string | null };

export async function POST(request: Request) {
  try {
    const body = await readJson<{ order_token?: string; reference?: string; url?: string }>(request, 5_000);
    const admin = serviceClient();
    let order: Order | null = null;
    let landingPage: string | null = null;

    if (typeof body.reference === "string" && /^[A-Za-z0-9_-]{6,60}$/.test(body.reference)) {
      const { data: prev } = await admin.from("erp_bold_payments").select("order_id").eq("reference", body.reference).maybeSingle();
      const id = (prev as { order_id?: string } | null)?.order_id;
      if (id) order = (await admin.from("orders").select("*").eq("id", id).maybeSingle()).data as Order | null;
    } else if (typeof body.order_token === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(body.order_token)) {
      order = (await admin.from("orders").select("*").eq("token", body.order_token).maybeSingle()).data as Order | null;
    }
    if (!order) throw new FiscalApiError("No encontramos el pedido.", 404, "NOT_FOUND");
    if (order.status === "cancelled") throw new FiscalApiError("Este pedido fue anulado.", 409, "CANCELLED");
    if (String(order.payment_status ?? "") === "paid") throw new FiscalApiError("Este pedido ya está pagado.", 409, "PAID");
    const { data: approved } = await admin.from("erp_bold_payments").select("id").eq("order_id", order.id).eq("status", "approved").limit(1);
    if (approved?.length) throw new FiscalApiError("Este pedido ya está pagado con Bold.", 409, "PAID");

    const { data: lo } = await admin.from("erp_landing_orders").select("page_id,payment").eq("order_id", order.id).maybeSingle();
    const landing = lo as { page_id: string; payment: string } | null;
    // Los pedidos del catálogo se pagan cuando la tienda los confirma (puede ajustar cantidades antes);
    // los de una landing que eligieron Bold se pagan de una vez.
    if (!(landing?.payment === "bold") && !["confirmed", "completed"].includes(order.status)) {
      throw new FiscalApiError("La tienda debe confirmar el pedido antes de pagarlo.", 409, "NOT_CONFIRMED");
    }

    let accountId: string | null = null;
    if (landing?.payment === "bold") {
      accountId = (await admin.rpc("erp__landing_bold", { p_page: landing.page_id })).data as string | null;
      const { data: pg } = await admin.from("erp_landing_pages").select("slug,name").eq("id", landing.page_id).maybeSingle();
      landingPage = (pg as { slug?: string } | null)?.slug ?? null;
    }
    if (!accountId) {
      const point = (await admin.rpc("erp__order_point", { p_order: order.id })).data as string | null;
      accountId = (await admin.rpc("erp__bold_account_for", { p_store: order.store_id, p_point: point, p_override: null })).data as string | null;
    }
    if (!accountId) throw new FiscalApiError("Esta tienda todavía no tiene Bold activo para este punto.", 409, "NOT_READY");

    const { data: store } = await admin.from("stores").select("slug,name").eq("id", order.store_id).maybeSingle();
    const s = store as { slug: string; name: string } | null;
    const fallback = landingPage && s ? `/${s.slug}/oferta/${landingPage}` : `/pedido/${order.token}`;
    const total = Number(order.total) || 0;
    const checkout = await createBoldCheckout(admin, {
      account: await boldAccount(admin, accountId), storeId: order.store_id, orderId: order.id, receipt: order.receipt_no,
      amount: total, source: landing ? "landing" : "order",
      description: `Pedido ${order.receipt_no ? `#${order.receipt_no} ` : ""}· ${s?.name ?? "Tienda"}`,
      redirectionUrl: boldReturnUrl(request, body.url, fallback),
      customer: { name: order.customer_name ?? undefined, phone: order.customer_whatsapp ?? undefined },
    });
    return jsonOk({ bold: checkout });
  } catch (error) {
    return jsonError(error);
  }
}
