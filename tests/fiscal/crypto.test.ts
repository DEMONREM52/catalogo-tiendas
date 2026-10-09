import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret, secretAad } from "../../src/lib/fiscal/crypto";

process.env.FISCAL_SECRETS_KEY = randomBytes(32).toString("base64");

test("cifra y descifra una credencial", () => {
  const aad = secretAad("provider_account", "acc-1", "api_token");
  const cipher = encryptSecret("token-super-secreto-1234", aad);
  assert.ok(!cipher.includes("token-super-secreto"));
  assert.equal(decryptSecret(cipher, aad), "token-super-secreto-1234");
});

test("dos cifrados del mismo valor son distintos (IV aleatorio)", () => {
  const aad = secretAad("provider_account", "acc-1", "api_token");
  assert.notEqual(encryptSecret("abc", aad), encryptSecret("abc", aad));
});

test("la credencial no sirve si se copia a otra cuenta (AAD)", () => {
  const cipher = encryptSecret("abc123456", secretAad("provider_account", "acc-1", "api_token"));
  assert.throws(() => decryptSecret(cipher, secretAad("provider_account", "acc-2", "api_token")));
});

test("un dato alterado se detecta", () => {
  const aad = secretAad("numbering_range", "r-1", "technical_key");
  const parts = encryptSecret("clave-tecnica-dian", aad).split(".");
  const body = Buffer.from(parts[3], "base64");
  body[0] ^= 0xff;
  parts[3] = body.toString("base64");
  assert.throws(() => decryptSecret(parts.join("."), aad));
});

test("las pistas nunca muestran el valor completo", () => {
  assert.equal(maskSecret("sk_live_123456789"), "••••6789");
  assert.equal(maskSecret("corta"), "••••");
});

test("sin FISCAL_SECRETS_KEY no se cifra nada (mensaje claro)", () => {
  const saved = process.env.FISCAL_SECRETS_KEY;
  delete process.env.FISCAL_SECRETS_KEY;
  try {
    assert.throws(() => encryptSecret("x", "a"), /FISCAL_SECRETS_KEY/);
  } finally {
    process.env.FISCAL_SECRETS_KEY = saved;
  }
});
