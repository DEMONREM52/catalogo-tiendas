"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgePercent,
  Boxes,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  Download,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Minus,
  Package,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Store,
  Table2,
  Trophy,
  Truck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  CHANNEL_LABELS,
  PERIODS,
  bucketLabel,
  delta,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  periodRange,
  type PeriodKey,
  type ReportPayload,
} from "@/lib/reports";
import { AnimatedNumber, AreaSpark, BarList, ColumnBars, Donut, Meter, MetricChart } from "./charts";
import { ExportGate } from "@/components/ExportGate";
import { logExport } from "@/lib/permission-runtime";
import { DateField } from "@/components/forms/Fields";

type PointOption = { id: string; name: string; kind: string };

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)", color: "var(--t-text)" } as const;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* preferencia visual: si el navegador no guarda, no pasa nada */
  }
}

function DeltaBadge({ value, goodWhenUp = true, compact = false }: { value: number | null; goodWhenUp?: boolean; compact?: boolean }) {
  if (value === null) return <span className="text-xs" style={{ color: "var(--t-muted)" }}>Sin datos para comparar</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        background: good === null ? "color-mix(in oklab, var(--t-text) 8%, transparent)" : good ? "color-mix(in oklab, #0ca30c 14%, transparent)" : "color-mix(in oklab, #d03b3b 14%, transparent)",
        color: "var(--t-text)",
      }}
    >
      <Icon size={13} style={{ color: good === null ? "var(--t-muted)" : good ? "#0ca30c" : "#d03b3b" }} />
      {flat ? "Igual" : `${up ? "+" : ""}${value.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`}
      {compact ? null : <span className="font-normal" style={{ color: "var(--t-muted)" }}>vs. anterior</span>}
    </span>
  );
}

function Card({ title, icon, color = "var(--t-accent)", actions, children, className, delay = 0 }: { title: string; icon: ReactNode; color?: string; actions?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.45, delay }}
      className={`rounded-3xl border p-4 sm:p-5 ${className ?? ""}`} style={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-sm font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-md" style={{ background: color, boxShadow: `0 8px 18px -10px ${color}` }}>{icon}</span>
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </motion.section>
  );
}

