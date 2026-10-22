"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Thumb } from "./LineEditor";
import { Btn, Empty, Panel, inputClass, inputStyle, money, type ErpCtx, type Warehouse } from "./shared";

/**
 * Productos quietos (20261225): con unidades y sin ventas en 60/90/180 días, con la plata parada.
 * Sirve para decidir si se trasladan a otro punto o se ponen en promoción.
 */

type Row = {
  product_id: string; warehouse_id: string; name: string; sku: string | null; image_url: string | null; point: string;
  qty: number; last_sale: string | null; last_in: string | null; days: number | null; value: number | null; retail: number;
};
type Result = { ok: boolean; error?: string; can_cost: boolean; units: number; value: number | null; retail: number; items: Row[] };

export function StaleStockTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const [days, setDays] = useState(90);
  const [point, setPoint] = useState(ctx.pointId ?? "");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_stale_stock", { p_store: ctx.storeId, p_days: days, p_point: point || null }).then(({ data: r, error: e }) => {
      if (!alive) return;
      const v = r as Result | null;
      if (e || !v?.ok) { setError(e && /erp_stale_stock|Could not find/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261225_plata_y_control.sql." : v?.error ?? e?.message ?? "No se pudo cargar."); setData(null); }
      else { setError(""); setData(v); }
    });
    return () => { alive = false; };
  }, [ctx.storeId, days, point]);

  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    return (data?.items ?? []).filter((r) => !w || `${r.name} ${r.sku ?? ""} ${r.point}`.toLowerCase().includes(w));
  }, [data, q]);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Producto", "Referencia", "Punto", "Unidades", "Última venta", "Días sin vender", ...(data?.can_cost ? ["Valor al costo"] : []), "Valor a precio detal"];
    const lines = shown.map((r) => [r.name, r.sku, r.point, r.qty, r.last_sale ? new Date(r.last_sale).toLocaleDateString("es-CO") : "Nunca", r.days ?? "", ...(data?.can_cost ? [r.value] : []), r.retail].map(esc).join(";"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${[head.map(esc).join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    a.download = `productos-quietos-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const active = warehouses.filter((w) => w.active && (!ctx.pointId || w.id === ctx.pointId));
  return (
    <Panel title="💤 Productos sin movimiento" subtitle="Tienen unidades pero no se venden hace tiempo. Trasládalos a donde sí se venden o ponlos en promoción para recuperar la plata.">
      <div className="flex flex-wrap items-center gap-2">
        {[60, 90, 180].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className="rounded-full border px-3 py-1.5 text-sm font-semibold"
            style={days === d ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>Más de {d} días</button>
        ))}
        <select className={`${inputClass} w-auto`} style={inputStyle} value={point} onChange={(e) => setPoint(e.target.value)} disabled={Boolean(ctx.pointId)} aria-label="Punto">
          <option value="">Todos los puntos</option>
          {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className={`${inputClass} min-w-48 flex-1`} style={inputStyle} placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length ? <Btn variant="ghost" onClick={exportCsv}>⬇️ Exportar</Btn> : null}
      </div>
      {error ? <p className="mt-3 text-sm text-amber-500">⚠️ {error}</p> : null}
      {data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>Productos quietos</p><p className="text-xl font-black">{data.items.length}</p></div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>Unidades</p><p className="text-xl font-black">{Number(data.units).toLocaleString("es-CO")}</p></div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))" }}>
            <p className="text-[11px] uppercase" style={{ color: "var(--t-muted)" }}>{data.can_cost ? "Plata parada (al costo)" : "Valor a precio detal"}</p>
            <p className="text-xl font-black" style={{ color: "#f59e0b" }}>{money(Number(data.can_cost ? data.value : data.retail))}</p>
          </div>
        </div>
      ) : null}
      <div className="mt-3 space-y-1.5">
        {data && !shown.length ? <Empty icon="🎉" title="Nada quieto" text={`Todo lo que tienes se ha vendido en los últimos ${days} días (o acaba de llegar).`} /> : null}
        {shown.slice(0, 300).map((r) => (
          <div key={`${r.product_id}-${r.warehouse_id}`} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
            <Thumb src={r.image_url} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{r.name}</p>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{r.sku ? `${r.sku} · ` : ""}{r.point} · {r.last_sale ? `última venta hace ${r.days} días` : "nunca se ha vendido aquí"}</p>
            </div>
            <div className="text-right text-sm">
              <b>{r.qty}</b> und.
              <span className="block text-xs font-bold" style={{ color: "#f59e0b" }}>{money(Number(data?.can_cost ? r.value : r.retail))}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
