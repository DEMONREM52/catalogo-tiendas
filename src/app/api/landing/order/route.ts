// Pedido desde una landing: la base valida todo (precio, existencias, paquete, pago) y crea el pedido.
// Después de responder, se avisa a Meta por la API de Conversiones (si la tienda la configuró).
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptSecret, secretAad } from "@/lib/fiscal/crypto";
import { jsonError, jsonOk, readJson, requestMeta, serviceClient, FiscalApiError } from "@/lib/fiscal/server";
import { buildOrderEvent, sendCapi, type CapiCustomer } from "@/lib/landing/meta-capi";
import { activeTestCode } from "@/lib/landing/capi-test-code";
import type { PushPayload } from "@/lib/push/server";
import { notifyOrderTeam } from "@/lib/push/order-team";
import { boldAccount, boldReturnUrl, createBoldCheckout, type BoldCheckoutConfig } from "@/lib/payments/bold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  store?: string; slug?: string; session?: string; units?: string[]; payment?: string; upsell?: boolean; exit?: boolean;
  customer?: CapiCustomer & { address?: string; neighborhood?: string; notes?: string };
  ref?: Record<string, string>; fbp?: string | null; fbc?: string | null; url?: string;
};
type OrderResult = { ok: boolean; code?: string; field?: string; message?: string; token?: string; receipt_no?: string; order_id?: string; total?: number; store_id?: string; event_id?: string; payment?: string; bold_account?: string | null; page_name?: string; items?: Array<{ id: string; name: string; price: number; quantity: number }> };

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request, 20_000);
    if (!body.store || !body.slug || !body.session) throw new FiscalApiError("Recarga la página e intenta de nuevo.", 400, "INVALID");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new FiscalApiError("El servidor no está configurado.", 500, "SERVER_CONFIG");
    const meta = requestMeta(request);
    const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("landing_order", {
      p_store: body.store, p_slug: body.slug, p_session: body.session,
      p: { units: body.units ?? [], payment: body.payment ?? "cod", upsell: Boolean(body.upsell), exit: Boolean(body.exit), customer: body.customer ?? {}, ref: body.ref ?? {} },
    });
    if (error) throw new FiscalApiError(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261252_landing_pages.sql en Supabase." : "No se pudo crear el pedido. Intenta de nuevo.", 500, "DB_ERROR");
    const result = data as OrderResult;
    if (!result.ok) return Response.json({ ok: false, code: result.code, field: result.field, error: result.message }, { status: 422 });

    // Aviso al celular para quien atiende pedidos (dueño, administradores y permiso «Pedidos»).
    after(async () => {
      try {
        const admin = serviceClient(meta);
        const first = (body.customer?.name ?? "").trim().split(/\s+/)[0] || "Un cliente";
        const city = (body.customer?.city ?? "").trim();
        const units = (result.items ?? []).reduce((s, i) => s + Number(i.quantity || 0), 0);
        const payload: PushPayload = {
          title: `🛍️ Nuevo pedido${result.receipt_no ? ` #${result.receipt_no}` : ""} desde la landing`,
          body: `${first}${city ? ` de ${city}` : ""} pidió ${units} ${units === 1 ? "unidad" : "unidades"} · $${Math.round(Number(result.total) || 0).toLocaleString("es-CO")}. ${result.payment === "bold" ? "Está pagando en línea con Bold: te avisamos cuando se apruebe." : "Te va a escribir por WhatsApp: atiéndelo."}`,
          url: result.receipt_no ? `/dashboard/pedidos?pedido=${result.receipt_no}` : "/dashboard/pedidos",
          tag: `landing-order-${result.order_id}`,
          urgent: true,
        };
        await notifyOrderTeam(admin, String(result.store_id), payload);
      } catch (e) {
        console.error("[landing] aviso de pedido:", e instanceof Error ? e.message : e);
      }
    });

    after(async () => {
      try {
        const admin = serviceClient(meta);
        const storeId = String(result.store_id);
        const [{ data: tracking }, { data: capi }] = await Promise.all([
          admin.from("store_tracking").select("meta_pixel_id,meta_enabled,order_event").eq("store_id", storeId).maybeSingle(),
          admin.from("erp_meta_capi").select("token_enc,test_code,updated_at").eq("store_id", storeId).maybeSingle(),
        ]);
        const t = tracking as { meta_pixel_id?: string; meta_enabled?: boolean; order_event?: string } | null;
        const c = capi as { token_enc?: string | null; test_code?: string | null; updated_at?: string | null } | null;
        if (!t?.meta_pixel_id || t.meta_enabled === false || t.order_event === "none" || !c?.token_enc) return;
        const token = decryptSecret(c.token_enc, secretAad("store", storeId, "meta_capi"));
        const event = buildOrderEvent({
          eventName: t.order_event === "Lead" ? "Lead" : "Purchase",
          eventId: String(result.event_id),
          orderId: String(result.receipt_no ?? result.order_id),
          items: (result.items ?? []).map((i) => ({ id: i.id, quantity: Number(i.quantity), price: Number(i.price) })),
          total: Number(result.total) || 0,
          customer: body.customer ?? {},
          ctx: { ip: meta.ip, userAgent: meta.userAgent, fbp: body.fbp, fbc: body.fbc, url: typeof body.url === "string" ? body.url.slice(0, 500) : "" },
        });
        try {
          await sendCapi(t.meta_pixel_id, token, [event], activeTestCode(c.test_code, c.updated_at));
          await admin.from("erp_meta_capi").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("store_id", storeId);
        } catch (e) {
          await admin.from("erp_meta_capi").update({ last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("store_id", storeId);
        }
      } catch (e) {
        console.error("[landing] API de Conversiones:", e instanceof Error ? e.message : e);
      }
    });

    // Pago con Bold: se crea el cobro (firmado en el servidor) para abrir la pasarela ahí mismo.
    let bold: (BoldCheckoutConfig & { reference: string }) | null = null;
    let boldError: string | null = null;
    if (result.payment === "bold" && result.bold_account && result.order_id) {
      try {
        const admin = serviceClient(meta);
        bold = await createBoldCheckout(admin, {
          account: await boldAccount(admin, result.bold_account), storeId: String(result.store_id), orderId: result.order_id,
          receipt: result.receipt_no ?? null, amount: Number(result.total) || 0, source: "landing",
          description: `Pedido ${result.receipt_no ? `#${result.receipt_no} ` : ""}· ${result.page_name ?? "Landing"}`,
          redirectionUrl: boldReturnUrl(request, body.url, `/${encodeURIComponent(body.store)}/oferta/${encodeURIComponent(body.slug)}`),
          customer: { name: body.customer?.name, email: body.customer?.email, phone: body.customer?.whatsapp, document: body.customer?.document },
        });
      } catch (e) {
        boldError = e instanceof Error ? e.message : "No se pudo abrir el pago con Bold.";
        console.error("[landing] Bold:", boldError);
      }
    }

    // Sin el token del comprobante: el cliente no puede abrir el pedido; la tienda lo ve en su panel.
    return jsonOk({ receipt_no: result.receipt_no, total: result.total, event_id: result.event_id, items: result.items, bold, bold_error: boldError });
  } catch (error) {
    return jsonError(error);
  }
}
