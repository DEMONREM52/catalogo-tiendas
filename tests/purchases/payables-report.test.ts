import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayablesReport } from "../../src/app/dashboard/inventario/payables-report";
import type { PayableRow } from "../../src/app/dashboard/inventario/payables-shared";
import { labelsEscpos, rotuloEscpos } from "../../src/lib/print/labels";
import { DEFAULT_PRINTER } from "../../src/lib/print/settings";

const row = (id: string, supplier: string, due: string, days: number, balance: number, extra: Partial<PayableRow> = {}) => ({
  id, supplier_id: supplier, supplier_name: supplier, due_date: due, days_left: days, balance, total: balance, status: "open",
  warehouse_name: "BODEGA", purchase_number: 1, invoice_ref: `F-${id}`, ...extra,
}) as PayableRow;
const today = "2026-10-26";
const rows = [
  row("a", "CROMBI", "2026-10-28", 2, 21_000_000),
  row("b", "AYF", "2026-11-06", 11, 16_000_000, { warehouse_name: "ZAMORA" }),
  row("c", "AYF", "2026-11-20", 25, 1_000_000),
  row("d", "AURO", "2026-10-20", -6, 500_000),
  row("e", "AURO", "2026-10-27", 1, 900_000, { status: "paid" }),
];
const name = (r: PayableRow) => r.supplier_name ?? "";

test("próximos 15 días con lo vencido, por proveedor", () => {
  const r = buildPayablesReport(rows, { range: { kind: "next", days: 15 }, overdue: true, supplierId: "", point: "", group: "supplier" }, today, name);
  assert.deepEqual(r.rows.map((x) => x.invoice), ["F-d", "F-a", "F-b"]);
  assert.equal(r.total, 37_500_000);
  assert.equal(r.overdue, 500_000);
  assert.deepEqual(r.sections.map((s) => s.title), ["CROMBI", "AYF", "AURO"]);
  assert.equal(r.to, "2026-11-10");
});

test("sin vencidas, entre fechas, filtrando punto", () => {
  const r = buildPayablesReport(rows, { range: { kind: "dates", from: "2026-11-01", to: "2026-11-30" }, overdue: false, supplierId: "", point: "ZAMORA", group: "none" }, today, name);
  assert.deepEqual(r.rows.map((x) => x.invoice), ["F-b"]);
});

test("etiquetas y rótulo para la térmica", () => {
  const s = { ...DEFAULT_PRINTER, width: 32 as const };
  const bytes = labelsEscpos([{ name: "ALCOHOL", code: "7701234", price: 5000 }, { name: "GEL", code: "", price: 3000 }], s, { code: "barcode", showName: true });
  const txt = Buffer.from(bytes).toString("latin1");
  assert.ok(txt.includes("\x1dk\x49") && txt.includes("{B7701234"), "lleva el código de barras CODE128");
  assert.ok(txt.includes("$ 5.000") && txt.includes("$ 3.000"));
  const rot = Buffer.from(rotuloEscpos({ store: "A", number: 7, date: "26/10/2026", from: "BODEGA", to: "Zamora", units: 10, products: 2, url: "https://x/t/1" }, 2, s)).toString("latin1");
  assert.ok(rot.includes("BULTO 1 DE 2") && rot.includes("BULTO 2 DE 2") && rot.includes("ZAMORA") && rot.includes("https://x/t/1"));
});
