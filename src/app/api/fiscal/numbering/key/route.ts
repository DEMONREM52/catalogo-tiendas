// Guarda la clave técnica de una numeración (cifrada en el servidor; solo se muestra «••••1234»).
import { encryptSecret, maskSecret, secretAad } from "@/lib/fiscal/crypto";
import { storeSecret } from "@/lib/fiscal/engine";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{ range_id?: string; technical_key?: string }>(request);
    if (!isUuid(body.range_id)) throw new FiscalApiError("Falta la numeración.", 400, "INVALID");
    const key = String(body.technical_key ?? "").trim();
    if (key.length < 8 || key.length > 500) throw new FiscalApiError("Escribe la clave técnica completa (la entrega la DIAN con la resolución).", 422, "INVALID");
    const access = assertOk(await rpc<{ ok: true; store_id: string }>(ctx.db, "fiscal_range_access", { p_range: body.range_id }));
    await storeSecret(ctx.admin(), {
      storeId: access.store_id, ownerType: "numbering_range", ownerId: body.range_id, name: "technical_key",
      ciphertext: encryptSecret(key, secretAad("numbering_range", body.range_id, "technical_key")), last4: key.slice(-4), createdBy: ctx.userId,
    });
    const hint = maskSecret(key);
    await rpc(ctx.admin(), "fiscal__range_set_key_hint", { p_range: body.range_id, p_hint: hint });
    return jsonOk({ hint });
  } catch (error) {
    return jsonError(error);
  }
}
