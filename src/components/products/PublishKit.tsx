"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, Download, Loader2, MessageCircle, Share2, Sparkles } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { normalizeProductDetails } from "@/lib/product-details";
import { richToPlain } from "@/lib/rich-text";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Kit para publicar: el texto del producto listo (con emojis, precio y enlace al catálogo), sus fotos y
 * botones para copiar, compartir, descargar fotos o mandarlo por WhatsApp. Al compartir o abrir WhatsApp
 * se marca solo como publicado (onShared).
 */

type Loaded = { text: string; images: string[]; name: string };

const toast = (title: string, icon: "success" | "info" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2800, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

const plain = (v: string | null | undefined) => richToPlain(v ?? "").replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function buildPublishText(p: { name: string; description: string | null; price: number; highlights: string[]; link: string | null }) {
  const desc = plain(p.description);
  return [
    `🔥 ${p.name.trim()} 🔥`,
    desc ? `\n${desc}` : "",
    p.highlights.length ? `\n${p.highlights.slice(0, 6).map((h) => `✅ ${h}`).join("\n")}` : "",
    p.price > 0 ? `\n💲 Precio: $${Math.round(p.price).toLocaleString("es-CO")}` : "",
    p.link ? `📲 Pídelo aquí: ${p.link}` : "",
  ].filter(Boolean).join("\n").trim();
}

export function PublishKit({ storeId, productId, onShared }: { storeId: string | null; productId: string; onShared: (channel: string) => void }) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const [{ data: p }, access] = await Promise.all([
        sb.from("products").select("name,description,price_1,price_3,image_url,product_details").eq("id", productId).eq("store_id", storeId).maybeSingle(),
        getDashboardStore().catch(() => null),
      ]);
      if (!alive || !p) return;
      const row = p as { name: string; description: string | null; price_1: number | null; price_3: number | null; image_url: string | null; product_details: unknown };
      const det = normalizeProductDetails(row.product_details);
      const slug = access?.store?.slug;
      const link = slug ? `${PRODUCTION_ORIGIN}/${slug}/producto/${productId}` : null;
      const images = [...new Set([row.image_url, ...det.gallery_urls].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)))];
      const t = buildPublishText({ name: row.name, description: row.description, price: Number(row.price_3 || row.price_1 || 0), highlights: det.highlights, link });
      setData({ text: t, images, name: row.name });
      setText(t);
    })();
    return () => { alive = false; };
  }, [storeId, productId]);

  async function files(limit = 4): Promise<File[]> {
    if (!data) return [];
    const out: File[] = [];
    for (const [i, url] of data.images.slice(0, limit).entries()) {
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        out.push(new File([blob], `${data.name.slice(0, 40).replace(/[^\w\- ]+/g, "").trim() || "producto"}-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" }));
      } catch { /* sin permiso para leer la foto: se omite */ }
    }
    return out;
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast("📋 Texto copiado. Cuando lo publiques toca «Lo acabo de publicar»", "info"); }
    catch { toast("No se pudo copiar", "error"); }
  }

  async function share() {
    setBusy("share");
    try {
      const f = await files();
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (!nav.share) { await copy(); return; }
      const withFiles = f.length && nav.canShare?.({ files: f }) ? { files: f, text } : { text };
      await nav.share(withFiles);
      onShared("otro");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast("No se pudo compartir", "error");
    } finally { setBusy(null); }
  }

  async function download() {
    if (!data?.images.length) return;
    setBusy("download");
    const f = await files(10);
    if (!f.length) {
      // La foto no deja leerse desde aquí: se abre para guardarla a mano.
      data.images.slice(0, 5).forEach((u) => window.open(u, "_blank", "noopener"));
    } else {
      for (const file of f) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      toast(`⬇️ ${f.length} foto${f.length === 1 ? "" : "s"} descargada${f.length === 1 ? "" : "s"}`);
    }
    setBusy(null);
  }

  function whatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    onShared("whatsapp");
  }

  const btn = "inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-bold transition hover:-translate-y-0.5 disabled:opacity-50";
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: "color-mix(in oklab, #ec4899 40%, var(--t-card-border))", background: "color-mix(in oklab, #ec4899 6%, transparent)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-black">
        <Sparkles size={14} className="text-pink-500" /> Kit para publicar
        <span className="font-normal" style={{ color: "var(--t-muted)" }}>· texto, fotos y WhatsApp listos</span>
        <motion.span className="ml-auto" animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={14} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-3 pb-3">
            {!data ? (
              <p className="flex items-center gap-2 py-3 text-[11px]" style={{ color: "var(--t-muted)" }}><Loader2 size={12} className="animate-spin" /> Preparando el texto…</p>
            ) : (
              <>
                {data.images.length ? (
                  <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                    {data.images.slice(0, 8).map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="h-14 w-14 shrink-0 rounded-lg border object-cover" style={{ borderColor: "var(--t-card-border)" }} />
                    ))}
                  </div>
                ) : <p className="mb-2 text-[11px] text-amber-500">⚠️ Este producto no tiene fotos.</p>}
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Texto para publicar"
                  className="w-full resize-y rounded-xl border p-2.5 text-xs leading-relaxed outline-none" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }} />
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <button type="button" className={btn} style={{ borderColor: "var(--t-card-border)" }} onClick={() => void copy()}><Copy size={13} /> Copiar</button>
                  <button type="button" className={btn} style={{ borderColor: "var(--t-card-border)" }} disabled={!!busy} onClick={() => void share()}>
                    {busy === "share" ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} Compartir
                  </button>
                  <button type="button" className={btn} style={{ borderColor: "var(--t-card-border)" }} disabled={!!busy || !data.images.length} onClick={() => void download()}>
                    {busy === "download" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Fotos
                  </button>
                  <button type="button" className={`${btn} border-transparent text-white`} style={{ background: "#25d366" }} onClick={whatsapp}><MessageCircle size={13} /> WhatsApp</button>
                </div>
                <p className="mt-1.5 text-[10px]" style={{ color: "var(--t-muted)" }}>Al compartir o abrir WhatsApp queda marcado como publicado solo.</p>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
