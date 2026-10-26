// De los documentos de RemHub a asientos contables (partida doble). Sin navegador ni base: se prueba solo.
import { payKey, type AccountingConfig, type DocKind } from "./config";

export type SaleDoc = {
  id: string; date: string; number: string; pointId: string | null;
  customerDoc: string | null; customerName: string | null; total: number; credit: boolean;
  lines: Array<{ qty: number; price: number; taxRate: number; cost: number }>;
  payments: Array<{ method: string; amount: number }>;
};
export type PurchaseDoc = {
  id: string; date: string; number: string; invoiceRef: string | null; pointId: string | null;
  supplierNit: string | null; supplierName: string | null; subtotal: number; tax: number; total: number; credit: boolean; dueDate: string | null;
};
export type MoneyDoc = { id: string; date: string; number: string; thirdDoc: string | null; thirdName: string | null; amount: number; method: string; pointId: string | null; ref: string | null };
export type ExpenseDoc = {
  id: string; date: string; number: string; categoryId: string | null; categoryName: string | null; payee: string | null;
  description: string | null; amount: number; paid: number; pointId: string | null; dueDate: string | null;
};
export type PayrollDoc = { id: string; date: string; number: string; earnings: number; deductions: number; net: number; employerCost: number; pointId: string | null };

export type Sources = { sales: SaleDoc[]; purchases: PurchaseDoc[]; receipts: MoneyDoc[]; payments: MoneyDoc[]; expenses: ExpenseDoc[]; payroll: PayrollDoc[] };

export type JLine = {
  kind: DocKind; docCode: string; docNumber: string; docRef: string; date: string; seq: number;
  account: string; thirdId: string; thirdName: string; description: string;
  debit: number; credit: number; base: number; costCenter: string; dueDate: string;
};

export type Issue = { kind: DocKind; docNumber: string; message: string };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** Solo dígitos del documento (sin puntos, guiones ni dígito de verificación separado). */
export const cleanId = (id: string | null | undefined) => String(id ?? "").replace(/[^0-9A-Za-z]/g, "");

