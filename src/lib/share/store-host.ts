import { LEGACY_HOSTS, PRODUCTION_HOST, PRODUCTION_ORIGIN } from "./origin";

/**
 * Dominios de tiendas (multitienda): mitienda.remhub.co y dominios propios (catalogo.mitienda.com).
 * Funciones puras: las usa proxy.ts y se prueban sin servidor.
 */

/** Subdominios que nunca son tiendas. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "panel", "dashboard", "ayuda", "help", "soporte", "estado", "status", "blog", "mail", "correo",
  "smtp", "ftp", "cdn", "static", "assets", "img", "docs", "dev", "test", "staging", "demo", "remhub",
]);

/** ¿El nombre sirve de subdominio? (las tiendas viejas con punto o guion bajo se quedan en remhub.co/tienda) */
export function isSubdomainSlug(slug: string) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) && !RESERVED_SUBDOMAINS.has(slug);
}

/** Origen del espacio de la tienda: https://lavitrina.remhub.co (null si su nombre no sirve de subdominio). */
export function storeSpaceOrigin(slug: string) {
  return isSubdomainSlug(slug) ? `https://${slug}.${PRODUCTION_HOST}` : null;
}

/**
 * Rutas del sistema (panel, acceso, documentos internos). En el subdominio de la tienda se atienden ahí mismo
 * (lavitrina.remhub.co/dashboard: su espacio); en un dominio propio se mandan al subdominio. /admin siempre en remhub.co.
 */
const PLATFORM_PATHS = ["/dashboard", "/admin", "/login", "/acceso", "/entrar", "/documento", "/instalar", "/forgot-password", "/reset-password", "/offline",
  "/traslado", "/firma-vale", "/firma-pedido", "/comprobante", "/pedido", "/tienda-pausada", "/registro"];

