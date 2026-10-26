import { test } from "node:test";
import assert from "node:assert/strict";
import { offlineReceiptHtml } from "../../src/lib/pos/offline-receipt";
import { draftPayload } from "../../src/lib/pos/sync";
import { availableNumbers, type ContingencyPool } from "../../src/lib/pos/contingency";
import type { PosDraft } from "../../src/lib/pos/drafts";

const BOGOTA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (offset: number) => BOGOTA_DAY.format(new Date(Date.now() + offset * 86_400_000));

function draft(over: Partial<PosDraft> = {}): PosDraft {
  return {
    id: "e2000000-0000-0000-0000-000000000001", storeId: "s", createdAt: "2026-10-24T01:30:00Z",
    cart: [{ productId: "p1", name: "LICUADORA", qty: 2, price: 119000, priceLevel: 3, note: "", taxRate: 19 }],
    total: 238000, customerName: "CONSUMIDOR FINAL", customerNote: "", customerWhatsApp: "", customerDocument: "", selectedClientId: "",
    documentKind: "factura", kind: "contingencia", pointId: "pt", pointName: "Punto Centro", sellerId: "", sellerName: "CAJA",
    payment: { method: "efectivo", parts: [{ method: "efectivo", amount: 238000 }], received: 250000, change: 12000 },
    fiscal: { block_id: "b1", range_id: "r1", number: 7, prefix: "CONT", full_number: "CONT7", environment: "production",
      resolution: { number: "18764000001", date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31", from: 1, to: 500 } },
    ...over,
  };
}

const contingency = {
  enabled: true, blocks: [], prices_include_tax: true, final_consumer: { name: "CONSUMIDOR FINAL", doc: "222222222222" },
  issuer: { legal_name: "LA VITRINA SAS", trade_name: null, document_type: "NIT", document_number: "900373913", verification_digit: "2", tax_regime: "responsable_iva",
    tax_responsibilities: ["O-13"], fiscal_address: "CALLE 10", city: "Medellín", department: "Antioquia", phone: "3000000000", email: null, establishment: null, point: null },
};

test("factura de contingencia impresa: número, emisor, resolución, IVA y vuelto", () => {
  const html = offlineReceiptHtml(draft(), { storeName: "La Vitrina", contingency, size: "tirilla" });
  assert.match(html, /FACTURA DE VENTA N\.º CONT7/);
  assert.match(html, /NIT 900373913-2/);
  assert.match(html, /Resolución DIAN de contingencia N\.º 18764000001 del 01\/01\/2026/);
  assert.match(html, /del CONT1 al CONT500/);
  assert.match(html, /48 horas/);
  // 2 × $119.000 con IVA 19 % incluido → base $200.000 e IVA $38.000.
  assert.match(html, /Base 19%<\/td><td class="r">\$200\.000/);
  assert.match(html, /IVA 19%<\/td><td class="r">\$38\.000/);
  assert.match(html, /Vuelto<\/td><td class="r">\$12\.000/);
  assert.match(html, /222222222222/, "consumidor final con su documento");
  assert.doesNotMatch(html, /SIN VALIDEZ/, "producción no lleva la marca de pruebas");
  // Venta a las 8:30 p. m. en Colombia (01:30 UTC del día siguiente).
  assert.match(html, /23\/10\/2026/);
});

test("reimpresión: sale con el emisor del punto donde se vendió, no con el punto abierto", () => {
  const other = { ...contingency, issuer: { ...contingency.issuer, legal_name: "OTRO PUNTO SAS", document_number: "800197268", verification_digit: "1" } };
  const html = offlineReceiptHtml(draft({ fiscal: { ...draft().fiscal!, issuer: contingency.issuer } }), { storeName: "X", contingency: other, size: "tirilla" });
  assert.match(html, /LA VITRINA SAS/);
  assert.doesNotMatch(html, /OTRO PUNTO SAS/);
});

test("práctica y pruebas: el papel dice que no tiene validez", () => {
  const practice = offlineReceiptHtml(draft({ practice: true, fiscal: { ...draft().fiscal!, full_number: "PRUEBA-1", prefix: "PRUEBA-", number: 1 } }), { storeName: "X", contingency, size: "carta" });
  assert.match(practice, /PRÁCTICA · NO ES UNA VENTA REAL/);
  assert.match(practice, /SIN VALIDEZ FISCAL/);
  const sandbox = offlineReceiptHtml(draft({ fiscal: { ...draft().fiscal!, environment: "sandbox" } }), { storeName: "X", contingency, size: "carta" });
  assert.match(sandbox, /SIN VALIDEZ FISCAL/);
});

test("remisión sin conexión: comprobante provisional sin número ni datos fiscales", () => {
  const html = offlineReceiptHtml(draft({ kind: "remision", documentKind: "remision", fiscal: undefined }), { storeName: "La Vitrina", contingency: null, size: "tirilla" });
  assert.match(html, /REMISIÓN \(provisional\)/);
  assert.match(html, /número definitivo de la remisión se asigna al volver/);
  assert.doesNotMatch(html, /Resolución/);
});

test("lo que se envía a la base: tal como se cobró, con pago y número de contingencia", () => {
  const p = draftPayload(draft({ selectedClientId: "c1", customerDocument: "1020304050" }));
  assert.equal(p.kind, "contingencia");
  assert.deepEqual(p.items, [{ product_id: "p1", qty: 2, price: 119000, level: 3, name: "LICUADORA" }]);
  assert.deepEqual(p.fiscal, { block_id: "b1", number: 7, full_number: "CONT7" });
  assert.equal(p.payment?.change, 12000);
  assert.equal(p.customer.client_id, "c1");
  assert.equal(p.customer.doc, "1020304050");
  // Borradores viejos (sin «kind»): se toma el tipo de documento.
  const legacy = draftPayload(draft({ kind: undefined, documentKind: "remision", fiscal: undefined, payment: undefined }));
  assert.equal(legacy.kind, "remision");
  assert.equal(legacy.payment, null);
  assert.equal(legacy.fiscal, null);
});

test("números de contingencia: en orden, sin los usados y solo con resolución vigente hoy", () => {
  const block = (id: string, range: string, free: number[], valid_until: string | null) => ({
    id, range_id: range, prefix: "CONT", from: free[0], to: free[free.length - 1], free, resolution_number: "1", resolution_date: null,
    valid_from: null, valid_until, range_from: 1, range_to: 500,
  });
  const pool: ContingencyPool = {
    at: Date.now(), used: ["r1:3"],
    info: { enabled: true, blocks: [block("b2", "r1", [5, 4, 3], day(10)), block("b1", "r1", [1, 2], day(10)), block("viejo", "r0", [90, 91], day(-1))] },
  };
  assert.deepEqual(availableNumbers(pool, "s").map((n) => n.number), [1, 2, 4, 5]);
  assert.deepEqual(availableNumbers({ ...pool, info: { ...pool.info, enabled: false } }, "s"), []);
  assert.deepEqual(availableNumbers(null, "s"), []);
});
