"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRightLeft, Banknote, ChevronRight, ClipboardCheck, PackagePlus, PackageSearch, Receipt, RefreshCw, Search, ShoppingBag,
  ShoppingCart, Truck, Wallet, Wrench, X, type LucideIcon,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { fold } from "@/lib/fuzzy-search";
import { useSearchValue } from "@/lib/search-timing";
import { AnimatedNumber, AreaSpark } from "../reports/charts";

/* ============================================================ tipos */
type FeedKind = "factura" | "remision" | "order" | "stock_request" | "transfer" | "purchase" | "adjustment" | "expense" | "cash";
type FeedItem = { kind: FeedKind; id: string; ref: string; title: string; sub: string | null; amount: number | null; status: string; at: string; href: string; point_id: string | null };
type Kpis = {
  sales_today?: { count: number; total: number };
  sales_yesterday?: { count: number; total: number; count_same_hour: number; total_same_hour: number };
  by_hour?: number[];
  to_confirm?: number; to_complete?: number;
  sr_open?: number; sr_urgent?: number;
  transfers_in_transit?: number;
  cash_open?: number; cash_review?: number;
  purchases_month?: { count: number; total: number };
  expenses_month?: { count: number; total: number };
};
type Ops = {
  ok: true; now: string; kpis: Kpis; feed: FeedItem[];
  points: Array<{ id: string; name: string; count: number; total: number }>;
  my_points: Array<{ id: string; name: string }>;
  can: Record<"sales" | "stock_requests" | "transfers" | "purchases" | "adjustments" | "expenses" | "cash", boolean>;
};

/* ============================================================ catálogo visual */
const KIND: Record<FeedKind, { label: string; icon: LucideIcon; color: string; group: Group }> = {
  factura: { label: "Factura", icon: Receipt, color: "#8b5cf6", group: "ventas" },
  remision: { label: "Remisión", icon: Receipt, color: "#a855f7", group: "ventas" },
  order: { label: "Pedido", icon: ShoppingBag, color: "#ec4899", group: "ventas" },
  stock_request: { label: "Pedido interno", icon: ClipboardCheck, color: "#0ea5e9", group: "mercancia" },
  transfer: { label: "Traslado", icon: Truck, color: "#f97316", group: "mercancia" },
  purchase: { label: "Ingreso de factura", icon: PackageSearch, color: "#10b981", group: "mercancia" },
  adjustment: { label: "Ajuste", icon: Wrench, color: "#f59e0b", group: "mercancia" },
  expense: { label: "Gasto", icon: Wallet, color: "#f43f5e", group: "dinero" },
  cash: { label: "Caja", icon: Banknote, color: "#14b8a6", group: "dinero" },
};
type Group = "all" | "ventas" | "mercancia" | "dinero" | "pendiente";
const GROUPS: Array<{ key: Group; label: string }> = [
  { key: "all", label: "Todo" }, { key: "pendiente", label: "⏳ Por atender" }, { key: "ventas", label: "🧾 Ventas y pedidos" },
  { key: "mercancia", label: "📦 Mercancía" }, { key: "dinero", label: "💵 Caja y gastos" },
];
const STATUS: Record<string, { label: string; color: string; pending?: boolean }> = {
  draft: { label: "Por confirmar", color: "#f59e0b", pending: true },
  sent: { label: "Por confirmar", color: "#f59e0b", pending: true },
  confirmed: { label: "Por completar", color: "#0ea5e9", pending: true },
  completed: { label: "Completado", color: "#22c55e" },
  cancelled: { label: "Anulado", color: "#94a3b8" },
  pending: { label: "Enviado", color: "#8b5cf6", pending: true },
  preparing: { label: "Preparando", color: "#f59e0b", pending: true },
  dispatched: { label: "En camino", color: "#0ea5e9", pending: true },
  in_transit: { label: "En camino", color: "#0ea5e9", pending: true },
  received: { label: "Recibido", color: "#22c55e" },
  rejected: { label: "Rechazado", color: "#ef4444" },
  open: { label: "Abierta", color: "#22c55e", pending: true },
  review: { label: "Por revisar", color: "#f59e0b", pending: true },
  closed: { label: "Cerrada", color: "#94a3b8" },
  partial: { label: "Abono", color: "#f59e0b", pending: true },
  paid: { label: "Pagado", color: "#22c55e" },
  void: { label: "Anulado", color: "#94a3b8" },
  done: { label: "Hecho", color: "#22c55e" },
};
const statusOf = (it: FeedItem) => (it.kind === "expense" && it.status === "pending" ? { label: "Por pagar", color: "#f43f5e", pending: true } : STATUS[it.status] ?? { label: it.status, color: "#94a3b8" });

