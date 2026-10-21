"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { storeSpaceOrigin } from "@/lib/share/store-host";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Tarjeta para compartir el catálogo (estados de WhatsApp, historias de Instagram):
 * logo, nombre, hasta 4 productos con foto, el enlace y un QR. Se arma en el navegador (1080×1920).
 */

type Prod = { name: string; image_url: string; price_3: number | null };

function loadImg(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawCard(o: { name: string; logo: string | null; url: string; products: Prod[]; headline: string; withPhotos: boolean }) {
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#1e1b4b"); g.addColorStop(0.55, "#581c87"); g.addColorStop(1, "#be185d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12; ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(980, 160, 260, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(80, 1500, 320, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  let y = 150;
  if (o.logo) {
    const logo = await loadImg(o.logo);
    if (logo) {
      ctx.save(); roundRect(ctx, W / 2 - 110, y, 220, 220, 48); ctx.clip(); cover(ctx, logo, W / 2 - 110, y, 220, 220); ctx.restore();
      y += 260;
    }
  }
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "900 88px system-ui, -apple-system, Segoe UI, sans-serif";
  const name = o.name.length > 22 ? `${o.name.slice(0, 21)}…` : o.name;
  ctx.fillText(name, W / 2, y + 80);
  ctx.font = "600 46px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.globalAlpha = 0.9; ctx.fillText(o.headline, W / 2, y + 160); ctx.globalAlpha = 1;
  y += 230;

  const photos = o.withPhotos ? (await Promise.all(o.products.slice(0, 4).map((p) => loadImg(p.image_url)))) : [];
  const tiles = photos.map((img, i) => ({ img, p: o.products[i] })).filter((t) => t.img);
  if (tiles.length) {
    const gap = 30, size = (W - 140 - gap) / 2;
    tiles.forEach((t, i) => {
      const x = 70 + (i % 2) * (size + gap), ty = y + Math.floor(i / 2) * (size + gap);
      ctx.save(); roundRect(ctx, x, ty, size, size, 40); ctx.clip();
      ctx.fillStyle = "#fff"; ctx.fillRect(x, ty, size, size);
      cover(ctx, t.img!, x, ty, size, size);
      const sh = ctx.createLinearGradient(0, ty + size - 170, 0, ty + size);
      sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.72)");
      ctx.fillStyle = sh; ctx.fillRect(x, ty + size - 170, size, 170);
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "800 34px system-ui, sans-serif";
      const n = t.p.name.length > 24 ? `${t.p.name.slice(0, 23)}…` : t.p.name;
      ctx.fillText(n, x + 26, ty + size - 70);
      if (t.p.price_3) { ctx.font = "900 40px system-ui, sans-serif"; ctx.fillText(`$ ${Math.round(t.p.price_3).toLocaleString("es-CO")}`, x + 26, ty + size - 22); }
      ctx.restore();
    });
    y += Math.ceil(tiles.length / 2) * (size + gap) + 30;
  }

  const qr = await loadImg(await QRCode.toDataURL(o.url, { margin: 1, width: 360, color: { dark: "#111827", light: "#ffffff" } }));
  const boxY = Math.max(y, H - 560);
  ctx.fillStyle = "#fff"; roundRect(ctx, 70, boxY, W - 140, 440, 48); ctx.fill();
  if (qr) ctx.drawImage(qr, 110, boxY + 40, 360, 360);
  ctx.fillStyle = "#111827"; ctx.textAlign = "left";
  ctx.font = "900 50px system-ui, sans-serif"; ctx.fillText("Haz tu pedido", 510, boxY + 130);
  ctx.font = "600 38px system-ui, sans-serif"; ctx.fillText("por WhatsApp 👇", 510, boxY + 185);
  ctx.font = "700 32px system-ui, sans-serif"; ctx.fillStyle = "#7c3aed";
  const short = o.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const lines = short.length > 24 ? [short.slice(0, 24), short.slice(24, 48)] : [short];
  lines.forEach((l, i) => ctx.fillText(l, 510, boxY + 270 + i * 42));
  ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.textAlign = "center"; ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("Hecho con RemHub", W / 2, H - 50);
  return new Promise<Blob | null>((resolve) => { try { c.toBlob((b) => resolve(b), "image/png"); } catch { resolve(null); } });
}

export function ShareCard() {
  const [store, setStore] = useState<{ id: string; name: string; slug: string; logo_url: string | null } | null>(null);
  const [products, setProducts] = useState<Prod[]>([]);
  const [headline, setHeadline] = useState("Mira nuestro catálogo");
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore();
      const s = access.store;
      if (!s) return;
      setStore({ id: s.id, name: s.name, slug: s.slug, logo_url: (s as { logo_url?: string | null }).logo_url ?? null });
      const { data } = await supabaseBrowser().from("products").select("name,image_url,price_3").eq("store_id", s.id).eq("active", true)
        .not("image_url", "is", null).neq("image_url", "").order("created_at", { ascending: false }).limit(12);
      setProducts(((data ?? []) as Prod[]).filter((p) => p.image_url));
    })();
  }, []);

  const url = store ? `${storeSpaceOrigin(store.slug) ?? `${PRODUCTION_ORIGIN}/${store.slug}`}/` : "";

  async function make() {
    if (!store) return;
    setBusy(true); setNote("");
    let b = await drawCard({ name: store.name, logo: store.logo_url, url, products, headline: headline.trim() || "Mira nuestro catálogo", withPhotos: true });
    // Si alguna foto no se deja dibujar (otro servidor), se arma sin fotos.
    if (!b) { b = await drawCard({ name: store.name, logo: null, url, products, headline, withPhotos: false }); setNote("Algunas fotos no se pudieron usar; la tarjeta salió sin ellas."); }
    setBusy(false);
    if (!b) return setNote("No se pudo crear la imagen en este navegador.");
    setBlob(b);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b!); });
  }

  async function share() {
    if (!blob || !store) return;
    const file = new File([blob], `${store.slug}-catalogo.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], text: `${headline} 👉 ${url}` }); return; } catch { /* cancelado */ }
    }
    download();
  }
  function download() {
    if (!preview || !store) return;
    const a = document.createElement("a");
    a.href = preview; a.download = `${store.slug}-catalogo.png`; a.click();
  }

  if (!store) return null;
  return (
    <section className="rounded-[24px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-base font-black">📣 Tarjeta para compartir tu catálogo</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Una imagen lista para tus estados de WhatsApp e historias de Instagram: tu logo, {products.length ? `${Math.min(4, products.length)} productos con foto` : "tus productos"}, el enlace y un QR para pedir.</p>
          <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
            value={headline} maxLength={34} onChange={(e) => setHeadline(e.target.value)} placeholder="Frase corta (ej: ¡Llegó mercancía nueva!)" aria-label="Frase de la tarjeta" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void make()} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>{busy ? "Creando…" : preview ? "🔄 Volver a crear" : "✨ Crear tarjeta"}</button>
            {preview ? <button type="button" onClick={() => void share()} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "#16a34a" }}>📤 Compartir</button> : null}
            {preview ? <button type="button" onClick={download} className="rounded-xl border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Descargar</button> : null}
          </div>
          {note ? <p className="text-xs text-amber-500">{note}</p> : null}
        </div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Tarjeta del catálogo" className="h-64 rounded-xl border object-contain shadow-lg" style={{ borderColor: "var(--t-card-border)" }} />
        ) : null}
      </div>
    </section>
  );
}
