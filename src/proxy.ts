import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cleanHost, isPlatformHost, storeHostAction, subdomainSlug } from "@/lib/share/store-host";

/**
 * Antes de cada página (Next 16: «Proxy», antes «Middleware»):
 *   1. En remhub.co: protege el panel (igual que antes).
 *   2. En mitienda.remhub.co o en el dominio propio de una tienda: muestra su catálogo
 *      (catalogo.mitienda.com/ → su catálogo; /producto/123 → su producto).
 */

// Dominios propios: se consultan a la base con memoria de 1 minuto (también los que no existen).
const domainCache = new Map<string, { at: number; value: { slug: string; target: string } | null }>();
const TTL_MS = 60_000;

async function resolveDomain(host: string) {
  const hit = domainCache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: { slug: string; target: string } | null = null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/store_domain_resolve`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_host: host }),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = (await res.json()) as { slug?: string; target?: string } | null;
        if (data?.slug) value = { slug: data.slug, target: data.target || "detal" };
      }
    } catch {
      // Sin respuesta: no se guarda en memoria para reintentar en la siguiente visita.
      return null;
    }
  }
  if (domainCache.size > 2000) domainCache.clear();
  domainCache.set(host, { at: Date.now(), value });
  return value;
}

function protectDashboard(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Supabase guarda la sesión en el navegador; aquí solo se revisa la cookie propia que se crea al entrar.
  if (pathname.startsWith("/dashboard") && !req.cookies.get("app_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Al entrar (o retomar la sesión) vuelve a esta sección del panel.
    url.search = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export async function proxy(req: NextRequest) {
  const host = cleanHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  if (!host || isPlatformHost(host)) return protectDashboard(req);

  const sub = subdomainSlug(host);
  const store = sub ? { slug: sub, target: "detal" } : await resolveDomain(host);
  if (!store) return NextResponse.next();

  const action = storeHostAction(store.slug, store.target, req.nextUrl.pathname, req.nextUrl.search);
  // Las páginas saben en qué dominio están (dirección única para Google, robots y sitemap).
  const headers = new Headers(req.headers);
  headers.set("x-store-host", host);
  headers.set("x-store-slug", store.slug);
  headers.set("x-store-target", store.target);
  if (action.type === "redirect") return NextResponse.redirect(new URL(action.url, req.url), 308);
  if (action.type === "rewrite") return NextResponse.rewrite(new URL(action.path, req.url), { request: { headers } });
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
