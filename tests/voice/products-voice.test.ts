import test from "node:test";
import assert from "node:assert/strict";
import { parseProductsCommand, searchRequest, whichOne } from "@/lib/voice/products-voice";
import { withoutName } from "@/lib/voice/speech";

// Lo que pidió el dueño: «ren quiero que me busques en los productos la camara sc30a».
test("búscame en los productos…: qué buscar", () => {
  assert.equal(searchRequest(withoutName("ren quiero que me busques en los productos la camara sc30a")), "camara sc30a");
  assert.equal(searchRequest("búscame la cámara SC30"), "camara sc30");
  assert.equal(searchRequest("busca en productos la zapatera negra"), "zapatera negra");
  assert.equal(searchRequest("busca la zapatera negra en los productos"), "zapatera negra");
  assert.equal(searchRequest("me puedes buscar el producto termo licuadora"), "termo licuadora");
  assert.equal(searchRequest("encuéntrame la referencia vts30"), "vts30");
  assert.equal(searchRequest("en productos busca la cámara solar"), "camara solar");
  assert.equal(searchRequest("busca en los productos"), "", "sin qué buscar: pregunta");
  assert.equal(searchRequest("busca el cliente Juan"), null, "clientes no son productos");
  assert.equal(searchRequest("abre los gastos"), null);
  assert.equal(searchRequest("quiero hacer un traslado"), null);
});

test("lo que se le sigue diciendo en Productos", () => {
  const k = (t: string, a: Parameters<typeof parseProductsCommand>[1] = null) => parseProductsCommand(t, a);
  assert.deepEqual(k("léemelos"), { kind: "read" });
  assert.deepEqual(k("cuántos hay"), { kind: "read" });
  assert.deepEqual(k("abre el primero"), { kind: "open", index: 1, name: null });
  assert.deepEqual(k("ábrelo"), { kind: "open", index: null, name: null });
  assert.deepEqual(k("inactívalo"), { kind: "toggle", active: false, index: null, name: null });
  assert.deepEqual(k("inactiva el dos"), { kind: "toggle", active: false, index: 2, name: null });
  assert.deepEqual(k("desactiva la cámara solar"), { kind: "toggle", active: false, index: null, name: "camara solar" });
  assert.deepEqual(k("ya no hay de la tres"), { kind: "toggle", active: false, index: 3, name: null });
  assert.deepEqual(k("actívalo"), { kind: "toggle", active: true, index: null, name: null });
  assert.deepEqual(k("solo los agotados"), { kind: "filter", stock: "out" });
  assert.deepEqual(k("muéstrame solo los inactivos"), { kind: "filter", status: "inactive" });
  assert.deepEqual(k("ordénalos por precio"), { kind: "sort", by: "price" });
  assert.deepEqual(k("los más caros primero"), { kind: "sort", by: "price-desc" });
  assert.deepEqual(k("ahora busca la zapatera"), { kind: "search", query: "zapatera" });
  assert.deepEqual(k("limpia"), { kind: "clear" });
  assert.deepEqual(k("listo"), { kind: "stop" });
  assert.deepEqual(k("sí", "confirm"), { kind: "yes" });
  assert.deepEqual(k("no", "confirm"), { kind: "no" });
  assert.deepEqual(k("el dos", "pick"), { kind: "pick", index: 2 });
  assert.deepEqual(k("cámara sc30", "query"), { kind: "search", query: "camara sc30" }, "si preguntó qué busco, lo dicho es la búsqueda");
  assert.deepEqual(k("tralalá"), { kind: "unknown" });
});

test("cuál de la lista", () => {
  assert.equal(whichOne("el primero"), 1);
  assert.equal(whichOne("la dos"), 2);
  assert.equal(whichOne("el 3"), 3);
  assert.equal(whichOne("el último"), -1);
  assert.equal(whichOne("la cámara"), null);
});
