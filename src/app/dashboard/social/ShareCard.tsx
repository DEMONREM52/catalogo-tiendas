"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, Loader2, Palette, RotateCcw, Search, Share2, Shuffle, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { storeSpaceOrigin } from "@/lib/share/store-host";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { ProductPhotoButton } from "@/app/dashboard/PhotoSearchControls";

/**
 * Tarjeta para compartir el catálogo (estados de WhatsApp, historias y publicaciones de Instagram).
 * Estilos listos o colores propios, 3 formatos, productos elegidos a mano o automáticos, frase, etiqueta, QR.
 * Se arma en el navegador y la vista previa se actualiza sola. La configuración se recuerda en este navegador.
 */

type Prod = { id: string; name: string; image_url: string; price_3: number | null };

type Style = {
  id: string;
  name: string;
  bg: [string, string, string];
  text: string;
  accent: string;
  panel: string;
  panelText: string;
  link: string;
};

const STYLES: Style[] = [
  { id: "amatista", name: "Amatista", bg: ["#1e1b4b", "#581c87", "#be185d"], text: "#ffffff", accent: "#f0abfc", panel: "#ffffff", panelText: "#111827", link: "#7c3aed" },
  { id: "fuego", name: "Fuego", bg: ["#0a0a0a", "#450a0a", "#dc2626"], text: "#ffffff", accent: "#fca5a5", panel: "#ffffff", panelText: "#111827", link: "#dc2626" },
  { id: "noche", name: "Noche", bg: ["#020617", "#0f172a", "#1e3a8a"], text: "#ffffff", accent: "#7dd3fc", panel: "#ffffff", panelText: "#0f172a", link: "#0284c7" },
  { id: "menta", name: "Menta", bg: ["#022c22", "#065f46", "#10b981"], text: "#ffffff", accent: "#a7f3d0", panel: "#ffffff", panelText: "#064e3b", link: "#047857" },
  { id: "oro", name: "Oro", bg: ["#0c0a09", "#292524", "#b45309"], text: "#fffbeb", accent: "#fcd34d", panel: "#fffbeb", panelText: "#1c1917", link: "#b45309" },
  { id: "rosa", name: "Rosa", bg: ["#831843", "#db2777", "#f472b6"], text: "#ffffff", accent: "#fff1f2", panel: "#ffffff", panelText: "#831843", link: "#be185d" },
  { id: "atardecer", name: "Atardecer", bg: ["#7c2d12", "#ea580c", "#facc15"], text: "#ffffff", accent: "#fef08a", panel: "#ffffff", panelText: "#7c2d12", link: "#c2410c" },
  { id: "blanco", name: "Blanco", bg: ["#ffffff", "#f5f3ff", "#e9d5ff"], text: "#111827", accent: "#7c3aed", panel: "#111827", panelText: "#ffffff", link: "#c4b5fd" },
];

const FORMATS = [
  { id: "story", name: "Historia / estado", hint: "9:16", w: 1080, h: 1920 },
  { id: "portrait", name: "Publicación vertical", hint: "4:5", w: 1080, h: 1350 },
  { id: "square", name: "Publicación cuadrada", hint: "1:1", w: 1080, h: 1080 },
] as const;
type FormatId = (typeof FORMATS)[number]["id"];

const HEADLINES = ["Mira nuestro catálogo", "¡Llegó mercancía nueva!", "Ofertas de la semana", "Envíos a todo el país", "Precios por mayor", "Lo más vendido 🔥", "Pide hoy, recibe pronto"];
const BADGES = ["", "NUEVO", "OFERTA", "-20%", "HOY", "ENVÍO GRATIS", "ÚLTIMAS UNIDADES"];

type Settings = {
  style: string;
  custom: [string, string];
  format: FormatId;
  headline: string;
  subtitle: string;
  badge: string;
  cta: string;
  count: number;
  pick: "auto" | "manual";
  picked: string[];
  prices: boolean;
  qr: boolean;
  logo: boolean;
};

const DEFAULTS: Settings = {
  style: "amatista", custom: ["#1e1b4b", "#be185d"], format: "story", headline: "Mira nuestro catálogo", subtitle: "", badge: "",
  cta: "Haz tu pedido", count: 4, pick: "auto", picked: [], prices: true, qr: true, logo: true,
};

/* ---------------- Dibujo ---------------- */

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

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";

