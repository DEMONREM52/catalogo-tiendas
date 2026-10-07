"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Filter, RotateCcw, Search, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Thumb } from "./LineEditor";
import { Btn, Empty, Panel, errorMessage, inputClass, inputStyle, money, tableWrap, td, th, toast, type ErpCtx, type Warehouse } from "./shared";

type Row = {
  id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; active: boolean;
  category: string | null; cost_price: number; total: number; qty: number; levels: Record<string, number>;
};
type Result = { total: number; units: number; value: number; negative: number; out: number; rows: Row[] };

type Filters = {
  q: string; category: string; warehouse: string; status: string; low: number; cost: string; active: string; sort: string; pageSize: number;
};
const DEFAULTS: Filters = { q: "", category: "", warehouse: "", status: "all", low: 5, cost: "all", active: "active", sort: "name", pageSize: 25 };
const STORAGE = "remhub:stock-filters";

const STATUS: Array<[string, string, string]> = [
  ["all", "Todos", "var(--t-accent)"],
  ["in", "Con existencias", "#22c55e"],
  ["low", "Stock bajo", "#f59e0b"],
  ["out", "Agotados (0)", "#ef4444"],
  ["negative", "Negativos", "#b91c1c"],
  ["over", "Sobre el mínimo", "#0ea5e9"],
  ["elsewhere", "Agotado aquí, hay en otro lugar", "#8b5cf6"],
];

const field = `${inputClass}`;

