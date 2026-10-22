"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField } from "@/components/forms/Fields";
import { cardStyle, type Point } from "./shared";

/**
 * Margen real por producto (20261225): lo que deja cada producto, no solo lo que se vende.
 * «Se vende mucho y deja poco» marca los 20 más vendidos con margen bajo (menos del 15 %).
 * Abajo: productos con algún precio por debajo del costo.
 */

type Item = {
  product_id: string; name: string; sku: string | null; image_url: string | null; qty: number; orders: number;
  revenue: number; cost: number; profit: number; margin: number | null; rank_qty: number; rank_profit: number; no_cost: boolean; sells_but_low: boolean;
};
type Result = { ok: boolean; error?: string; revenue: number; cost: number; profit: number; margin: number | null; no_cost: number; items: Item[] };
type Low = { product_id: string; name: string; sku: string | null; cost: number; levels: number[]; prices: number[] };

const money = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SORTS = { profit: "Más ganancia", margin: "Mejor margen", qty: "Más vendidos", low: "Menor margen" } as const;

export function ProductMargins({ storeId, points }: { storeId: string; points: Point[] }) {
  const [range, setRange] = useState(() => { const t = new Date(); return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) }; });
  const [point, setPoint] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("profit");
  const [onlyFlag, setOnlyFlag] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [low, setLow] = useState<Low[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const from = new Date(`${range.from}T00:00:00-05:00`).toISOString();
    const to = new Date(new Date(`${range.to}T00:00:00-05:00`).getTime() + 86400000).toISOString();
    void supabaseBrowser().rpc("erp_product_margins", { p_store: storeId, p_from: from, p_to: to, p_point: point || null }).then(({ data: r, error: e }) => {
      if (!alive) return;
      const v = r as Result | null;
      if (e || !v?.ok) { setError(e && /erp_product_margins|Could not find/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261225_plata_y_control.sql." : v?.error ?? e?.message ?? "No se pudo cargar."); setData(null); }
      else { setError(""); setData(v); }
    });
    return () => { alive = false; };
  }, [storeId, range, point]);

  useEffect(() => {
    void supabaseBrowser().rpc("erp_prices_below_cost", { p_store: storeId }).then(({ data: r }) => {
      const v = r as { ok: boolean; items: Low[] } | null;
      setLow(v?.ok ? v.items : []);
    });
  }, [storeId]);

  const shown = useMemo(() => {
    let list = [...(data?.items ?? [])];
    if (onlyFlag) list = list.filter((i) => i.sells_but_low);
    const w = q.trim().toLowerCase();
    if (w) list = list.filter((i) => `${i.name} ${i.sku ?? ""}`.toLowerCase().includes(w));
    const m = (i: Item) => Number(i.margin ?? -999);
    list.sort((a, b) => sort === "profit" ? b.profit - a.profit : sort === "qty" ? b.qty - a.qty : sort === "margin" ? m(b) - m(a) : m(a) - m(b));
    return list;
  }, [data, onlyFlag, q, sort]);
  const flagged = (data?.items ?? []).filter((i) => i.sells_but_low).length;

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Producto", "Referencia", "Unidades", "Ventas", "Costo", "Ganancia", "Margen %"];
    const lines = shown.map((i) => [i.name, i.sku, i.qty, i.revenue, i.cost, i.profit, i.margin ?? ""].map(esc).join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${[head.map(esc).join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    a.download = `margen-por-producto-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const chip = (on: boolean) => (on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={cardStyle}>
        <span className="text-sm font-semibold">Desde</span><DateField compact value={range.from} onChange={(v) => v && setRange((r) => ({ ...r, from: v }))} ariaLabel="Desde" />
        <span className="text-sm font-semibold">hasta</span><DateField compact value={range.to} onChange={(v) => v && setRange((r) => ({ ...r, to: v }))} ariaLabel="Hasta" />
        <select value={point} onChange={(e) => setPoint(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Punto">
          <option value="">Todos los puntos</option>
          {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="min-w-40 flex-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
        {shown.length ? <button type="button" onClick={exportCsv} className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>⬇️ Exportar</button> : null}
      </div>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}
      {data ? (
        <div className="grid gap-2 sm:grid-cols-4">
          {[["Ventas", money(data.revenue)], ["Costo", money(data.cost)], ["Ganancia", money(data.profit)], ["Margen", data.margin !== null ? `${data.margin} %` : "—"]].map(([l, v]) => (
            <div key={l} className="rounded-2xl border p-3" style={cardStyle}><p className="text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>{l}</p><p className="text-xl font-black">{v}</p></div>
          ))}
        </div>
      ) : null}
      {data?.no_cost ? <p className="text-xs text-amber-500">⚠️ {data.no_cost} producto(s) vendidos no tienen costo: su ganancia sale inflada. Regístrales una factura de compra.</p> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(SORTS) as Array<keyof typeof SORTS>).map((k) => <button key={k} type="button" onClick={() => setSort(k)} className="rounded-full border px-3 py-1.5 font-semibold" style={chip(sort === k)}>{SORTS[k]}</button>)}
        <button type="button" onClick={() => setOnlyFlag((v) => !v)} className="rounded-full border px-3 py-1.5 font-semibold" style={onlyFlag ? { background: "#f59e0b", color: "#111", borderColor: "transparent" } : { borderColor: "color-mix(in oklab, #f59e0b 50%, var(--t-card-border))" }}>
          ⚠️ Se vende mucho y deja poco ({flagged})
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border" style={cardStyle}>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>
            <th className="p-3">Producto</th><th className="p-3 text-right">Und.</th><th className="p-3 text-right">Ventas</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Ganancia</th><th className="p-3 text-right">Margen</th>
          </tr></thead>
          <tbody>
            {shown.slice(0, 400).map((i) => (
              <tr key={i.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)", background: i.sells_but_low ? "color-mix(in oklab, #f59e0b 8%, transparent)" : undefined }}>
                <td className="p-3"><b>{i.name}</b>{i.sku ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{i.sku} · #{i.rank_qty} en ventas · #{i.rank_profit} en ganancia</span> : null}
                  {i.sells_but_low ? <span className="block text-[11px] font-bold text-amber-500">Se vende mucho y deja poco</span> : null}{i.no_cost ? <span className="block text-[11px] text-amber-500">Sin costo</span> : null}</td>
                <td className="p-3 text-right tabular-nums">{i.qty}</td>
                <td className="p-3 text-right tabular-nums">{money(i.revenue)}</td>
                <td className="p-3 text-right tabular-nums" style={{ color: "var(--t-muted)" }}>{money(i.cost)}</td>
                <td className="p-3 text-right font-bold tabular-nums" style={{ color: i.profit < 0 ? "#ef4444" : undefined }}>{money(i.profit)}</td>
                <td className="p-3 text-right font-bold tabular-nums" style={{ color: i.margin === null ? undefined : i.margin < 15 ? "#f59e0b" : "#10b981" }}>{i.margin !== null ? `${i.margin} %` : "—"}</td>
              </tr>
            ))}
            {data && !shown.length ? <tr><td colSpan={6} className="p-6 text-center" style={{ color: "var(--t-muted)" }}>No hay ventas en este periodo.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {low?.length ? (
        <div className="rounded-2xl border p-4" style={{ ...cardStyle, borderColor: "color-mix(in oklab, #ef4444 45%, var(--t-card-border))" }}>
          <h3 className="text-sm font-bold">🔴 Precios por debajo del costo ({low.length})</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Si se venden a estos precios se pierde plata. Ábrelos y súbelos.</p>
          <div className="mt-2 grid gap-1.5 md:grid-cols-2">
            {low.slice(0, 100).map((l) => (
              <a key={l.product_id} href={`/dashboard/products/${l.product_id}`} className="rounded-xl border px-3 py-2 text-sm transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
                <b>{l.name}</b>
                <span className="block text-xs" style={{ color: "var(--t-muted)" }}>Costo {money(l.cost)} · {(l.levels ?? []).map((n) => `P${n} ${money(l.prices[n - 1])}`).join(" · ")}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
