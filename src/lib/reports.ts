// Informes del panel (ver erp_report / erp_alerts en 20261014_catalogs_reports.sql).

export type ReportBucket = "hour" | "day" | "week" | "month";

export type ReportPayload = {
  meta: { from: string; to: string; prev_from: string; bucket: ReportBucket; point: { id: string; name: string } | null; point_locked: boolean };
  kpis: { sales: number; cost: number; units: number; orders: number; customers: number };
  previous: { sales: number; cost: number; units: number; orders: number };
  series: Array<{ t: string; sales: number; profit: number; orders: number; prev: number }>;
  by_point: Array<{ point_id: string | null; name: string; kind: string | null; sales: number; orders: number; units: number; profit: number }>;
  by_channel: Array<{ channel: "pos" | "catalog" | "retail" | "wholesale"; sales: number; orders: number }>;
  by_catalog: Array<{ catalog_id: string | null; name: string; sales: number; orders: number }>;
  top_products: Array<{ product_id: string; name: string; image_url: string | null; units: number; sales: number; profit: number }>;
  top_customers: Array<{ name: string; sales: number; orders: number }>;
  sellers: Array<{ name: string; sales: number; orders: number }>;
  pending_orders: { count: number; total: number; oldest: string | null };
  inventory: Array<{ point_id: string; name: string; kind: string; is_default: boolean; units: number; value: number; skus: number; out: number; low: number }>;
  purchases: { count: number; total: number; top_suppliers: Array<{ name: string; total: number; count: number }> };
  payables: null | {
    open: number;
    open_count: number;
    overdue: number;
    overdue_count: number;
    due_soon: number;
    due_soon_count: number;
    upcoming: Array<{ supplier: string; balance: number; due_date: string | null }>;
  };
  transfers: { in_transit: number; list: Array<{ number: number; from: string; to: string; created_at: string; signatures: number }> };
  customers: { total: number; new: number };
  catalogs: number;
};

export type AlertSeverity = "critical" | "serious" | "warning" | "info" | "good";

export type StoreAlert = {
  key: string;
  severity: AlertSeverity;
  icon: string;
  title: string;
  body: string;
  href: string;
  count?: number;
};

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month" | "quarter" | "year" | "custom";

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "yesterday", label: "Ayer" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "month", label: "Este mes" },
  { key: "last_month", label: "Mes pasado" },
  { key: "quarter", label: "Trimestre" },
  { key: "year", label: "Este año" },
  { key: "custom", label: "Personalizado" },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Rango [desde, hasta) en hora local del navegador. */
export function periodRange(key: PeriodKey, custom?: { from: string; to: string }) {
  const now = new Date();
  const today = startOfDay(now);
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  switch (key) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    case "last_month":
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3) * 3;
      return { from: new Date(today.getFullYear(), q, 1), to: addDays(today, 1) };
    }
    case "year":
      return { from: new Date(today.getFullYear(), 0, 1), to: addDays(today, 1) };
    case "custom": {
      const from = custom?.from ? new Date(`${custom.from}T00:00:00`) : addDays(today, -29);
      const toDay = custom?.to ? new Date(`${custom.to}T00:00:00`) : today;
      return { from, to: addDays(toDay, 1) };
    }
  }
}

export function formatMoney(value: number | null | undefined) {
  return `$${Math.round(Number(value ?? 0)).toLocaleString("es-CO")}`;
}

/** Valores compactos para ejes y fichas: $1,2 M · $350 mil. */
export function formatMoneyCompact(value: number | null | undefined) {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} mil M`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (abs >= 10_000) return `$${Math.round(n / 1000).toLocaleString("es-CO")} mil`;
  return formatMoney(n);
}

export function formatNumber(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)).toLocaleString("es-CO");
}

/** Variación contra el periodo anterior; null si no hay base para comparar. */
export function delta(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function bucketLabel(iso: string, bucket: ReportBucket) {
  const d = new Date(iso);
  if (bucket === "hour") return d.toLocaleTimeString("es-CO", { hour: "numeric" });
  if (bucket === "month") return d.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
  if (bucket === "week") return `Sem. ${d.toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

export const CHANNEL_LABELS: Record<string, string> = {
  pos: "Punto de venta (POS)",
  catalog: "Catálogos en línea",
  retail: "Catálogo detal",
  wholesale: "Catálogo mayor",
};
