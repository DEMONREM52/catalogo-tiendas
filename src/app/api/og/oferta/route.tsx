/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from "next/og";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchImageAsPng, resolveCatalogIdentity } from "@/lib/share/identity";
import { fetchPublicDeals, fetchPublicItems } from "@/lib/catalog/public-prices";

/**
 * Imagen de oferta para estados de WhatsApp (20261313 · «Imagen de oferta»).
 *   /api/og/oferta?store=<slug>&product=<uuid>&catalog=<slug>&key=<clave>&format=story|square
 * Usa los precios públicos del catálogo (precio de antes tachado, el de ahora y el %), la foto del producto
 * y el logo del punto o de la tienda. Sin oferta muestra solo el precio.
 */
export const runtime = "nodejs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/i;
const UUID = /^[0-9a-f-]{36}$/i;
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const dataUrl = (png: Buffer | null) => (png ? `data:image/png;base64,${png.toString("base64")}` : null);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = (url.searchParams.get("store") ?? "").toLowerCase();
  const product = url.searchParams.get("product") ?? "";
  const catalog = (url.searchParams.get("catalog") ?? "detal").toLowerCase();
  const key = url.searchParams.get("key");
  const square = url.searchParams.get("format") === "square";
  if (!SLUG.test(store) || !UUID.test(product) || !SLUG.test(catalog)) return new Response("Enlace no válido", { status: 400 });

  const sb = supabaseServer();
  const { data: st } = await sb.from("stores").select("id,slug,name").eq("slug", store).maybeSingle();
  if (!st) return new Response("Tienda no encontrada", { status: 404 });
  const [items, deals, identity] = await Promise.all([
    fetchPublicItems(sb, { id: st.id as string, slug: st.slug as string }, catalog, key, [product]),
    fetchPublicDeals(sb, st.slug as string, catalog, key).catch(() => new Map()),
    resolveCatalogIdentity(st.slug as string, catalog),
  ]);
  const it = items.get(product);
  if (!it) return new Response("Producto no disponible en este catálogo", { status: 404 });
  const deal = deals.get(product);
  const now = deal?.now && deal.now > 0 ? deal.now : it.price;
  const before = deal?.before && deal.before > now ? deal.before : null;
  const pct = before ? deal?.pct ?? Math.round((1 - now / before) * 100) : null;

  const W = 1080, H = square ? 1080 : 1920;
  const photoSize = square ? 640 : 900;
  const [photo, logo] = await Promise.all([fetchImageAsPng(it.image_url, photoSize), fetchImageAsPng(identity?.logoUrl ?? null, 220)]);
  const photoUrl = dataUrl(photo), logoUrl = dataUrl(logo);
  const name = it.name.length > 70 ? `${it.name.slice(0, 68)}…` : it.name;
  const storeName = identity?.name ?? String(st.name ?? "");

  const image = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", overflow: "hidden",
        background: before ? "linear-gradient(165deg, #2a0712 0%, #4c0519 45%, #1c0a2e 100%)" : "linear-gradient(165deg, #0b0716 0%, #1a0b33 55%, #2b0f3f 100%)",
        color: "#fff", fontFamily: "sans-serif", padding: square ? 50 : 70 }}>
        <div style={{ position: "absolute", top: -260, right: -240, width: 820, height: 820, borderRadius: 9999, display: "flex", background: before ? "radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(239,68,68,0) 70%)" : "radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0) 70%)" }} />
        <div style={{ position: "absolute", bottom: -300, left: -260, width: 860, height: 860, borderRadius: 9999, display: "flex", background: "radial-gradient(circle, rgba(250,204,21,0.25) 0%, rgba(250,204,21,0) 70%)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 22, alignSelf: "flex-start" }}>
          {logoUrl ? <img src={logoUrl} width={96} height={96} style={{ borderRadius: 28, background: "#fff", objectFit: "contain" }} /> : null}
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800, maxWidth: 820 }}>{storeName.slice(0, 32)}</div>
        </div>

        <div style={{ display: "flex", marginTop: square ? 26 : 60, padding: "14px 40px", borderRadius: 9999, fontSize: square ? 46 : 60, fontWeight: 900, letterSpacing: 4,
          background: before ? "linear-gradient(90deg, #ef4444, #f97316)" : "linear-gradient(90deg, #8b5cf6, #ec4899)", boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }}>
          {before ? (deal?.label?.toUpperCase().slice(0, 22) || "OFERTA") : "DISPONIBLE"}
        </div>

        <div style={{ display: "flex", position: "relative", marginTop: square ? 26 : 56 }}>
          <div style={{ width: photoSize, height: photoSize, borderRadius: 64, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: "0 50px 120px rgba(0,0,0,0.55)" }}>
            {photoUrl ? <img src={photoUrl} width={photoSize} height={photoSize} style={{ objectFit: "cover" }} /> : <div style={{ display: "flex", fontSize: 120, color: "#8b5cf6", fontWeight: 900 }}>{storeName.slice(0, 1)}</div>}
          </div>
          {pct ? (
            <div style={{ position: "absolute", top: -40, right: -40, width: square ? 200 : 250, height: square ? 200 : 250, borderRadius: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #facc15, #f59e0b)", color: "#3b0a0a", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", transform: "rotate(12deg)" }}>
              <div style={{ display: "flex", fontSize: square ? 72 : 92, fontWeight: 900, lineHeight: 1 }}>-{pct}%</div>
              <div style={{ display: "flex", fontSize: square ? 26 : 32, fontWeight: 800 }}>DCTO</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", marginTop: square ? 26 : 56, fontSize: square ? 44 : 58, fontWeight: 800, textAlign: "center", maxWidth: 940, lineHeight: 1.15, justifyContent: "center" }}>{name}</div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: square ? 16 : 34 }}>
          {before ? <div style={{ display: "flex", fontSize: square ? 46 : 60, fontWeight: 700, opacity: 0.7, textDecoration: "line-through" }}>Antes {money(before)}</div> : null}
          <div style={{ display: "flex", fontSize: square ? 104 : 140, fontWeight: 900, color: before ? "#fde047" : "#fff", lineHeight: 1.05 }}>{money(now)}</div>
          {before ? <div style={{ display: "flex", marginTop: 6, fontSize: square ? 36 : 46, fontWeight: 800, color: "#4ade80" }}>Ahorras {money(before - now)}</div> : null}
        </div>

        {!square ? (
          <div style={{ display: "flex", marginTop: "auto", padding: "26px 56px", borderRadius: 40, background: "#22c55e", color: "#fff", fontSize: 50, fontWeight: 900, boxShadow: "0 24px 60px rgba(34,197,94,0.45)" }}>
            Escríbenos y pídelo
          </div>
        ) : null}
      </div>
    ),
    { width: W, height: H },
  );

  const sharp = (await import("sharp")).default;
  const jpg = await sharp(Buffer.from(await image.arrayBuffer())).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="oferta-${product.slice(0, 8)}.jpg"`,
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}
