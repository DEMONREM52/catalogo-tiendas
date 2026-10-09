import { resolveCatalogIdentity } from "@/lib/share/identity";

/**
 * Manifest de un catálogo: se instala con el nombre y el logo de su tienda o punto y abre solo ese catálogo.
 * Cada catálogo tiene su propio «id», así en Android se puede tener RemHub y varios catálogos instalados.
 * ?key=… (opcional): la clave del catálogo privado o mayorista que el cliente ya tiene en su enlace.
 */
export const dynamic = "force-dynamic";

const KEY = /^[A-Za-z0-9_-]{1,80}$/;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; mode: string }> }) {
  const { slug, mode } = await params;
  const identity = await resolveCatalogIdentity(slug, mode);
  if (!identity?.path) {
    return new Response(JSON.stringify({ error: "Catálogo no encontrado" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  const key = new URL(request.url).searchParams.get("key");
  const start = new URLSearchParams({ source: "pwa" });
  if (key && KEY.test(key)) start.set("key", key);
  const storeSlug = identity.path.split("/")[1];
  const q = (size: number, purpose = "any") =>
    `/api/pwa-icon?${new URLSearchParams({ store: storeSlug, mode: decodeURIComponent(mode), size: String(size), purpose }).toString()}`;
  const label = identity.badge === "MAYORISTAS" ? `${identity.name} · Mayoristas` : identity.name;

  const manifest = {
    id: identity.path,
    name: label,
    short_name: identity.shortName,
    description: `${identity.subtitle}. Catálogo de ${identity.name} en RemHub.`,
    lang: "es-CO",
    start_url: `${identity.path}?${start.toString()}`,
    // Incluye la página «Ver más» de los productos de la tienda.
    scope: `/${storeSlug}/`,
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#111111",
    categories: ["shopping"],
    icons: [
      { src: q(192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: q(512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: q(512, "maskable"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}
