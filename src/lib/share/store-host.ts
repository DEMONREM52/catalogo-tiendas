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

/** Rutas que en el dominio de una tienda se mandan a remhub.co (panel, acceso, documentos internos). */
const PLATFORM_PATHS = ["/dashboard", "/admin", "/login", "/acceso", "/instalar", "/forgot-password", "/reset-password", "/offline", "/traslado", "/comprobante", "/pedido"];

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
export function storeHostAction(slug: string, target: string, pathname: string, search = ""): HostAction {
  const s = slug.toLowerCase();
  const p = pathname || "/";
  // Archivos de Next, API, robots/sitemap (ven el dominio) y archivos con extensión (íconos, sw.js…).
  if (p.startsWith("/_next/") || p.startsWith("/api/") || p === "/robots.txt" || p === "/sitemap.xml" || /\/[^/]+\.[a-z0-9]{2,6}$/i.test(p)) {
    return { type: "next" };
  }
  if (PLATFORM_PATHS.some((x) => p === x || p.startsWith(`${x}/`))) return { type: "redirect", url: `${PRODUCTION_ORIGIN}${p}${search}` };
  // Enlaces internos con el slug (/mitienda/producto/1) → dirección limpia (/producto/1): una sola URL por página.
  if (p.toLowerCase() === `/${s}`) return { type: "redirect", url: `/${search}` };
  if (p.toLowerCase().startsWith(`/${s}/`)) return { type: "redirect", url: `${p.slice(s.length + 1)}${search}` };
  if (p === "/") return { type: "rewrite", path: `/${s}/${target}${search}` };
  return { type: "rewrite", path: `/${s}${p}${search}` };
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