/** Existencias con filtros: punto, categoría, estado, costo, orden, exportar y totales del resultado. */
export function StockBrowser({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const active = warehouses.filter((w) => w.active && (!ctx.pointId || w.id === ctx.pointId));
  const [f, setF] = useState<Filters>(() => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(window.localStorage.getItem(STORAGE) ?? "{}") as Partial<Filters>), q: "" };
    } catch {
      return DEFAULTS;
    }
  });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [showMore, setShowMore] = useState(false);
  const seq = useRef(0);
  const warehouse = ctx.pointId ?? f.warehouse;
  const whName = active.find((w) => w.id === warehouse)?.name;

  function patch(change: Partial<Filters>) {
    setF((cur) => {
      const next = { ...cur, ...change };
      try { window.localStorage.setItem(STORAGE, JSON.stringify({ ...next, q: "" })); } catch { /* opcional */ }
      return next;
    });
    setPage(0);
  }

  useEffect(() => {
    void supabaseBrowser().from("product_categories").select("id,name").eq("store_id", ctx.storeId).eq("active", true).order("name")
      .then(({ data: rows }) => setCategories((rows ?? []) as Array<{ id: string; name: string }>));
  }, [ctx.storeId]);

  async function fetchPage(limit: number, offset: number): Promise<Result | null> {
    const { data: res, error } = await supabaseBrowser().rpc("erp_stock_browse", {
      p_store: ctx.storeId, p_q: f.q || null, p_category: f.category || null, p_warehouse: warehouse || null, p_status: f.status,
      p_low: f.low, p_cost: f.cost, p_active: f.active, p_sort: f.sort, p_limit: limit, p_offset: offset,
    });
    if (!error) return res as Result;
    if (/erp_stock_browse|Could not find the function|schema cache/i.test(error.message)) {
      // Respaldo mientras no se ejecuta la migración: búsqueda básica.
      setLegacy(true);
      const old = await supabaseBrowser().rpc("erp_stock_page", { p_store: ctx.storeId, p_q: f.q, p_only_low: f.status === "low", p_limit: Math.min(limit, 100), p_offset: offset });
      if (old.error) throw old.error;
      const rows = (old.data ?? []) as Array<{ id: string; name: string; sku: string | null; cost_price: number; total: number; levels: Record<string, number>; total_count: number }>;
      return {
        total: rows[0]?.total_count ?? 0, units: rows.reduce((s, r) => s + r.total, 0), value: rows.reduce((s, r) => s + Math.max(r.total, 0) * Number(r.cost_price), 0),
        negative: 0, out: 0,
        rows: rows.map((r) => ({ ...r, barcode: null, image_url: null, active: true, category: null, qty: r.total })),
      };
    }
    throw error;
  }

  useEffect(() => {
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetchPage(f.pageSize, page * f.pageSize);
        if (id !== seq.current) return;
        setData(res);
      } catch (error) {
        if (id === seq.current) void toast("No se pudieron cargar las existencias", "error", errorMessage(error));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, f.q ? 300 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.storeId, f, page, warehouse]);

  async function exportCsv() {
    try {
      const all = await fetchPage(5000, 0);
      if (!all) return;
      const header = ["Producto", "SKU", "Código de barras", "Categoría", ...active.map((w) => w.name), "Total", "Costo", "Valor"];
      const lines = all.rows.map((r) => [
        r.name, r.sku ?? "", r.barcode ?? "", r.category ?? "", ...active.map((w) => String(r.levels?.[w.id] ?? 0)),
        String(r.total), String(r.cost_price), String(Math.max(r.qty, 0) * Number(r.cost_price)),
      ]);
      const csv = "﻿" + [header, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      Object.assign(document.createElement("a"), { href: url, download: `existencias-${new Date().toISOString().slice(0, 10)}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (error) {
      void toast("No se pudo exportar", "error", errorMessage(error));
    }
  }

  const activeFilters = useMemo(() => {
    const chips: Array<[keyof Filters, string]> = [];
    if (f.category) chips.push(["category", `Categoría: ${categories.find((c) => c.id === f.category)?.name ?? "…"}`]);
    if (f.warehouse && !ctx.pointId) chips.push(["warehouse", `Lugar: ${whName ?? "…"}`]);
    if (f.status !== "all") chips.push(["status", STATUS.find(([k]) => k === f.status)?.[1] ?? f.status]);
    if (f.cost !== "all") chips.push(["cost", f.cost === "with" ? "Con costo" : "Sin costo"]);
    if (f.active !== "active") chips.push(["active", f.active === "inactive" ? "Inactivos" : "Activos e inactivos"]);
    return chips;
  }, [f, categories, whName, ctx.pointId]);

  const totalCount = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(totalCount / f.pageSize));
  const rows = data?.rows ?? [];

  return (
    <Panel
      title="Existencias por bodega"
      subtitle={whName ? `Revisando: ${whName}. Los filtros de estado usan las cantidades de este lugar.` : "Filtra por lugar, categoría y estado. Solo se descarga la página que ves."}
      actions={
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => void exportCsv()}><span className="inline-flex items-center gap-1.5"><Download size={14} /> Excel</span></Btn>
        </div>
      }
    >
      {legacy ? (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          Para usar todos los filtros ejecuta en Supabase la migración <b>20261025_existencias_filtros.sql</b>. Mientras tanto funciona la búsqueda básica.
        </p>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input className={field} style={{ ...inputStyle, paddingLeft: "2.2rem" }} placeholder="Buscar por nombre, SKU o código de barras…" value={f.q} onChange={(e) => patch({ q: e.target.value })} />
        </div>
        <select className={field} style={inputStyle} value={warehouse} disabled={Boolean(ctx.pointId)} onChange={(e) => patch({ warehouse: e.target.value })} aria-label="Punto o bodega">
          <option value="">🏬 Todos los lugares (total)</option>
          {active.map((w) => <option key={w.id} value={w.id}>{w.kind === "point" ? "📍" : "🏬"} {w.name}</option>)}
        </select>
        <select className={field} style={inputStyle} value={f.category} onChange={(e) => patch({ category: e.target.value })} aria-label="Categoría">
          <option value="">🗂️ Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" onClick={() => setShowMore((v) => !v)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ ...inputStyle, borderColor: showMore ? "var(--t-accent)" : inputStyle.borderColor }}>
          <Filter size={15} /> Más filtros
        </button>
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {STATUS.filter(([k]) => k !== "elsewhere" || warehouse).map(([k, label, color]) => (
          <button
            key={k}
            type="button"
            onClick={() => patch({ status: k })}
            className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            style={f.status === k ? { background: color, borderColor: "transparent", color: "#fff" } : { borderColor: "var(--t-card-border)" }}
          >
            {k === "low" ? `${label} (1–${f.low})` : k === "over" ? `${label} (+${f.low})` : label}
          </button>
        ))}
      </div>

      {showMore ? (
        <div className="mt-2 grid gap-2 rounded-2xl border p-3 sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: "var(--t-card-border)" }}>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Mínimo / stock bajo hasta
            <input type="number" min={0} className={`${field} mt-1`} style={inputStyle} value={f.low} onChange={(e) => patch({ low: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Costo
            <select className={`${field} mt-1`} style={inputStyle} value={f.cost} onChange={(e) => patch({ cost: e.target.value })}>
              <option value="all">Todos</option><option value="with">Con costo</option><option value="without">Sin costo</option>
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Estado del producto
            <select className={`${field} mt-1`} style={inputStyle} value={f.active} onChange={(e) => patch({ active: e.target.value })}>
              <option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option>
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Ordenar por
            <select className={`${field} mt-1`} style={inputStyle} value={f.sort} onChange={(e) => patch({ sort: e.target.value })}>
              <option value="name">Nombre (A–Z)</option>
              <option value="qty_desc">Más existencias</option>
              <option value="qty_asc">Menos existencias</option>
              <option value="value_desc">Mayor valor</option>
              <option value="cost_desc">Mayor costo</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
            Productos por página
            <select className={`${field} mt-1`} style={inputStyle} value={f.pageSize} onChange={(e) => patch({ pageSize: Number(e.target.value) })}>
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {activeFilters.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeFilters.map(([key, label]) => (
            <button key={key} type="button" onClick={() => patch({ [key]: DEFAULTS[key] } as Partial<Filters>)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}>
              {label} <X size={12} />
            </button>
          ))}
          <button type="button" onClick={() => patch({ ...DEFAULTS, q: f.q, pageSize: f.pageSize })} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            <RotateCcw size={12} /> Limpiar filtros
          </button>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Productos", String(totalCount), "var(--t-text)"],
          ["Unidades", String(data?.units ?? 0), (data?.units ?? 0) < 0 ? "#ef4444" : "var(--t-text)"],
          ["Valor a costo", money(data?.value ?? 0), "var(--t-text)"],
          ["Agotados / negativos", `${data?.out ?? 0} / ${data?.negative ?? 0}`, (data?.negative ?? 0) > 0 ? "#ef4444" : "var(--t-text)"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
            <p className="text-base font-black tabular-nums" style={{ color }}>{loading && !data ? "…" : value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        {loading && rows.length === 0 ? (
          <Empty text="Cargando…" />
        ) : rows.length === 0 ? (
          <Empty text="Ningún producto coincide con estos filtros." />
        ) : (
          <div className={tableWrap} style={{ borderColor: "var(--t-card-border)", opacity: loading ? 0.6 : 1 }}>
            <table className="w-full min-w-[680px]">
              <thead style={{ color: "var(--t-muted)" }}>
                <tr>
                  <th className={th}>Producto</th>
                  {active.map((w) => (
                    <th key={w.id} className={`${th} text-right`} style={w.id === warehouse ? { color: "var(--t-accent)" } : undefined}>{w.name}</th>
                  ))}
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Costo</th>
                  <th className={`${th} text-right`}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: "var(--t-card-border)", opacity: p.active ? 1 : 0.55 }}>
                    <td className={td}>
                      <div className="flex items-center gap-2.5">
                        <Thumb src={p.image_url} size={36} />
                        <div className="min-w-0">
                          <div className="font-semibold">{p.name}</div>
                          <div className="text-xs" style={{ color: "var(--t-muted)" }}>{[p.sku, p.category].filter(Boolean).join(" · ") || "—"}</div>
                        </div>
                      </div>
                    </td>
                    {active.map((w) => {
                      const q = p.levels?.[w.id] ?? 0;
                      return (
                        <td key={w.id} className={`${td} text-right tabular-nums`} style={{ fontWeight: w.id === warehouse ? 800 : 500, color: q < 0 ? "#ef4444" : q === 0 ? "var(--t-muted)" : undefined, background: w.id === warehouse ? "color-mix(in oklab, var(--t-accent) 7%, transparent)" : undefined }}>
                          {q}
                        </td>
                      );
                    })}
                    <td className={`${td} text-right tabular-nums`} style={{ fontWeight: 800, color: p.total < 0 ? "#ef4444" : p.total === 0 ? "#ef4444" : p.total <= f.low ? "#f59e0b" : undefined }}>{p.total}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(p.cost_price)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(Math.max(p.qty, 0) * Number(p.cost_price ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
        <span>{totalCount} producto(s) · página {page + 1} de {pages}</span>
        <div className="flex gap-2">
          <Btn variant="ghost" disabled={page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>← Anterior</Btn>
          <Btn variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((v) => v + 1)}>Siguiente →</Btn>
        </div>
      </div>
    </Panel>
  );
}
