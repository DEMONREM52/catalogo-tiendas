// Crear una landing desde el enlace de otra tienda (AliExpress, Amazon, Shopify, Mercado Libre…).
// Lee lo que la página publica para buscadores y redes: datos de producto (JSON-LD), Open Graph
// y, en tiendas Shopify, su archivo .js del producto. Nunca inventa: si algo no está, queda vacío.

export type ImportedProduct = {
  title: string;
  description: string;
  bullets: string[];
  images: string[];
  price: number | null;
  currency: string | null;
  video: string | null;
  source: string;
  options: string[];
};

const decode = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
export const stripHtml = (html: string) => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

function meta(html: string, key: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  return tag ? decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "").trim() : "";
}

const absolute = (u: string, base: string) => {
  try {
    const url = new URL(u.startsWith("//") ? `https:${u}` : u, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().replace(/^http:/, "https:") : null;
  } catch {
    return null;
  }
};

/** Bloques JSON-LD de tipo Product (también dentro de @graph). */
function jsonLdProducts(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim()) as unknown;
      const walk = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          const t = o["@type"];
          if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(o);
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(data);
    } catch {
      /* JSON mal formado: se ignora */
    }
  }
  return out;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const imgOf = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl ?? "") : "");

/** Lee una página de producto (HTML) y saca lo que publica. `shopify` es el .js del producto si es una tienda Shopify. */
export function parseProductPage(html: string, url: string, shopify?: Record<string, unknown> | null): ImportedProduct {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const out: ImportedProduct = { title: "", description: "", bullets: [], images: [], price: null, currency: null, video: null, source: host, options: [] };
  const addImg = (u: string) => {
    if (!u || !u.trim()) return;
    const a = absolute(u.trim(), url);
    if (a && !/\.(svg|gif)(\?|$)/i.test(a) && !/sprite|logo|icon|favicon|placeholder|blank/i.test(a) && !out.images.includes(a)) out.images.push(a);
  };

  if (shopify) {
    out.title = String(shopify.title ?? "");
    const body = String(shopify.description ?? shopify.body_html ?? "");
    out.description = stripHtml(body);
    out.bullets = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripHtml(m[1])).filter((x) => x.length > 2 && x.length < 160);
    for (const i of asList(shopify.images)) addImg(imgOf(i));
    const p = Number(shopify.price);
    // El .js de Shopify trae el precio en centavos.
    if (p > 0) { out.price = p / 100; out.currency = null; }
    out.options = asList(shopify.variants).map((v) => String((v as Record<string, unknown>).title ?? "")).filter((t) => t && t !== "Default Title").slice(0, 30);
  }

  for (const p of jsonLdProducts(html)) {
    if (!out.title && typeof p.name === "string") out.title = decode(p.name);
    if (!out.description && typeof p.description === "string") out.description = stripHtml(p.description);
    for (const i of asList(p.image)) addImg(imgOf(i));
    for (const o of asList(p.offers)) {
      const offer = o as Record<string, unknown>;
      const price = Number(offer.price ?? offer.lowPrice);
      if (!out.price && price > 0) { out.price = price; out.currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : null; }
    }
    const v = asList(p.video)[0] as Record<string, unknown> | undefined;
    if (!out.video && v && typeof v.contentUrl === "string") out.video = v.contentUrl;
  }

  if (!out.title) out.title = meta(html, "og:title") || meta(html, "twitter:title") || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  if (!out.description) out.description = meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description");
  addImg(meta(html, "og:image"));
  addImg(meta(html, "og:image:secure_url"));
  addImg(meta(html, "twitter:image"));
  if (!out.price) {
    const p = Number(meta(html, "product:price:amount") || meta(html, "og:price:amount"));
    if (p > 0) { out.price = p; out.currency = meta(html, "product:price:currency") || meta(html, "og:price:currency") || null; }
  }
  if (!out.video) {
    const v = meta(html, "og:video:secure_url") || meta(html, "og:video");
    if (/^https:/.test(v)) out.video = v;
  }

  // Amazon: viñetas de características y fotos grandes.
  if (/amazon\./i.test(host)) {
    const box = /id=["']feature-bullets["'][\s\S]*?<\/ul>/i.exec(html)?.[0] ?? "";
    out.bullets = out.bullets.length ? out.bullets : [...box.matchAll(/<span class=["']a-list-item["'][^>]*>([\s\S]*?)<\/span>/gi)].map((m) => stripHtml(m[1])).filter((x) => x.length > 3);
    for (const m of html.matchAll(/"hiRes":"(https:[^"]+)"/g)) addImg(m[1]);
  }
  // AliExpress / Temu / Shein y otras: listas de imágenes dentro del código de la página.
  for (const m of html.matchAll(/"(?:imagePathList|images|imageList)"\s*:\s*\[([^\]]{10,6000})\]/g)) {
    for (const u of m[1].matchAll(/"((?:https?:)?\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) addImg(u[1].replace(/\\u002F/g, "/"));
  }
  // Último recurso: imágenes grandes del cuerpo.
  if (out.images.length < 3) {
    for (const m of html.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)) {
      if (out.images.length >= 12) break;
      addImg(m[1]);
    }
  }

  out.title = out.title.replace(/\s*[|–-]\s*(AliExpress|Amazon\.?[a-z.]*|Mercado Libre|Shein|Temu).*$/i, "").replace(/\s+/g, " ").trim().slice(0, 140);
  out.description = out.description.slice(0, 3000);
  out.bullets = [...new Set(out.bullets)].slice(0, 8).map((b) => b.slice(0, 160));
  out.images = out.images.slice(0, 15);
  return out;
}

/** Bloquea direcciones internas (para que nadie use el lector para entrar a redes privadas). */
export function isPrivateHost(hostname: string, ip?: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return true;
  const a = ip ?? (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? h : "");
  if (a) {
    const [x, y] = a.split(".").map(Number);
    if (x === 10 || x === 127 || x === 0 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224) return true;
  }
  if (ip && ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v === "::" || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.")) return true;
  }
  return false;
}