export function buildJournal(src: Sources, cfg: AccountingConfig): { lines: JLine[]; issues: Issue[] } {
  const lines: JLine[] = [];
  const issues: Issue[] = [];
  const acc = cfg.accounts;
  const cc = (pointId: string | null) => (pointId ? cfg.costCenters[pointId] ?? "" : "");
  const methodAcc = (m: string) => cfg.methods[payKey(m)];

  function entry(kind: DocKind, docNumber: string, date: string, docRef: string, rows: Array<Partial<JLine> & { account: string; debit?: number; credit?: number }>, defaults: Partial<JLine>) {
    const out = rows
      .map((x) => ({ ...x, debit: r2(x.debit ?? 0), credit: r2(x.credit ?? 0) }))
      .filter((x) => x.debit > 0 || x.credit > 0);
    if (!out.length) return;
    // Los centavos de redondeo se ajustan en la línea más grande para que el asiento cuadre exacto.
    const diff = r2(out.reduce((s, x) => s + x.debit - x.credit, 0));
    if (diff !== 0 && Math.abs(diff) <= 1) {
      // diff > 0: faltan créditos; diff < 0: faltan débitos.
      const side = diff > 0 ? "credit" : "debit";
      const pool = out.filter((x) => x[side] > 0);
      if (pool.length) {
        const big = pool.reduce((p, q) => (q[side] > p[side] ? q : p));
        big[side] = r2(big[side] + Math.abs(diff));
      }
    } else if (diff !== 0) {
      issues.push({ kind, docNumber, message: `El asiento no cuadra por ${diff}.` });
    }
    out.forEach((x, i) => {
      if (!x.account) issues.push({ kind, docNumber, message: "Falta la cuenta contable de una línea." });
      lines.push({
        kind, docCode: cfg.docCodes[kind], docNumber, docRef, date, seq: i + 1,
        thirdId: "", thirdName: "", description: "", base: 0, costCenter: "", dueDate: "",
        ...defaults, ...x, debit: x.debit, credit: x.credit, account: x.account,
      } as JLine);
    });
  }

  if (cfg.include.sale) {
    for (const s of src.sales) {
      const third = { thirdId: cleanId(s.customerDoc) || cfg.finalConsumerId, thirdName: s.customerName || "CONSUMIDOR FINAL", costCenter: cc(s.pointId) };
      const gross = s.lines.reduce((t, l) => t + l.qty * l.price, 0);
      // Descuentos o redondeos del total se reparten en proporción entre las líneas.
      const factor = gross > 0 ? s.total / gross : 1;
      const byRate = new Map<number, number>();
      for (const l of s.lines) {
        const rate = cfg.vatMode === "none" ? 0 : Number(l.taxRate) || 0;
        byRate.set(rate, (byRate.get(rate) ?? 0) + l.qty * l.price * factor);
      }
      if (!s.lines.length) byRate.set(0, s.total);
      const credits: Array<Partial<JLine> & { account: string; credit: number }> = [];
      for (const [rate, total] of byRate) {
        const base = r2(total / (1 + rate / 100));
        credits.push({ account: acc.sales, credit: base, description: `Venta ${s.number}${rate ? ` gravada ${rate}%` : rate === 0 && cfg.vatMode !== "none" ? " excluida/exenta" : ""}`, base: 0 });
        if (rate) credits.push({ account: acc.vatGenerated, credit: r2(total - base), description: `IVA ${rate}% venta ${s.number}`, base });
      }
      const debits: Array<Partial<JLine> & { account: string; debit: number }> = [];
      if (s.credit) debits.push({ account: acc.customers, debit: s.total, description: `Venta a crédito ${s.number}` });
      else {
        let paid = 0;
        for (const p of s.payments) {
          const amt = Math.min(Number(p.amount) || 0, s.total - paid);
          if (amt <= 0) continue;
          paid += amt;
          debits.push({ account: methodAcc(p.method), debit: amt, description: `Venta ${s.number} · ${p.method}` });
        }
        if (s.total - paid > 0.005) debits.push({ account: s.payments.length ? acc.customers : cfg.methods.otro, debit: s.total - paid, description: `Venta ${s.number}${s.payments.length ? " · saldo" : ""}` });
      }
      const rows = [...debits, ...credits];
      if (cfg.includeCost) {
        const cost = r2(s.lines.reduce((t, l) => t + l.qty * (Number(l.cost) || 0), 0));
        if (cost > 0) rows.push({ account: acc.costOfSales, debit: cost, description: `Costo venta ${s.number}` }, { account: acc.inventory, credit: cost, description: `Salida inventario ${s.number}` });
        else issues.push({ kind: "sale", docNumber: s.number, message: "Productos sin costo: no se hizo el costo de ventas." });
      }
      entry("sale", s.number, s.date, s.number, rows, third);
    }
  }

  if (cfg.include.purchase) {
    for (const p of src.purchases) {
      const third = { thirdId: cleanId(p.supplierNit), thirdName: p.supplierName ?? "", costCenter: cc(p.pointId), docRef: p.invoiceRef ?? "" };
      if (!third.thirdId) issues.push({ kind: "purchase", docNumber: p.number, message: `El proveedor ${p.supplierName ?? ""} no tiene NIT.` });
      const tax = cfg.vatMode === "none" ? 0 : p.tax;
      entry("purchase", p.number, p.date, p.invoiceRef ?? p.number, [
        { account: acc.inventory, debit: p.total - tax, description: `Compra ${p.number}${p.invoiceRef ? ` · FV ${p.invoiceRef}` : ""}` },
        { account: acc.vatDeductible, debit: tax, description: `IVA compra ${p.number}`, base: p.subtotal },
        p.credit
          ? { account: acc.suppliers, credit: p.total, description: `Por pagar FV ${p.invoiceRef ?? p.number}`, dueDate: p.dueDate ?? "" }
          : { account: cfg.methods.efectivo, credit: p.total, description: `Pago contado FV ${p.invoiceRef ?? p.number}` },
      ], third);
    }
  }

  if (cfg.include.receipt) {
    for (const m of src.receipts) {
      entry("receipt", m.number, m.date, m.ref ?? "", [
        { account: methodAcc(m.method), debit: m.amount, description: `Abono de ${m.thirdName ?? "cliente"}${m.ref ? ` · ${m.ref}` : ""}` },
        { account: acc.customers, credit: m.amount, description: `Abono cartera${m.ref ? ` ${m.ref}` : ""}` },
      ], { thirdId: cleanId(m.thirdDoc) || cfg.finalConsumerId, thirdName: m.thirdName ?? "", costCenter: cc(m.pointId) });
    }
  }

  if (cfg.include.payment) {
    for (const m of src.payments) {
      entry("payment", m.number, m.date, m.ref ?? "", [
        { account: acc.suppliers, debit: m.amount, description: `Pago a ${m.thirdName ?? "proveedor"}${m.ref ? ` · ${m.ref}` : ""}` },
        { account: methodAcc(m.method), credit: m.amount, description: `Pago proveedor${m.ref ? ` ${m.ref}` : ""}` },
      ], { thirdId: cleanId(m.thirdDoc), thirdName: m.thirdName ?? "", costCenter: cc(m.pointId) });
    }
  }

  if (cfg.include.expense) {
    for (const e of src.expenses) {
      const account = (e.categoryId && cfg.expenseAccounts[e.categoryId]) || acc.expenseDefault;
      const paid = Math.min(Math.max(Number(e.paid) || 0, 0), e.amount);
      const desc = [e.categoryName, e.description].filter(Boolean).join(" · ") || "Gasto";
      entry("expense", e.number, e.date, e.number, [
        { account, debit: e.amount, description: desc },
        { account: cfg.methods.efectivo, credit: paid, description: `Pago ${desc}` },
        { account: acc.expensesPayable, credit: e.amount - paid, description: `Por pagar ${desc}`, dueDate: e.dueDate ?? "" },
      ], { thirdId: cfg.storeNit, thirdName: e.payee ?? "", costCenter: cc(e.pointId) });
    }
  }

  if (cfg.include.payroll) {
    for (const p of src.payroll) {
      entry("payroll", p.number, p.date, p.number, [
        { account: acc.payrollExpense, debit: p.earnings, description: `Nómina ${p.number} devengado` },
        { account: acc.payrollEmployer, debit: p.employerCost, description: `Nómina ${p.number} aportes del empleador` },
        { account: acc.payrollPayable, credit: p.net, description: `Nómina ${p.number} neto a pagar` },
        { account: acc.payrollWithholdings, credit: p.deductions + p.employerCost, description: `Nómina ${p.number} descuentos y aportes` },
      ], { thirdId: cfg.storeNit, thirdName: "NÓMINA", costCenter: cc(p.pointId) });
    }
  }

  if (cfg.numbering === "sequence") renumber(lines, cfg);
  return { lines, issues };
}

