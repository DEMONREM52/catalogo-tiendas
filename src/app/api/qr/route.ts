import QRCode from "qrcode";
import { PRODUCTION_ORIGIN } from "@/lib/share/identity";
import { PRODUCTION_HOST } from "@/lib/share/origin";

/**
 * Código QR de una página de RemHub. Siempre apunta al dominio de producción (https://remhub.co):
 * solo recibe la ruta (ej. /instalar o /mi-tienda/detal), nunca un dominio, localhost ni una IP.
 *   /api/qr?path=/instalar&format=svg|png&size=512
 * También ?url=https://tienda.remhub.co/z (solo el subdominio de una tienda en RemHub).
 */
export const runtime = "nodejs";

function safePath(raw: string | null) {
  const p = (raw ?? "/instalar").trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.length > 400 || /[\s<>"'\\]/.test(p)) return null;
  // Los QR no llevan datos de acceso del equipo ni contraseñas.
  const url = new URL(p, PRODUCTION_ORIGIN);
  if (url.origin !== PRODUCTION_ORIGIN) return null;
  for (const k of ["password", "clave", "token", "access_token", "refresh_token"]) url.searchParams.delete(k);
  return url.toString();
}

/** Dirección del espacio de una tienda (https://lavitrina.remhub.co/…): nunca otro dominio. */
function safeStoreUrl(raw: string | null) {
  if (!raw || raw.length > 400) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.port || url.username || !url.hostname.endsWith("." + PRODUCTION_HOST)) return null;
    for (const k of ["password", "clave", "token", "access_token", "refresh_token"]) url.searchParams.delete(k);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.has("url") ? safeStoreUrl(params.get("url")) : safePath(params.get("path"));
  if (!target) return new Response("Ruta no válida", { status: 400 });
  const size = Math.min(Math.max(Number(params.get("size")) || 512, 128), 1024);
  const options = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#0b0b0b", light: "#ffffff" } };

  if (params.get("format") === "png") {
    const png = await QRCode.toBuffer(target, { ...options, width: size, type: "png" });
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        ...(params.get("download") ? { "Content-Disposition": `attachment; filename="qr-remhub.png"` } : {}),
      },
    });
  }
  const svg = await QRCode.toString(target, { ...options, type: "svg", width: size });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
