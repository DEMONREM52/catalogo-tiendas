"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Chip, Modal } from "./dialog";
import { Btn, errorMessage, money } from "./shared";

/**
 * Liquidación de un punto: la mercancía que tiene hoy valorizada a costo real, a precio de bodega (lo que debe por ella)
 * y a su precio de venta, con lo que gana cada uno, frente a su deuda con la bodega.
 * Trae las 5 listas a la vez para comparar, explica cada pérdida y exporta a Excel y PDF.
 * Necesita 20261209_tablero_puntos.sql.
 */

type Line = { id: string; name: string; sku: string | null; image_url: string | null; qty: number; cost: number | null; internal: number; sale: number;
  /** 20261292: costo promedio, último costo de factura y si el precio de bodega quedó fijado al trasladar. */
  avg_cost?: number | null; last_cost?: number | null; last_cost_at?: string | null; frozen?: boolean };
type Valuation = {
  ok: boolean; error?: string; level: number; credit: boolean; can_see_costs: boolean; basis?: "last" | "average"; point_basis?: "last" | "average";
  point: { id: string; name: string; kind: string };
  summary: { balance: number; overdue: number; in_transit: number; paid: number; charged: number; oldest_overdue_days: number | null; next_due: string | null } | null;
  lines: Line[];
  totals: { products: number; units: number; cost: number | null; internal: number; sale: number; no_cost: number; no_price: number };
};
type Tab = "summary" | "products" | "compare" | "alerts";
type Filter = "all" | "loss" | "below_cost" | "no_price" | "no_cost" | "best" | "suspicious";
/** Por qué pierde un producto en la lista escogida. */
type Why = "below_cost" | "bodega" | null;

