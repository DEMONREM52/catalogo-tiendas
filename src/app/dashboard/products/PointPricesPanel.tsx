"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Store } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Precio de este producto en cada punto: el de la tienda (precio 1-5) con la regla de precio del punto,
 * igual que lo cobra el POS (erp_point_prices). Se carga al abrir el panel: esa función calcula el punto completo.
 * Cada usuario ve solo los puntos que puede ver (erp_my_points).
 */
type Rule = { scope: string | null; kind: string | null; value: number | null };
type Row = { id: string; name: string; prices: number[]; rule: Rule | null };

const money = (n: number) => `$ ${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const LEVELS = ["P1 · mínimo", "P2 · mayor", "P3 · detal", "P4", "P5"];

function ruleLabel(r: Rule | null): string {
  if (!r || !r.kind || r.kind === "none") return "Igual a la tienda";
  const scope = r.scope === "product" ? "solo este producto" : r.scope === "category" ? "por categoría" : "todo el punto";
  if (r.kind === "fixed") return `Precio fijo ${money(r.value ?? 0)} · ${scope}`;
  const v = Number(r.value ?? 0);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("es-CO")} % · ${scope}`;
}

export function PointPricesPanel({ storeId, productId, basePrices, active, dirty }: {
  storeId: string; productId: string;
  /** Precios 1-5 guardados de la tienda (sin cambios sin guardar). */
  basePrices: number[];
  active: boolean;
  dirty: boolean;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      const [wh, mine] = await Promise.all([
        sb.from("erp_warehouses").select("id,name,kind").eq("store_id", storeId).eq("active", true).eq("kind", "point").order("name"),
        sb.rpc("erp_my_points", { p_store: storeId }),
      ]);
      if (wh.error) throw wh.error;
      const allowed = mine.error ? null : ((mine.data as string[] | null) ?? null);
      const points = ((wh.data ?? []) as Array<{ id: string; name: string }>).filter((p) => !allowed || allowed.includes(p.id));
      const out = await Promise.all(points.map(async (p): Promise<Row> => {
        const { data, error: e } = await sb.rpc("erp_point_prices", { p_store: storeId, p_point: p.id }).eq("product_id", productId);
        if (e) throw e;
        const hit = ((data ?? []) as Array<Record<string, number | string | null>>)[0];
        if (!hit) return { id: p.id, name: p.name, prices: basePrices, rule: null };
        return {
          id: p.id, name: p.name,
          prices: [1, 2, 3, 4, 5].map((l) => Number(hit[`price_${l}`] ?? 0)),
          rule: { scope: (hit.rule_scope as string) ?? null, kind: (hit.rule_kind as string) ?? null, value: hit.rule_value === null ? null : Number(hit.rule_value) },
        };
      }));
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron leer los precios de los puntos.");
    } finally {
      setLoading(false);
    }
  }

  const border = { borderColor: "var(--t-card-border)" } as const;
  return (
    <details className="group rounded-2xl border p-3" style={border}
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !rows && !loading) void load(); }}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <Store size={16} style={{ color: "var(--t-accent)" }} />
        <span className="flex-1">Precio en los puntos</span>
        <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
          <span className="group-open:hidden">Ver ▾</span><span className="hidden group-open:inline">Ocultar ▴</span>
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
          El precio que cobra el POS de cada punto: el de la tienda con la regla de precio del punto. Las ofertas van aparte.
          {dirty ? <b className="text-amber-500"> Con los precios guardados: guarda para ver los nuevos.</b> : null}
        </p>
        {!active ? <p className="text-xs font-semibold text-amber-500">Este producto está inactivo: no se vende en los puntos.</p> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm" style={{ color: "var(--t-muted)" }}><Loader2 size={14} className="animate-spin" /> Calculando el precio en cada punto…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error} <button type="button" className="underline" onClick={() => void load()}>Reintentar</button></p>
        ) : rows && !rows.length ? (
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>No hay puntos activos que puedas ver.</p>
        ) : rows ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>
                    <th className="py-1.5 pr-2 font-bold">Punto</th>
                    {LEVELS.map((l) => <th key={l} className="px-2 py-1.5 text-right font-bold">{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t" style={border}>
                    <td className="py-2 pr-2"><b>🏬 Tienda</b><div className="text-[11px]" style={{ color: "var(--t-muted)" }}>Precio base</div></td>
                    {basePrices.map((v, i) => <td key={i} className="px-2 py-2 text-right tabular-nums">{money(v)}</td>)}
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t" style={border}>
                      <td className="py-2 pr-2">
                        <b>📍 {r.name}</b>
                        <div className="text-[11px]" style={{ color: r.rule && r.rule.kind !== "none" ? "var(--t-accent)" : "var(--t-muted)" }}>{ruleLabel(r.rule)}</div>
                      </td>
                      {r.prices.map((v, i) => {
                        const diff = v - (basePrices[i] ?? 0);
                        return (
                          <td key={i} className="px-2 py-2 text-right tabular-nums">
                            <b>{money(v)}</b>
                            {Math.round(diff) !== 0 ? <div className={`text-[10px] font-bold ${diff > 0 ? "text-emerald-500" : "text-red-500"}`}>{diff > 0 ? "+" : "−"}{money(Math.abs(diff)).replace("$ ", "$")}</div> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: "var(--t-accent)" }}>
              <RefreshCw size={12} /> Actualizar
            </button>
          </>
        ) : null}
      </div>
    </details>
  );
}
