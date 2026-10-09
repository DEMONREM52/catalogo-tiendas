import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignatureHeader, verifySignatureHeader } from "../../src/lib/fiscal/webhook-signature";

const secret = "secreto-de-pruebas";
const body = JSON.stringify({ id: "evt-1", type: "document.status", data: { status: "ACCEPTED" } });
const now = new Date("2026-10-08T15:00:00Z");

test("firma válida", () => {
  const header = buildSignatureHeader(secret, body, now);
  assert.equal(verifySignatureHeader({ header, secret, rawBody: body, now }).valid, true);
});

test("webhook mal firmado es rechazado", () => {
  const header = buildSignatureHeader("otro-secreto", body, now);
  const check = verifySignatureHeader({ header, secret, rawBody: body, now });
  assert.equal(check.valid, false);
  assert.match(check.reason ?? "", /no coincide/);
});

test("cuerpo alterado es rechazado", () => {
  const header = buildSignatureHeader(secret, body, now);
  assert.equal(verifySignatureHeader({ header, secret, rawBody: body.replace("ACCEPTED", "REJECTED"), now }).valid, false);
});

test("firma vieja (reenvío) es rechazada", () => {
  const header = buildSignatureHeader(secret, body, new Date(now.getTime() - 10 * 60 * 1000));
  const check = verifySignatureHeader({ header, secret, rawBody: body, now });
  assert.equal(check.valid, false);
  assert.match(check.reason ?? "", /vencida/);
});

test("sin secreto configurado o sin firma: rechazado", () => {
  assert.equal(verifySignatureHeader({ header: buildSignatureHeader(secret, body, now), secret: null, rawBody: body, now }).valid, false);
  assert.equal(verifySignatureHeader({ header: null, secret, rawBody: body, now }).valid, false);
  assert.equal(verifySignatureHeader({ header: "basura", secret, rawBody: body, now }).valid, false);
});