export type StoreHostOptions = {
  /** true en tienda.remhub.co con subdominios activos: el panel vive ahí. */
  subdomainSpace?: boolean;
  /** A dónde mandar el panel desde un dominio propio (https://tienda.remhub.co o remhub.co). */
  spaceOrigin?: string;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function cleanHost(raw: string | null | undefined) {
  return String(raw ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** RemHub mismo (o desarrollo / vista previa): se atiende normal. */
export function isPlatformHost(host: string) {
  return host === PRODUCTION_HOST || (LEGACY_HOSTS as readonly string[]).includes(host) || host === "localhost" || host === "127.0.0.1"
    || host.endsWith(".vercel.app") || host.endsWith(".local");
}

/** mitienda.remhub.co → "mitienda" (null si no es un subdominio de tienda). */
export function subdomainSlug(host: string) {
  if (!host.endsWith(`.${PRODUCTION_HOST}`)) return null;
  const label = host.slice(0, -(PRODUCTION_HOST.length + 1));
  if (!label || label.includes(".") || RESERVED_SUBDOMAINS.has(label) || !SLUG.test(label)) return null;
  return label;
}

export type HostAction =
  | { type: "next" }
  | { type: "rewrite"; path: string }
  | { type: "redirect"; url: string };

/**
 * Qué hacer con una ruta en el dominio de una tienda.
 * `search` se conserva en redirecciones y reescrituras.
 */
export function storeHostAction(slug: string, target: string, pathname: string, search = "", opts: StoreHostOptions = {}): HostAction {
  const s = slug.toLowerCase();
  const p = pathname || "/";
  // Archivos de Next, API, robots/sitemap (ven el dominio) y archivos con extensión (íconos, sw.js, manifiestos…).
  if (p.startsWith("/_next/") || p.startsWith("/api/") || p === "/robots.txt" || p === "/sitemap.xml" || /\/[^/]+\.[a-z0-9]{2,11}$/i.test(p)) {
    return { type: "next" };
  }
  if (PLATFORM_PATHS.some((x) => p === x || p.startsWith(`${x}/`))) {
    if (p === "/admin" || p.startsWith("/admin/")) return { type: "redirect", url: `${PRODUCTION_ORIGIN}${p}${search}` };
    if (opts.subdomainSpace) return { type: "next" };
    return { type: "redirect", url: `${opts.spaceOrigin ?? PRODUCTION_ORIGIN}${p}${search}` };
  }
  // Enlaces internos con el slug (/mitienda/producto/1) → dirección limpia (/producto/1): una sola URL por página.
  if (p.toLowerCase() === `/${s}`) return { type: "redirect", url: `/${search}` };
  if (p.toLowerCase().startsWith(`/${s}/`)) return { type: "redirect", url: `${p.slice(s.length + 1)}${search}` };
  // Inicio: el catálogo que escogió la tienda, o la vitrina con todos sus catálogos («inicio»).
  if (p === "/") return { type: "rewrite", path: target === "inicio" ? `/${s}${search}` : `/${s}/${target}${search}` };
  if (p === "/inicio") return { type: "rewrite", path: `/${s}${search}` };
  return { type: "rewrite", path: `/${s}${p}${search}` };
}

/** Une la consulta del destino con la de la visita (la del destino manda). */
function mergeSearch(target: string, search: string) {
  const [path, query = ""] = target.split("?", 2);
  const params = new URLSearchParams(query);
  for (const [k, v] of new URLSearchParams(search)) if (!params.has(k)) params.append(k, v);
  const out = params.toString();
  return out ? `${path}?${out}` : path;
}

/**
 * Enlace corto de la tienda (/z → /zamora). `links` = { código: destino } de store_host_info.
 * También sigue rutas debajo del enlace (/viejo/algo → /nuevo/algo) si el destino no tiene consulta.
 */
export function shortLinkTarget(links: Record<string, string> | null | undefined, pathname: string, search = "") {
  if (!links) return null;
  const m = /^\/([a-z0-9][a-z0-9-]{0,47})(\/.*)?$/i.exec(pathname || "");
  if (!m) return null;
  const target = links[m[1].toLowerCase()];
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return null;
  const rest = m[2] && m[2] !== "/" && !target.includes("?") ? m[2] : "";
  return mergeSearch(`${target}${rest}`, search);
}

/** Primeras partes de ruta de remhub.co que no son tiendas. */
const PLATFORM_ROOTS = new Set(["", "_next", "api", "acceso", "admin", "comprobante", "dashboard", "documento", "entrar", "forgot-password", "instalar", "login",
  "offline", "pedido", "registro", "reset-password", "tienda-pausada", "traslado", "firma-vale", "firma-pedido", "robots.txt", "sitemap.xml", "manifest.webmanifest", "sw.js", "favicon.ico"]);

/** remhub.co/lavitrina/zamora → { slug: "lavitrina", rest: "/zamora" } (null si la ruta no es de una tienda). */
export function mainHostStorePath(pathname: string) {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname || "/");
  if (!m) return null;
  const first = m[1];
  if (PLATFORM_ROOTS.has(first.toLowerCase()) || !/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(first)) return null;
  // Archivos públicos de la raíz (íconos, imágenes, manifiestos).
  if (!m[2] && /\.(png|jpe?g|gif|svg|webp|avif|ico|js|mjs|css|txt|xml|json|webmanifest|map|woff2?|mp4|pdf)$/i.test(first)) return null;
  return { slug: first, rest: m[2] && m[2] !== "/" ? m[2] : "" };
}

export type StoreHostInfo = { slug?: string; target?: string; links?: Record<string, string>; moved_to?: string; suspended?: boolean };

/**
 * En remhub.co: los enlaces de siempre (remhub.co/lavitrina/zamora) llevan al subdominio (lavitrina.remhub.co/zamora)
 * si están activos, y los nombres viejos al nuevo. null = se atiende normal.
 */
export function mainHostStoreRedirect(info: StoreHostInfo | null, path: { slug: string; rest: string }, search: string, subdomains: boolean) {
  const current = info?.moved_to ?? info?.slug;
  if (!current) return null;
  const short = info?.moved_to ? null : shortLinkTarget(info?.links, path.rest, search);
  const rest = short || mergeSearch(path.rest || "", search);
  if (subdomains && isSubdomainSlug(current)) {
    return `https://${current}.${PRODUCTION_HOST}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }
  return current !== path.slug || short ? `/${current}${rest}` : null;
}

/**
 * Enlace para compartir una página de la tienda (`path` sin el nombre: "/zamora", "/z", "/producto/1").
 * Con subdominios: https://lavitrina.remhub.co/zamora; si no, https://remhub.co/lavitrina/zamora.
 */
export function storeShareUrl(slug: string, path: string, subdomains: boolean, origin: string = PRODUCTION_ORIGIN) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (subdomains && isSubdomainSlug(slug)) {
    return `https://${slug}.${PRODUCTION_HOST}${p === "/" ? "" : p}`;
  }
  return `${origin}/${encodeURIComponent(slug)}${p === "/" ? "" : p}`;
}

/** Dirección pública de una página de la tienda en su dominio (sin el slug). */
export function storePublicUrl(domain: string, target: string, path: string) {
  const clean = path === `/${target}` ? "/" : path;
  return `https://${domain}${clean}`;
}

export type DnsRecord = { type: string; name: string; value: string; why: string };

/** Parte registrable del dominio: mitienda.com, mitienda.com.co (no «com.co»). */
export function registrableDomain(domain: string) {
  const labels = domain.split(".");
  const tail2 = labels.at(-1)?.length === 2 && ["com", "net", "org", "gov", "edu", "co", "mil"].includes(labels.at(-2) ?? "");
  return labels.slice(tail2 ? -3 : -2).join(".");
}

/** Registros que el dueño crea en su proveedor del dominio para conectarlo a RemHub (Vercel). */
export function dnsRecordsFor(domain: string, verification?: unknown): DnsRecord[] {
  const root = registrableDomain(domain);
  const out: DnsRecord[] = domain === root
    ? [{ type: "A", name: "@", value: "76.76.21.21", why: "Apunta tu dominio a RemHub" }]
    : [{ type: "CNAME", name: domain.slice(0, -(root.length + 1)), value: "cname.vercel-dns.com", why: "Apunta el subdominio a RemHub" }];
  if (Array.isArray(verification)) {
    for (const v of verification as Array<{ type?: string; domain?: string; value?: string }>) {
      if (v?.type && v?.domain && v?.value) out.push({ type: v.type, name: v.domain, value: v.value, why: "Demuestra que el dominio es tuyo" });
    }
  }
  return out;
}