const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const compact = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `$${Math.round(n / 1e3).toLocaleString("es-CO")} mil` : money(n));
const timeAgo = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
};
const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Hoy";
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-CO", { weekday: "long", day: "2-digit", month: "long" });
};

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" } as const;
const REFRESH_MS = 45_000;

/* ============================================================ página */
export default function OperationsPage() {
  const router = useRouter();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [data, setData] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [point, setPoint] = useState<string>("");
  const [group, setGroup] = useState<Group>("all");
  const [q, setQ] = useState("");
  const search = useSearchValue(q);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastAt, setLastAt] = useState<number | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    void getDashboardStore().then((a) => (a.store ? setStoreId(a.store.id) : setError("No tienes acceso a ninguna tienda."))).catch(() => setError("No se pudo cargar la tienda."));
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setBusy(true);
    const { data: res, error: err } = await supabaseBrowser().rpc("ops_center", { p_store: storeId, p_days: days, p_point: point || null });
    setBusy(false);
    if (err) {
      if (/ops_center|function|PGRST202/i.test(`${err.code} ${err.message}`)) setMissing(true);
      else setError(err.message);
      return;
    }
    const r = res as Ops | { ok: false; message: string };
    if (!r.ok) { setError(r.message); return; }
    setError(null);
    // Lo que llegó desde la última actualización se resalta un momento.
    const ids = new Set(r.feed.map((f) => `${f.kind}:${f.id}:${f.status}`));
    if (seen.current) {
      const prev = seen.current;
      const nw = new Set([...ids].filter((x) => !prev.has(x)));
      setFresh(nw);
      if (nw.size) window.setTimeout(() => setFresh(new Set()), 6000);
    }
    seen.current = ids;
    setData(r);
    setLastAt(Date.now());
  }, [storeId, days, point]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { seen.current = null; void load(); }, [load]);
  // En vivo: se actualiza solo cada 45 s con la pestaña a la vista, y al volver a ella.
  useEffect(() => {
    const tick = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(tick); window.clearInterval(clock); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const k = data?.kpis ?? {};
  const feed = useMemo(() => {
    const term = fold(search.value.trim());
    return (data?.feed ?? []).filter((it) => {
      if (group === "pendiente" ? !statusOf(it).pending : group !== "all" && KIND[it.kind].group !== group) return false;
      if (!term) return true;
      return fold(`${it.ref} ${it.title} ${it.sub ?? ""} ${KIND[it.kind].label} ${statusOf(it).label}`).includes(term);
    });
  }, [data, group, search.value]);
  const groupCount = (g: Group) => (data?.feed ?? []).filter((it) => (g === "all" ? true : g === "pendiente" ? statusOf(it).pending : KIND[it.kind].group === g)).length;
  const byDay = useMemo(() => {
    const out: Array<{ day: string; items: FeedItem[] }> = [];
    for (const it of feed.slice(0, 150)) {
      const d = dayLabel(it.at);
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(it);
    }
    return out;
  }, [feed]);

  const salesToday = Number(k.sales_today?.total ?? 0);
  const salesPrev = Number(k.sales_yesterday?.total_same_hour ?? 0);
  const delta = salesPrev > 0 ? Math.round(((salesToday - salesPrev) / salesPrev) * 100) : null;
  const hours = (k.by_hour ?? []).map(Number);
  const curHour = new Date().getHours();

  const can = data?.can;
  const tiles: Array<{ show: boolean; href: string; icon: LucideIcon; color: string; label: string; value: number; hint: string; alert?: boolean; money?: boolean }> = [
    { show: Boolean(can?.sales), href: "/dashboard/pedidos?ver=to_confirm", icon: ShoppingBag, color: "#f59e0b", label: "Por confirmar", value: Number(k.to_confirm ?? 0), hint: "pedidos esperando", alert: Number(k.to_confirm ?? 0) > 0 },
    { show: Boolean(can?.sales), href: "/dashboard/pedidos?ver=to_complete", icon: PackagePlus, color: "#0ea5e9", label: "Por completar", value: Number(k.to_complete ?? 0), hint: "confirmados sin entregar" },
    { show: Boolean(can?.stock_requests), href: "/dashboard/pedidos?tab=internos", icon: ClipboardCheck, color: "#8b5cf6", label: "Pedidos internos", value: Number(k.sr_open ?? 0), hint: k.sr_urgent ? `${k.sr_urgent} urgente${k.sr_urgent === 1 ? "" : "s"}` : "abiertos", alert: Number(k.sr_urgent ?? 0) > 0 },
    { show: Boolean(can?.transfers), href: "/dashboard/inventario?tab=transfers", icon: Truck, color: "#f97316", label: "Traslados", value: Number(k.transfers_in_transit ?? 0), hint: "en camino" },
    { show: Boolean(can?.cash), href: "/dashboard/caja", icon: Banknote, color: "#14b8a6", label: "Cajas abiertas", value: Number(k.cash_open ?? 0), hint: k.cash_review ? `${k.cash_review} por revisar` : "ahora", alert: Number(k.cash_review ?? 0) > 0 },
    { show: Boolean(can?.purchases), href: "/dashboard/inventario?tab=purchases", icon: PackageSearch, color: "#10b981", label: "Compras del mes", value: Number(k.purchases_month?.total ?? 0), hint: `${k.purchases_month?.count ?? 0} ingresos`, money: true },
    { show: Boolean(can?.expenses), href: "/dashboard/gastos", icon: Wallet, color: "#f43f5e", label: "Gastos del mes", value: Number(k.expenses_month?.total ?? 0), hint: `${k.expenses_month?.count ?? 0} gastos`, money: true },
  ];
  const actions: Array<{ show: boolean; href: string; icon: LucideIcon; label: string; color: string; key?: string }> = [
    { show: Boolean(can?.sales), href: "/dashboard/pos", icon: ShoppingCart, label: "Nueva venta", color: "#8b5cf6", key: "V" },
    { show: Boolean(can?.stock_requests), href: "/dashboard/pedidos?tab=internos&nuevo=1", icon: ClipboardCheck, label: "Pedir mercancía", color: "#0ea5e9", key: "P" },
    { show: Boolean(can?.transfers), href: "/dashboard/inventario?tab=transfers", icon: ArrowRightLeft, label: "Trasladar", color: "#f97316", key: "T" },
    { show: Boolean(can?.purchases), href: "/dashboard/inventario?tab=purchases", icon: PackageSearch, label: "Ingreso de factura", color: "#10b981", key: "I" },
    { show: Boolean(can?.expenses), href: "/dashboard/gastos?tab=expenses&nuevo=gasto", icon: Wallet, label: "Registrar gasto", color: "#f43f5e", key: "G" },
    { show: Boolean(can?.cash), href: "/dashboard/caja", icon: Banknote, label: "Caja", color: "#14b8a6", key: "C" },
  ];

  // Atajos de teclado: V, P, T, I, G, C abren cada acción; / busca; R actualiza.
  const searchRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key.toLowerCase() === "r") { void load(); return; }
      const hit = actionsRef.current.find((a) => a.show && a.key === e.key.toUpperCase());
      if (hit) { e.preventDefault(); router.push(hit.href); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, router]);

  if (missing) {
    return (
      <main className="space-y-4">
        <Hero lastAt={null} now={now} busy={false} onRefresh={() => void load()} />
        <div className="rounded-3xl border p-5 text-sm" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,.1)" }}>
          <p className="font-black">⚙️ Falta activar el centro en vivo</p>
          <p className="mt-1" style={{ color: "var(--t-muted)" }}>Corre en Supabase la migración <b>20261304_centro_operaciones.sql</b> y recarga esta página.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-4 pb-10">
      <Hero lastAt={lastAt} now={now} busy={busy} onRefresh={() => void load()}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            {([[1, "Hoy"], [7, "7 días"], [30, "30 días"]] as const).map(([d, l]) => (
              <button key={d} type="button" onClick={() => setDays(d)} className="relative rounded-full px-3.5 py-1.5">
                {days === d ? <motion.span layoutId="ops-days" className="absolute inset-0 rounded-full" style={{ background: "var(--t-accent)" }} /> : null}
                <span className="relative" style={{ color: days === d ? "#fff" : "var(--t-muted)" }}>{l}</span>
              </button>
            ))}
          </div>
          {(data?.my_points.length ?? 0) > 1 ? (
            <select value={point} onChange={(e) => setPoint(e.target.value)} className="rounded-full border px-3 py-2 text-xs font-bold outline-none" style={{ ...card, color: "var(--t-text)" }} aria-label="Punto">
              <option value="">📍 Todos los puntos</option>
              {data?.my_points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : null}
        </div>
      </Hero>

      {error ? <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">⚠️ {error} <button type="button" className="ml-2 underline" onClick={() => void load()}>Reintentar</button></p> : null}

      {!data ? <Skeleton /> : (
        <>
          {/* ===== Ventas de hoy + fichas ===== */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
            {can?.sales ? (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-3xl border p-5" style={card}>
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-30 blur-3xl" style={{ background: "var(--t-accent)" }} />
                <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-muted)" }}>Ventas de hoy{point ? ` · ${data.my_points.find((p) => p.id === point)?.name ?? ""}` : ""}</p>
                <p className="mt-1 text-4xl font-black tracking-tight sm:text-5xl"><AnimatedNumber value={salesToday} format={money} /></p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span style={{ color: "var(--t-muted)" }}>{k.sales_today?.count ?? 0} venta{k.sales_today?.count === 1 ? "" : "s"}</span>
                  {delta !== null ? (
                    <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: delta >= 0 ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)", color: delta >= 0 ? "#16a34a" : "#ef4444" }}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} % vs. ayer a esta hora
                    </span>
                  ) : <span style={{ color: "var(--t-muted)" }}>Ayer: {money(Number(k.sales_yesterday?.total ?? 0))}</span>}
                </div>
                <div className="mt-3"><AreaSpark values={hours.slice(0, curHour + 1)} height={70} /></div>
                <div className="mt-1 flex justify-between text-[10px]" style={{ color: "var(--t-muted)" }}><span>0 h</span><span>{curHour} h</span></div>
                {data.points.length > 1 ? (
                  <div className="mt-4 space-y-2">
                    {data.points.slice(0, 5).map((p, i) => (
                      <button key={p.id} type="button" onClick={() => setPoint(p.id)} className="block w-full text-left" title={`Ver solo ${p.name}`}>
                        <span className="flex justify-between text-xs"><span className="truncate font-semibold">{p.name}</span><span className="tabular-nums" style={{ color: "var(--t-muted)" }}>{money(Number(p.total))}</span></span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-accent) 15%, transparent)" }}>
                          <motion.span className="block h-full rounded-full" style={{ background: "var(--t-accent)" }} initial={{ width: 0 }} animate={{ width: `${(Number(p.total) / Math.max(1, Number(data.points[0].total))) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.08 }} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </motion.section>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {tiles.filter((t) => t.show).map((t, i) => (
                <motion.div key={t.label} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.04 * i }} whileHover={{ y: -3 }}>
                  <Link href={t.href} className="group relative flex h-full flex-col overflow-hidden rounded-2xl border p-3.5" style={{ ...card, borderColor: t.alert ? t.color : "var(--t-card-border)" }}>
                    <span className="absolute inset-x-0 top-0 h-1" style={{ background: t.color, opacity: t.value ? 1 : 0.3 }} />
                    <span className="flex items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${t.color} 16%, transparent)`, color: t.color }}><t.icon size={17} /></span>
                      {t.alert ? <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: t.color }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: t.color }} /></span> : null}
                    </span>
                    <span className="mt-2.5 text-2xl font-black leading-none"><AnimatedNumber value={t.value} format={t.money ? compact : undefined} /></span>
                    <span className="mt-1 text-xs font-bold">{t.label}</span>
                    <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{t.hint}</span>
                    <ChevronRight size={14} className="absolute bottom-3 right-3 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-60" />
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>

          {/* ===== Acciones rápidas ===== */}
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {actions.filter((a) => a.show).map((a, i) => (
              <motion.div key={a.label} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }} className="shrink-0">
                <Link href={a.href} className="inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-bold transition hover:-translate-y-0.5 active:scale-95" style={card}>
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: a.color }}><a.icon size={15} /></span>
                  {a.label}
                  {a.key ? <kbd className="hidden rounded border px-1.5 text-[10px] font-semibold lg:inline" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{a.key}</kbd> : null}
                </Link>
              </motion.div>
            ))}
          </div>

          {/* ===== Movimientos ===== */}
          <section className="rounded-3xl border" style={card}>
            <div className="space-y-3 border-b p-4" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-black">Movimientos <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{feed.length}{feed.length > 150 ? " (se ven 150)" : ""}</span></h2>
                <label className="relative w-full sm:w-72">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                  <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search.flush(); if (e.key === "Escape") setQ(""); }}
                    placeholder="Buscar número, cliente, punto…  ( / )" className="w-full rounded-xl border py-2 pl-8 pr-8 text-sm outline-none" style={{ ...card, color: "var(--t-text)" }} />
                  {q ? <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60" aria-label="Limpiar"><X size={14} /></button> : null}
                  {search.pending ? <span className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full"><motion.span key={q} className="block h-full" style={{ background: "var(--t-accent)" }} initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: search.delay / 1000, ease: "linear" }} /></span> : null}
                </label>
              </div>
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {GROUPS.map((g) => {
                  const n = groupCount(g.key);
                  const on = group === g.key;
                  return (
                    <button key={g.key} type="button" onClick={() => setGroup(g.key)} className="relative shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: on ? "transparent" : "var(--t-card-border)" }}>
                      {on ? <motion.span layoutId="ops-group" className="absolute inset-0 rounded-full" style={{ background: "var(--t-accent)" }} /> : null}
                      <span className="relative" style={{ color: on ? "#fff" : "var(--t-text)" }}>{g.label} <span className="opacity-70">{n}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>

            {byDay.length === 0 ? (
              <div className="grid place-items-center px-4 py-14 text-center">
                <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-4xl">🌤️</motion.span>
                <p className="mt-2 text-sm font-bold">{search.value || group !== "all" ? "Nada con ese filtro" : "Sin movimientos en este periodo"}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{search.value || group !== "all" ? "Prueba con otra palabra o quita el filtro." : "Cuando se venda, se pida o se traslade, aparece aquí al instante."}</p>
              </div>
            ) : (
              <div className="p-2 sm:p-3">
                {byDay.map((d) => (
                  <div key={d.day} className="mb-2">
                    <p className="sticky top-0 z-10 px-2 py-1.5 text-[11px] font-black uppercase tracking-wider backdrop-blur" style={{ color: "var(--t-muted)" }}>{d.day} · {d.items.length}</p>
                    <ul className="space-y-1">
                      <AnimatePresence initial={false}>
                        {d.items.map((it, i) => <Row key={`${it.kind}:${it.id}`} it={it} now={now} index={i} fresh={fresh.has(`${it.kind}:${it.id}:${it.status}`)} />)}
                      </AnimatePresence>
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
          <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>⌨️ / buscar · R actualizar · {actions.filter((a) => a.show && a.key).map((a) => `${a.key} ${a.label.toLowerCase()}`).join(" · ")}</p>
        </>
      )}
    </main>
  );
}

/* ============================================================ piezas */
function Hero({ lastAt, now, busy, onRefresh, children }: { lastAt: number | null; now: number; busy: boolean; onRefresh: () => void; children?: React.ReactNode }) {
  const secs = lastAt ? Math.max(0, Math.round((now - lastAt) / 1000)) : null;
  return (
    <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-6" style={card}>
      <motion.div aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full opacity-25 blur-3xl" style={{ background: "var(--t-accent)" }}
        animate={{ x: [0, 40, 0], y: [0, 20, 0] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            En vivo
          </p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">Centro de operaciones</h1>
          <p className="mt-0.5 text-xs sm:text-sm" style={{ color: "var(--t-muted)" }}>Todo lo que se mueve en tu negocio: ventas, pedidos, mercancía, caja y gastos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} title="Actualizar (R)">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            {secs === null ? "Actualizar" : secs < 10 ? "Al día" : `hace ${secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`}`}
          </button>
        </div>
      </div>
    </section>
  );
}

function Row({ it, now, index, fresh }: { it: FeedItem; now: number; index: number; fresh: boolean }) {
  const kd = KIND[it.kind];
  const st = statusOf(it);
  const external = it.href.startsWith("/pedido/") || it.href.startsWith("/traslado/");
  const body = (
    <>
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${kd.color} 15%, transparent)`, color: kd.color }}>
        <kd.icon size={17} />
        {st.pending ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2" style={{ background: st.color, borderColor: "var(--t-bg-base)" }} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
          <span className="font-bold" style={{ color: kd.color }}>{kd.label}</span>· <span className="truncate">{it.ref}</span>
          {fresh ? <span className="rounded-full px-1.5 text-[9px] font-black text-white" style={{ background: "var(--t-accent)" }}>NUEVO</span> : null}
        </span>
        <span className="block truncate text-sm font-bold">{it.title}</span>
        {it.sub ? <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{it.sub}</span> : null}
      </span>
      <span className="shrink-0 text-right">
        {it.amount !== null && it.amount !== undefined ? <span className="block text-sm font-black tabular-nums">{money(Number(it.amount))}</span> : null}
        <span className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `color-mix(in oklab, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
        <span className="block text-[10px]" style={{ color: "var(--t-muted)" }}>{timeAgo(it.at, now)}</span>
      </span>
    </>
  );
  const cls = "group flex items-center gap-3 rounded-2xl px-2.5 py-2 transition hover:bg-[color:var(--t-card-bg-soft)] active:scale-[0.995]";
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, backgroundColor: fresh ? "rgba(139,92,246,.12)" : "rgba(0,0,0,0)" }} exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02 }} className="rounded-2xl">
      {external ? <a href={it.href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a> : <Link href={it.href} className={cls}>{body}</Link>}
    </motion.li>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)]">
      <div className="h-64 animate-pulse rounded-3xl border" style={card} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border" style={card} />)}
      </div>
    </div>
  );
}
