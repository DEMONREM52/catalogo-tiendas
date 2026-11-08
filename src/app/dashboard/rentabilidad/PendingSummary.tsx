"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cop } from "./shared";

type Breakdown = { orders: Array<{ lines: Array<{ revenue: number; cost: number; profit: number }> }> };
type Adv = { amount: number; kind?: "advance" | "expense" };
const n = (v: unknown) => Number(v ?? 0);

/**
 * Lo que se va a liquidar, paso a paso: ventas − costo de la mercancía = ganancia; menos gastos y anticipos
 * (cada uno repartido como se escogió) = lo que se paga.
 */
export function PendingSummary({ storeId, point, refreshKey, pending, deduct }: {
  storeId: string; point: string | null; refreshKey: number; deduct: boolean;
  pending: { gross_total?: number; expenses_total?: number; carried_total: number; advances_total?: number; advances?: Adv[]; pool_total: number;
    merch_cost?: number; cost_advances_total?: number; cost_due?: number; advances_pending_cost?: number };
}) {
  const [sales, setSales] = useState<{ revenue: number; cost: number; profit: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabaseBrowser().rpc("erp_settlement_breakdown", { p_store: storeId, p_point: point, p_cutoff: null, p_settlement: null });
      if (!alive || error) return;
      const lines = ((data as Breakdown).orders ?? []).flatMap((o) => o.lines ?? []);
      setSales({ revenue: lines.reduce((t, l) => t + n(l.revenue), 0), cost: lines.reduce((t, l) => t + n(l.cost), 0), profit: lines.reduce((t, l) => t + n(l.profit), 0) });
    })();
    return () => { alive = false; };
  }, [storeId, point, refreshKey]);

  const adv = (pending.advances ?? []);
  const shared = adv.filter((a) => a.kind === "expense").reduce((t, a) => t + n(a.amount), 0);
  // Desde 20261289 los anticipos se abonan al costo (no vienen en la lista de descuentos).
  const costMode = pending.merch_cost !== undefined && pending.merch_cost !== null;
  const advances = costMode ? 0 : adv.filter((a) => (a.kind ?? "advance") === "advance").reduce((t, a) => t + n(a.amount), 0);
  const gross = n(pending.gross_total ?? pending.pool_total);
  const toPay = n(pending.pool_total) + n(pending.carried_total) - n(pending.advances_total);
  const differs = sales && Math.abs(sales.profit - gross) >= 1;

  const row = (label: string, value: number, opts: { minus?: boolean; strong?: boolean; hint?: string; tone?: string } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${opts.strong ? "border-t pt-2 text-base font-black" : "text-sm"}`} style={opts.strong ? { borderColor: "var(--t-card-border)" } : undefined}>
      <span className="min-w-0">{opts.minus ? "− " : ""}{label}{opts.hint ? <span className="block text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>{opts.hint}</span> : null}</span>
      <b className="shrink-0 tabular-nums" style={{ color: opts.tone }}>{opts.minus ? "−" : ""}{cop(Math.abs(value))}</b>
    </div>
  );

  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
      {sales ? (
        <>
          {row("Ventas", sales.revenue)}
          {row("Costo de la mercancía", sales.cost, { minus: true, tone: "#e66767" })}
          {costMode && n(pending.cost_advances_total) ? (
            <div className="my-1 rounded-lg border px-3 py-1.5" style={{ borderColor: "color-mix(in oklab, #f59e0b 40%, var(--t-card-border))", background: "color-mix(in oklab, #f59e0b 6%, transparent)" }}>
              {row("Anticipos ya entregados (abono al costo)", n(pending.cost_advances_total), { minus: true, tone: "#f59e0b" })}
              {row("Costo que falta entregar", n(pending.cost_due), { hint: n(pending.advances_pending_cost) > n(pending.cost_advances_total) ? `Quedan ${cop(n(pending.advances_pending_cost) - n(pending.cost_advances_total))} de anticipos para la siguiente liquidación.` : undefined })}
            </div>
          ) : null}
          {row("Ganancia de las ventas", sales.profit, { strong: false, tone: sales.profit < 0 ? "#e66767" : "#22c55e" })}
          {differs ? row("Entra ahora (solo lo cobrado y ajustes)", gross, { hint: "Las ventas a crédito entran a medida que se cobran." }) : null}
        </>
      ) : row("Ganancia", gross)}
      {deduct || n(pending.expenses_total) ? row("Gastos y nómina del punto", n(pending.expenses_total), { minus: true, tone: "#e66767" }) : null}
      {n(pending.carried_total) ? row(n(pending.carried_total) < 0 ? "Saldo en contra traído" : "Saldo traído", n(pending.carried_total), { minus: n(pending.carried_total) < 0, tone: n(pending.carried_total) < 0 ? "#e66767" : undefined }) : null}
      {shared ? row("Gastos compartidos", shared, { minus: true, tone: "#e66767", hint: "Repartidos como se escogió en cada uno" }) : null}
      {advances ? row("Anticipos", advances, { minus: true, tone: "#e66767" }) : null}
      {row("A repartir entre los beneficiarios", toPay, { strong: true, tone: toPay < 0 ? "#e66767" : undefined })}
    </div>
  );
}