const LEVEL_KEY = "remhub:valuation-level";
const readLevel = () => {
  try { return Math.min(5, Math.max(1, Number(window.localStorage.getItem(LEVEL_KEY)) || 3)); } catch { return 3; }
};
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %` : "—");
const n = (v: unknown) => Number(v ?? 0);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const LEVELS = [1, 2, 3, 4, 5] as const;

/** Costo sospechoso: el promedio y el último costo de factura difieren 50 % o más (¿costo mal digitado?). */
function suspicious(l: Line) {
  const a = n(l.avg_cost), b = n(l.last_cost);
  return a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) >= 0.5;
}

function why(l: Line, costs: boolean): Why {
  if (l.sale <= 0 || l.sale >= l.internal) return null;
  if (costs && l.cost !== null && n(l.cost) > 0 && l.sale < n(l.cost)) return "below_cost";
  return "bodega";
}

function Box({ label, value, sub, tone, help }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "accent"; help: string }) {
  const color = tone === "good" ? "#10b981" : tone === "bad" ? "#ef4444" : tone === "warn" ? "#f59e0b" : tone === "accent" ? "var(--t-accent)" : "var(--t-text)";
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }} title={help}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="mt-1 text-lg font-black tabular-nums" style={{ color }}>{value}</p>
      {sub ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
    </div>
  );
}

export function PointValuationModal({ storeId, pointId, pointName, onClose }: { storeId: string; pointId: string; pointName: string; onClose: () => void }) {
  const [level, setLevel] = useState(readLevel);
  /** Con qué costo valorizar: el que tenga el punto (auto), el último de factura o el promedio. */
  const [basis, setBasis] = useState<"auto" | "last" | "average">("auto");
  const [all, setAll] = useState<Record<number, Valuation>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"sale" | "qty" | "profit" | "loss" | "margin" | "name">("sale");

  // Las 5 listas a la vez (para comparar sin esperar al cambiar de lista).
  useEffect(() => {
    let alive = true;
    void Promise.all(LEVELS.map((lv) => supabaseBrowser().rpc("erp_point_valuation", { p_store: storeId, p_point: pointId, p_level: lv, ...(basis === "auto" ? {} : { p_basis: basis }) }))).then((res) => {
      if (!alive) return;
      const bad = res.find((r) => r.error);
      if (bad?.error) return setError(/Could not find the function|schema cache/i.test(bad.error.message) ? "Falta ejecutar en Supabase la migración 20261209_tablero_puntos.sql." : errorMessage(bad.error));
      const map: Record<number, Valuation> = {};
      for (const r of res) { const v = r.data as Valuation; if (v?.ok) map[v.level] = v; else return setError(v?.error ?? "No se pudo cargar."); }
      setError(null);
      setAll(map);
    });
    return () => { alive = false; };
  }, [storeId, pointId, basis]);
  useEffect(() => { try { window.localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* sin almacenamiento */ } }, [level]);

  const data = all[level] ?? null;
  const costs = Boolean(data?.can_see_costs);
  const t = data?.totals;
  const cost = n(t?.cost), internal = n(t?.internal), sale = n(t?.sale);
  const s = data?.summary;
  const balance = n(s?.balance);
  const gap = balance - internal;

  const allLines = useMemo(() => data?.lines ?? [], [data]);
  const losses = useMemo(() => allLines.filter((l) => why(l, costs)), [allLines, costs]);
  const belowCost = losses.filter((l) => why(l, costs) === "below_cost");
  const bodegaLoss = losses.filter((l) => why(l, costs) === "bodega");
  const suspects = useMemo(() => allLines.filter(suspicious), [allLines]);
  const lossTotal = losses.reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0);
  const gainTotal = allLines.filter((l) => l.sale >= l.internal).reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0);

  const lines = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = allLines.filter((l) => {
      if (words.length && !words.every((w) => fold(`${l.name} ${l.sku ?? ""}`).includes(w))) return false;
      if (filter === "loss") return !!why(l, costs);
      if (filter === "below_cost") return why(l, costs) === "below_cost";
      if (filter === "no_price") return l.sale <= 0;
      if (filter === "no_cost") return n(l.cost) <= 0;
      if (filter === "best") return l.sale > l.internal;
      if (filter === "suspicious") return suspicious(l);
      return true;
    });
    const margin = (l: Line) => (l.sale > 0 ? (l.sale - l.internal) / l.sale : -Infinity);
    const by: Record<typeof sort, (a: Line, b: Line) => number> = {
      sale: (a, b) => b.qty * b.sale - a.qty * a.sale,
      qty: (a, b) => b.qty - a.qty,
      profit: (a, b) => b.qty * (b.sale - b.internal) - a.qty * (a.sale - a.internal),
      loss: (a, b) => a.qty * (a.sale - a.internal) - b.qty * (b.sale - b.internal),
      margin: (a, b) => margin(a) - margin(b),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [allLines, q, filter, sort, costs]);

  // Comparar listas: totales de cada lista.
  const compare = LEVELS.map((lv) => {
    const v = all[lv];
    if (!v) return null;
    const sl = n(v.totals.sale), it = n(v.totals.internal), c = n(v.totals.cost);
    const lossN = v.lines.filter((l) => why(l, v.can_see_costs)).length;
    const lossV = v.lines.filter((l) => why(l, v.can_see_costs)).reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0);
    return { lv, sale: sl, point: sl - it, chain: sl - c, margin: pct(sl - it, sl), lossN, lossV };
  });

  /** Excel con las 5 listas (una columna de venta y ganancia por lista). */
  function exportCsv() {
    if (!data) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const byId = (lv: number) => new Map((all[lv]?.lines ?? []).map((l) => [l.id, l]));
    const maps = LEVELS.map(byId);
    const head = ["Producto", "Código", "Unidades", ...(costs ? ["Costo unit.", "Costo total"] : []), "Precio bodega unit.", "Total bodega",
      ...LEVELS.flatMap((lv) => [`Venta P${lv}`, `Gana el punto P${lv}`]), `Motivo de pérdida (P${level})`];
    const rows = allLines.map((l) => [l.name, l.sku, l.qty, ...(costs ? [l.cost, n(l.cost) * l.qty] : []), l.internal, l.internal * l.qty,
      ...maps.flatMap((m): Array<string | number> => { const x = m.get(l.id); return x ? [x.sale, (x.sale - x.internal) * x.qty] : ["", ""]; }),
      why(l, costs) === "below_cost" ? "Precio de lista menor que el costo" : why(l, costs) === "bodega" ? "Precio de lista menor que el de bodega" : ""].map(esc).join(";"));
    const blob = new Blob([`﻿${[head.map(esc).join(";"), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liquidacion-${pointName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Informe para imprimir o guardar en PDF. */
  function printReport() {
    if (!data || !t) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const e = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const rowsHtml = lines.map((l) => {
      const g = (l.sale - l.internal) * l.qty;
      return `<tr><td>${e(l.name)}${l.sku ? ` <span class="m">${e(l.sku)}</span>` : ""}</td><td class="r">${l.qty}</td>${costs ? `<td class="r">${e(money(l.cost))}</td>` : ""}<td class="r">${e(money(l.internal))}</td><td class="r">${e(money(l.sale))}</td><td class="r">${e(money(l.sale * l.qty))}</td><td class="r ${g < 0 ? "bad" : ""}"><b>${e(money(g))}</b></td></tr>`;
    }).join("");
    const cmp = compare.filter(Boolean).map((c) => `<tr><td>P${c!.lv}</td><td class="r">${e(money(c!.sale))}</td><td class="r ${c!.point < 0 ? "bad" : ""}">${e(money(c!.point))}</td><td class="r">${e(c!.margin)}</td><td class="r">${c!.lossN}</td><td class="r bad">${e(money(c!.lossV))}</td></tr>`).join("");
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Liquidacion-${e(pointName)}-P${level}</title><style>
      body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:11px} h1{font-size:18px;margin:0} h2{font-size:12px;text-transform:uppercase;border-bottom:2px solid #111;margin:18px 0 6px;padding-bottom:3px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.box{border:1px solid #ccc;border-radius:8px;padding:8px}.k{font-size:9px;color:#666;text-transform:uppercase;font-weight:700}.v{font-size:14px;font-weight:900}
      table{width:100%;border-collapse:collapse}th{text-align:left;font-size:9px;text-transform:uppercase;color:#555;border-bottom:1.5px solid #111;padding:4px}td{border-bottom:1px solid #e5e5e5;padding:3px 4px}.r{text-align:right;white-space:nowrap}.m{color:#666}.bad{color:#b91c1c}
      @media print{@page{size:letter;margin:12mm}body{padding:0}tr{break-inside:avoid}}</style></head><body>
      <h1>Liquidación · ${e(pointName)}</h1><p class="m">Mercancía hoy · precio de venta con la lista P${level} · ${e(new Date().toLocaleString("es-CO"))}</p>
      <h2>Resumen</h2><div class="grid">
      ${costs ? `<div class="box"><div class="k">Costo real</div><div class="v">${e(money(cost))}</div></div>` : ""}
      <div class="box"><div class="k">Precio de bodega</div><div class="v">${e(money(internal))}</div></div>
      <div class="box"><div class="k">A precio de venta (P${level})</div><div class="v">${e(money(sale))}</div></div>
      <div class="box"><div class="k">Ganancia del punto</div><div class="v">${e(money(sale - internal))}</div><div class="m">ganancias ${e(money(gainTotal))} · pérdidas ${e(money(lossTotal))}</div></div>
      ${costs ? `<div class="box"><div class="k">Ganancia de la bodega</div><div class="v">${e(money(internal - cost))}</div></div>` : ""}
      ${data.credit && s ? `<div class="box"><div class="k">Debe hoy a la bodega</div><div class="v">${e(money(balance))}</div></div>` : ""}</div>
      <h2>Comparar listas</h2><table><thead><tr><th>Lista</th><th class="r">Total venta</th><th class="r">Gana el punto</th><th class="r">Margen</th><th class="r">Con pérdida</th><th class="r">Pérdidas</th></tr></thead><tbody>${cmp}</tbody></table>
      <h2>Productos (${lines.length})</h2><table><thead><tr><th>Producto</th><th class="r">Und.</th>${costs ? "<th class=r>Costo</th>" : ""}<th class="r">Bodega</th><th class="r">Venta P${level}</th><th class="r">Total venta</th><th class="r">Gana el punto</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  }

  const tabs: Array<[Tab, string]> = [["summary", "Resumen"], ["products", `Productos (${allLines.length})`], ["compare", "Comparar listas"], ["alerts", `⚠️ Pérdidas (${losses.length})`]];

  return (
    <Modal
      wide
      title={`📊 Liquidación · ${pointName}`}
      subtitle="La mercancía que hay hoy en el punto: lo que costó, lo que vale para la bodega, lo que vale a precio de venta y lo que gana cada uno."
      onClose={onClose}
      footer={<>{data ? <><Btn variant="ghost" onClick={exportCsv}>⬇️ Excel (5 listas)</Btn><Btn variant="ghost" onClick={printReport}>📄 PDF</Btn></> : null}<Btn onClick={onClose}>Cerrar</Btn></>}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold" style={{ color: "var(--t-muted)" }}>Precio de venta del punto con la lista:</span>
        {LEVELS.map((l) => <Chip key={l} on={level === l} onClick={() => setLevel(l)}>P{l}</Chip>)}
        {costs ? (
          <>
            <span className="ml-2 font-semibold" style={{ color: "var(--t-muted)" }}>Costo:</span>
            <Chip on={(basis === "auto" ? data?.basis : basis) === "last"} onClick={() => setBasis("last")}>Último de factura</Chip>
            <Chip on={(basis === "auto" ? data?.basis : basis) === "average"} onClick={() => setBasis("average")}>Promedio</Chip>
            {data?.point_basis ? <span style={{ color: "var(--t-muted)" }}>· el punto liquida con {data.point_basis === "last" ? "el último costo" : "el promedio"}</span> : null}
          </>
        ) : null}
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full px-3 py-1.5" style={tab === k ? { background: k === "alerts" ? "#ef4444" : "var(--t-accent)", color: "#fff" } : { color: k === "alerts" && losses.length ? "#ef4444" : "var(--t-muted)" }}>{l}</button>
        ))}
      </div>

      {error ? <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "#ef4444", color: "#ef4444" }}>{error}</p> : null}
      {!data && !error ? <p style={{ color: "var(--t-muted)" }}>Calculando las 5 listas…</p> : null}

      {data && t && tab === "summary" ? (
        <>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>📦 La mercancía del punto ({t.units.toLocaleString("es-CO")} unidades · {t.products} productos)</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {costs ? <Box label="① Costo real" value={money(cost)} sub="Lo que pagó la bodega al proveedor (costo promedio)" help="Unidades × costo de compra de cada producto." /> : null}
              <Box label="② Precio de bodega" value={money(internal)} sub={costs ? `Costo + ${pct(internal - cost, cost)} de la bodega` : "Costo + % de la bodega"} help="Lo que el punto le debe a la bodega por esta mercancía (precio interno congelado al trasladar)." tone="accent" />
              <Box label={`③ A precio de venta (P${level})`} value={money(sale)} sub="Si vende todo a su precio de lista" help="Unidades × precio de venta del punto (con su regla de precio)." />
              {costs ? <Box label="Ganancia de la bodega" value={money(internal - cost)} sub="② − ①" help="Lo que gana la bodega al cobrarle al punto." tone="good" /> : null}
              <Box label="Ganancia del punto" value={money(sale - internal)} sub={`③ − ② · margen ${pct(sale - internal, sale)}`} help="Lo que ganaría el punto si vende todo a ese precio, después de pagarle a la bodega." tone={sale - internal >= 0 ? "good" : "bad"} />
              {costs ? <Box label="Ganancia total (cadena)" value={money(sale - cost)} sub={`③ − ① · margen ${pct(sale - cost, sale)}`} help="Todo lo que gana el negocio (bodega + punto) si se vende todo." tone="good" /> : null}
            </div>
            {losses.length ? (
              <button type="button" onClick={() => setTab("alerts")} className="mt-2 w-full rounded-2xl border p-3 text-left text-sm" style={{ borderColor: "rgba(239,68,68,.45)", background: "rgba(239,68,68,.07)" }}>
                ⚠️ <b>{losses.length} producto(s)</b> dejan pérdida al punto con la lista P{level} (<b style={{ color: "#ef4444" }}>{money(lossTotal)}</b>). Las ganancias de los demás suman {money(gainTotal)}. <u>Ver por qué →</u>
              </button>
            ) : null}
            {t.no_cost || t.no_price ? (
              <p className="mt-2 text-xs" style={{ color: "#f59e0b" }}>
                ⚠️ {t.no_cost ? `${t.no_cost} producto(s) sin costo` : ""}{t.no_cost && t.no_price ? " · " : ""}{t.no_price ? `${t.no_price} sin precio de venta en P${level}` : ""}: no suman bien. Revísalos.
              </p>
            ) : null}
          </section>

          {data.credit && s ? (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>🤝 La cuenta con la bodega</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Debe hoy" value={money(balance)} tone={balance > 0 ? "warn" : "good"} help="Todo lo cobrado (traslados, deuda inicial, cargos) menos abonos, devoluciones y novedades." />
                <Box label="Vencido" value={money(s.overdue)} sub={s.oldest_overdue_days ? `Hace ${s.oldest_overdue_days} días` : "Al día"} tone={s.overdue > 0 ? "bad" : "good"} help="Lo que ya pasó su fecha de pago." />
                <Box label="En camino" value={money(s.in_transit)} sub="Traslados sin recibir" help="Se suma a la deuda cuando el punto confirme lo recibido." />
                <Box label="Ha abonado" value={money(s.paid)} help="Todos los abonos registrados." />
              </div>
              <div className="mt-2 rounded-2xl border p-3 text-sm" style={{ borderColor: gap > 0 ? "color-mix(in oklab, #f59e0b 45%, transparent)" : "color-mix(in oklab, #10b981 45%, transparent)" }}>
                {gap > 0 ? (
                  <>⚖️ El punto debe <b>{money(gap)}</b> más de lo que vale la mercancía que le queda (a precio de bodega). Ese dinero corresponde a lo que <b>ya vendió y no ha abonado</b>: debería estar en su caja.</>
                ) : (
                  <>⚖️ La mercancía que tiene ({money(internal)} a precio de bodega) <b>cubre su deuda</b>{gap < 0 ? <> y le sobran <b>{money(-gap)}</b> en mercancía ya pagada</> : null}.</>
                )}
              </div>
            </section>
          ) : (
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Este punto no tiene cuenta con la bodega: los valores de bodega son de referencia (costo + % de la bodega).</p>
          )}
        </>
      ) : null}

      {data && tab === "compare" ? (
        <section>
          <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Lo mismo con cada lista de precios: cuánto vendería y cuánto ganaría el punto. Toca una fila para usar esa lista.</p>
          <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
            <table className="w-full min-w-[640px] text-xs">
              <thead style={{ color: "var(--t-muted)" }}><tr><th className="px-3 py-2 text-left">Lista</th><th className="px-3 py-2 text-right">Total venta</th><th className="px-3 py-2 text-right">Gana el punto</th><th className="px-3 py-2 text-right">Margen</th>{costs ? <th className="px-3 py-2 text-right">Gana la cadena</th> : null}<th className="px-3 py-2 text-right">Con pérdida</th><th className="px-3 py-2 text-right">Pérdidas</th></tr></thead>
              <tbody>
                {compare.map((c) => c ? (
                  <tr key={c.lv} onClick={() => setLevel(c.lv)} className="cursor-pointer border-t transition hover:bg-[color:var(--t-card-bg-soft)]" style={{ borderColor: "var(--t-card-border)", background: c.lv === level ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : undefined }}>
                    <td className="px-3 py-2 font-black">P{c.lv}{c.lv === level ? " ✓" : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(c.sale)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: c.point >= 0 ? "#10b981" : "#ef4444" }}>{money(c.point)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.margin}</td>
                    {costs ? <td className="px-3 py-2 text-right tabular-nums">{money(c.chain)}</td> : null}
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: c.lossN ? "#ef4444" : undefined }}>{c.lossN}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: c.lossV < 0 ? "#ef4444" : undefined }}>{money(c.lossV)}</td>
                  </tr>
                ) : null)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data && tab === "alerts" ? (
        <section className="space-y-3">
          {!losses.length ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "rgba(16,185,129,.45)" }}>✅ Con la lista P{level} ningún producto deja pérdida al punto.</p> : (
            <>
              <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "rgba(239,68,68,.45)", background: "rgba(239,68,68,.06)" }}>
                <p className="font-bold">¿Por qué sale negativo?</p>
                <p className="mt-1 text-xs">«Gana el punto» = (precio de venta − precio de bodega) × unidades. Es negativo cuando la lista P{level} vende <b>más barato de lo que la bodega le cobra al punto</b>. Hay dos casos:</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <button type="button" onClick={() => { setFilter("below_cost"); setSort("loss"); setTab("products"); }} className="rounded-2xl border p-3 text-left text-xs" style={{ borderColor: "rgba(239,68,68,.45)" }}>
                  <p className="text-sm font-black" style={{ color: "#ef4444" }}>🔻 {belowCost.length} vendidos por debajo del costo</p>
                  <p className="mt-1">El precio de la lista es <b>menor que el costo real</b> (costo promedio). Pasa cuando una compra nueva salió más barata: el precio se recalculó con el <b>último costo</b>, pero el costo promedio y el precio de bodega siguen con las unidades viejas, más caras. También si la lista tiene un % muy bajo.</p>
                  <p className="mt-1 font-bold">Pérdida: {money(belowCost.reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0))} · Ver productos →</p>
                </button>
                <button type="button" onClick={() => { setFilter("loss"); setSort("loss"); setTab("products"); }} className="rounded-2xl border p-3 text-left text-xs" style={{ borderColor: "rgba(245,158,11,.5)" }}>
                  <p className="text-sm font-black" style={{ color: "#f59e0b" }}>⚖️ {bodegaLoss.length} entre el costo y el precio de bodega</p>
                  <p className="mt-1">El precio de la lista cubre el costo, pero <b>no alcanza para el % que cobra la bodega</b> (≈15 %). La cadena sí gana, pero toda la ganancia se la queda la bodega y el punto pierde. Pasa sobre todo en listas por mayor, como P2.</p>
                  <p className="mt-1 font-bold">Pérdida del punto: {money(bodegaLoss.reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0))} · Ver productos →</p>
                </button>
              </div>
              {suspects.length ? (
                <button type="button" onClick={() => { setFilter("suspicious"); setTab("products"); }} className="w-full rounded-2xl border p-3 text-left text-xs" style={{ borderColor: "rgba(14,165,233,.5)" }}>
                  <p className="text-sm font-black" style={{ color: "#0ea5e9" }}>🧾 {suspects.length} con costo sospechoso</p>
                  <p className="mt-1">El costo promedio y el de la <b>última factura</b> difieren 50 % o más. O la última factura tiene un costo mal digitado (y el precio se recalculó con él), o las unidades viejas entraron con un costo inflado. Revisa su último ingreso. · Ver productos →</p>
                </button>
              ) : null}
              <div className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="font-bold">Cómo arreglarlo</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Si el punto recibió su inventario como <b>factura propia</b> (no por traslado), activa «Último costo» en Rentabilidad → Repartos → el punto, y aquí escoge «Costo: Último de factura».</li>
                  <li>Para ver la ganancia real del punto, usa la lista con que vende de verdad (casi siempre <b>P1</b>, al detal). Compáralas en «Comparar listas».</li>
                  <li>Si el punto vende al por mayor (P2), súbele el % a esa lista o baja el % de la bodega para esos productos.</li>
                  <li>Los vendidos por debajo del costo: revisa su último ingreso. Si la compra nueva salió más barata, el precio ya bajó, pero las unidades viejas quedaron más caras.</li>
                </ul>
              </div>
              <ProductTable lines={[...losses].sort((a, b) => a.qty * (a.sale - a.internal) - b.qty * (b.sale - b.internal)).slice(0, 60)} level={level} costs={costs} />
            </>
          )}
        </section>
      ) : null}

      {data && tab === "products" ? (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none" style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar producto o código" aria-label="Buscar producto" />
            <select className="rounded-xl border px-2 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar">
              <option value="sale">Más valor en venta</option>
              <option value="profit">Más ganancia del punto</option>
              <option value="loss">Más pérdida del punto</option>
              <option value="margin">Menor margen primero</option>
              <option value="qty">Más unidades</option>
              <option value="name">Nombre</option>
            </select>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
            {([["all", "Todos"], ["loss", `Con pérdida (${losses.length})`], ["below_cost", `Bajo el costo (${belowCost.length})`], ["best", "Con ganancia"], ["suspicious", `Costo sospechoso (${suspects.length})`], ["no_price", "Sin precio"], ...(costs ? [["no_cost", "Sin costo"]] : [])] as Array<[Filter, string]>).map(([k, l]) => (
              <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{l}</Chip>
            ))}
          </div>
          <ProductTable lines={lines.slice(0, 400)} level={level} costs={costs} />
          <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{lines.length > 400 ? `Se muestran 400 de ${lines.length}. Usa el buscador o exporta para ver todos. · ` : ""}Total de lo filtrado: venta {money(lines.reduce((tt, l) => tt + l.sale * l.qty, 0))} · gana el punto {money(lines.reduce((tt, l) => tt + (l.sale - l.internal) * l.qty, 0))}</p>
        </section>
      ) : null}
    </Modal>
  );
}

