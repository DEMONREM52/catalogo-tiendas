// Estado de un pago con Bold para quien vuelve de la pasarela (tiene la referencia). Si el aviso de Bold
// aún no llegó, se le pregunta a Bold. Nunca devuelve datos del cliente.
import { jsonError, jsonOk, serviceClient, FiscalApiError } from "@/lib/fiscal/server";
import { syncBoldPayment } from "@/lib/payments/bold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ref = new URL(request.url).searchParams.get("ref") ?? "";
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(ref)) throw new FiscalApiError("Referencia no válida.", 400, "INVALID");
    const admin = serviceClient();
    const { data: pay } = await admin.from("erp_bold_payments").select("status,updated_at,created_at").eq("reference", ref).maybeSingle();
    const p = pay as { status: string; updated_at: string; created_at: string } | null;
    if (!p) throw new FiscalApiError("No encontramos ese pago.", 404, "NOT_FOUND");
    // Consulta a Bold solo si sigue en curso y no se acaba de revisar (Bold tarda unos segundos en tenerlo).
    if (["created", "pending"].includes(p.status) && Date.now() - Date.parse(p.updated_at) > 6000) {
      await admin.from("erp_bold_payments").update({ updated_at: new Date().toISOString() }).eq("reference", ref);
      await syncBoldPayment(admin, ref).catch(() => null);
    }
    const { data } = await admin.rpc("bold_payment_status", { p_reference: ref });
    return jsonOk({ ...(data as Record<string, unknown>), ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
