import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { PRODUCTION_HOST } from "@/lib/share/origin";
import {
  cleanHost, isPlatformHost, mainHostStorePath, mainHostStoreRedirect, shortLinkTarget, storeHostAction, storeSpaceOrigin, subdomainSlug,
  type StoreHostInfo,
} from "@/lib/share/store-host";

/**
 * Antes de cada página (Next 16: «Proxy», antes «Middleware»):
 *   1. En remhub.co: protege el panel (igual que antes), y los enlaces de siempre (remhub.co/lavitrina/zamora)
 *      llevan al subdominio de la tienda y los nombres viejos al nombre nuevo.
 *   2. En mitienda.remhub.co o en el dominio propio de una tienda: muestra su catálogo
 *      (catalogo.mitienda.com/ → su catálogo; /producto/123 → su producto; /z → su enlace corto).
 */

const TTL_MS = 60_000;
const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 0, data: null };
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2500),
  });
  return { ok: res.ok, status: res.status, data: res.ok ? ((await res.json()) as T | null) : null };
}

// Datos de cada tienda (inicio, enlaces cortos, nombre nuevo), con memoria de 1 minuto (también las que no existen).
const infoCache = new Map<string, { at: number; value: StoreHostInfo | null }>();
async function storeInfo(slugRaw: string): Promise<StoreHostInfo | null> {
  const slug = slugRaw.toLowerCase();
  const hit = infoCache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: StoreHostInfo | null = null;
  try {
    const res = await rpc<StoreHostInfo>("store_host_info", { p_slug: slug });
    if (res.ok) value = res.data;
    else if (res.status === 404) {
      // Sin la migración 20261201: solo el inicio de la tienda.
      const old = await rpc<string>("store_home_target", { p_slug: slug });
      value = old.ok && typeof old.data === "string" && old.data ? { slug, target: old.data } : null;
    } else return { slug, target: "detal" };
  } catch {
    // Sin respuesta: se atiende como antes y no se guarda en memoria para reintentar.
    return { slug, target: "detal" };
  }
  if (infoCache.size > 2000) infoCache.clear();
  infoCache.set(slug, { at: Date.now(), value });
  return value;
}

// Dominios propios: se consultan a la base con memoria de 1 minuto (también los que no existen).
const domainCache = new Map<string, { at: number; value: { slug: string; target: string } | null }>();
async function resolveDomain(host: string) {
  const hit = domainCache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: { slug: string; target: string } | null = null;
  try {
    const res = await rpc<{ slug?: string; target?: string }>("store_domain_resolve", { p_host: host });
    if (res.data?.slug) value = { slug: res.data.slug, target: res.data.target || "detal" };
  } catch {
    return null;
  }
  if (domainCache.size > 2000) domainCache.clear();
  domainCache.set(host, { at: Date.now(), value });
  return value;
}

/** Cuenta la visita a un enlace corto sin hacer esperar al cliente. */
function countHit(event: NextFetchEvent, slug: string, pathname: string) {
  const code = pathname.split("/")[1];
  if (code) event.waitUntil(rpc("store_short_link_hit", { p_slug: slug, p_code: code }).catch(() => null));
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

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const host = cleanHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  const { pathname, search } = req.nextUrl;

  if (!host || isPlatformHost(host)) {
    const path = mainHostStorePath(pathname);
    if (!path) return protectDashboard(req);
    const info = await storeInfo(path.slug);
    // Al subdominio solo en producción (en desarrollo y vistas previas se queda en el mismo servidor).
    const url = mainHostStoreRedirect(info, path, search, SUBDOMAINS && host === PRODUCTION_HOST);
    if (!url) return NextResponse.next();
    if (info?.slug && shortLinkTarget(info.links, path.rest)) countHit(event, info.slug, path.rest);
    return NextResponse.redirect(new URL(url, req.url), 308);
  }

  const sub = subdomainSlug(host);
  const domain = sub ? null : await resolveDomain(host);
  const slug = sub ?? domain?.slug;
  if (!slug) return NextResponse.next();
  const info = await storeInfo(slug);
  // Nombre viejo: lavitrina.remhub.co → la-vitrina.remhub.co, con la misma ruta.
  if (sub && info?.moved_to) return NextResponse.redirect(`https://${info.moved_to}.${PRODUCTION_HOST}${pathname}${search}`, 308);
  const store = { slug: info?.slug ?? slug, target: domain?.target ?? info?.target ?? "detal" };

  // Enlace corto (/z → /zamora). 307: la tienda puede cambiar el destino cuando quiera.
  const short = shortLinkTarget(info?.links, pathname, search);
  if (short) {
    countHit(event, store.slug, pathname);
    return NextResponse.redirect(new URL(short, req.url), 307);
  }

  // Espacio de la tienda: en su subdominio vive también su panel; desde un dominio propio el panel va al subdominio.
  const space = SUBDOMAINS && Boolean(sub);
  const action = storeHostAction(store.slug, store.target, pathname, search, {
    subdomainSpace: space,
    spaceOrigin: SUBDOMAINS ? storeSpaceOrigin(store.slug) ?? undefined : undefined,
  });
  // Tienda pausada: las páginas públicas muestran su aviso (el panel sigue abierto para el dueño).
  if (info?.suspended && action.type === "rewrite") {
    return NextResponse.rewrite(new URL(`/tienda-pausada?s=${encodeURIComponent(store.slug)}`, req.url));
  }
  if (space && action.type === "next" && pathname.startsWith("/dashboard")) return protectDashboard(req);
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
  // No corre en archivos estáticos (imágenes, íconos, fuentes, JS/CSS): cada vez que corre es una invocación que se paga.
  // robots.txt, sitemap.xml y los manifiestos SÍ pasan: necesitan saber en qué dominio están.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|css|js|map)$).*)"],
};
