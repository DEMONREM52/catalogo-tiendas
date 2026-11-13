"use client";

import { useSyncExternalStore } from "react";
import { voiceSupported } from "@/lib/voice/speech";
import { callRem } from "@/lib/voice/rem";

/**
 * 🎙️ REM dentro de una ventana que tapa el encabezado (p. ej. Nuevo pedido interno).
 * Hace lo mismo que el botón REM de arriba. No aparece si el navegador no tiene voz.
 */
export function RemCallButton({ className = "" }: { className?: string }) {
  const supported = useSyncExternalStore(() => () => {}, voiceSupported, () => false);
  if (!supported) return null;
  return (
    <button type="button" onClick={callRem} title="Hablar con REM" aria-label="Hablar con REM"
      className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition hover:-translate-y-0.5 ${className}`}
      style={{ borderColor: "color-mix(in oklab, var(--t-accent, #8b5cf6) 45%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent, #8b5cf6) 10%, transparent)", color: "var(--t-text)" }}>
      <span aria-hidden>🎙️</span> REM
    </button>
  );
}
