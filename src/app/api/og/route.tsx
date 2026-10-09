import { ImageResponse } from "next/og";
import { REMHUB_IDENTITY, fetchImageAsPng, resolveCatalogIdentity, type PublicIdentity } from "@/lib/share/identity";

/**
 * Imagen de vista previa (1200×630) para los enlaces que se comparten (WhatsApp, Facebook…).
 *   /api/og                              → tarjeta de RemHub (enlaces generales, accesos, comprobantes)
 *   /api/og?store=<slug>&mode=detal      → logo de la tienda
 *   /api/og?store=<slug>&catalog=<slug>  → logo del punto del catálogo (o del catálogo / de la tienda)
 */
export const runtime = "nodejs";

const W = 1200;
const H = 630;

const dataUrl = (png: Buffer | null) => (png ? `data:image/png;base64,${png.toString("base64")}` : null);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = url.searchParams.get("store");
  const mode = url.searchParams.get("catalog") ?? url.searchParams.get("mode");

  const identity: PublicIdentity = (store ? await resolveCatalogIdentity(store, mode) : null) ?? REMHUB_IDENTITY;
  const brand = identity.kind === "remhub";

  const remhub = dataUrl(await fetchImageAsPng(`${url.origin}/remhub-icon-512.png`, 512));
  const logo = (brand ? null : dataUrl(await fetchImageAsPng(identity.logoUrl, 440))) ?? remhub;
  const title = identity.name.length > 38 ? `${identity.name.slice(0, 36)}…` : identity.name;
  const subtitle = identity.subtitle.length > 90 ? `${identity.subtitle.slice(0, 88)}…` : identity.subtitle;

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #0b0716 0%, #1a0b33 55%, #2b0f3f 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -180, right: -120, width: 620, height: 620, borderRadius: 9999, background: "radial-gradient(circle, rgba(168,85,247,0.55) 0%, rgba(168,85,247,0) 70%)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: -240, left: -160, width: 640, height: 640, borderRadius: 9999, background: "radial-gradient(circle, rgba(236,72,153,0.38) 0%, rgba(236,72,153,0) 70%)", display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", width: "100%", height: "100%", padding: "0 80px", gap: 64, position: "relative" }}>
          <div
            style={{
              width: 400,
              height: 400,
              borderRadius: 56,
              background: brand ? "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))" : "#ffffff",
              border: "2px solid rgba(255,255,255,0.18)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
              <img src={logo} width={brand ? 320 : 330} height={brand ? 320 : 330} style={{ objectFit: "contain", borderRadius: brand ? 64 : 24 }} />
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            {identity.badge ? (
              <div style={{ display: "flex", alignSelf: "flex-start", padding: "8px 18px", borderRadius: 999, background: "rgba(168,85,247,0.28)", border: "1px solid rgba(216,180,254,0.45)", fontSize: 24, fontWeight: 700, letterSpacing: 2, marginBottom: 22 }}>
                {identity.badge.toUpperCase()}
              </div>
            ) : null}
            <div style={{ display: "flex", fontSize: title.length > 22 ? 64 : 80, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{title}</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 32, lineHeight: 1.35, color: "rgba(255,255,255,0.78)" }}>{subtitle}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 48 }}>
              {remhub && !brand ? (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                <img src={remhub} width={44} height={44} style={{ borderRadius: 12 }} />
              ) : null}
              <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>remhub.store</div>
            </div>
          </div>
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