/** Consecutivo numérico por comprobante (en orden de fecha); el número de RemHub queda como documento soporte. */
function renumber(lines: JLine[], cfg: AccountingConfig) {
  const docs = new Map<string, number>();
  const next: Record<string, number> = {};
  const order = [...new Set(lines.map((l) => `${l.kind}|${l.docNumber}|${l.date}`))]
    .sort((a, b) => a.split("|")[2].localeCompare(b.split("|")[2]));
  for (const key of order) {
    const kind = key.split("|")[0] as DocKind;
    next[kind] = next[kind] ?? Math.max(1, Math.floor(Number(cfg.startAt[kind]) || 1));
    docs.set(key, next[kind]++);
  }
  for (const l of lines) {
    const key = `${l.kind}|${l.docNumber}|${l.date}`;
    if (!l.docRef) l.docRef = l.docNumber;
    else if (l.kind !== "purchase") l.docRef = l.docNumber;
    l.docNumber = String(docs.get(key));
  }
}

/** Saldos por cuenta del periodo (lo que el contador mira primero para cuadrar). */
export function trialBalance(lines: JLine[]) {
  const map = new Map<string, { account: string; debit: number; credit: number }>();
  for (const l of lines) {
    const x = map.get(l.account) ?? { account: l.account, debit: 0, credit: 0 };
    x.debit = r2(x.debit + l.debit);
    x.credit = r2(x.credit + l.credit);
    map.set(l.account, x);
  }
  return [...map.values()].sort((a, b) => a.account.localeCompare(b.account));
}
