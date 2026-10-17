"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { cop, esc, rpcError } from "./shared";

/** Lo que necesita el informe (lo que trae erp_settlement_detail). */
export type ReportDetail = {
  settlement: {
    id: string; number: number; cutoff: string; status: string; pool_total: number; carried_total: number; assigned_total: number; unassigned_total: number;
    point_name: string | null; created_by_name: string | null; created_at: string; submitted_by_name?: string | null; decided_by_name: string | null;
    decision_note: string | null; revert_reason: string | null; notes: string | null; split_version: number | null;
    gross_total?: number | null; expenses_total?: number | null; mode?: string | null; deducted?: boolean;
  };
  lines: Array<{ id: string; name: string; document: string | null; pct: number; share_amount: number; carried_amount: number; amount: number; paid: number }>;
  payments: Array<{ line_id: string; amount: number; method: string; reference: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null }>;
};
type Line = { name: string; sku: string | null; qty: number; revenue: number; cost: number; profit: number; mother: number; point: number; cost_source: string };
type Breakdown = {
  orders: Array<{ receipt_no: number | null; doc_number: string | null; sold_at: string; seller_name: string | null; customer_name: string | null; delta: number; credit: boolean; lines: Line[] }>;
  expenses: Array<{ source_type: string; label: string | null; delta: number }>;
  mode: "total" | "margin" | "mother";
};

const STATUS: Record<string, string> = {
  calculated: "Calculada", review: "En revisión", approved: "Aprobada · por pagar", partially_paid: "Pago parcial", paid: "Pagada",
  rejected: "Rechazada / descartada", reverted: "Revertida",
};
const METHODS: Record<string, string> = { transfer: "Transferencia", cash: "Efectivo", nequi: "Nequi / Daviplata", other: "Otro" };
const MODE: Record<string, string> = {
  total: "Ganancia total del punto (precio de venta − costo al momento de la venta)",
  margin: "Lo que el punto agrega sobre el precio de la madre",
  mother: "Parte de la madre (precio de la madre − costo)",
};
const n = (v: unknown) => Number(v ?? 0);
const dt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—");
const day = (d: string) => new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : "—");

/**
 * Informe completo de una liquidación para guardar como PDF o imprimir: resumen, reparto y pagos por beneficiario,
 * cada venta con sus productos (venta, costo, ganancia, margen), gastos restados, firmas y auditoría.
 * Se abre en una ventana nueva y lanza la impresión («Guardar como PDF»).
 */
