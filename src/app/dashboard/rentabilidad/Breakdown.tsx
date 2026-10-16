"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Printer, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "@/components/forms/Sheet";
import { ExportGate } from "@/components/ExportGate";
import { logExport } from "@/lib/permission-runtime";
import { cop, downloadCsv, esc, inputStyle, rpcError } from "./shared";

type Line = { product_id: string; name: string; sku: string | null; qty: number; revenue: number; cost: number; profit: number; mother: number; point: number; cost_source: string };
type Order = {
  order_id: string; receipt_no: number | null; doc_number: string | null; sold_at: string; point_name: string | null; seller_name: string | null; customer_name: string | null;
  delta: number; eligible: number; credit: boolean; lines: Line[];
};
type Expense = { source_type: "expense" | "payroll"; source_id: string; eligible: number; delta: number; label: string | null; dated?: string };
type Data = { orders: Order[]; expenses: Expense[]; mode: "total" | "margin" | "mother" };

const n = (v: unknown) => Number(v ?? 0);
const day = (d: string) => new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
/** Lo que cuenta de una línea para el pozo según cómo se liquida. */
const poolPart = (l: Line, mode: Data["mode"]) => (mode === "total" ? n(l.profit) : mode === "mother" ? n(l.mother) : n(l.point));
const MODE_TEXT: Record<Data["mode"], string> = {
  total: "Ganancia total de cada producto: venta − costo al momento de la venta.",
  margin: "Lo que el punto agrega sobre el precio de la madre.",
  mother: "Parte de la madre: precio de la madre − costo.",
};

/**
 * Detalle de una liquidación (o de lo pendiente): cada venta con sus productos, venta, costo, ganancia y margen,
 * los gastos restados y los avisos (sin costo, con pérdida, crédito cobrado en parte, costo puesto después).
 */
