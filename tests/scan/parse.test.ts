import test from "node:test";
import assert from "node:assert/strict";
import { matchScan, parseScan, sameCode, sameName } from "@/lib/scan/parse";

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

test("coincidencia exacta: el QR con el nombre completo encuentra el producto; por código, no", () => {
  const items = [
    { id: "a", name: "MAQUINA 5 EN 1 DE DAMA VGR V 759", sku: "MV-759", barcode: null },
    { id: "b", name: "MAQUINA 5 EN 1", sku: "MV-5", barcode: "7701234" },
    { id: "c", name: "SARTÉN  ROJA", sku: "S_1", barcode: null },
  ];
  const qr = "MAQUINA 5 EN 1 DE DAMA VGR V 759";
  assert.deepEqual(matchScan(qr, items, "exact").map((x) => x.id), ["a"]);
  assert.deepEqual(matchScan(qr, items, "code"), []);
  // Nunca «contiene» ni «se parece»: «MAQUINA 5 EN 1» solo es la b.
  assert.deepEqual(matchScan("maquina 5 en 1", items, "exact").map((x) => x.id), ["b"]);
  assert.deepEqual(matchScan("MAQUINA", items, "exact"), []);
  // Tildes, mayúsculas y espacios de más no importan en el nombre.
  assert.equal(sameName("sarten roja", "SARTÉN  ROJA"), true);
  assert.equal(sameName("", "x"), false);
  // Por código sigue funcionando en los dos modos (y el «_» no es comodín).
  assert.deepEqual(matchScan("mv-759", items, "code").map((x) => x.id), ["a"]);
  assert.deepEqual(matchScan("7701234", items, "exact").map((x) => x.id), ["b"]);
  assert.deepEqual(matchScan("S-1", items, "code"), []);
  // Sin repetidos aunque llegue dos veces el mismo producto.
  assert.equal(matchScan("MV-5", [...items, items[1]], "code").length, 1);
});
