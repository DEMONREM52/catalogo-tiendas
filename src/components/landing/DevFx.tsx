"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Detalles «de programador» para la portada: símbolos de código flotando, una terminal que escribe sola,
 * una ventana de editor que se va escribiendo y el cursor que parpadea. Todo decorativo (aria-hidden).
 * Con «reducir movimiento» del equipo quedan quietos.
 */

const FX_CSS = `
@keyframes dfx-float { 0%,100% { transform: translateY(0) rotate(var(--r)); opacity: var(--o); } 50% { transform: translateY(-22px) rotate(calc(var(--r) * -1)); opacity: calc(var(--o) * 1.8); } }
@keyframes dfx-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes dfx-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(400%); } }
@keyframes dfx-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); } 50% { box-shadow: 0 0 0 6px rgba(52,211,153,0); } }
.dfx-sym { animation: dfx-float var(--d) ease-in-out var(--delay) infinite; }
.dfx-caret { animation: dfx-blink 1s step-end infinite; }
.dfx-scan { animation: dfx-scan 5s linear infinite; }
.dfx-live { animation: dfx-pulse 1.8s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .dfx-sym, .dfx-caret, .dfx-scan, .dfx-live { animation: none !important; } }
`;

export function DevFxStyles() {
  return <style>{FX_CSS}</style>;
}

// Posiciones fijas (sin azar): lo que pinta el servidor es igual a lo del navegador.
const SYMBOLS: Array<[string, number, number, number, string]> = [
  ["</>", 3, 8, 30, "#a855f7"], ["{ }", 46, 4, 26, "#ec4899"], ["=>", 88, 10, 24, "#22d3ee"], ["( )", 12, 46, 22, "#34d399"],
  ["&&", 58, 40, 20, "#f59e0b"], [";", 95, 52, 34, "#a855f7"], ["[ ]", 30, 84, 24, "#22d3ee"], ["#", 70, 88, 28, "#ec4899"],
  ["</>", 82, 66, 22, "#34d399"], ["!==", 2, 76, 18, "#f59e0b"], ["0x1F", 40, 62, 16, "#a855f7"], ["fn()", 64, 18, 18, "#22d3ee"],
  ["//", 22, 22, 26, "#64748b"], ["{ }", 92, 30, 18, "#34d399"], ["=>", 50, 96, 18, "#ec4899"], ["*", 76, 46, 30, "#a855f7"],
  ["$", 34, 30, 34, "#34d399"], ["+24%", 86, 82, 18, "#34d399"], ["COP", 8, 60, 16, "#f59e0b"], ["$$", 60, 70, 22, "#34d399"],
];

/** Símbolos de código que flotan detrás de la portada. */
export function FloatingCode() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1] select-none overflow-hidden font-mono font-black">
      {SYMBOLS.map(([t, x, y, size, color], i) => (
        <span
          key={i}
          className="dfx-sym absolute"
          style={{
            left: `${x}%`, top: `${y}%`, fontSize: size, color,
            ["--r" as string]: `${(i % 2 ? 1 : -1) * (4 + (i % 4) * 3)}deg`,
            ["--o" as string]: 0.16 + (i % 3) * 0.04,
            ["--d" as string]: `${6 + (i % 5) * 1.3}s`,
            ["--delay" as string]: `${-(i * 0.7)}s`,
            textShadow: `0 0 18px ${color}`,
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/** Cursor de terminal que parpadea (para el final del título). */
export function Caret({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`dfx-caret ml-1 inline-block h-[0.8em] w-[0.12em] translate-y-[0.08em] rounded-sm align-baseline ${className}`} style={{ background: "var(--t-cta)" }} />;
}

const COMMANDS = [
  "npm run vender -- --todas-las-sedes",
  "remhub.catalogo.crear('Por mayor')",
  "pixel.track('Purchase', { value: 124200 })",
  "await inventario.trasladar('Bodega', 'Zamora')",
  "git commit -m \"ventas +24%\" && git push",
  "SELECT total FROM ventas WHERE fecha = hoy;",
];

/** Terminal que escribe y borra comandos sola. */
export function TerminalTyper() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<"type" | "done" | "erase">("type");
  const cmd = COMMANDS[i % COMMANDS.length];

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => { setN(cmd.length); setPhase("done"); }, 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      if (phase === "type") { if (n < cmd.length) setN(n + 1); else setPhase("done"); }
      else if (phase === "done") setPhase("erase");
      else if (n > 0) setN(Math.max(0, n - 3));
      else { setPhase("type"); setI(i + 1); }
    }, phase === "type" ? 45 + ((n * 7) % 40) : phase === "done" ? 1600 : 18);
    return () => window.clearTimeout(t);
  }, [i, n, phase, cmd.length]);

  return (
    <div aria-hidden className="relative mt-6 max-w-xl overflow-hidden rounded-2xl border font-mono text-[12px] shadow-xl sm:text-[13px]" style={{ borderColor: "rgba(168,85,247,.35)", background: "#0b0716", color: "#e5e7eb" }}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[11px] text-slate-400">bash — remhub</span>
        <span className="dfx-live ml-auto h-2 w-2 rounded-full bg-emerald-400" />
      </div>
      <div className="flex min-h-[3.4em] flex-wrap items-center gap-x-2 px-4 py-3">
        <span className="text-emerald-400">~/mi-tienda</span>
        <span className="text-fuchsia-400">$</span>
        <span className="break-all">{cmd.slice(0, n)}<span className="dfx-caret ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.15em] bg-fuchsia-400" /></span>
        {phase === "done" ? <span className="text-emerald-400">✓ listo</span> : null}
      </div>
    </div>
  );
}

