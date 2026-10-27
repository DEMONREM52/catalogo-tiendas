"use client";

import { useEffect, useState } from "react";
import { LandingView, type LandingData } from "@/app/[slug]/oferta/[page]/LandingView";

/**
 * Vista previa de una landing dentro del editor (en un marco, para que la barra fija,
 * el botón de WhatsApp y las ventanas se vean como en el celular). Recibe los datos del
 * editor por postMessage (solo del mismo sitio). No registra visitas ni crea pedidos.
 */
export default function LandingPreviewPage() {
  const [data, setData] = useState<LandingData | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; data?: LandingData; reset?: boolean } | null;
      if (msg?.type !== "remhub-landing-preview" || !msg.data) return;
      setData(msg.data);
      if (msg.reset) setKey((k) => k + 1);
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "remhub-landing-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!data) return <main className="grid min-h-screen place-items-center bg-white text-sm text-slate-400">Cargando vista previa…</main>;
  return <LandingView key={key} data={data} preview />;
}
