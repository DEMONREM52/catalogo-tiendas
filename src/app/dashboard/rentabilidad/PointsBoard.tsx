"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PointValuationModal } from "@/app/dashboard/inventario/PointValuation";
import { cardStyle, cop, downloadCsv } from "./shared";

/**
 * Tablero de puntos: cómo le va a cada punto mes a mes (ventas, ganancia, gastos, ganancia neta), frente al periodo anterior,
 * con semáforo y recomendaciones para decidir a cuál apoyar, cuál vigilar y cuál revisar. Todo se ajusta y se guarda por usuario.
 * Necesita 20261209_tablero_puntos.sql.
 */

type Month = {
  m: string; revenue: number; cost: number | null; profit: number | null; point_profit: number; bodega_profit: number | null;
  orders: number; units: number; no_cost_lines: number; expenses: number; payroll: number;
  charged: number; charged_cost: number | null; credited: number; losses: number | null; paid: number;
};
type PointData = {
  point_id: string; name: string; kind: string | null; is_default: boolean; credit: boolean;
  debt: { balance: number; overdue: number; overdue_days: number | null; in_transit: number } | null;
  stock: { units: number; cost: number | null; internal: number };
  months: Month[];
};
type Board = { ok: boolean; error?: string; today: string; months: number; can_see_costs: boolean; points: PointData[] };

