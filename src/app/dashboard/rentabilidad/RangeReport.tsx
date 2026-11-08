"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, FileText } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, Field } from "@/components/forms/Fields";
import { Sheet as FormSheet } from "@/components/forms/Sheet";
import { cop, downloadCsv, esc, rpcError } from "./shared";

/**
 * Informe por rango exacto (20261291): ventas, costo y ganancia desde una fecha y hora hasta otra
 * (ej.: del 12/10/2026 al mediodía al 30/10/2026 al final del día), por punto, día a día, productos y vendedores.
 */

type Pt = { point_id: string; name: string; kind: string | null; revenue: number; cost: number | null; profit: number | null; point_profit: number; bodega_profit: number | null; orders: number; units: number; expenses: number; no_cost_lines: number };
type Report = {
  ok: boolean; error?: string; from: string; to: string; can_see_costs: boolean;
  totals: { revenue: number; cost: number | null; profit: number | null; point_profit: number; bodega_profit: number | null; orders: number; units: number; expenses: number; no_cost_lines: number };
  points: Pt[];
  days: Array<{ day: string; revenue: number; profit: number | null; orders: number }>;
  products: Array<{ product_id: string; name: string; sku: string | null; qty: number; revenue: number; cost: number | null; profit: number | null }>;
  sellers: Array<{ seller: string; revenue: number; orders: number; units: number; profit: number | null }>;
};
type Point = { id: string; name: string };

