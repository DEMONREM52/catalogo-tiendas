"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { ClipboardList, Download, ExternalLink, Loader2, Megaphone, Radar, RefreshCw, Search, Settings, Tag, X, Zap } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { useSearchValue } from "@/lib/search-timing";
import { downloadXlsx } from "@/lib/data/xlsx";
import { PublishButton } from "@/components/products/PublishButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProductsModeSwitch } from "../ModeSwitch";
import { loadProductCategoryIds, saveProductCategoryIds } from "../CategoryPicker";
import {
  EVERY_OPTIONS, ISSUES, ISSUE_ORDER, LEVEL_COLOR, agoDays, daysSince, ddmmyyyy, duplicateImages, duplicateNames, everyLabel, healthColor, healthLabel,
  healthScore, isPublishDue, nameKey, planToday, productIssues, publishStatusText, stockValue, transferHint,
  type IssueDef, type IssueKey, type PhotoCheck, type PublishState, type RadarProduct,
} from "@/lib/products/radar";
import { HealthRing, HealthTrend, RadarSweep, Tile } from "./RadarWidgets";
import { PlanToday } from "./PlanToday";
import { DEFAULT_SETTINGS, RadarSettings, type RadarSettingsValue } from "./RadarSettings";
import { AssignDialog, TasksPanel, useProductTasks, type ProductTask } from "./TasksPanel";
import { PublishCalendar } from "./PublishCalendar";
import { QuickEdit } from "./QuickEdit";
import { ProductPhotoButton, photoFilterText } from "@/app/dashboard/PhotoSearchControls";

/**
 * Radar de productos (súper administración): qué le falta a cada producto, cuáles ya toca publicar, cuáles están
 * quietos (y cuánta plata hay ahí), plan del día, metas, tareas para el equipo y calendario de publicaciones.
 * Cada falencia se arregla en el editor rápido o abre el producto en otra ventana; al volver se actualiza solo.
 */

type Named = { id: string; name: string };
type Data = { now: number; today: string; can_costs: boolean; products: RadarProduct[]; categories: Named[]; points: Named[] };
type View = "all" | "publicar" | "falencias" | "quietos" | "listos" | "tareas" | "calendario";
type Sort = "health" | "publish" | "quiet" | "value" | "name" | "sales";
type Row = RadarProduct & { issues: IssueDef[]; score: number };

