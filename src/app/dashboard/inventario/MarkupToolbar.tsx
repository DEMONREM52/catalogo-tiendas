"use client";

import { useState } from "react";
import type { Line } from "./LineEditor";
import { money } from "./shared";
import { PctInput } from "./PctInput";
import { uniformMarkup, type PurchasePricing } from "./purchase-pricing";

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

  // Sin totales de ganancia ni margen: quien ingresa facturas solo ve el % y el precio de venta de cada producto.
  const changed = lines.filter((l) => l.markup != null).length;

  return (
    <div className="mb-3 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold">💹 % de ganancia (los 5 precios)</span>
        <PctInput
          size="sm"
          className="w-24"
          value={value}
          placeholder="20"
          ariaLabel="% de ganancia para todos"
          onChange={setValue}
          onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); apply(pct, false); } }}
        />
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
        {changed ? <b style={{ color: "var(--t-accent)" }}>{changed} producto(s) cambian de precio al guardar. </b> : "Escribe el % en cada producto o aplícalo a todos. "}
        Redondeo de la tienda: {pricing.step ? `a ${money(pricing.step)} ${pricing.dir === "up" ? "hacia arriba" : pricing.dir === "down" ? "hacia abajo" : "más cercano"}` : "sin redondeo"}.
        {pricing.basis === "average" ? " Ojo: tu tienda calcula los precios con el costo PROMEDIO, así que el precio final puede variar un poco." : ""}
      </p>
    </div>
  );
}