function Fold({ id, title, icon, color, summary, children }: { id: string; title: string; icon: ReactNode; color: string; summary: ReactNode; children: ReactNode }) {
  const storageKey = `remhub_report_fold_${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(readStored(storageKey, false));
  }, [storageKey]);
  return (
    <section className="overflow-hidden rounded-3xl border" style={card}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          writeStored(storageKey, !open);
        }}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-[color:var(--t-card-bg-soft)] sm:p-5"
        aria-expanded={open}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-md" style={{ background: color }}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>{summary}</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={18} style={{ color: "var(--t-muted)" }} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="border-t px-4 pb-4 pt-3 sm:px-5 sm:pb-5" style={{ borderColor: "var(--t-card-border)" }}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function toCsv(report: ReportPayload) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];
  const add = (...cells: unknown[]) => lines.push(cells.map(esc).join(","));
  add("Informe RemHub", new Date(report.meta.from).toLocaleDateString("es-CO"), new Date(report.meta.to).toLocaleDateString("es-CO"), report.meta.point?.name ?? "Todos los puntos");
  add();
  add("Resumen", "Este periodo", "Periodo anterior");
  add("Ventas", report.kpis.sales, report.previous.sales);
  if (!report.costs_hidden) {
    add("Costo", report.kpis.cost, report.previous.cost);
    add("Ganancia estimada", report.kpis.sales - report.kpis.cost, report.previous.sales - report.previous.cost);
  }
  add("Pedidos", report.kpis.orders, report.previous.orders);
  add("Unidades", report.kpis.units, report.previous.units);
  add();
  add("Fecha", "Ventas", "Periodo anterior", "Pedidos");
  for (const p of report.series) add(bucketLabel(p.t, report.meta.bucket), p.sales, p.prev, p.orders);
  add();
  const hide = Boolean(report.costs_hidden);
  add("Punto", "Ventas", "Pedidos", "Unidades", ...(hide ? [] : ["Ganancia"]));
  for (const p of report.by_point) add(p.name, p.sales, p.orders, p.units, ...(hide ? [] : [p.profit]));
  add();
  add("Producto", "Unidades", "Ventas", ...(hide ? [] : ["Ganancia"]));
  for (const p of report.top_products) add(p.name, p.units, p.sales, ...(hide ? [] : [p.profit]));
  add();
  add("Cliente", "Pedidos", "Compras");
  for (const c of report.top_customers) add(c.name, c.orders, c.sales);
  return lines.join("\n");
}

const BUCKET_WORD: Record<string, string> = { hour: "hora", day: "día", week: "semana", month: "mes" };
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
type Insight = { icon: string; tone: "good" | "bad" | "warn" | "info"; text: ReactNode; href?: string };

/** Frases automáticas a partir del informe (lo que hay que mirar primero). */
function buildInsights(r: ReportPayload, periodKey: PeriodKey): Insight[] {
  const out: Insight[] = [];
  const k = r.kpis, prev = r.previous;
  const word = BUCKET_WORD[r.meta.bucket] ?? "día";
  const d = delta(k.sales, prev.sales);
  if (d !== null && Math.abs(d) >= 1) {
    out.push({ icon: d > 0 ? "🚀" : "📉", tone: d > 0 ? "good" : "bad", text: <>Vendiste <b>{Math.abs(d).toLocaleString("es-CO", { maximumFractionDigits: 1 })} % {d > 0 ? "más" : "menos"}</b> que el periodo anterior ({formatMoneyCompact(k.sales - prev.sales)}).</> });
  }
  const best = r.series.reduce((b, p) => (p.sales > (b?.sales ?? -1) ? p : b), r.series[0]);
  if (best && best.sales > 0 && r.series.length > 1) {
    out.push({ icon: "🏆", tone: "info", text: <>Tu mejor {word} fue <b>{bucketLabel(best.t, r.meta.bucket)}</b> con <b>{formatMoney(best.sales)}</b>.</> });
  }
  const active = r.series.filter((p) => p.sales > 0).length;
  if (active > 1) out.push({ icon: "📊", tone: "info", text: <>En promedio vendes <b>{formatMoney(k.sales / active)}</b> por {word} con ventas.</> });
  if (periodKey === "month" && k.sales > 0) {
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsed = now.getDate() - 1 + now.getHours() / 24;
    if (elapsed >= 1) {
      const proj = (k.sales / elapsed) * days;
      out.push({ icon: "🔮", tone: proj >= prev.sales ? "good" : "warn", text: <>Si sigues a este ritmo cierras el mes en <b>{formatMoney(proj)}</b>{prev.sales ? <> ({proj >= prev.sales ? "más" : "menos"} que el mes pasado)</> : null}.</> });
    }
  }
  const topP = r.top_products[0];
  if (topP && k.sales > 0) out.push({ icon: "⭐", tone: "info", text: <>Producto estrella: <b>{topP.name}</b> — {formatNumber(topP.units)} und., el {Math.round((Number(topP.sales) / k.sales) * 100)} % de lo vendido.</> });
  if (r.by_point.length > 1 && k.sales > 0) {
    const tp = r.by_point[0];
    out.push({ icon: "📍", tone: "info", text: <><b>{tp.name}</b> lleva el {Math.round((Number(tp.sales) / k.sales) * 100)} % de las ventas.</> });
  }
  const ticket = k.orders ? k.sales / k.orders : 0, prevTicket = prev.orders ? prev.sales / prev.orders : 0;
  const dt = delta(ticket, prevTicket);
  if (dt !== null && Math.abs(dt) >= 5) out.push({ icon: "🧾", tone: dt > 0 ? "good" : "warn", text: <>El ticket promedio {dt > 0 ? "subió" : "bajó"} a <b>{formatMoney(ticket)}</b> ({dt > 0 ? "+" : ""}{dt.toLocaleString("es-CO", { maximumFractionDigits: 0 })} %).</> });
  if (!r.costs_hidden && k.sales > 0) {
    const m = ((k.sales - k.cost) / k.sales) * 100;
    out.push({ icon: m >= 20 ? "💰" : "⚖️", tone: m >= 20 ? "good" : m >= 8 ? "info" : "warn", text: <>Margen del periodo: <b>{m.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %</b> ({formatMoneyCompact(k.sales - k.cost)} de ganancia estimada).</> });
  }
  const outOfStock = r.inventory.reduce((s, w) => s + w.out, 0);
  if (outOfStock > 0) out.push({ icon: "⛔", tone: "bad", text: <><b>{formatNumber(outOfStock)}</b> productos agotados en tus puntos y bodegas.</>, href: "/dashboard/lista-productos" });
  if (r.pending_orders.count > 0) out.push({ icon: "📦", tone: "warn", text: <><b>{r.pending_orders.count}</b> pedidos por confirmar ({formatMoneyCompact(r.pending_orders.total)}).</>, href: "/dashboard/pedidos" });
  if (r.payables && r.payables.overdue > 0) out.push({ icon: "⏰", tone: "bad", text: <>Tienes <b>{formatMoney(r.payables.overdue)}</b> vencidos con proveedores.</>, href: "/dashboard/inventario?tab=payables" });
  if (r.customers.new > 0) out.push({ icon: "🙌", tone: "good", text: <><b>{formatNumber(r.customers.new)}</b> clientes nuevos registrados.</> });
  return out;
}

const TONE: Record<Insight["tone"], string> = { good: "#10b981", bad: "#ef4444", warn: "#f59e0b", info: "#8b5cf6" };

export default function ReportsDashboard({ storeId, points }: { storeId: string; points: PointOption[] }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [pointId, setPointId] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [metric, setMetric] = useState<"sales" | "profit" | "orders">("sales");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(readStored<PeriodKey>("remhub_report_period", "30d"));
  }, []);

  const range = useMemo(() => periodRange(period, custom), [period, custom]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabaseBrowser().rpc("erp_report", {
      p_store: storeId,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_point: pointId || null,
    });
    setLoading(false);
    if (rpcError) {
      setError(/Could not find the function|schema cache/i.test(rpcError.message)
        ? "Para ver los informes ejecuta en Supabase el archivo supabase/migrations/20261014_catalogs_reports.sql."
        : rpcError.message);
      return;
    }
    setError("");
    setReport(data as ReportPayload);
  }, [storeId, range, pointId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, tick]);

  function choosePeriod(next: PeriodKey) {
    setPeriod(next);
    writeStored("remhub_report_period", next);
  }

  function downloadCsv() {
    if (!report) return;
    logExport("informe_ventas", 1, { from: range.from.toISOString().slice(0, 10) });
    const blob = new Blob([`﻿${toCsv(report)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe-${range.from.toISOString().slice(0, 10)}-a-${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const costsHidden = Boolean(report?.costs_hidden);
  const k = report?.kpis;
  const prev = report?.previous;
  const profit = k ? k.sales - k.cost : 0;
  const prevProfit = prev ? prev.sales - prev.cost : 0;
  const ticket = k && k.orders ? k.sales / k.orders : 0;
  const prevTicket = prev && prev.orders ? prev.sales / prev.orders : 0;
  const margin = k && k.sales ? (profit / k.sales) * 100 : 0;
  const inventoryValue = report?.inventory.reduce((s, w) => s + Number(w.value), 0) ?? 0;
  const maxInventoryValue = Math.max(1, ...(report?.inventory.map((w) => Number(w.value)) ?? [1]));
  const insights = useMemo(() => (report ? buildInsights(report, period) : []), [report, period]);

  // Días de la semana más fuertes (promedio por día), solo con datos diarios de una semana o más.
  const weekday = useMemo(() => {
    if (!report || report.meta.bucket !== "day" || report.series.length < 7) return null;
    const sum = Array(7).fill(0), cnt = Array(7).fill(0);
    for (const p of report.series) { const d = new Date(p.t).getDay(); sum[d] += Number(p.sales); cnt[d] += 1; }
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map((d) => ({ key: String(d), label: WEEKDAYS[d], value: cnt[d] ? sum[d] / cnt[d] : 0, hint: "promedio" }));
  }, [report]);

  const allTiles = k && prev ? [
    { key: "orders", label: "Pedidos", value: k.orders, fmt: (v: number) => formatNumber(Math.round(v)), delta: delta(k.orders, prev.orders), icon: <ShoppingCart size={17} />, color: "#0ea5e9", spark: report?.series.map((p) => p.orders) ?? null },
    { key: "ticket", label: "Ticket promedio", value: ticket, fmt: formatMoneyCompact, delta: delta(ticket, prevTicket), icon: <ReceiptText size={17} />, color: "#f59e0b", spark: report?.series.map((p) => (p.orders ? p.sales / p.orders : 0)) ?? null },
    { key: "profit", label: "Ganancia estimada", value: profit, fmt: formatMoneyCompact, delta: delta(profit, prevProfit), icon: <BadgePercent size={17} />, color: "#10b981", spark: report?.series.map((p) => p.profit) ?? null, sub: `Margen ${margin.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%` },
    { key: "units", label: "Unidades vendidas", value: k.units, fmt: (v: number) => formatNumber(Math.round(v)), delta: delta(k.units, prev.units), icon: <Package size={17} />, color: "#8b5cf6", spark: null },
    { key: "customers", label: "Clientes atendidos", value: k.customers, fmt: (v: number) => formatNumber(Math.round(v)), delta: null, icon: <Users size={17} />, color: "#ec4899", spark: null, sub: report ? `${formatNumber(report.customers.new)} nuevos registrados` : undefined },
    { key: "purchases", label: "Compras a proveedores", value: report?.purchases?.total ?? 0, fmt: formatMoneyCompact, delta: null, icon: <Truck size={17} />, color: "#14b8a6", spark: null, sub: `${formatNumber(report?.purchases?.count ?? 0)} ingresos de factura` },
  ] : [];
  // Sin «Ver costos»: la base no manda costo ni ganancia; esas tarjetas no se muestran.
  const tiles = costsHidden ? allTiles.filter((t) => t.key !== "profit" && t.key !== "purchases") : allTiles;

  const metricPoints = report?.series.map((p) => ({ t: p.t, v: metric === "sales" ? Number(p.sales) : metric === "profit" ? Number(p.profit) : Number(p.orders), prev: metric === "sales" ? Number(p.prev) : null })) ?? [];
  const metricFormat = metric === "orders" ? (v: number) => formatNumber(Math.round(v)) : formatMoneyCompact;
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ barra de periodo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border p-1 [scrollbar-width:none]" style={card} role="tablist" aria-label="Periodo del informe">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => choosePeriod(p.key)}
              className="relative shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold" style={{ color: period === p.key ? "#fff" : "var(--t-text)" }}>
              {period === p.key ? <motion.span layoutId="report-period" className="absolute inset-0 rounded-xl" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }} transition={{ type: "spring", stiffness: 400, damping: 32 }} /> : null}
              <span className="relative">{p.label}</span>
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="flex items-center gap-1.5 rounded-2xl border px-2 py-1" style={card}>
            <CalendarRange size={15} style={{ color: "var(--t-muted)" }} />
            <DateField value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} ariaLabel="Desde" compact />
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>a</span>
            <DateField value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} ariaLabel="Hasta" compact />
          </div>
        ) : null}
        {points.length > 1 && !report?.meta.point_locked ? (
          <select className="rounded-2xl border px-3 py-2 text-xs font-semibold outline-none" style={card} value={pointId} onChange={(e) => setPointId(e.target.value)} aria-label="Punto de venta">
            <option value="">🏪 Todos los puntos</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
          </select>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className="grid h-9 w-9 place-items-center rounded-xl border transition hover:rotate-45" style={card} title="Actualizar" aria-label="Actualizar">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
          <ExportGate><button type="button" onClick={downloadCsv} disabled={!report} className="inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50" style={card} title="Descargar CSV para Excel">
            <Download size={15} /> Excel
          </button></ExportGate>
        </div>
      </div>

      {error ? <div className="rounded-3xl border border-dashed p-5 text-sm" style={{ borderColor: "var(--t-accent)" }}>{error}</div> : null}

      {report && k && prev ? (
        <div className={`space-y-4 transition-opacity duration-300 ${loading ? "opacity-60" : "opacity-100"}`}>
          {/* ------------------------------------------------ ventas (héroe) */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7"
            style={{ borderColor: "var(--t-card-border)", background: "linear-gradient(135deg, color-mix(in oklab, var(--viz-1) 22%, var(--t-card-bg)) 0%, var(--t-card-bg) 55%, color-mix(in oklab, var(--viz-3) 12%, var(--t-card-bg)) 100%)" }}>
            <motion.div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--viz-1) 35%, transparent)" }}
              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
            <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--t-muted)" }}>
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: "var(--viz-1)" }}><Wallet size={14} /></span>
                  Ventas · {periodLabel.toLowerCase()}{report.meta.point ? ` · ${report.meta.point.name}` : ""}
                </p>
                <p className="mt-2 text-4xl font-black tracking-tight sm:text-6xl"><AnimatedNumber value={k.sales} format={formatMoney} /></p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <DeltaBadge value={delta(k.sales, prev.sales)} />
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>Antes: {formatMoney(prev.sales)}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { l: "Pedidos", v: formatNumber(k.orders) },
                    { l: "Ticket", v: formatMoneyCompact(ticket) },
                    ...(costsHidden ? [] : [{ l: "Ganancia", v: formatMoneyCompact(profit) }]),
                  ].map((c) => (
                    <span key={c.l} className="rounded-xl border px-3 py-1.5 text-xs" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
                      <span style={{ color: "var(--t-muted)" }}>{c.l}</span> <b className="ml-1">{c.v}</b>
                    </span>
                  ))}
                </div>
              </div>
              <AreaSpark values={report.series.map((p) => Number(p.sales))} height={110} />
            </div>
          </motion.section>

          {/* ------------------------------------------------ fichas */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {tiles.map((t, i) => (
              <motion.div key={t.key} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 0.05 + i * 0.05 } }} whileHover={{ y: -3 }}
                className="relative flex flex-col gap-1.5 overflow-hidden rounded-2xl border p-3.5" style={card}>
                <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full blur-2xl" style={{ background: `color-mix(in oklab, ${t.color} 30%, transparent)` }} />
                <p className="relative flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                  <span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ background: t.color }}>{t.icon}</span> {t.label}
                </p>
                <p className="relative text-2xl font-black"><AnimatedNumber value={t.value} format={t.fmt} /></p>
                {t.delta !== null && t.delta !== undefined ? <DeltaBadge value={t.delta} compact /> : t.sub ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{t.sub}</p> : null}
                {t.spark ? <AreaSpark values={t.spark} color={t.color} height={30} /> : null}
              </motion.div>
            ))}
          </div>

          {/* ------------------------------------------------ lo que dicen tus números */}
          {insights.length ? (
            <Card title="Lo que dicen tus números" icon={<Lightbulb size={17} />} color="#f59e0b">
              <ul className="grid gap-2 md:grid-cols-2">
                {insights.map((ins, i) => {
                  const body = (
                    <>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `color-mix(in oklab, ${TONE[ins.tone]} 16%, transparent)` }}>{ins.icon}</span>
                      <span className="min-w-0 flex-1 text-sm leading-snug">{ins.text}</span>
                      {ins.href ? <ArrowUpRight size={15} className="shrink-0 opacity-50" /> : null}
                    </>
                  );
                  return (
                    <motion.li key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
                      {ins.href ? (
                        <Link href={ins.href} className="flex items-center gap-3 rounded-2xl border p-2.5 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", borderLeft: `3px solid ${TONE[ins.tone]}` }}>{body}</Link>
                      ) : (
                        <div className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: "var(--t-card-border)", borderLeft: `3px solid ${TONE[ins.tone]}` }}>{body}</div>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {/* ------------------------------------------------ tendencia + canales */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              title={metric === "sales" ? "Ventas en el tiempo" : metric === "profit" ? "Ganancia en el tiempo" : "Pedidos en el tiempo"}
              icon={<CalendarRange size={17} />} color="var(--viz-1)" className="xl:col-span-2"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-0.5 rounded-xl border p-0.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    {([["sales", "Ventas"], ...(costsHidden ? [] : [["profit", "Ganancia"]]), ["orders", "Pedidos"]] as Array<[typeof metric, string]>).map(([key, lbl]) => (
                      <button key={key} type="button" onClick={() => setMetric(key)} className="relative rounded-lg px-2.5 py-1" style={{ color: metric === key ? "#fff" : "var(--t-muted)" }}>
                        {metric === key ? <motion.span layoutId="metric-pill" className="absolute inset-0 rounded-lg" style={{ background: "var(--viz-1)" }} /> : null}
                        <span className="relative">{lbl}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={card} aria-pressed={showTable}>
                    <Table2 size={13} /> {showTable ? "Gráfica" : "Tabla"}
                  </button>
                </div>
              }
            >
              {metric === "sales" && !showTable ? (
                <div className="mb-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--t-muted)" }}>
                  <span className="inline-flex items-center gap-2"><span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--viz-1)" }} /> {periodLabel}</span>
                  <span className="inline-flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-prev)" }} /> Periodo anterior</span>
                </div>
              ) : null}
              {showTable ? (
                <div className="max-h-72 overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
                  <table className="rt w-full text-sm">
                    <thead className="sticky top-0" style={{ background: "var(--t-bg-base)", color: "var(--t-muted)" }}>
                      <tr><th className="px-3 py-2 text-left text-xs">Fecha</th><th className="px-3 py-2 text-right text-xs">Ventas</th><th className="px-3 py-2 text-right text-xs">Anterior</th>{costsHidden ? null : <th className="px-3 py-2 text-right text-xs">Ganancia</th>}<th className="px-3 py-2 text-right text-xs">Pedidos</th></tr>
                    </thead>
                    <tbody>
                      {report.series.map((p) => (
                        <tr key={p.t} className="border-t" style={{ borderColor: "var(--t-card-border)", fontVariantNumeric: "tabular-nums" }}>
                          <td className="px-3 py-1.5">{bucketLabel(p.t, report.meta.bucket)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{formatMoney(p.sales)}</td>
                          <td className="px-3 py-1.5 text-right" style={{ color: "var(--t-muted)" }}>{formatMoney(p.prev)}</td>
                          {costsHidden ? null : <td className="px-3 py-1.5 text-right">{formatMoney(p.profit)}</td>}
                          <td className="px-3 py-1.5 text-right">{p.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <MetricChart points={metricPoints} bucket={report.meta.bucket} format={metricFormat} label="Tendencia del periodo" bestLabel={`Mejor ${BUCKET_WORD[report.meta.bucket] ?? ""}`} />
              )}
            </Card>

            <Card title="Canales de venta" icon={<LayoutGrid size={17} />} color="#0ea5e9" delay={0.05}>
              <Donut parts={report.by_channel.slice(0, 4).map((c) => ({ key: c.channel, label: CHANNEL_LABELS[c.channel] ?? c.channel, value: Number(c.sales) }))} centerLabel="Ventas" />
              {report.by_catalog.length ? (
                <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--t-card-border)" }}>
                  <p className="mb-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Por catálogo</p>
                  <BarList rows={report.by_catalog.map((c) => ({ key: c.catalog_id ?? c.name, label: c.name, value: Number(c.sales), sub: `${formatNumber(c.orders)} pedidos` }))} />
                </div>
              ) : null}
            </Card>
          </div>

          {/* ------------------------------------------------ podio de productos + puntos + días */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Productos más vendidos" icon={<Trophy size={17} />} color="#f59e0b" className="xl:col-span-2">
              {report.top_products.length ? (
                <>
                  <div className="mb-4 grid grid-cols-3 items-end gap-2 sm:gap-3">
                    {[1, 0, 2].map((idx) => {
                      const p = report.top_products[idx];
                      if (!p) return <div key={idx} />;
                      const medal = ["🥇", "🥈", "🥉"][idx];
                      const h = idx === 0 ? "h-24 sm:h-28" : idx === 1 ? "h-16 sm:h-20" : "h-12 sm:h-14";
                      return (
                        <motion.div key={p.product_id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 * (idx === 0 ? 0 : idx), type: "spring", stiffness: 200, damping: 18 }}
                          className="flex min-w-0 flex-col items-center text-center">
                          <div className="relative">
                            {p.image_url ? <img src={p.image_url} alt="" className="h-14 w-14 rounded-2xl border object-cover shadow-lg sm:h-16 sm:w-16" style={{ borderColor: "var(--t-card-border)" }} loading="lazy" />
                              : <span className="grid h-14 w-14 place-items-center rounded-2xl text-2xl sm:h-16 sm:w-16" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>}
                            <span className="absolute -right-2 -top-2 text-2xl drop-shadow">{medal}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 w-full text-[11px] font-bold leading-tight sm:text-xs">{p.name}</p>
                          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{formatNumber(p.units)} und. · {formatMoneyCompact(p.sales)}</p>
                          <div className={`mt-1.5 w-full rounded-t-xl ${h}`} style={{ background: idx === 0 ? "linear-gradient(180deg, #f59e0b, color-mix(in oklab, #f59e0b 35%, transparent))" : idx === 1 ? "linear-gradient(180deg, #94a3b8, color-mix(in oklab, #94a3b8 30%, transparent))" : "linear-gradient(180deg, #c2410c, color-mix(in oklab, #c2410c 30%, transparent))" }} />
                        </motion.div>
                      );
                    })}
                  </div>
                  <BarList rows={report.top_products.slice(3).map((p) => ({ key: p.product_id, label: p.name, value: Number(p.sales), image: p.image_url, sub: `${formatNumber(p.units)} und.${costsHidden ? "" : ` · ganancia ${formatMoneyCompact(p.profit)}`}` }))} emptyText="" />
                </>
              ) : <p className="py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>Sin ventas en este periodo.</p>}
            </Card>

            <div className="space-y-4">
              <Card title="Ventas por punto" icon={<Store size={17} />} color="#8b5cf6">
                <BarList rows={report.by_point.map((p) => ({ key: p.point_id ?? "online", label: p.name, value: Number(p.sales), sub: `${formatNumber(p.orders)} pedidos${costsHidden ? "" : ` · ganancia ${formatMoneyCompact(p.profit)}`}` }))} />
              </Card>
              {weekday ? (
                <Card title="Tus días más fuertes" icon={<CalendarDays size={17} />} color="#ec4899">
                  <ColumnBars rows={weekday} />
                  <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Promedio de ventas por día de la semana en este periodo.</p>
                </Card>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Mejores clientes" icon={<UserRound size={17} />} color="#10b981">
              <BarList rows={report.top_customers.map((c) => ({ key: c.name, label: c.name, value: Number(c.sales), sub: `${formatNumber(c.orders)} pedido${c.orders === 1 ? "" : "s"}` }))} emptyText="Aún no hay clientes con nombre en este periodo." />
            </Card>
            <Card title="Vendedores" icon={<Users size={17} />} color="#0ea5e9" delay={0.05}>
              <BarList rows={report.sellers.map((s) => ({ key: s.name, label: s.name, value: Number(s.sales), sub: `${formatNumber(s.orders)} venta${s.orders === 1 ? "" : "s"}` }))} emptyText="Las ventas del POS con vendedor aparecerán aquí." />
            </Card>
          </div>

          {/* ------------------------------------------------ plegables */}
          <div className="space-y-3">
            <Fold
              id="inventory" title="Inventario por punto y bodega" icon={<Boxes size={18} />} color="#14b8a6"
              summary={`${costsHidden ? `${formatNumber(report.inventory.reduce((s, w) => s + w.units, 0))} unidades` : `Valor a costo ${formatMoneyCompact(inventoryValue)}`} · ${formatNumber(report.inventory.reduce((s, w) => s + w.out, 0))} agotados · ${formatNumber(report.inventory.reduce((s, w) => s + w.low, 0))} con pocas unidades`}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {report.inventory.map((w) => (
                  <div key={w.point_id} className="rounded-2xl border p-3.5" style={card}>
                    <p className="flex items-center gap-1.5 text-sm font-bold">{w.kind === "point" ? "📍" : "🏬"} {w.name}{w.is_default ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>Principal</span> : null}</p>
                    {costsHidden ? null : (
                      <>
                        <p className="mt-1 text-xl font-black">{formatMoneyCompact(w.value)}</p>
                        <Meter value={Number(w.value)} max={maxInventoryValue} />
                      </>
                    )}
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                      <span><b className="block text-sm">{formatNumber(w.units)}</b>unidades</span>
                      <span><b className="block text-sm" style={{ color: w.out ? "#d03b3b" : undefined }}>{w.out ? `⛔ ${formatNumber(w.out)}` : "0"}</b>agotados</span>
                      <span><b className="block text-sm" style={{ color: w.low ? "#b45309" : undefined }}>{w.low ? `⚠️ ${formatNumber(w.low)}` : "0"}</b>pocas und.</span>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/dashboard/inventario" className="mt-3 inline-block text-xs font-semibold underline">Ir a inventario →</Link>
            </Fold>

            {report.payables ? (
              <Fold
                id="payables" title="Proveedores y cuentas por pagar" icon={<Wallet size={18} />} color="#ef4444"
                summary={`Saldo ${formatMoneyCompact(report.payables.open)} · vencido ${formatMoneyCompact(report.payables.overdue)} · vence esta semana ${formatMoneyCompact(report.payables.due_soon)}`}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Saldo por pagar", value: report.payables.open, count: report.payables.open_count, tone: "var(--t-text)" },
                    { label: "⛔ Vencido", value: report.payables.overdue, count: report.payables.overdue_count, tone: "#d03b3b" },
                    { label: "⚠️ Vence en 7 días", value: report.payables.due_soon, count: report.payables.due_soon_count, tone: "#b45309" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border p-3" style={card}>
                      <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{s.label}</p>
                      <p className="mt-1 text-xl font-black" style={{ color: s.tone }}>{formatMoney(s.value)}</p>
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{s.count} cuenta{s.count === 1 ? "" : "s"}</p>
                    </div>
                  ))}
                </div>
                {report.payables.upcoming.length ? (
                  <ul className="mt-3 divide-y rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                    {report.payables.upcoming.map((p, i) => {
                      const overdue = p.due_date && new Date(`${p.due_date}T23:59:59`) < new Date();
                      return (
                        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                          <span className="min-w-0 truncate">{p.supplier}</span>
                          <span className="shrink-0 text-xs" style={{ color: overdue ? "#d03b3b" : "var(--t-muted)" }}>{overdue ? "⛔ Vencida" : "Vence"} {p.due_date ? new Date(`${p.due_date}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : "—"}</span>
                          <b className="shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(p.balance)}</b>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {report.purchases?.top_suppliers.length ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Compras del periodo por proveedor</p>
                    <BarList rows={report.purchases.top_suppliers.map((s) => ({ key: s.name, label: s.name, value: Number(s.total), sub: `${s.count} factura${s.count === 1 ? "" : "s"}` }))} />
                  </div>
                ) : null}
              </Fold>
            ) : null}

            <Fold id="transfers" title="Traslados en camino" icon={<Truck size={18} />} color="#f97316"
              summary={report.transfers.in_transit ? `${report.transfers.in_transit} en tránsito` : "Ningún traslado en camino"}>
              {report.transfers.list.length ? (
                <ul className="space-y-2">
                  {report.transfers.list.map((t) => (
                    <li key={t.number} className="rounded-2xl border p-3" style={card}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <b>#{t.number} · {t.from} → {t.to}</b>
                        <span className="text-xs" style={{ color: "var(--t-muted)" }}>Desde {new Date(t.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Meter value={t.signatures} max={4} />
                        <span className="shrink-0 text-xs" style={{ color: "var(--t-muted)" }}>{t.signatures}/4 firmas</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Todo recibido. 🎉</p>}
            </Fold>

            <Fold id="orders" title="Pedidos por confirmar" icon={<ReceiptText size={18} />} color="#6366f1"
              summary={report.pending_orders.count ? `${report.pending_orders.count} pedidos por ${formatMoneyCompact(report.pending_orders.total)}` : "No hay pedidos pendientes"}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  <b>{report.pending_orders.count}</b> pedidos abiertos por <b>{formatMoney(report.pending_orders.total)}</b>
                  {report.pending_orders.oldest ? <span style={{ color: "var(--t-muted)" }}> · el más antiguo del {new Date(report.pending_orders.oldest).toLocaleDateString("es-CO", { day: "numeric", month: "long" })}</span> : null}
                </p>
                <Link href="/dashboard/pedidos" className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>Revisar pedidos</Link>
              </div>
            </Fold>
          </div>
        </div>
      ) : !error ? (
        <div className="space-y-3">
          <div className="h-48 animate-pulse rounded-[28px]" style={{ background: "var(--t-card-bg-soft)" }} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg-soft)" }} />)}
          </div>
          <div className="h-72 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg-soft)" }} />
        </div>
      ) : null}
    </div>
  );
}
