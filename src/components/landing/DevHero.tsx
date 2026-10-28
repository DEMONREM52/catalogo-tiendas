"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles, Store } from "lucide-react";
import { Caret, DevFxStyles, FloatingCode, TerminalTyper } from "./DevFx";

/**
 * Portada de RemHub con estilo de editor de código e IA: red neuronal y lluvia de código en el fondo,
 * título que se «decodifica», editor con pestañas que se escribe solo, terminal con registros en vivo,
 * asistente de IA, cinta de commits y cifras como objeto de código.
 * La portada es una «isla oscura» en ambos temas (así se ve como un editor). Todo lo animado es decorativo
 * (aria-hidden); el título y los botones son texto real. Con «reducir movimiento» queda quieto.
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

const INK = "#f5f3ff";
const MUTED = "#a1a1b5";
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
function Scramble({ text, delay = 0 }: { text: string; delay?: number }) {
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

/* ------------------------------------------------------------------ logo que saluda, con órbita de código */

function WavingLogo() {
  const still = useReducedMotion();
  const wave = { duration: 1.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" as const };
  const tokens = ["</>", "{ }", "=>", "λ", "#", "()"];
  return (
    <div className="relative shrink-0 p-3 sm:p-4">
      <div aria-hidden className="dh-orbit pointer-events-none absolute inset-0 rounded-full border border-dashed [--orbit-r:52px] sm:[--orbit-r:72px] lg:[--orbit-r:88px]" style={{ borderColor: "rgba(168,85,247,.45)" }}>
        {tokens.map((t, i) => (
          <span key={t} className="absolute left-1/2 top-1/2" style={{ transform: `rotate(${(360 / tokens.length) * i}deg) translateY(-50%) translateX(var(--orbit-r))` }}>
            <span className="dh-orbit-rev block -translate-x-1/2 -translate-y-1/2 rounded-md px-1 text-[10px] font-black sm:text-xs" style={{ fontFamily: MONO, color: ["#a855f7", "#ec4899", "#22d3ee", "#34d399", "#f59e0b", "#a855f7"][i], background: "#0b0716", textShadow: "0 0 10px currentColor" }}>{t}</span>
          </span>
        ))}
      </div>
      <motion.span
        initial={{ opacity: 0, scale: 0.4, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.9, type: "spring", stiffness: 320, damping: 18 }}
        className="absolute -right-2 top-0 z-10 whitespace-nowrap rounded-full rounded-bl-sm px-2.5 py-1 text-xs font-black text-white shadow-lg sm:-right-4 sm:text-sm"
        style={{ background: "var(--t-cta)" }}
      >
        ¡Hola!
      </motion.span>
      <motion.div
        className="grid h-20 w-20 place-items-center rounded-full bg-[#0b0716] shadow-[0_0_50px_rgba(168,85,247,.6)] ring-4 ring-fuchsia-500/40 sm:h-28 sm:w-28 lg:h-36 lg:w-36"
        style={{ transformOrigin: "50% 90%" }}
        animate={still ? undefined : { rotate: [0, -9, 11, -7, 9, -3, 0] }}
        transition={wave}
      >
        <Image src="/remhub-icon-256.png" alt="RemHub" width={144} height={144} priority className="h-[92%] w-[92%] object-contain" />
      </motion.div>
      <motion.span
        aria-hidden
        className="absolute bottom-1 right-0 text-3xl sm:text-4xl"
        style={{ transformOrigin: "70% 85%", display: "inline-block" }}
        animate={still ? undefined : { rotate: [0, 22, -10, 22, -6, 16, 0] }}
        transition={wave}
      >
        👋
      </motion.span>
    </div>
  );
}

/* ------------------------------------------------------------------ editor con pestañas que se escribe solo */

type File = { name: string; badge: string; color: string; code: string };
const FILES: File[] = [
  {
    name: "ventas.ts", badge: "TS", color: "#3b82f6",
    code: `import { RemHub } from "remhub";

const tienda = await RemHub.abrir("la-vitrina");

// cada venta descuenta el inventario del punto
tienda.pos.on("venta", async (v) => {
  await inventario.descontar(v.punto, v.items);
  await caja.registrar(v.total, v.metodo);
  avisar.equipo(\`Venta #\${v.numero} ✓\`);
});`,
  },
  {
    name: "asistente.ia", badge: "IA", color: "#ec4899",
    code: `// RemHub IA mira tus datos y te avisa
const ideas = await ia.analizar({
  ventas: "últimos 30 días",
  inventario: "todas las sedes",
  pauta: "Meta Ads",
});

ideas.forEach((idea) => panel.mostrar(idea));
// → 3 sugerencias de compra
// → 2 precios por debajo del costo`,
  },
  {
    name: "inventario.sql", badge: "SQL", color: "#f59e0b",
    code: `SELECT p.nombre, s.punto, s.cantidad
FROM existencias s
JOIN productos p ON p.id = s.producto
WHERE s.cantidad < p.minimo
ORDER BY s.cantidad ASC;

-- 4 filas · 12 ms`,
  },
  {
    name: "pixel.ts", badge: "TS", color: "#22d3ee",
    code: `// landing → pedido → Meta (sin duplicados)
const pedido = await landing.pedir(cliente);

pixel.track("Purchase", {
  value: pedido.total,
  currency: "COP",
}, { eventID: pedido.evento });

await capi.enviar(pedido); // servidor ✓`,
  },
];

const KEYWORDS = /^(const|let|await|async|import|from|export|function|return|if|new|true|false|SELECT|FROM|JOIN|ON|WHERE|ORDER|BY|ASC|DESC|AND|forEach)$/;
const TOKEN = /(\/\/.*$|--.*$|"[^"]*"?|'[^']*'?|`[^`]*`?|\b\d+\b|\b[A-Za-z_áéíóúñ]\w*\b|[{}()[\];,.=<>+\-*/:?!&|→✓]+|\s+)/g;
function paint(line: string) {
  const out: Array<{ t: string; c?: string }> = [];
  const parts = line.match(TOKEN) ?? [line];
  parts.forEach((t, i) => {
    let c: string | undefined;
    if (/^(\/\/|--)/.test(t)) c = "#6b7280";
    else if (/^["'`]/.test(t)) c = "#86efac";
    else if (/^\d+$/.test(t)) c = "#fcd34d";
    else if (KEYWORDS.test(t)) c = "#f472b6";
    else if (/^[A-Za-z_]/.test(t) && parts[i + 1]?.startsWith("(")) c = "#67e8f9";
    else if (/^[{}()[\];,.=<>+\-*/:?!&|→]+$/.test(t)) c = "#c4b5fd";
    out.push({ t, c });
  });
  return out;
}

const LOGS: Array<[string, string]> = [
  ["#34d399", "✓ compilado en 4.2 s · 0 errores"],
  ["#67e8f9", "→ POST /api/pedido · 201 · 84 ms"],
  ["#a855f7", "⚡ IA: 3 sugerencias nuevas"],
  ["#34d399", "✓ traslado #18: Bodega → Zamora (+20)"],
  ["#67e8f9", "→ Meta CAPI · Purchase · 200"],
  ["#34d399", "✓ factura electrónica FE-1042 aceptada"],
  ["#67e8f9", "→ GET /catalogo/por-mayor · 200 · 31 ms"],
  ["#f59e0b", "▲ deploy remhub.co · listo"],
  ["#34d399", "✓ copia de seguridad cifrada · 2.1 MB"],
];

function useClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    const t0 = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 1000);
    return () => { window.clearTimeout(t0); window.clearInterval(t); };
  }, []);
  return now;
}

