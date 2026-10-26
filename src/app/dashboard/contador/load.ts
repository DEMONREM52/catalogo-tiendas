import { supabaseBrowser } from "@/lib/supabase/client";
import type { DocKind } from "@/lib/accounting/config";
import type { Sources } from "@/lib/accounting/journal";
import { all, byIds } from "../datos/exports";

/**
 * Trae del periodo lo que va a la contabilidad. Cada consulta respeta los permisos de quien exporta:
 * lo que no puede ver queda por fuera y se avisa (no se inventa nada).
 */
type Row = Record<string, unknown>;
const sb = () => supabaseBrowser();
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const startOf = (d: string) => `${d}T00:00:00-05:00`;
const endOf = (d: string) => `${d}T23:59:59-05:00`;
/** Fecha en Colombia (AAAA-MM-DD) de una marca de tiempo. */
const day = (ts: unknown) => (ts ? new Date(String(ts)).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) : "");

export type Lookups = { points: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> };
export type Loaded = { sources: Sources; skipped: Array<{ kind: DocKind; reason: string }>; costHidden: boolean };

export async function loadLookups(storeId: string): Promise<Lookups> {
  const [wh, cats] = await Promise.all([
    sb().from("erp_warehouses").select("id,name").eq("store_id", storeId).order("name"),
    sb().from("erp_expense_categories").select("id,name").eq("store_id", storeId).order("sort_order"),
  ]);
  return { points: (wh.data ?? []) as Lookups["points"], categories: (cats.data ?? []) as Lookups["categories"] };
}

async function safe<T>(kind: DocKind, skipped: Loaded["skipped"], run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    skipped.push({ kind, reason: e instanceof Error ? e.message : String(e) });
    return empty;
  }
}

