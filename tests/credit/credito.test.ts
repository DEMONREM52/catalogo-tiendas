import test from "node:test";
import assert from "node:assert/strict";
import { creditBlockReason } from "@/app/dashboard/clientes/terceros";
import { creditRows, normalizePayment } from "@/app/pedido/[token]/receipt-extras";

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
  // Contado: sin crédito, igual que antes.
  assert.equal(normalizePayment({ method: "efectivo", parts: [] })?.credit, null);
});
