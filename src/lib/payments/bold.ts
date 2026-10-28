// Bold (botón de pagos) de cada tienda y sus puntos. Solo en el servidor: aquí se usan las llaves.
// Documentación: developers.bold.co → Botón de pagos (integración manual), Webhook y Consulta de transacciones.
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, secretAad } from "@/lib/fiscal/crypto";
import { FiscalApiError } from "@/lib/fiscal/server";
import { notifyOrderTeam } from "@/lib/push/order-team";
import { boldIntegrity, boldReference } from "@/lib/payments/bold-sign";

export { boldIntegrity, boldReference, boldReturnUrl, boldWebhookSigner, boldWebhookValid } from "@/lib/payments/bold-sign";

export type BoldMode = "test" | "production";
export type BoldAccountRow = {
  id: string; store_id: string; name: string; mode: BoldMode; active: boolean; is_default: boolean;
  test_identity: string | null; test_secret_enc: string | null; prod_identity: string | null; prod_secret_enc: string | null;
  last_ok_at?: string | null; last_error?: string | null; last_event_at?: string | null;
};
export type BoldCheckoutConfig = {
  orderId: string; currency: "COP"; amount: string; apiKey: string; integritySignature: string;
  description: string; redirectionUrl: string; renderMode: "embedded"; customerData?: string; test: boolean;
};

export class BoldError extends FiscalApiError {
  constructor(message: string, status = 400, code = "BOLD") { super(message, status, code); }
}

export const boldAad = (accountId: string, mode: BoldMode) => secretAad("bold_account", accountId, mode === "production" ? "prod_secret" : "test_secret");

/** Llave de identidad y secreta del modo en que está la cuenta. */
export function boldKeys(a: BoldAccountRow): { identity: string; secret: string } {
  const prod = a.mode === "production";
  const identity = (prod ? a.prod_identity : a.test_identity) ?? "";
  const enc = prod ? a.prod_secret_enc : a.test_secret_enc;
  if (!identity || !enc) throw new BoldError(`A «${a.name}» le faltan las llaves de ${prod ? "producción" : "pruebas"}.`, 409, "NOT_READY");
  return { identity, secret: decryptSecret(enc, boldAad(a.id, a.mode)) };
}

export type BoldVoucher = { payment_status?: string; total?: number; payment_method?: string; transaction_id?: string; payer_email?: string };

/** Consulta de transacciones: estado del pago según Bold (con la llave de identidad). */
export async function boldVoucher(identity: string, reference: string): Promise<BoldVoucher | null> {
  const res = await fetch(`https://payments.api.bold.co/v2/payment-voucher/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `x-api-key ${identity}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) throw new BoldError("Bold no aceptó la llave de identidad.", 422, "BAD_KEY");
  if (res.status === 404) return null;
  if (!res.ok) throw new BoldError(`Bold respondió ${res.status}.`, 502, "PROVIDER");
  return (await res.json().catch(() => null)) as BoldVoucher | null;
}

/** Cuenta que cobra un pedido (la elegida, la de su punto o la de por defecto). */
export async function boldAccount(admin: SupabaseClient, id: string): Promise<BoldAccountRow> {
  const { data } = await admin.from("erp_bold_accounts").select("*").eq("id", id).maybeSingle();
  if (!data) throw new BoldError("La cuenta Bold ya no existe.", 404, "NOT_FOUND");
  return data as BoldAccountRow;
}

