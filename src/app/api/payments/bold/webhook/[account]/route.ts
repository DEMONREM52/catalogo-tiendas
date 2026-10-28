// Aviso de Bold (webhook) para una cuenta: se valida la firma x-bold-signature con la llave secreta de esa cuenta
// y se guarda el estado del pago. En pruebas Bold firma con llave vacía: ahí el aprobado se confirma además con Bold.
import { NextResponse } from "next/server";
import { serviceClient, isUuid } from "@/lib/fiscal/server";
import { decryptSecret } from "@/lib/fiscal/crypto";
import { applyBold, boldAad, boldVoucher, boldWebhookSigner, type BoldAccountRow } from "@/lib/payments/bold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BoldEvent = {
  type?: string;
  data?: { payment_id?: string; amount?: { total?: number }; metadata?: { reference?: string | null }; payment_method?: string; approval_number?: string; payer_email?: string };
};

const reply = (status: number, error?: string) => NextResponse.json(error ? { ok: false, error } : { ok: true }, { status });

export async function POST(request: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account: accountId } = await params;
  if (!isUuid(accountId)) return reply(404, "Cuenta no válida.");
  const raw = await request.text();
  if (raw.length > 100_000) return reply(413, "Aviso demasiado grande.");

  const admin = serviceClient();
  const { data } = await admin.from("erp_bold_accounts").select("*").eq("id", accountId).maybeSingle();
  const account = data as BoldAccountRow | null;
  if (!account) return reply(404, "Cuenta no encontrada.");

  const secret = (enc: string | null, mode: "test" | "production") => { try { return enc ? decryptSecret(enc, boldAad(account.id, mode)) : null; } catch { return null; } };
  const signer = boldWebhookSigner(raw, request.headers.get("x-bold-signature"), {
    prod: secret(account.prod_secret_enc, "production"),
    test: secret(account.test_secret_enc, "test"),
  });
  if (!signer) return reply(401, "Firma no válida.");

  let event: BoldEvent;
  try { event = JSON.parse(raw) as BoldEvent; } catch { return reply(400, "JSON no válido."); }
  const reference = String(event.data?.metadata?.reference ?? "");
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(reference)) return reply(200); // pagos que no son de RemHub (datáfono, links): se ignoran
  const { data: pay } = await admin.from("erp_bold_payments").select("account_id,mode,amount").eq("reference", reference).maybeSingle();
  const p = pay as { account_id: string | null; mode: string; amount: number } | null;
  if (!p || p.account_id !== account.id) return reply(200);
  // Un pago de producción solo lo mueve la firma de producción: con la de pruebas cualquiera podría
  // «anular» o «rechazar» un pago real (y dejar el pedido como no pagado).
  if (p.mode === "production" && signer !== "production") return reply(401, "Firma no válida.");

  let type = String(event.type ?? "").toUpperCase();
  // Firma de pruebas (llave vacía): no basta para dar un pago por aprobado; se pregunta a Bold.
  if (signer !== "production" && type === "SALE_APPROVED") {
    const identity = p.mode === "production" ? account.prod_identity : account.test_identity;
    const v = identity ? await boldVoucher(identity, reference).catch(() => null) : null;
    if (String(v?.payment_status ?? "").toUpperCase() !== "APPROVED") type = "PENDING";
  }
  try {
    await applyBold(admin, reference, type, event.data?.amount?.total != null ? Number(event.data.amount.total) : null, {
      payment_id: event.data?.payment_id, payment_method: event.data?.payment_method, approval_number: event.data?.approval_number,
      payer_email: event.data?.payer_email, type, via: "webhook",
    });
    return reply(200);
  } catch (e) {
    console.error("[bold] webhook:", e instanceof Error ? e.message : e);
    return reply(500, "No se pudo guardar el aviso.");
  }
}
