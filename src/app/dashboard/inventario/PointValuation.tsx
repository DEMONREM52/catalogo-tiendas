"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Chip, Modal } from "./dialog";
import { Btn, errorMessage, money } from "./shared";

/**
 * Liquidación de un punto: la mercancía que tiene hoy valorizada a costo real, a precio de bodega (lo que debe por ella)
 * y a su precio de venta, con lo que gana cada uno, frente a su deuda con la bodega.
 * Necesita 20261209_tablero_puntos.sql.
 */

type Line = { id: string; name: string; sku: string | null; image_url: string | null; qty: number; cost: number | null; internal: number; sale: number };
type Valuation = {
  ok: boolean; error?: string; level: number; credit: boolean; can_see_costs: boolean;
  point: { id: string; name: string; kind: string };
  summary: { balance: number; overdue: number; in_transit: number; paid: number; charged: number; oldest_overdue_days: number | null; next_due: string | null } | null;
  lines: Line[];
  totals: { products: number; units: number; cost: number | null; internal: number; sale: number; no_cost: number; no_price: number };
};

const LEVEL_KEY = "remhub:valuation-level";
const readLevel = () => {
  try { return Math.min(5, Math.max(1, Number(window.localStorage.getItem(LEVEL_KEY)) || 3)); } catch { return 3; }
};
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %` : "—");

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
  const [data, setData] = useState<Valuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"sale" | "qty" | "profit" | "name">("sale");

  useEffect(() => {
    let alive = true;
    try { window.localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* sin almacenamiento */ }
    void supabaseBrowser().rpc("erp_point_valuation", { p_store: storeId, p_point: pointId, p_level: level }).then(({ data: d, error: e }) => {
      if (!alive) return;
      if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261209_tablero_puntos.sql." : errorMessage(e));
      const v = d as Valuation;
      if (!v?.ok) return setError(v?.error ?? "No se pudo cargar.");
      setError(null);
      setData(v);
    });
    return () => { alive = false; };
  }, [storeId, pointId, level]);

  const lines = useMemo(() => {
    const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = (data?.lines ?? []).filter((l) => !words.length || words.every((w) => fold(`${l.name} ${l.sku ?? ""}`).includes(w)));
    const by: Record<typeof sort, (a: Line, b: Line) => number> = {
      sale: (a, b) => b.qty * b.sale - a.qty * a.sale,
      qty: (a, b) => b.qty - a.qty,
      profit: (a, b) => b.qty * (b.sale - b.internal) - a.qty * (a.sale - a.internal),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [data, q, sort]);

  const t = data?.totals;
  const costs = Boolean(data?.can_see_costs);
  const cost = Number(t?.cost ?? 0), internal = Number(t?.internal ?? 0), sale = Number(t?.sale ?? 0);
  const s = data?.summary;
  const balance = Number(s?.balance ?? 0);
  const gap = balance - internal;

  function exportCsv() {
    if (!data) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Producto", "Código", "Unidades", ...(costs ? ["Costo unit.", "Costo total"] : []), "Precio bodega unit.", "Total bodega", `Venta P${level} unit.`, "Total venta", ...(costs ? ["Ganancia bodega"] : []), "Ganancia punto"];
    const rows = lines.map((l) => [l.name, l.sku, l.qty, ...(costs ? [l.cost, Number(l.cost ?? 0) * l.qty] : []), l.internal, l.internal * l.qty, l.sale, l.sale * l.qty,
      ...(costs ? [(l.internal - Number(l.cost ?? 0)) * l.qty] : []), (l.sale - l.internal) * l.qty].map(esc).join(";"));
    const blob = new Blob([`﻿${[head.map(esc).join(";"), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `liquidacion-${pointName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Modal
      wide
      title={`📊 Liquidación · ${pointName}`}
      subtitle="La mercancía que hay hoy en el punto: lo que costó, lo que vale para la bodega, lo que vale a precio de venta y lo que gana cada uno."
      onClose={onClose}
      footer={<>{data ? <Btn variant="ghost" onClick={exportCsv}>⬇️ Exportar</Btn> : null}<Btn onClick={onClose}>Cerrar</Btn></>}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold" style={{ color: "var(--t-muted)" }}>Precio de venta del punto con la lista:</span>
        {[1, 2, 3, 4, 5].map((l) => <Chip key={l} on={level === l} onClick={() => setLevel(l)}>P{l}</Chip>)}
      </div>

      {error ? <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "#ef4444", color: "#ef4444" }}>{error}</p> : null}
      {!data && !error ? <p style={{ color: "var(--t-muted)" }}>Calculando…</p> : null}

      {data && t ? (
        <>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>📦 La mercancía del punto ({t.units.toLocaleString("es-CO")} unidades · {t.products} productos)</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {costs ? <Box label="① Costo real" value={money(cost)} sub="Lo que pagó la bodega al proveedor" help="Unidades × costo de compra de cada producto." /> : null}
              <Box label="② Precio de bodega" value={money(internal)} sub={costs ? `Costo + ${pct(internal - cost, cost)} de la bodega` : "Costo + % de la bodega"} help="Lo que el punto le debe a la bodega por esta mercancía (precio interno congelado al trasladar)." tone="accent" />
              <Box label={`③ A precio de venta (P${level})`} value={money(sale)} sub="Si vende todo a su precio de lista" help="Unidades × precio de venta del punto (con su regla de precio)." />
              {costs ? <Box label="Ganancia de la bodega" value={money(internal - cost)} sub="② − ①" help="Lo que gana la bodega al cobrarle al punto." tone="good" /> : null}
              <Box label="Ganancia del punto" value={money(sale - internal)} sub={`③ − ② · margen ${pct(sale - internal, sale)}`} help="Lo que ganaría el punto si vende todo a ese precio, después de pagarle a la bodega." tone={sale - internal >= 0 ? "good" : "bad"} />
              {costs ? <Box label="Ganancia total (cadena)" value={money(sale - cost)} sub={`③ − ① · margen ${pct(sale - cost, sale)}`} help="Todo lo que gana el negocio (bodega + punto) si se vende todo." tone="good" /> : null}
            </div>
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

          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none" style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar producto o código" aria-label="Buscar producto" />
              <select className="rounded-xl border px-2 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar">
                <option value="sale">Más valor en venta</option>
                <option value="profit">Más ganancia del punto</option>
                <option value="qty">Más unidades</option>
                <option value="name">Nombre</option>
              </select>
            </div>
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
              <table className="w-full min-w-[720px] text-xs">
                <thead style={{ color: "var(--t-muted)" }}>
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Und.</th>
                    {costs ? <th className="px-3 py-2 text-right">Costo</th> : null}
                    <th className="px-3 py-2 text-right">Bodega</th>
                    <th className="px-3 py-2 text-right">Venta P{level}</th>
                    <th className="px-3 py-2 text-right">Total venta</th>
                    <th className="px-3 py-2 text-right">Gana el punto</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.slice(0, 400).map((l) => {
                    const gain = (l.sale - l.internal) * l.qty;
                    return (
                      <tr key={l.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            {l.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={l.image_url} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                            ) : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}>📦</span>}
                            <span className="min-w-0"><span className="line-clamp-1 font-semibold">{l.name}</span>{l.sku ? <span className="block text-[10px]" style={{ color: "var(--t-muted)" }}>{l.sku}</span> : null}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                        {costs ? <td className="px-3 py-1.5 text-right tabular-nums">{money(l.cost)}</td> : null}
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(l.internal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(l.sale)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(l.sale * l.qty)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: gain >= 0 ? "#10b981" : "#ef4444" }}>{money(gain)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lines.length > 400 ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Se muestran 400 de {lines.length}. Usa el buscador o exporta para ver todos.</p> : null}
          </section>
        </>
      ) : null}
    </Modal>
  );
}
