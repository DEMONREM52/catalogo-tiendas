"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { Stat, cardStyle, cop, downloadCsv, inputStyle, margin, markup, pctText, rpcError, type Point } from "./shared";
import { ExportGate } from "@/components/ExportGate";
import { logExport } from "@/lib/permission-runtime";

type Kpis = { revenue: number; cost: number; profit: number; mother: number; point: number; orders: number; units: number; lines: number; lines_estimated: number; lines_loss: number };
type ByPoint = { point_id: string | null; name: string; revenue: number; cost: number; profit: number; mother: number; point: number; orders: number };
type Prod = { product_id: string; name: string; units: number; revenue: number; cost: number; profit: number; estimated: boolean };
type Report = {
  kpis: Kpis;
  by_point: ByPoint[];
  products: Prod[];
  guard: { mode: string; mismatches: number; recent: Array<{ created_at: string; price: number; allowed: number[]; blocked: boolean; name: string | null; receipt_no: number | null }> };
  capture_errors: number;
};

const PERIODS = [
  { key: "today", label: "Hoy" },
  { key: "7", label: "7 días" },
  { key: "30", label: "30 días" },
  { key: "month", label: "Este mes" },
  { key: "prev", label: "Mes anterior" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function range(k: PeriodKey): [Date, Date] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  if (k === "today") return [start, end];
  if (k === "7" || k === "30") return [new Date(end.getTime() - Number(k) * 86400000), end];
  if (k === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), end];
  return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
}

const n = (v: unknown) => Number(v ?? 0);

