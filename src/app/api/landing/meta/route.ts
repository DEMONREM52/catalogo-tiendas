// Token de la API de Conversiones de Meta: solo el dueño lo guarda; queda cifrado y nunca vuelve al navegador.
import { encryptSecret, maskSecret, secretAad } from "@/lib/fiscal/crypto";
import { isUuid, jsonError, jsonOk, readJson, requireUser, FiscalApiError } from "@/lib/fiscal/server";
import { decryptSecret } from "@/lib/fiscal/crypto";
import { sendCapi, buildUserData } from "@/lib/landing/meta-capi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ store_id?: string; action?: "save" | "clear" | "test"; token?: string; test_code?: string }>(request, 10_000);
    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    const admin = ctx.admin();
    const { data: store } = await admin.from("stores").select("id,owner_id").eq("id", body.store_id).maybeSingle();
    if (!store || (store as { owner_id: string }).owner_id !== ctx.userId) throw new FiscalApiError("Solo el dueño de la tienda maneja el token de Meta.", 403, "FORBIDDEN");
    const storeId = body.store_id;
    const testCode = typeof body.test_code === "string" && /^[A-Za-z0-9]{3,40}$/.test(body.test_code.trim()) ? body.test_code.trim() : null;

    if (body.action === "clear") {
      await admin.from("erp_meta_capi").upsert({ store_id: storeId, token_enc: null, test_code: null, last_error: null, updated_by: ctx.userId, updated_at: new Date().toISOString() });
      return jsonOk({ configured: false });
    }

    if (body.action === "save") {
      const token = (body.token ?? "").trim();
      if (token && !/^[A-Za-z0-9_-]{40,600}$/.test(token)) throw new FiscalApiError("Ese token no parece de Meta. Cópialo completo desde el Administrador de eventos.", 422, "INVALID");
      const patch: Record<string, unknown> = { store_id: storeId, test_code: testCode, updated_by: ctx.userId, updated_at: new Date().toISOString() };
      if (token) Object.assign(patch, { token_enc: encryptSecret(token, secretAad("store", storeId, "meta_capi")), last_error: null });
      const { error } = await admin.from("erp_meta_capi").upsert(patch);
      if (error) throw new FiscalApiError(/erp_meta_capi/.test(error.message) ? "Falta ejecutar la migración 20261252_landing_pages.sql en Supabase." : error.message, 500, "DB_ERROR");
      return jsonOk({ configured: true, masked: token ? maskSecret(token) : undefined });
    }

    // Prueba: manda un evento PageView marcado como prueba (sale en «Eventos de prueba» de Meta).
    const [{ data: tracking }, { data: capi }] = await Promise.all([
      admin.from("store_tracking").select("meta_pixel_id").eq("store_id", storeId).maybeSingle(),
      admin.from("erp_meta_capi").select("token_enc,test_code").eq("store_id", storeId).maybeSingle(),
    ]);
    const pixel = (tracking as { meta_pixel_id?: string } | null)?.meta_pixel_id;
    const enc = (capi as { token_enc?: string | null } | null)?.token_enc;
    if (!pixel) throw new FiscalApiError("Primero guarda el ID del píxel en Mi tienda → Marketing.", 422, "NOT_READY");
    if (!enc) throw new FiscalApiError("Primero guarda el token.", 422, "NOT_READY");
    const code = testCode ?? (capi as { test_code?: string | null }).test_code ?? null;
    try {
      const r = await sendCapi(pixel, decryptSecret(enc, secretAad("store", storeId, "meta_capi")), [{
        event_name: "PageView", event_time: Math.floor(Date.now() / 1000), event_id: `remhub-test-${Date.now()}`, action_source: "website",
        event_source_url: "https://remhub.co", user_data: buildUserData({}, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, url: "" }),
      }], code);
      await admin.from("erp_meta_capi").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("store_id", storeId);
      return jsonOk({ received: r.received, test_code: code });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await admin.from("erp_meta_capi").update({ last_error: message }).eq("store_id", storeId);
      throw new FiscalApiError(`Meta no aceptó la prueba: ${message}`, 422, "PROVIDER");
    }
  } catch (error) {
    return jsonError(error);
  }
}
