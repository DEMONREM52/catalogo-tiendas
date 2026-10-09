// Contexto y controles de acceso para las rutas del servidor del módulo fiscal.
// Regla: nunca se confía en store_id / point_id / NIT / resolución que mande el navegador;
// la base valida usuario → tienda → punto → permiso → recurso en cada función.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FiscalConfigError } from "./crypto";
import type { FiscalPermission } from "./types";

export class FiscalApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, code = "ERROR", extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type RequestMeta = { ip: string | null; userAgent: string | null; requestId: string };

export type FiscalContext = {
  userId: string;
  email: string | null;
  meta: RequestMeta;
  /** Cliente con la sesión del usuario: aplica RLS y auth.uid(). */
  db: SupabaseClient;
  /** Cliente de servicio (solo servidor), atribuido al usuario en la auditoría. */
  admin: () => SupabaseClient;
};

const STATUS_BY_CODE: Record<string, number> = {
  AUTH: 401,
  FORBIDDEN: 403,
  POINT_FORBIDDEN: 403,
  NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  BUSY: 409,
  DUPLICATE: 409,
  CONTINGENCY: 409,
  VOID: 409,
  DONE: 409,
  NOT_READY: 422,
  VALIDATION: 422,
  INVALID: 422,
  REASON_REQUIRED: 422,
  CONFIRM_PRODUCTION: 422,
  TOTALS_MISMATCH: 422,
  NO_LINES: 422,
  QTY_EXCEEDED: 422,
  NOTHING_LEFT: 422,
  NOT_ACCEPTED: 422,
  TRANSMITTED: 422,
  MAYBE_TRANSMITTED: 422,
  ALREADY_INTERNAL_INVOICE: 422,
  ENV_MISMATCH: 422,
  PROVIDER_PENDING: 422,
  PROVIDER_DISCONNECTED: 422,
  ORG_DISABLED: 422,
  POINT_DISABLED: 422,
  SERVER_CONFIG: 500,
};

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) throw new FiscalApiError("Falta configurar Supabase en el servidor.", 500, "SERVER_CONFIG");
  return { url, anon, service };
}

export function requestMeta(request: Request): RequestMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip"))?.trim() || null;
  const requestId = request.headers.get("x-request-id") || request.headers.get("x-vercel-id") || crypto.randomUUID();
  return { ip, userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null, requestId: requestId.slice(0, 120) };
}

function metaHeaders(meta?: RequestMeta): Record<string, string> {
  const headers: Record<string, string> = {};
  if (meta?.ip) headers["x-remhub-client-ip"] = meta.ip;
  if (meta?.userAgent) headers["x-remhub-user-agent"] = meta.userAgent;
  if (meta?.requestId) headers["x-remhub-request-id"] = meta.requestId;
  return headers;
}

/** Cliente con la llave de servicio. Si hay usuario, la auditoría queda a su nombre. */
export function serviceClient(meta?: RequestMeta, actorId?: string | null): SupabaseClient {
  const { url, service } = env();
  if (!service) {
    throw new FiscalApiError(
      "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor (variables de entorno del hosting, sin NEXT_PUBLIC_).",
      500,
      "SERVER_CONFIG",
    );
  }
  const headers = metaHeaders(meta);
  if (actorId) headers["x-remhub-actor"] = actorId;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } });
}

/** Valida la sesión (token Bearer) y arma los clientes del usuario y de servicio. */
export async function requireUser(request: Request): Promise<FiscalContext> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new FiscalApiError("Inicia sesión para continuar.", 401, "AUTH");
  const { url, anon } = env();
  const meta = requestMeta(request);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) throw new FiscalApiError("La sesión no es válida. Inicia sesión de nuevo.", 401, "AUTH");
  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, ...metaHeaders(meta) } },
  });
  let adminClient: SupabaseClient | null = null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    meta,
    db,
    admin: () => (adminClient ??= serviceClient(meta, data.user.id)),
  };
}

/** Llama una función de la base y devuelve su resultado; los errores de la base se vuelven mensajes claros. */
export async function rpc<T = Record<string, unknown>>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (/Could not find the function|schema cache|does not exist/i.test(error.message)) {
      throw new FiscalApiError("Falta ejecutar la migración 20261027_fiscal_multipunto.sql en Supabase.", 500, "MIGRATION");
    }
    throw new FiscalApiError(error.message, 400, error.code || "DB_ERROR");
  }
  return data as T;
}

