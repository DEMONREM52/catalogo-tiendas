"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { bucketLabel, formatMoney, formatMoneyCompact, type ReportBucket } from "@/lib/reports";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

type TrendPoint = { t: string; sales: number; prev: number };

/** Ventas del periodo (línea + área) frente al periodo anterior (línea gris). */
export function TrendChart({ series, bucket, height = 240 }: { series: TrendPoint[]; bucket: ReportBucket; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { l: 64, r: 16, t: 14, b: 30 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.map((p) => Math.max(p.sales, p.prev))));
  const n = series.length;
  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;

  const paths = useMemo(() => {
    if (!width || !n) return { line: "", area: "", prev: "" };
    const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.sales).toFixed(1)}`);
    const prevPts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.prev).toFixed(1)}`);
    return {
      line: `M${pts.join("L")}`,
      area: `M${x(0).toFixed(1)},${y(0).toFixed(1)}L${pts.join("L")}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}Z`,
      prev: `M${prevPts.join("L")}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, width, height, max]);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 78))));

  function pick(clientX: number, rect: DOMRect) {
    if (!n) return;
    const rel = clientX - rect.left - pad.l;
    const i = n <= 1 ? 0 : Math.round((rel / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  }

  const point = active !== null ? series[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active) - 90, 4), Math.max(4, width - 184)) : 0;

  return (
    <div ref={ref} className="viz-root relative w-full select-none" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Ventas por periodo comparadas con el periodo anterior"
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] rounded-xl"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
            if (e.key === "Escape") setActive(null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--t-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatMoneyCompact(t)}
              </text>
            </g>
          ))}
          {series.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={p.t} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--t-muted)">
                {bucketLabel(p.t, bucket)}
              </text>
            ) : null,
          )}
          <path d={paths.prev} fill="none" stroke="var(--viz-prev)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          <path d={paths.area} fill="var(--viz-1)" opacity={0.1} />
          <path d={paths.line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {n > 0 ? <circle cx={x(n - 1)} cy={y(series[n - 1].sales)} r={4} fill="var(--viz-1)" stroke="var(--t-card-bg)" strokeWidth={2} /> : null}
          {active !== null && point ? (
            <g>
              <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
              <circle cx={x(active)} cy={y(point.prev)} r={4} fill="var(--viz-prev)" stroke="var(--t-card-bg)" strokeWidth={2} />
              <circle cx={x(active)} cy={y(point.sales)} r={5} fill="var(--viz-1)" stroke="var(--t-card-bg)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {point && active !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 w-[180px] rounded-xl border px-3 py-2 text-xs shadow-xl"
          style={{ left: tipLeft, background: "var(--t-bg-base)", borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
          role="status"
        >
          <p style={{ color: "var(--t-muted)" }}>{bucketLabel(point.t, bucket)}</p>
          <p className="mt-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-1)" }} />
            <b className="text-sm">{formatMoney(point.sales)}</b>
          </p>
          <p className="mt-0.5 flex items-center gap-2" style={{ color: "var(--t-muted)" }}>
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-prev)" }} />
            {formatMoney(point.prev)} antes
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function TrendLegend() {
  return (
    <div className="viz-root flex flex-wrap gap-4 text-xs" style={{ color: "var(--t-muted)" }}>
      <span className="inline-flex items-center gap-2"><span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--viz-1)" }} /> Este periodo</span>
      <span className="inline-flex items-center gap-2"><span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--viz-prev)" }} /> Periodo anterior</span>
    </div>
  );
}

/** Barras horizontales de una sola serie con el valor al final de cada barra. */
export function BarList({
  rows,
  format = formatMoney,
  emptyText = "Sin datos en este periodo.",
}: {
  rows: Array<{ key: string; label: string; value: number; sub?: string; image?: string | null }>;
  format?: (value: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>{emptyText}</p>;
  return (
    <ul className="viz-root space-y-2.5">
      {rows.map((row, index) => (
        <li key={row.key} className="group rounded-xl px-1 py-0.5 transition hover:bg-[color:var(--t-card-bg-soft)]" title={`${row.label}: ${format(row.value)}`}>
          <div className="flex items-center gap-2.5">
            <span className="w-4 shrink-0 text-center text-[11px] font-black tabular-nums" style={{ color: "var(--t-muted)" }}>{index + 1}</span>
            {row.image !== undefined ? (
              row.image ? <img src={row.image} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="shrink-0 text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{format(row.value)}</p>
              </div>
              <div className="mt-1 h-2.5 w-full">
                <motion.div className="h-full rounded-r-[4px]" initial={{ width: 0 }} whileInView={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: Math.min(index, 8) * 0.06, ease: "easeOut" }} style={{ background: index === 0 ? "var(--viz-1)" : "color-mix(in oklab, var(--viz-1) 70%, transparent)" }} />
              </div>
              {row.sub ? <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>{row.sub}</p> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Parte de un todo (hasta 4 grupos) con leyenda y valores. */
export function ShareBar({ parts }: { parts: Array<{ key: string; label: string; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const colors = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];
  if (!total) return <p className="py-4 text-center text-sm" style={{ color: "var(--t-muted)" }}>Sin ventas en este periodo.</p>;
  return (
    <div className="viz-root">
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {parts.map((p, i) => (p.value > 0 ? (
          <div key={p.key} title={`${p.label}: ${formatMoney(p.value)}`} className="h-full transition-[width] duration-700" style={{ width: `${(p.value / total) * 100}%`, background: colors[i % 4] }} />
        ) : null))}
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i % 4] }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="shrink-0 font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatMoneyCompact(p.value)} <span className="text-xs font-normal" style={{ color: "var(--t-muted)" }}>· {Math.round((p.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mini tendencia para las fichas: periodo en color, el resto atenuado. */
export function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = values.length;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${n <= 1 ? width / 2 : (i * (width - 4)) / (n - 1) + 2},${height - 3 - (v / max) * (height - 6)}`);
  return (
    <div ref={ref} className="viz-root h-7 w-full" aria-hidden="true">
      {width > 0 && n > 1 ? (
        <svg width={width} height={height}>
          <polyline points={pts.join(" ")} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        </svg>
      ) : null}
    </div>
  );
}

