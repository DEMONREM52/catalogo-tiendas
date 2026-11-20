import test from "node:test";
import assert from "node:assert/strict";
import { creditBlockReason } from "@/app/dashboard/clientes/terceros";
import { creditRows, normalizePayment, payTheme } from "@/app/pedido/[token]/receipt-extras";

test("consumidor final o sin cédula/NIT: sin crédito (igual que erp__is_final_consumer)", () => {
  assert.match(creditBlockReason({ name: "CONSUMIDOR FINAL", document_number: "222222222222" }) ?? "", /Consumidor final/);
  assert.match(creditBlockReason({ name: "Cliente  de mostrador", document_number: "123456" }) ?? "", /Consumidor final/);
  assert.match(creditBlockReason({ name: "PEDRO PÉREZ", document_number: "" }) ?? "", /cédula o NIT/);
  assert.match(creditBlockReason({ name: "PEDRO PÉREZ", document_number: "1111111111" }) ?? "", /cédula o NIT/);
  assert.match(creditBlockReason(null) ?? "", /cliente registrado/);
  assert.equal(creditBlockReason({ name: "JULIETH ANDREA MARIN", document_number: "1152695048" }), null);
  assert.equal(creditBlockReason({ name: "NEXT TECHNOLOGY SAS", document_number: "900.123.456-7" }), null);
});

test("el comprobante entiende la venta a crédito", () => {
  const p = normalizePayment({ method: "credito", parts: [], credit: { total: 177000, balance: 157000, paid: 20000, issue_date: "2026-11-20", due_date: "2026-11-30", days: 10, status: "open" } });
  assert.equal(p?.method, "credito");
  assert.equal(p?.credit?.balance, 157000);
  const rows = creditRows(p!.credit!, (n) => "$" + n.toLocaleString("es-CO"));
  assert.deepEqual(rows.map(([k]) => k), ["Plazo", "Vence", "Abonado", "Saldo pendiente"]);
  assert.equal(rows[1][1], "30/11/2026");
  // Con una devolución parcial: la nota sale antes del saldo, con lo devuelto.
  const withNote = normalizePayment({ method: "credito", credit: { total: 82000, balance: 82000, paid: 0, due_date: "2026-11-30", days: 10, status: "open",
    notes: [{ number: "NC-00002", kind: "credit", amount: 95000, items: [{ name: "CASTILLO", qty: 1 }] }] } });
  const nrows = creditRows(withNote!.credit!, (n) => "$" + n.toLocaleString("es-CO"));
  assert.equal(nrows[2][0], "NC-00002 · devolución 1 × CASTILLO");
  assert.equal(nrows[2][1], "−$95.000");
  // Contado: sin crédito, igual que antes.
  assert.equal(normalizePayment({ method: "efectivo", parts: [] })?.credit, null);
});

test("cada forma de pago tiene su color en el comprobante", () => {
  const theme = (v: unknown) => payTheme(normalizePayment(v));
  const credit = theme({ method: "credito", credit: { total: 1, balance: 1, paid: 0, due_date: "2026-11-30", status: "open" } });
  assert.equal(credit?.label, "Venta a crédito");
  assert.equal(credit?.detail, "vence el 30/11/2026");
  assert.equal(theme({ method: "credito", credit: { total: 1, balance: 1, paid: 0, status: "overdue" } })?.color, "#dc2626");
  assert.equal(theme({ method: "credito", credit: { total: 1, balance: 0, paid: 1, status: "paid" } })?.label, "Crédito pagado");
  const colors = ["efectivo", "transferencia", "tarjeta", "nequi"].map((m) => theme({ method: m, parts: [] })?.color);
  assert.equal(new Set(colors).size, 4, "efectivo, transferencia, tarjeta y Nequi con colores distintos");
  assert.ok(!colors.includes(credit?.color), "ninguno se confunde con crédito");
  assert.equal(theme({ method: "bono", parts: [] })?.color, "#64748b", "otra forma de pago: gris");
  const mixed = theme({ method: "mixto", parts: [{ method: "efectivo", amount: 5 }, { method: "tarjeta", amount: 5 }] });
  assert.deepEqual(mixed?.colors, ["#16a34a", "#0891b2"]);
  assert.equal(payTheme(null, { paid: true, method: "Bold" })?.label, "Pagado en línea");
  assert.equal(payTheme(null), null);
});
