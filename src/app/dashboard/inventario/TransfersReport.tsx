"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownUp, Bookmark, Download, Printer, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "@/components/forms/Sheet";
import { DateField } from "@/components/forms/Fields";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { downloadXlsx } from "@/lib/data/xlsx";
import type { ErpCtx, Warehouse } from "./shared";

/**
 * Informe de traslados a la medida (20261279): qué se trasladó, a qué puntos, cuánto, cuánto vale y qué no llegó.
 * Se escoge cómo agrupar, se filtra por fechas, puntos, estado, categoría o producto, y se exporta a Excel o PDF.
 * Los informes que se usan seguido se guardan con nombre (en este navegador).
 */

type Group = { key: string; label: string; sub?: string; transfers: number; products: number; units: number; received: number; missing: number; extra: number; value: number; cost?: number; first: string; last: string };
type Report = {
  can_cost: boolean; group: string;
  totals: { transfers: number; products: number; lines: number; units: number; received: number; missing: number; extra: number; in_transit: number; value: number; cost: number | null; points_to: number; points_from: number };
  groups: Group[]; series: Array<{ day: string; units: number; transfers: number }>;
  top_products: Array<{ name: string; sku: string | null; units: number; transfers: number; points: number }>;
  matrix: Array<{ from: string; to: string; units: number; transfers: number }>;
};
type Filters = { from: string; to: string; origins: string[]; dests: string[]; status: string; group: string; q: string; category: string };

