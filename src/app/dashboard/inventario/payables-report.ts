/** Informe de cuentas por pagar: qué entra según el rango elegido y cómo se agrupa (sin navegador: se prueba solo). */
import type { PayableRow } from "./payables-shared";

export type ReportRange = { kind: "next"; days: number } | { kind: "dates"; from: string; to: string };
export type ReportGroup = "supplier" | "date" | "point" | "none";
export type ReportOptions = {
  range: ReportRange;
  overdue: boolean;
  supplierId: string;
  point: string;
  group: ReportGroup;
};
export type ReportRow = { supplier: string; point: string; purchase: number | null; invoice: string | null; due: string | null; days: number | null; total: number; balance: number };
export type ReportSection = { title: string; rows: ReportRow[]; balance: number };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const ddmmyyyy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "Sin fecha");

/** Fechas del rango (desde/hasta) para mostrarlas en el título. */
export function rangeDates(range: ReportRange, today: string) {
  return range.kind === "next" ? { from: today, to: addDays(today, range.days) } : { from: range.from || today, to: range.to || range.from || today };
}

export function buildPayablesReport(rows: PayableRow[], opts: ReportOptions, today: string, supplierName: (r: PayableRow) => string) {
  const { from, to } = rangeDates(opts.range, today);
  const picked = rows
    .filter((r) => r.status === "open" && Number(r.balance) > 0 && r.due_date)
    .filter((r) => (opts.overdue && r.due_date! < today) || (r.due_date! >= from && r.due_date! <= to))
    .filter((r) => !opts.supplierId || r.supplier_id === opts.supplierId)
    .filter((r) => !opts.point || (r.warehouse_name ?? "") === opts.point)
    .map((r): ReportRow => ({
      supplier: supplierName(r), point: r.warehouse_name ?? "—", purchase: r.purchase_number, invoice: r.invoice_ref,
      due: r.due_date, days: r.days_left, total: Number(r.total), balance: Number(r.balance),
    }))
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.supplier.localeCompare(b.supplier));

  const key = (r: ReportRow) => (opts.group === "supplier" ? r.supplier : opts.group === "point" ? r.point : opts.group === "date" ? ddmmyyyy(r.due) : "");
  const sections: ReportSection[] = [];
  for (const r of picked) {
    const k = key(r);
    let s = sections.find((x) => x.title === k);
    if (!s) sections.push((s = { title: k, rows: [], balance: 0 }));
    s.rows.push(r);
    s.balance += r.balance;
  }
  if (opts.group === "supplier" || opts.group === "point") sections.sort((a, b) => b.balance - a.balance);
  const overdue = picked.filter((r) => r.due! < today).reduce((s, r) => s + r.balance, 0);
  return { from, to, rows: picked, sections, total: picked.reduce((s, r) => s + r.balance, 0), overdue };
}
