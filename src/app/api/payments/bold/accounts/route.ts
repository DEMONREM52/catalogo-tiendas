// Cuentas Bold de la tienda: solo el dueño las crea, pega las llaves (quedan cifradas y nunca vuelven al
// navegador), cambia entre pruebas y producción, elige cuál usa cada punto y prueba la conexión.
import { encryptSecret, maskSecret } from "@/lib/fiscal/crypto";
import { isUuid, jsonError, jsonOk, readJson, requireUser, FiscalApiError, type FiscalContext } from "@/lib/fiscal/server";
import { boldAad, boldVoucher, type BoldAccountRow, type BoldMode } from "@/lib/payments/bold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  store_id?: string; action?: "save" | "default" | "delete" | "assign" | "test" | "mode";
  id?: string; name?: string; mode?: BoldMode; active?: boolean; point_id?: string; account_id?: string | null;
  test_identity?: string; test_secret?: string; prod_identity?: string; prod_secret?: string;
};

const KEY = /^[A-Za-z0-9_-]{10,200}$/;

async function owner(ctx: FiscalContext, storeId: unknown): Promise<string> {
  if (!isUuid(storeId)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
  const { data } = await ctx.admin().from("stores").select("owner_id").eq("id", storeId).maybeSingle();
  if (!data || (data as { owner_id: string }).owner_id !== ctx.userId) throw new FiscalApiError("Solo el dueño de la tienda maneja las cuentas Bold.", 403, "FORBIDDEN");
  return storeId;
}

const missing = (m: string) => /erp_bold_/.test(m) ? "Falta ejecutar la migración 20261259_bold_pagos.sql en Supabase." : m;

async function overview(ctx: FiscalContext, storeId: string) {
  const admin = ctx.admin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: accounts, error }, { data: points }, { data: links }, { data: pays }] = await Promise.all([
    admin.from("erp_bold_accounts").select("*").eq("store_id", storeId).order("created_at"),
    admin.from("erp_warehouses").select("id,name,kind,active").eq("store_id", storeId).order("name"),
    admin.from("erp_bold_points").select("point_id,account_id").eq("store_id", storeId),
    admin.from("erp_bold_payments").select("account_id,status,amount,mode").eq("store_id", storeId).gte("created_at", since),
  ]);
  if (error) throw new FiscalApiError(missing(error.message), 500, "DB_ERROR");
  const p = (pays ?? []) as Array<{ account_id: string | null; status: string; amount: number; mode: string }>;
  return {
    accounts: ((accounts ?? []) as BoldAccountRow[]).map((a) => {
      const mine = p.filter((x) => x.account_id === a.id && x.mode === "production");
      return {
        id: a.id, name: a.name, mode: a.mode, active: a.active, is_default: a.is_default,
        has_test: Boolean(a.test_identity && a.test_secret_enc), has_prod: Boolean(a.prod_identity && a.prod_secret_enc),
        test_identity: a.test_identity ? maskSecret(a.test_identity) : "", prod_identity: a.prod_identity ? maskSecret(a.prod_identity) : "",
        last_ok_at: a.last_ok_at ?? null, last_error: a.last_error ?? null,
        last_event_at: a.last_event_at ?? null,
        month: { approved: mine.filter((x) => x.status === "approved").length, total: mine.filter((x) => x.status === "approved").reduce((s, x) => s + Number(x.amount), 0), tries: mine.length },
      };
    }),
    points: ((points ?? []) as Array<{ id: string; name: string; kind: string | null; active: boolean | null }>).filter((x) => x.active !== false),
    links: links ?? [],
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireUser(request);
    const storeId = await owner(ctx, new URL(request.url).searchParams.get("store_id"));
    return jsonOk(await overview(ctx, storeId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    const body = await readJson<Body>(request, 10_000);
    const storeId = await owner(ctx, body.store_id);
    const admin = ctx.admin();
    const now = new Date().toISOString();
    const mine = async (id: unknown) => {
      if (!isUuid(id)) throw new FiscalApiError("Falta la cuenta.", 400, "INVALID");
      const { data } = await admin.from("erp_bold_accounts").select("*").eq("id", id).eq("store_id", storeId).maybeSingle();
      if (!data) throw new FiscalApiError("Esa cuenta Bold no es de esta tienda.", 404, "NOT_FOUND");
      return data as BoldAccountRow;
    };

    if (body.action === "save") {
      const name = (body.name ?? "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 60) throw new FiscalApiError("Ponle un nombre a la cuenta (ej. «Bold Zamora»).", 422, "INVALID");
      const keys: Record<string, string> = {};
      for (const k of ["test_identity", "test_secret", "prod_identity", "prod_secret"] as const) {
        const v = (body[k] ?? "").trim();
        if (v && !KEY.test(v)) throw new FiscalApiError(`La llave «${k.includes("identity") ? "de identidad" : "secreta"}» de ${k.startsWith("test") ? "pruebas" : "producción"} no parece de Bold. Cópiala completa, sin espacios.`, 422, "INVALID");
        if (v) keys[k] = v;
      }
      if (keys.test_identity && keys.test_identity === keys.test_secret || keys.prod_identity && keys.prod_identity === keys.prod_secret) {
        throw new FiscalApiError("La llave de identidad y la secreta no pueden ser la misma.", 422, "INVALID");
      }
      const mode: BoldMode = body.mode === "production" ? "production" : "test";
      let id = isUuid(body.id) ? (await mine(body.id)).id : null;
      if (!id) {
        const { count } = await admin.from("erp_bold_accounts").select("id", { count: "exact", head: true }).eq("store_id", storeId);
        const { data, error } = await admin.from("erp_bold_accounts").insert({ store_id: storeId, name, mode, is_default: !count, created_by: ctx.userId, updated_by: ctx.userId }).select("id").single();
        if (error) throw new FiscalApiError(missing(error.message), 500, "DB_ERROR");
        id = (data as { id: string }).id;
      }
      const patch: Record<string, unknown> = { name, mode, updated_by: ctx.userId, updated_at: now, last_error: null };
      if (typeof body.active === "boolean") patch.active = body.active;
      if (keys.test_identity) patch.test_identity = keys.test_identity;
      if (keys.prod_identity) patch.prod_identity = keys.prod_identity;
      if (keys.test_secret) patch.test_secret_enc = encryptSecret(keys.test_secret, boldAad(id, "test"));
      if (keys.prod_secret) patch.prod_secret_enc = encryptSecret(keys.prod_secret, boldAad(id, "production"));
      const { error } = await admin.from("erp_bold_accounts").update(patch).eq("id", id);
      if (error) throw new FiscalApiError(missing(error.message), 500, "DB_ERROR");
      const a = await mine(id);
      const ready = mode === "production" ? a.prod_identity && a.prod_secret_enc : a.test_identity && a.test_secret_enc;
      return jsonOk({ id, ready: Boolean(ready), ...(await overview(ctx, storeId)) });
    }

    if (body.action === "mode") {
      const a = await mine(body.id);
      const mode: BoldMode = body.mode === "production" ? "production" : "test";
      if (mode === "production" ? !(a.prod_identity && a.prod_secret_enc) : !(a.test_identity && a.test_secret_enc)) {
        throw new FiscalApiError(`Primero pega las llaves de ${mode === "production" ? "producción" : "pruebas"} de «${a.name}».`, 422, "NOT_READY");
      }
      await admin.from("erp_bold_accounts").update({ mode, updated_by: ctx.userId, updated_at: now }).eq("id", a.id);
      return jsonOk(await overview(ctx, storeId));
    }

    if (body.action === "default") {
      const a = await mine(body.id);
      await admin.from("erp_bold_accounts").update({ is_default: false }).eq("store_id", storeId).neq("id", a.id);
      await admin.from("erp_bold_accounts").update({ is_default: true, updated_by: ctx.userId, updated_at: now }).eq("id", a.id);
      return jsonOk(await overview(ctx, storeId));
    }

    if (body.action === "delete") {
      const a = await mine(body.id);
      const { count } = await admin.from("erp_bold_payments").select("id", { count: "exact", head: true }).eq("account_id", a.id).in("status", ["created", "pending"]);
      if (count) throw new FiscalApiError("Esta cuenta tiene pagos en curso. Desactívala en vez de borrarla.", 409, "IN_USE");
      await admin.from("erp_bold_accounts").delete().eq("id", a.id);
      if (a.is_default) {
        const { data: next } = await admin.from("erp_bold_accounts").select("id").eq("store_id", storeId).order("created_at").limit(1).maybeSingle();
        if (next) await admin.from("erp_bold_accounts").update({ is_default: true }).eq("id", (next as { id: string }).id);
      }
      return jsonOk(await overview(ctx, storeId));
    }

    if (body.action === "assign") {
      if (!isUuid(body.point_id)) throw new FiscalApiError("Falta el punto.", 400, "INVALID");
      const { data: wh } = await admin.from("erp_warehouses").select("id").eq("id", body.point_id).eq("store_id", storeId).maybeSingle();
      if (!wh) throw new FiscalApiError("Ese punto no es de esta tienda.", 404, "NOT_FOUND");
      if (body.account_id) {
        const a = await mine(body.account_id);
        await admin.from("erp_bold_points").upsert({ point_id: body.point_id, store_id: storeId, account_id: a.id, updated_by: ctx.userId, updated_at: now });
      } else {
        await admin.from("erp_bold_points").delete().eq("point_id", body.point_id).eq("store_id", storeId);
      }
      return jsonOk(await overview(ctx, storeId));
    }

    if (body.action === "test") {
      const a = await mine(body.id);
      const results: Record<string, string> = {};
      for (const [mode, identity] of [["test", a.test_identity], ["production", a.prod_identity]] as const) {
        if (!identity) continue;
        try {
          await boldVoucher(identity, `rhprueba${Date.now().toString(36)}`);
          results[mode] = "ok";
        } catch (e) {
          results[mode] = e instanceof Error ? e.message : String(e);
        }
      }
      if (!Object.keys(results).length) throw new FiscalApiError("Primero pega las llaves.", 422, "NOT_READY");
      const bad = Object.entries(results).filter(([, v]) => v !== "ok");
      await admin.from("erp_bold_accounts").update(bad.length
        ? { last_error: bad.map(([m, v]) => `${m === "test" ? "Pruebas" : "Producción"}: ${v}`).join(" · ").slice(0, 300) }
        : { last_ok_at: now, last_error: null }).eq("id", a.id);
      return jsonOk({ results, ...(await overview(ctx, storeId)) });
    }

    throw new FiscalApiError("Acción no válida.", 400, "INVALID");
  } catch (error) {
    return jsonError(error);
  }
}
