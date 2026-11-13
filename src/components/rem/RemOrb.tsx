"use client";

/**
 * La esfera de REM: burbuja de cristal morada que flota sobre todo el panel (también sobre las ventanas).
 *   · Respira en reposo, se ilumina y crece con la voz (micrófono en computador, lo reconocido en celular),
 *     late con cada palabra que REM dice y gira rápido mientras piensa.
 *   · Se arrastra a donde estorbe menos (queda guardado en este equipo).
 *   · Tocarla abre o cierra la conversación; si REM está hablando, tocarla lo calla y te escucha.
 */

import { useEffect, useRef, useState } from "react";
import { voiceLevel } from "@/lib/voice/speech";

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";
export type OrbPlace = { cx: number; cy: number; size: number };

const POS_KEY = "remhub:rem-orb-pos";
const GAP = 8;

type Pos = { r: number; b: number };

function readPos(): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as Pos | null;
    return v && Number.isFinite(v.r) && Number.isFinite(v.b) ? v : null;
  } catch { return null; }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function RemOrb({ phase, awake, onTap, onPlace, caption, label }: {
  phase: OrbPhase;
  /** Esperando que la llamen («Rem»): puntico verde. */
  awake: boolean;
  onTap: () => void;
  onPlace: (p: OrbPlace) => void;
  /** Texto corto junto a la esfera (lo que oye o dice) cuando la conversación está cerrada. */
  caption: string | null;
  label: string;
}) {
  const root = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef(phase);
  const [pos, setPos] = useState<Pos>({ r: 20, b: 24 });
  const [view, setView] = useState({ w: 1280, h: 800 });
  const drag = useRef<{ sx: number; sy: number; r0: number; b0: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const size = view.w < 640 ? 58 : 66;

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const w = window.innerWidth;
      setView({ w, h: window.innerHeight });
      setPos(readPos() ?? { r: 16, b: w < 640 ? 96 : 24 });
    }, 0);
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, []);

  // Siempre dentro de la pantalla (aunque se achique la ventana).
  const r = clamp(pos.r, GAP, view.w - size - GAP);
  const b = clamp(pos.b, GAP, view.h - size - GAP);

  useEffect(() => { onPlace({ cx: view.w - r - size / 2, cy: view.h - b - size / 2, size }); }, [r, b, size, view.w, view.h, onPlace]);

  // La animación con la voz: un valor --lvl (0 a 1) que mueve tamaño, brillo y halo. Sin re-render de React.
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const tick = (t: number) => {
      const ph = phaseRef.current;
      const heard = voiceLevel();
      let target: number;
      if (ph === "speaking") target = Math.max(heard, 0.3 + 0.13 * Math.sin(t / 90) + 0.07 * Math.sin(t / 33));
      else if (ph === "listening") target = Math.max(heard, 0.12 + 0.04 * Math.sin(t / 280));
      else if (ph === "thinking") target = 0.18 + 0.08 * Math.sin(t / 150);
      else target = Math.max(heard * 0.5, 0.05 + 0.05 * Math.sin(t / 950));
      shown += (target - shown) * (target > shown ? 0.32 : 0.1);
      root.current?.style.setProperty("--lvl", (reduce ? Math.min(shown, 0.15) : shown).toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function down(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, r0: r, b0: b, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 7) return;
    d.moved = true;
    setPos({ r: clamp(d.r0 - dx, GAP, view.w - size - GAP), b: clamp(d.b0 - dy, GAP, view.h - size - GAP) });
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    suppress.current = true;
    setPos((p) => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
      return p;
    });
  }

  const left = view.w - r - size / 2 > view.w / 2; // la esfera está a la derecha: el texto sale a la izquierda
  const above = view.h - b - size / 2 > view.h * 0.75;

  return (
    <>
      <style>{ORB_CSS}</style>
      <button ref={root} type="button" className="rem-orb" data-phase={phase} aria-label={label} title={label}
        style={{ right: r, bottom: b, width: size, height: size }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
        onClick={() => { if (suppress.current) { suppress.current = false; return; } onTap(); }}>
        <span className="rem-orb-glow" aria-hidden />
        <span className="rem-orb-ball" aria-hidden>
          <span className="rem-orb-blob a" />
          <span className="rem-orb-blob b" />
          <span className="rem-orb-swirl" />
          <span className="rem-orb-shine" />
        </span>
        {phase === "listening" ? <span className="rem-orb-ring" aria-hidden /> : null}
        {awake && phase === "idle" ? <span className="rem-orb-awake" aria-hidden /> : null}
      </button>
      {caption ? (
        <div className="rem-orb-cap" role="status" aria-live="polite"
          style={{
            right: left ? r + size + 10 : undefined,
            left: left ? undefined : view.w - r + 10,
            bottom: above ? undefined : b + size / 2 - 18,
            top: above ? view.h - b - size / 2 - 18 : undefined,
          }}>
          {caption}
        </div>
      ) : null}
    </>
  );
}

