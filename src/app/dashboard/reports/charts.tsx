"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
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
      {rows.map((row) => (
        <li key={row.key} className="group rounded-xl px-1 py-0.5 transition hover:bg-[color:var(--t-card-bg-soft)]" title={`${row.label}: ${format(row.value)}`}>
          <div className="flex items-center gap-2.5">
            {row.image !== undefined ? (
              row.image ? <img src={row.image} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="shrink-0 text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{format(row.value)}</p>
              </div>
              <div className="mt-1 h-2.5 w-full">
                <div className="h-full rounded-r-[4px] transition-[width] duration-700" style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: "var(--viz-1)" }} />
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
