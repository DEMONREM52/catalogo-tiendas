import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkoutUrl, integritySignature, verifyEventChecksum } from "@/lib/saas/wompi";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("wompi: firma de integridad = SHA-256 de referencia + centavos + moneda + secreto", () => {
  assert.equal(integritySignature("RH-1", 4990000, "COP", "test_integrity_x"), sha("RH-14990000COPtest_integrity_x"));
  assert.equal(integritySignature("RH-1", 4990000, "COP", "s", "2026-10-20T00:00:00.000Z"), sha("RH-14990000COP2026-10-20T00:00:00.000Zs"));
});

test("wompi: el link del checkout lleva los datos firmados", () => {
  const u = new URL(checkoutUrl({ publicKey: "pub_test_1", reference: "RH-1", amountInCents: 100, currency: "COP", signature: "abc", redirectUrl: "https://remhub.co/dashboard/plan" }));
  assert.equal(u.origin + u.pathname, "https://checkout.wompi.co/p/");
  assert.equal(u.searchParams.get("signature:integrity"), "abc");
  assert.equal(u.searchParams.get("amount-in-cents"), "100");
});

test("wompi: checksum del evento válido, alterado o sin secreto", () => {
  const body = {
    event: "transaction.updated",
    data: { transaction: { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4490000 } },
    signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: "" },
    timestamp: 1530291411,
  };
  body.signature.checksum = sha("1234-1610641025-49201APPROVED44900001530291411test_events_x");
  assert.equal(verifyEventChecksum(body, "test_events_x"), true);
  assert.equal(verifyEventChecksum({ ...body, data: { transaction: { ...body.data.transaction, amount_in_cents: 1 } } }, "test_events_x"), false, "monto cambiado");
  assert.equal(verifyEventChecksum(body, "otro_secreto"), false, "secreto de otro comercio");
  assert.equal(verifyEventChecksum(body, ""), false, "sin secreto");
});
