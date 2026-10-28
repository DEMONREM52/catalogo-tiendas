"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { FloatingCode } from "./DevFx";

/**
 * Fondo «de programador» para la portada: red neuronal con pulsos y lluvia de código (canvas), cuadrícula en
 * perspectiva que avanza, luz que sigue al mouse y símbolos de código flotando. Más el título que se decodifica
 * y la cinta de commits. Todo decorativo (aria-hidden) y quieto con «reducir movimiento».
 * El canvas se pausa cuando la portada no está en pantalla o la pestaña está oculta.
 */

const HERO_CSS = `
@keyframes dh-spin { to { transform: rotate(360deg); } }
@keyframes dh-grid { from { background-position: 0 0; } to { background-position: 0 64px; } }
@keyframes dh-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes dh-shine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@keyframes dh-dots { 0%, 20% { opacity: .2; } 50% { opacity: 1; } 100% { opacity: .2; } }
@keyframes dh-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(236,72,153,.55); } 50% { box-shadow: 0 0 0 8px rgba(236,72,153,0); } }
.dh-orbit { animation: dh-spin 18s linear infinite; }
.dh-orbit-rev { animation: dh-spin 18s linear infinite reverse; }
.dh-grid { animation: dh-grid 1.6s linear infinite; }
.dh-marquee { animation: dh-marquee 45s linear infinite; }
.dh-shine { background-size: 200% 100%; animation: dh-shine 4s linear infinite; }
.dh-dot { animation: dh-dots 1.2s infinite; }
.dh-glow { animation: dh-glow 1.8s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .dh-orbit, .dh-orbit-rev, .dh-grid, .dh-marquee, .dh-shine, .dh-dot, .dh-glow { animation: none !important; } }
`;

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/* ------------------------------------------------------------------ fondo: red neuronal + lluvia de código */

function NeuralCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const CHARS = "01{}<>/=;()[]#$&|*+λ→⚡ABCDEF".split("");
    type Node = { x: number; y: number; vx: number; vy: number };
    type Drop = { x: number; y: number; v: number; chars: string[] };
    type Pulse = { a: number; b: number; t: number };
    let w = 0, h = 0, nodes: Node[] = [], drops: Drop[] = [], pulses: Pulse[] = [], raf = 0, visible = true, last = 0;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const setup = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(18, Math.min(64, Math.round((w * h) / 21000)));
      nodes = Array.from({ length: count }, () => ({ x: rnd(0, w), y: rnd(0, h), vx: rnd(-0.25, 0.25), vy: rnd(-0.25, 0.25) }));
      drops = [];
      for (let x = 14; x < w; x += 34) if (Math.random() < 0.38) drops.push({ x, y: rnd(-h, h), v: rnd(0.6, 1.6), chars: Array.from({ length: 9 }, () => CHARS[(Math.random() * CHARS.length) | 0]) });
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || now - last < 30) return;
      last = now;
      draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Lluvia de código.
      ctx.font = `13px ${MONO}`;
      for (const d of drops) {
        d.y += d.v;
        if (d.y - 9 * 16 > h) { d.y = rnd(-200, 0); d.chars = d.chars.map(() => CHARS[(Math.random() * CHARS.length) | 0]); }
        if (Math.random() < 0.04) d.chars[(Math.random() * d.chars.length) | 0] = CHARS[(Math.random() * CHARS.length) | 0];
        d.chars.forEach((c, i) => {
          ctx.fillStyle = i === 0 ? "rgba(165,243,252,.55)" : `rgba(168,85,247,${0.22 * (1 - i / d.chars.length)})`;
          ctx.fillText(c, d.x, d.y - i * 16);
        });
      }
      // Red neuronal.
      const max = 150;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      const near: Array<[number, number]> = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dd = Math.hypot(dx, dy);
        if (dd < max) {
          near.push([i, j]);
          ctx.strokeStyle = `rgba(168,85,247,${0.28 * (1 - dd / max)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
        }
      }
      for (const n of nodes) { ctx.fillStyle = "rgba(236,72,153,.75)"; ctx.beginPath(); ctx.arc(n.x, n.y, 1.8, 0, Math.PI * 2); ctx.fill(); }
      // Pulsos que viajan por la red (la «IA pensando»).
      if (near.length && pulses.length < 14 && Math.random() < 0.12) { const [a, b] = near[(Math.random() * near.length) | 0]; pulses.push({ a, b, t: 0 }); }
      pulses = pulses.filter((p) => {
        p.t += 0.025;
        const A = nodes[p.a], B = nodes[p.b];
        if (!A || !B || p.t >= 1) return false;
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, "rgba(103,232,249,.95)"); g.addColorStop(1, "rgba(103,232,249,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        return true;
      });
    };
    setup();
    const ro = new ResizeObserver(() => { setup(); if (still) draw(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    if (still) draw(); else raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full" />;
}

/* ------------------------------------------------------------------ título que se decodifica */

const GLYPHS = "!<>-_\\/[]{}=+*^?#01λ$&";
export function Scramble({ text, delay = 0 }: { text: string; delay?: number }) {
  const [out, setOut] = useState(text);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const start = performance.now() + delay;
    const dur = 900 + text.length * 18;
    const tick = (now: number) => {
      const p = Math.max(0, (now - start) / dur);
      const done = Math.floor(p * text.length);
      setOut(text.split("").map((c, i) => (i < done || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(""));
      if (p < 1) raf = requestAnimationFrame(tick); else setOut(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, still]);
  return <>{out}</>;
}

/* ------------------------------------------------------------------ cinta de commits */

const COMMITS = [
  ["a1f3c9e", "feat(pos)", "venta #1288 en Zamora"], ["7d2e01b", "feat(inventario)", "traslado #18 recibido con firma"],
  ["c0ffee1", "feat(ia)", "búsqueda de productos por foto"], ["9b8a7f2", "perf(catálogo)", "carga en 31 ms"],
  ["e4d5c6b", "feat(meta)", "Purchase sin duplicados"], ["3f2a1b0", "feat(nómina)", "vales descontados solos"],
  ["5ab9e21", "feat(landing)", "pedido contraentrega"], ["ff00aa3", "feat(dian)", "factura electrónica aceptada"],
  ["1b2c3d4", "feat(caja)", "cierre del día cuadrado"], ["8e9f0a1", "feat(pwa)", "funciona sin internet"],
];
export function CommitMarquee() {
  const row = [...COMMITS, ...COMMITS];
  return (
    <div aria-hidden className="relative mt-4 overflow-hidden border-y py-2.5 text-[12px]" style={{ borderColor: "rgba(168,85,247,.2)", fontFamily: MONO, maskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)" }}>
      <div className="dh-marquee flex w-max gap-8 whitespace-nowrap">
        {row.map(([h, scope, msg], i) => (
          <span key={i}><span className="text-amber-300">{h}</span> <span className="text-fuchsia-400">{scope}:</span> <span style={{ color: "#d4d4e0" }}>{msg}</span></span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fondo completo */

/** Envuelve la portada: pinta el fondo animado detrás y la luz que sigue al mouse. */
export function DevBackground({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={box} onPointerMove={onMove} className="relative isolate overflow-hidden" style={{ ["--mx" as string]: "50%", ["--my" as string]: "30%" }}>
      <style>{HERO_CSS}</style>
      <NeuralCanvas />
      {/* piso de cuadrícula en perspectiva */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[40%] overflow-hidden [perspective:420px]" style={{ maskImage: "linear-gradient(to top, #000 5%, transparent)", WebkitMaskImage: "linear-gradient(to top, #000 5%, transparent)" }}>
        <div className="dh-grid absolute inset-x-[-50%] bottom-[-30%] h-[160%] [transform:rotateX(62deg)]"
          style={{ backgroundImage: "linear-gradient(rgba(168,85,247,.32) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,.32) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
      </div>
      {/* luz del mouse */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1]" style={{ background: "radial-gradient(600px circle at var(--mx) var(--my), rgba(168,85,247,.24), rgba(236,72,153,.08) 30%, transparent 55%)" }} />
      <FloatingCode />
      {children}
    </div>
  );
}
