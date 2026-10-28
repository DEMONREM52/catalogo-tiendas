// Firma de integridad, firma del webhook, referencia y regreso de Bold (según developers.bold.co).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { boldIntegrity, boldReference, boldReturnUrl, boldWebhookSigner, boldWebhookValid } from "../../src/lib/payments/bold-sign";

test("firma de integridad: SHA-256 de referencia + monto + divisa + llave secreta (ejemplo de Bold)", () => {
  const want = createHash("sha256").update("inv033439400COPkgfq2nN0o52XqnuXZWIN2F").digest("hex");
  assert.equal(boldIntegrity("inv0334", 39400, "COP", "kgfq2nN0o52XqnuXZWIN2F"), want);
  assert.notEqual(boldIntegrity("inv0334", 39500, "COP", "kgfq2nN0o52XqnuXZWIN2F"), want, "otro monto, otra firma");
});

test("webhook: HMAC-SHA256 del cuerpo en base64; en pruebas con llave vacía", () => {
  const body = JSON.stringify({ type: "SALE_APPROVED", data: { metadata: { reference: "rh12-abc" } } });
  const sign = (key: string) => createHmac("sha256", key).update(Buffer.from(body).toString("base64")).digest("hex");
  assert.ok(boldWebhookValid(body, sign("secreta"), ["secreta"]));
  assert.ok(boldWebhookValid(body, sign(""), [""]), "modo pruebas");
  assert.ok(!boldWebhookValid(body, sign("otra"), ["secreta"]), "otra llave no vale");
  assert.ok(!boldWebhookValid(body + " ", sign("secreta"), ["secreta"]), "cuerpo alterado no vale");
  assert.ok(!boldWebhookValid(body, null, ["secreta"]), "sin firma no vale");
});

test("webhook: la firma con llave vacía cuenta como pruebas, nunca como producción", () => {
  const body = JSON.stringify({ type: "VOID_APPROVED", data: { metadata: { reference: "rh12-abc" } } });
  const sign = (key: string) => createHmac("sha256", key).update(Buffer.from(body).toString("base64")).digest("hex");
  const keys = { prod: "llave-prod", test: "llave-pruebas" };
  assert.equal(boldWebhookSigner(body, sign("llave-prod"), keys), "production");
  assert.equal(boldWebhookSigner(body, sign("llave-pruebas"), keys), "test");
  assert.equal(boldWebhookSigner(body, sign(""), keys), "test", "llave vacía: cualquiera la calcula");
  assert.equal(boldWebhookSigner(body, sign("otra"), keys), null);
  assert.equal(boldWebhookSigner(body, sign(""), { prod: null, test: null }), "test");
});

test("referencia única con el número del pedido, solo letras, números y guiones", () => {
  const a = boldReference(88), b = boldReference(88);
  assert.match(a, /^rh88-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
  assert.match(boldReference(null), /^rh[0-9a-f]{12}$/);
});

test("regreso: solo a la misma tienda, sin los datos del pago anterior", () => {
  const req = new Request("https://vitrina.remhub.co/api/landing/order", { headers: { host: "vitrina.remhub.co" } });
  assert.equal(boldReturnUrl(req, "https://vitrina.remhub.co/oferta/audifonos?utm_source=facebook&bold-order-id=x#top", "/x"), "https://vitrina.remhub.co/oferta/audifonos?utm_source=facebook");
  assert.equal(boldReturnUrl(req, "https://malo.com/robar", "/vitrina/oferta/audifonos"), "https://vitrina.remhub.co/vitrina/oferta/audifonos");
});
