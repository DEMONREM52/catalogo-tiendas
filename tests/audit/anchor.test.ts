import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAnchors, cronAuthorized, signAnchor, verifyAnchorSignature } from "@/lib/audit/anchor";

const SECRET = "x".repeat(40);
const base = { version: 1 as const, created_at: "2026-10-15T08:00:00.000Z",
  heads: [{ chain: "platform", seq: 10, hash: "aa", at: "" }, { chain: "store-a", seq: 500, hash: "bb", at: "" }],
  verify: [{ chain: "store-a", ok: true, checked: 500, breaks: 0 }, { chain: "platform", ok: true, checked: 10, breaks: 0 }] };

test("el ancla firmada se verifica y detecta cualquier cambio", () => {
  const a = signAnchor(base, SECRET);
  assert.ok(verifyAnchorSignature(a, SECRET));
  assert.ok(!verifyAnchorSignature({ ...a, heads: [{ ...a.heads[0], seq: 9 }, a.heads[1]] }, SECRET), "cambiar un número rompe la firma");
  assert.ok(!verifyAnchorSignature(a, "y".repeat(40)), "otra llave no la valida");
  // El orden no importa (texto canónico).
  assert.equal(signAnchor({ ...base, heads: [...base.heads].reverse() }, SECRET).signature, a.signature);
});

test("comparar anclas: detecta borrados al final y cadenas reescritas", () => {
  const prev = signAnchor(base, SECRET);
  assert.deepEqual(compareAnchors(prev, signAnchor({ ...base, heads: [base.heads[0], { ...base.heads[1], seq: 520, hash: "cc" }] }, SECRET)), [], "creció normal");
  assert.match(compareAnchors(prev, signAnchor({ ...base, heads: [base.heads[0], { ...base.heads[1], seq: 480 }] }, SECRET))[0], /se borraron/);
  assert.match(compareAnchors(prev, signAnchor({ ...base, heads: [base.heads[0], { ...base.heads[1], hash: "zz" }] }, SECRET))[0], /reescrita/);
  assert.match(compareAnchors(prev, signAnchor({ ...base, heads: [base.heads[0]] }, SECRET))[0], /desapareció/);
});

test("la tarea solo la ejecuta el programador (CRON_SECRET)", () => {
  const req = (h?: string) => new Request("https://remhub.co/api/audit/anchor", { headers: h ? { authorization: h } : {} });
  assert.equal(cronAuthorized(req(), "s3cret-s3cret"), false);
  assert.equal(cronAuthorized(req("Bearer otro"), "s3cret-s3cret"), false);
  assert.equal(cronAuthorized(req("Bearer s3cret-s3cret"), "s3cret-s3cret"), true);
  assert.equal(cronAuthorized(req("Bearer x"), undefined), false, "sin CRON_SECRET configurado, nadie");
});
