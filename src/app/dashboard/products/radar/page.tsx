"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Loader2, Megaphone, Radar, RefreshCw, Search, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { useSearchValue } from "@/lib/search-timing";
import { PublishButton } from "@/components/products/PublishButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProductsModeSwitch } from "../ModeSwitch";
import {
  EVERY_OPTIONS, ISSUES, ISSUE_ORDER, LEVEL_COLOR, agoDays, daysSince, duplicateNames, healthColor, healthLabel, healthScore,
  isPublishDue, nameKey, productIssues, publishStatusText,
  type IssueDef, type IssueKey, type PublishState, type RadarProduct,
} from "@/lib/products/radar";

/**
 * Radar de productos (súper administración): qué le falta a cada producto, cuáles ya toca publicar,
 * cuáles están quietos, con su salud de 0 a 100. Cada falencia abre el producto en otra ventana justo
 * en la sección donde se arregla; al volver a esta pestaña se actualiza solo.
 */

type Category = { id: string; name: string };
type Data = { now: number; today: string; can_costs: boolean; products: RadarProduct[]; categories: Category[] };
type View = "all" | "publicar" | "falencias" | "quietos" | "listos";
type Sort = "health" | "publish" | "quiet" | "name" | "sales";
type Row = RadarProduct & { issues: IssueDef[]; score: number };