/** Pone la letra más grande que quepa (entre max y min) y recorta con «…» si aun así no cabe. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, max: number, min: number) {
  let size = max;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > min && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = `${weight} ${size}px ${FONT}`; }
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? t : `${t.slice(0, -1)}…`;
}

function hexLum(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function mix(a: string, b: string) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 255) + ((pb >> s) & 255)) / 2);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

function styleFor(s: Settings): Style {
  if (s.style !== "custom") return STYLES.find((x) => x.id === s.style) ?? STYLES[0];
  const [a, b] = s.custom;
  const light = (hexLum(a) + hexLum(b)) / 2 > 0.45;
  return {
    id: "custom", name: "Mío", bg: [a, mix(a, b), b],
    text: light ? "#111827" : "#ffffff", accent: light ? mix(mix(b, "#000000"), b) : "#ffffff",
    panel: light ? "#111827" : "#ffffff", panelText: light ? "#ffffff" : "#111827", link: light ? "#e5e7eb" : (hexLum(b) < 0.5 ? b : a),
  };
}

type DrawInput = { store: string; logo: string | null; url: string; products: Prod[]; s: Settings; withPhotos: boolean };

async function drawCard({ store, logo, url, products, s, withPhotos }: DrawInput) {
  const fmt = FORMATS.find((f) => f.id === s.format) ?? FORMATS[0];
  const W = fmt.w, H = fmt.h, story = s.format === "story", square = s.format === "square";
  const st = styleFor(s);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;

  // Fondo con degradado y luces.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, st.bg[0]); g.addColorStop(0.55, st.bg[1]); g.addColorStop(1, st.bg[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12; ctx.fillStyle = st.accent;
  ctx.beginPath(); ctx.arc(W - 100, 160, 260, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(80, H * 0.78, 320, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  const m = 70;
  let y = story ? 130 : 60;

  // Etiqueta (NUEVO, OFERTA…).
  if (s.badge.trim()) {
    ctx.font = `900 ${story ? 40 : 32}px ${FONT}`;
    const t = s.badge.trim().toUpperCase();
    const bw = ctx.measureText(t).width + 56, bh = story ? 72 : 58;
    const bx = W - m - bw, by = story ? 60 : 36;
    ctx.save(); ctx.fillStyle = st.accent; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = hexLum(st.accent) > 0.45 ? "#111827" : "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t, bx + bw / 2, by + bh / 2 + 2); ctx.restore(); ctx.textBaseline = "alphabetic";
  }

  // Logo, nombre, frase y subtítulo.
  if (s.logo && logo) {
    const img = await loadImg(logo);
    const ls = story ? 210 : square ? 120 : 150;
    if (img) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 30; ctx.fillStyle = "#fff"; roundRect(ctx, W / 2 - ls / 2, y, ls, ls, ls * 0.22); ctx.fill(); ctx.restore();
      ctx.save(); roundRect(ctx, W / 2 - ls / 2, y, ls, ls, ls * 0.22); ctx.clip(); cover(ctx, img, W / 2 - ls / 2, y, ls, ls); ctx.restore();
      y += ls + (story ? 40 : 24);
    }
  }
  ctx.fillStyle = st.text; ctx.textAlign = "center";
  const nameSize = story ? 88 : square ? 64 : 74;
  ctx.fillText(fit(ctx, store, W - 2 * m, 900, nameSize, 40), W / 2, y + nameSize * 0.85);
  y += nameSize + (story ? 24 : 14);
  const hs = story ? 50 : 40;
  ctx.fillStyle = st.accent;
  ctx.fillText(fit(ctx, s.headline.trim() || "Mira nuestro catálogo", W - 2 * m, 800, hs, 28), W / 2, y + hs * 0.85);
  y += hs + 14;
  if (s.subtitle.trim()) {
    const ss = story ? 36 : 30;
    ctx.globalAlpha = 0.85; ctx.fillStyle = st.text;
    ctx.fillText(fit(ctx, s.subtitle.trim(), W - 2 * m, 600, ss, 22), W / 2, y + ss * 0.85);
    ctx.globalAlpha = 1; y += ss + 12;
  }
  y += story ? 40 : 24;

  // Bloque de abajo: QR o botón con el enlace.
  const bottomH = s.qr ? (story ? 420 : square ? 250 : 290) : (story ? 170 : 130);
  const bottomY = H - bottomH - (story ? 110 : 60);

  // Productos: se acomodan en el espacio que queda.
  const n = withPhotos ? Math.min(s.count, products.length) : 0;
  const photos = n ? await Promise.all(products.slice(0, n).map((p) => loadImg(p.image_url))) : [];
  const tiles = photos.map((img, i) => ({ img, p: products[i] })).filter((t) => t.img);
  if (tiles.length) {
    const cols = tiles.length === 1 ? 1 : tiles.length <= 4 ? 2 : story ? 2 : 3;
    const rows = Math.ceil(tiles.length / cols);
    const gap = 26;
    const areaH = bottomY - y - 30;
    const size = Math.max(120, Math.min((W - 2 * m - (cols - 1) * gap) / cols, (areaH - (rows - 1) * gap) / rows));
    const gridW = cols * size + (cols - 1) * gap;
    const x0 = (W - gridW) / 2;
    const y0 = y + Math.max(0, (areaH - (rows * size + (rows - 1) * gap)) / 2);
    tiles.forEach((t, i) => {
      const lastRow = Math.floor(i / cols) === rows - 1;
      const inRow = lastRow ? tiles.length - (rows - 1) * cols : cols;
      const rowX = x0 + (gridW - (inRow * size + (inRow - 1) * gap)) / 2;
      const x = rowX + (i % cols) * (size + gap), ty = y0 + Math.floor(i / cols) * (size + gap);
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10; ctx.fillStyle = "#fff"; roundRect(ctx, x, ty, size, size, 36); ctx.fill(); ctx.restore();
      ctx.save(); roundRect(ctx, x, ty, size, size, 36); ctx.clip();
      cover(ctx, t.img!, x, ty, size, size);
      const band = Math.min(170, size * 0.42);
      const sh = ctx.createLinearGradient(0, ty + size - band, 0, ty + size);
      sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.78)");
      ctx.fillStyle = sh; ctx.fillRect(x, ty + size - band, size, band);
      ctx.fillStyle = "#fff"; ctx.textAlign = "left";
      const big = size > 400;
      const priceOn = s.prices && t.p.price_3;
      ctx.fillText(fit(ctx, t.p.name, size - 44, 800, big ? 34 : 26, 18), x + 22, ty + size - (priceOn ? (big ? 70 : 54) : 26));
      if (priceOn) { ctx.font = `900 ${big ? 42 : 32}px ${FONT}`; ctx.fillStyle = "#fff"; ctx.fillText(`$ ${Math.round(Number(t.p.price_3)).toLocaleString("es-CO")}`, x + 22, ty + size - 22); }
      ctx.restore();
    });
  }

  ctx.textAlign = "left";
  const short = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (s.qr) {
    const qr = await loadImg(await QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: "#111827", light: "#ffffff" } }));
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 30; ctx.fillStyle = st.panel; roundRect(ctx, m, bottomY, W - 2 * m, bottomH, 44); ctx.fill(); ctx.restore();
    const qs = bottomH - 70;
    ctx.fillStyle = "#fff"; roundRect(ctx, m + 30, bottomY + 35, qs, qs, 18); ctx.fill();
    if (qr) ctx.drawImage(qr, m + 38, bottomY + 43, qs - 16, qs - 16);
    const tx = m + 30 + qs + 36, tw = W - m - 30 - tx;
    ctx.fillStyle = st.panelText;
    const cs = story ? 52 : 40;
    ctx.fillText(fit(ctx, s.cta.trim() || "Haz tu pedido", tw, 900, cs, 26), tx, bottomY + bottomH * 0.36);
    ctx.globalAlpha = 0.75; ctx.fillText(fit(ctx, "Escanea o entra por WhatsApp 👇", tw, 600, story ? 32 : 24, 18), tx, bottomY + bottomH * 0.36 + cs * 0.9); ctx.globalAlpha = 1;
    ctx.fillStyle = st.link;
    ctx.fillText(fit(ctx, short, tw, 800, story ? 34 : 26, 16), tx, bottomY + bottomH * 0.8);
  } else {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 30; ctx.fillStyle = st.panel; roundRect(ctx, m, bottomY, W - 2 * m, bottomH, bottomH / 2); ctx.fill(); ctx.restore();
    ctx.textAlign = "center"; ctx.fillStyle = st.panelText;
    ctx.fillText(fit(ctx, `${s.cta.trim() || "Haz tu pedido"} 👉`, W - 2 * m - 80, 900, story ? 54 : 42, 26), W / 2, bottomY + bottomH * 0.48);
    ctx.fillStyle = st.link;
    ctx.fillText(fit(ctx, short, W - 2 * m - 80, 800, story ? 34 : 26, 16), W / 2, bottomY + bottomH * 0.8);
  }
  ctx.textAlign = "center"; ctx.globalAlpha = 0.7; ctx.fillStyle = st.text; ctx.font = `600 ${story ? 28 : 22}px ${FONT}`;
  ctx.fillText("Hecho con RemHub", W / 2, H - (story ? 50 : 22)); ctx.globalAlpha = 1;
  return new Promise<Blob | null>((resolve) => { try { c.toBlob((b) => resolve(b), "image/png"); } catch { resolve(null); } });
}

/* ---------------- Pantalla ---------------- */

