"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { openCommandPalette, openShortcuts } from "./CommandPalette";
import { HELP, helpFor } from "./tour/tours";
import { startTour } from "./tour/GuidedTour";

/**
 * Ayuda dentro del panel: consejos cortos de la pantalla donde estás, atajos y soporte por WhatsApp
 * con la tienda, la pantalla y el navegador ya escritos (así no hay que explicar desde cero).
 */

const SUPPORT = process.env.NEXT_PUBLIC_REMHUB_WHATSAPP || "573218846041";

/** Pantallas con ayuda (el administrador de RemHub les pone un video en «Videos de ayuda»). */
export const HELP_SCREENS = HELP.filter((g) => g.key !== "panel").map((g) => ({ key: g.key, title: g.title }));

/** Enlace para incrustar: YouTube y Vimeo como reproductor; un .mp4 directo como video. */
function embedOf(url: string): { kind: "iframe" | "video"; src: string } | null {
  try {
    const u = new URL(url);
    const yt = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.hostname.includes("youtube.com") ? (u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).pop() ?? "") : "";
    if (yt) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?rel=0` };
    if (u.hostname.includes("vimeo.com")) return { kind: "iframe", src: `https://player.vimeo.com/video/${u.pathname.split("/").filter(Boolean).pop()}` };
    if (/.(mp4|webm)$/i.test(u.pathname)) return { kind: "video", src: url };
    return null;
  } catch { return null; }
}

function guideFor(path: string, search: string) {
  return helpFor(path, search) ?? HELP[HELP.length - 1];
}

export function HelpButton({ storeName, userName }: { storeName?: string | null; userName?: string | null }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const guide = guideFor(pathname, search);
  const [video, setVideo] = useState<{ title: string; url: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().from("saas_help_videos").select("title,url").eq("screen", guide.key).maybeSingle()
      .then(({ data }) => { if (alive) setVideo((data as { title: string; url: string } | null) ?? null); });
    return () => { alive = false; };
  }, [open, guide.key]);
  const embed = video ? embedOf(video.url) : null;

  const support = () => {
    const text = [
      "Hola! Necesito ayuda con RemHub.",
      "",
      `• Tienda: ${storeName ?? "—"}`,
      `• Usuario: ${userName ?? "—"}`,
      `• Pantalla: ${guide.title} (${window.location.pathname}${window.location.search})`,
      `• Navegador: ${navigator.userAgent.includes("Mobile") ? "celular" : "computador"}`,
      "",
      "Lo que pasa: ",
    ].join("\n");
    window.open(`https://wa.me/${SUPPORT}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <>
      <button type="button" onClick={() => { setSearch(window.location.search); setOpen(true); }} title="Ayuda" aria-label="Ayuda"
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border text-sm font-black transition hover:-translate-y-0.5"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-muted)" }}>?</button>
      {mounted && open ? createPortal(
        <div className="fixed inset-0 z-[190] flex justify-end" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} style={{ background: "rgba(0,0,0,.45)" }}>
          <aside role="dialog" aria-modal="true" aria-label="Ayuda" className="flex h-dvh w-full max-w-sm flex-col border-l p-5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">💡 Ayuda · {guide.title}</h3>
              <button type="button" autoFocus onClick={() => setOpen(false)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar</button>
            </div>
            {video ? (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-bold">🎬 {video.title}</p>
                {embed?.kind === "iframe" ? (
                  <iframe src={embed.src} title={video.title} className="aspect-video w-full rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                ) : embed?.kind === "video" ? (
                  <video src={embed.src} controls playsInline className="aspect-video w-full rounded-xl border bg-black" style={{ borderColor: "var(--t-card-border)" }} />
                ) : (
                  <a href={video.url} target="_blank" rel="noreferrer" className="block rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>▶️ Ver el video</a>
                )}
              </div>
            ) : null}
            <ul className="mt-4 flex-1 space-y-2.5 overflow-y-auto text-sm">
              {guide.tips.map((t) => (
                <li key={t} className="flex gap-2 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}><span aria-hidden>✔️</span><span>{t}</span></li>
              ))}
            </ul>
            <div className="mt-4 space-y-2">
              {guide.steps.length ? (
                <button type="button" onClick={() => { setOpen(false); window.setTimeout(() => startTour(guide.key), 150); }} className="w-full rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>▶️ Mostrarme cómo ({guide.steps.length} pasos)</button>
              ) : null}
              <button type="button" onClick={() => { setOpen(false); openCommandPalette(); }} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>🔍 Buscar algo (Ctrl + K)</button>
              <button type="button" onClick={() => { setOpen(false); openShortcuts(); }} className="w-full rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⌨️ Ver atajos de teclado</button>
              <button type="button" onClick={support} className="w-full rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: "#16a34a" }}>💬 Hablar con soporte por WhatsApp</button>
              <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>El mensaje ya lleva tu tienda y la pantalla donde estás.</p>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
