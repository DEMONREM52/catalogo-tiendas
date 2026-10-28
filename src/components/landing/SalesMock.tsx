"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShoppingBag, TrendingUp } from "lucide-react";

/**
 * Tablero de ventas de la portada: ventas que entran en vivo, el total que sube, la línea de rentabilidad
 * sobre las barras, pedidos / ganancia / % y las últimas ventas. Datos de ejemplo (decorativo, aria-hidden).
 * Con «reducir movimiento» se muestran los números finales, quietos.
 */

const SALES = [
  { ch: "POS", icon: "💳", where: "Sede Zamora", v: 86000, p: 27500 },
  { ch: "Landing", icon: "🛒", where: "Medellín · Meta Ads", v: 124200, p: 41800 },
  { ch: "WhatsApp", icon: "💬", where: "Catálogo por mayor", v: 1240000, p: 310000 },
  { ch: "POS", icon: "💳", where: "Sede San Roque", v: 45900, p: 16100 },
  { ch: "Landing", icon: "🛒", where: "Cali · Meta Ads", v: 106200, p: 35400 },
  { ch: "WhatsApp", icon: "💬", where: "Catálogo detal", v: 238000, p: 79000 },
];
const BASE = { total: 18450000, orders: 412, profit: 6180000, today: 1284000 };
const BARS = [38, 52, 44, 63, 58, 76, 70, 84];
// Rentabilidad (%) de cada barra: la línea que se dibuja encima.
const MARGIN = [24, 27, 25, 29, 28, 31, 30, 33];

const COP = (n: number) => n.toLocaleString("es-CO");

