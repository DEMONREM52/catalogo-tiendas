/**
 * ¿De dónde viene la visita? Con UN solo enlace, sin utm por cada red.
 *
 * Pistas, de la más segura a la menos:
 *   1. utm_* del enlace (si se usaron), incluidos los parámetros dinámicos de Meta: {{site_source_name}} = fb | ig | msg | an.
 *   2. Marcas que agregan los anuncios: gclid/gbraid/wbraid (Google Ads), ttclid (TikTok Ads), msclkid (Microsoft Ads).
 *   3. La app donde se abrió: Facebook, Instagram, TikTok, Snapchat, LinkedIn, Pinterest… abren los enlaces en su
 *      navegador interno, que se identifica en el user agent (aunque no manden la página de origen).
 *   4. La página de origen (document.referrer): google, youtube, l.facebook.com, t.co…
 *   5. fbclid sin más pistas: Facebook (Meta lo agrega a todos los clics, de anuncio o no).
 * WhatsApp no deja huella: abre el navegador normal sin página de origen, así que llega como «directo».
 *
 * La fuente se recuerda 30 días en este navegador (último origen que no fue directo), para que una compra
 * posterior se atribuya a donde llegó la persona. Se guarda solo en este navegador, por tienda (cada tienda
 * tiene su subdominio), y no lleva datos personales.
 */

export type Traffic = {
  source: string; // facebook, instagram, tiktok, google, youtube, whatsapp, directo…
  medium: string; // paid, social, search, video, referral, direct
  campaign?: string;
  content?: string;
  /** Cómo se supo (para la página de estadísticas). */
  how: "utm" | "anuncio" | "app" | "referencia" | "directo" | "recordado";
};

const ALIASES: Record<string, string> = { fb: "facebook", ig: "instagram", msg: "messenger", an: "audience_network", wa: "whatsapp", tt: "tiktok", yt: "youtube" };
const KEY = "remhub-traffic";
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

const clean = (v: string | null | undefined) => (v ? v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 60) : undefined);

/** Navegador interno de una app (por su user agent). */
export function appFromUserAgent(ua: string): string | undefined {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return "facebook";
  if (/musical_ly|BytedanceWebview|TikTok|trill_/i.test(ua)) return "tiktok";
  if (/Snapchat/i.test(ua)) return "snapchat";
  if (/LinkedInApp/i.test(ua)) return "linkedin";
  if (/Pinterest/i.test(ua)) return "pinterest";
  if (/Twitter|XApp/i.test(ua)) return "x";
  if (/Line\//i.test(ua)) return "line";
  return undefined;
}

/** Fuente por la página de origen. */
export function sourceFromReferrer(ref: string, ownHost: string): { source: string; medium: string } | undefined {
  if (!ref) return undefined;
  let host = "";
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return undefined; }
  if (!host || host === ownHost) return undefined;
  if (/(^|\.)instagram\.com$/.test(host)) return { source: "instagram", medium: "social" };
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) return { source: "facebook", medium: "social" };
  if (/(^|\.)tiktok\.com$/.test(host)) return { source: "tiktok", medium: "social" };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { source: "youtube", medium: "video" };
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(host)) return { source: "whatsapp", medium: "social" };
  if (/(^|\.)(t\.co|twitter\.com|x\.com)$/.test(host)) return { source: "x", medium: "social" };
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return { source: "google", medium: "search" };
  if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com)$/.test(host)) return { source: host.split(".").slice(-2)[0], medium: "search" };
  if (/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/.test(host)) return { source: "pinterest", medium: "social" };
  if (/(^|\.)linkedin\.com$/.test(host)) return { source: "linkedin", medium: "social" };
  if (/(^|\.)remhub\.(co|store)$/.test(host)) return undefined; // dentro de RemHub (catálogo ↔ landing)
  return { source: host.replace(/^www\./, "").slice(0, 60), medium: "referral" };
}

/** Lo que dice esta visita (sin mirar lo recordado). Exportada para las pruebas. */
export function detectTraffic(search: string, referrer: string, userAgent: string, ownHost: string): Traffic {
  const q = new URLSearchParams(search);
  const utmSource = clean(q.get("utm_source"));
  const campaign = clean(q.get("utm_campaign"));
  const content = clean(q.get("utm_content"));
  if (utmSource) {
    const source = ALIASES[utmSource] ?? utmSource;
    const medium = clean(q.get("utm_medium")) ?? (q.get("fbclid") || q.get("gclid") || q.get("ttclid") ? "paid" : "social");
    return { source, medium, campaign, content, how: "utm" };
  }
  if (q.get("gclid") || q.get("gbraid") || q.get("wbraid")) return { source: "google", medium: "paid", campaign, content, how: "anuncio" };
  if (q.get("ttclid")) return { source: "tiktok", medium: "paid", campaign, content, how: "anuncio" };
  if (q.get("msclkid")) return { source: "bing", medium: "paid", campaign, content, how: "anuncio" };
  const app = appFromUserAgent(userAgent);
  if (app) return { source: app, medium: "social", campaign, content, how: "app" };
  const byRef = sourceFromReferrer(referrer, ownHost);
  if (byRef) return { ...byRef, campaign, content, how: "referencia" };
  if (q.get("fbclid")) return { source: "facebook", medium: "social", campaign, content, how: "anuncio" };
  return { source: "directo", medium: "direct", campaign, content, how: "directo" };
}

let cached: Traffic | null = null;

/** De dónde viene esta visita, recordando 30 días el último origen que no fue «directo». */
export function currentTraffic(): Traffic {
  if (cached) return cached;
  if (typeof window === "undefined") return { source: "directo", medium: "direct", how: "directo" };
  const now = detectTraffic(window.location.search, document.referrer, navigator.userAgent, window.location.hostname);
  try {
    if (now.how !== "directo") {
      window.localStorage.setItem(KEY, JSON.stringify({ ...now, at: Date.now() }));
      cached = now;
    } else {
      const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as (Traffic & { at?: number }) | null;
      cached = saved && saved.at && Date.now() - saved.at < DAYS_30
        ? { source: saved.source, medium: saved.medium, campaign: saved.campaign, content: saved.content, how: "recordado" }
        : now;
    }
  } catch {
    cached = now;
  }
  return cached;
}

/** Para los eventos del píxel de Meta (se ven en el Administrador de eventos y sirven para conversiones personalizadas). */
export function trafficPixelParams(): Record<string, string> {
  const t = currentTraffic();
  const out: Record<string, string> = { traffic_source: t.source, traffic_medium: t.medium };
  if (t.campaign) out.traffic_campaign = t.campaign;
  if (t.content) out.traffic_content = t.content;
  return out;
}

// Listo antes de que corra el código del píxel (lo usa el PageView del script del píxel).
if (typeof window !== "undefined") {
  try { (window as Window & { __remhubTraffic?: Record<string, string> }).__remhubTraffic = trafficPixelParams(); } catch { /* sin almacenamiento */ }
}
