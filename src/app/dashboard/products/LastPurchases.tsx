"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ddmmyyyy } from "@/components/forms/Fields";

/**
 * Facturas de compra (ingresos) de un producto: la última arriba, con su comprobante, y las anteriores para ver cómo cambió el costo.
 * Solo se muestra a quien puede ver costos; si la persona no puede ver las compras, no aparece nada.
 */

type Row = {
  qty: number;
  unit_cost: number;
  purchase: { id: string; number: number; invoice_ref: string | null; invoice_date: string | null; created_at: string; status: string; supplier: { name: string } | null } | null;
};

const cop = (n: number) => `$ ${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
const receiptUrl = (id: string) => `/comprobante/ingreso/${id}?elegir=1`;
const dateOf = (r: Row) => r.purchase?.invoice_date ?? r.purchase?.created_at?.slice(0, 10) ?? "";

export function LastPurchases({ storeId, productId }: { storeId: string; productId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    const cols = (withSupplier: boolean) =>
      `qty,unit_cost,purchase:erp_purchases!inner(id,number,invoice_ref,invoice_date,created_at,status,store_id${withSupplier ? ",supplier:erp_suppliers(name)" : ""})`;
    const run = (withSupplier: boolean) =>
      sb.from("erp_purchase_items").select(cols(withSupplier))
        .eq("product_id", productId)
        .eq("purchase.store_id", storeId)
        .neq("purchase.status", "cancelled")
        .limit(200);
    void (async () => {
      let res = await run(true);
      if (res.error) res = await run(false);
      if (!alive) return;
      const list = ((res.error ? [] : res.data ?? []) as unknown as Row[]).filter((r) => r.purchase);
      // La más reciente primero (fecha de la factura; si no tiene, la de registro).
      list.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.purchase!.created_at).localeCompare(a.purchase!.created_at));
      setRows(list);
    })();
    return () => { alive = false; };
  }, [storeId, productId]);

  if (!rows || rows.length === 0) return null;
  const [last, ...prev] = rows;
  const lp = last.purchase!;
  const shown = all ? prev : prev.slice(0, 4);

  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>🧾 ÚLTIMA FACTURA DE COMPRA</p>
          <p className="mt-0.5 text-sm font-black">
            Ingreso #{lp.number}{lp.invoice_ref ? ` · Fact. ${lp.invoice_ref}` : ""}
          </p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {lp.supplier?.name ? `${lp.supplier.name} · ` : ""}{ddmmyyyy(dateOf(last))} · {Number(last.qty).toLocaleString("es-CO")} und. × <b style={{ color: "var(--t-text)" }}>{cop(last.unit_cost)}</b>
          </p>
        </div>
        <a href={receiptUrl(lp.id)} target="_blank" rel="noreferrer" className="shrink-0 rounded-xl border px-3 py-1.5 text-xs font-bold transition hover:brightness-110" style={{ borderColor: "var(--t-card-border)" }}>
          🧾 Ver factura
        </a>
      </div>

      {prev.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>COMPRAS ANTERIORES</p>
          <ul className="mt-1 space-y-1">
            {shown.map((r, i) => {
              const p = r.purchase!;
              // Comparado con la compra que le siguió (la de arriba).
              const newer = i === 0 ? last : shown[i - 1];
              const diff = Number(newer.unit_cost) - Number(r.unit_cost);
              return (
                <li key={`${p.id}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-xs" style={{ background: "color-mix(in oklab, var(--t-card-border) 25%, transparent)" }}>
                  <a href={receiptUrl(p.id)} target="_blank" rel="noreferrer" className="font-bold underline-offset-2 hover:underline">#{p.number}{p.invoice_ref ? ` · ${p.invoice_ref}` : ""}</a>
                  <span style={{ color: "var(--t-muted)" }}>{ddmmyyyy(dateOf(r))}{p.supplier?.name ? ` · ${p.supplier.name}` : ""}</span>
                  <span className="ml-auto tabular-nums">{Number(r.qty).toLocaleString("es-CO")} × <b>{cop(r.unit_cost)}</b></span>
                  {diff !== 0 ? (
                    <span className="tabular-nums text-[10px] font-bold" style={{ color: diff > 0 ? "#ef4444" : "#10b981" }} title="Cómo cambió el costo en la compra siguiente">
                      {diff > 0 ? "▲" : "▼"} {cop(Math.abs(diff))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {prev.length > 4 ? (
            <button type="button" className="mt-1 text-xs font-bold" style={{ color: "var(--t-accent)" }} onClick={() => setAll((v) => !v)}>
              {all ? "Ver menos" : `Ver las ${prev.length} compras anteriores`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
