// Crear una landing desde un enlace (AliExpress, Amazon, Shopify…): lee la página desde el servidor
// y copia las fotos al almacenamiento de la tienda (así no dependen de la otra página).
import { lookup } from "node:dns/promises";
import { isUuid, jsonError, jsonOk, readJson, requirePermission, requireUser, FiscalApiError } from "@/lib/fiscal/server";
import { candidateUrls, isPrivateHost, looksBlocked, parseProductPage, type ImportedProduct } from "@/lib/landing/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HTML = 4 * 1024 * 1024;
const MAX_IMG = 3 * 1024 * 1024;

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FiscalApiError("El enlace debe empezar por https://", 422, "INVALID");
  if (url.port && !["80", "443"].includes(url.port)) throw new FiscalApiError("Ese enlace no se puede leer.", 422, "INVALID");
  if (isPrivateHost(url.hostname)) throw new FiscalApiError("Ese enlace no se puede leer.", 422, "INVALID");
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateHost(url.hostname, a.address))) throw new FiscalApiError("No encontramos esa página.", 422, "INVALID");
}

/** Descarga con redirecciones revisadas una por una, tiempo límite y tamaño máximo. */
async function safeFetch(raw: string, max: number, accept: string, extra: Record<string, string> = {}) {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "es-CO,es;q=0.9,en;q=0.7", ...extra } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
      if (!res.ok || !res.body) return { url, res: null as Response | null, body: null as Buffer | null };
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); break; }
        chunks.push(value);
      }
      return { url, res, body: Buffer.concat(chunks) };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new FiscalApiError("La página redirige demasiadas veces.", 422, "INVALID");
}

export async function POST(request: Request) {
  try {
    const ctx = await requireUser(request);
    // `html`: el código de la página pegado a mano (plan B cuando la tienda no deja leerla desde el servidor).
    const body = await readJson<{ store_id?: string; url?: string; html?: string; copy_images?: boolean }>(request, 4_500_000);
    if (!isUuid(body.store_id)) throw new FiscalApiError("Falta la tienda.", 400, "INVALID");
    await requirePermission(ctx, body.store_id, ["products"]);
    let target: URL;
    try { target = new URL(String(body.url ?? "").trim()); } catch { throw new FiscalApiError("Pega el enlace completo del producto (https://…).", 422, "INVALID"); }

    let product: ImportedProduct | null = null;
    let blocked = false;
    if (typeof body.html === "string" && body.html.trim().length > 200) {
      product = parseProductPage(body.html.slice(0, MAX_HTML), target.toString());
    } else {
      // Se prueban varias direcciones del mismo producto hasta encontrar sus datos.
      for (const c of candidateUrls(target.toString())) {
        const page = await safeFetch(c.url, MAX_HTML, "text/html,application/xhtml+xml", c.headers).catch(() => null);
        if (!page?.res || !page.body) continue;
        const html = page.body.toString("utf8");
        if (looksBlocked(html)) { blocked = true; continue; }
        // Tiendas Shopify: el producto completo está en /products/<nombre>.js
        let shopify: Record<string, unknown> | null = null;
        const m = /^(.*\/products\/[^/?#]+)/.exec(page.url.pathname);
        if (m && /shopify|cdn\.shopify\.com/i.test(html)) {
          const js = await safeFetch(`${page.url.origin}${m[1]}.js`, MAX_HTML, "application/json").catch(() => null);
          try { shopify = js?.body ? (JSON.parse(js.body.toString("utf8")) as Record<string, unknown>) : null; } catch { shopify = null; }
        }
        const p = parseProductPage(html, page.url.toString(), shopify);
        if (p.title || p.images.length) { product = p; break; }
      }
    }
    if (!product || (!product.title && !product.images.length)) {
      throw new FiscalApiError(blocked
        ? "Esa tienda no deja leer la página desde nuestro servidor (pide verificar que no es un robot). Usa «Pegar el código de la página», que siempre funciona."
        : "No encontramos datos de producto en esa página. Prueba con el enlace directo del producto o usa «Pegar el código de la página».", 422, blocked ? "BLOCKED" : "EMPTY");
    }

    // Copia de las fotos al almacenamiento de la tienda (las que se puedan; si alguna falla, queda el enlace original).
    if (body.copy_images !== false && product.images.length) {
      const admin = ctx.admin();
      const copied = await Promise.all(product.images.slice(0, 12).map(async (src, i) => {
        try {
          const img = await safeFetch(src, MAX_IMG, "image/avif,image/webp,image/*");
          const type = img.res?.headers.get("content-type") ?? "";
          if (!img.body || !/^image\/(jpeg|png|webp|avif)/.test(type) || img.body.length < 2000 || img.body.length >= MAX_IMG) return src;
          const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("avif") ? "avif" : "jpg";
          const path = `${ctx.userId}/landing/import-${Date.now()}-${i}.${ext}`;
          const { error } = await admin.storage.from("product-images").upload(path, img.body, { contentType: type, upsert: true, cacheControl: "31536000" });
          return error ? src : admin.storage.from("product-images").getPublicUrl(path).data.publicUrl;
        } catch {
          return src;
        }
      }));
      product.images = copied;
    }
    return jsonOk({ product });
  } catch (error) {
    return jsonError(error);
  }
}
