/**
 * Service Worker de RemHub (una sola versión por despliegue, así el navegador detecta las actualizaciones).
 *
 * Estrategia conservadora:
 *   · Guarda en caché SOLO archivos estáticos con versión (/_next/static), iconos y la página «sin conexión».
 *   · Las páginas siempre se piden a internet; sin conexión se muestra /offline (sin datos de nadie),
 *     salvo el armazón de /dashboard y /dashboard/pos (última copia), para seguir vendiendo con borradores.
 *   · Nunca guarda la API, datos de clientes, facturas, sesiones ni nada de Supabase.
 *     (Los datos de trabajo del POS los guarda la app en el equipo y se borran al cerrar sesión.)
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
// Páginas que abren sin conexión (solo el armazón de la página: los datos los guarda la app en el equipo).
const PAGES_CACHE = "remhub-pages-" + VERSION;
const OFFLINE_PAGES = ["/dashboard", "/dashboard/pos"];
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

  // Páginas: siempre de internet. Sin conexión: el POS (y el inicio del panel) abren desde la última copia
  // para seguir vendiendo con borradores; el resto muestra el aviso amable.
  if (req.mode === "navigate") {
    const keep = OFFLINE_PAGES.includes(url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (keep && res.ok && res.type === "basic" && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((cache) => cache.put(url.pathname, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () =>
          (keep && (await caches.match(url.pathname, { cacheName: PAGES_CACHE }))) ||
          (await caches.match("/offline")) ||
          new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        )
    );
  }
  // Todo lo demás (API, datos, imágenes de productos…): el navegador lo maneja normal, sin caché del SW.
});

// ---- Notificaciones del celular (pedidos internos) ----
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "RemHub", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "RemHub";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/remhub-192.png",
    badge: "/icons/remhub-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.urgent),
    vibrate: data.urgent ? [120, 60, 120, 60, 220] : [90, 50, 90],
    timestamp: Date.now(),
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/dashboard/pedidos?tab=internos" },
  };
  event.waitUntil(
    (async () => {
      // Si la app está abierta y visible, ella misma suena con el tono elegido; se avisa igual por si acaso.
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      list.forEach((c) => c.postMessage({ type: "REMHUB_PUSH", payload: data }));
      if (list.some((c) => c.visibilityState === "visible" && c.focused)) return;
      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard/pedidos?tab=internos", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        try {
          await same.navigate(target);
        } catch (e) {
          same.postMessage({ type: "REMHUB_OPEN", url: target });
        }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
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
