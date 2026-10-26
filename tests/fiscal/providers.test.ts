import { test } from "node:test";
import assert from "node:assert/strict";
import { getProvider, implementedProviders } from "../../src/lib/fiscal/providers";
import { sanitizePayload, submitDocument, type ClaimedDocument, type ProviderContext } from "../../src/lib/fiscal/provider";
import { buildSignatureHeader } from "../../src/lib/fiscal/webhook-signature";
import { alanubePayload } from "../../src/lib/fiscal/providers/alegra";

function claimed(overrides: Partial<ClaimedDocument["document"]> = {}, extra: Partial<ClaimedDocument> = {}): ClaimedDocument {
  return {
    mode: "send",
    document: {
      id: "11111111-1111-1111-1111-111111111111", store_id: "s", point_id: "p", fiscal_entity_id: "e", document_type: "invoice",
      environment: "sandbox", status: "PROCESSING", prefix: "MA", number: 1, full_number: "MA1", issue_date: "2026-10-08T15:00:00Z",
      due_date: null, currency: "COP", payment_form: "cash", payment_method: null, subtotal: 100000, discount_total: 0, tax_total: 19000, total: 119000,
      issuer: {
        entity_id: "e", legal_name: "MARÍA GÓMEZ", trade_name: null, person_type: "natural", document_type: "NIT", document_number: "43123456",
        verification_digit: "7", tax_regime: "responsable_iva", tax_responsibilities: ["O-13"], economic_activities: ["4755"],
        fiscal_address: "CALLE 1", city: "MEDELLIN", city_code: null, department: "ANTIOQUIA", department_code: null, country: "CO",
        postal_code: null, phone: null, email: "m@x.co", establishment: null, point: null,
      },
      customer: { id: null, final_consumer: true, document_type: "CC", document_number: "222222222222", name: "CONSUMIDOR FINAL" },
      note_concept: null, note_reason: null, provider_document_id: null, cufe: null, attempts: 1, metadata: {},
      ...overrides,
    },
    lines: [{ line_no: 1, product_id: null, sku: "LIC", description: "Licuadora", unit_code: "94", qty: 1, unit_price: 119000, discount: 0, tax_rate: 19, line_subtotal: 100000, line_tax: 19000, line_total: 119000, ref_line_no: null }],
    range: { id: "r", prefix: "MA", resolution_number: "18760000001", resolution_date: "2026-01-01", valid_from: "2026-01-01", valid_until: "2027-12-31", range_from: 1, range_to: 1000 },
    account: { id: "a", provider: "sandbox", environment: "sandbox", external_account_id: null, settings: {}, store_id: "s" },
    related: null,
    ...extra,
  };
}

const ctx = (settings: Record<string, unknown> = {}, environment: "sandbox" | "production" = "sandbox"): ProviderContext => ({
  account: { id: "a", provider: "sandbox", environment, external_account_id: null, settings, store_id: "s" },
  environment,
  credentials: {},
  requestId: "req-1",
});

const sandbox = () => {
  const p = getProvider("sandbox");
  assert.ok(p);
  return p;
};

test("registro único de proveedores (sin «if proveedor» por todo el sistema)", () => {
  assert.deepEqual(implementedProviders().sort(), ["alegra", "sandbox"]);
  assert.equal(getProvider("no-existe"), null);
});

test("el simulador acepta una factura válida con CUFE simulado y XML", async () => {
  const r = await submitDocument(sandbox(), ctx(), claimed());
  assert.equal(r.status, "ACCEPTED");
  assert.ok(r.cufe?.startsWith("SIM-"));
  assert.match(String(r.xml?.content), /SIMULACIÓN REMHUB/);
});

test("el simulador rechaza totales que no cuadran", async () => {
  const r = await submitDocument(sandbox(), ctx(), claimed({ total: 5 }));
  assert.equal(r.status, "REJECTED");
  assert.match(r.error_message ?? "", /totales/);
});

test("el simulador nunca transmite documentos de producción", async () => {
  const r = await submitDocument(sandbox(), ctx({}, "production"), claimed({ environment: "production" }));
  assert.equal(r.status, "ERROR");
  assert.equal(r.retryable, false);
});

test("falla de red simulada queda para reintento", async () => {
  const r = await submitDocument(sandbox(), ctx({ simulate: "error" }), claimed());
  assert.equal(r.status, "ERROR");
  assert.equal(r.retryable, true);
});