function ProductTable({ lines, level, costs }: { lines: Line[]; level: number; costs: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <table className="rt w-full min-w-[780px] text-xs">
        <thead style={{ color: "var(--t-muted)" }}>
          <tr>
            <th className="px-3 py-2 text-left">Producto</th>
            <th className="px-3 py-2 text-right">Und.</th>
            {costs ? <th className="px-3 py-2 text-right">Costo</th> : null}
            <th className="px-3 py-2 text-right">Bodega</th>
            <th className="px-3 py-2 text-right">Venta P{level}</th>
            <th className="px-3 py-2 text-right">Total venta</th>
            <th className="px-3 py-2 text-right">Margen</th>
            <th className="px-3 py-2 text-right">Gana el punto</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const gain = (l.sale - l.internal) * l.qty;
            const w = why(l, costs);
            return (
              <tr key={l.id} className="border-t" style={{ borderColor: "var(--t-card-border)", background: w === "below_cost" ? "rgba(239,68,68,.06)" : w ? "rgba(245,158,11,.05)" : undefined }}>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    {l.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image_url} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                    ) : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>📦</span>}
                    <span className="min-w-0">
                      <span className="line-clamp-1 font-semibold">{l.name}</span>
                      <span className="block text-[10px]" style={{ color: w === "below_cost" ? "#ef4444" : w ? "#f59e0b" : "var(--t-muted)" }}>
                        {l.sku ?? ""}{w === "below_cost" ? " · 🔻 precio bajo el costo" : w === "bodega" ? " · ⚖️ precio bajo el de bodega" : ""}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                {costs ? (
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {money(l.cost)}
                    {n(l.avg_cost) > 0 && n(l.last_cost) > 0 && Math.round(n(l.avg_cost)) !== Math.round(n(l.last_cost)) ? (
                      <span className="block text-[10px]" style={{ color: suspicious(l) ? "#0ea5e9" : "var(--t-muted)" }} title={l.last_cost_at ? `Última factura: ${new Date(l.last_cost_at).toLocaleDateString("es-CO")}` : undefined}>
                        prom. {money(l.avg_cost)} · últ. {money(l.last_cost)}{suspicious(l) ? " 🧾" : ""}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-right tabular-nums">{money(l.internal)}{l.frozen ? <span className="block text-[10px]" style={{ color: "var(--t-muted)" }} title="Precio fijado cuando se trasladó: es la deuda real">🔒 trasladado</span> : null}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(l.sale)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(l.sale * l.qty)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: "var(--t-muted)" }}>{l.sale > 0 ? pct(l.sale - l.internal, l.sale) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: gain >= 0 ? "#10b981" : "#ef4444" }}>{money(gain)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