function useCountUp(target: number, ms = 1600) {
  const [v, setV] = useState(0);
  const first = useRef(true);
  const from = useRef(0);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const a = from.current;
    const dur = still ? 0 : first.current ? ms : 700;
    first.current = false;
    let raf = 0;
    const step = (now: number) => {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      const val = Math.round(a + (target - a) * (1 - Math.pow(1 - t, 3)));
      from.current = val;
      setV(val);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function SalesMock() {
  const still = useReducedMotion();
  const [k, setK] = useState(0); // ventas que han entrado en vivo
  useEffect(() => {
    if (still) return;
    const t = window.setInterval(() => setK((x) => x + 1), 3200);
    return () => window.clearInterval(t);
  }, [still]);

  const done = Array.from({ length: k }, (_, i) => SALES[i % SALES.length]);
  const sum = (f: (s: (typeof SALES)[number]) => number) => done.reduce((acc, s) => acc + f(s), 0);
  const total = useCountUp(BASE.total + sum((s) => s.v));
  const orders = useCountUp(BASE.orders + k, 1200);
  const profit = useCountUp(BASE.profit + sum((s) => s.p));
  const today = useCountUp(BASE.today + sum((s) => s.p), 1400);
  const pct = ((BASE.profit + sum((s) => s.p)) / (BASE.total + sum((s) => s.v))) * 100;
  const last = k ? SALES[(k - 1) % SALES.length] : null;
  const feed = (k ? done.slice(-3).reverse() : SALES.slice(0, 3)).map((s, i) => ({ ...s, key: `${k}-${i}` }));
  // La barra de este mes crece con cada venta.
  const bars = BARS.map((h, i) => (i === BARS.length - 1 ? Math.min(100, h + k * 1.5) : h));

  // Línea de rentabilidad (0-100 → alto del gráfico).
  const pts = MARGIN.map((m, i) => [(i + 0.5) * (100 / MARGIN.length), 100 - (m - 18) * 4.2] as const);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const end = pts[pts.length - 1];

  return (
    <div aria-hidden className="relative mx-auto w-full max-w-lg">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="relative overflow-hidden rounded-[2rem] border p-5 shadow-2xl backdrop-blur-xl"
        style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            <span className="dfx-live h-2 w-2 rounded-full bg-emerald-400" /> Ventas · este mes · en vivo
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500"><TrendingUp size={12} /> +24%</span>
        </div>

        <div className="relative">
          <p className="mt-1 text-4xl font-black tabular-nums tracking-tight sm:text-5xl">${COP(total)}</p>
          {/* +$ que sube con cada venta, y monedas */}
          <AnimatePresence>
            {last ? (
              <motion.span key={k} initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: [0, 1, 1, 0], y: -34, scale: 1 }} transition={{ duration: 1.8 }}
                className="absolute right-0 top-1 rounded-full bg-emerald-500 px-2.5 py-1 text-sm font-black text-white shadow-lg sm:text-base">
                +${COP(last.v)}
              </motion.span>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {last ? [0, 1, 2].map((c) => (
              <motion.span key={`${k}-${c}`} initial={{ opacity: 1, x: 0, y: 0, scale: 0.6 }} animate={{ opacity: 0, x: (c - 1) * 46, y: -60 - c * 10, scale: 1.1, rotate: (c - 1) * 30 }} transition={{ duration: 1.1, ease: "easeOut" }}
                className="pointer-events-none absolute right-16 top-6 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-[12px] font-black text-amber-900 shadow">$</motion.span>
            )) : null}
          </AnimatePresence>
        </div>

        {/* barras de ventas + línea de rentabilidad */}
        <div className="relative mt-4 h-28">
          <div className="absolute inset-0 flex items-end gap-2">
            {bars.map((h, i) => (
              <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i === bars.length - 1 && k ? 0 : 0.3 + i * 0.07, duration: 0.6 }}
                className="flex-1 rounded-t-[4px]" style={{ background: i === bars.length - 1 ? "var(--t-cta)" : "color-mix(in oklab, var(--t-accent) 35%, transparent)" }} />
            ))}
          </div>
          {/* la línea se revela de izquierda a derecha (pathLength no sirve con trazo que no escala) */}
          <motion.div initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ delay: 0.9, duration: 1.4, ease: "easeInOut" }} className="pointer-events-none absolute inset-0 z-10">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              <path d={path} fill="none" stroke="#34d399" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px rgba(52,211,153,.8))" }} />
            </svg>
          </motion.div>
          <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.3 }}
            className="dfx-live absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400" style={{ left: `${end[0]}%`, top: `${end[1]}%` }} />
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}
            className="absolute -top-1 left-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">rentabilidad</motion.span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {[
            ["Pedidos", COP(orders), undefined],
            ["Ganancia", `$${(profit / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} M`, "#10b981"],
            ["Rentabilidad", `${pct.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`, "#10b981"],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
              <p style={{ color: "var(--t-muted)" }}>{l}</p>
              <p className="text-base font-black tabular-nums" style={{ color: c }}>{v}</p>
            </div>
          ))}
        </div>

        {/* últimas ventas */}
        <div className="mt-3 space-y-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {feed.map((s, i) => (
              <motion.div key={s.key} layout initial={{ opacity: 0, x: 30, scale: 0.96 }} animate={{ opacity: 1 - i * 0.22, x: 0, scale: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[12px]" style={{ borderColor: i === 0 && k ? "rgba(16,185,129,.5)" : "var(--t-card-border)", background: i === 0 && k ? "rgba(16,185,129,.08)" : "transparent" }}>
                <span>{s.icon}</span>
                <span className="font-bold">{s.ch}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--t-muted)" }}>{s.where}</span>
                <span className="font-black tabular-nums text-emerald-500">+${COP(s.v)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* aviso de arriba: cambia con cada venta */}
      <div className="absolute -right-2 -top-6 sm:-right-8">
        <AnimatePresence mode="wait">
          <motion.div key={k} initial={{ opacity: 0, x: 30, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ delay: k ? 0 : 0.9, type: "spring", stiffness: 320, damping: 24 }}
            className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white"><ShoppingBag size={14} /></span>
            {last ? <>Nueva venta · {last.where.split(" · ")[0]} <b className="text-emerald-500">+${COP(last.v)}</b></> : "Nuevo pedido · Sede San Roque"}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ganancia de hoy */}
      <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2 }}
        className="absolute -bottom-6 -left-2 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-xl sm:-left-8" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
        <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: "var(--t-cta)" }}><TrendingUp size={14} /></span>
        Ganancia de hoy <b className="tabular-nums text-emerald-500">+${COP(today)}</b> 📈
      </motion.div>
    </div>
  );
}
