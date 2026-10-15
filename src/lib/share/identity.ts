import { createClient } from "@supabase/supabase-js";

/**
 * Identidad pública (nombre y logo) de lo que se comparte o se instala.
 * Siempre se resuelve desde la base de datos con la tienda y el catálogo de la URL:
 * nunca se acepta una imagen ni un nombre enviados por parámetro.
 */
export type PublicIdentity = {
  kind: "remhub" | "store" | "catalog";
  /** Nombre principal (tienda o punto). */
  name: string;
  /** Nombre corto para el icono (máx. ~12 letras). */
  shortName: string;
  /** Texto secundario (tipo de catálogo o descripción). */
  subtitle: string;
  /** Etiqueta opcional (MAYORISTAS, nombre de la tienda madre…). */
  badge: string | null;
  /** Logo real configurado (null = no tiene). */
  logoUrl: string | null;
  /** Ruta pública del catálogo (ej. /mi-tienda/detal). */
  path: string | null;
};

import { PRODUCTION_ORIGIN } from "./origin";
export { PRODUCTION_ORIGIN };

export const REMHUB_IDENTITY: PublicIdentity = {
  kind: "remhub",
  name: "RemHub",
  shortName: "RemHub",
  subtitle: "Catálogos online, pedidos por WhatsApp y facturación",
  badge: null,
  logoUrl: null,
  path: null,
};

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function supabasePublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function candidates(slugRaw: string) {
  const s = decodeURIComponent(slugRaw || "").trim();
  const noCom = s.replace(/\.com$/i, "");
  return [...new Set([s, s.toLowerCase(), noCom, noCom.toLowerCase()].filter(Boolean))];
}

function shortOf(name: string) {
  const clean = name.trim();
  if (clean.length <= 12) return clean;
  const first = clean.split(/\s+/).filter((w) => !/^(la|el|los|las|de|del|sede|punto)$/i.test(w))[0] ?? clean;
  return first.length <= 12 ? first : first.slice(0, 12);
}

const okUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Identidad del catálogo clásico (detal / mayor) o de un catálogo de RemHub Social. null si no existe. */
export async function resolveCatalogIdentity(slugRaw: string, modeRaw: string | null): Promise<PublicIdentity | null> {
  const slug = decodeURIComponent(slugRaw || "").trim();
  const mode = decodeURIComponent(modeRaw || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug) || (mode && !SLUG_RE.test(mode))) return null;
  const sb = supabasePublic();
  if (!sb) return null;

  // Catálogo de RemHub Social (si el modo no es detal/mayor).
  if (mode && mode !== "detal" && mode !== "mayor") {
    const { data, error } = await sb.rpc("catalog_public_meta", { p_store: slug, p_catalog: mode });
    if (!error && data) {
      const m = data as { name: string; store_name: string; headline: string | null; logo_url: string | null; point_name?: string | null };
      const name = m.point_name || m.store_name || m.name;
      return {
        kind: "catalog",
        name,
        shortName: shortOf(name),
        subtitle: m.headline || (m.name && m.name !== name ? m.name : "Catálogo online · pide por WhatsApp"),
        badge: m.point_name ? m.store_name : null,
        logoUrl: okUrl(m.logo_url),
        path: `/${slug}/${mode}`,
      };
    }
  }

  for (const c of candidates(slug)) {
    const { data } = await sb.from("stores").select("name,slug,logo_url").eq("slug", c).maybeSingle();
    if (data?.name) {
      const wholesale = mode === "mayor";
      const name = String(data.name);
      return {
        kind: "store",
        name,
        shortName: shortOf(name),
        subtitle: wholesale ? "Catálogo mayorista · pide por WhatsApp" : "Catálogo online · pide por WhatsApp",
        badge: wholesale ? "MAYORISTAS" : null,
        logoUrl: okUrl(data.logo_url),
        path: `/${String(data.slug)}/${mode || "detal"}`,
      };
    }
  }
  return null;
}

const MAX_IMAGE_BYTES = 8_000_000;

/** URL de imagen segura para descargar desde el servidor: https, puerto estándar, dominio público. */
export function publicImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  let u: URL;
  try { u = new URL(src); } catch { return null; }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  // Sin IP directas (v4/v6, también en decimal u octal) ni nombres internos.
  if (/^[\d.]+$/.test(h) || /^0x/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h)) return null;
  if (/^(metadata|instance-data)(\.|$)/.test(h)) return null;
  return u.toString();
}

/** Lee el cuerpo con un tope real de bytes (no confía en content-length). */
async function readLimited(body: ReadableStream<Uint8Array>, max: number): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => null); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Descarga una imagen (cualquier formato) y la deja en PNG cuadrado. null si no se puede. */
export async function fetchImageAsPng(src: string | null | undefined, size: number): Promise<Buffer | null> {
  // El logo lo escribe cada tienda: solo https a un dominio público (nunca direcciones internas,
  // IP directas ni redirecciones), y como máximo 8 MB leídos de verdad.
  const target = publicImageUrl(src);
  if (!target) return null;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(6000), redirect: "error" });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const bytes = await readLimited(res.body, MAX_IMAGE_BYTES);
    if (!bytes) return null;
    const sharp = (await import("sharp")).default;
    return await sharp(bytes, { limitInputPixels: 40_000_000 })
      .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
