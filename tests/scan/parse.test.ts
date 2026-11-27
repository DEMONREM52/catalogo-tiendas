import test from "node:test";
import assert from "node:assert/strict";
import { parseScan, sameCode } from "@/lib/scan/parse";

test("un código se respeta tal cual (ceros iniciales, mayúsculas, espacios del medio)", () => {
  assert.deepEqual(parseScan("0000123456\r\n"), { kind: "code", code: "0000123456", raw: "0000123456\r\n" });
  assert.equal((parseScan("  W 0806 RYL018\t") as { code: string }).code, "W 0806 RYL018");
  assert.equal((parseScan("sc11 w f") as { code: string }).code, "sc11 w f");
  assert.equal(parseScan(" \n ").kind, "empty");
});

test("QR de una caja de RemHub → la caja (con o sin subdominio)", () => {
  const t = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
  assert.deepEqual(parseScan(`https://remhub.co/dashboard/pedidos/internos?caja=${t}`), { kind: "box", token: t, raw: `https://remhub.co/dashboard/pedidos/internos?caja=${t}` });
  assert.equal(parseScan(`https://lavitrina.remhub.co/dashboard/pedidos/internos?caja=${t.toUpperCase()}`).kind, "box");
  assert.equal(parseScan(`https://mitienda.com/dashboard/pedidos/internos?caja=${t}`, { hosts: ["mitienda.com"] }).kind, "box");
});

test("ficha de producto y traslado de RemHub", () => {
  const id = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
  assert.deepEqual(parseScan(`https://remhub.co/la-vitrina/producto/${id}`), { kind: "product", id, raw: `https://remhub.co/la-vitrina/producto/${id}` });
  assert.equal(parseScan("https://remhub.co/traslado/abcdef123456").kind, "transfer");
});

test("un enlace de otro sitio no se abre: queda como texto", () => {
  const r = parseScan("https://sitio-raro.com/pagar?x=1");
  assert.equal(r.kind, "url");
  assert.equal(parseScan("https://remhub.co.sitio-raro.com/dashboard/pedidos/internos?caja=1b4e28ba-2fa1-11d2-883f-0016d3cca427").kind, "url");
});

test("coincidencia exacta de código: sin distinguir mayúsculas, pero los ceros cuentan", () => {
  assert.equal(sameCode("ab-1240", "AB-1240"), true);
  assert.equal(sameCode("00123", "123"), false);
  assert.equal(sameCode("123", null, undefined, "123"), true);
  assert.equal(sameCode("", ""), false);
});
