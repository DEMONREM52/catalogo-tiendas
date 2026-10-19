"use client";

import { useState } from "react";
import type { Line } from "./LineEditor";
import { money } from "./shared";
import { priceFromMarkup, uniformMarkup, type PurchasePricing } from "./purchase-pricing";

const QUICK = [10, 15, 20, 25, 30, 40, 50];

/**
 * Barra del % de ganancia en el ingreso de factura: un % para todos los productos (o solo para los que no tienen),
 * con el resumen de cómo quedan las ventas y la ganancia de la factura.
 */
export function MarkupToolbar({ lines, pricing, onChange }: { lines: Line[]; pricing: PurchasePricing; onChange: (lines: Line[]) => void }) {
  const [value, setValue] = useState("");
  const pct = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 1000;

  const apply = (p: number, onlyEmpty: boolean) =>
    onChange(lines.map((l) => (onlyEmpty && (l.markup != null || uniformMarkup(pricing.info[l.product_id]) !== null) ? l : { ...l, markup: p })));
  const clear = () => onChange(lines.map((l) => ({ ...l, markup: null })));

  // Resumen de la factura con los % que quedarían (los escritos o, si no, los que ya tiene cada producto).
  let saleTotal = 0, costTotal = 0, priced = 0, changed = 0;
  for (const l of lines) {
    const p = l.markup ?? uniformMarkup(pricing.info[l.product_id]);
    if (l.markup != null) changed++;
    if (p === null || p === undefined || !(l.unit_cost > 0)) continue;
    priced++;
    costTotal += l.qty * l.unit_cost;
    saleTotal += l.qty * priceFromMarkup(l.unit_cost, p, pricing.step, pricing.dir);
  }
  const gain = saleTotal - costTotal;

  return (
    <div className="mb-3 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold">💹 % de ganancia (los 5 precios)</span>
        <div className="relative">
          <input
            className="w-20 rounded-lg border px-2 py-1.5 pr-6 text-right text-sm font-bold outline-none"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}
            inputMode="decimal"
            value={value}
            placeholder="20"
            aria-label="% de ganancia para todos"
            onChange={(e) => setValue(e.target.value.replace(/[^\d,.]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); apply(pct, false); } }}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "var(--t-muted)" }}>%</span>
        </div>
        <button type="button" disabled={!valid} className="rounded-lg px-3 py-1.5 font-bold text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }} onClick={() => apply(pct, false)}>
          Aplicar a todos
        </button>
        <button type="button" disabled={!valid} className="rounded-lg border px-3 py-1.5 font-bold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} onClick={() => apply(pct, true)} title="Solo a los productos que todavía no tienen %">
          Solo a los que no tienen
        </button>
        <span className="mx-1 hidden h-5 w-px sm:block" style={{ background: "var(--t-card-border)" }} />
        {QUICK.map((q) => (
          <button key={q} type="button" className="rounded-full border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => { setValue(String(q)); apply(q, false); }}>
            {q}%
          </button>
        ))}
        {changed ? <button type="button" className="ml-auto font-bold" style={{ color: "#ef4444" }} onClick={clear}>Quitar los % escritos</button> : null}
      </div>
      <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
        {priced ? (
          <>Con estos % la factura vale <b style={{ color: "var(--t-text)" }}>{money(saleTotal)}</b> a precio de venta (P3) · ganancia <b style={{ color: gain >= 0 ? "#10b981" : "#ef4444" }}>{money(gain)}</b>{costTotal > 0 ? ` (${((gain / costTotal) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} % sobre el costo)` : ""}. </>
        ) : null}
        {changed ? <b style={{ color: "var(--t-accent)" }}>{changed} producto(s) cambian de precio al guardar. </b> : "Escribe el % en cada producto o aplícalo a todos. "}
        Redondeo de la tienda: {pricing.step ? `a ${money(pricing.step)} ${pricing.dir === "up" ? "hacia arriba" : pricing.dir === "down" ? "hacia abajo" : "más cercano"}` : "sin redondeo"}.
        {pricing.basis === "average" ? " Ojo: tu tienda calcula los precios con el costo PROMEDIO, así que el precio final puede variar un poco." : ""}
      </p>
    </div>
  );
}