const n = (v: unknown) => Number(v ?? 0);
const pad = (x: number) => String(x).padStart(2, "0");
/** «AAAA-MM-DDTHH:MM» en hora local. */
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOf = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x; };
const pctTxt = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %` : "—");
const nice = (v: string) => new Date(v).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function presets(): Array<[string, Date, Date]> {
  const now = new Date();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const mid = new Date(now.getFullYear(), now.getMonth(), 15);
  const week = new Date(now); week.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return [
    ["Hoy", startOf(now), now],
    ["Ayer", startOf(y), endOf(y)],
    ["Esta semana", startOf(week), now],
    ["Este mes", monthStart, now],
    ["1ª quincena", monthStart, endOf(mid)],
    ["2ª quincena", startOf(new Date(now.getFullYear(), now.getMonth(), 16)), endOf(new Date(now.getFullYear(), now.getMonth() + 1, 0))],
    ["Mes pasado", lastStart, endOf(lastEnd)],
  ];
}

export function RangeReportSheet({ storeId, points, onClose }: { storeId: string; points: Point[]; onClose: () => void }) {
  const [from, setFrom] = useState(() => local(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(() => local(new Date()));
  const [sel, setSel] = useState<string[]>([]);
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"points" | "days" | "products" | "sellers">("points");

  const run = useCallback(async () => {
    if (!from || !to) return;
    setBusy(true);
    // «Hasta» incluye el minuto escogido completo (23:59 = hasta el final del día).
    const end = new Date(new Date(to).getTime() + 60_000).toISOString();
    const { data, error } = await supabaseBrowser().rpc("erp_sales_range_report", { p_store: storeId, p_from: new Date(from).toISOString(), p_to: end, p_points: sel.length ? sel : null });
    setBusy(false);
    if (error) { setErr(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261291_informe_rango.sql." : rpcError(error)); setR(null); return; }
    const rep = data as Report;
    if (!rep?.ok) { setErr(rep?.error ?? "No se pudo."); setR(null); return; }
    setErr(null);
    setR(rep);
  }, [storeId, from, to, sel]);
  useEffect(() => { const t = window.setTimeout(() => void run(), 0); return () => window.clearTimeout(t); }, [run]);

  const costs = Boolean(r?.can_see_costs);
  const t = r?.totals;
  const net = t && t.profit !== null ? n(t.profit) - n(t.expenses) : null;
  const maxDay = useMemo(() => Math.max(1, ...(r?.days ?? []).map((d) => n(d.revenue))), [r]);
  const title = `Ventas del ${nice(from)} al ${nice(to)}`;

  function exportCsv() {
    if (!r) return;
    const head = ["Punto", "Ventas", ...(costs ? ["Costo", "Ganancia", "Margen"] : []), "Gana el punto", "Pedidos", "Unidades", "Ticket", "Gastos", ...(costs ? ["Ganancia neta"] : [])];
    const rows = r.points.map((p) => [p.name, n(p.revenue), ...(costs ? [n(p.cost), n(p.profit), pctTxt(n(p.profit), n(p.revenue))] : []), n(p.point_profit), p.orders, n(p.units),
      p.orders ? Math.round(n(p.revenue) / p.orders) : 0, n(p.expenses), ...(costs ? [n(p.profit) - n(p.expenses)] : [])]);
    downloadCsv(`ventas-${from.slice(0, 10)}-a-${to.slice(0, 10)}.csv`, head, rows, [`RemHub · ${title}`, `Generado: ${new Date().toLocaleString("es-CO")}`]);
  }
  function exportProducts() {
    if (!r) return;
    downloadCsv(`productos-${from.slice(0, 10)}-a-${to.slice(0, 10)}.csv`, ["Producto", "Código", "Unidades", "Ventas", ...(costs ? ["Costo", "Ganancia", "Margen"] : [])],
      r.products.map((p) => [p.name, p.sku ?? "", n(p.qty), n(p.revenue), ...(costs ? [n(p.cost), n(p.profit), pctTxt(n(p.profit), n(p.revenue))] : [])]), [`RemHub · ${title}`]);
  }
  function printPdf() {
    if (!r || !t) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const box = (k: string, v: string, s = "") => `<div class="box"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="m">${esc(s)}</div>` : ""}</div>`;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:11px}h1{font-size:17px;margin:0}h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid #111;margin:16px 0 6px;padding-bottom:3px}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.box{border:1px solid #ccc;border-radius:8px;padding:8px}.k{font-size:9px;color:#666;text-transform:uppercase;font-weight:700}.v{font-size:14px;font-weight:900}.m{color:#666}
      table{width:100%;border-collapse:collapse}th{text-align:left;font-size:9px;text-transform:uppercase;color:#555;border-bottom:1.5px solid #111;padding:4px}td{border-bottom:1px solid #e5e5e5;padding:3px 4px}.r{text-align:right;white-space:nowrap}
      @media print{@page{size:letter;margin:12mm}body{padding:0}tr{break-inside:avoid}}</style></head><body>
      <h1>${esc(title)}</h1><p class="m">Ventas confirmadas · costo al momento de vender · generado ${esc(new Date().toLocaleString("es-CO"))}</p>
      <h2>Resumen</h2><div class="grid">${box("Ventas", cop(t.revenue), `${t.orders} pedidos · ${n(t.units)} und.`)}${costs ? box("Costo", cop(t.cost)) + box("Ganancia", cop(t.profit), `margen ${pctTxt(n(t.profit), n(t.revenue))}`) : ""}${box("Gastos", cop(t.expenses))}${net !== null ? box("Ganancia neta", cop(net)) : ""}${box("Ticket promedio", cop(t.orders ? n(t.revenue) / t.orders : 0))}</div>
      <h2>Por punto</h2><table><thead><tr><th>Punto</th><th class="r">Ventas</th>${costs ? "<th class=r>Costo</th><th class=r>Ganancia</th><th class=r>Margen</th>" : ""}<th class="r">Pedidos</th><th class="r">Gastos</th></tr></thead><tbody>
      ${r.points.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${esc(cop(p.revenue))}</td>${costs ? `<td class="r">${esc(cop(p.cost))}</td><td class="r">${esc(cop(p.profit))}</td><td class="r">${esc(pctTxt(n(p.profit), n(p.revenue)))}</td>` : ""}<td class="r">${p.orders}</td><td class="r">${esc(cop(p.expenses))}</td></tr>`).join("")}</tbody></table>
      <h2>Día por día</h2><table><thead><tr><th>Día</th><th class="r">Ventas</th>${costs ? "<th class=r>Ganancia</th>" : ""}<th class="r">Pedidos</th></tr></thead><tbody>
      ${r.days.map((d) => `<tr><td>${esc(d.day.split("-").reverse().join("/"))}</td><td class="r">${esc(cop(d.revenue))}</td>${costs ? `<td class="r">${esc(cop(d.profit))}</td>` : ""}<td class="r">${d.orders}</td></tr>`).join("")}</tbody></table>
      <h2>Productos más vendidos</h2><table><thead><tr><th>Producto</th><th class="r">Und.</th><th class="r">Ventas</th>${costs ? "<th class=r>Ganancia</th>" : ""}</tr></thead><tbody>
      ${r.products.slice(0, 60).map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${n(p.qty)}</td><td class="r">${esc(cop(p.revenue))}</td>${costs ? `<td class="r">${esc(cop(p.profit))}</td>` : ""}</tr>`).join("")}</tbody></table>
      <h2>Por vendedor</h2><table><thead><tr><th>Vendedor</th><th class="r">Ventas</th><th class="r">Pedidos</th>${costs ? "<th class=r>Ganancia</th>" : ""}</tr></thead><tbody>
      ${r.sellers.map((s) => `<tr><td>${esc(s.seller)}</td><td class="r">${esc(cop(s.revenue))}</td><td class="r">${s.orders}</td>${costs ? `<td class="r">${esc(cop(s.profit))}</td>` : ""}</tr>`).join("")}</tbody></table>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  }

  const kpi = (label: string, value: string, sub?: string, color?: string) => (
    <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="font-black tabular-nums" style={{ color }}>{value}</p>
      {sub ? <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
    </div>
  );

  return (
    <FormSheet wide title="Informe por fechas y horas" subtitle="Ventas, costo y ganancia en cualquier rango exacto" icon={<CalendarClock size={18} />} onClose={onClose} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Ventas confirmadas · hora en que se confirmó · costo congelado al vender.</span>
        <button type="button" disabled={!r} onClick={exportCsv} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Excel puntos</button>
        <button type="button" disabled={!r} onClick={exportProducts} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Excel productos</button>
        <button type="button" disabled={!r} onClick={printPdf} className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}><FileText size={13} /> PDF</button>
      </>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Desde (fecha y hora)"><DateField withTime value={from} onChange={setFrom} /></Field>
        <Field label="Hasta (fecha y hora)" hint="23:59 = hasta el final de ese día."><DateField withTime value={to} onChange={setTo} /></Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets().map(([l, a, b]) => (
          <button key={l} type="button" onClick={() => { setFrom(local(a)); setTo(local(b)); }} className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{l}</button>
        ))}
      </div>
      {points.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setSel([])} className="rounded-full border px-3 py-1 text-xs font-bold" style={!sel.length ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>Todos los puntos</button>
          {points.map((p) => {
            const on = sel.includes(p.id);
            return <button key={p.id} type="button" onClick={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])} className="rounded-full border px-3 py-1 text-xs font-bold" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>📍 {p.name}</button>;
          })}
        </div>
      ) : null}

      {err ? <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{err}</p> : null}
      {busy && !r ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Calculando…</p> : null}

      {r && t ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {kpi("Ventas", cop(t.revenue), `${t.orders} pedidos · ${n(t.units).toLocaleString("es-CO")} und.`)}
            {costs ? kpi("Costo", cop(t.cost)) : null}
            {costs ? kpi("Ganancia", cop(t.profit), `margen ${pctTxt(n(t.profit), n(t.revenue))}`, n(t.profit) >= 0 ? "#10b981" : "#ef4444") : kpi("Gana el punto", cop(t.point_profit))}
            {kpi("Ticket promedio", cop(t.orders ? n(t.revenue) / t.orders : 0))}
            {kpi("Gastos del rango", cop(t.expenses), "Por fecha del gasto", n(t.expenses) ? "#ef4444" : undefined)}
            {net !== null ? kpi("Ganancia neta", cop(net), "Ganancia − gastos", net >= 0 ? "#10b981" : "#ef4444") : null}
            {costs ? kpi("Gana la bodega", cop(t.bodega_profit)) : null}
            {kpi("Gana el punto", cop(t.point_profit), "Venta − precio de bodega")}
          </div>
          {n(t.no_cost_lines) ? <p className="text-xs text-amber-500">⚠️ {t.no_cost_lines} línea(s) vendida(s) sin costo: la ganancia sale inflada.</p> : null}

          <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            {([["points", "Por punto"], ["days", "Día por día"], ["products", `Productos (${r.products.length})`], ["sellers", "Por vendedor"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full px-3 py-1.5" style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{l}</button>
            ))}
          </div>

          {tab === "points" ? (
            <Table head={["Punto", "Ventas", ...(costs ? ["Costo", "Ganancia", "Margen"] : ["Gana el punto"]), "Pedidos", "Ticket", "Gastos", ...(costs ? ["Neta"] : [])]}
              rows={r.points.map((p) => [p.name, cop(p.revenue), ...(costs ? [cop(p.cost), cop(p.profit), pctTxt(n(p.profit), n(p.revenue))] : [cop(p.point_profit)]), String(p.orders),
                cop(p.orders ? n(p.revenue) / p.orders : 0), cop(p.expenses), ...(costs ? [cop(n(p.profit) - n(p.expenses))] : [])])} />
          ) : null}
          {tab === "days" ? (
            <div className="space-y-1">
              {r.days.length ? r.days.map((d) => (
                <div key={d.day} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 tabular-nums">{d.day.split("-").reverse().join("/")}</span>
                  <span className="h-4 rounded" style={{ width: `${Math.max(2, (n(d.revenue) / maxDay) * 100)}%`, background: "var(--t-accent)" }} />
                  <span className="shrink-0 tabular-nums font-bold">{cop(d.revenue)}</span>
                  {costs ? <span className="shrink-0 tabular-nums" style={{ color: n(d.profit) >= 0 ? "#10b981" : "#ef4444" }}>{cop(d.profit)}</span> : null}
                  <span className="shrink-0" style={{ color: "var(--t-muted)" }}>· {d.orders} ped.</span>
                </div>
              )) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>No hubo ventas en ese rango.</p>}
            </div>
          ) : null}
          {tab === "products" ? (
            <Table head={["Producto", "Und.", "Ventas", ...(costs ? ["Costo", "Ganancia", "Margen"] : [])]}
              rows={r.products.map((p) => [p.name, String(n(p.qty)), cop(p.revenue), ...(costs ? [cop(p.cost), cop(p.profit), pctTxt(n(p.profit), n(p.revenue))] : [])])}
              negativeCol={costs ? 4 : -1} />
          ) : null}
          {tab === "sellers" ? (
            <Table head={["Vendedor", "Ventas", "Pedidos", "Unidades", ...(costs ? ["Ganancia"] : [])]}
              rows={r.sellers.map((s) => [s.seller, cop(s.revenue), String(s.orders), String(n(s.units)), ...(costs ? [cop(s.profit)] : [])])} />
          ) : null}
        </>
      ) : null}
    </FormSheet>
  );
}

function Table({ head, rows, negativeCol = -1 }: { head: string[]; rows: string[][]; negativeCol?: number }) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <table className="w-full min-w-[560px] text-xs">
        <thead style={{ color: "var(--t-muted)" }}><tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
              {r.map((c, i) => <td key={i} className={`px-3 py-1.5 ${i ? "text-right tabular-nums" : "font-semibold"}`} style={i === negativeCol && c.includes("-") ? { color: "#ef4444" } : undefined}>{c}</td>)}
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={head.length} className="px-3 py-6 text-center" style={{ color: "var(--t-muted)" }}>Sin datos en ese rango.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
