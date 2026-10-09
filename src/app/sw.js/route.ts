/**
 * Service Worker de RemHub (una sola versión por despliegue, así el navegador detecta las actualizaciones).
 *
 * Estrategia conservadora:
 *   · Guarda en caché SOLO archivos estáticos con versión (/_next/static), iconos y la página «sin conexión».
 *   · Las páginas siempre se piden a internet; sin conexión se muestra /offline (sin datos de nadie).
 *   · Nunca guarda el panel, la API, datos de clientes, facturas, sesiones ni nada de Supabase.
 *   · Solo borra sus propias cachés antiguas («remhub-…»); no toca nada más del navegador.
 */
export const dynamic = "force-dynamic";

const VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 16) ||
  process.env.NEXT_PUBLIC_APP_VERSION ||
  "dev";

const SW = (version: string) => `/* RemHub SW ${version} */
const VERSION = ${JSON.stringify(version)};
const STATIC_CACHE = "remhub-static-" + VERSION;
const PRECACHE = ["/offline", "/icons/remhub-192.png", "/icons/remhub-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined)
  );
  // No se activa solo: la app pregunta al usuario «Actualizar» (evita recargas en medio de una venta).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("remhub-") && k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /^\\/remhub-icon-\\d+\\.png$/.test(url.pathname) ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, pagos, CDNs: siempre directo.

  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Páginas: siempre de internet (nunca se guardan). Sin conexión: aviso amable.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/offline")) || new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
    );
  }
  // Todo lo demás (API, datos, imágenes de productos…): el navegador lo maneja normal, sin caché del SW.
});
`;

export async function GET() {
  return new Response(SW(VERSION), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // El navegador debe revisar siempre si hay una versión nueva.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
