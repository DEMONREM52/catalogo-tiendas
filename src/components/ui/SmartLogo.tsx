"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, type CSSProperties } from "react";

/**
 * Logo que se ve en tema claro y oscuro.
 * Muchos logos son blancos (o negros) con fondo transparente: sobre un fondo del mismo tono desaparecen.
 * Se mira la imagen una vez (en un canvas pequeño):
 *   · con transparencia y trazos CLAROS → se muestra sobre un fondo oscuro;
 *   · con transparencia y trazos OSCUROS → sobre un fondo claro;
 *   · sin transparencia (logo con su propio fondo) → tal cual.
 * El resultado se guarda por imagen (memoria y localStorage). Si la imagen no deja leerse (CORS), se usa un
 * fondo neutro que funciona con ambos casos.
 */
type Tone = "light" | "dark" | "solid" | "unknown";
const memo = new Map<string, Tone>();
const KEY = "remhub:logo-tone:";

function readTone(url: string): Tone | null {
  if (memo.has(url)) return memo.get(url)!;
  try { const v = window.localStorage.getItem(KEY + url) as Tone | null; if (v) { memo.set(url, v); return v; } } catch { /* sin almacenamiento */ }
  return null;
}
function saveTone(url: string, t: Tone) {
  memo.set(url, t);
  try { window.localStorage.setItem(KEY + url, t); } catch { /* sin almacenamiento */ }
}

function analyze(url: string): Promise<Tone> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const n = 32;
        const c = document.createElement("canvas");
        c.width = n; c.height = n;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve("unknown");
        ctx.drawImage(img, 0, 0, n, n);
        const d = ctx.getImageData(0, 0, n, n).data;
        let transparent = 0, opaque = 0, lum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255;
          if (a < 0.3) { transparent++; continue; }
          opaque++;
          lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
        const total = n * n;
        if (transparent / total < 0.12 || !opaque) return resolve("solid");
        const avg = lum / opaque;
        resolve(avg > 0.72 ? "light" : avg < 0.28 ? "dark" : "solid");
      } catch {
        resolve("unknown"); // la imagen no deja leerse (CORS)
      }
    };
    img.onerror = () => resolve("unknown");
    img.src = url;
  });
}

export function SmartLogo({ src, alt = "", size = 40, rounded = "rounded-xl", className = "", fallback, style }: {
  src: string | null | undefined; alt?: string; size?: number; rounded?: string; className?: string; fallback?: React.ReactNode; style?: CSSProperties;
}) {
  const [tone, setTone] = useState<Tone | null>(null);
  useEffect(() => {
    if (!src) return;
    const known = readTone(src);
    if (known) { const t = window.setTimeout(() => setTone(known), 0); return () => window.clearTimeout(t); }
    let alive = true;
    void analyze(src).then((t) => { if (t !== "unknown") saveTone(src, t); if (alive) setTone(t); });
    return () => { alive = false; };
  }, [src]);

  const bg = tone === "light" ? "linear-gradient(135deg, #1a1030, #0b0716)"
    : tone === "dark" ? "linear-gradient(135deg, #ffffff, #f1f0f7)"
    : tone === "unknown" ? "linear-gradient(135deg, #3b2a5c, #1a1030)"
    : "transparent";
  const pad = tone === "light" || tone === "dark" || tone === "unknown";
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden ${rounded} ${className}`}
      style={{ width: size, height: size, background: src ? bg : undefined, boxShadow: pad ? "inset 0 0 0 1px rgba(128,128,128,.25)" : undefined, ...style }}>
      {src ? (
        <img src={src} alt={alt} className={pad ? "h-[86%] w-[86%] object-contain" : "h-full w-full object-cover"} loading="lazy" />
      ) : fallback}
    </span>
  );
}

/** Logo de RemHub (blanco y transparente): siempre sobre su círculo oscuro con brillo. */
export function RemhubMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-[#0b0716] shadow-[0_0_22px_rgba(168,85,247,.45)] ring-2 ring-brand/40 ${className}`} style={{ width: size, height: size }}>
      <img src={size > 64 ? "/remhub-icon-256.png" : "/remhub-icon-128.png"} alt="" className="h-[92%] w-[92%] object-contain" />
    </span>
  );
}
