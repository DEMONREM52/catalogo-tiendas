"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { m as motion } from "framer-motion";
import { X } from "lucide-react";
import { ddmmyyyy, healthColor, healthLabel } from "@/lib/products/radar";

export function HealthRing({ score, size }: { score: number; size: number }) {
  const stroke = size > 50 ? 6 : 4.5;
  const rad = (size - stroke) / 2;
  const len = 2 * Math.PI * rad;
  const color = healthColor(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Salud ${score}/100 · ${healthLabel(score)}`} aria-label={`Salud ${score} de 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={rad} fill="none" strokeWidth={stroke} style={{ stroke: "color-mix(in oklab, var(--t-text) 10%, transparent)" }} />
        <motion.circle cx={size / 2} cy={size / 2} r={rad} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke={color}
          strokeDasharray={len} initial={{ strokeDashoffset: len }} animate={{ strokeDashoffset: len * (1 - score / 100) }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-black tabular-nums" style={{ fontSize: size > 50 ? 15 : 12, color }}>{score}</span>
    </div>
  );
}

export function Tile({ emoji, label, value, sub, color, pulse, active, onClick }: { emoji: string; label: string; value: string | number; sub?: string; color: string; pulse?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="relative min-w-0 overflow-hidden rounded-2xl border p-3 text-left"
      style={{ borderColor: active ? color : "var(--t-card-border)", background: active ? `color-mix(in oklab, ${color} 14%, var(--t-card-bg))` : "var(--t-card-bg)" }}>
      {pulse ? <span className="absolute right-3 top-3 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: color }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} /></span> : null}
      <p className="text-xl">{emoji}</p>
      <motion.p key={String(value)} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="truncate text-2xl font-black tabular-nums" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString("es-CO") : value}
      </motion.p>
      <p className="truncate text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{label}</p>
      {sub ? <p className="truncate text-[10px]" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
    </motion.button>
  );
}

/** Barrido de radar decorativo en el encabezado. */
export function RadarSweep() {
  return (
    <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 opacity-30 sm:opacity-40">
      <div className="absolute inset-0 rounded-full border" style={{ borderColor: "#10b981" }} />
      <div className="absolute inset-8 rounded-full border" style={{ borderColor: "#10b981" }} />
      <div className="absolute inset-16 rounded-full border" style={{ borderColor: "#10b981" }} />
      <motion.div className="absolute inset-0 rounded-full" animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, #10b981 60%, transparent) 40deg, transparent 70deg)" }} />
    </div>
  );
}

/** Salud promedio día a día con la línea de la meta. */
export function HealthTrend({ days, goal, current }: { days: Array<{ day: string; avg: number }>; goal: number; current: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = days.length ? days : [];
  const W = 320, H = 86, P = 6;
  const x = (i: number) => (pts.length <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (pts.length - 1));
  const y = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const line = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.avg).toFixed(1)}`).join(" ");
  const area = pts.length > 1 ? `${line} L${x(pts.length - 1)},${H - P} L${x(0)},${H - P} Z` : "";
  const first = pts[0]?.avg ?? current;
  const delta = current - first;
  const color = healthColor(current);
  const h = hover !== null ? pts[hover] : null;
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-black">📈 Salud del catálogo</p>
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
          Meta <b style={{ color: "var(--t-text)" }}>{goal}</b>
          {pts.length > 1 ? <> · <b style={{ color: delta >= 0 ? "#10b981" : "#e5484d" }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}</b> desde {ddmmyyyy(pts[0].day)}</> : null}
        </p>
      </div>
      {pts.length < 2 ? (
        <p className="mt-3 text-[11px]" style={{ color: "var(--t-muted)" }}>La gráfica se arma sola: cada día que abras el Radar se guarda la salud. Vuelve mañana para ver cómo sube.</p>
      ) : (
        <div className="relative mt-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
            <line x1={P} x2={W - P} y1={y(goal)} y2={y(goal)} strokeDasharray="4 4" strokeWidth={1} style={{ stroke: "color-mix(in oklab, var(--t-text) 35%, transparent)" }} />
            <path d={area} fill={color} opacity={0.14} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {pts.map((d, i) => (
              <rect key={d.day} x={x(i) - (W / pts.length) / 2} y={0} width={W / pts.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            ))}
            {h ? <circle cx={x(hover!)} cy={y(h.avg)} r={4} fill={color} stroke="var(--t-card-bg)" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {h ? (
            <span className="pointer-events-none absolute -top-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold shadow" style={{ left: `clamp(0px, calc(${(x(hover!) / W) * 100}% - 40px), calc(100% - 90px))`, borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
              {ddmmyyyy(h.day)} · {h.avg}
            </span>
          ) : null}
        </div>
      )}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }} title={`Hoy ${current} de ${goal}`}>
        <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (current / Math.max(1, goal)) * 100)}%` }} style={{ background: color }} />
      </div>
      <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{current >= goal ? "🎉 ¡Meta cumplida!" : `Faltan ${goal - current} puntos para la meta.`}</p>
    </div>
  );
}

/** Ventana encima de todo (abajo en el celular). */
export function Sheet({ title, icon, onClose, children, wide }: { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ background: "rgba(8,6,20,.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[26px] border p-4 shadow-2xl sm:rounded-[26px] sm:p-5 ${wide ? "sm:max-w-3xl" : "sm:max-w-md"}`}
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <div className="mb-3 flex items-center gap-2 pr-10">
          {icon}
          <h2 className="text-lg font-black">{title}</h2>
        </div>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
