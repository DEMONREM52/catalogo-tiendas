import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig } from "../../src/lib/accounting/config";
import { buildJournal, trialBalance, type Sources } from "../../src/lib/accounting/journal";
import { BUILTIN_FORMATS, cloneFormat, formatRows, formatText, nitDv } from "../../src/lib/accounting/formats";

const empty: Sources = { sales: [], purchases: [], receipts: [], payments: [], expenses: [], payroll: [] };
const balanced = (lines: { docNumber: string; kind: string; debit: number; credit: number }[]) => {
  const by = new Map<string, number>();
  for (const l of lines) by.set(`${l.kind}${l.docNumber}`, (by.get(`${l.kind}${l.docNumber}`) ?? 0) + l.debit - l.credit);
  return [...by.values()].every((v) => Math.abs(v) < 0.001);
};

const src: Sources = {
  ...empty,
  sales: [
    { id: "1", date: "2026-10-05", number: "REM-1", pointId: "P1", customerDoc: null, customerName: null, total: 119000, credit: false,
      lines: [{ qty: 1, price: 119000, taxRate: 19, cost: 60000 }], payments: [{ method: "efectivo", amount: 100000 }, { method: "nequi", amount: 19000 }] },
    { id: "2", date: "2026-10-06", number: "REM-2", pointId: "P1", customerDoc: "1.017.555", customerName: "ANA", total: 50000, credit: true,
      lines: [{ qty: 2, price: 10000, taxRate: 0, cost: 0 }, { qty: 1, price: 35700, taxRate: 19, cost: 0 }], payments: [] },
  ],
  purchases: [{ id: "c", date: "2026-10-02", number: "7", invoiceRef: "FE1001", pointId: null, supplierNit: "900.123.456-7", supplierName: "SUR", subtotal: 100000, tax: 19000, total: 119000, credit: true, dueDate: "2026-11-01" }],
  receipts: [{ id: "r", date: "2026-10-10", number: "R1", thirdDoc: "1017555", thirdName: "ANA", amount: 20000, method: "transferencia", pointId: null, ref: "REM-2" }],
  payments: [{ id: "p", date: "2026-10-12", number: "P1", thirdDoc: "9001234567", thirdName: "SUR", amount: 50000, method: "efectivo", pointId: null, ref: null }],
  expenses: [{ id: "e", date: "2026-10-03", number: "3", categoryId: "arr", categoryName: "Arriendo", payee: "DON JOSE", description: null, amount: 800000, paid: 500000, pointId: "P1", dueDate: null }],
  payroll: [{ id: "n", date: "2026-10-15", number: "1", earnings: 1500000, deductions: 120000, net: 1380000, employerCost: 300000, pointId: null }],
};

test("cada asiento cuadra y el balance de prueba suma igual", () => {
  const cfg = mergeConfig({ includeCost: true, costCenters: { P1: "01" }, expenseAccounts: { arr: "512010" } });
  const { lines, issues } = buildJournal(src, cfg);
  assert.ok(balanced(lines), "todos los asientos cuadran");
  const tb = trialBalance(lines);
  assert.equal(tb.reduce((s, x) => s + x.debit, 0).toFixed(2), tb.reduce((s, x) => s + x.credit, 0).toFixed(2));
  assert.ok(issues.some((i) => i.docNumber === "REM-2" && /sin costo/.test(i.message)), "avisa productos sin costo");
});

test("venta de contado mixta con IVA", () => {
  const { lines } = buildJournal({ ...empty, sales: [src.sales[0]] }, DEFAULT_CONFIG);
  const get = (acc: string) => lines.filter((l) => l.account === acc);
  assert.equal(get("110505")[0].debit, 100000);
  assert.equal(get("111005")[0].debit, 19000);
  assert.equal(get("413595")[0].credit, 100000);
  assert.equal(get("240801")[0].credit, 19000);
  assert.equal(get("240801")[0].base, 100000);
  assert.equal(lines[0].thirdId, "222222222222", "consumidor final");
});