type Period = "month" | "last" | "3" | "6" | "12";
type Prefs = {
  period: Period;
  basis: "total" | "point";
  expenses: boolean;
  payroll: boolean;
  warehouses: boolean;
  sort: "net" | "revenue" | "growth" | "margin" | "debt";
  view: "cards" | "table";
  minMargin: number;
  lossMonths: number;
  dropPct: number;
  growthSupport: number;
  overdueDays: number;
  slowDays: number;
};
const DEFAULTS: Prefs = {
  period: "last", basis: "total", expenses: true, payroll: true, warehouses: false, sort: "net", view: "cards",
  minMargin: 10, lossMonths: 2, dropPct: 25, growthSupport: 15, overdueDays: 30, slowDays: 120,
};
const PERIODS: Array<[Period, string, number]> = [["month", "Este mes", 1], ["last", "Mes pasado", 1], ["3", "Últimos 3 meses", 3], ["6", "Últimos 6 meses", 6], ["12", "Último año", 12]];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLabel = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${MONTHS_ES[m - 1]} ${String(y).slice(2)}`; };
const pctTxt = (v: number | null, sign = false) => (v === null || !Number.isFinite(v) ? "—" : `${sign && v > 0 ? "+" : ""}${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`);
const growth = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? null : 0);

type Agg = { revenue: number; profit: number | null; base: number | null; expenses: number; payroll: number; net: number | null; orders: number; units: number; cost: number | null; charged: number; paid: number; noCost: number; days: number };
type Status = { key: "close" | "loss" | "watch" | "good" | "idle"; label: string; color: string; reasons: string[]; support: boolean };
type Row = { p: PointData; cur: Agg; prev: Agg; growth: number | null; margin: number | null; ticket: number | null; invDays: number | null; streak: number; status: Status; series: Array<{ m: string; net: number | null; revenue: number }> };

function readPrefs(key: string): Prefs {
  try { return { ...DEFAULTS, ...(JSON.parse(window.localStorage.getItem(key) ?? "{}") as Partial<Prefs>) }; } catch { return DEFAULTS; }
}

export function PointsBoard({ storeId }: { storeId: string }) {
  const prefsKey = `remhub:points-board:v1:${storeId}`;
  // La pestaña solo se pinta en el navegador (después de revisar permisos), así que se puede leer lo guardado al iniciar.
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(prefsKey));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cfg, setCfg] = useState(false);
  const [valuation, setValuation] = useState<PointData | null>(null);

  useEffect(() => { try { window.localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } }, [prefs, prefsKey]);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((cur) => ({ ...cur, [k]: v }));

  const span = PERIODS.find(([k]) => k === prefs.period)?.[2] ?? 1;
  // Meses que hacen falta: el periodo, el anterior para comparar y 1 de margen («mes pasado»), mínimo 6 para la tendencia.
  const need = Math.min(24, Math.max(6, span * 2 + (prefs.period === "last" ? 1 : 0)));
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_points_dashboard", { p_store: storeId, p_months: need }).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261209_tablero_puntos.sql." : e.message);
      const b = data as Board;
      if (!b?.ok) return setError(b?.error ?? "No se pudo cargar el tablero.");
      setError(null);
      setBoard(b);
    });
    return () => { alive = false; };
  }, [storeId, need]);

  const costs = Boolean(board?.can_see_costs);
  const rows = useMemo<Row[]>(() => {
    if (!board) return [];
    const today = new Date(`${board.today}T12:00:00`);
    const agg = (ms: Month[], partialLast: boolean): Agg => {
      const sum = (f: (m: Month) => number | null) => ms.reduce((a, m) => a + Number(f(m) ?? 0), 0);
      const profit = costs ? sum((m) => m.profit) : null;
      const base = prefs.basis === "point" ? sum((m) => m.point_profit) : profit;
      const expenses = prefs.expenses ? sum((m) => m.expenses) : 0;
      const payroll = prefs.payroll ? sum((m) => m.payroll) : 0;
      const days = ms.reduce((a, m, i) => {
        const d = new Date(`${m.m}T12:00:00`);
        const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return a + (partialLast && i === ms.length - 1 ? today.getDate() : dim);
      }, 0);
      return {
        revenue: sum((m) => m.revenue), profit, base, expenses, payroll, net: base === null ? null : base - expenses - payroll,
        orders: sum((m) => m.orders), units: sum((m) => m.units), cost: costs ? sum((m) => m.cost) : null,
        charged: sum((m) => m.charged), paid: sum((m) => m.paid), noCost: sum((m) => m.no_cost_lines), days: Math.max(1, days),
      };
    };
    return board.points
      .filter((p) => prefs.warehouses || p.kind === "point")
      .map((p) => {
        const ms = p.months;
        const end = prefs.period === "last" ? ms.length - 1 : ms.length; // «mes pasado» deja fuera el mes en curso
        const curM = ms.slice(Math.max(0, end - span), end);
        const prevM = ms.slice(Math.max(0, end - span * 2), Math.max(0, end - span));
        const partial = end === ms.length;
        const cur = agg(curM, partial);
        const prev = agg(prevM, false);
        const netOf = (m: Month) => {
          const a = agg([m], false);
          return a.net;
        };
        const series = ms.map((m) => ({ m: m.m, net: netOf(m), revenue: Number(m.revenue) }));
        // Meses seguidos en pérdida (hasta el final del periodo).
        let streak = 0;
        for (let i = end - 1; i >= 0; i--) {
          const v = series[i].net;
          if (v !== null && v < 0) streak++;
          else break;
        }
        const g = growth(cur.revenue, prev.revenue);
        const margin = cur.net !== null && cur.revenue > 0 ? (cur.net / cur.revenue) * 100 : null;
        const costPerDay = cur.cost !== null ? cur.cost / cur.days : null;
        const invDays = costPerDay && costPerDay > 0 && p.stock.cost !== null ? Math.round(Number(p.stock.cost) / costPerDay) : null;
        const reasons: string[] = [];
        let key: Status["key"] = "good";
        if (cur.revenue <= 0 && Number(p.stock.units) <= 0) key = "idle";
        else if (cur.net !== null && cur.net < 0 && streak >= prefs.lossMonths) {
          key = "close";
          reasons.push(`Pierde dinero hace ${streak} mes(es) seguidos (${cop(cur.net)} en el periodo). Revisa arriendo, nómina y precios; si no mejora, evalúa cerrarlo o mover su mercancía.`);
        } else if (cur.net !== null && cur.net < 0) {
          key = "loss";
          reasons.push(`En este periodo no alcanza a cubrir sus gastos (${cop(cur.net)}).`);
        }
        if (key === "good" || key === "loss") {
          if (margin !== null && margin < prefs.minMargin && cur.revenue > 0 && key === "good") { key = "watch"; reasons.push(`Margen neto bajo: ${pctTxt(margin)} (tu meta es ${prefs.minMargin} %). Revisa la regla de precio del punto o sus gastos.`); }
          if (g !== null && g <= -prefs.dropPct) { if (key === "good") key = "watch"; reasons.push(`Las ventas cayeron ${pctTxt(-g)} frente al periodo anterior.`); }
        }
        if (p.debt && Number(p.debt.overdue) > 0 && Number(p.debt.overdue_days ?? 0) >= prefs.overdueDays) {
          if (key === "good") key = "watch";
          reasons.push(`Le debe ${cop(p.debt.overdue)} vencido a la bodega hace ${p.debt.overdue_days} días.`);
        }
        if (invDays !== null && invDays > prefs.slowDays) reasons.push(`Tiene mercancía para unos ${invDays} días: rota lento. Pasa parte a un punto que venda más.`);
        if (cur.noCost > 0) reasons.push(`${cur.noCost} venta(s) de productos sin costo: la ganancia puede estar inflada.`);
        const support = (key === "good" || key === "watch") && cur.net !== null && cur.net > 0 && g !== null && g >= prefs.growthSupport;
        if (support) reasons.unshift(`Creció ${pctTxt(g)} y gana dinero: apóyalo con más mercancía, surtido o publicidad.`);
        if (key === "good" && !reasons.length) reasons.push("Gana dinero, con buen margen y ventas estables.");
        if (key === "idle") reasons.push("Sin ventas ni mercancía en el periodo.");
        const status: Status = {
          key, support, reasons,
          label: key === "close" ? "🔴 Revisar / evaluar cierre" : key === "loss" ? "🟠 En pérdida" : key === "watch" ? "🟡 Vigilar" : key === "idle" ? "⚪ Sin movimiento" : "🟢 Va bien",
          color: key === "close" ? "#ef4444" : key === "loss" ? "#f97316" : key === "watch" ? "#f59e0b" : key === "idle" ? "#94a3b8" : "#10b981",
        };
        return { p, cur, prev, growth: g, margin, ticket: cur.orders > 0 ? cur.revenue / cur.orders : null, invDays, streak, status, series };
      })
      .sort((a, b) => {
        const by: Record<Prefs["sort"], number> = {
          net: Number(b.cur.net ?? -Infinity) - Number(a.cur.net ?? -Infinity),
          revenue: b.cur.revenue - a.cur.revenue,
          growth: Number(b.growth ?? -Infinity) - Number(a.growth ?? -Infinity),
          margin: Number(b.margin ?? -Infinity) - Number(a.margin ?? -Infinity),
          debt: Number(b.p.debt?.balance ?? 0) - Number(a.p.debt?.balance ?? 0),
        };
        return by[prefs.sort] || a.p.name.localeCompare(b.p.name);
      });
  }, [board, prefs, span, costs]);

  const total = useMemo(() => {
    const t = (f: (r: Row) => number | null) => rows.reduce((a, r) => a + Number(f(r) ?? 0), 0);
    return {
      revenue: t((r) => r.cur.revenue), prevRevenue: t((r) => r.prev.revenue),
      net: costs || prefs.basis === "point" ? t((r) => r.cur.net) : null, prevNet: costs || prefs.basis === "point" ? t((r) => r.prev.net) : null,
      base: costs || prefs.basis === "point" ? t((r) => r.cur.base) : null,
      spend: t((r) => r.cur.expenses + r.cur.payroll), debt: t((r) => r.p.debt?.balance ?? 0), overdue: t((r) => r.p.debt?.overdue ?? 0),
      stock: costs ? t((r) => r.p.stock.cost) : null,
    };
  }, [rows, costs, prefs.basis]);

  // Tendencia de todos los puntos juntos (ventas y ganancia neta por mes).
  const trend = useMemo(() => {
    if (!rows.length) return [];
    return rows[0].series.map((_, i) => ({
      m: rows[0].series[i].m,
      revenue: rows.reduce((a, r) => a + r.series[i].revenue, 0),
      net: rows.every((r) => r.series[i].net === null) ? null : rows.reduce((a, r) => a + Number(r.series[i].net ?? 0), 0),
    }));
  }, [rows]);

  function exportCsv() {
    const label = PERIODS.find(([k]) => k === prefs.period)?.[1] ?? "";
    downloadCsv(`puntos-${board?.today ?? ""}.csv`,
      ["Punto", "Estado", "Ventas", "Ventas periodo anterior", "Crecimiento %", "Ganancia", "Gastos", "Nómina", "Ganancia neta", "Margen neto %", "Pedidos", "Ticket promedio", "Deuda bodega", "Vencido", "Inventario a costo", "Días de inventario", "Recomendación"],
      rows.map((r) => [r.p.name, r.status.label.replace(/^\S+\s/, ""), Math.round(r.cur.revenue), Math.round(r.prev.revenue), r.growth === null ? "" : r.growth.toFixed(1),
        r.cur.base === null ? "" : Math.round(r.cur.base), Math.round(r.cur.expenses), Math.round(r.cur.payroll), r.cur.net === null ? "" : Math.round(r.cur.net),
        r.margin === null ? "" : r.margin.toFixed(1), r.cur.orders, r.ticket === null ? "" : Math.round(r.ticket), Math.round(Number(r.p.debt?.balance ?? 0)),
        Math.round(Number(r.p.debt?.overdue ?? 0)), r.p.stock.cost === null ? "" : Math.round(Number(r.p.stock.cost)), r.invDays ?? "", r.status.reasons.join(" | ")]),
      [`Tablero de puntos · ${label}`, `Ganancia: ${prefs.basis === "point" ? "solo la del punto" : "total del negocio (venta − costo)"}${prefs.expenses ? " − gastos" : ""}${prefs.payroll ? " − nómina" : ""}`]);
  }

  if (error) return <p className="rounded-2xl border p-4 text-sm" style={{ ...cardStyle, color: "#ef4444" }}>{error}</p>;
  if (!board) return <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando el tablero de puntos…</p>;

  const chip = (on: boolean) => (on
    ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" }
    : { borderColor: "var(--t-card-border)", color: "var(--t-text)" });
  const counts = rows.reduce((a, r) => ({ ...a, [r.status.key]: (a[r.status.key] ?? 0) + 1 }), {} as Record<string, number>);
  const tg = growth(total.revenue, total.prevRevenue);

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="rounded-2xl border p-3" style={cardStyle}>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={chip(prefs.period === k)} onClick={() => set("period", k)}>{label}</button>
          ))}
          <span className="mx-1 h-5 w-px" style={{ background: "var(--t-card-border)" }} />
          <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={chip(prefs.view === "cards")} onClick={() => set("view", "cards")}>▦ Tarjetas</button>
          <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={chip(prefs.view === "table")} onClick={() => set("view", "table")}>☰ Tabla</button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={chip(cfg)} onClick={() => setCfg((v) => !v)}>⚙️ Personalizar</button>
            <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={chip(false)} onClick={exportCsv}>⬇️ Exportar</button>
          </div>
        </div>
        {cfg ? (
          <div className="mt-3 grid gap-3 border-t pt-3 text-xs md:grid-cols-2" style={{ borderColor: "var(--t-card-border)" }}>
            <div className="space-y-2">
              <p className="font-bold">Cómo se calcula la ganancia</p>
              <label className="flex items-center gap-2"><input type="radio" checked={prefs.basis === "total"} onChange={() => set("basis", "total")} disabled={!costs} /> Total del negocio (venta − costo real){!costs ? " · necesitas «Ver costos»" : ""}</label>
              <label className="flex items-center gap-2"><input type="radio" checked={prefs.basis === "point"} onChange={() => set("basis", "point")} /> Solo lo que gana el punto (venta − precio de bodega)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.expenses} onChange={(e) => set("expenses", e.target.checked)} /> Restar gastos del punto (arriendo, servicios…)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.payroll} onChange={(e) => set("payroll", e.target.checked)} /> Restar nómina del punto</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.warehouses} onChange={(e) => set("warehouses", e.target.checked)} /> Mostrar también las bodegas</label>
              <label className="flex items-center gap-2">Ordenar por
                <select className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} value={prefs.sort} onChange={(e) => set("sort", e.target.value as Prefs["sort"])}>
                  <option value="net">Ganancia neta</option><option value="revenue">Ventas</option><option value="growth">Crecimiento</option><option value="margin">Margen</option><option value="debt">Deuda con la bodega</option>
                </select>
              </label>
            </div>
            <div className="space-y-2">
              <p className="font-bold">Reglas del semáforo</p>
              {([
                ["minMargin", "Margen neto mínimo (%)", "Por debajo queda en 🟡 Vigilar"],
                ["lossMonths", "Meses seguidos en pérdida para 🔴", "Cuántos meses perdiendo antes de sugerir revisar o cerrar"],
                ["dropPct", "Caída de ventas que preocupa (%)", "Frente al periodo anterior"],
                ["growthSupport", "Crecimiento para 🚀 apoyar (%)", "Si gana y crece al menos esto"],
                ["overdueDays", "Días de deuda vencida que preocupan", "Deuda con la bodega"],
                ["slowDays", "Días de inventario que es «lento»", "Mercancía / costo vendido por día"],
              ] as Array<[keyof Prefs, string, string]>).map(([k, label, hint]) => (
                <label key={k} className="flex items-center justify-between gap-2" title={hint}>
                  <span>{label}</span>
                  <input type="number" min={0} className="w-20 rounded-lg border px-2 py-1 text-right" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
                    value={Number(prefs[k])} onChange={(e) => set(k, Math.max(0, Number(e.target.value) || 0) as never)} />
                </label>
              ))}
              <button type="button" className="font-bold" style={{ color: "var(--t-accent)" }} onClick={() => setPrefs(DEFAULTS)}>Volver a los valores de fábrica</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Ventas" value={cop(total.revenue)} delta={tg} sub={`Antes ${cop(total.prevRevenue)}`} />
        <Kpi label="Ganancia neta" value={total.net === null ? "🔒" : cop(total.net)} delta={total.net !== null && total.prevNet ? ((total.net - total.prevNet) / Math.abs(total.prevNet)) * 100 : null}
          sub={total.net === null ? "Necesitas «Ver costos»" : `Ganancia ${cop(total.base)} − gastos ${cop(total.spend)}`} bad={(total.net ?? 0) < 0} />
        <Kpi label="Deuda de los puntos" value={cop(total.debt)} sub={total.overdue > 0 ? `Vencido ${cop(total.overdue)}` : "Nada vencido"} bad={total.overdue > 0} />
        <Kpi label="Mercancía en puntos" value={total.stock === null ? "🔒" : cop(total.stock)} sub="A costo real" />
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {([["good", "🟢 Van bien"], ["watch", "🟡 Vigilar"], ["loss", "🟠 En pérdida"], ["close", "🔴 Revisar"], ["idle", "⚪ Sin movimiento"]] as const).map(([k, l]) => (
          counts[k] ? <span key={k} className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{l}: {counts[k]}</span> : null
        ))}
        {rows.some((r) => r.status.support) ? <span className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>🚀 Para apoyar: {rows.filter((r) => r.status.support).length}</span> : null}
      </div>

      {trend.length > 1 ? <TrendChart data={trend} /> : null}

      {rows.length === 0 ? <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>No hay puntos para mostrar.</p> : prefs.view === "table" ? (
        <div className="overflow-x-auto rounded-2xl border" style={cardStyle}>
          <table className="w-full min-w-[900px] text-xs">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>{["Punto", "Estado", "Ventas", "vs antes", "Ganancia neta", "Margen", "Pedidos", "Ticket", "Deuda", "Vencido", "Inventario", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.point_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="px-3 py-2 font-bold">{r.p.name}</td>
                  <td className="px-3 py-2" style={{ color: r.status.color }}>{r.status.label}{r.status.support ? " · 🚀" : ""}</td>
                  <td className="px-3 py-2 tabular-nums">{cop(r.cur.revenue)}</td>
                  <td className="px-3 py-2 tabular-nums"><Delta v={r.growth} /></td>
                  <td className="px-3 py-2 font-bold tabular-nums" style={{ color: (r.cur.net ?? 0) < 0 ? "#ef4444" : undefined }}>{r.cur.net === null ? "🔒" : cop(r.cur.net)}</td>
                  <td className="px-3 py-2 tabular-nums">{pctTxt(r.margin)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.cur.orders}</td>
                  <td className="px-3 py-2 tabular-nums">{r.ticket === null ? "—" : cop(Math.round(r.ticket))}</td>
                  <td className="px-3 py-2 tabular-nums">{r.p.debt ? cop(r.p.debt.balance) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: Number(r.p.debt?.overdue ?? 0) > 0 ? "#ef4444" : undefined }}>{r.p.debt ? cop(r.p.debt.overdue) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{r.p.stock.cost === null ? `${r.p.stock.units} und.` : cop(r.p.stock.cost)}</td>
                  <td className="px-3 py-2"><button type="button" className="font-bold" style={{ color: "var(--t-accent)" }} onClick={() => setValuation(r.p)}>📊</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <PointCard key={r.p.point_id} r={r} open={open === r.p.point_id} onToggle={() => setOpen((v) => (v === r.p.point_id ? null : r.p.point_id))} onValuation={() => setValuation(r.p)} prefs={prefs} />
          ))}
        </div>
      )}

      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
        Ventas confirmadas de cada punto. «Ganancia neta» = {prefs.basis === "point" ? "lo que gana el punto (venta − precio de bodega)" : "venta − costo real"}{prefs.expenses ? " − gastos" : ""}{prefs.payroll ? " − nómina" : ""}.
        {prefs.period === "month" ? " El mes en curso va incompleto: compáralo con cuidado." : ""} Tus ajustes se guardan en este equipo.
      </p>

      <AnimatePresence>
        {valuation ? <PointValuationModal key="val" storeId={storeId} pointId={valuation.point_id} pointName={valuation.name} onClose={() => setValuation(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: "var(--t-muted)" }}>nuevo</span>;
  const color = v > 0 ? "#10b981" : v < 0 ? "#ef4444" : "var(--t-muted)";
  return <span className="font-bold" style={{ color }}>{v > 0 ? "▲" : v < 0 ? "▼" : "="} {pctTxt(Math.abs(v))}</span>;
}

function Kpi({ label, value, sub, delta, bad }: { label: string; value: string; sub?: string; delta?: number | null; bad?: boolean }) {
  return (
    <div className="rounded-2xl border p-3" style={cardStyle}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums" style={bad ? { color: "#ef4444" } : undefined}>{value}</p>
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{delta !== undefined ? <><Delta v={delta} /> · </> : null}{sub}</p>
    </div>
  );
}

/** Barras de ventas y ganancia neta por mes de todos los puntos. */
function TrendChart({ data }: { data: Array<{ m: string; revenue: number; net: number | null }> }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, Math.abs(d.net ?? 0))));
  const H = 120;
  return (
    <div className="rounded-2xl border p-3" style={cardStyle}>
      <p className="mb-2 text-xs font-bold">📈 Tendencia de todos los puntos <span className="font-normal" style={{ color: "var(--t-muted)" }}>· ventas <span style={{ color: "#3987e5" }}>■</span> y ganancia neta <span style={{ color: "#10b981" }}>■</span></span></p>
      <div className="flex items-end gap-2 overflow-x-auto" style={{ height: H + 34 }}>
        {data.map((d) => {
          const net = d.net ?? 0;
          return (
            <div key={d.m} className="flex min-w-[42px] flex-1 flex-col items-center" title={`${monthLabel(d.m)}: ventas ${cop(d.revenue)} · neta ${d.net === null ? "—" : cop(net)}`}>
              <div className="flex w-full items-end justify-center gap-1" style={{ height: H }}>
                <div className="w-1/3 rounded-t" style={{ height: `${(d.revenue / max) * H}px`, background: "#3987e5" }} />
                <div className="w-1/3 rounded-t" style={{ height: `${(Math.abs(net) / max) * H}px`, background: net < 0 ? "#ef4444" : "#10b981" }} />
              </div>
              <span className="mt-1 text-[10px]" style={{ color: "var(--t-muted)" }}>{monthLabel(d.m)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PointCard({ r, open, onToggle, onValuation, prefs }: { r: Row; open: boolean; onToggle: () => void; onValuation: () => void; prefs: Prefs }) {
  const { p, cur, prev } = r;
  const maxAbs = Math.max(1, ...r.series.map((s) => Math.abs(s.net ?? 0)));
  return (
    <div className="rounded-2xl border p-4" style={{ ...cardStyle, borderColor: `color-mix(in oklab, ${r.status.color} 45%, var(--t-card-border))` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-black">{p.kind === "point" ? "📍" : "🏬"} {p.name}</p>
          <p className="text-xs font-bold" style={{ color: r.status.color }}>{r.status.label}{r.status.support ? " · 🚀 Apoyar" : ""}</p>
        </div>
        {/* Ganancia neta mes a mes */}
        <div className="flex h-10 items-center gap-0.5" title="Ganancia neta por mes">
          {r.series.map((s) => {
            const v = s.net ?? 0;
            const h = Math.max(2, (Math.abs(v) / maxAbs) * 18);
            return (
              <div key={s.m} className="flex h-10 w-1.5 flex-col justify-center" title={`${monthLabel(s.m)}: ${s.net === null ? "—" : cop(v)}`}>
                <div style={{ height: 20, display: "flex", alignItems: "flex-end" }}>{v > 0 ? <div className="w-1.5 rounded-sm" style={{ height: h, background: "#10b981" }} /> : null}</div>
                <div style={{ height: 20 }}>{v < 0 ? <div className="w-1.5 rounded-sm" style={{ height: h, background: "#ef4444" }} /> : null}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Mini label="Ventas" value={cop(cur.revenue)} extra={<Delta v={r.growth} />} />
        <Mini label="Ganancia neta" value={cur.net === null ? "🔒" : cop(cur.net)} bad={(cur.net ?? 0) < 0}
          extra={cur.net !== null && prev.net !== null ? <span style={{ color: "var(--t-muted)" }}>antes {cop(prev.net)}</span> : null} />
        <Mini label="Margen neto" value={pctTxt(r.margin)} bad={r.margin !== null && r.margin < prefs.minMargin} />
        <Mini label="Pedidos · ticket" value={`${cur.orders} · ${r.ticket === null ? "—" : cop(Math.round(r.ticket))}`} />
        {p.debt ? <Mini label="Debe a la bodega" value={cop(p.debt.balance)} bad={Number(p.debt.overdue) > 0} extra={Number(p.debt.overdue) > 0 ? <span style={{ color: "#ef4444" }}>vencido {cop(p.debt.overdue)}</span> : <span style={{ color: "var(--t-muted)" }}>al día</span>} /> : null}
        <Mini label="Mercancía" value={p.stock.cost === null ? `${p.stock.units} und.` : cop(p.stock.cost)} extra={r.invDays !== null ? <span style={{ color: "var(--t-muted)" }}>≈ {r.invDays} días</span> : null} />
      </div>

      <ul className="mt-3 space-y-1 text-xs">
        {r.status.reasons.slice(0, open ? 10 : 2).map((t, i) => <li key={i}>• {t}</li>)}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button type="button" className="rounded-xl border px-3 py-1.5 font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={onToggle}>{open ? "▲ Menos" : "▼ Mes a mes"}</button>
        <button type="button" className="rounded-xl border px-3 py-1.5 font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={onValuation}>📊 Liquidación</button>
      </div>

      {open ? (
        <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[520px] text-[11px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>{["Mes", "Ventas", "Ganancia", "Gastos", "Nómina", "Neta", "Pedidos", "Trasladado", "Abonó"].map((h) => <th key={h} className="px-2 py-1.5 text-right first:text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...p.months].reverse().map((m) => {
                const base = prefs.basis === "point" ? Number(m.point_profit) : m.profit === null ? null : Number(m.profit);
                const net = base === null ? null : base - (prefs.expenses ? Number(m.expenses) : 0) - (prefs.payroll ? Number(m.payroll) : 0);
                return (
                  <tr key={m.m} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className="px-2 py-1 font-semibold">{monthLabel(m.m)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cop(m.revenue)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{base === null ? "🔒" : cop(base)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cop(m.expenses)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cop(m.payroll)}</td>
                    <td className="px-2 py-1 text-right font-bold tabular-nums" style={{ color: (net ?? 0) < 0 ? "#ef4444" : undefined }}>{net === null ? "🔒" : cop(net)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{m.orders}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cop(m.charged)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cop(m.paid)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Mini({ label, value, extra, bad }: { label: string; value: string; extra?: React.ReactNode; bad?: boolean }) {
  return (
    <div className="rounded-xl border px-2.5 py-1.5" style={{ borderColor: "var(--t-card-border)" }}>
      <p style={{ color: "var(--t-muted)" }}>{label}</p>
      <b className="tabular-nums" style={bad ? { color: "#ef4444" } : undefined}>{value}</b>
      {extra ? <span className="block text-[10px]">{extra}</span> : null}
    </div>
  );
}
