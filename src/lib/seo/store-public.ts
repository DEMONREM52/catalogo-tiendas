import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_HOST, PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Dirección pública de una tienda para Google (una sola URL por página):
 *   1. Si la visita llegó por el dominio de la tienda (proxy.ts pone x-store-host): ese dominio.
 *   2. Si la tienda tiene un dominio propio verificado: ese dominio.
 *   3. Si están activos los subdominios (NEXT_PUBLIC_STORE_SUBDOMAINS=1): mitienda.remhub.co.
 *   4. Si no: remhub.co/mitienda.
 */
export type StoreBase = { origin: string; prefix: string; target: string; ownDomain: boolean };

const cache = new Map<string, { at: number; value: { domain: string; target: string } | null }>();
const TTL_MS = 60_000;

async function publicDomain(slug: string) {
  const key = slug.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: { domain: string; target: string } | null = null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon) {
    try {
      const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).rpc("store_public_domain", { p_slug: key });
      if (!error && data && (data as { domain?: string }).domain) value = data as { domain: string; target: string };
    } catch {
      return null; // sin respuesta: se usa remhub.co y se reintenta luego
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function storeBase(slugRaw: string): Promise<StoreBase> {
  const slug = decodeURIComponent(slugRaw || "").toLowerCase();
  const h = await headers();
  const viaHost = h.get("x-store-host");
  if (viaHost && h.get("x-store-slug")?.toLowerCase() === slug) {
    return { origin: `https://${viaHost}`, prefix: "", target: h.get("x-store-target") || "detal", ownDomain: true };
  }
  const domain = await publicDomain(slug);
  if (domain) return { origin: `https://${domain.domain}`, prefix: "", target: domain.target, ownDomain: true };
  if (process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return { origin: `https://${slug}.${PRODUCTION_HOST}`, prefix: "", target: "detal", ownDomain: true };
  }
  return { origin: PRODUCTION_ORIGIN, prefix: `/${slug}`, target: "detal", ownDomain: false };
}

/** URL pública de una página de la tienda: path = "/detal", "/producto/123"… (sin el slug). */
export function storeUrl(base: StoreBase, path: string) {
  if (base.ownDomain && path === `/${base.target}`) return `${base.origin}/`;
  return `${base.origin}${base.prefix}${path}`;
}