/** Crea el intento de pago y la configuración para abrir la pasarela de Bold en la página. */
export async function createBoldCheckout(admin: SupabaseClient, input: {
  account: BoldAccountRow; storeId: string; orderId: string; receipt: string | number | null; amount: number;
  source: "landing" | "order"; description: string; redirectionUrl: string;
  customer?: { name?: string; email?: string; phone?: string; document?: string };
}): Promise<BoldCheckoutConfig & { reference: string }> {
  const amount = Math.round(input.amount);
  if (!Number.isSafeInteger(amount) || amount < 1000) throw new BoldError("El total del pedido no permite pagar en línea (mínimo $1.000).", 422, "AMOUNT");
  const { identity, secret } = boldKeys(input.account);
  const reference = boldReference(input.receipt);
  const { error } = await admin.from("erp_bold_payments").insert({
    store_id: input.storeId, account_id: input.account.id, order_id: input.orderId, reference, amount, currency: "COP",
    mode: input.account.mode, source: input.source, status: "created",
  });
  if (error) throw new BoldError(/erp_bold_payments/.test(error.message) ? "Falta ejecutar la migración 20261259_bold_pagos.sql en Supabase." : error.message, 500, "DB_ERROR");
  const c = input.customer ?? {};
  const phone = (c.phone ?? "").replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
  const customer = Object.fromEntries(Object.entries({
    email: c.email?.trim() || undefined,
    fullName: c.name?.trim().slice(0, 80) || undefined,
    phone: /^3\d{9}$/.test(phone) ? phone : undefined,
    dialCode: /^3\d{9}$/.test(phone) ? "+57" : undefined,
    documentNumber: c.document?.replace(/\D/g, "") || undefined,
    documentType: c.document?.replace(/\D/g, "") ? "CC" : undefined,
  }).filter(([, v]) => v));
  return {
    reference, orderId: reference, currency: "COP", amount: String(amount), apiKey: identity,
    integritySignature: boldIntegrity(reference, amount, "COP", secret),
    description: input.description.replace(/[^\p{L}\p{N} .,#·\-()]/gu, "").slice(0, 100) || "Pedido",
    redirectionUrl: input.redirectionUrl, renderMode: "embedded",
    ...(Object.keys(customer).length ? { customerData: JSON.stringify(customer) } : {}),
    test: input.account.mode === "test",
  };
}

export type BoldApplyResult = { ok: boolean; changed?: boolean; status?: string; previous?: string; order_id?: string; store_id?: string; amount?: number; source?: string; receipt_no?: number | null };

/** Guarda lo que reportó Bold y, si el pago quedó aprobado, avisa al equipo de pedidos. */
export async function applyBold(admin: SupabaseClient, reference: string, status: string, amount: number | null, event: Record<string, unknown>) {
  const { data, error } = await admin.rpc("erp__bold_apply", { p_reference: reference, p_status: status, p_amount: amount, p_event: event });
  if (error) throw new BoldError(error.message, 500, "DB_ERROR");
  const r = data as BoldApplyResult;
  if (r.changed && (r.status === "approved" || r.status === "mismatch") && r.store_id) {
    const money = `$${Math.round(Number(r.amount) || 0).toLocaleString("es-CO")}`;
    await notifyOrderTeam(admin, r.store_id, r.status === "approved" ? {
      title: `💳 Pago aprobado con Bold${r.receipt_no ? ` · Pedido #${r.receipt_no}` : ""}`,
      body: `Entró ${money}${r.source === "landing" ? " desde la landing" : ""}. Ya puedes confirmar y despachar.`,
      url: r.receipt_no ? `/dashboard/pedidos?pedido=${r.receipt_no}` : "/dashboard/pedidos", tag: `bold-${reference}`, urgent: true,
    } : {
      title: `⚠️ Revisa un pago de Bold${r.receipt_no ? ` · Pedido #${r.receipt_no}` : ""}`,
      body: `Bold aprobó un valor distinto al del pedido (${money}). No se marcó como pagado: revísalo en tu cuenta Bold.`,
      url: "/dashboard/pedidos", tag: `bold-${reference}`, urgent: true,
    }).catch((e) => console.error("[bold] aviso:", e instanceof Error ? e.message : e));
  }
  return r;
}

const VOUCHER_STATUS: Record<string, string> = { APPROVED: "approved", REJECTED: "rejected", FAILED: "failed", VOIDED: "voided", PROCESSING: "pending", PENDING: "pending" };

/** Pregunta a Bold por el pago (cuando el aviso no ha llegado) y guarda lo que responda. */
export async function syncBoldPayment(admin: SupabaseClient, reference: string) {
  const { data: pay } = await admin.from("erp_bold_payments").select("reference,status,account_id,amount,updated_at").eq("reference", reference).maybeSingle();
  const p = pay as { status: string; account_id: string | null; amount: number; updated_at: string } | null;
  if (!p?.account_id || !["created", "pending"].includes(p.status)) return p?.status ?? null;
  const account = await boldAccount(admin, p.account_id);
  const v = await boldVoucher(boldKeys(account).identity, reference).catch(() => null);
  const status = VOUCHER_STATUS[String(v?.payment_status ?? "").toUpperCase()];
  if (!v || !status) return p.status;
  const r = await applyBold(admin, reference, status, v.total != null ? Number(v.total) : null, {
    payment_id: v.transaction_id, payment_method: v.payment_method, payer_email: v.payer_email, via: "consulta",
  });
  return r.status ?? p.status;
}
