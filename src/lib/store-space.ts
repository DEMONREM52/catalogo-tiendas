"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_HOST, PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { cleanHost, subdomainSlug } from "@/lib/share/store-host";

/**
 * Espacio de cada tienda: lavitrina.remhub.co (catálogo, /login y /dashboard).
 * Cada subdominio guarda su propia sesión; para pasar de remhub.co al espacio se usa un pase de un solo uso.
 */
export const STORE_SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";

/** «lavitrina» si estamos en lavitrina.remhub.co (null en remhub.co, en un dominio propio o en desarrollo). */
export function currentStoreSubdomain() {
  if (typeof window === "undefined") return null;
  return subdomainSlug(cleanHost(window.location.host));
}

export function onMainHost() {
  return typeof window !== "undefined" && cleanHost(window.location.host) === PRODUCTION_HOST;
}

export type PassResult = { url: string; slug: string } | { error: string; reason: string };

/** Pide el pase al espacio de la tienda del usuario. */
export async function requestStorePass(next = "/dashboard"): Promise<PassResult> {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { error: "Inicia sesión.", reason: "auth" };
    const res = await fetch("/api/session/pass", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ next }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; slug?: string; error?: string; reason?: string };
    if (res.ok && body.url) return { url: body.url, slug: body.slug ?? "" };
    return { error: body.error ?? "No se pudo abrir tu espacio.", reason: body.reason ?? "error" };
  } catch {
    return { error: "Sin conexión.", reason: "network" };
  }
}

/**
 * En remhub.co con subdominios activos: dirección del espacio de la tienda a la que hay que ir (con el pase).
 * null = quedarse aquí (desarrollo, admin de RemHub, tienda vieja sin subdominio o sin pase).
 */
export async function storeSpaceJump(next = "/dashboard") {
  if (!STORE_SUBDOMAINS || !onMainHost()) return null;
  const pass = await requestStorePass(next);
  return "url" in pass ? pass.url : null;
}

/** Al salir en el espacio de la tienda también se cierra la sesión de remhub.co (si había una en este equipo). */
export function logoutRedirect() {
  return currentStoreSubdomain() ? `${PRODUCTION_ORIGIN}/login?salir=1` : "/login";
}