const VIEWS: Array<{ key: View; label: string; emoji: string; color: string }> = [
  { key: "all", label: "Todo", emoji: "📡", color: "#8b5cf6" },
  { key: "publicar", label: "Por publicar", emoji: "📣", color: "#f59e0b" },
  { key: "falencias", label: "Con falencias", emoji: "🩺", color: "#e5484d" },
  { key: "quietos", label: "Quietos", emoji: "💤", color: "#0ea5e9" },
  { key: "listos", label: "Listos", emoji: "✅", color: "#10b981" },
  { key: "tareas", label: "Tareas", emoji: "📋", color: "#6366f1" },
  { key: "calendario", label: "Calendario", emoji: "📅", color: "#ec4899" },
];
const PAGE = 60;
const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const compactMoney = (n: number) => n >= 1e6 ? `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M` : money(n);
const missingFn = (m: string) => /Could not find the function|schema cache|does not exist/i.test(m);
// Falencias que se arreglan en el editor rápido (las demás abren el producto completo).
const QUICK: IssueKey[] = ["no_photo", "photo_bad", "photo_repeated", "no_category", "no_short_desc", "no_barcode", "hidden_with_stock", "long_name"];
const toast = (title: string, icon: "success" | "error" | "info" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

function readView(): View {
  if (typeof window === "undefined") return "all";
  const v = new URLSearchParams(window.location.search).get("ver");
  return VIEWS.some((x) => x.key === v) ? (v as View) : "all";
}

export default function ProductRadarPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [proMissing, setProMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState("");
  const [settings, setSettings] = useState<RadarSettingsValue>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<Array<{ day: string; avg: number }>>([]);
  // «Ver otros» del plan de hoy: sugerencias saltadas hoy, en este equipo. Lo que toca por recordatorio nunca se salta.
  const [skip, setSkip] = useState<{ day: string; ids: string[] }>({ day: "", ids: [] });
  const [photoChecks, setPhotoChecks] = useState<Map<string, PhotoCheck>>(new Map());
  const [view, setView] = useState<View>(readView);
  const [issue, setIssue] = useState<IssueKey | null>(null);
  const [category, setCategory] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sort, setSort] = useState<Sort>("health");
  const [q, setQ] = useState("");
  const search = useSearchValue(q);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [twins, setTwins] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<{ title: string; ids: Set<string> } | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [assign, setAssign] = useState(false);
  const { tasks, reload: reloadTasks } = useProductTasks(storeId);
  const savedSnap = useRef("");

  useEffect(() => {
    void getDashboardStore().then((a) => (a.store ? setStoreId(a.store.id) : setError("No tienes acceso a ninguna tienda."))).catch(() => setError("No se pudo cargar la tienda."));
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setBusy(true);
    const sb = supabaseBrowser();
    let res = await sb.rpc("product_radar", { p_store: storeId, p_point: point || null });
    if (res.error && missingFn(res.error.message)) {
      // Sin 20261306: la versión de 20261305 (sin punto).
      setProMissing(true);
      res = await sb.rpc("product_radar", { p_store: storeId });
    }
    setBusy(false);
    if (res.error) {
      if (missingFn(res.error.message)) setMissing(true); else setError(res.error.message);
      return;
    }
    const d = res.data as (Omit<Data, "now"> & { ok: boolean; message?: string; now: string }) | null;
    if (!d?.ok) { setError(d?.message ?? "No se pudo cargar el radar."); return; }
    setError("");
    setData({ now: Date.parse(d.now) || Date.now(), today: d.today, can_costs: d.can_costs, products: d.products ?? [], categories: d.categories ?? [], points: d.points ?? [] });
  }, [storeId, point]);

  useEffect(() => {
     
    void load();
    // Al volver de editar en la otra ventana, se actualiza solo.
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  useEffect(() => {
    if (!storeId) return;
    const sb = supabaseBrowser();
    void sb.rpc("product_radar_settings_get", { p_store: storeId }).then(({ data: s }) => {
      const d = s as { ok?: boolean; settings?: RadarSettingsValue } | null;
      if (d?.ok && d.settings) setSettings(d.settings);
    });
    const saved = window.setTimeout(() => {
      try {
        const v = JSON.parse(localStorage.getItem(`remhub:radar-skip:${storeId}`) ?? "null") as { day?: string; ids?: string[] } | null;
        if (v?.day && Array.isArray(v.ids)) setSkip({ day: v.day, ids: v.ids });
      } catch { /* sin almacenamiento */ }
    }, 0);
    void sb.rpc("product_radar_history", { p_store: storeId, p_days: 120 }).then(({ data: h }) => {
      const d = h as { ok?: boolean; days?: Array<{ day: string; avg: number }> } | null;
      if (d?.ok) setHistory(d.days ?? []);
    });
    return () => window.clearTimeout(saved);
  }, [storeId]);

  // Cambiar de vista o filtro vuelve a la primera página.
   
  useEffect(() => { setLimit(PAGE); }, [view, issue, category, onlyActive, sort, search.value, twins, taskFilter, point]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const ctx = { today: data.today, now: data.now, canCosts: data.can_costs, duplicates: duplicateNames(data.products), duplicateImages: duplicateImages(data.products), photoChecks };
    return data.products.map((p) => { const issues = productIssues(p, ctx); return { ...p, issues, score: healthScore(issues) }; });
  }, [data, photoChecks]);

  const base = useMemo(() => rows.filter((r) => (!onlyActive || r.active) && (!category || r.category_id === category)), [rows, onlyActive, category]);

  const stats = useMemo(() => {
    const counts = Object.fromEntries(ISSUE_ORDER.map((k) => [k, base.filter((r) => r.issues.some((i) => i.key === k)).length])) as Record<IssueKey, number>;
    const quiet = base.filter((r) => r.issues.some((i) => i.key === "no_sales"));
    return {
      counts,
      avg: base.length ? Math.round(base.reduce((s, r) => s + r.score, 0) / base.length) : 0,
      due: data ? base.filter((r) => r.active && isPublishDue(r.pub, data.today)).length : 0,
      critical: base.filter((r) => r.issues.some((i) => i.level === "critical")).length,
      quiet: quiet.length,
      quietValue: data ? quiet.reduce((s, r) => s + stockValue(r, data.can_costs).value, 0) : 0,
      out: counts.out_of_stock,
      ready: base.filter((r) => r.score >= 85 && !r.issues.some((i) => i.level === "critical")).length,
    };
  }, [base, data]);

  // Salud del día (de todos los activos, sin filtros) para la gráfica y la meta.
  const activeAvg = useMemo(() => {
    const act = rows.filter((r) => r.active);
    return act.length ? Math.round(act.reduce((s, r) => s + r.score, 0) / act.length) : 0;
  }, [rows]);
  useEffect(() => {
    if (!storeId || !data || point || proMissing || !rows.length) return;
    const key = `${data.today}:${activeAvg}`;
    if (savedSnap.current === key) return;
    savedSnap.current = key;
    const act = rows.filter((r) => r.active);
    const counts = Object.fromEntries(ISSUE_ORDER.map((k) => [k, act.filter((r) => r.issues.some((i) => i.key === k)).length]));
    void supabaseBrowser().rpc("product_radar_snapshot_save", { p_store: storeId, p_avg: activeAvg, p_products: act.length, p_counts: counts }).then(({ data: r }) => {
      if ((r as { ok?: boolean } | null)?.ok) setHistory((h) => [...h.filter((x) => x.day !== data.today), { day: data.today, avg: activeAvg }].sort((a, b) => a.day.localeCompare(b.day)));
    });
  }, [storeId, data, point, proMissing, rows, activeAvg]);

  const skipToday = useMemo(() => new Set(data && skip.day === data.today ? skip.ids : []), [data, skip]);
  const plan = useMemo(() => data ? planToday(rows, data.today, settings.daily_target, (r) => r.issues.map((i) => i.key), skipToday) : { done: [] as Row[], todo: [] as Row[], fresh: 0 }, [rows, data, settings.daily_target, skipToday]);

  function saveSkip(ids: string[]) {
    if (!data || !storeId) return;
    const next = { day: data.today, ids };
    setSkip(next);
    try { localStorage.setItem(`remhub:radar-skip:${storeId}`, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  }
  /** Cambia las sugeridas por las siguientes; al acabarse, vuelve a empezar. */
  function shufflePlan() {
    if (!data) return;
    const shown = plan.todo.filter((r) => !isPublishDue(r.pub, data.today)).map((r) => r.id);
    if (!shown.length) return;
    if (plan.fresh > shown.length) return saveSkip([...skipToday, ...shown]);
    saveSkip([]);
    toast(skipToday.size ? "Ya viste todas las sugerencias: vuelvo a las primeras" : "No hay más productos para sugerir hoy", "info");
  }
  /** La meta del día, desde el mismo plan (se guarda en los ajustes del Radar). */
  async function changeTarget(n: number) {
    if (!storeId || n === settings.daily_target) return;
    const prev = settings;
    const next = { ...settings, daily_target: n };
    setSettings(next);
    const { data: r, error: err } = await supabaseBrowser().rpc("product_radar_settings_save", { p_store: storeId, p_daily_target: n, p_push_hour: next.push_hour, p_health_goal: next.health_goal });
    const d = r as { ok?: boolean; message?: string } | null;
    if (err || !d?.ok) { setSettings(prev); toast(err?.message ?? d?.message ?? "No se guardó la meta", "error"); }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const words = nameKey(search.value).split(" ").filter(Boolean);
    const list = (twins ? rows.filter((r) => nameKey(r.name) === twins) : taskFilter ? rows.filter((r) => taskFilter.ids.has(r.id)) : base).filter((r) => {
      if (twins || taskFilter) return true;
      if (view === "publicar" && !(r.active && isPublishDue(r.pub, data.today))) return false;
      if (view === "falencias" && !r.issues.some((i) => i.level !== "tip")) return false;
      if (view === "quietos" && !r.issues.some((i) => i.key === "no_sales")) return false;
      if (view === "listos" && !(r.score >= 85 && !r.issues.some((i) => i.level === "critical"))) return false;
      if (issue && !r.issues.some((i) => i.key === issue)) return false;
      if (words.length) { const hay = `${nameKey(r.name)} ${(r.code ?? "").toLowerCase()} ${r.barcode ?? ""}`; if (!words.every((w) => hay.includes(w))) return false; }
      return true;
    });
    const due = (r: Row) => r.pub.next_due ?? "9999-12-31";
    const lastSale = (r: Row) => (r.last_sale_at ? Date.parse(r.last_sale_at) : 0);
    const val = (r: Row) => stockValue(r, data.can_costs).value;
    const order: Record<Sort, (a: Row, b: Row) => number> = {
      health: (a, b) => a.score - b.score || a.name.localeCompare(b.name),
      publish: (a, b) => due(a).localeCompare(due(b)) || a.name.localeCompare(b.name),
      quiet: (a, b) => lastSale(a) - lastSale(b) || (Number(b.stock ?? 0) - Number(a.stock ?? 0)),
      value: (a, b) => val(b) - val(a),
      name: (a, b) => a.name.localeCompare(b.name),
      sales: (a, b) => Number(b.sold_30) - Number(a.sold_30) || Number(b.sold_90) - Number(a.sold_90),
    };
    const s: Sort = sort === "health" && view === "publicar" ? "publish" : sort === "health" && view === "quietos" ? "value" : sort;
    return list.sort(order[s]);
  }, [base, rows, data, view, issue, search.value, sort, twins, taskFilter]);

  const catName = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c.name])), [data]);
  const pointName = useMemo(() => new Map((data?.points ?? []).map((c) => [c.id, c.name])), [data]);
  const myOpenTasks = (tasks ?? []).filter((t) => t.mine && t.status === "open").length;

  function openEditor(id: string, section?: string) {
    window.open(`/dashboard/products/${id}${section && section !== "publish" ? `?section=${section}` : ""}`, `remhub-producto-${id}`);
  }
  function onIssue(r: Row, iss: IssueDef) {
    if (iss.key === "duplicate_name") { setTwins(nameKey(r.name)); setTaskFilter(null); return; }
    if (QUICK.includes(iss.key)) { setQuick(r.id); return; }
    openEditor(r.id, iss.section);
  }
  function updatePub(id: string, pub: PublishState) {
    setData((d) => d ? { ...d, products: d.products.map((p) => p.id === id ? { ...p, pub } : p) } : d);
  }
  const reportPhoto = useCallback((url: string, check: PhotoCheck | null) => {
    setPhotoChecks((m) => {
      if (check ? m.get(url) === check : !m.has(url)) return m;
      const n = new Map(m);
      if (check) n.set(url, check); else n.delete(url);
      return n;
    });
  }, []);
  function clearFilters() { setTwins(null); setTaskFilter(null); }

  async function bulkPublish(kind: "mark" | number) {
    if (!storeId || !selected.size) return;
    const ids = [...selected];
    if (kind === "mark") {
      const ok = await Swal.fire({ icon: "question", title: `¿Marcar ${ids.length} como publicados hoy?`, text: "El recordatorio de cada uno empieza a contar desde hoy.",
        showCancelButton: true, confirmButtonText: "📣 Sí, publicados", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)" });
      if (!ok.isConfirmed) return;
    }
    setBulkBusy("pub");
    const sb = supabaseBrowser();
    let done = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: r, error: e } = kind === "mark"
        ? await sb.rpc("product_publish_mark", { p_store: storeId, p_products: chunk, p_channels: [] })
        : await sb.rpc("product_publish_set_every", { p_store: storeId, p_products: chunk, p_every: kind });
      const d = r as { ok?: boolean; count?: number; message?: string } | null;
      if (e || !d?.ok) { setBulkBusy(null); toast(e?.message ?? d?.message ?? "No se pudo", "error"); return; }
      done += d.count ?? 0;
    }
    setBulkBusy(null);
    setSelected(new Set());
    toast(kind === "mark" ? `📣 ${done} marcados como publicados hoy` : `⏰ ${done} con recordatorio: ${everyLabel(kind).toLowerCase()}`);
    void load();
  }

  async function bulkFeatured(on: boolean) {
    if (!storeId || !selected.size) return;
    const ids = [...selected];
    setBulkBusy("feat");
    const { data: r, error: e } = await supabaseBrowser().rpc("product_featured_set", { p_store: storeId, p_products: ids, p_featured: on });
    setBulkBusy(null);
    const d = r as { ok?: boolean; count?: number; message?: string } | null;
    if (e || !d?.ok) {
      toast(e && missingFn(e.message) ? "Falta correr la migración 20261310 en Supabase." : e?.message ?? d?.message ?? "No se pudo", "error");
      return;
    }
    setSelected(new Set());
    toast(on ? `⭐ ${d.count} destacados: salen primero y resaltados en tus catálogos` : `Se quitó el destacado a ${d.count}`);
  }

  async function bulkActive(active: boolean) {
    if (!storeId || !selected.size) return;
    const ids = [...selected];
    const ok = await Swal.fire({ icon: "question", title: `¿${active ? "Activar" : "Ocultar"} ${ids.length} producto${ids.length === 1 ? "" : "s"}?`,
      text: active ? "Se venden y aparecen en los catálogos." : "No se venden ni aparecen en los catálogos.", showCancelButton: true,
      confirmButtonText: active ? "Activar" : "Ocultar", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!ok.isConfirmed) return;
    setBulkBusy("active");
    const sb = supabaseBrowser();
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e } = await sb.from("products").update({ active }).eq("store_id", storeId).in("id", ids.slice(i, i + 200));
      if (e) { setBulkBusy(null); toast(e.message, "error"); return; }
    }
    setBulkBusy(null);
    setSelected(new Set());
    toast(`${active ? "✅ Activados" : "🙈 Ocultos"}: ${ids.length}`);
    void load();
  }

  async function bulkCategory(categoryId: string) {
    if (!storeId || !selected.size || !data) return;
    const ids = [...selected];
    setBulkBusy("cat");
    let done = 0;
    let warn: string | null = null;
    const queue = [...ids];
    const work = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        const p = data.products.find((x) => x.id === id);
        const cur = await loadProductCategoryIds(id, p?.category_id ?? null, data.categories);
        if (cur.includes(categoryId)) { done++; continue; }
        const w = await saveProductCategoryIds(id, [...cur, categoryId]);
        if (w) warn = w; else done++;
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    setBulkBusy(null);
    setSelected(new Set());
    toast(warn ?? `🗂️ ${done} en «${catName.get(categoryId) ?? "la categoría"}»`, warn ? "error" : "success");
    void load();
  }

  function exportExcel() {
    if (!data) return;
    const head = ["Producto", "Código", "Activo", "Salud", "Estado", "Falencias", "Categoría", "Precio", ...(data.can_costs ? ["Costo"] : []), "Unidades", "Valor", "Vendidos 30 días", "Vendidos 90 días", "Última venta", "Última publicación", "Próxima publicación", "Recordatorio"];
    const rowsX = visible.map((r) => [
      r.name, r.code ?? "", r.active ? "Sí" : "No", r.score, healthLabel(r.score), r.issues.map((i) => i.label).join(", "),
      r.category_id ? catName.get(r.category_id) ?? "" : "", Number(r.prices.map(Number).find((x) => x > 0) ?? 0), ...(data.can_costs ? [Number(r.cost ?? 0)] : []),
      r.stock === null ? "" : Number(r.stock), stockValue(r, data.can_costs).value, Number(r.sold_30), Number(r.sold_90),
      ddmmyyyy(r.last_sale_at), ddmmyyyy(r.pub.last), ddmmyyyy(r.pub.next_due), everyLabel(r.pub.every),
    ]);
    downloadXlsx(`radar-productos-${data.today}.xlsx`, [{ name: "Radar", head, rows: rowsX, widths: [42, 12, 8, 8, 11, 60, 18, 12, ...(data.can_costs ? [12] : []), 10, 14, 10, 10, 13, 13, 13, 16] }]);
  }

  const shown = visible.slice(0, limit);
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const quickRow = quick ? rows.find((r) => r.id === quick) ?? null : null;
  const listView = (view !== "tareas" && view !== "calendario") || Boolean(twins || taskFilter);
  const selectStyle = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;

  return (
    <main className="min-w-0 space-y-4 px-3 py-3 pb-32 sm:px-6 sm:py-4" style={{ color: "var(--t-text)" }}>
      {/* ---------------- encabezado */}
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[24px] border p-4 sm:p-5"
        style={{ borderColor: "var(--t-card-border)", background: "linear-gradient(135deg, color-mix(in oklab, #10b981 14%, var(--t-card-bg)), var(--t-card-bg) 55%, color-mix(in oklab, #8b5cf6 12%, var(--t-card-bg)))" }}>
        <RadarSweep />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}><Radar size={24} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-black sm:text-2xl">Radar de productos</h1>
              <p className="text-xs sm:text-sm" style={{ color: "var(--t-muted)" }}>Qué le falta a cada producto, qué toca publicar hoy y qué no se mueve.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProductsModeSwitch mode="radar" />
            <button type="button" onClick={exportExcel} disabled={!data} className="grid h-10 w-10 place-items-center rounded-xl border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Exportar a Excel" title="Exportar lo que se ve a Excel"><Download size={16} /></button>
            <button type="button" onClick={() => setShowSettings(true)} disabled={!storeId || proMissing} className="grid h-10 w-10 place-items-center rounded-xl border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Ajustes" title="Plan del día, aviso al celular y meta"><Settings size={16} /></button>
            <button type="button" onClick={() => void load()} disabled={busy} className="grid h-10 w-10 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar" title="Actualizar">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </motion.header>

      {proMissing && !missing ? (
        <div className="rounded-2xl border p-3 text-xs" style={{ borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 10%, transparent)" }}>
          ⚠️ Para el plan del día, el aviso al celular, el filtro por punto, las tareas, el calendario y la gráfica de salud corre en Supabase <b>supabase/migrations/20261306_radar_productos_pro.sql</b>.
        </div>
      ) : null}

      {missing ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 10%, transparent)" }}>
          ⚠️ Para usar el Radar corre en Supabase las migraciones <b>20261305_radar_productos.sql</b> y <b>20261306_radar_productos_pro.sql</b> y vuelve a cargar.
        </div>
      ) : error ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#e5484d" }}>❌ {error}</div>
      ) : !data ? (
        <div className="space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
      ) : (
        <>
          {/* ---------------- tablero */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="col-span-2 flex items-center gap-3 rounded-2xl border p-3 sm:col-span-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <HealthRing score={stats.avg} size={58} />
              <div className="min-w-0"><p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Salud</p><p className="text-sm font-black" style={{ color: healthColor(stats.avg) }}>{healthLabel(stats.avg)}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{base.length} productos</p></div>
            </motion.div>
            <Tile emoji="📣" label="Toca publicar" value={stats.due} color="#f59e0b" pulse={stats.due > 0} active={view === "publicar"} onClick={() => { setView("publicar"); setIssue(null); clearFilters(); }} />
            <Tile emoji="🚨" label="Falencias graves" value={stats.critical} color="#e5484d" pulse={stats.critical > 0} active={view === "falencias"} onClick={() => { setView("falencias"); setIssue(null); clearFilters(); }} />
            <Tile emoji="💤" label="Plata quieta (60 días)" value={compactMoney(stats.quietValue)} sub={`${stats.quiet} producto${stats.quiet === 1 ? "" : "s"} ${data.can_costs ? "al costo" : "al precio"}`} color="#0ea5e9" active={view === "quietos"} onClick={() => { setView("quietos"); setIssue(null); clearFilters(); }} />
            <Tile emoji="📦" label="Agotados" value={stats.out} color="#d97706" active={issue === "out_of_stock"} onClick={() => { setView("all"); clearFilters(); setIssue(issue === "out_of_stock" ? null : "out_of_stock"); }} />
            <Tile emoji="✅" label="Listos" value={stats.ready} color="#10b981" active={view === "listos"} onClick={() => { setView("listos"); setIssue(null); clearFilters(); }} />
          </div>

          {/* ---------------- plan del día y salud */}
          {!proMissing ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
              <PlanToday done={plan.done} todo={plan.todo} target={settings.daily_target} today={data.today} storeId={storeId}
                fresh={plan.fresh} skipped={skipToday.size} onShuffle={shufflePlan} onRestart={() => saveSkip([])} onTarget={(n) => void changeTarget(n)}
                onPub={updatePub} onOpen={(id) => setQuick(id)} onSettings={() => setShowSettings(true)} />
              <HealthTrend days={history} goal={settings.health_goal} current={activeAvg} />
            </div>
          ) : null}

          {/* ---------------- vistas y filtros */}
          <section className="space-y-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {VIEWS.filter((v) => !proMissing || (v.key !== "tareas" && v.key !== "calendario")).map((v) => {
                const on = v.key === view && !twins && !taskFilter;
                return (
                  <button key={v.key} type="button" onClick={() => { setView(v.key); clearFilters(); }} className="relative shrink-0 rounded-xl px-3 py-2 text-xs font-black" style={{ color: on ? "#fff" : "var(--t-text)" }}>
                    {on ? <motion.span layoutId="radar-view" className="absolute inset-0 rounded-xl" style={{ background: v.color }} transition={{ type: "spring", stiffness: 420, damping: 32 }} /> : null}
                    <span className="relative">{v.emoji} {v.label}{v.key === "tareas" && myOpenTasks ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{myOpenTasks}</span> : null}</span>
                  </button>
                );
              })}
            </div>
            {listView && !twins && !taskFilter ? (
              <>
                {/* Buscador completo: nombre, código, código de barras o foto */}
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
                    <input
                      type="search"
                      enterKeyHint="search"
                      autoComplete="off"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
                      placeholder='Busca por nombre, código, código de barras o con una foto 📷 (ej: "olla", "125", "V322")'
                      aria-label="Buscar en el radar"
                      className="w-full rounded-2xl border py-3 pl-11 pr-10 text-[15px] outline-none"
                      style={{ borderColor: q ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
                    />
                    {q ? (
                      <button type="button" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full" style={{ color: "var(--t-muted)" }} aria-label="Borrar búsqueda">
                        <X size={15} />
                      </button>
                    ) : null}
                  </div>
                  <ProductPhotoButton
                    storeId={storeId}
                    label="Foto"
                    title="Buscar en el radar con una foto"
                    subtitle="Toma una foto del producto, su caja o su etiqueta, o escribe su nombre o código. Te lo mostramos en el radar con todo lo que le falta."
                    pickLabel="Ver en el radar"
                    className="rounded-2xl px-4"
                    onPick={(h) => {
                      // Se ve aunque esté en otra pestaña, con otra falencia marcada o inactivo.
                      setView("all");
                      setIssue(null);
                      clearFilters();
                      if (h.meta?.includes("Inactivo")) setOnlyActive(false);
                      setQ(photoFilterText(h));
                    }}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,auto)] lg:justify-start">
                  {data.points.length > 1 && !proMissing ? (
                    <select value={point} onChange={(e) => setPoint(e.target.value)} className="rounded-xl border px-3 py-2.5 text-sm" style={{ ...selectStyle, borderColor: point ? "#0ea5e9" : "var(--t-card-border)" }} title="Unidades y ventas de un solo punto">
                      <option value="">📍 Todos los puntos</option>
                      {data.points.map((p) => <option key={p.id} value={p.id}>📍 {p.name}</option>)}
                    </select>
                  ) : null}
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border px-3 py-2.5 text-sm" style={selectStyle}>
                    <option value="">Todas las categorías</option>
                    {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-xl border px-3 py-2.5 text-sm" style={selectStyle}>
                    <option value="health">Ordenar: lo más urgente</option>
                    <option value="publish">Publicación más atrasada</option>
                    <option value="value">Más plata en unidades</option>
                    <option value="quiet">Más tiempo sin vender</option>
                    <option value="sales">Más vendidos (30 días)</option>
                    <option value="name">Nombre A-Z</option>
                  </select>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Solo activos
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ISSUE_ORDER.filter((k) => stats.counts[k] > 0).map((k) => {
                    const d = ISSUES[k]; const on = issue === k;
                    return (
                      <motion.button key={k} type="button" layout whileTap={{ scale: 0.94 }} onClick={() => { setIssue(on ? null : k); clearFilters(); }} title={d.help}
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                        style={on ? { borderColor: LEVEL_COLOR[d.level], background: LEVEL_COLOR[d.level], color: "#fff" } : { borderColor: `color-mix(in oklab, ${LEVEL_COLOR[d.level]} 40%, transparent)` }}>
                        {d.emoji} {d.label} <span className="rounded-full px-1.5 tabular-nums" style={{ background: on ? "rgba(255,255,255,.25)" : `color-mix(in oklab, ${LEVEL_COLOR[d.level]} 15%, transparent)` }}>{stats.counts[k]}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>

          {!listView && view === "tareas" && storeId ? (
            <TasksPanel storeId={storeId} tasks={tasks} reload={() => void reloadTasks()} onShow={(t: ProductTask) => setTaskFilter({ title: t.title, ids: new Set(t.product_ids) })} />
          ) : !listView && view === "calendario" && storeId ? (
            <PublishCalendar storeId={storeId} onOpen={(id) => setQuick(id)} />
          ) : (
            <>
              {twins || taskFilter ? (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: "#d97706", background: "color-mix(in oklab, #d97706 10%, transparent)" }}>
                  {twins
                    ? <span>👯 <b>{visible.length} productos</b> se llaman igual. Revisa si alguno sobra (ocúltalo o elimínalo desde la vista sencilla) o cámbiale el nombre para distinguirlos.</span>
                    : <span>📋 Productos de la tarea <b>«{taskFilter?.title}»</b> ({visible.length})</span>}
                  <button type="button" onClick={clearFilters} className="ml-auto inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><X size={12} /> Quitar</button>
                </motion.div>
              ) : null}
              <div className="flex items-center justify-between gap-2 px-1 text-xs" style={{ color: "var(--t-muted)" }}>
                <label className="inline-flex cursor-pointer items-center gap-2 font-bold">
                  <input type="checkbox" checked={allShownSelected} onChange={() => setSelected((s) => { const n = new Set(s); if (allShownSelected) shown.forEach((r) => n.delete(r.id)); else shown.forEach((r) => n.add(r.id)); return n; })} />
                  Seleccionar los que se ven
                </label>
                <span><b style={{ color: "var(--t-text)" }}>{visible.length}</b> producto{visible.length === 1 ? "" : "s"}{search.pending ? " · buscando…" : ""}{point ? ` · 📍 ${pointName.get(point) ?? ""}` : ""}</span>
              </div>

              {visible.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  <p className="text-4xl">🎉</p>
                  <p className="mt-2 font-black">{view === "publicar" ? "Nada por publicar hoy" : "Nada por aquí"}</p>
                  <p className="text-sm" style={{ color: "var(--t-muted)" }}>{view === "publicar" ? "Todos tus productos están al día con sus recordatorios." : "Prueba con otro filtro."}</p>
                </motion.div>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {shown.map((r, i) => (
                      <RadarRow key={r.id} row={r} index={i} storeId={storeId} today={data.today} canCosts={data.can_costs} point={point || null} pointName={pointName}
                        categoryName={r.category_id ? catName.get(r.category_id) ?? null : null}
                        selected={selected.has(r.id)} onSelect={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                        onOpen={(section) => openEditor(r.id, section)} onQuick={() => setQuick(r.id)} onIssue={(iss) => onIssue(r, iss)} onPub={(pub) => updatePub(r.id, pub)} onPhoto={reportPhoto}
                        isQuiet={r.issues.some((x) => x.key === "no_sales")} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
              {visible.length > limit ? (
                <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-2xl border py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                  Ver {Math.min(PAGE, visible.length - limit)} más ({visible.length - limit} restantes)
                </button>
              ) : null}
            </>
          )}
        </>
      )}

      {/* ---------------- barra de acciones con selección */}
      <AnimatePresence>
        {selected.size && data ? (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-2xl sm:inset-x-6"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
            <span className="px-1 text-sm font-black">{selected.size} seleccionado{selected.size === 1 ? "" : "s"}</span>
            <button type="button" onClick={() => void bulkPublish("mark")} disabled={!!bulkBusy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#f59e0b,#ec4899)" }}>
              {bulkBusy === "pub" ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} Publicados hoy
            </button>
            <select value="" disabled={!!bulkBusy} onChange={(e) => { const v = e.target.value; if (v !== "") void bulkPublish(Number(v)); }} className="rounded-xl border px-2 py-2 text-xs font-bold" style={selectStyle}>
              <option value="">⏰ Recordarme…</option>
              {EVERY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
            </select>
            <select value="" disabled={!!bulkBusy} onChange={(e) => { if (e.target.value) void bulkCategory(e.target.value); }} className="rounded-xl border px-2 py-2 text-xs font-bold" style={selectStyle}>
              <option value="">{bulkBusy === "cat" ? "Guardando…" : "🗂️ Agregar a categoría…"}</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={() => void bulkFeatured(true)} disabled={!!bulkBusy} className="rounded-xl px-2.5 py-2 text-xs font-black disabled:opacity-60" style={{ background: "linear-gradient(135deg,#facc15,#f59e0b)", color: "#1c1917" }}>⭐ Destacar</button>
            <button type="button" onClick={() => void bulkFeatured(false)} disabled={!!bulkBusy} className="rounded-xl border px-2.5 py-2 text-xs font-bold disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>Quitar ⭐</button>
            <button type="button" onClick={() => void bulkActive(true)} disabled={!!bulkBusy} className="rounded-xl border px-2.5 py-2 text-xs font-bold disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>✅ Activar</button>
            <button type="button" onClick={() => void bulkActive(false)} disabled={!!bulkBusy} className="rounded-xl border px-2.5 py-2 text-xs font-bold disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>🙈 Ocultar</button>
            {!proMissing ? <button type="button" onClick={() => setAssign(true)} disabled={!!bulkBusy} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><ClipboardList size={13} /> Asignar</button> : null}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar selección</button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {quickRow && storeId && data ? (
        <QuickEdit storeId={storeId} productId={quickRow.id} categories={data.categories} issues={quickRow.issues}
          onClose={() => setQuick(null)} onSaved={() => void load()} onOpenFull={() => openEditor(quickRow.id)} />
      ) : null}
      {showSettings && storeId ? <RadarSettings storeId={storeId} value={settings} onClose={() => setShowSettings(false)} onSaved={setSettings} /> : null}
      {assign && storeId ? (
        <AssignDialog storeId={storeId} productIds={[...selected]} issue={issue} onClose={() => setAssign(false)} onDone={() => { setSelected(new Set()); void reloadTasks(); }} />
      ) : null}
    </main>
  );
}

function RadarRow({
  row: r, index, storeId, today, canCosts, point, pointName, categoryName, selected, isQuiet, onSelect, onOpen, onQuick, onIssue, onPub, onPhoto,
}: {
  row: Row; index: number; storeId: string | null; today: string; canCosts: boolean; point: string | null; pointName: Map<string, string>;
  categoryName: string | null; selected: boolean; isQuiet: boolean;
  onSelect: () => void; onOpen: (section?: string) => void; onQuick: () => void; onIssue: (i: IssueDef) => void; onPub: (p: PublishState) => void;
  onPhoto: (url: string, check: PhotoCheck | null) => void;
}) {
  const [all, setAll] = useState(false);
  const chips = all ? r.issues : r.issues.slice(0, 4);
  const sinceSale = daysSince(r.last_sale_at, today);
  const pub = publishStatusText(r.pub, today);
  const mainPrice = Number(r.prices.map(Number).find((p) => p > 0) ?? 0);
  const value = stockValue(r, canCosts);
  const hint = isQuiet ? transferHint(r, point) : null;
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 12) * 0.025 } }} exit={{ opacity: 0, scale: 0.98 }}
      className="group rounded-2xl border p-3 transition hover:shadow-lg"
      style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)", background: selected ? "color-mix(in oklab, var(--t-accent) 7%, var(--t-card-bg))" : "var(--t-card-bg)" }}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Seleccionar ${r.name}`} className="h-4 w-4" />
          <button type="button" onClick={onQuick} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border sm:h-20 sm:w-20" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }} title="Editor rápido">
            {r.image ? (
              <img src={r.image} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105"
                onLoad={(e) => { const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight; onPhoto(r.image!, w && h && Math.max(w, h) < 300 ? "small" : null); }}
                onError={() => onPhoto(r.image!, "broken")} />
            ) : <span className="grid h-full place-items-center text-2xl opacity-50">📷</span>}
            {!r.active ? <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-[9px] font-bold text-white">OCULTO</span> : null}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <button type="button" onClick={onQuick} className="block max-w-full truncate text-left text-sm font-black hover:underline sm:text-base">{r.name}</button>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                {r.code ? <span className="font-bold">#{r.code}</span> : null}
                {categoryName ? <span>🗂️ {categoryName}</span> : null}
                <span className="font-bold" style={{ color: "var(--t-text)" }}>{mainPrice ? money(mainPrice) : "Sin precio"}</span>
                {canCosts && r.cost ? <span>costo {money(Number(r.cost))}</span> : null}
              </p>
            </div>
            <HealthRing score={r.score} size={44} />
          </div>

          {/* Falencias: cada una lleva a donde se arregla */}
          <div className="mt-2 flex flex-wrap gap-1">
            {r.issues.length === 0 ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500">✓ Ficha completa</span> : null}
            {chips.map((iss) => (
              <button key={iss.key} type="button" onClick={() => onIssue(iss)} title={`${iss.help} — ${iss.key === "duplicate_name" ? "Toca para ver los que se llaman igual" : "Toca para arreglarlo"}`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold transition hover:-translate-y-0.5"
                style={{ borderColor: `color-mix(in oklab, ${LEVEL_COLOR[iss.level]} 45%, transparent)`, background: `color-mix(in oklab, ${LEVEL_COLOR[iss.level]} 10%, transparent)` }}>
                {iss.emoji} {iss.label}{iss.key === "duplicate_name" ? " · ver cuáles" : ""}
              </button>
            ))}
            {r.issues.length > 4 ? <button type="button" onClick={() => setAll((x) => !x)} className="rounded-full px-2 py-0.5 text-[11px] font-bold underline" style={{ color: "var(--t-muted)" }}>{all ? "menos" : `+${r.issues.length - 4} más`}</button> : null}
          </div>

          {/* Quieto: plata parada y qué hacer */}
          {isQuiet ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px]" style={{ background: "color-mix(in oklab, #0ea5e9 10%, transparent)" }}>
              <span>💤 <b>{money(value.value)}</b> quietos {value.basis === "cost" ? "al costo" : "al precio"}</span>
              {hint ? <span>· 🚚 <b>{pointName.get(hint.pointId) ?? "Otro punto"}</b> vendió {hint.sold} en 30 días{hint.from ? ` (hay ${hint.fromQty} en ${pointName.get(hint.from) ?? "otro punto"})` : ""}</span> : null}
              <span className="ml-auto flex gap-1">
                {hint ? <a href="/dashboard/inventario?tab=transfers" target="_blank" rel="noopener" className="rounded-lg border px-2 py-1 font-bold" style={{ borderColor: "var(--t-card-border)" }}>🚚 Trasladar</a> : null}
                <a href="/dashboard/promociones" target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-bold" style={{ borderColor: "var(--t-card-border)" }}><Tag size={11} /> Promoción</a>
              </span>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            <span title="Unidades">📦 <b style={{ color: "var(--t-text)" }}>{r.stock === null ? "—" : Number(r.stock).toLocaleString("es-CO")}</b> und{!point && r.stock_points ? ` · ${r.stock_points} punto${r.stock_points === 1 ? "" : "s"}` : ""}</span>
            <span title="Unidades vendidas en 30 días">🛒 <b style={{ color: "var(--t-text)" }}>{Number(r.sold_30)}</b> en 30 días</span>
            <span>⏱️ Última venta: <b style={{ color: sinceSale === null || sinceSale > 60 ? "#e5484d" : "var(--t-text)" }}>{agoDays(sinceSale)}</b></span>
            <span>📣 <b style={{ color: pub.tone === "late" ? "#e5484d" : pub.tone === "due" ? "#d97706" : "var(--t-text)" }}>{pub.text}</b></span>
            <span className="ml-auto flex items-center gap-1.5">
              <PublishButton compact storeId={storeId} productId={r.id} productName={r.name} state={r.pub} onChanged={onPub} />
              <button type="button" onClick={onQuick} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }} title="Editor rápido aquí mismo"><Zap size={12} /> Rápido</button>
              <button type="button" onClick={() => onOpen()} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }} title="Editar completo en otra ventana"><ExternalLink size={12} /> Editar</button>
            </span>
          </div>
        </div>
      </div>
    </motion.li>
  );
}