/** Convierte una respuesta { ok:false, code, message } de la base en error HTTP. */
export function assertOk<T extends object>(data: T | { ok: false; code: string; message: string }): T {
  const value = data as { ok?: boolean; code?: string; message?: string };
  if (value && value.ok === false) {
    const { ok: _ok, code, message, ...extra } = value as Record<string, unknown> & { ok: false; code: string; message: string };
    void _ok;
    throw new FiscalApiError(message || "No se pudo completar la operación.", STATUS_BY_CODE[code] ?? 400, code, extra);
  }
  return data as T;
}

/** Intento sospechoso: queda en la auditoría de seguridad a nombre del usuario, con su IP. */
export async function logSecurityEvent(ctx: FiscalContext, storeId: string | null, action: string, detail: Record<string, unknown>, severity: "warning" | "critical" = "warning") {
  const { error } = await ctx.admin().rpc("erp__security_event", { p_store: storeId, p_point: null, p_action: action, p_detail: detail, p_severity: severity });
  if (error) console.error("No se pudo registrar el evento de seguridad:", error.message);
}

// ---- Controles centralizados (sección 41) ----

export async function requireSuperAdmin(ctx: FiscalContext) {
  const ok = await rpc<boolean>(ctx.db, "erp_is_platform_admin", {});
  if (!ok) {
    await logSecurityEvent(ctx, null, "security.super_admin_denied", { request_id: ctx.meta.requestId }, "critical");
    throw new FiscalApiError("Solo el super administrador puede hacer esto.", 403, "FORBIDDEN");
  }
}

export async function requireOrganizationAccess(ctx: FiscalContext, storeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw new FiscalApiError("Tienda inválida.", 400, "INVALID");
  const ok = await rpc<boolean>(ctx.db, "erp__is_member", { p_store: storeId });
  if (!ok) {
    await logSecurityEvent(ctx, storeId, "security.foreign_store_access", { store: storeId }, "critical");
    throw new FiscalApiError("No tienes acceso a esta tienda.", 403, "FORBIDDEN");
  }
}

export async function requirePointAccess(ctx: FiscalContext, storeId: string, pointId: string) {
  await requireOrganizationAccess(ctx, storeId);
  const ok = await rpc<boolean>(ctx.db, "erp_point_allowed", { p_store: storeId, p_point: pointId });
  if (!ok) {
    await logSecurityEvent(ctx, storeId, "security.foreign_point_access", { point: pointId }, "critical");
    throw new FiscalApiError("No tienes acceso a este punto.", 403, "FORBIDDEN");
  }
}

export async function requirePermission(ctx: FiscalContext, storeId: string, permissions: string | string[]) {
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  const ok = await rpc<boolean>(ctx.db, "erp_can_any", { p_store: storeId, p_perms: perms });
  if (!ok) {
    await logSecurityEvent(ctx, storeId, "security.permission_denied", { permissions: perms });
    throw new FiscalApiError("El usuario no tiene permiso para esta acción.", 403, "FORBIDDEN");
  }
}

export async function requireFiscalPermission(ctx: FiscalContext, storeId: string, permission: FiscalPermission | FiscalPermission[]) {
  await requireOrganizationAccess(ctx, storeId);
  await requirePermission(ctx, storeId, permission);
}

export function jsonOk(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

export function jsonError(error: unknown) {
  if (error instanceof FiscalApiError) {
    if (error.status >= 500) console.error("[fiscal]", error.code, error.message);
    return NextResponse.json({ ok: false, code: error.code, error: error.message, ...(error.extra ?? {}) }, { status: error.status });
  }
  if (error instanceof FiscalConfigError) {
    console.error("[fiscal] configuración:", error.message);
    return NextResponse.json({ ok: false, code: "SERVER_CONFIG", error: error.message }, { status: 500 });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("[fiscal] error inesperado:", message);
  return NextResponse.json({ ok: false, code: "UNEXPECTED", error: "No se pudo completar la operación. Intenta de nuevo; si persiste, revisa el registro del servidor." }, { status: 500 });
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 200_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new FiscalApiError("La solicitud es demasiado grande.", 413, "TOO_LARGE");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new FiscalApiError("La solicitud no es JSON válido.", 400, "INVALID");
  }
}

export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