const GROUPS: Array<[string, string, string]> = [
  ["dest", "🏬", "Punto que recibe"], ["origin", "🏭", "Punto que envía"], ["route", "🔀", "Ruta (de → a)"], ["product", "📦", "Producto"],
  ["category", "🏷️", "Categoría"], ["day", "📅", "Día"], ["week", "🗓️", "Semana"], ["month", "📆", "Mes"],
  ["sender", "🧑‍💼", "Quién envió"], ["receiver", "🙋", "Quién recibió"], ["carrier", "🚚", "Quién trasladó"],
];
const STATUS: Array<[string, string]> = [["all", "Todos (sin anulados)"], ["in_transit", "En tránsito"], ["received", "Recibidos"], ["diff", "Con diferencias"], ["cancelled", "Anulados"]];
const money = (n: number | null | undefined) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n ?? 0));
const num = (n: number) => Number(n ?? 0).toLocaleString("es-CO");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmm = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const SAVED_KEY = (store: string) => `remhub-transfer-reports-${store}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

function monthStart() { const t = new Date(); return iso(new Date(t.getFullYear(), t.getMonth(), 1)); }

export function TransfersReport({ ctx, warehouses, onClose }: { ctx: ErpCtx; warehouses: Warehouse[]; onClose: () => void }) {
  const [f, setF] = useState<Filters>({ from: monthStart(), to: iso(new Date()), origins: [], dests: [], status: "all", group: "dest", q: "", category: "" });
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [sort, setSort] = useState<{ col: keyof Group; desc: boolean }>({ col: "units", desc: true });
  const [saved, setSaved] = useState<Array<{ name: string; f: Filters }>>([]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((c) => ({ ...c, [k]: v }));
  const toggle = (k: "origins" | "dests", id: string) => setF((c) => ({ ...c, [k]: c[k].includes(id) ? c[k].filter((x) => x !== id) : [...c[k], id] }));

  useEffect(() => {
    void supabaseBrowser().from("product_categories").select("id,name").eq("store_id", ctx.storeId).order("name").then(({ data: c }) => setCats((c ?? []) as Array<{ id: string; name: string }>));
    const t = window.setTimeout(() => { try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY(ctx.storeId)) ?? "[]")); } catch { /* sin almacenamiento */ } }, 0);
    return () => window.clearTimeout(t);
  }, [ctx.storeId]);

  // Se recalcula al cambiar un filtro (con una pausa corta al escribir).
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      setLoading(true);
      const { data: r, error: e } = await supabaseBrowser().rpc("erp_transfer_report", {
        p_store: ctx.storeId, p_from: f.from || null, p_to: f.to || null, p_origins: f.origins.length ? f.origins : null, p_dests: f.dests.length ? f.dests : null,
        p_status: f.status, p_group: f.group, p_q: f.q.trim() || null, p_category: f.category || null,
      });
      if (!alive) return;
      setLoading(false);
      if (e) { setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261279_informe_traslados.sql." : e.message); return; }
      setError(null);
      setData(r as Report);
    }, f.q ? 400 : 120);
    return () => { alive = false; window.clearTimeout(t); };
  }, [ctx.storeId, f]);

  const groupName = GROUPS.find((g) => g[0] === f.group)?.[2] ?? "";
  const rows = useMemo(() => {
    const list = [...(data?.groups ?? [])];
    list.sort((a, b) => {
      const x = a[sort.col] ?? 0, y = b[sort.col] ?? 0;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
      return sort.desc ? -c : c;
    });
    return list;
  }, [data, sort]);
  const maxUnits = Math.max(1, ...rows.map((r) => r.units));
  const maxDay = Math.max(1, ...(data?.series ?? []).map((s) => s.units));
  const points = warehouses.filter((w) => w.active);
  const matrixFrom = [...new Set((data?.matrix ?? []).map((m) => m.from))];
  const matrixTo = [...new Set((data?.matrix ?? []).map((m) => m.to))];
  const maxCell = Math.max(1, ...(data?.matrix ?? []).map((m) => m.units));
  const periodLabel = f.from || f.to ? `${ddmm(f.from) || "inicio"} a ${ddmm(f.to) || "hoy"}` : "Todas las fechas";

  function quick(k: "today" | "7" | "month" | "last" | "year" | "all") {
    const t = new Date();
    const r = k === "today" ? { from: iso(t), to: iso(t) }
      : k === "7" ? { from: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)), to: iso(t) }
      : k === "month" ? { from: monthStart(), to: iso(t) }
      : k === "last" ? { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) }
      : k === "year" ? { from: `${t.getFullYear()}-01-01`, to: iso(t) } : { from: "", to: "" };
    setF((c) => ({ ...c, ...r }));
  }

  async function saveView() {
    const r = await Swal.fire({ ...swal, title: "Guardar este informe", input: "text", inputPlaceholder: "Ej: Juguetería a los puntos este mes", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim() ? null : "Ponle un nombre") });
    if (!r.isConfirmed) return;
    const next = [...saved.filter((s) => s.name !== r.value.trim()), { name: String(r.value).trim(), f }];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY(ctx.storeId), JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  }
  function removeView(name: string) {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY(ctx.storeId), JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  }

  function filterText() {
    const nm = (ids: string[]) => ids.map((id) => points.find((p) => p.id === id)?.name ?? "").join(", ");
    return [
      `Periodo: ${periodLabel}`, f.origins.length ? `Sale de: ${nm(f.origins)}` : "", f.dests.length ? `Llega a: ${nm(f.dests)}` : "",
      `Estado: ${STATUS.find((s) => s[0] === f.status)?.[1]}`, f.category ? `Categoría: ${cats.find((c) => c.id === f.category)?.name}` : "", f.q ? `Búsqueda: ${f.q}` : "",
    ].filter(Boolean).join(" · ");
  }

  function exportExcel() {
    if (!data) return;
    const c = data.can_cost;
    const t = data.totals;
    downloadXlsx(`informe-traslados-${f.group}-${f.from || "inicio"}-${f.to || "hoy"}`, [
      { name: "Resumen", head: ["Dato", "Valor"], rows: [
        ["Informe", `Traslados por ${groupName.toLowerCase()}`], ["Filtros", filterText()], ["Traslados", t.transfers], ["Unidades enviadas", t.units],
        ["Unidades recibidas", t.received], ["No llegaron", t.missing], ["Llegaron de más", t.extra], ["En tránsito (traslados)", t.in_transit],
        ["Productos distintos", t.products], ["Valor a precio interno", t.value], ...(c ? [["Valor a costo", t.cost ?? 0]] : []),
      ], widths: [26, 70] },
      { name: groupName.slice(0, 28), head: [groupName, ...(f.group === "product" ? ["Referencia"] : []), "Traslados", "Productos", "Unidades", "Recibidas", "No llegaron", "De más", "Valor interno", ...(c ? ["Costo"] : []), "% de unidades", "Primero", "Último"],
        rows: rows.map((g) => [g.label, ...(f.group === "product" ? [g.sub ?? ""] : []), g.transfers, g.products, g.units, g.received, g.missing, g.extra, g.value, ...(c ? [g.cost ?? 0] : []),
          Math.round((g.units / Math.max(1, t.units)) * 1000) / 10, ddmm(g.first), ddmm(g.last)]) },
      { name: "Por día", head: ["Día", "Traslados", "Unidades"], rows: data.series.map((s) => [ddmm(s.day), s.transfers, s.units]) },
      { name: "Rutas", head: ["Sale de", "Llega a", "Traslados", "Unidades"], rows: data.matrix.map((m) => [m.from, m.to, m.transfers, m.units]) },
      { name: "Productos más trasladados", head: ["Producto", "Referencia", "Unidades", "Traslados", "Puntos"], rows: data.top_products.map((p) => [p.name, p.sku ?? "", p.units, p.transfers, p.points]) },
    ]);
  }

  function printReport() {
    if (!data) return;
    const c = data.can_cost;
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x] as string);
    const w = window.open("", "_blank");
    if (!w) return void Swal.fire({ ...swal, icon: "info", title: "Permite las ventanas emergentes para imprimir" });
    const kpi = [["Traslados", num(data.totals.transfers)], ["Unidades", num(data.totals.units)], ["No llegaron", num(data.totals.missing)], ["Valor interno", money(data.totals.value)], ...(c ? [["Costo", money(data.totals.cost)]] : [])];
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de traslados</title><style>
      body{font-family:system-ui,Segoe UI,Arial;margin:24px;color:#111}h1{font-size:20px;margin:0}p{margin:4px 0;color:#555;font-size:12px}
      .k{display:flex;gap:8px;margin:14px 0}.k div{border:1px solid #ddd;border-radius:10px;padding:8px 12px}.k b{display:block;font-size:16px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th,td{border-bottom:1px solid #e5e5e5;padding:6px;text-align:left}th{background:#f4f4f5}td.n{text-align:right;font-variant-numeric:tabular-nums}
      .bar{height:6px;background:#a855f7;border-radius:4px}@media print{body{margin:10mm}}</style></head><body>
      <h1>Informe de traslados · por ${esc(groupName.toLowerCase())}</h1><p>${esc(filterText())}</p><p>Generado ${esc(new Date().toLocaleString("es-CO"))}</p>
      <div class="k">${kpi.map(([l, v]) => `<div>${esc(l)}<b>${esc(v)}</b></div>`).join("")}</div>
      <table><thead><tr><th>${esc(groupName)}</th><th>Traslados</th><th>Unidades</th><th>No llegaron</th><th>Valor interno</th>${c ? "<th>Costo</th>" : ""}<th style="width:22%"></th></tr></thead><tbody>
      ${rows.map((g) => `<tr><td>${esc(g.label)}${g.sub ? ` <small>(${esc(g.sub)})</small>` : ""}</td><td class="n">${num(g.transfers)}</td><td class="n">${num(g.units)}</td><td class="n">${num(g.missing)}</td><td class="n">${money(g.value)}</td>${c ? `<td class="n">${money(g.cost)}</td>` : ""}<td><div class="bar" style="width:${Math.round((g.units / maxUnits) * 100)}%"></div></td></tr>`).join("")}
      </tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  }

  const head = (col: keyof Group, label: string, right = true) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 ${right ? "text-right" : "text-left"}`} onClick={() => setSort((s) => ({ col, desc: s.col === col ? !s.desc : true }))}>
      {label} {sort.col === col ? (sort.desc ? "↓" : "↑") : ""}
    </th>
  );
  const chip = (on: boolean) => (on ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" });

  return (
    <Sheet wide title="📊 Informe de traslados" subtitle="Escoge cómo agrupar y filtra lo que necesites. Se calcula con todos los traslados." onClose={onClose}
      footer={<>
        <button type="button" onClick={() => void saveView()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}><Bookmark size={15} /> Guardar informe</button>
        <span className="flex-1" />
        <button type="button" disabled={!data} onClick={printReport} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}><Printer size={15} /> Imprimir / PDF</button>
        <button type="button" disabled={!data} onClick={exportExcel} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-40" style={{ background: "#16a34a" }}><Download size={15} /> Excel</button>
      </>}>
      {saved.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>⭐ Mis informes:</span>
          {saved.map((s) => (
            <span key={s.name} className="inline-flex items-center overflow-hidden rounded-full border text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              <button type="button" onClick={() => setF(s.f)} className="px-3 py-1.5">{s.name}</button>
              <button type="button" onClick={() => removeView(s.name)} className="grid h-7 w-7 place-items-center opacity-60 hover:opacity-100" aria-label={`Borrar «${s.name}»`}><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Agrupar por */}
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Agrupar por</p>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map(([k, icon, label]) => (
            <button key={k} type="button" onClick={() => set("group", k)} className="min-h-9 rounded-full border px-3 text-xs font-bold transition" style={chip(f.group === k)}>{icon} {label}</button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="grid gap-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold">📅</span>
          <DateField compact value={f.from} onChange={(v) => set("from", v)} max={f.to || undefined} ariaLabel="Desde" placeholder="Desde" className="w-36" />
          <span style={{ color: "var(--t-muted)" }}>a</span>
          <DateField compact value={f.to} onChange={(v) => set("to", v)} min={f.from || undefined} ariaLabel="Hasta" placeholder="Hasta" className="w-36" />
          {([["today", "Hoy"], ["7", "7 días"], ["month", "Este mes"], ["last", "Mes pasado"], ["year", "Este año"], ["all", "Todo"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => quick(k)} className="min-h-8 rounded-full border px-2.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{l}</button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Estado">{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={f.category} onChange={(e) => set("category", e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="🔎 Producto, referencia o #número" aria-label="Buscar" />
        </div>
        {([["origins", "🏭 Sale de"], ["dests", "🏬 Llega a"]] as const).map(([k, label]) => (
          <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-20 shrink-0 font-bold">{label}</span>
            <button type="button" onClick={() => set(k, [])} className="min-h-8 rounded-full border px-2.5 font-semibold" style={chip(!f[k].length)}>Todos</button>
            {points.map((p) => <button key={p.id} type="button" onClick={() => toggle(k, p.id)} className="min-h-8 rounded-full border px-2.5 font-semibold" style={chip(f[k].includes(p.id))}>{p.name}</button>)}
          </div>
        ))}
      </div>

      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
      {!data && loading ? <SkeletonCards count={4} label="Calculando el informe…" /> : null}

      {data ? (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {/* Cifras */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["🚚", "Traslados", num(data.totals.transfers), `${data.totals.in_transit} en tránsito`],
              ["📦", "Unidades", num(data.totals.units), `${num(data.totals.products)} productos distintos`],
              ["🏬", "Puntos que recibieron", num(data.totals.points_to), `desde ${data.totals.points_from} punto(s)`],
              ["💰", "Valor a precio interno", money(data.totals.value), data.can_cost && data.totals.cost !== null ? `Costo ${money(data.totals.cost)}` : "Lo que pagan los puntos"],
              ["⚠️", "No llegaron", num(data.totals.missing), data.totals.extra ? `${num(data.totals.extra)} llegaron de más` : "unidades faltantes"],
            ].map(([icon, label, value, hint], i) => (
              <motion.div key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className={`rounded-2xl border p-3 ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`} style={{ borderColor: i === 4 && data.totals.missing ? "#ef4444" : "var(--t-card-border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{icon} {label}</p>
                <p className="mt-1 text-xl font-black tabular-nums">{value}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p>
              </motion.div>
            ))}
          </div>

          {/* Gráfica por grupo */}
          {rows.length ? (
            <section className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="mb-2 text-sm font-bold">Unidades por {groupName.toLowerCase()}</p>
              <div className="space-y-1.5">
                {rows.slice(0, 12).map((g) => (
                  <div key={g.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
                    <span className="truncate font-semibold" title={g.label}>{g.label}</span>
                    <span className="h-3 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
                      <motion.span className="block h-full rounded-full" style={{ background: "linear-gradient(90deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }} initial={{ width: 0 }} animate={{ width: `${(g.units / maxUnits) * 100}%` }} transition={{ duration: 0.5 }} />
                    </span>
                    <span className="tabular-nums font-bold">{num(g.units)}</span>
                  </div>
                ))}
                {rows.length > 12 ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Y {rows.length - 12} más en la tabla.</p> : null}
              </div>
            </section>
          ) : <p className="rounded-2xl border p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>No hay traslados con estos filtros.</p>}

          {/* Unidades por día */}
          {data.series.length > 1 ? (
            <section className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="mb-2 text-sm font-bold">Unidades trasladadas por día</p>
              <div className="flex h-28 items-end gap-[3px] overflow-x-auto">
                {data.series.map((s) => (
                  <div key={s.day} className="group relative flex h-full min-w-[10px] flex-1 items-end" title={`${ddmm(s.day)}: ${num(s.units)} und. en ${s.transfers} traslado(s)`}>
                    <motion.span className="block w-full rounded-t" style={{ background: "var(--t-accent)" }} initial={{ height: 0 }} animate={{ height: `${Math.max(4, (s.units / maxDay) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px]" style={{ color: "var(--t-muted)" }}><span>{ddmm(data.series[0].day)}</span><span>{ddmm(data.series[data.series.length - 1].day)}</span></div>
            </section>
          ) : null}

          {/* Tabla */}
          {rows.length ? (
            <section className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}><ArrowDownUp size={14} /> Detalle por {groupName.toLowerCase()} <span className="text-xs font-normal" style={{ color: "var(--t-muted)" }}>· toca un título para ordenar</span></div>
              <div className="overflow-x-auto">
                <table className="rt w-full min-w-[640px] text-xs">
                  <thead style={{ background: "var(--t-card-bg-soft)" }}>
                    <tr>{head("label", groupName, false)}{head("transfers", "Traslados")}{head("units", "Unidades")}{head("received", "Recibidas")}{head("missing", "No llegaron")}{head("value", "Valor interno")}{data.can_cost ? head("cost", "Costo") : null}<th className="px-2 py-2 text-right">%</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.key} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                        <td className="px-2 py-2 font-semibold">{g.label}{g.sub ? <span className="ml-1 font-normal" style={{ color: "var(--t-muted)" }}>{g.sub}</span> : null}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(g.transfers)}</td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums">{num(g.units)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(g.received)}</td>
                        <td className="px-2 py-2 text-right tabular-nums" style={{ color: g.missing ? "#ef4444" : undefined }}>{num(g.missing)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(g.value)}</td>
                        {data.can_cost ? <td className="px-2 py-2 text-right tabular-nums">{money(g.cost)}</td> : null}
                        <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--t-muted)" }}>{((g.units / Math.max(1, data.totals.units)) * 100).toFixed(1)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Matriz de rutas */}
            {data.matrix.length ? (
              <section className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="border-b px-3 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>🔀 Quién le mandó a quién (unidades)</p>
                <div className="overflow-x-auto p-2">
                  <table className="text-xs">
                    <thead><tr><th className="px-2 py-1 text-left">Sale de ↓ / Llega a →</th>{matrixTo.map((t) => <th key={t} className="px-2 py-1 text-right">{t}</th>)}</tr></thead>
                    <tbody>
                      {matrixFrom.map((fr) => (
                        <tr key={fr}><td className="px-2 py-1 font-semibold">{fr}</td>
                          {matrixTo.map((to) => {
                            const c = data.matrix.find((m) => m.from === fr && m.to === to);
                            return <td key={to} className="px-2 py-1 text-right font-bold tabular-nums" style={c ? { background: `color-mix(in oklab, var(--t-accent) ${Math.round(10 + (c.units / maxCell) * 55)}%, transparent)`, borderRadius: 6 } : { color: "var(--t-muted)" }}>{c ? num(c.units) : "—"}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {/* Productos más trasladados */}
            {data.top_products.length ? (
              <section className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="border-b px-3 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>🏆 Productos más trasladados</p>
                <ol className="divide-y text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                  {data.top_products.map((p, i) => (
                    <li key={`${p.name}${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black text-white" style={{ background: i < 3 ? "#f59e0b" : "var(--t-accent)" }}>{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{p.name}{p.sku ? <span className="ml-1 font-normal" style={{ color: "var(--t-muted)" }}>{p.sku}</span> : null}</span>
                      <span className="shrink-0 text-right" style={{ color: "var(--t-muted)" }}>{p.points} punto(s)</span>
                      <b className="w-14 shrink-0 text-right tabular-nums">{num(p.units)}</b>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
          <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>{filterText()}{!data.can_cost ? " · El costo solo lo ve quien tiene «Ver costos»." : ""}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
