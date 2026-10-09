import { ImageResponse } from "next/og";
import { REMHUB_IDENTITY, fetchImageAsPng, resolveCatalogIdentity, type PublicIdentity } from "@/lib/share/identity";

/**
 * Imagen de vista previa (1200×1200, cuadrada) para los enlaces que se comparten (WhatsApp, Facebook…).
 *   /api/og                              → tarjeta de RemHub (enlaces generales, accesos, comprobantes)
 *   /api/og?store=<slug>&mode=detal      → logo de la tienda
 *   /api/og?store=<slug>&catalog=<slug>  → logo del punto del catálogo (o del catálogo / de la tienda)
 */
export const runtime = "nodejs";

const W = 1200;
const H = 1200;

const dataUrl = (png: Buffer | null) => (png ? `data:image/png;base64,${png.toString("base64")}` : null);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = url.searchParams.get("store");
  const mode = url.searchParams.get("catalog") ?? url.searchParams.get("mode");

  const identity: PublicIdentity = (store ? await resolveCatalogIdentity(store, mode) : null) ?? REMHUB_IDENTITY;
  const brand = identity.kind === "remhub";

  const remhub = dataUrl(await fetchImageAsPng(`${url.origin}/remhub-icon-512.png`, 512));
  const full = dataUrl(await fetchImageAsPng(`${url.origin}/remhub-logo.png`, 960));
  const logo = (brand ? full : dataUrl(await fetchImageAsPng(identity.logoUrl, 840))) ?? full ?? remhub;

  // Cuadrada: WhatsApp muestra la vista previa como un cuadrito y recorta las imágenes anchas.
  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: brand ? "#262626" : "linear-gradient(160deg, #0b0716 0%, #1a0b33 55%, #2b0f3f 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          overflow: "hidden",
          padding: 70,
        }}
      >
        <div style={{ position: "absolute", top: -220, right: -200, width: 760, height: 760, borderRadius: 9999, background: "radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0) 70%)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: -260, left: -220, width: 760, height: 760, borderRadius: 9999, background: "radial-gradient(circle, rgba(236,72,153,0.32) 0%, rgba(236,72,153,0) 70%)", display: "flex" }} />
        {/* Solo el logo, grande y completo (WhatsApp muestra la vista previa como un cuadrito). */}
        <div
          style={{
            width: 960,
            height: 960,
            borderRadius: 120,
            background: brand ? "transparent" : "#ffffff",
            boxShadow: brand ? "none" : "0 40px 100px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={logo} width={brand ? 960 : 840} height={brand ? 960 : 840} style={{ objectFit: "contain", borderRadius: brand ? 0 : 60 }} />
          ) : null}
        </div>
      </div>
    ),
    { width: W, height: H },
  );

  // JPG liviano: WhatsApp no muestra vistas previas muy pesadas (más de ~300 KB).
  const sharp = (await import("sharp")).default;
  const jpg = await sharp(Buffer.from(await image.arrayBuffer())).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
