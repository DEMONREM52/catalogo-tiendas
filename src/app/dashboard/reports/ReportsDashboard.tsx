"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgePercent,
  Boxes,
  CalendarRange,
  ChevronDown,
  Download,
  LayoutGrid,
  Loader2,
  Minus,
  Package,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Store,
  Table2,
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
import { BarList, Meter, ShareBar, Sparkline, TrendChart, TrendLegend } from "./charts";

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

function DeltaBadge({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean }) {
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
      <span className="font-normal" style={{ color: "var(--t-muted)" }}>vs. anterior</span>
    </span>
  );
}

function Card({ title, icon, actions, children, className }: { title: string; icon: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border p-4 sm:p-5 ${className ?? ""}`} style={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}>{icon}</span>
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Fold({ id, title, icon, summary, children }: { id: string; title: string; icon: ReactNode; summary: ReactNode; children: ReactNode }) {
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
        className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
        aria-expanded={open}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--t-cta)" }}>{icon}</span>
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
  add("Costo", report.kpis.cost, report.previous.cost);
  add("Ganancia estimada", report.kpis.sales - report.kpis.cost, report.previous.sales - report.previous.cost);
  add("Pedidos", report.kpis.orders, report.previous.orders);
  add("Unidades", report.kpis.units, report.previous.units);
  add();
  add("Fecha", "Ventas", "Periodo anterior", "Pedidos");
  for (const p of report.series) add(bucketLabel(p.t, report.meta.bucket), p.sales, p.prev, p.orders);
  add();
  add("Punto", "Ventas", "Pedidos", "Unidades", "Ganancia");
  for (const p of report.by_point) add(p.name, p.sales, p.orders, p.units, p.profit);
  add();
  add("Producto", "Unidades", "Ventas", "Ganancia");
  for (const p of report.top_products) add(p.name, p.units, p.sales, p.profit);
  add();
  add("Cliente", "Pedidos", "Compras");
  for (const c of report.top_customers) add(c.name, c.orders, c.sales);
  return lines.join("\n");
}

export default function ReportsDashboard({ storeId, points }: { storeId: string; points: PointOption[] }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [pointId, setPointId] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTable, setShowTable] = useState(false);
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
    const blob = new Blob([`﻿${toCsv(report)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe-${range.from.toISOString().slice(0, 10)}-a-${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const k = report?.kpis;
  const prev = report?.previous;
  const profit = k ? k.sales - k.cost : 0;
  const prevProfit = prev ? prev.sales - prev.cost : 0;
  const ticket = k && k.orders ? k.sales / k.orders : 0;
  const prevTicket = prev && prev.orders ? prev.sales / prev.orders : 0;
  const margin = k && k.sales ? (profit / k.sales) * 100 : 0;
  const salesSpark = report?.series.map((p) => p.sales) ?? [];
  const ordersSpark = report?.series.map((p) => p.orders) ?? [];
  const profitSpark = report?.series.map((p) => p.profit) ?? [];
  const inventoryValue = report?.inventory.reduce((s, w) => s + Number(w.value), 0) ?? 0;
  const maxInventoryValue = Math.max(1, ...(report?.inventory.map((w) => Number(w.value)) ?? [1]));

  const tiles = k && prev ? [
    { key: "orders", label: "Pedidos", value: formatNumber(k.orders), delta: delta(k.orders, prev.orders), icon: <ShoppingCart size={16} />, spark: ordersSpark },
    { key: "ticket", label: "Ticket promedio", value: formatMoneyCompact(ticket), delta: delta(ticket, prevTicket), icon: <ReceiptText size={16} />, spark: null },
    { key: "profit", label: "Ganancia estimada", value: formatMoneyCompact(profit), delta: delta(profit, prevProfit), icon: <BadgePercent size={16} />, spark: profitSpark, sub: `Margen ${margin.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%` },
    { key: "units", label: "Unidades vendidas", value: formatNumber(k.units), delta: delta(k.units, prev.units), icon: <Package size={16} />, spark: null },
    { key: "customers", label: "Clientes atendidos", value: formatNumber(k.customers), delta: null, icon: <Users size={16} />, spark: null, sub: report ? `${formatNumber(report.customers.new)} nuevos registrados` : undefined },
    { key: "purchases", label: "Compras a proveedores", value: formatMoneyCompact(report?.purchases.total ?? 0), delta: null, icon: <Truck size={16} />, spark: null, sub: `${formatNumber(report?.purchases.count ?? 0)} ingresos de factura` },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border p-1" style={card} role="tablist" aria-label="Periodo del informe">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              onClick={() => choosePeriod(p.key)}
              className="relative shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{ color: period === p.key ? "#fff" : "var(--t-text)" }}
            >
              {period === p.key ? <motion.span layoutId="report-period" className="absolute inset-0 rounded-xl" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 400, damping: 32 }} /> : null}
              <span className="relative">{p.label}</span>
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="flex items-center gap-1.5 rounded-2xl border px-2 py-1" style={card}>
            <CalendarRange size={15} style={{ color: "var(--t-muted)" }} />
            <input type="date" className="bg-transparent text-xs outline-none" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="Desde" />
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>a</span>
            <input type="date" className="bg-transparent text-xs outline-none" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="Hasta" />
          </div>
        ) : null}
        {points.length > 1 && !report?.meta.point_locked ? (
          <select
            className="rounded-2xl border px-3 py-2 text-xs font-semibold outline-none"
            style={card}
            value={pointId}
            onChange={(e) => setPointId(e.target.value)}
            aria-label="Punto de venta"
          >
            <option value="">🏪 Todos los puntos</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
          </select>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className="grid h-9 w-9 place-items-center rounded-xl border" style={card} title="Actualizar" aria-label="Actualizar">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
          <button type="button" onClick={downloadCsv} disabled={!report} className="inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50" style={card} title="Descargar CSV para Excel">
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-3xl border border-dashed p-5 text-sm" style={{ borderColor: "var(--t-accent)" }}>{error}</div>
      ) : null}

      {report && k && prev ? (
        <div className={`space-y-4 transition-opacity duration-300 ${loading ? "opacity-60" : "opacity-100"}`}>
          <section className="relative overflow-hidden rounded-3xl border p-5 sm:p-7" style={card}>
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }} />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>
                  Ventas · {PERIODS.find((p) => p.key === period)?.label.toLowerCase()}{report.meta.point ? ` · ${report.meta.point.name}` : ""}
                </p>
                <motion.p key={`${k.sales}-${period}-${pointId}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-1 text-5xl font-black tracking-tight sm:text-6xl">
                  {formatMoney(k.sales)}
                </motion.p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <DeltaBadge value={delta(k.sales, prev.sales)} />
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>Antes: {formatMoney(prev.sales)}</span>
                </div>
              </div>
              <div className="w-full max-w-xs">
                <Sparkline values={salesSpark} height={48} />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {tiles.map((t, i) => (
              <motion.div
                key={t.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
                whileHover={{ y: -2 }}
                className="flex flex-col gap-1 rounded-2xl border p-3.5"
                style={card}
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
                  <span style={{ color: "var(--t-accent)" }}>{t.icon}</span> {t.label}
                </p>
                <p className="text-2xl font-black">{t.value}</p>
                {t.delta !== null && t.delta !== undefined ? <DeltaBadge value={t.delta} /> : t.sub ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{t.sub}</p> : null}
                {t.spark ? <Sparkline values={t.spark} /> : null}
              </motion.div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              title="Ventas en el tiempo"
              icon={<CalendarRange size={16} />}
              className="xl:col-span-2"
              actions={
                <div className="flex items-center gap-3">
                  <TrendLegend />
                  <button type="button" onClick={() => setShowTable((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={card} aria-pressed={showTable}>
                    <Table2 size={13} /> {showTable ? "Gráfica" : "Tabla"}
                  </button>
                </div>
              }
            >
              {showTable ? (
                <div className="max-h-72 overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0" style={{ background: "var(--t-bg-base)", color: "var(--t-muted)" }}>
                      <tr><th className="px-3 py-2 text-left text-xs">Fecha</th><th className="px-3 py-2 text-right text-xs">Ventas</th><th className="px-3 py-2 text-right text-xs">Anterior</th><th className="px-3 py-2 text-right text-xs">Pedidos</th></tr>
                    </thead>
                    <tbody>
                      {report.series.map((p) => (
                        <tr key={p.t} className="border-t" style={{ borderColor: "var(--t-card-border)", fontVariantNumeric: "tabular-nums" }}>
                          <td className="px-3 py-1.5">{bucketLabel(p.t, report.meta.bucket)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{formatMoney(p.sales)}</td>
                          <td className="px-3 py-1.5 text-right" style={{ color: "var(--t-muted)" }}>{formatMoney(p.prev)}</td>
                          <td className="px-3 py-1.5 text-right">{p.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <TrendChart series={report.series} bucket={report.meta.bucket} />
              )}
            </Card>

            <Card title="Ventas por punto" icon={<Store size={16} />}>
              <BarList
                rows={report.by_point.map((p) => ({ key: p.point_id ?? "online", label: p.name, value: Number(p.sales), sub: `${formatNumber(p.orders)} pedidos · ganancia ${formatMoneyCompact(p.profit)}` }))}
              />
            </Card>

            <Card title="Canales de venta" icon={<LayoutGrid size={16} />}>
              <ShareBar parts={report.by_channel.slice(0, 4).map((c) => ({ key: c.channel, label: CHANNEL_LABELS[c.channel] ?? c.channel, value: Number(c.sales) }))} />
              {report.by_catalog.length ? (
                <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--t-card-border)" }}>
                  <p className="mb-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Por catálogo</p>
                  <BarList rows={report.by_catalog.map((c) => ({ key: c.catalog_id ?? c.name, label: c.name, value: Number(c.sales), sub: `${formatNumber(c.orders)} pedidos` }))} />
                </div>
              ) : null}
            </Card>

            <Card title="Productos más vendidos" icon={<Package size={16} />}>
              <BarList rows={report.top_products.map((p) => ({ key: p.product_id, label: p.name, value: Number(p.sales), image: p.image_url, sub: `${formatNumber(p.units)} und. · ganancia ${formatMoneyCompact(p.profit)}` }))} />
            </Card>

            <Card title="Mejores clientes" icon={<UserRound size={16} />}>
              <BarList rows={report.top_customers.map((c) => ({ key: c.name, label: c.name, value: Number(c.sales), sub: `${formatNumber(c.orders)} pedido${c.orders === 1 ? "" : "s"}` }))} emptyText="Aún no hay clientes con nombre en este periodo." />
            </Card>

            <Card title="Vendedores" icon={<Users size={16} />} className={report.sellers.length ? "" : "hidden xl:block"}>
              <BarList rows={report.sellers.map((s) => ({ key: s.name, label: s.name, value: Number(s.sales), sub: `${formatNumber(s.orders)} venta${s.orders === 1 ? "" : "s"}` }))} emptyText="Las ventas del POS con vendedor aparecerán aquí." />
            </Card>
          </div>

          <div className="space-y-3">
            <Fold
              id="inventory"
              title="Inventario por punto y bodega"
              icon={<Boxes size={18} />}
              summary={`Valor a costo ${formatMoneyCompact(inventoryValue)} · ${formatNumber(report.inventory.reduce((s, w) => s + w.out, 0))} agotados · ${formatNumber(report.inventory.reduce((s, w) => s + w.low, 0))} con pocas unidades`}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {report.inventory.map((w) => (
                  <div key={w.point_id} className="rounded-2xl border p-3.5" style={card}>
                    <p className="flex items-center gap-1.5 text-sm font-bold">{w.kind === "point" ? "📍" : "🏬"} {w.name}{w.is_default ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>Principal</span> : null}</p>
                    <p className="mt-1 text-xl font-black">{formatMoneyCompact(w.value)}</p>
                    <Meter value={Number(w.value)} max={maxInventoryValue} />
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
                id="payables"
                title="Proveedores y cuentas por pagar"
                icon={<Wallet size={18} />}
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
                {report.purchases.top_suppliers.length ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Compras del periodo por proveedor</p>
                    <BarList rows={report.purchases.top_suppliers.map((s) => ({ key: s.name, label: s.name, value: Number(s.total), sub: `${s.count} factura${s.count === 1 ? "" : "s"}` }))} />
                  </div>
                ) : null}
              </Fold>
            ) : null}

            <Fold
              id="transfers"
              title="Traslados en camino"
              icon={<Truck size={18} />}
              summary={report.transfers.in_transit ? `${report.transfers.in_transit} en tránsito` : "Ningún traslado en camino"}
            >
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
              ) : (
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>Todo recibido. 🎉</p>
              )}
            </Fold>

            <Fold
              id="orders"
              title="Pedidos por confirmar"
              icon={<ReceiptText size={18} />}
              summary={report.pending_orders.count ? `${report.pending_orders.count} pedidos por ${formatMoneyCompact(report.pending_orders.total)}` : "No hay pedidos pendientes"}
            >
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
          <div className="h-40 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg-soft)" }} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg-soft)" }} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