export function BreakdownSheet({ storeId, point, settlementId, title, onClose }: {
  storeId: string; point: string | null; settlementId: string | null; title: string; onClose: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  useEffect(() => {
    void supabaseBrowser().rpc("erp_settlement_breakdown", { p_store: storeId, p_point: point, p_cutoff: null, p_settlement: settlementId })
      .then(({ data: d, error: e }) => (e ? setError(/breakdown|Could not find|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261208_liquidacion_ganancia_total.sql." : rpcError(e)) : setData(d as Data)));
  }, [storeId, point, settlementId]);

  const mode = data?.mode ?? "total";
  const orders = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.orders ?? []).filter((o) => {
      const issues = o.lines.some((l) => n(l.cost) <= 0 || n(l.profit) < 0 || l.cost_source === "fixed_later") || n(o.delta) !== n(o.eligible) || n(o.delta) < 0;
      if (onlyIssues && !issues) return false;
      if (!term) return true;
      return `${o.doc_number ?? ""} ${o.receipt_no ?? ""} ${o.customer_name ?? ""} ${o.seller_name ?? ""} ${o.lines.map((l) => `${l.name} ${l.sku ?? ""}`).join(" ")}`.toLowerCase().includes(term);
    });
  }, [data, q, onlyIssues]);

  const totals = useMemo(() => {
    const all = data?.orders ?? [];
    const lines = all.flatMap((o) => o.lines);
    return {
      revenue: lines.reduce((s, l) => s + n(l.revenue), 0),
      cost: lines.reduce((s, l) => s + n(l.cost), 0),
      profit: lines.reduce((s, l) => s + n(l.profit), 0),
      entering: all.reduce((s, o) => s + n(o.delta), 0),
      expenses: (data?.expenses ?? []).reduce((s, e) => s + n(e.delta), 0),
      units: lines.reduce((s, l) => s + n(l.qty), 0),
      noCost: lines.filter((l) => n(l.cost) <= 0).length,
      loss: lines.filter((l) => n(l.profit) < 0).length,
    };
  }, [data]);

  function rows() {
    return (data?.orders ?? []).flatMap((o) => o.lines.map((l) => [
      day(o.sold_at), o.doc_number ?? `#${o.receipt_no ?? ""}`, o.point_name ?? "", o.seller_name ?? "", o.customer_name ?? "", l.name, l.sku ?? "",
      n(l.qty), n(l.revenue), n(l.cost), n(l.profit), n(l.revenue) > 0 ? Math.round((n(l.profit) / n(l.revenue)) * 1000) / 10 : 0, poolPart(l, mode),
      n(o.delta) !== n(o.eligible) ? "crédito/ajuste" : "", n(l.cost) <= 0 ? "SIN COSTO" : l.cost_source === "fixed_later" ? "costo puesto después" : n(l.profit) < 0 ? "pérdida" : "",
    ] as Array<string | number>));
  }

  function exportCsv() {
    if (!data) return;
    logExport("liquidacion_detalle", rows().length, { settlement: settlementId });
    downloadCsv(`detalle-liquidacion${settlementId ? "" : "-pendiente"}.csv`,
      ["Fecha", "Documento", "Punto", "Vendedor", "Cliente", "Producto", "Ref.", "Cant.", "Venta", "Costo", "Ganancia", "Margen %", "Para el pozo", "Nota venta", "Aviso"],
      [...rows(), [], ...data.expenses.map((e) => [e.dated ? day(e.dated) : "", e.source_type === "payroll" ? "Nómina" : "Gasto", "", "", "", e.label ?? "", "", "", "", "", -n(e.delta), "", -n(e.delta), "", ""] as Array<string | number>)],
      [`RemHub · ${title}`, MODE_TEXT[mode], `Ventas ${cop(totals.revenue)} · Costo ${cop(totals.cost)} · Ganancia ${cop(totals.profit)} · Gastos ${cop(totals.expenses)} · A repartir ${cop(totals.entering - totals.expenses)}`,
       `Generado: ${new Date().toLocaleString("es-CO")}`]);
  }

  function print() {
    if (!data) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const body = data.orders.map((o) => `
      <tr class="o"><td colspan="6"><b>${esc(o.doc_number ?? `#${o.receipt_no ?? ""}`)}</b> · ${esc(day(o.sold_at))}${o.seller_name ? ` · ${esc(o.seller_name)}` : ""}${o.customer_name ? ` · ${esc(o.customer_name)}` : ""}${n(o.delta) !== n(o.eligible) ? ` · entra ${esc(cop(o.delta))}` : ""}</td></tr>
      ${o.lines.map((l) => `<tr><td>${esc(l.name)}${n(l.cost) <= 0 ? " <b>(sin costo)</b>" : ""}</td><td class="r">${n(l.qty)}</td><td class="r">${esc(cop(l.revenue))}</td><td class="r">${esc(cop(l.cost))}</td><td class="r"><b>${esc(cop(l.profit))}</b></td><td class="r">${n(l.revenue) > 0 ? ((n(l.profit) / n(l.revenue)) * 100).toFixed(1) : "0"} %</td></tr>`).join("")}`).join("");
    const exp = data.expenses.map((e) => `<tr><td colspan="4">${esc(e.label ?? "")}</td><td class="r">−${esc(cop(e.delta))}</td><td></td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#111;margin:24px;font-size:12px} h1{font-size:18px;margin:0} p{margin:4px 0;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:12px} th{text-align:left;border-bottom:1.5px solid #111;font-size:10.5px;text-transform:uppercase;padding:5px}
      td{border-bottom:1px solid #ddd;padding:5px} .r{text-align:right;white-space:nowrap} tr.o td{background:#f4f4f5} .tot td{font-weight:800;border-top:2px solid #111}
      @media print{@page{size:letter;margin:12mm}}</style></head><body>
      <h1>${esc(title)}</h1><p>${esc(MODE_TEXT[mode])}</p>
      <table><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Venta</th><th class="r">Costo</th><th class="r">Ganancia</th><th class="r">Margen</th></tr></thead><tbody>
      ${body}
      <tr class="tot"><td>Total ventas (${totals.units} und.)</td><td></td><td class="r">${esc(cop(totals.revenue))}</td><td class="r">${esc(cop(totals.cost))}</td><td class="r">${esc(cop(totals.profit))}</td><td></td></tr>
      ${exp ? `<tr class="o"><td colspan="6"><b>Gastos restados</b></td></tr>${exp}` : ""}
      <tr class="tot"><td colspan="4">A repartir en esta liquidación</td><td class="r">${esc(cop(totals.entering - totals.expenses))}</td><td></td></tr>
      </tbody></table><p style="margin-top:14px">Generado el ${esc(new Date().toLocaleString("es-CO"))} · RemHub</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <Sheet title="Detalle por producto" subtitle={title} onClose={onClose} wide>
      {error ? <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
      {!data && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
      {data ? (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{MODE_TEXT[mode]} Solo entra lo cobrado de las ventas a crédito; las anuladas restan si ya se habían liquidado.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[["Ventas", totals.revenue], ["Costo", totals.cost], ["Ganancia", totals.profit], ["Gastos", -totals.expenses], ["A repartir", totals.entering - totals.expenses]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p>
                <p className="font-black tabular-nums" style={n(v) < 0 ? { color: "#e66767" } : undefined}>{cop(v as number)}</p>
              </div>
            ))}
          </div>
          {totals.noCost || totals.loss ? (
            <p className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {totals.noCost ? `${totals.noCost} producto(s) sin costo. ` : ""}{totals.loss ? `${totals.loss} producto(s) vendido(s) con pérdida.` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar factura, producto, vendedor o cliente…" className="w-full rounded-xl border py-2 pr-3 text-sm" style={{ ...inputStyle, paddingLeft: "2.2rem" }} />
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-violet-500" /> Solo con avisos</label>
            <ExportGate><button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Excel</button></ExportGate>
            <button type="button" onClick={print} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Printer size={13} /> Imprimir / PDF</button>
          </div>

          {orders.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>No hay ventas con estos filtros.</p> : null}
          <ul className="space-y-2">
            {orders.map((o) => {
              const full = o.lines.reduce((s, l) => s + poolPart(l, mode), 0);
              const partial = Math.abs(n(o.delta) - full) > 0.5;
              return (
                <li key={o.order_id} className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-xs" style={{ background: "color-mix(in oklab, var(--t-card-border) 30%, transparent)" }}>
                    <b className="text-sm">{o.doc_number ?? `#${o.receipt_no ?? ""}`}</b>
                    <span style={{ color: "var(--t-muted)" }}>{day(o.sold_at)}{o.seller_name ? ` · ${o.seller_name}` : ""}{o.customer_name ? ` · ${o.customer_name}` : ""}{o.credit ? " · crédito" : ""}</span>
                    <span className="ml-auto font-bold tabular-nums" style={n(o.delta) < 0 ? { color: "#e66767" } : undefined}>
                      {partial ? <span className="mr-1 font-normal" style={{ color: "var(--t-muted)" }}>{n(o.delta) < 0 ? "ajuste" : `entra de ${cop(full)}`}</span> : null}
                      {cop(o.delta)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead style={{ color: "var(--t-muted)" }}>
                        <tr className="text-left text-[10px] uppercase">
                          <th className="px-3 py-1.5">Producto</th><th className="px-2 text-right">Cant.</th><th className="px-2 text-right">Venta</th>
                          <th className="px-2 text-right">Costo</th><th className="px-2 text-right">Ganancia</th><th className="px-3 text-right">Margen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.lines.map((l) => {
                          const m = n(l.revenue) > 0 ? (n(l.profit) / n(l.revenue)) * 100 : 0;
                          const bad = n(l.cost) <= 0 || n(l.profit) < 0;
                          return (
                            <tr key={l.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)", background: bad ? "color-mix(in oklab, #ef4444 8%, transparent)" : undefined }}>
                              <td className="px-3 py-1.5">
                                <span className="font-semibold">{l.name}</span>
                                {n(l.cost) <= 0 ? <span className="ml-1 rounded bg-red-500 px-1 text-[10px] font-bold text-white">SIN COSTO</span> : null}
                                {l.cost_source === "fixed_later" ? <span className="ml-1 text-[10px]" style={{ color: "#f59e0b" }}>costo puesto después</span> : null}
                              </td>
                              <td className="px-2 text-right tabular-nums">{n(l.qty)}</td>
                              <td className="px-2 text-right tabular-nums">{cop(l.revenue)}</td>
                              <td className="px-2 text-right tabular-nums">{cop(l.cost)}</td>
                              <td className="px-2 text-right font-bold tabular-nums" style={n(l.profit) < 0 ? { color: "#e66767" } : undefined}>{cop(l.profit)}</td>
                              <td className="px-3 text-right tabular-nums" style={{ color: "var(--t-muted)" }}>{m.toFixed(1)} %</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>

          {data.expenses.length ? (
            <section className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-xs font-bold uppercase" style={{ color: "var(--t-muted)" }}>Gastos y nómina restados</p>
              <ul className="mt-1 space-y-1 text-sm">
                {data.expenses.map((e) => (
                  <li key={`${e.source_type}-${e.source_id}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{e.source_type === "payroll" ? "👥" : "💸"} {e.label}</span>
                    <b className="tabular-nums" style={{ color: n(e.delta) > 0 ? "#e66767" : "#22c55e" }}>{n(e.delta) > 0 ? "−" : "+"}{cop(Math.abs(n(e.delta)))}</b>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
