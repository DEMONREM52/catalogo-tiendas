import { ImageResponse } from "next/og";
import { REMHUB_IDENTITY, fetchImageAsPng, resolveCatalogIdentity, resolvePointIdentity, type PublicIdentity } from "@/lib/share/identity";
import { PREVIEW_LABELS, isPreviewLabel } from "@/lib/share/link-preview";

/**
 * Imagen de vista previa (1200×1200, cuadrada) para los enlaces que se comparten (WhatsApp, Facebook…).
 *   /api/og                              → tarjeta de RemHub (enlaces generales, accesos, comprobantes)
 *   /api/og?store=<slug>&mode=detal      → logo de la tienda
 *   /api/og?store=<slug>&catalog=<slug>  → logo del punto del catálogo (o del catálogo / de la tienda)
 *   /api/og?store=<slug>&point=<uuid>    → logo del punto o bodega (o de la tienda), para sus documentos
 *   …&label=<clave>                      → etiqueta debajo del logo (PEDIDO, FACTURA ELECTRÓNICA…; lista cerrada)
 */
export const runtime = "nodejs";

const W = 1200;
const H = 1200;

const dataUrl = (png: Buffer | null) => (png ? `data:image/png;base64,${png.toString("base64")}` : null);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = url.searchParams.get("store");
  const mode = url.searchParams.get("catalog") ?? url.searchParams.get("mode");

  const point = url.searchParams.get("point");
  const labelKey = url.searchParams.get("label");
  const label = isPreviewLabel(labelKey) ? PREVIEW_LABELS[labelKey] : null;
  const identity: PublicIdentity =
    (store && point ? await resolvePointIdentity(store, point) : null) ?? (store ? await resolveCatalogIdentity(store, mode) : null) ?? REMHUB_IDENTITY;
  const brand = identity.kind === "remhub";

  const remhub = dataUrl(await fetchImageAsPng(`${url.origin}/remhub-icon-512.png`, 512));
  const full = dataUrl(await fetchImageAsPng(`${url.origin}/remhub-logo.png`, 960));
  // Logo de la tienda o del punto. Sin logo propio: sus iniciales y su nombre (el de RemHub es blanco y no se vería en la tarjeta).
  const own = brand ? null : dataUrl(await fetchImageAsPng(identity.logoUrl, 840));
  const initials = identity.name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "R";
  const card = label ? 840 : 960;
  const brandImg = full ?? remhub;

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
          background: "linear-gradient(160deg, #0b0716 0%, #1a0b33 55%, #2b0f3f 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          overflow: "hidden",
          padding: 60,
        }}
      >
        <div style={{ position: "absolute", top: -220, right: -200, width: 760, height: 760, borderRadius: 9999, background: "radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0) 70%)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: -260, left: -220, width: 760, height: 760, borderRadius: 9999, background: "radial-gradient(circle, rgba(236,72,153,0.32) 0%, rgba(236,72,153,0) 70%)", display: "flex" }} />
        {brand ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          brandImg ? <img src={brandImg} width={card} height={card} style={{ objectFit: "contain" }} /> : null
        ) : (
          <div style={{ width: card, height: card, borderRadius: 120, background: "#ffffff", boxShadow: "0 40px 100px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {own ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
              <img src={own} width={card - 120} height={card - 120} style={{ objectFit: "contain", borderRadius: 60 }} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: 380, height: 380, borderRadius: 9999, background: "linear-gradient(135deg, #8b5cf6, #ec4899)", color: "#fff", fontSize: 170, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials}</div>
                <div style={{ marginTop: 40, color: "#1a0b33", fontSize: 64, fontWeight: 800, maxWidth: card - 100, textAlign: "center", display: "flex" }}>{identity.name.slice(0, 40)}</div>
              </div>
            )}
          </div>
        )}
        {label ? (
          <div style={{ marginTop: 36, display: "flex", alignItems: "center", padding: "18px 48px", borderRadius: 9999, background: "linear-gradient(90deg, #ec4899, #8b5cf6)", color: "#fff", fontSize: 56, fontWeight: 800, letterSpacing: 3, boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }}>{label}</div>
        ) : null}
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
