import QRCode from "qrcode";
import { PRODUCTION_ORIGIN } from "@/lib/share/identity";

/**
 * Código QR de una página de RemHub. Siempre apunta al dominio de producción (https://remhub.store):
 * solo recibe la ruta (ej. /instalar o /mi-tienda/detal), nunca un dominio, localhost ni una IP.
 *   /api/qr?path=/instalar&format=svg|png&size=512
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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = safePath(params.get("path"));
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
