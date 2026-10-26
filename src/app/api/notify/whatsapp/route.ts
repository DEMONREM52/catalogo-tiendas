// Avisos por WhatsApp de la tienda: ¿está listo el WhatsApp de RemHub? y mensaje de prueba.
// La configuración (números, proveedor, claves) se guarda con erp_whatsapp_settings_save (permisos en la base).
import { isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";
import { remhubWhatsAppReady, sendContingencyWhatsApp, type WaProvider } from "@/lib/notify/whatsapp";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return jsonOk({ remhub: remhubWhatsAppReady() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ store_id?: string; action?: string }>(request);
    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    if (body.action !== "test") throw new FiscalApiError("Acción no válida.", 400, "INVALID");
    // Permiso: el mismo de la configuración (la base lo revisa con la sesión del usuario).
    const settings = await rpc<{ ok: boolean; message?: string; enabled: boolean; provider: WaProvider; numbers: Array<{ number: string }> }>(ctx.db, "erp_whatsapp_settings_get", { p_store: body.store_id });
    if (!settings.ok) throw new FiscalApiError(settings.message ?? "Sin permiso.", 403, "FORBIDDEN");
    if (!settings.numbers.length) throw new FiscalApiError("Guarda primero al menos un número.", 400, "VALIDATION");

    const admin = ctx.admin();
    const { data: store } = await admin.from("stores").select("name").eq("id", body.store_id).maybeSingle();
    const keys = new Map<string, string>();
    if (settings.provider === "callmebot") {
      const { data: k } = await admin.from("erp_whatsapp_keys").select("number,apikey").eq("store_id", body.store_id);
      for (const x of (k ?? []) as Array<{ number: string; apikey: string }>) keys.set(x.number, x.apikey);
    }
    const vars = { store: `${(store?.name as string | undefined) ?? "Tu tienda"} (PRUEBA)`, count: "0", hours: "Esto es una prueba de los avisos", deadline: "—" };
    const results: Array<{ number: string; ok: boolean; error?: string }> = [];
    for (const { number } of settings.numbers) {
      const r = await sendContingencyWhatsApp(settings.provider, number, vars, `${PRODUCTION_ORIGIN}/dashboard/fiscal?tab=contingencias`, keys.get(number));
      results.push({ number, ...r });
      await admin.from("erp_whatsapp_log").insert({
        store_id: body.store_id, key: `wa:test:${body.store_id}:${number}:${Date.now()}`, number, event: "test",
        status: r.ok ? "sent" : "failed", error: r.error ?? null,
      });
    }
    return jsonOk({ results });
  } catch (error) {
    return jsonError(error);
  }
}
