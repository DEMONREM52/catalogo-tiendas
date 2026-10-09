"use client";

// Llamadas del navegador al módulo fiscal: funciones de la base (validan permisos y alcance)
// y rutas del servidor (cifrado de credenciales, envío al proveedor, descargas).
import { supabaseBrowser } from "@/lib/supabase/client";
import type { FiscalRpcError } from "./types";

export class FiscalClientError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(message: string, code = "ERROR", details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const MISSING_MIGRATION = "Falta ejecutar la migración supabase/migrations/20261027_fiscal_multipunto.sql en Supabase (SQL Editor).";

function friendly(message: string) {
  if (/Could not find the function|schema cache|does not exist|PGRST20/i.test(message)) return MISSING_MIGRATION;
  return message;
}

/** Función de la base que responde { ok, … }. Lanza FiscalClientError con el mensaje claro si ok = false. */
export async function fiscalRpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(fn, args);
  if (error) throw new FiscalClientError(friendly(error.message), error.code || "DB_ERROR");
  const value = data as T | FiscalRpcError;
  if (value && typeof value === "object" && (value as FiscalRpcError).ok === false) {
    const err = value as FiscalRpcError;
    throw new FiscalClientError(err.message, err.code, err as unknown as Record<string, unknown>);
  }
  return value as T;
}

async function authHeader() {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new FiscalClientError("Tu sesión terminó. Inicia sesión de nuevo.", "AUTH");
  return { Authorization: `Bearer ${token}` };
}

/** Ruta del servidor /api/fiscal/… con la sesión del usuario. */
export async function fiscalApi<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>, method: "POST" | "GET" = "POST"): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const json = (await response.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean; error?: string; code?: string }) | null;
  if (!response.ok || !json || json.ok === false) {
    throw new FiscalClientError(friendly(String(json?.error ?? `El servidor respondió ${response.status}.`)), String(json?.code ?? response.status), json ?? {});
  }
  return json as T;
}

/** Descarga un archivo protegido (XML/PDF) validando permiso en el servidor. */
export async function fiscalDownload(path: string, fallbackName: string) {
  const response = await fetch(path, { headers: await authHeader() });
  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new FiscalClientError(json?.error ?? "No se pudo descargar el archivo.", json?.code ?? String(response.status));
  }
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function newIdempotencyKey(prefix = "rh") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function errorText(error: unknown) {
  if (error instanceof FiscalClientError) return error.message;
  if (error && typeof error === "object" && "message" in error) return friendly(String((error as { message: unknown }).message));
  return "Ocurrió un error inesperado.";
}