test("venta a crédito con tarifas mezcladas va a clientes", () => {
  const { lines } = buildJournal({ ...empty, sales: [src.sales[1]] }, DEFAULT_CONFIG);
  // 55.700 de lista, total 50.000: se reparte el descuento.
  assert.equal(lines.find((l) => l.account === "130505")?.debit, 50000);
  assert.equal(lines[0].thirdId, "1017555");
  assert.ok(balanced(lines));
  assert.equal(lines.filter((l) => l.account === "413595").length, 2, "una línea de ingreso por tarifa");
});

test("no responsable de IVA: todo al ingreso", () => {
  const { lines } = buildJournal({ ...empty, sales: [src.sales[0]], purchases: src.purchases }, mergeConfig({ vatMode: "none" }));
  assert.ok(!lines.some((l) => l.account.startsWith("2408")));
  assert.equal(lines.find((l) => l.account === "143505")?.debit, 119000);
});

test("gasto parcialmente pagado y nómina", () => {
  const { lines } = buildJournal({ ...empty, expenses: src.expenses, payroll: src.payroll }, mergeConfig({ expenseAccounts: { arr: "512010" } }));
  assert.equal(lines.find((l) => l.account === "512010")?.debit, 800000);
  assert.equal(lines.find((l) => l.account === "233595")?.credit, 300000);
  assert.equal(lines.find((l) => l.account === "237005")?.credit, 420000);
  assert.ok(balanced(lines));
});

test("se pueden apagar tipos de documento", () => {
  const { lines } = buildJournal(src, mergeConfig({ include: { ...DEFAULT_CONFIG.include, sale: false, payroll: false } }));
  assert.ok(!lines.some((l) => l.kind === "sale" || l.kind === "payroll"));
});

test("formatos: cada programa arma sus columnas", () => {
  const { lines } = buildJournal({ ...empty, purchases: src.purchases }, DEFAULT_CONFIG);
  for (const f of BUILTIN_FORMATS) {
    const rows = formatRows(lines, f);
    assert.equal(rows.length, lines.length, f.id);
    assert.equal(rows[0].length, f.columns.length, f.id);
  }
  const pyme = BUILTIN_FORMATS.find((f) => f.id === "siigo_pyme")!;
  const r = formatRows(lines, pyme)[0];
  assert.deepEqual([r[4], r[5], r[6], r[7], r[8]], ["D", 100000, 2026, 10, 2]);
  const csv = formatText(lines, BUILTIN_FORMATS.find((f) => f.id === "csv_universal")!);
  assert.ok(csv.startsWith("FECHA;COMPROBANTE"));
  assert.ok(csv.includes("02/10/2026;FC;7;1;143505;9001234567"));
  const helisa = formatText(lines, BUILTIN_FORMATS.find((f) => f.id === "helisa")!);
  assert.ok(helisa.startsWith("FC;7;20261002;143505"), "Helisa sin encabezado y fecha AAAAMMDD");
});

test("formato propio y dígito de verificación", () => {
  const own = cloneFormat(BUILTIN_FORMATS[0], "Mi contadora");
  own.columns = [{ header: "NIT", field: "third_id" }, { header: "DV", field: "third_dv" }, { header: "Valor", field: "amount" }, { header: "Empresa", field: "fixed", fixed: "01" }];
  own.decimal = ",";
  const { lines } = buildJournal({ ...empty, receipts: [{ ...src.receipts[0], amount: 1234.5, thirdDoc: "900123456" }] }, DEFAULT_CONFIG);
  const txt = formatText(lines, { ...own, file: "csv" });
  assert.ok(txt.includes("900123456;8;1234,50;01"), txt);
  assert.equal(nitDv("800197268"), "4");
  assert.equal(nitDv("860034313"), "7");
});

test("consecutivo numérico por comprobante", () => {
  const { lines } = buildJournal(src, mergeConfig({ numbering: "sequence", startAt: { ...DEFAULT_CONFIG.startAt, sale: 500 } }));
  const sales = lines.filter((l) => l.kind === "sale");
  assert.deepEqual([...new Set(sales.map((l) => l.docNumber))], ["500", "501"]);
  assert.equal(sales[0].docRef, "REM-1", "el número de RemHub queda de soporte");
  assert.equal(lines.find((l) => l.kind === "purchase")?.docRef, "FE1001", "en compras el soporte es la factura del proveedor");
});