function Ide() {
  const still = useReducedMotion();
  const [tab, setTab] = useState(0);
  const [n, setN] = useState(0);
  const [logs, setLogs] = useState<number[]>([0, 1, 2]);
  const clock = useClock();
  const file = FILES[tab];
  const shown = still ? file.code : file.code.slice(0, n);
  const lines = shown.split("\n");

  useEffect(() => {
    if (still) return;
    const done = n >= file.code.length;
    const t = window.setTimeout(() => {
      if (!done) setN((x) => Math.min(file.code.length, x + 2 + (x % 3)));
      else { setTab((x) => (x + 1) % FILES.length); setN(0); }
    }, done ? 2600 : 22);
    return () => window.clearTimeout(t);
  }, [n, file.code.length, still]);

  useEffect(() => {
    if (still) return;
    const t = window.setInterval(() => setLogs((l) => [...l.slice(-3), (l[l.length - 1] + 1) % LOGS.length]), 1300);
    return () => window.clearInterval(t);
  }, [still]);

  return (
    <div aria-hidden className="relative overflow-hidden rounded-2xl border shadow-[0_30px_90px_rgba(0,0,0,.6)]" style={{ borderColor: "rgba(168,85,247,.35)", background: "#0b0716", color: "#e5e7eb", fontFamily: MONO }}>
      {/* barra de título y pestañas */}
      <div className="flex items-center gap-1.5 border-b px-3 pt-2" style={{ borderColor: "rgba(255,255,255,.08)", background: "#08050f" }}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="mr-2 h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <div className="flex min-w-0 gap-0.5 overflow-hidden">
          {FILES.map((f, i) => (
            <span key={f.name} className="relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-[11px] transition" style={{ background: i === tab ? "#0b0716" : "transparent", color: i === tab ? "#fff" : "#6b7280" }}>
              <b className="text-[9px]" style={{ color: f.color }}>{f.badge}</b>{f.name}
              {i === tab ? <motion.span layoutId="dh-tab" className="absolute inset-x-0 top-0 h-0.5" style={{ background: "var(--t-cta)" }} /> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="flex">
        {/* explorador */}
        <div className="hidden w-36 shrink-0 border-r py-2 text-[11px] sm:block" style={{ borderColor: "rgba(255,255,255,.06)", background: "#09060f", color: "#9ca3af" }}>
          <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Explorador</p>
          <p className="px-3 py-0.5">▾ mi-tienda</p>
          {FILES.map((f, i) => (
            <p key={f.name} className="py-0.5 pl-6 pr-2" style={{ background: i === tab ? "rgba(168,85,247,.18)" : undefined, color: i === tab ? "#fff" : undefined }}>
              <b className="mr-1 text-[9px]" style={{ color: f.color }}>{f.badge}</b>{f.name}
            </p>
          ))}
          <p className="px-3 py-0.5">▸ landings</p>
          <p className="px-3 py-0.5">▸ nómina</p>
        </div>
        {/* código */}
        <div className="h-[262px] min-w-0 flex-1 overflow-hidden px-3 py-3 text-[11.5px] leading-[1.6] sm:h-[282px] sm:text-[12.5px]">
          {lines.map((line, li) => (
            <div key={li} className="flex whitespace-pre">
              <span className="mr-3 w-5 shrink-0 select-none text-right text-slate-600">{li + 1}</span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
                {paint(line).map((p, pi) => <span key={pi} style={{ color: p.c }}>{p.t}</span>)}
                {li === lines.length - 1 ? <span className="dfx-caret ml-px inline-block h-[1.1em] w-[0.5em] translate-y-[0.2em] bg-fuchsia-400" /> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* terminal */}
      <div className="border-t px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: "rgba(255,255,255,.08)", background: "#07040c" }}>
        <p className="mb-1 flex gap-3 text-[9px] font-bold uppercase tracking-widest text-slate-500"><span className="text-white">Terminal</span><span>Problemas</span><span>Salida</span></p>
        {logs.map((l, i) => (
          <motion.p key={`${l}-${i}-${logs.length}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="truncate" style={{ color: LOGS[l][0] }}>
            {LOGS[l][1]}
          </motion.p>
        ))}
      </div>
      {/* barra de estado */}
      <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap px-3 py-1 text-[10px] text-white" style={{ background: "linear-gradient(90deg,#7c3aed,#db2777)" }}>
        <span>⎇ main</span><span>● 0 errores</span><span className="hidden sm:inline">⚡ IA activa</span>
        <span className="ml-auto hidden sm:inline">UTF-8</span><span>TypeScript</span><span className="tabular-nums">{clock ?? "--:--:--"}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ asistente de IA (avisos de funciones reales) */

const TIPS = [
  "Según lo vendido, te faltan 20 «Audífonos ANC» en Zamora. Te dejé lista la sugerencia de compra.",
  "Ojo: 3 productos se están vendiendo por debajo del costo en San Roque.",
  "Encontré el producto por la foto: AUDÍFONOS 2DA GEN ANC · 14 en existencia.",
  "Tu landing convierte 4,8 % y cada pedido te costó $6.200 en Meta.",
];

function Copilot() {
  const still = useReducedMotion();
  const [i, setI] = useState(0);
  const [w, setW] = useState(0);
  const words = TIPS[i % TIPS.length].split(" ");
  const done = still || w >= words.length;
  useEffect(() => {
    if (still) return;
    const t = window.setTimeout(() => {
      if (w < words.length) setW(w + 1);
      else { setI(i + 1); setW(0); }
    }, w === 0 ? 1100 : w < words.length ? 90 : 3600);
    return () => window.clearTimeout(t);
  }, [i, w, words.length, still]);
  return (
    <div aria-hidden className="w-full max-w-sm rounded-2xl border p-3.5 shadow-[0_20px_60px_rgba(0,0,0,.55)] backdrop-blur-md" style={{ borderColor: "rgba(236,72,153,.45)", background: "rgba(13,8,24,.92)", color: INK }}>
      <div className="flex items-center gap-2 text-xs font-black">
        <span className="dh-glow grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: "var(--t-cta)" }}><Sparkles size={14} /></span>
        RemHub IA
        <span className="ml-auto text-[10px] font-semibold" style={{ color: MUTED, fontFamily: MONO }}>{w === 0 && !still ? "pensando" : "en vivo"}{w === 0 && !still ? <><span className="dh-dot">.</span><span className="dh-dot" style={{ animationDelay: ".2s" }}>.</span><span className="dh-dot" style={{ animationDelay: ".4s" }}>.</span></> : null}</span>
      </div>
      <p className="mt-2 min-h-[3.6em] text-[13px] leading-snug">{(still ? words : words.slice(0, w)).join(" ")}{!done ? <span className="dfx-caret ml-0.5 inline-block h-[1em] w-[0.45em] translate-y-[0.15em] bg-fuchsia-400" /> : null}</p>
      <div className="mt-2.5 flex gap-2 text-[11px] font-bold" style={{ opacity: done ? 1 : 0.35, transition: "opacity .3s" }}>
        <span className="rounded-lg px-3 py-1.5 text-white" style={{ background: "var(--t-cta)" }}>Ver</span>
        <span className="rounded-lg border px-3 py-1.5" style={{ borderColor: "rgba(255,255,255,.15)", color: MUTED }}>Después</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cinta de commits */

const COMMITS = [
  ["a1f3c9e", "feat(pos)", "venta #1288 en Zamora"], ["7d2e01b", "feat(inventario)", "traslado #18 recibido con firma"],
  ["c0ffee1", "feat(ia)", "búsqueda de productos por foto"], ["9b8a7f2", "perf(catálogo)", "carga en 31 ms"],
  ["e4d5c6b", "feat(meta)", "Purchase sin duplicados"], ["3f2a1b0", "feat(nómina)", "vales descontados solos"],
  ["5ab9e21", "feat(landing)", "pedido contraentrega"], ["ff00aa3", "feat(dian)", "factura electrónica aceptada"],
  ["1b2c3d4", "feat(caja)", "cierre del día cuadrado"], ["8e9f0a1", "feat(pwa)", "funciona sin internet"],
];
function CommitMarquee() {
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

/* ------------------------------------------------------------------ cifras como objeto de código */

function Count({ to, active }: { to: number; active: boolean }) {
  const [v, setV] = useState(0);
  const still = useReducedMotion();
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = still ? 1 : Math.min(1, (now - start) / 1200);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, to, still]);
  return <>{v}</>;
}

function Metrics() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const items: Array<{ k: string; v: React.ReactNode; c: string }> = [
    { k: "catalogos", v: "∞", c: "infinitos, uno por público" },
    { k: "listas_de_precios", v: <Count to={5} active={inView} />, c: "detal, mayor y más" },
    { k: "firmas_por_traslado", v: <Count to={4} active={inView} />, c: "de bodega a punto" },
    { k: "pedidos_whatsapp", v: "\"24/7\"", c: "tu catálogo no duerme" },
  ];
  return (
    <div ref={ref} className="mx-auto mt-8 max-w-6xl px-5">
      <div className="overflow-hidden rounded-[1.6rem] border p-5 sm:p-6" style={{ borderColor: "rgba(168,85,247,.3)", background: "rgba(11,7,22,.85)", fontFamily: MONO }}>
        <p className="text-sm"><span className="text-pink-400">const</span> <span className="text-cyan-300">remhub</span> <span className="text-violet-300">=</span> <span className="text-violet-300">{"{"}</span></p>
        <div className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((it) => (
            <div key={it.k} className="rounded-xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)" }}>
              <p className="truncate text-[11px] text-slate-400">{it.k}:</p>
              <p className="dh-shine text-3xl font-black sm:text-4xl" style={{ backgroundImage: "linear-gradient(90deg,#a855f7,#ec4899,#22d3ee,#a855f7)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{it.v}</p>
              <p className="truncate text-[10px] text-slate-500">{"// "}{it.c}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-violet-300">{"};"} <span className="text-slate-500">{"// listo para vender"}</span></p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ portada */

export function DevHero({ demoUrl }: { demoUrl?: string }) {
  const section = useRef<HTMLElement>(null);
  // Luz que sigue al puntero (variables CSS, sin volver a pintar React).
  const onMove = (e: React.PointerEvent) => {
    const el = section.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const chips = ["varias_sedes", "listas_de_precios(5)", "landing_pages + pixel", "traslados.firmar()", "informes_en_vivo", "ia.sugerencias()"];

  return (
    <section ref={section} onPointerMove={onMove} className="relative isolate overflow-hidden pb-6"
      style={{ color: INK, background: "linear-gradient(180deg, rgba(6,3,14,0) 0%, rgba(6,3,14,.92) 6%, rgba(6,3,14,.94) 92%, rgba(6,3,14,0) 100%)", "--mx": "50%", "--my": "30%" } as CSSProperties}>
      <style>{HERO_CSS}</style>
      <DevFxStyles />
      <NeuralCanvas />
      {/* piso de cuadrícula en perspectiva */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[45%] overflow-hidden [perspective:420px]" style={{ maskImage: "linear-gradient(to top, #000 10%, transparent)", WebkitMaskImage: "linear-gradient(to top, #000 10%, transparent)" }}>
        <div className="dh-grid absolute inset-x-[-50%] bottom-[-30%] h-[160%] [transform:rotateX(62deg)]"
          style={{ backgroundImage: "linear-gradient(rgba(168,85,247,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,.35) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
      </div>
      {/* luz del puntero */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1]" style={{ background: "radial-gradient(520px circle at var(--mx) var(--my), rgba(168,85,247,.16), transparent 45%)" }} />
      <FloatingCode />

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-6 pt-8 lg:grid-cols-[1fr_1.08fr] lg:pt-12">
        <div className="min-w-0">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "rgba(52,211,153,.4)", background: "rgba(52,211,153,.08)", fontFamily: MONO, color: "#6ee7b7" }}>
              <span className="dfx-live h-2 w-2 rounded-full bg-emerald-400" /> sistema.en_linea()
            </span>
            <a href="#landings" className="inline-flex max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition hover:-translate-y-0.5" style={{ borderColor: "rgba(168,85,247,.4)", background: "rgba(168,85,247,.1)" }}>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black text-white" style={{ background: "var(--t-cta)" }}>Nuevo</span>
              <span className="truncate">Landing pages con el píxel de Meta</span>
              <ArrowRight size={13} className="shrink-0" />
            </a>
          </motion.div>

          <div className="mt-6 flex items-center gap-3 sm:gap-5">
            <WavingLogo />
            <h1 className="min-w-0 text-[2.1rem] font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.15rem]">
              <Scramble text="Tu tienda, tus sedes y tus catálogos" />{" "}
              <span className="dh-shine" style={{ backgroundImage: "linear-gradient(90deg,#a855f7,#ec4899,#22d3ee,#a855f7)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                <Scramble text="en un solo lugar." delay={350} />
              </span>
              <Caret />
            </h1>
          </div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-5 max-w-xl text-base sm:text-lg" style={{ color: MUTED }}>
            <span className="mr-1 text-sm text-fuchsia-400" style={{ fontFamily: MONO }}>{"/**"}</span>
            Vende por WhatsApp con un catálogo para cada público, lanza landing pages para tus anuncios, factura en cada punto, controla el inventario de cada bodega y mira tus números al instante.
            <span className="ml-1 text-sm text-fuchsia-400" style={{ fontFamily: MONO }}>{"*/"}</span>
          </motion.p>

          <TerminalTyper />

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/registro" className="group inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white shadow-[0_10px_40px_rgba(236,72,153,.45)] transition hover:-translate-y-0.5" style={{ background: "var(--t-cta)" }}>
              <Sparkles size={17} className="transition group-hover:rotate-12" /> Crear mi tienda gratis
            </Link>
            {demoUrl ? (
              <a href={demoUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-2xl border px-6 py-3.5 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.04)" }}>
                <Store size={16} /> Ver una tienda de ejemplo
              </a>
            ) : null}
            <a href="#producto" className="inline-flex items-center gap-2 rounded-2xl border px-6 py-3.5 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.04)", fontFamily: MONO }}>
              ver --demo <ArrowRight size={16} />
            </a>
          </div>
          <p className="mt-2 text-[11px] text-slate-500" style={{ fontFamily: MONO }}>{"// gratis para empezar · sin instalar nada · funciona en el celular"}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((t, i) => (
              <motion.span key={t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + i * 0.08 }}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]" style={{ borderColor: "rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)", fontFamily: MONO, color: "#d4d4e0" }}>
                <span className="text-emerald-400">✓</span>{t}
              </motion.span>
            ))}
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 30, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.8, delay: 0.2 }} className="relative min-w-0 lg:pb-24">
          <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] opacity-60 blur-3xl" style={{ background: "radial-gradient(circle at 30% 30%, rgba(168,85,247,.45), transparent 60%), radial-gradient(circle at 80% 70%, rgba(236,72,153,.35), transparent 55%)" }} />
          <Ide />
          <div className="mt-4 lg:absolute lg:-bottom-10 lg:-left-12 lg:mt-0">
            <Copilot />
          </div>
        </motion.div>
      </div>

      <CommitMarquee />
      <Metrics />
    </section>
  );
}
