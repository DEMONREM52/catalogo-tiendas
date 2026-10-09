/**
 * Manifest de la app principal RemHub (panel de la tienda y del equipo). Siempre con la identidad de RemHub.
 * ?start=… (opcional) solo acepta el panel o un enlace de acceso del equipo (/acceso/<tienda>?sid=…),
 * para que el trabajador que instala desde su enlace vuelva a abrir su pantalla de ingreso.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const USER = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
const DASH = /^\/dashboard(\/[a-z0-9_-]+){0,4}$/i;

function safeStart(raw: string | null) {
  if (!raw) return "/dashboard?source=pwa";
  try {
    const u = new URL(raw, "https://remhub.store");
    if (u.origin !== "https://remhub.store") return "/dashboard?source=pwa";
    if (DASH.test(u.pathname)) return `${u.pathname}?source=pwa`;
    const m = u.pathname.match(/^\/acceso\/([^/]+)$/);
    const sid = u.searchParams.get("sid") ?? "";
    if (m && SLUG.test(decodeURIComponent(m[1])) && UUID.test(sid)) {
      const out = new URLSearchParams({ sid, source: "pwa" });
      const usuario = u.searchParams.get("usuario");
      if (usuario && USER.test(usuario)) out.set("usuario", usuario);
      const next = u.searchParams.get("next");
      if (next && DASH.test(next)) out.set("next", next);
      return `/acceso/${m[1]}?${out.toString()}`;
    }
  } catch {
    /* inválido: panel */
  }
  return "/dashboard?source=pwa";
}

export async function GET(request: Request) {
  const start = safeStart(new URL(request.url).searchParams.get("start"));
  const manifest = {
    id: "/",
    name: "RemHub",
    short_name: "RemHub",
    description: "Catálogos online, ventas, inventario, pedidos y facturación para tu tienda y tus puntos de venta.",
    lang: "es-CO",
    dir: "ltr",
    start_url: start,
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    categories: ["business", "shopping", "productivity"],
    icons: [
      { src: "/icons/remhub-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/remhub-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/remhub-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/remhub-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "POS / Facturar", short_name: "POS", url: "/dashboard/pos?source=pwa", icons: [{ src: "/icons/remhub-192.png", sizes: "192x192" }] },
      { name: "Pedidos", short_name: "Pedidos", url: "/dashboard/pedidos?source=pwa", icons: [{ src: "/icons/remhub-192.png", sizes: "192x192" }] },
      { name: "Productos", short_name: "Productos", url: "/dashboard/products?source=pwa", icons: [{ src: "/icons/remhub-192.png", sizes: "192x192" }] },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