function readSaved(storeId: string): Settings {
  try {
    const raw = localStorage.getItem(`remhub-sharecard:${storeId}`);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

const chip = (on: boolean) => ({
  borderColor: on ? "var(--t-accent)" : "var(--t-card-border)",
  background: on ? "var(--t-accent-soft, color-mix(in oklab, var(--t-accent) 14%, transparent))" : "var(--t-card-bg)",
  color: "var(--t-text)",
});

export function ShareCard() {
  const [store, setStore] = useState<{ id: string; name: string; slug: string; logo_url: string | null } | null>(null);
  const [products, setProducts] = useState<Prod[]>([]);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");
  const [q, setQ] = useState("");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore();
      const st = access.store;
      if (!st) return;
      setStore({ id: st.id, name: st.name, slug: st.slug, logo_url: (st as { logo_url?: string | null }).logo_url ?? null });
      setS(readSaved(st.id));
      const { data } = await supabaseBrowser().from("products").select("id,name,image_url,price_3").eq("store_id", st.id).eq("active", true)
        .not("image_url", "is", null).neq("image_url", "").order("created_at", { ascending: false }).limit(120);
      setProducts(((data ?? []) as Prod[]).filter((p) => p.image_url));
    })();
  }, []);

  const url = store ? `${storeSpaceOrigin(store.slug) ?? `${PRODUCTION_ORIGIN}/${store.slug}`}/` : "";

  // Productos que van en la tarjeta.
  const chosen = useMemo(() => {
    if (s.pick === "manual") {
      const byId = new Map(products.map((p) => [p.id, p]));
      return s.picked.map((id) => byId.get(id)).filter(Boolean) as Prod[];
    }
    if (!shuffleSeed) return products;
    // «Al azar»: mezcla estable para cada toque del botón.
    return [...products].map((p, i) => ({ p, k: Math.sin(i * 9301 + shuffleSeed * 49297) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  }, [products, s.pick, s.picked, shuffleSeed]);

  function update(change: Partial<Settings>) {
    setS((cur) => {
      const next = { ...cur, ...change };
      if (store) { try { localStorage.setItem(`remhub-sharecard:${store.id}`, JSON.stringify(next)); } catch { /* sin almacenamiento */ } }
      return next;
    });
  }

  // La vista previa se rehace sola (con una pequeña espera mientras se escribe).
  useEffect(() => {
    if (!store) return;
    const id = ++run.current;
    const t = window.setTimeout(async () => {
      setBusy(true); setNote("");
      let b = await drawCard({ store: store.name, logo: store.logo_url, url, products: chosen, s, withPhotos: true });
      if (!b) { b = await drawCard({ store: store.name, logo: null, url, products: chosen, s, withPhotos: false }); if (id === run.current) setNote("Algunas fotos no se pudieron usar; la tarjeta salió sin ellas."); }
      if (id !== run.current) return;
      setBusy(false);
      if (!b) return setNote("No se pudo crear la imagen en este navegador.");
      setBlob(b);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b!); });
    }, 380);
    return () => window.clearTimeout(t);
  }, [store, url, chosen, s]);

  const fileName = store ? `${store.slug}-${s.format}.png` : "tarjeta.png";
  const caption = `${s.headline.trim() || "Mira nuestro catálogo"} 👉 ${url}`;

  async function share() {
    if (!blob || !store) return;
    const file = new File([blob], fileName, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], text: caption }); return; } catch { /* cancelado */ }
    }
    download();
  }
  function download() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview; a.download = fileName; a.click();
  }
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setCopied(what); window.setTimeout(() => setCopied(""), 1600); } catch { /* sin permiso */ }
  }
  function togglePick(id: string) {
    const has = s.picked.includes(id);
    if (has) return update({ picked: s.picked.filter((x) => x !== id) });
    if (s.picked.length >= 6) return;
    update({ picked: [...s.picked, id], count: Math.max(s.count, Math.min(6, s.picked.length + 1)) });
  }

  if (!store) return null;
  const fmt = FORMATS.find((f) => f.id === s.format) ?? FORMATS[0];
  const filtered = q.trim() ? products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : products;
  const label = "mb-1.5 block text-[11px] font-bold uppercase tracking-wide";

  return (
    <section className="rounded-[24px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-black"><Sparkles size={18} style={{ color: "var(--t-accent)" }} /> Tarjeta para compartir tu catálogo</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Para estados de WhatsApp, historias y publicaciones. Elige un estilo listo o tus colores; la vista previa cambia sola.</p>
        </div>
        <button type="button" onClick={() => update({ ...DEFAULTS })} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold" style={chip(false)}>
          <RotateCcw size={13} /> Predeterminado
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {/* Estilo */}
          <div>
            <span className={label} style={{ color: "var(--t-muted)" }}>Estilo</span>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((x) => (
                <button key={x.id} type="button" onClick={() => update({ style: x.id })} className="group flex flex-col items-center gap-1" title={x.name}>
                  <span className="relative block h-12 w-12 rounded-2xl border-2 shadow-sm transition group-hover:scale-105"
                    style={{ background: `linear-gradient(135deg, ${x.bg[0]}, ${x.bg[1]} 55%, ${x.bg[2]})`, borderColor: s.style === x.id ? "var(--t-accent)" : "transparent" }}>
                    {s.style === x.id ? <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }}><Check size={12} /></span> : null}
                  </span>
                  <span className="text-[10px] font-semibold">{x.name}</span>
                </button>
              ))}
              <button type="button" onClick={() => update({ style: "custom" })} className="group flex flex-col items-center gap-1" title="Mis colores">
                <span className="relative grid h-12 w-12 place-items-center rounded-2xl border-2 shadow-sm transition group-hover:scale-105"
                  style={{ background: `linear-gradient(135deg, ${s.custom[0]}, ${s.custom[1]})`, borderColor: s.style === "custom" ? "var(--t-accent)" : "var(--t-card-border)" }}>
                  <Palette size={18} className="text-white drop-shadow" />
                </span>
                <span className="text-[10px] font-semibold">Mis colores</span>
              </button>
            </div>
            {s.style === "custom" ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border p-2.5 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                {[0, 1].map((i) => (
                  <label key={i} className="flex items-center gap-2 font-semibold">
                    <input type="color" value={s.custom[i]} onChange={(e) => update({ custom: (i === 0 ? [e.target.value, s.custom[1]] : [s.custom[0], e.target.value]) as [string, string] })} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent" />
                    {i === 0 ? "Color de arriba" : "Color de abajo"}
                  </label>
                ))}
                <span style={{ color: "var(--t-muted)" }}>El texto se pone claro u oscuro solo para que se lea.</span>
              </div>
            ) : null}
          </div>

          {/* Formato */}
          <div>
            <span className={label} style={{ color: "var(--t-muted)" }}>Formato</span>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button key={f.id} type="button" onClick={() => update({ format: f.id })} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold" style={chip(s.format === f.id)}>
                  <span className="inline-block rounded-[3px] border-2" style={{ borderColor: "currentColor", width: 14, height: Math.round(14 * f.h / f.w) }} />
                  {f.name} <span className="font-semibold" style={{ color: "var(--t-muted)" }}>{f.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Textos */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={label} style={{ color: "var(--t-muted)" }}>Frase</span>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
                value={s.headline} maxLength={40} onChange={(e) => update({ headline: e.target.value })} placeholder="Frase corta" aria-label="Frase de la tarjeta" />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {HEADLINES.map((h) => (
                  <button key={h} type="button" onClick={() => update({ headline: h })} className="rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={chip(s.headline === h)}>{h}</button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className={label} style={{ color: "var(--t-muted)" }}>Línea extra (opcional)</span>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
                value={s.subtitle} maxLength={50} onChange={(e) => update({ subtitle: e.target.value })} placeholder="Ej: Envíos a todo Colombia · Pago contra entrega" />
            </label>
            <label className="block">
              <span className={label} style={{ color: "var(--t-muted)" }}>Texto del botón</span>
              <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
                value={s.cta} maxLength={28} onChange={(e) => update({ cta: e.target.value })} placeholder="Haz tu pedido" />
            </label>
            <div className="sm:col-span-2">
              <span className={label} style={{ color: "var(--t-muted)" }}>Etiqueta</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {BADGES.map((b) => (
                  <button key={b || "none"} type="button" onClick={() => update({ badge: b })} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={chip(s.badge === b)}>{b || "Sin etiqueta"}</button>
                ))}
                <input className="w-32 rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
                  value={BADGES.includes(s.badge) ? "" : s.badge} maxLength={18} onChange={(e) => update({ badge: e.target.value })} placeholder="Otra…" aria-label="Etiqueta propia" />
              </div>
            </div>
          </div>

          {/* Productos */}
          <div>
            <span className={label} style={{ color: "var(--t-muted)" }}>Productos</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[0, 1, 2, 4, 6].map((n) => (
                <button key={n} type="button" onClick={() => update({ count: n })} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={chip(s.count === n)}>{n === 0 ? "Sin fotos" : n}</button>
              ))}
              <span className="mx-1 h-5 w-px" style={{ background: "var(--t-card-border)" }} />
              <button type="button" onClick={() => { update({ pick: "auto" }); setShuffleSeed(0); }} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={chip(s.pick === "auto" && !shuffleSeed)}>Los más nuevos</button>
              <button type="button" onClick={() => { update({ pick: "auto" }); setShuffleSeed((x) => x + 1); }} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold" style={chip(s.pick === "auto" && !!shuffleSeed)}><Shuffle size={12} /> Al azar</button>
              <button type="button" onClick={() => update({ pick: "manual" })} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={chip(s.pick === "manual")}>Elegir yo ({s.picked.length})</button>
            </div>
            {s.pick === "manual" ? (
              <div className="mt-2 rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-2.5 opacity-50" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="w-full rounded-lg border py-1.5 pl-8 pr-10 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }} />
                  <span className="absolute right-0.5 top-0.5"><ProductPhotoButton storeId={store?.id} compact className="h-7 border-0 px-2" pickLabel="Buscar" onPick={(h) => setQ(h.name)} /></span>
                </div>
                <p className="mb-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Toca hasta 6. Salen en el orden en que los tocas.</p>
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-auto sm:grid-cols-6">
                  {filtered.map((p) => {
                    const at = s.picked.indexOf(p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => togglePick(p.id)} title={p.name} className="relative aspect-square overflow-hidden rounded-xl border-2 transition hover:scale-[1.03]" style={{ borderColor: at >= 0 ? "var(--t-accent)" : "transparent" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                        {at >= 0 ? <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: "var(--t-accent)" }}>{at + 1}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* Interruptores */}
          <div className="flex flex-wrap gap-2">
            {([["logo", "Logo"], ["prices", "Precios"], ["qr", "Código QR"]] as const).map(([k, t]) => (
              <button key={k} type="button" onClick={() => update({ [k]: !s[k] } as Partial<Settings>)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold" style={chip(s[k])}>
                {s[k] ? <Check size={12} /> : null} {t}
              </button>
            ))}
          </div>
        </div>

        {/* Vista previa y acciones */}
        <div className="space-y-3">
          <div className="relative mx-auto overflow-hidden rounded-[22px] border-4 shadow-xl" style={{ borderColor: "color-mix(in oklab, var(--t-text) 15%, transparent)", width: "100%", maxWidth: 280, aspectRatio: `${fmt.w} / ${fmt.h}`, background: "var(--t-card-bg-soft)" }}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Vista previa de la tarjeta" className="h-full w-full object-cover" />
            ) : null}
            {busy ? <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white"><Loader2 size={14} className="animate-spin" /></span> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!blob} onClick={() => void share()} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#16a34a" }}><Share2 size={15} /> Compartir</button>
            <button type="button" disabled={!preview} onClick={download} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold disabled:opacity-50" style={chip(false)}><Download size={15} /> Descargar</button>
            <button type="button" onClick={() => void copy(caption, "texto")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold" style={chip(copied === "texto")}>{copied === "texto" ? <Check size={13} /> : <Copy size={13} />} Copiar texto</button>
            <button type="button" onClick={() => void copy(url, "enlace")} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold" style={chip(copied === "enlace")}>{copied === "enlace" ? <Check size={13} /> : <Copy size={13} />} Copiar enlace</button>
          </div>
          {note ? <p className="text-xs text-amber-500">{note}</p> : null}
        </div>
      </div>
    </section>
  );
}