export async function loadPeriod(storeId: string, from: string, to: string, include: Record<DocKind, boolean>, step: (t: string) => void): Promise<Loaded> {
  const skipped: Loaded["skipped"] = [];
  let costHidden = false;
  const customers = new Map<string, Row>();
  async function customerDocs(ids: string[]) {
    const need = [...new Set(ids.filter((id) => id && !customers.has(id)))];
    if (!need.length) return;
    for (const c of await byIds("billing_customers", "id,name,document_number,doc_number", "id", need)) customers.set(String(c.id), c);
  }
  const custDoc = (id: unknown) => { const c = customers.get(String(id)); return str(c?.document_number) ?? str(c?.doc_number); };
  const custName = (id: unknown) => str(customers.get(String(id))?.name);

  const sales = !include.sale ? [] : await safe("sale", skipped, async () => {
    step("Ventas…");
    const orders = await all((a, b) => sb().from("orders").select("id,created_at,confirmed_at,status,customer_name,total")
      .eq("store_id", storeId).in("status", ["confirmed", "completed"]).gte("created_at", startOf(from)).lte("created_at", endOf(to)).order("created_at").range(a, b));
    const ids = orders.map((o) => String(o.id));
    const metas = await byIds("erp_order_meta", "order_id,doc_number,point_id,customer_doc,payment", "order_id", ids, step, "Documentos");
    const items = await byIds("order_items", "order_id,product_id,quantity,price", "order_id", ids, step, "Detalle de ventas");
    const recs = await byIds("erp_receivables", "order_id,customer_id,status", "order_id", ids, step, "Ventas a crédito");
    const pids = [...new Set(items.map((i) => String(i.product_id)))];
    let prods: Row[] = [];
    try {
      prods = await byIds("products", "id,tax_rate,cost_price", "id", pids, step, "Productos");
    } catch {
      // Sin permiso de ver costos: el IVA sí, el costo no.
      costHidden = true;
      prods = await byIds("products", "id,tax_rate", "id", pids, step, "Productos");
    }
    const prod = new Map(prods.map((p) => [String(p.id), p]));
    const meta = new Map(metas.map((m) => [String(m.order_id), m]));
    const credit = new Map(recs.filter((r) => r.status !== "void").map((r) => [String(r.order_id), r]));
    await customerDocs([...credit.values()].map((r) => String(r.customer_id)));
    const byOrder = new Map<string, Row[]>();
    for (const i of items) byOrder.set(String(i.order_id), [...(byOrder.get(String(i.order_id)) ?? []), i]);
    return orders.map((o) => {
      const id = String(o.id);
      const m = meta.get(id);
      const rec = credit.get(id);
      const pay = (m?.payment ?? null) as { method?: string; parts?: Array<{ method: string; amount: number }> } | null;
      const parts = pay?.parts?.length ? pay.parts : pay?.method && pay.method !== "mixto" ? [{ method: pay.method, amount: num(o.total) }] : [];
      return {
        id, date: day(o.confirmed_at ?? o.created_at), number: str(m?.doc_number) ?? id.slice(0, 8).toUpperCase(), pointId: str(m?.point_id),
        customerDoc: str(m?.customer_doc) ?? (rec ? custDoc(rec.customer_id) : null), customerName: str(o.customer_name) ?? (rec ? custName(rec.customer_id) : null),
        total: num(o.total), credit: Boolean(rec),
        lines: (byOrder.get(id) ?? []).map((i) => { const p = prod.get(String(i.product_id)); return { qty: num(i.quantity), price: num(i.price), taxRate: num(p?.tax_rate), cost: num(p?.cost_price) }; }),
        payments: parts.map((p) => ({ method: String(p.method), amount: num(p.amount) })),
      };
    });
  }, [] as Sources["sales"]);

  const sups = new Map<string, Row>();
  async function supplierRows() {
    if (sups.size) return;
    for (const s of await all((a, b) => sb().from("erp_suppliers").select("id,name,nit").eq("store_id", storeId).order("id").range(a, b))) sups.set(String(s.id), s);
  }

  const purchases = !include.purchase ? [] : await safe("purchase", skipped, async () => {
    step("Compras…");
    await supplierRows();
    const rows = await all((a, b) => sb().from("erp_purchases").select("id,number,supplier_id,warehouse_id,status,invoice_ref,invoice_date,payment_type,due_date,subtotal,tax,total,created_at")
      .eq("store_id", storeId).eq("status", "received").gte("created_at", startOf(from)).lte("created_at", endOf(to)).order("created_at").range(a, b));
    return rows.map((r) => {
      const s = sups.get(String(r.supplier_id));
      return { id: String(r.id), date: str(r.invoice_date)?.slice(0, 10) ?? day(r.created_at), number: String(r.number), invoiceRef: str(r.invoice_ref), pointId: str(r.warehouse_id),
        supplierNit: str(s?.nit), supplierName: str(s?.name), subtotal: num(r.subtotal), tax: num(r.tax), total: num(r.total), credit: r.payment_type === "credit", dueDate: str(r.due_date) };
    });
  }, [] as Sources["purchases"]);

  const receipts = !include.receipt ? [] : await safe("receipt", skipped, async () => {
    step("Recibos de caja…");
    const rows = await all((a, b) => sb().from("erp_receivable_payments").select("id,receivable_id,customer_id,amount,method,reference,paid_at,voided")
      .eq("store_id", storeId).gte("paid_at", startOf(from)).lte("paid_at", endOf(to)).order("paid_at").range(a, b));
    const live = rows.filter((r) => !r.voided);
    const recs = await byIds("erp_receivables", "id,doc_number,point_id", "id", [...new Set(live.map((r) => String(r.receivable_id)).filter(Boolean))]);
    const rec = new Map(recs.map((r) => [String(r.id), r]));
    await customerDocs(live.map((r) => String(r.customer_id)));
    return live.map((r, i) => ({ id: String(r.id), date: day(r.paid_at), number: `R${i + 1}`, thirdDoc: custDoc(r.customer_id), thirdName: custName(r.customer_id),
      amount: num(r.amount), method: String(r.method ?? ""), pointId: str(rec.get(String(r.receivable_id))?.point_id), ref: str(rec.get(String(r.receivable_id))?.doc_number) ?? str(r.reference) }));
  }, [] as Sources["receipts"]);

  const payments = !include.payment ? [] : await safe("payment", skipped, async () => {
    step("Pagos a proveedores…");
    await supplierRows();
    const rows = await all((a, b) => sb().from("erp_payable_payments").select("id,payable_id,amount,method,reference,created_at")
      .eq("store_id", storeId).gte("created_at", startOf(from)).lte("created_at", endOf(to)).order("created_at").range(a, b));
    const pays = await byIds("erp_payables", "id,supplier_id,reference", "id", [...new Set(rows.map((r) => String(r.payable_id)))]);
    const pay = new Map(pays.map((p) => [String(p.id), p]));
    return rows.map((r, i) => { const s = sups.get(String(pay.get(String(r.payable_id))?.supplier_id)); return {
      id: String(r.id), date: day(r.created_at), number: `P${i + 1}`, thirdDoc: str(s?.nit), thirdName: str(s?.name), amount: num(r.amount), method: String(r.method ?? ""),
      pointId: null, ref: str(r.reference) ?? str(pay.get(String(r.payable_id))?.reference) }; });
  }, [] as Sources["payments"]);

  const expenses = !include.expense ? [] : await safe("expense", skipped, async () => {
    step("Gastos…");
    const cats = await all((a, b) => sb().from("erp_expense_categories").select("id,name").eq("store_id", storeId).range(a, b));
    const cat = new Map(cats.map((c) => [String(c.id), String(c.name)]));
    const rows = await all((a, b) => sb().from("erp_expenses").select("id,number,category_id,point_id,description,payee_name,amount,paid,incurred_on,due_on,status")
      .eq("store_id", storeId).neq("status", "void").gte("incurred_on", from).lte("incurred_on", to).order("incurred_on").range(a, b));
    return rows.map((r) => ({ id: String(r.id), date: String(r.incurred_on), number: String(r.number), categoryId: str(r.category_id), categoryName: cat.get(String(r.category_id)) ?? null,
      payee: str(r.payee_name), description: str(r.description), amount: num(r.amount), paid: num(r.paid), pointId: str(r.point_id), dueDate: str(r.due_on) }));
  }, [] as Sources["expenses"]);

  const payroll = !include.payroll ? [] : await safe("payroll", skipped, async () => {
    step("Nómina…");
    const rows = await all((a, b) => sb().from("erp_payroll_runs").select("id,number,point_id,period_end,status,earnings,deductions,net,employer_cost")
      .eq("store_id", storeId).in("status", ["approved", "partial", "paid"]).gte("period_end", from).lte("period_end", to).order("period_end").range(a, b));
    return rows.map((r) => ({ id: String(r.id), date: String(r.period_end), number: String(r.number), earnings: num(r.earnings), deductions: num(r.deductions),
      net: num(r.net), employerCost: num(r.employer_cost), pointId: str(r.point_id) }));
  }, [] as Sources["payroll"]);

  return { sources: { sales, purchases, receipts, payments, expenses, payroll }, skipped, costHidden };
}