/** Medidor con pista del mismo color, más claro. */
export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warning" | "critical" }) {
  const color = tone === "critical" ? "var(--viz-critical)" : tone === "warning" ? "var(--viz-warning)" : "var(--viz-1)";
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="viz-root h-2 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ===================================================================== nuevas piezas (inicio rediseñado) */

/** Número que sube hasta su valor (suave, ~0,9 s). Respeta «reducir movimiento». */
export function AnimatedNumber({ value, format = (v: number) => Math.round(v).toLocaleString("es-CO") }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === value) { from.current = value; const t = window.setTimeout(() => setShown(value), 0); return () => window.clearTimeout(t); }
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{format(shown)}</span>;
}

/** Mini tendencia con área en degradado (para las fichas). */
export function AreaSpark({ values, color = "var(--viz-1)", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [id] = useState(() => `g${Math.random().toString(36).slice(2, 8)}`);
  const n = values.length;
  const max = Math.max(1, ...values);
  const xs = (i: number) => (n <= 1 ? width / 2 : (i * (width - 4)) / (n - 1) + 2);
  const ys = (v: number) => height - 3 - (v / max) * (height - 8);
  const line = values.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join("");
  return (
    <div ref={ref} className="viz-root w-full" style={{ height }} aria-hidden="true">
      {width > 0 && n > 1 ? (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line}L${xs(n - 1).toFixed(1)},${height}L${xs(0).toFixed(1)},${height}Z`} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}

type MetricPoint = { t: string; v: number; prev?: number | null };

/**
 * Tendencia principal: área en degradado que se dibuja al cargar, línea punteada del periodo anterior
 * (si hay), el mejor punto marcado y cruz con tooltip al pasar el dedo o el mouse. Un solo eje.
 */
export function MetricChart({ points, bucket, format, height = 260, label, bestLabel = "Mejor" }: {
  points: MetricPoint[]; bucket: ReportBucket; format: (v: number) => string; height?: number; label: string; bestLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [gid] = useState(() => `mc${Math.random().toString(36).slice(2, 8)}`);
  const pad = { l: 60, r: 14, t: 26, b: 30 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const hasPrev = points.some((p) => p.prev != null && p.prev > 0);
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.v, hasPrev ? Number(p.prev ?? 0) : 0))));
  const n = points.length;
  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => pad.t + plotH - (Math.max(0, v) / max) * plotH;
  const best = points.reduce((b, p, i) => (p.v > (points[b]?.v ?? -1) ? i : b), 0);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const prevLine = hasPrev ? points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p.prev ?? 0)).toFixed(1)}`).join("") : "";
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 78))));
  const key = `${n}-${points[0]?.t}-${points[n - 1]?.v}-${label}`;
  function pick(clientX: number, rect: DOMRect) {
    if (!n) return;
    const i = n <= 1 ? 0 : Math.round(((clientX - rect.left - pad.l) / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  }
  const p = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active) - 90, 4), Math.max(4, width - 184)) : 0;
  return (
    <div ref={ref} className="viz-root relative w-full select-none" style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
            if (e.key === "Escape") setActive(null);
          }}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--t-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{format(t)}</text>
            </g>
          ))}
          {points.map((pt, i) => (i % labelEvery === 0 || i === n - 1 ? (
            <text key={pt.t} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--t-muted)">{bucketLabel(pt.t, bucket)}</text>
          ) : null))}
          {hasPrev ? <path d={prevLine} fill="none" stroke="var(--viz-prev)" strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" /> : null}
          <motion.path key={`a${key}`} d={area} fill={`url(#${gid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
          <motion.path key={`l${key}`} d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeInOut" }} />
          {n > 1 && points[best]?.v > 0 ? (
            <motion.g key={`b${key}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
              <circle cx={x(best)} cy={y(points[best].v)} r={5} fill="var(--viz-1)" stroke="var(--t-card-bg)" strokeWidth={2} />
              <text x={Math.min(Math.max(x(best), pad.l + 30), width - pad.r - 30)} y={y(points[best].v) - 11} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--t-text)">🏆 {bestLabel}</text>
            </motion.g>
          ) : null}
          {active !== null && p ? (
            <g>
              <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
              {hasPrev ? <circle cx={x(active)} cy={y(Number(p.prev ?? 0))} r={4} fill="var(--viz-prev)" stroke="var(--t-card-bg)" strokeWidth={2} /> : null}
              <circle cx={x(active)} cy={y(p.v)} r={6} fill="var(--viz-1)" stroke="var(--t-card-bg)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {p && active !== null ? (
        <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-xl border px-3 py-2 text-xs shadow-xl" style={{ left: tipLeft, background: "var(--t-bg-base)", borderColor: "var(--t-card-border)", color: "var(--t-text)" }} role="status">
          <p style={{ color: "var(--t-muted)" }}>{bucketLabel(p.t, bucket)}</p>
          <p className="mt-1 flex items-center gap-2"><span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-1)" }} /><b className="text-sm">{format(p.v)}</b></p>
          {hasPrev ? <p className="mt-0.5 flex items-center gap-2" style={{ color: "var(--t-muted)" }}><span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-prev)" }} />{format(Number(p.prev ?? 0))} antes</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Dona de parte de un todo (hasta 4 grupos), con el total en el centro, leyenda y resaltado al pasar. */
export function Donut({ parts, size = 168, centerLabel = "Total" }: { parts: Array<{ key: string; label: string; value: number }>; size?: number; centerLabel?: string }) {
  const colors = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  if (!total) return <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>Sin ventas en este periodo.</p>;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 3 : 0;
  const offsets = parts.reduce<number[]>((acc, p, i) => { acc.push(i ? acc[i - 1] + (parts[i - 1].value / total) * c : 0); return acc; }, []);
  return (
    <div className="viz-root flex flex-col items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Ventas por canal" style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklab, var(--t-text) 7%, transparent)" strokeWidth={18} />
          {parts.map((p, i) => (p.value > 0 ? (
            <motion.circle key={p.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors[i % 4]} strokeWidth={hover === i ? 22 : 18}
              strokeDasharray={`${Math.max(0, (p.value / total) * c - gap)} ${c}`} strokeDashoffset={-offsets[i]}
              initial={{ opacity: 0 }} animate={{ opacity: hover === null || hover === i ? 1 : 0.35 }} transition={{ duration: 0.4, delay: i * 0.12 }}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ cursor: "pointer", transition: "stroke-width .2s" }} />
          ) : null))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--t-muted)" }}>{hover !== null ? parts[hover].label : centerLabel}</p>
            <p className="text-lg font-black" style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoneyCompact(hover !== null ? parts[hover].value : total)}</p>
            {hover !== null ? <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{Math.round((parts[hover].value / total) * 100)}%</p> : null}
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {parts.map((p, i) => (
          <li key={p.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1 text-sm transition" style={{ background: hover === i ? "var(--t-card-bg-soft)" : undefined }}>
            <span className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colors[i % 4] }} /><span className="truncate">{p.label}</span></span>
            <span className="shrink-0 font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoneyCompact(p.value)} <span className="text-xs font-normal" style={{ color: "var(--t-muted)" }}>· {Math.round((p.value / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Columnas verticales simples (una serie), con la mayor resaltada y tooltip. */
export function ColumnBars({ rows, format = formatMoneyCompact, height = 150 }: { rows: Array<{ key: string; label: string; value: number; hint?: string }>; format?: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const top = rows.reduce((b, r, i) => (r.value > (rows[b]?.value ?? -1) ? i : b), 0);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="viz-root">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {rows.map((r, i) => (
          <div key={r.key} className="relative flex h-full flex-1 flex-col justify-end" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} title={`${r.label}: ${format(r.value)}${r.hint ? ` · ${r.hint}` : ""}`}>
            {hover === i ? <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold shadow-lg" style={{ background: "var(--t-bg-base)", borderColor: "var(--t-card-border)" }}>{format(r.value)}</span> : null}
            <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(2, (r.value / max) * 100)}%` }} transition={{ duration: 0.7, delay: i * 0.05, ease: "easeOut" }}
              className="w-full rounded-t-[4px]" style={{ background: i === top ? "var(--viz-1)" : "color-mix(in oklab, var(--viz-1) 40%, transparent)", opacity: hover === null || hover === i ? 1 : 0.6 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {rows.map((r, i) => <span key={r.key} className="flex-1 truncate text-center text-[11px]" style={{ color: i === top ? "var(--t-text)" : "var(--t-muted)", fontWeight: i === top ? 700 : 400 }}>{r.label}</span>)}
      </div>
    </div>
  );
}