type Tok = [string, string?];
const C = { k: "#f472b6", f: "#67e8f9", s: "#86efac", n: "#fcd34d", c: "#64748b", p: "#c4b5fd" };
const CODE: Tok[][] = [
  [["import ", C.k], ["{ RemHub } ", C.p], ["from ", C.k], ['"remhub"', C.s], [";"]],
  [],
  [["const ", C.k], ["tienda "], ["= ", C.p], ["await ", C.k], ["RemHub", C.f], ["."], ["crear", C.f], ["({", C.p]],
  [["  sedes: "], ["[", C.p], ['"Bodega"', C.s], [", "], ['"Zamora"', C.s], ["]", C.p], [","]],
  [["  catalogos: "], ["4", C.n], [", precios: "], ["5", C.n], [","]],
  [["  pixel: "], ['"Meta"', C.s], [", pos: "], ["true", C.k], [","]],
  [["});", C.p]],
  [],
  [["tienda", C.f], ["."], ["on", C.f], ["(", C.p], ['"pedido"', C.s], [", "], ["(p) ", C.p], ["=> ", C.k], ["avisar", C.f], ["(p)", C.p], [");", C.p]],
  [["await ", C.k], ["tienda", C.f], ["."], ["vender", C.f], ["();", C.p], ["  // 🚀 24/7", C.c]],
];

/** Ventana de editor que se escribe línea por línea al aparecer. */
export function CodeWindow({ className = "" }: { className?: string }) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, y: 24, rotate: -1.5 }}
      whileInView={{ opacity: 1, y: 0, rotate: -1.5 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className={`relative overflow-hidden rounded-2xl border font-mono text-[11.5px] leading-relaxed shadow-2xl sm:text-[12.5px] ${className}`}
      style={{ borderColor: "rgba(168,85,247,.35)", background: "#0b0716", color: "#e5e7eb" }}
    >
      <div className="dfx-scan pointer-events-none absolute inset-x-0 top-0 h-1/4" style={{ background: "linear-gradient(180deg, transparent, rgba(168,85,247,.10), transparent)" }} />
      <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 rounded-md px-2 py-0.5 text-[11px] text-slate-300" style={{ background: "rgba(255,255,255,.06)" }}>mi-tienda.ts</span>
        <span className="ml-auto text-[10px] font-bold text-emerald-400">● TypeScript</span>
      </div>
      <div className="px-3 py-3">
        {CODE.map((line, li) => (
          <motion.div
            key={li}
            className="flex whitespace-pre"
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 + li * 0.18, duration: 0.25 }}
          >
            <span className="mr-3 w-5 shrink-0 select-none text-right text-slate-600">{li + 1}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{line.map(([t, c], ti) => <span key={ti} style={{ color: c }}>{t}</span>)}</span>
          </motion.div>
        ))}
        <motion.div className="mt-2 flex items-center gap-2 border-t pt-2 text-[11px]" style={{ borderColor: "rgba(255,255,255,.08)" }}
          initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.6 + CODE.length * 0.18 }}>
          <span className="text-emerald-400">✓ Compilado</span>
          <span className="text-slate-500">0 errores · 128 ms</span>
          <span className="dfx-caret ml-auto text-fuchsia-400">▍</span>
        </motion.div>
      </div>
    </motion.div>
  );
}