export async function openSettlementReport(d: ReportDetail): Promise<string | null> {
  // La ventana se abre YA (antes de esperar datos) para que el navegador no la bloquee.
  const w = window.open("", "_blank");
  if (!w) return "El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.";
  w.document.write("<p style='font-family:system-ui;padding:24px'>Preparando el informe…</p>");
  const [{ data, error }, access] = await Promise.all([
    supabaseBrowser().rpc("erp_settlement_breakdown", { p_store: null, p_point: null, p_cutoff: null, p_settlement: d.settlement.id }),
    getDashboardStore().catch(() => null),
  ]);
  if (error) { w.close(); return rpcError(error); }
  const b = data as Breakdown;
  const s = d.settlement;
  const store = access?.store;
  const lines = b.orders.flatMap((o) => o.lines);
  const sales = lines.reduce((t, l) => t + n(l.revenue), 0);
  const cost = lines.reduce((t, l) => t + n(l.cost), 0);
  const profit = lines.reduce((t, l) => t + n(l.profit), 0);
  const units = lines.reduce((t, l) => t + n(l.qty), 0);
  const expenses = b.expenses.reduce((t, e) => t + n(e.delta), 0);
  const gross = s.gross_total ?? b.orders.reduce((t, o) => t + n(o.delta), 0);
  const pool = s.point_name ? `Punto ${s.point_name}` : "Madre";
  const title = `Liquidación #${s.number} · ${pool}`;
  const fileTitle = `Liquidacion-${s.number}-${(s.point_name ?? "Madre").replace(/[^\p{L}\p{N}]+/gu, "-")}`;
  const paidBy = (lineId: string) => d.payments.filter((p) => p.line_id === lineId && !p.voided).reduce((t, p) => t + n(p.amount), 0);

  const orderRows = b.orders.map((o) => {
    const oc = o.lines.reduce((t, l) => t + n(l.cost), 0), or = o.lines.reduce((t, l) => t + n(l.revenue), 0), op = o.lines.reduce((t, l) => t + n(l.profit), 0);
    return `
      <tr class="grp"><td colspan="6"><b>${esc(o.doc_number ?? `#${o.receipt_no ?? ""}`)}</b> · ${esc(day(o.sold_at))}${o.seller_name ? ` · vendió ${esc(o.seller_name)}` : ""}${o.customer_name ? ` · ${esc(o.customer_name)}` : ""}${o.credit ? " · crédito (entra lo cobrado)" : ""}</td>
        <td class="r"><b>${esc(cop(o.delta))}</b></td></tr>
      ${o.lines.map((l) => `<tr><td>${esc(l.name)}${l.sku ? ` <span class="m">· ${esc(l.sku)}</span>` : ""}${n(l.cost) <= 0 ? " <b class='bad'>SIN COSTO</b>" : ""}${l.cost_source === "fixed_later" ? " <span class='m'>(costo puesto después)</span>" : ""}</td>
        <td class="r">${n(l.qty)}</td><td class="r">${esc(cop(l.revenue))}</td><td class="r">${esc(cop(l.cost))}</td>
        <td class="r${n(l.profit) < 0 ? " bad" : ""}"><b>${esc(cop(l.profit))}</b></td><td class="r m">${pct(n(l.profit), n(l.revenue))}</td>
        <td class="r m">${b.mode === "total" ? "" : esc(cop(b.mode === "margin" ? l.point : l.mother))}</td></tr>`).join("")}
      <tr class="sub"><td class="r m">Subtotal</td><td></td><td class="r">${esc(cop(or))}</td><td class="r">${esc(cop(oc))}</td><td class="r">${esc(cop(op))}</td><td class="r m">${pct(op, or)}</td><td></td></tr>`;
  }).join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(fileTitle)}</title><style>
    *{box-sizing:border-box} body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0;padding:28px;font-size:11.5px;background:#fff}
    h1{font-size:20px;margin:0} h2{font-size:13px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #111;padding-bottom:4px}
    .m{color:#666} .bad{color:#b91c1c} .head{display:flex;gap:14px;align-items:center;border-bottom:2px solid #111;padding-bottom:12px}
    .head img{height:54px;width:54px;object-fit:cover;border-radius:10px} .pill{display:inline-block;border:1px solid #111;border-radius:999px;padding:1px 9px;font-weight:700;font-size:11px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px} .box{border:1px solid #ccc;border-radius:8px;padding:8px 10px}
    .box .k{font-size:10px;color:#666;text-transform:uppercase;font-weight:700} .box .v{font-size:15px;font-weight:900;margin-top:2px}
    .formula{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:8px;background:#f4f4f5}
    table{width:100%;border-collapse:collapse} th{text-align:left;font-size:10px;text-transform:uppercase;color:#555;border-bottom:1.5px solid #111;padding:5px 4px}
    td{border-bottom:1px solid #e5e5e5;padding:4px;vertical-align:top} .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    tr.grp td{background:#f4f4f5;border-top:1px solid #ccc} tr.sub td{font-size:10.5px} tr.tot td{font-weight:900;border-top:2px solid #111;font-size:12.5px}
    .sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:40px} .sig{border-top:1px solid #111;padding-top:4px}
    .foot{margin-top:24px;border-top:1px solid #ccc;padding-top:8px;font-size:10px;color:#666}
    @media print{@page{size:letter;margin:12mm} body{padding:0} tr{break-inside:avoid} h2{break-after:avoid}}
  </style></head><body>
  <div class="head">
    ${store?.logo_url ? `<img src="${esc(store.logo_url)}" alt="">` : ""}
    <div style="flex:1"><div style="font-weight:900;font-size:16px;text-transform:uppercase">${esc(store?.name ?? "RemHub")}</div>
      <div class="m">Informe de liquidación de ganancias · documento interno</div></div>
    <div style="text-align:right"><h1>${esc(title)}</h1><span class="pill">${esc(STATUS[s.status] ?? s.status)}</span></div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin-top:10px">
    <div><span class="m">Corte:</span> <b>${esc(dt(s.cutoff))}</b></div>
    <div><span class="m">Preparó:</span> <b>${esc(s.created_by_name ?? "—")}</b> · ${esc(dt(s.created_at))}</div>
    <div><span class="m">Aprobó:</span> <b>${esc(s.decided_by_name ?? "—")}</b></div>
    <div style="grid-column:span 3"><span class="m">Cómo se calculó:</span> <b>${esc(MODE[s.mode ?? b.mode] ?? MODE[b.mode])}</b>${s.split_version ? ` · reparto versión ${s.split_version}` : ""}</div>
    ${s.notes ? `<div style="grid-column:span 3"><span class="m">Nota:</span> <b>${esc(s.notes)}</b></div>` : ""}
    ${s.decision_note ? `<div style="grid-column:span 3"><span class="m">Decisión:</span> ${esc(s.decision_note)}</div>` : ""}
    ${s.revert_reason ? `<div style="grid-column:span 3" class="bad"><b>Revertida:</b> ${esc(s.revert_reason)}</div>` : ""}
  </div>

  <h2>Resumen</h2>
  <div class="grid">
    <div class="box"><div class="k">Ventas</div><div class="v">${esc(cop(sales))}</div><div class="m">${units} und. · ${b.orders.length} venta(s)</div></div>
    <div class="box"><div class="k">Costo de lo vendido</div><div class="v">${esc(cop(cost))}</div></div>
    <div class="box"><div class="k">Ganancia</div><div class="v">${esc(cop(profit))}</div><div class="m">margen ${pct(profit, sales)}</div></div>
    <div class="box"><div class="k">A repartir</div><div class="v">${esc(cop(n(s.pool_total) + n(s.carried_total)))}</div></div>
  </div>
  <div class="formula">Ganancia del período <b>${esc(cop(gross))}</b>${s.deducted || n(s.expenses_total) ? ` − gastos y nómina <b>${esc(cop(s.expenses_total))}</b>` : ""}${n(s.carried_total) ? ` + saldo traído <b>${esc(cop(s.carried_total))}</b>` : ""} = <b>${esc(cop(n(s.pool_total) + n(s.carried_total)))}</b> a repartir${n(s.unassigned_total) ? ` · sin asignar ${esc(cop(s.unassigned_total))}` : ""}</div>
  ${b.mode !== "total" ? `<p class="m" style="margin-top:6px">Ganancia total ${esc(cop(profit))} = parte de la madre ${esc(cop(lines.reduce((t, l) => t + n(l.mother), 0)))} + parte del punto ${esc(cop(lines.reduce((t, l) => t + n(l.point), 0)))}.</p>` : ""}

  <h2>Reparto entre beneficiarios</h2>
  <table><thead><tr><th>Beneficiario</th><th>Documento</th><th class="r">%</th><th class="r">Del período</th><th class="r">Saldo traído</th><th class="r">Total</th><th class="r">Pagado</th><th class="r">Pendiente</th></tr></thead><tbody>
    ${d.lines.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.document ?? "")}</td><td class="r">${n(l.pct)} %</td><td class="r">${esc(cop(l.share_amount))}</td><td class="r">${esc(cop(l.carried_amount))}</td><td class="r"><b>${esc(cop(l.amount))}</b></td><td class="r">${esc(cop(paidBy(l.id)))}</td><td class="r">${esc(cop(Math.max(0, n(l.amount) - paidBy(l.id))))}</td></tr>`).join("")}
    <tr class="tot"><td colspan="5">Total</td><td class="r">${esc(cop(d.lines.reduce((t, l) => t + n(l.amount), 0)))}</td><td class="r">${esc(cop(d.lines.reduce((t, l) => t + paidBy(l.id), 0)))}</td><td class="r">${esc(cop(d.lines.reduce((t, l) => t + Math.max(0, n(l.amount) - paidBy(l.id)), 0)))}</td></tr>
  </tbody></table>

  ${d.payments.length ? `<h2>Pagos registrados</h2>
  <table><thead><tr><th>Fecha</th><th>Beneficiario</th><th>Forma</th><th>Referencia</th><th>Registró</th><th class="r">Valor</th></tr></thead><tbody>
    ${d.payments.map((p) => `<tr${p.voided ? " style='opacity:.55;text-decoration:line-through'" : ""}><td>${esc(dt(p.paid_at))}</td><td>${esc(d.lines.find((l) => l.id === p.line_id)?.name ?? "")}</td><td>${esc(METHODS[p.method] ?? p.method)}</td><td>${esc(p.reference ?? "")}${p.voided ? ` (anulado: ${esc(p.void_reason ?? "")})` : ""}</td><td>${esc(p.created_by_name ?? "")}</td><td class="r"><b>${esc(cop(p.amount))}</b></td></tr>`).join("")}
  </tbody></table>` : ""}

  <h2>Ventas incluidas (detalle por producto)</h2>
  <table><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Venta</th><th class="r">Costo</th><th class="r">Ganancia</th><th class="r">Margen</th><th class="r">${b.mode === "total" ? "" : b.mode === "margin" ? "Al punto" : "A la madre"}</th></tr></thead><tbody>
    ${orderRows}
    <tr class="tot"><td>Total (${units} und.)</td><td></td><td class="r">${esc(cop(sales))}</td><td class="r">${esc(cop(cost))}</td><td class="r">${esc(cop(profit))}</td><td class="r">${pct(profit, sales)}</td><td></td></tr>
  </tbody></table>

  ${b.expenses.length ? `<h2>Gastos y nómina restados</h2><table><tbody>
    ${b.expenses.map((e) => `<tr><td>${e.source_type === "payroll" ? "Nómina" : "Gasto"} · ${esc(e.label ?? "")}</td><td class="r">${n(e.delta) > 0 ? "−" : "+"}${esc(cop(Math.abs(n(e.delta))))}</td></tr>`).join("")}
    <tr class="tot"><td>Total restado</td><td class="r">−${esc(cop(expenses))}</td></tr></tbody></table>` : ""}

  <div class="sigs">
    ${d.lines.map((l) => `<div class="sig"><b>${esc(l.name)}</b><div class="m">Recibí conforme · ${esc(cop(l.amount))}</div></div>`).join("")}
    <div class="sig"><b>${esc(s.decided_by_name ?? "Aprobó")}</b><div class="m">Aprobó la liquidación</div></div>
  </div>

  <div class="foot">Incluye ventas de contado confirmadas y lo cobrado de ventas a crédito; las ventas anuladas restan si ya se habían liquidado. El costo es el de cada producto al momento de la venta.
    Los pagos son registros en RemHub, no confirmación bancaria. Generado el ${esc(dt(new Date().toISOString()))} · RemHub.</div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return null;
}