const VIEWS: Array<{ key: View; label: string; emoji: string; color: string }> = [
  { key: "all", label: "Todo", emoji: "📡", color: "#8b5cf6" },
  { key: "publicar", label: "Por publicar", emoji: "📣", color: "#f59e0b" },
  { key: "falencias", label: "Con falencias", emoji: "🩺", color: "#e5484d" },
  { key: "quietos", label: "Quietos", emoji: "💤", color: "#0ea5e9" },
  { key: "listos", label: "Listos", emoji: "✅", color: "#10b981" },
];
const PAGE = 60;
const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

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
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [issue, setIssue] = useState<IssueKey | null>(null);
  const [category, setCategory] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sort, setSort] = useState<Sort>("health");
  const [q, setQ] = useState("");
  const search = useSearchValue(q);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    void getDashboardStore().then((a) => (a.store ? setStoreId(a.store.id) : setError("No tienes acceso a ninguna tienda."))).catch(() => setError("No se pudo cargar la tienda."));
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setBusy(true);
    const { data: r, error: e } = await supabaseBrowser().rpc("product_radar", { p_store: storeId });
    setBusy(false);
    if (e) {
      if (/Could not find the function|schema cache|does not exist/i.test(e.message)) setMissing(true);
      else setError(e.message);
      return;
    }
    const d = r as (Data & { ok: boolean; message?: string }) | null;
    if (!d?.ok) { setError(d?.message ?? "No se pudo cargar el radar."); return; }
    setError("");
    setData({ now: Date.parse(String((d as unknown as { now?: string }).now ?? "")) || Date.now(), today: d.today, can_costs: d.can_costs, products: d.products ?? [], categories: d.categories ?? [] });
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Al volver de editar en la otra ventana, se actualiza solo.
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Cambiar de vista o filtro vuelve a la primera página.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLimit(PAGE); }, [view, issue, category, onlyActive, sort, search.value]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const ctx = { today: data.today, now: data.now, canCosts: data.can_costs, duplicates: duplicateNames(data.products) };
    return data.products.map((p) => { const issues = productIssues(p, ctx); return { ...p, issues, score: healthScore(issues) }; });
  }, [data]);

  const base = useMemo(() => rows.filter((r) => (!onlyActive || r.active) && (!category || r.category_id === category)), [rows, onlyActive, category]);

  const stats = useMemo(() => {
    const has = (r: Row, k: IssueKey) => r.issues.some((i) => i.key === k);
    const counts = Object.fromEntries(ISSUE_ORDER.map((k) => [k, base.filter((r) => has(r, k)).length])) as Record<IssueKey, number>;
    return {
      counts,
      avg: base.length ? Math.round(base.reduce((s, r) => s + r.score, 0) / base.length) : 0,
      due: data ? base.filter((r) => r.active && isPublishDue(r.pub, data.today)).length : 0,
      critical: base.filter((r) => r.issues.some((i) => i.level === "critical")).length,
      quiet: counts.no_sales,
      out: counts.out_of_stock,
      ready: base.filter((r) => r.score >= 85 && !r.issues.some((i) => i.level === "critical")).length,
    };
  }, [base, data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const words = nameKey(search.value).split(" ").filter(Boolean);
    const list = base.filter((r) => {
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
    const order: Record<Sort, (a: Row, b: Row) => number> = {
      health: (a, b) => a.score - b.score || a.name.localeCompare(b.name),
      publish: (a, b) => due(a).localeCompare(due(b)) || a.name.localeCompare(b.name),
      quiet: (a, b) => lastSale(a) - lastSale(b) || (Number(b.stock ?? 0) - Number(a.stock ?? 0)),
      name: (a, b) => a.name.localeCompare(b.name),
      sales: (a, b) => Number(b.sold_30) - Number(a.sold_30) || Number(b.sold_90) - Number(a.sold_90),
    };
    return list.sort(order[view === "publicar" && sort === "health" ? "publish" : view === "quietos" && sort === "health" ? "quiet" : sort]);
  }, [base, data, view, issue, search.value, sort]);

  const catName = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c.name])), [data]);

  function openEditor(id: string, section?: string) {
    window.open(`/dashboard/products/${id}${section && section !== "publish" ? `?section=${section}` : ""}`, `remhub-producto-${id}`);
  }

  function updatePub(id: string, pub: PublishState) {
    setData((d) => d ? { ...d, products: d.products.map((p) => p.id === id ? { ...p, pub } : p) } : d);
  }

  async function bulk(kind: "mark" | number) {
    if (!storeId || !selected.size) return;
    const ids = [...selected];
    if (kind === "mark") {
      const ok = await Swal.fire({ icon: "question", title: `¿Marcar ${ids.length} como publicados hoy?`, text: "El recordatorio de cada uno empieza a contar desde hoy.",
        showCancelButton: true, confirmButtonText: "📣 Sí, publicados", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)" });
      if (!ok.isConfirmed) return;
    }
    setBulkBusy(true);
    const sb = supabaseBrowser();
    let done = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: r, error: e } = kind === "mark"
        ? await sb.rpc("product_publish_mark", { p_store: storeId, p_products: chunk, p_channels: [] })
        : await sb.rpc("product_publish_set_every", { p_store: storeId, p_products: chunk, p_every: kind });
      const d = r as { ok?: boolean; count?: number; message?: string } | null;
      if (e || !d?.ok) { setBulkBusy(false); void Swal.fire({ icon: "error", title: "No se pudo", text: e?.message ?? d?.message, background: "var(--t-bg-base)", color: "var(--t-text)" }); return; }
      done += d.count ?? 0;
    }
    setBulkBusy(false);
    setSelected(new Set());
    void Swal.fire({ toast: true, position: "top", icon: "success", timer: 2400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)",
      title: kind === "mark" ? `📣 ${done} marcados como publicados hoy` : `⏰ ${done} con recordatorio: ${EVERY_OPTIONS.find((o) => o.days === kind)?.label.toLowerCase() ?? `cada ${kind} días`}` });
    void load();
  }

  const shown = visible.slice(0, limit);
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  return (
    <main className="min-w-0 space-y-4 px-3 py-3 pb-28 sm:px-6 sm:py-4" style={{ color: "var(--t-text)" }}>
      {/* ---------------- encabezado */}
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[24px] border p-4 sm:p-5"
        style={{ borderColor: "var(--t-card-border)", background: "linear-gradient(135deg, color-mix(in oklab, #10b981 14%, var(--t-card-bg)), var(--t-card-bg) 55%, color-mix(in oklab, #8b5cf6 12%, var(--t-card-bg)))" }}>
        <RadarSweep />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#10b981,#0ea5e9)" }}><Radar size={24} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-black sm:text-2xl">Radar de productos</h1>
              <p className="text-xs sm:text-sm" style={{ color: "var(--t-muted)" }}>Qué le falta a cada producto, cuáles ya toca publicar y cuáles no se mueven.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ProductsModeSwitch mode="radar" />
            <button type="button" onClick={() => void load()} disabled={busy} className="grid h-10 w-10 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar" title="Actualizar">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </motion.header>

      {missing ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 10%, transparent)" }}>
          ⚠️ Para usar el Radar corre en Supabase la migración <b>supabase/migrations/20261305_radar_productos.sql</b> y vuelve a cargar.
        </div>
      ) : error ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#e5484d" }}>❌ {error}</div>
      ) : !data ? (
        <div className="space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}</div>
      ) : (
        <>
          {/* ---------------- tablero */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="col-span-2 flex items-center gap-3 rounded-2xl border p-3 sm:col-span-1 lg:col-span-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <HealthRing score={stats.avg} size={58} />
              <div><p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Salud promedio</p><p className="text-sm font-black" style={{ color: healthColor(stats.avg) }}>{healthLabel(stats.avg)}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{base.length} productos</p></div>
            </motion.div>
            <Tile emoji="📣" label="Toca publicar" value={stats.due} color="#f59e0b" pulse={stats.due > 0} active={view === "publicar"} onClick={() => { setView("publicar"); setIssue(null); }} />
            <Tile emoji="🚨" label="Falencias graves" value={stats.critical} color="#e5484d" pulse={stats.critical > 0} active={view === "falencias"} onClick={() => { setView("falencias"); setIssue(null); }} />
            <Tile emoji="💤" label="Quietos (60 días)" value={stats.quiet} color="#0ea5e9" active={view === "quietos"} onClick={() => { setView("quietos"); setIssue(null); }} />
            <Tile emoji="📦" label="Agotados" value={stats.out} color="#d97706" active={issue === "out_of_stock"} onClick={() => { setView("all"); setIssue(issue === "out_of_stock" ? null : "out_of_stock"); }} />
            <Tile emoji="✅" label="Listos" value={stats.ready} color="#10b981" active={view === "listos"} onClick={() => { setView("listos"); setIssue(null); }} />
          </div>

          {/* ---------------- filtros */}
          <section className="space-y-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {VIEWS.map((v) => {
                const on = v.key === view;
                return (
                  <button key={v.key} type="button" onClick={() => setView(v.key)} className="relative shrink-0 rounded-xl px-3 py-2 text-xs font-black" style={{ color: on ? "#fff" : "var(--t-text)" }}>
                    {on ? <motion.span layoutId="radar-view" className="absolute inset-0 rounded-xl" style={{ background: v.color }} transition={{ type: "spring", stiffness: 420, damping: 32 }} /> : null}
                    <span className="relative">{v.emoji} {v.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <label className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, transparent)" }}>
                <Search size={15} style={{ color: "var(--t-muted)" }} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código o barras…" className="w-full bg-transparent py-2.5 text-sm outline-none" />
                {q ? <button type="button" onClick={() => setQ("")} aria-label="Borrar"><X size={14} /></button> : null}
              </label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}>
                <option value="">Todas las categorías</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}>
                <option value="health">Ordenar: lo más urgente</option>
                <option value="publish">Publicación más atrasada</option>
                <option value="quiet">Más tiempo sin vender</option>
                <option value="sales">Más vendidos (30 días)</option>
                <option value="name">Nombre A-Z</option>
              </select>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Solo activos
              </label>
            </div>
            {/* Falencias como chips con su cantidad */}
            <div className="flex flex-wrap gap-1.5">
              {ISSUE_ORDER.filter((k) => stats.counts[k] > 0).map((k) => {
                const d = ISSUES[k]; const on = issue === k;
                return (
                  <motion.button key={k} type="button" layout whileTap={{ scale: 0.94 }} onClick={() => setIssue(on ? null : k)} title={d.help}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={on ? { borderColor: LEVEL_COLOR[d.level], background: LEVEL_COLOR[d.level], color: "#fff" } : { borderColor: `color-mix(in oklab, ${LEVEL_COLOR[d.level]} 40%, transparent)` }}>
                    {d.emoji} {d.label} <span className="rounded-full px-1.5 tabular-nums" style={{ background: on ? "rgba(255,255,255,.25)" : `color-mix(in oklab, ${LEVEL_COLOR[d.level]} 15%, transparent)` }}>{stats.counts[k]}</span>
                  </motion.button>
                );
              })}
            </div>
          </section>

          {/* ---------------- lista */}
          <div className="flex items-center justify-between gap-2 px-1 text-xs" style={{ color: "var(--t-muted)" }}>
            <label className="inline-flex cursor-pointer items-center gap-2 font-bold">
              <input type="checkbox" checked={allShownSelected} onChange={() => setSelected((s) => { const n = new Set(s); if (allShownSelected) shown.forEach((r) => n.delete(r.id)); else shown.forEach((r) => n.add(r.id)); return n; })} />
              Seleccionar los que se ven
            </label>
            <span><b style={{ color: "var(--t-text)" }}>{visible.length}</b> producto{visible.length === 1 ? "" : "s"}{search.pending ? " · buscando…" : ""}</span>
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
                  <RadarRow key={r.id} row={r} index={i} storeId={storeId} today={data.today} canCosts={data.can_costs} categoryName={r.category_id ? catName.get(r.category_id) ?? null : null}
                    selected={selected.has(r.id)} onSelect={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    onOpen={(section) => openEditor(r.id, section)} onPub={(pub) => updatePub(r.id, pub)} />
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

      {/* ---------------- barra de acciones con selección */}
      <AnimatePresence>
        {selected.size ? (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-2xl sm:inset-x-6"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
            <span className="px-1 text-sm font-black">{selected.size} seleccionado{selected.size === 1 ? "" : "s"}</span>
            <button type="button" onClick={() => void bulk("mark")} disabled={bulkBusy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#f59e0b,#ec4899)" }}>
              {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} Marcar publicados hoy
            </button>
            <select value="" disabled={bulkBusy} onChange={(e) => { const v = e.target.value; if (v !== "") void bulk(Number(v)); }} className="rounded-xl border px-2 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
              <option value="">⏰ Recordarme…</option>
              {EVERY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
            </select>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar selección</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function RadarRow({
  row: r, index, storeId, today, canCosts, categoryName, selected, onSelect, onOpen, onPub,
}: {
  row: Row; index: number; storeId: string | null; today: string; canCosts: boolean; categoryName: string | null;
  selected: boolean; onSelect: () => void; onOpen: (section?: string) => void; onPub: (p: PublishState) => void;
}) {
  const [all, setAll] = useState(false);
  const chips = all ? r.issues : r.issues.slice(0, 4);
  const sinceSale = daysSince(r.last_sale_at, today);
  const pub = publishStatusText(r.pub, today);
  const mainPrice = r.prices.find((p) => Number(p) > 0) ?? 0;
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 12) * 0.025 } }} exit={{ opacity: 0, scale: 0.98 }}
      className="group rounded-2xl border p-3 transition hover:shadow-lg"
      style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)", background: selected ? "color-mix(in oklab, var(--t-accent) 7%, var(--t-card-bg))" : "var(--t-card-bg)" }}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Seleccionar ${r.name}`} className="h-4 w-4" />
          <button type="button" onClick={() => onOpen()} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border sm:h-20 sm:w-20" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }} title="Abrir en otra ventana">
            {r.image ? <img src={r.image} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /> : <span className="grid h-full place-items-center text-2xl opacity-50">📷</span>}
            {!r.active ? <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-[9px] font-bold text-white">OCULTO</span> : null}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpen()} className="block max-w-full truncate text-left text-sm font-black hover:underline sm:text-base">{r.name}</button>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                {r.code ? <span className="font-bold">#{r.code}</span> : null}
                {categoryName ? <span>🗂️ {categoryName}</span> : null}
                <span className="font-bold" style={{ color: "var(--t-text)" }}>{mainPrice ? money(mainPrice) : "Sin precio"}</span>
                {canCosts && r.cost ? <span>costo {money(Number(r.cost))}</span> : null}
              </p>
            </div>
            <HealthRing score={r.score} size={44} />
          </div>

          {/* Falencias: cada una abre el producto donde se arregla */}
          <div className="mt-2 flex flex-wrap gap-1">
            {r.issues.length === 0 ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500">✓ Ficha completa</span> : null}
            {chips.map((iss) => (
              <button key={iss.key} type="button" onClick={() => onOpen(iss.section)} title={`${iss.help} — Toca para arreglarlo`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold transition hover:-translate-y-0.5"
                style={{ borderColor: `color-mix(in oklab, ${LEVEL_COLOR[iss.level]} 45%, transparent)`, background: `color-mix(in oklab, ${LEVEL_COLOR[iss.level]} 10%, transparent)` }}>
                {iss.emoji} {iss.label}
              </button>
            ))}
            {r.issues.length > 4 ? <button type="button" onClick={() => setAll((x) => !x)} className="rounded-full px-2 py-0.5 text-[11px] font-bold underline" style={{ color: "var(--t-muted)" }}>{all ? "menos" : `+${r.issues.length - 4} más`}</button> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
            <span title="Unidades en todos los puntos">📦 <b style={{ color: "var(--t-text)" }}>{r.stock === null ? "—" : Number(r.stock).toLocaleString("es-CO")}</b> und{r.stock_points ? ` · ${r.stock_points} punto${r.stock_points === 1 ? "" : "s"}` : ""}</span>
            <span title="Unidades vendidas en 30 días">🛒 <b style={{ color: "var(--t-text)" }}>{Number(r.sold_30)}</b> en 30 días</span>
            <span>⏱️ Última venta: <b style={{ color: sinceSale === null || sinceSale > 60 ? "#e5484d" : "var(--t-text)" }}>{agoDays(sinceSale)}</b></span>
            <span>📣 <b style={{ color: pub.tone === "late" ? "#e5484d" : pub.tone === "due" ? "#d97706" : "var(--t-text)" }}>{pub.text}</b></span>
            <span className="ml-auto flex items-center gap-1.5">
              <PublishButton compact storeId={storeId} productId={r.id} productName={r.name} state={r.pub} onChanged={onPub} />
              <button type="button" onClick={() => onOpen()} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }} title="Editar en otra ventana">
                <ExternalLink size={12} /> Editar
              </button>
            </span>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function Tile({ emoji, label, value, color, pulse, active, onClick }: { emoji: string; label: string; value: number; color: string; pulse?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <motion.button type="button" onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border p-3 text-left"
      style={{ borderColor: active ? color : "var(--t-card-border)", background: active ? `color-mix(in oklab, ${color} 14%, var(--t-card-bg))` : "var(--t-card-bg)" }}>
      {pulse ? <span className="absolute right-3 top-3 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: color }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} /></span> : null}
      <p className="text-xl">{emoji}</p>
      <motion.p key={value} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-2xl font-black tabular-nums" style={{ color }}>{value.toLocaleString("es-CO")}</motion.p>
      <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{label}</p>
    </motion.button>
  );
}

function HealthRing({ score, size }: { score: number; size: number }) {
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

/** Barrido de radar decorativo en el encabezado. */
function RadarSweep() {
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