test("modo pendiente: enviado y luego aceptado al consultar el estado", async () => {
  const first = await submitDocument(sandbox(), ctx({ simulate: "pending" }), claimed());
  assert.equal(first.status, "SENT");
  const second = await submitDocument(sandbox(), ctx({ simulate: "pending" }), claimed({ provider_document_id: first.provider_document_id ?? null }, { mode: "status" }));
  assert.equal(second.status, "ACCEPTED");
});

test("una nota crédito sin documento original se rechaza", async () => {
  const r = await submitDocument(sandbox(), ctx(), claimed({ document_type: "credit_note" }));
  assert.equal(r.status, "REJECTED");
});

test("webhook del simulador: firma válida, firma inválida y lectura del estado", () => {
  const p = sandbox();
  const raw = JSON.stringify({ id: "evt-9", type: "document.status", data: { provider_document_id: "sim_1", status: "accepted", cufe: "SIM-x" } });
  const now = new Date();
  const good = p.verifyWebhook({ headers: new Headers({ "x-remhub-signature": buildSignatureHeader("s3cr3t", raw, now) }), rawBody: raw, secret: "s3cr3t", now });
  assert.deepEqual({ valid: good.valid, id: good.eventId }, { valid: true, id: "evt-9" });
  const bad = p.verifyWebhook({ headers: new Headers({ "x-remhub-signature": buildSignatureHeader("otro", raw, now) }), rawBody: raw, secret: "s3cr3t", now });
  assert.equal(bad.valid, false);
  const parsed = p.processWebhook(JSON.parse(raw));
  assert.equal(parsed.kind, "document_status");
  if (parsed.kind === "document_status") assert.equal(parsed.status, "ACCEPTED");
});

const alanubeCtx = (technicalKey: string | null = "clave-tecnica"): ProviderContext => ({
  account: { id: "a", provider: "alegra", environment: "sandbox", external_account_id: "comp-1", settings: {}, store_id: "s" },
  environment: "sandbox",
  credentials: { api_token: "t" },
  technicalKey,
  requestId: "req-1",
});

test("Alanube: factura normal con su resolución y clave técnica (sin llamar a internet)", () => {
  const body = alanubePayload(alanubeCtx(), claimed()) as Record<string, unknown> & { resolution: Record<string, unknown> };
  assert.equal(body.documentType, "01");
  assert.equal(body.resolution.technicalKey, "clave-tecnica");
  assert.equal(body.additionalDocumentReference, undefined);
});

test("Alanube: factura de contingencia (04) con la factura en papel y la fecha de Colombia", () => {
  // Venta en papel a las 8:30 p. m. del 23/10 en Colombia (01:30 del 24/10 en UTC).
  const doc = claimed({ document_type: "contingency_invoice", prefix: "CONT", number: 7, full_number: "CONT7", issue_date: "2026-10-24T01:30:00Z",
    metadata: { paper_number: "CONT7", paper_issued_at: "2026-10-24T01:30:00Z" } });
  const body = alanubePayload(alanubeCtx(null), doc) as Record<string, unknown> & { resolution: Record<string, unknown> };
  assert.equal(body.documentType, "04");
  assert.deepEqual(body.additionalDocumentReference, { number: "CONT7", issueDate: "2026-10-23" });
  assert.equal("technicalKey" in body.resolution, false, "la numeración de contingencia no tiene clave técnica");
});

test("Alanube: las fechas de documentos relacionados van en hora de Colombia", () => {
  const related = { id: "r1", document_type: "invoice", full_number: "MA1", issue_date: "2026-10-24T02:00:00Z", cufe: "CUFE-1", provider_document_id: null, total: 119000 };
  const note = claimed({ document_type: "credit_note", note_concept: "1", note_reason: "Devolución" }, { related } as Partial<ClaimedDocument>);
  const body = alanubePayload(alanubeCtx(), note) as { associatedDocuments: Array<{ date: string }> };
  assert.equal(body.associatedDocuments[0].date, "2026-10-23");
});

test("Alanube: webhook sin el secreto no es válido", () => {
  const p = getProvider("alegra");
  assert.ok(p);
  assert.equal(p.verifyWebhook({ headers: new Headers(), rawBody: "{}", secret: "x", now: new Date() }).valid, false);
});

test("las respuestas guardadas nunca incluyen secretos", () => {
  const clean = sanitizePayload({ ok: 1, api_key: "k", nested: { Authorization: "Bearer x", token: "t", value: 2 } }) as Record<string, unknown>;
  assert.equal(clean.api_key, "[oculto]");
  assert.deepEqual(clean.nested, { Authorization: "[oculto]", token: "[oculto]", value: 2 });
});
