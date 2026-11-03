// Medición en el navegador para las landings: de dónde llegó la visita (utm, fbclid, ttclid, gclid),
// un identificador anónimo de la visita y los píxeles propios de la landing (Meta y TikTok).
// El píxel de la tienda y GTM ya los maneja src/lib/tracking.ts; aquí solo se suman los de la landing.

import { currentTraffic, trafficPixelParams } from "@/lib/traffic-source";

type Fbq = (...args: unknown[]) => void;
type Ttq = { load: (id: string) => void; page: () => void; track: (event: string, params?: Record<string, unknown>, opts?: Record<string, unknown>) => void; instance?: (id: string) => Ttq };
type W = Window & { fbq?: Fbq; ttq?: Ttq; __landingPixels?: { meta: string; tiktok: string }; __remhubPixel?: { meta_pixel_id?: string } | null };

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function landingSession(): string {
  const make = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return safe(() => {
    const key = "remhub-lp-session";
    const saved = window.localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    const id = make();
    window.localStorage.setItem(key, id);
    return id;
  }, make());
}

export type LandingRef = { source?: string; medium?: string; campaign?: string; content?: string; device?: string };

/**
 * De dónde viene la visita, con un solo enlace: utm (si hay), marcas de anuncios, la app donde se abrió y la página
 * de origen (ver lib/traffic-source). Se recuerda 30 días para atribuir compras posteriores.
 */
export function landingRef(): LandingRef {
  const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : /iPad|Tablet/i.test(navigator.userAgent) ? "tablet" : "desktop";
  const t = currentTraffic();
  if (t.source === "directo") return { device };
  return { source: t.source, medium: t.medium, campaign: t.campaign, content: t.content, device };
}

/** Cookies de Meta (_fbp, _fbc) para la API de Conversiones. Si llegó por un anuncio y aún no hay _fbc, se arma con fbclid. */
export function metaCookies() {
  const read = (name: string) => safe(() => document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null, null);
  const fbclid = new URLSearchParams(window.location.search).get("fbclid");
  return { fbp: read("_fbp"), fbc: read("_fbc") ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : null) };
}

/**
 * Carga los píxeles propios de la landing (si los tiene).
 * El píxel de la tienda lo registra StorePixel (en el layout) en un efecto del padre, que React corre
 * DESPUÉS de los efectos de la landing: se espera a que termine esa ronda para saber si es el mismo píxel.
 */
export function loadLandingPixels(metaId: string, tiktokId: string) {
  queueMicrotask(() => loadPixelsNow(metaId, tiktokId));
}

function loadPixelsNow(metaId: string, tiktokId: string) {
  const w = window as W;
  // Si el píxel propio es el mismo de la tienda, no se carga otra vez (cada evento llegaría doble).
  if (metaId && w.__remhubPixel?.meta_pixel_id === metaId) metaId = "";
  w.__landingPixels = { meta: metaId, tiktok: tiktokId };
  if (metaId) {
    if (!w.fbq) {
      /* eslint-disable */
      // Código oficial del píxel de Meta (base).
      (function (f: any, b: Document, e: string, v: string) {
        if (f.fbq) return;
        const n: any = (f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
        const t = b.createElement(e) as HTMLScriptElement; t.async = true; t.src = v;
        const s = b.getElementsByTagName(e)[0]; s.parentNode?.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      /* eslint-enable */
    }
    safe(() => { w.fbq?.("init", metaId); w.fbq?.("trackSingle", metaId, "PageView", trafficPixelParams()); }, undefined);
  }
  if (tiktokId && !w.ttq) {
    /* eslint-disable */
    // Código oficial del píxel de TikTok (base).
    (function (wi: any, d: Document, t: string) {
      wi.TiktokAnalyticsObject = t; const ttq = (wi[t] = wi[t] || []);
      ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
      ttq.setAndDefer = function (o: any, m: string) { o[m] = function () { o.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
      for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (id: string) { const e = ttq._i[id] || []; for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
      ttq.load = function (id: string, n?: any) {
        const r = "https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = r; ttq._t = ttq._t || {}; ttq._t[id] = +new Date(); ttq._o = ttq._o || {}; ttq._o[id] = n || {};
        const s = d.createElement("script"); s.type = "text/javascript"; s.async = true; s.src = r + "?sdkid=" + id + "&lib=" + t;
        const a = d.getElementsByTagName("script")[0]; a.parentNode?.insertBefore(s, a);
      };
      ttq.load(tiktokId); ttq.page();
    })(window, document, "ttq");
    /* eslint-enable */
  }
}

const TIKTOK_EVENT: Record<string, string> = { ViewContent: "ViewContent", AddToCart: "AddToCart", InitiateCheckout: "InitiateCheckout", AddPaymentInfo: "AddPaymentInfo", Purchase: "PlaceAnOrder", Lead: "SubmitForm", Contact: "Contact" };

/** Evento a los píxeles propios de la landing (el de la tienda va por src/lib/tracking.ts). */
export function landingPixelEvent(event: string, params: Record<string, unknown>, eventId?: string) {
  const w = window as W;
  const ids = w.__landingPixels;
  if (!ids) return;
  // Si es el mismo píxel de la tienda, el evento ya le llega por src/lib/tracking.ts: no se manda doble.
  if (ids.meta && ids.meta !== w.__remhubPixel?.meta_pixel_id) safe(() => w.fbq?.("trackSingle", ids.meta, event, { ...trafficPixelParams(), ...params }, eventId ? { eventID: eventId } : undefined), undefined);
  if (ids.tiktok && TIKTOK_EVENT[event]) {
    safe(() => w.ttq?.track(TIKTOK_EVENT[event], {
      value: params.value, currency: "COP", content_type: "product",
      contents: Array.isArray(params.content_ids) ? (params.content_ids as string[]).map((id) => ({ content_id: id })) : undefined,
    }, eventId ? { event_id: eventId } : undefined), undefined);
  }
}