/** Informe de rentabilidad: ventas netas, costo de lo vendido, ganancia y partes de la madre y los puntos. */
export function Summary({ storeId, points, myPoints }: { storeId: string; points: Point[]; myPoints: string[] | null }) {
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [pointId, setPointId] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"profit" | "margin" | "loss">("profit");
  const visiblePoints = myPoints ? points.filter((p) => myPoints.includes(p.id)) : points;

  const load = useCallback(async () => {
    setLoading(true);
    const [from, to] = range(period);
    const { data: res, error: err } = await supabaseBrowser().rpc("erp_profit_summary", { p_store: storeId, p_from: from.toISOString(), p_to: to.toISOString(), p_point: pointId || null });
    setLoading(false);
    if (err) return setError(rpcError(err));
    setError(null);
    setData(res as Report);
  }, [storeId, period, pointId]);
  useEffect(() => {
    // Se carga al abrir y cada vez que cambian los filtros.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const products = useMemo(() => {
    const list = (data?.products ?? []).map((p) => ({ ...p, revenue: n(p.revenue), cost: n(p.cost), profit: n(p.profit), units: n(p.units) }));
    const filtered = q.trim() ? smartFilter(list, q, (p) => p.name ?? "") : list;
    if (sort === "loss") return filtered.filter((p) => p.profit < 0).sort((a, b) => a.profit - b.profit);
    if (sort === "margin") return [...filtered].sort((a, b) => (margin(a.revenue, a.cost) ?? -999) - (margin(b.revenue, b.cost) ?? -999));
    return [...filtered].sort((a, b) => b.profit - a.profit);
  }, [data, q, sort]);

  const k = data?.kpis;
  const rev = n(k?.revenue), cost = n(k?.cost), profit = n(k?.profit);
  const maxPoint = Math.max(1, ...(data?.by_point ?? []).map((p) => Math.abs(n(p.revenue))));
  const [from, to] = range(period);
  const periodText = `${from.toLocaleDateString("es-CO")} – ${new Date(to.getTime() - 1).toLocaleDateString("es-CO")}`;

  function exportCsv() {
    if (!data) return;
    logExport("rentabilidad", 1, { period: periodText });
    const notes = [
      "RemHub · Informe de rentabilidad",
      `Periodo: ${periodText}`,
      `Punto: ${pointId ? (points.find((p) => p.id === pointId)?.name ?? pointId) : myPoints ? "Mis puntos" : "Todos"}`,
      `Generado: ${new Date().toLocaleString("es-CO")}`,
      "Venta neta = cantidad × precio vendido. Costo = costo guardado al vender (o costo actual si la venta es anterior: «estimado»).",
      "Incremento sobre costo = (venta − costo) / costo. Margen sobre venta = (venta − costo) / venta.",
    ];
    downloadCsv(
      `rentabilidad-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Producto", "Unidades", "Venta neta", "Costo", "Ganancia", "Incremento sobre costo %", "Margen sobre venta %", "Costo estimado"],
      products.map((p) => [p.name ?? "", p.units, p.revenue, p.cost, p.profit, markup(p.revenue, p.cost)?.toFixed(2) ?? "", margin(p.revenue, p.cost)?.toFixed(2) ?? "", p.estimated ? "sí" : "no"]),
      notes,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold [scrollbar-width:none]" style={{ borderColor: "var(--t-card-border)" }}>
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} className="shrink-0 rounded-full px-3 py-1.5" style={period === p.key ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
              {p.label}
            </button>
          ))}
        </div>
        {visiblePoints.length > 1 || !myPoints ? (
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className="rounded-full border px-3 py-2 text-sm" style={inputStyle} aria-label="Punto">
            <option value="">{myPoints ? "Todos mis puntos" : "Todos los puntos"}</option>
            {visiblePoints.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>{periodText}</span>
        <button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <ExportGate><button type="button" onClick={exportCsv} disabled={!data} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-bold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>
          <Download size={14} /> <span className="hidden sm:inline">Exportar</span>
        </button></ExportGate>
      </div>

      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}

      {k ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Venta neta" value={cop(rev)} sub={`${n(k.orders)} ventas · ${n(k.units)} und.`} info="Cantidad × precio vendido de ventas confirmadas (sin anuladas)." />
            <Stat label="Costo de lo vendido" value={cop(cost)} sub={k.lines_estimated ? `${k.lines_estimated} líneas con costo estimado` : "costo guardado al vender"} info="El costo promedio del producto en el momento de la venta." />
            <Stat label="Ganancia bruta" value={cop(profit)} bad={profit < 0} sub={k.lines_loss ? `${k.lines_loss} líneas con pérdida` : "sin pérdidas"} info="Venta neta − costo de lo vendido (antes de gastos)." />
            <Stat label="Margen sobre venta" value={pctText(margin(rev, cost))} sub={`Incremento sobre costo ${pctText(markup(rev, cost))}`} info="Margen = ganancia ÷ venta. Incremento = ganancia ÷ costo. Son cosas distintas." />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Parte de la madre" value={cop(k.mother)} sub="precio de la madre − costo" info="Lo que gana la madre: su precio (1-5) menos el costo." />
            <Stat label="Parte de los puntos" value={cop(k.point)} sub="precio del punto − precio de la madre" info="Lo que agrega cada punto con su regla. Madre + puntos = ganancia bruta." />
          </div>

          {k.lines_estimated ? (
            <p className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">
              <Info2 />
              <span>{k.lines_estimated} de {k.lines} líneas son de ventas anteriores a la activación: su costo es el <b>actual</b> (estimado). Las ventas nuevas guardan el costo exacto del momento.</span>
            </p>
          ) : null}

          <section className="rounded-2xl border p-4" style={cardStyle}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Por punto</p>
            {data.by_point.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin ventas en este periodo.</p>
            ) : (
              <ul className="space-y-3">
                {data.by_point.map((p) => {
                  const r = n(p.revenue), c = n(p.cost), g = n(p.profit);
                  return (
                    <li key={p.point_id ?? "online"}>
                      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                        <b className="w-full truncate sm:w-auto sm:min-w-0 sm:flex-1">{p.name}</b>
                        <span className="tabular-nums">{cop(r)}</span>
                        <span className="tabular-nums" style={{ color: g < 0 ? "#e66767" : "var(--t-muted)" }}>ganancia {cop(g)} · margen {pctText(margin(r, c))}</span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
                        <div className="h-full rounded-[4px]" style={{ width: `${Math.max(2, (Math.abs(r) / maxPoint) * 100)}%`, background: "#3987e5" }} />
                      </div>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>{n(p.orders)} ventas · madre {cop(p.mother)} · punto {cop(p.point)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border" style={cardStyle}>
            <div className="flex flex-wrap items-center gap-2 p-4 pb-2">
              <p className="mr-auto text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Productos</p>
              <div className="flex gap-1 text-xs font-bold">
                {([["profit", "Más ganancia"], ["margin", "Menor margen"], ["loss", "Con pérdida"]] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setSort(key)} className="rounded-full px-3 py-1" style={sort === key ? { background: "var(--t-accent)", color: "#fff" } : { border: "1px solid var(--t-card-border)", color: "var(--t-muted)" }}>{label}</button>
                ))}
              </div>
              <div className="relative w-full sm:w-56">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="w-full rounded-full border py-1.5 pr-3 text-sm outline-none" style={{ ...inputStyle, paddingLeft: "2rem" }} />
              </div>
            </div>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="sticky top-0" style={{ background: "var(--t-card-bg)" }}>
                  <tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
                    <th className="px-4 py-2 font-semibold">Producto</th>
                    <th className="px-2 py-2 text-right font-semibold">Und.</th>
                    <th className="px-2 py-2 text-right font-semibold">Venta</th>
                    <th className="px-2 py-2 text-right font-semibold">Ganancia</th>
                    <th className="px-4 py-2 text-right font-semibold">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, 200).map((p) => (
                    <tr key={p.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="max-w-[16rem] truncate px-4 py-2">{p.name}{p.estimated ? <span className="ml-1 text-[10px]" style={{ color: "var(--t-muted)" }} title="Incluye ventas con costo estimado">≈</span> : null}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.units}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{cop(p.revenue)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={p.profit < 0 ? { color: "#e66767" } : undefined}>{cop(p.profit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pctText(margin(p.revenue, p.cost))}</td>
                    </tr>
                  ))}
                  {products.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm" style={{ color: "var(--t-muted)" }}>{sort === "loss" ? "🎉 Ningún producto con pérdida" : "Sin productos"}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border p-4" style={cardStyle}>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
              <ShieldCheck size={14} /> Guardián de precios · {data.guard.mode === "enforce" ? "bloqueando" : data.guard.mode === "observe" ? "observando" : "apagado"}
            </p>
            {n(data.guard.mismatches) === 0 ? (
              <p className="text-sm">✓ Todos los precios vendidos en este periodo coinciden con precios autorizados.</p>
            ) : (
              <>
                <p className="text-sm"><b>{n(data.guard.mismatches)}</b> línea{n(data.guard.mismatches) === 1 ? "" : "s"} con un precio que no coincide con los autorizados{data.guard.mode === "observe" ? " (se dejaron pasar y quedaron anotadas)" : ""}.</p>
                {data.guard.recent.length ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {data.guard.recent.map((g, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span style={{ color: "var(--t-muted)" }}>{new Date(g.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                        <b>{g.name ?? "Producto"}</b>
                        <span>vendido a {cop(g.price)}{g.receipt_no ? ` · pedido #${g.receipt_no}` : ""}</span>
                        {g.blocked ? <span className="font-bold text-red-400">bloqueado</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {n(data.capture_errors) ? <p className="mt-2 flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={12} /> {n(data.capture_errors)} venta(s) no guardaron su foto financiera; usan costo estimado.</p> : null}
          </section>
        </>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} />)}</div>
      ) : null}
    </div>
  );
}

function Info2() {
  return <span aria-hidden>ℹ️</span>;
}
