"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ImageIcon, Loader2, Share2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useFeature } from "@/lib/useFeature";

type Cat = { slug: string; name: string; access_key: string | null };

/**
 * «📸 Imagen para estados» (función opcional «Imagen de oferta»): arma una imagen con el precio de antes tachado,
 * el de ahora y el %, lista para estados de WhatsApp. Si la función está apagada no se muestra.
 */
export function OfferImageButton({ storeId, productId, catalogSlug, compact }: { storeId: string | null; productId: string; catalogSlug?: string | null; compact?: boolean }) {
  const on = useFeature(storeId, "imagen_oferta");
  const [open, setOpen] = useState(false);
  if (!on || !storeId) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-black text-white ${compact ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-xs"}`}
        style={{ background: "linear-gradient(135deg,#ef4444,#f97316)" }}>
        <ImageIcon size={13} /> Imagen para estados
      </button>
      {open ? <OfferImageDialog storeId={storeId} productId={productId} initialCatalog={catalogSlug ?? null} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function OfferImageDialog({ storeId, productId, initialCatalog, onClose }: { storeId: string; productId: string; initialCatalog: string | null; onClose: () => void }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [cat, setCat] = useState<string>(initialCatalog ?? "detal");
  const [format, setFormat] = useState<"story" | "square">("story");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<"share" | "download" | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.from("stores").select("slug").eq("id", storeId).maybeSingle().then(({ data }) => setSlug((data?.slug as string | undefined) ?? null));
    void sb.from("store_catalogs").select("slug,name,access_key,active").eq("store_id", storeId).order("sort_order").then(({ data }) => {
      const list = ((data ?? []) as Array<Cat & { active?: boolean | null }>).filter((c) => c.slug && c.active !== false);
      setCats(list);
      if (!initialCatalog && list[0]) setCat(list[0].slug);
    });
  }, [storeId, initialCatalog]);

  const key = cats.find((c) => c.slug === cat)?.access_key ?? null;
  const src = slug ? `/api/og/oferta?${new URLSearchParams({ store: slug, product: productId, catalog: cat, format, ...(key ? { key } : {}) }).toString()}` : null;

  async function file() {
    const res = await fetch(src!);
    if (!res.ok) throw new Error(await res.text());
    return new File([await res.blob()], `oferta-${format}.jpg`, { type: "image/jpeg" });
  }
  async function share() {
    if (!src) return;
    setBusy("share");
    try {
      const f = await file();
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] });
      else download(f);
    } catch { /* cancelado */ } finally { setBusy(null); }
  }
  function download(f?: File) {
    const go = async () => {
      setBusy("download");
      try {
        const x = f ?? await file();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(x); a.download = x.name; a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch { /* sin imagen */ } finally { setBusy(null); }
    };
    void go();
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Imagen para estados">
      <div className="vm-sheet max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-[28px] border p-4 sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-black">📸 Imagen para estados</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">✕</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(cats.length ? cats : [{ slug: "detal", name: "Detal", access_key: null }]).map((c) => (
            <button key={c.slug} type="button" onClick={() => setCat(c.slug)} className="rounded-full border px-3 py-1 text-[11px] font-bold"
              style={cat === c.slug ? { background: "#ef4444", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{c.name}</button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(["story", "square"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)} className="rounded-xl border px-3 py-2 text-xs font-bold"
              style={format === f ? { borderColor: "#ef4444", background: "color-mix(in oklab, #ef4444 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
              {f === "story" ? "📱 Estado (vertical)" : "⬛ Publicación (cuadrada)"}
            </button>
          ))}
        </div>
        <div className="relative mt-3 grid place-items-center overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)", aspectRatio: format === "story" ? "9 / 16" : "1 / 1", maxHeight: "56vh" }}>
          {src ? (
            <>
              {loaded !== src && failed !== src ? <Loader2 className="absolute animate-spin" size={28} aria-hidden /> : null}
              {failed === src ? (
                <p className="p-6 text-center text-xs" style={{ color: "var(--t-muted)" }}>Este producto no está disponible (sin precio o sin existencias) en este catálogo.</p>
              ) : (
                <img key={src} src={src} alt="Vista previa de la imagen de oferta" className="h-full w-full object-contain" onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
              )}
            </>
          ) : <Loader2 className="animate-spin" size={28} aria-hidden />}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!src || failed === src || !!busy} onClick={() => download()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
            {busy === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Descargar
          </button>
          <button type="button" disabled={!src || failed === src || !!busy} onClick={() => void share()} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-black text-white disabled:opacity-50" style={{ background: "#25d366" }}>
            {busy === "share" ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Compartir
          </button>
        </div>
        <p className="mt-2 text-center text-[10px]" style={{ color: "var(--t-muted)" }}>Sale con los precios de ese catálogo: si hay oferta, el de antes tachado y el %.</p>
      </div>
    </div>,
    document.body,
  );
}
