import { fetchImageAsPng, resolveCatalogIdentity } from "@/lib/share/identity";

/**
 * Icono de un catálogo para instalarlo en el celular (pantalla de inicio).
 *   /api/pwa-icon?store=<slug>&mode=<detal|mayor|catalogo>&size=192|512|180&purpose=any|maskable
 * El logo se toma de la base de datos (nunca de un parámetro). Sin logo: icono neutral con las iniciales.
 */
export const runtime = "nodejs";

const SIZES = new Set([180, 192, 512]);

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !/^(la|el|los|las|de|del|y)$/i.test(w));
  const pick = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)) || "?";
  return pick.toUpperCase();
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);

/** Icono de respaldo neutral (no usa la identidad de ninguna otra tienda). */
function fallbackSvg(size: number, name: string) {
  const text = escapeXml(initials(name));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <text x="256" y="300" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="190" font-weight="700" fill="#ffffff">${text}</text>
  </svg>`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = url.searchParams.get("store") ?? "";
  const mode = url.searchParams.get("mode");
  const size = SIZES.has(Number(url.searchParams.get("size"))) ? Number(url.searchParams.get("size")) : 512;
  const maskable = url.searchParams.get("purpose") === "maskable";

  const sharp = (await import("sharp")).default;
  const identity = store ? await resolveCatalogIdentity(store, mode) : null;
  if (!identity) {
    return new Response("Catálogo no encontrado", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  }

  // Zona segura: «maskable» necesita margen porque Android recorta el icono; iPhone (180) un margen pequeño.
  const scale = maskable ? 0.7 : size === 180 ? 0.84 : 0.9;
  const inner = Math.round(size * scale);
  const logo = await fetchImageAsPng(identity.logoUrl, inner);

  let png: Buffer;
  if (logo) {
    png = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: logo, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  } else {
    png = await sharp(fallbackSvg(size, identity.name)).resize(size, size).png().toBuffer();
  }

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Si cambian el logo, el icono nuevo se ve en máximo 1 día (las apps instaladas pueden tardar más).
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