const ORB_CSS = `
.rem-orb{position:fixed;z-index:2147483000;--lvl:0;padding:0;border:0;border-radius:9999px;background:transparent;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.rem-orb:focus-visible{outline:2px solid #c4b5fd;outline-offset:5px}
.rem-orb-glow{position:absolute;inset:-38%;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(168,85,247,.6) 0%,rgba(236,72,153,.22) 42%,transparent 70%);filter:blur(10px);opacity:calc(.3 + var(--lvl) * 1.1);transform:scale(calc(.8 + var(--lvl) * .8))}
.rem-orb-ball{position:absolute;inset:0;border-radius:50%;overflow:hidden;transform:scale(calc(1 + var(--lvl) * .17));
  background:radial-gradient(circle at 50% 58%,#b46cff 0%,#7c3aed 46%,#3b0764 100%);
  box-shadow:inset 0 -11px 20px rgba(30,7,60,.7),inset 0 7px 14px rgba(255,255,255,.38),inset 0 0 0 1px rgba(255,255,255,.28),0 12px 30px rgba(109,40,217,.55)}
.rem-orb-blob{position:absolute;border-radius:50%;filter:blur(6px);mix-blend-mode:screen;opacity:calc(.55 + var(--lvl) * .6)}
.rem-orb-blob.a{width:70%;height:70%;left:-8%;top:30%;background:radial-gradient(circle,rgba(236,72,153,.9),transparent 65%);animation:rem-float-a 6s ease-in-out infinite}
.rem-orb-blob.b{width:65%;height:65%;right:-10%;top:-6%;background:radial-gradient(circle,rgba(129,140,248,.9),transparent 65%);animation:rem-float-b 7.5s ease-in-out infinite}
.rem-orb-swirl{position:absolute;inset:-22%;border-radius:50%;mix-blend-mode:screen;filter:blur(3px);opacity:calc(.35 + var(--lvl) * .6);
  background:conic-gradient(from 0deg,transparent 0 10%,rgba(255,255,255,.4) 17%,transparent 28%,rgba(244,114,182,.5) 46%,transparent 60%,rgba(196,181,253,.6) 79%,transparent 92%);animation:rem-spin 9s linear infinite}
.rem-orb[data-phase=listening] .rem-orb-swirl{animation-duration:3.6s}
.rem-orb[data-phase=speaking] .rem-orb-swirl{animation-duration:2.4s}
.rem-orb[data-phase=thinking] .rem-orb-swirl{animation-duration:1.1s}
.rem-orb-shine{position:absolute;left:17%;top:10%;width:38%;height:24%;border-radius:50%;transform:rotate(-22deg);background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,0))}
.rem-orb-ring{position:absolute;inset:0;border-radius:50%;pointer-events:none;border:2px solid rgba(196,181,253,.75);animation:rem-ring 1.5s ease-out infinite}
.rem-orb-awake{position:absolute;right:4%;bottom:4%;width:12px;height:12px;border-radius:50%;background:#10b981;box-shadow:0 0 0 2px rgba(255,255,255,.85),0 0 10px rgba(16,185,129,.8)}
.rem-orb-cap{position:fixed;z-index:2147483000;max-width:min(270px,calc(100vw - 110px));padding:8px 12px;border-radius:16px;font-size:12.5px;line-height:1.35;font-weight:600;color:#f5f3ff;pointer-events:none;
  background:linear-gradient(135deg,rgba(76,29,149,.82),rgba(30,10,60,.82));border:1px solid rgba(196,181,253,.35);box-shadow:0 10px 30px rgba(30,7,60,.45);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;animation:rem-cap-in .18s ease-out}
@keyframes rem-spin{to{transform:rotate(360deg)}}
@keyframes rem-ring{from{transform:scale(1);opacity:.85}to{transform:scale(1.75);opacity:0}}
@keyframes rem-float-a{0%,100%{transform:translate(0,0)}50%{transform:translate(28%,-18%)}}
@keyframes rem-float-b{0%,100%{transform:translate(0,0)}50%{transform:translate(-26%,24%)}}
@keyframes rem-cap-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.rem-orb-swirl,.rem-orb-ring,.rem-orb-blob{animation:none}}
@media print{.rem-orb,.rem-orb-cap,.rem-panel{display:none!important}}
`;
