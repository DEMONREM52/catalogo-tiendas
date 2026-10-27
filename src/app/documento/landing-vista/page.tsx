"use client";

import { useEffect, useState } from "react";
import { LandingView, type LandingData } from "@/app/[slug]/oferta/[page]/LandingView";

type Mode = "edit" | "test";
type Box = { top: number; left: number; width: number; height: number; label: string } | null;

/**
 * Vista previa de una landing dentro del editor (en un marco, para que la barra fija,
 * el botón de WhatsApp y las ventanas se vean como en el celular). Recibe los datos del
 * editor por postMessage (solo del mismo sitio). No registra visitas ni crea pedidos.
 *   · Modo editar: al pasar el mouse se resalta cada parte con su nombre; al tocarla,
 *     el editor abre la sección donde se cambia.
 *   · Modo probar: funciona como para el cliente.
 */
export default function LandingPreviewPage() {
  const [data, setData] = useState<LandingData | null>(null);
  const [key, setKey] = useState(0);
  const [mode, setMode] = useState<Mode>("edit");
  const [box, setBox] = useState<Box>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; data?: LandingData; reset?: boolean; mode?: Mode } | null;
      if (msg?.type === "remhub-landing-mode" && (msg.mode === "edit" || msg.mode === "test")) { setMode(msg.mode); setBox(null); return; }
      if (msg?.type !== "remhub-landing-preview" || !msg.data) return;
      setData(msg.data);
      if (msg.mode) setMode(msg.mode);
      if (msg.reset) setKey((k) => k + 1);
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "remhub-landing-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Modo editar: se atrapan los toques antes que la página y se le dice al editor qué abrir.
  useEffect(() => {
    if (mode !== "edit") return;
    const target = (ev: Event) => (ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-edit]") : null);
    const onClick = (ev: MouseEvent) => {
      const el = target(ev);
      ev.preventDefault();
      ev.stopPropagation();
      if (el?.dataset.edit) window.parent?.postMessage({ type: "remhub-landing-edit", target: el.dataset.edit }, window.location.origin);
    };
    const onMove = (ev: Event) => {
      const el = target(ev);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height, label: el.dataset.editLabel ?? "Editar" });
    };
    const hide = () => setBox(null);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("touchstart", onMove, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("touchstart", onMove, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, [mode]);

  if (!data) return <main className="grid min-h-screen place-items-center bg-white text-sm text-slate-400">Cargando vista previa…</main>;
  return (
    <>
      <LandingView key={key} data={data} preview editMode={mode === "edit"} />
      {mode === "edit" && box ? (
        <div className="pointer-events-none fixed z-100 rounded-xl border-2 border-dashed" style={{ top: box.top - 3, left: box.left - 3, width: box.width + 6, height: box.height + 6, borderColor: "#7c3aed", background: "rgba(124,58,237,.07)" }}>
          <span className="absolute -top-3 left-2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white shadow" style={{ background: "#7c3aed" }}>✏️ {box.label} · toca para editar</span>
        </div>
      ) : null}
    </>
  );
}
