// Cuenta del proveedor tecnológico: datos visibles por la base (con permiso y auditoría) y
// credenciales cifradas aquí en el servidor (AES-256-GCM). Nunca se devuelven completas.
import { encryptSecret, maskSecret, randomToken, secretAad } from "@/lib/fiscal/crypto";
import { storeSecret } from "@/lib/fiscal/engine";
import { getProvider } from "@/lib/fiscal/providers";
import { assertOk, isUuid, jsonError, jsonOk, readJson, requireOrganizationAccess, requireUser, rpc, FiscalApiError } from "@/lib/fiscal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveResult = { ok: true; id: string; webhook_token: string; account: { provider: string; store_id: string } };
type AccessResult = { ok: true; store_id: string; provider: string; environment: string };

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<{
      action?: "save" | "generate_webhook_secret";
      store_id?: string;
      account_id?: string;
      account?: Record<string, unknown>;
      credentials?: Record<string, unknown>;
      reason?: string;
    }>(request);
    const origin = new URL(request.url).origin;

    if (body.action === "generate_webhook_secret") {
      if (!isUuid(body.account_id)) throw new FiscalApiError("Falta la cuenta del proveedor.", 400, "INVALID");
      const access = assertOk(await rpc<AccessResult>(ctx.db, "fiscal_provider_access", { p_account: body.account_id }));
      const secret = randomToken(32);
      await storeSecret(ctx.admin(), {
        storeId: access.store_id, ownerType: "provider_account", ownerId: body.account_id, name: "webhook_secret",
        ciphertext: encryptSecret(secret, secretAad("provider_account", body.account_id, "webhook_secret")), last4: secret.slice(-4), createdBy: ctx.userId,
      });
      await rpc(ctx.admin(), "fiscal__provider_set_hints", { p_account: body.account_id, p_hints: { webhook_secret: maskSecret(secret) } });
      // Se muestra una sola vez para configurarlo en el proveedor.
      return jsonOk({ secret });
    }

    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    await requireOrganizationAccess(ctx, body.store_id);
    const saved = assertOk(await rpc<SaveResult>(ctx.db, "fiscal_provider_account_save", {
      p_store: body.store_id,
      p_data: body.account ?? {},
      p_reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
    }));

    const credentials = Object.entries(body.credentials ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "") as Array<[string, string]>;
    if (credentials.length) {
      const provider = getProvider(saved.account.provider);
      if (!provider) throw new FiscalApiError("Este proveedor aún no tiene adaptador en RemHub: no se guardan credenciales.", 422, "PROVIDER_PENDING");
      const allowed = new Set(provider.credentialFields.map((f) => f.key));
      const hints: Record<string, string> = {};
      for (const [key, raw] of credentials) {
        if (!allowed.has(key)) throw new FiscalApiError(`Campo de credencial no reconocido: ${key}.`, 422, "INVALID");
        const value = raw.trim();
        if (value.length > 4000) throw new FiscalApiError(`La credencial «${key}» es demasiado larga.`, 422, "INVALID");
        await storeSecret(ctx.admin(), {
          storeId: body.store_id, ownerType: "provider_account", ownerId: saved.id, name: key,
          ciphertext: encryptSecret(value, secretAad("provider_account", saved.id, key)), last4: value.slice(-4), createdBy: ctx.userId,
        });
        hints[key] = maskSecret(value);
      }
      await rpc(ctx.admin(), "fiscal__provider_set_hints", { p_account: saved.id, p_hints: hints });
    }
    return jsonOk({
      account_id: saved.id,
      webhook_url: `${origin}/api/fiscal/webhooks/${saved.account.provider}/${saved.webhook_token}`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
