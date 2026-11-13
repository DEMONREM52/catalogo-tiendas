import test from "node:test";
import assert from "node:assert/strict";
import { matchPlace, matchPlaces, parseNumberAt, parseTransferCommand as p, spokenReference } from "@/lib/voice/spanish";

const num = (s: string) => parseNumberAt(s.split(" "), 0);

test("números dichos", () => {
  assert.deepEqual(num("tres"), { value: 3, used: 1 });
  assert.deepEqual(num("veintidos"), { value: 22, used: 1 });
  assert.deepEqual(num("treinta y cinco"), { value: 35, used: 3 });
  assert.deepEqual(num("ciento veinte"), { value: 120, used: 2 });
  assert.deepEqual(num("mil doscientos cuarenta"), { value: 1240, used: 3 });
  assert.deepEqual(num("dos mil"), { value: 2000, used: 2 });
  assert.deepEqual(num("doce cuarenta"), { value: 12, used: 1 });
  assert.deepEqual(num("1.240"), { value: 1240, used: 1 });
  assert.equal(num("zapatera"), null);
});

test("referencias dichas", () => {
  assert.equal(spokenReference("a be guion doce cuarenta"), "AB-1240");
  assert.equal(spokenReference("AB 1240"), "AB1240");
  assert.equal(spokenReference("referencia equis ele cinco"), "XL5");
  assert.equal(spokenReference("doble ve ce cien"), "WC100");
  assert.equal(spokenReference("ab-1240"), "AB-1240");
  assert.equal(spokenReference("55 08"), "5508");
});

const places = [
  { id: "b", name: "BODEGA PRINCIPAL" },
  { id: "z", name: "Punto Zamora" },
  { id: "c", name: "Centro Comercial Unicentro" },
  { id: "n", name: "Punto Norte" },
];

test("puntos por nombre", () => {
  assert.equal(matchPlace("bodega principal", places)?.id, "b");
  assert.equal(matchPlace("la bodega", places)?.id, "b");
  assert.equal(matchPlace("zamora", places)?.id, "z");
  assert.equal(matchPlace("unicentro", places)?.id, "c");
  assert.equal(matchPlace("medellin", places), null);
  assert.equal(matchPlace("punto", places), null);
  assert.deepEqual(matchPlaces("zamora y norte", places).found.map((x) => x.id), ["z", "n"]);
});

test("ruta del traslado", () => {
  assert.deepEqual(p("quiero hacer un traslado"), { kind: "route", from: null, to: null });
  assert.deepEqual(p("Oye REM, quiero hacer un traslado de bodega principal a Zamora"), { kind: "route", from: "bodega principal", to: "zamora" });
  assert.deepEqual(p("de la bodega principal para zamora y norte"), { kind: "route", from: "bodega principal", to: "zamora y norte" });
  assert.deepEqual(p("bodega principal", "from"), { kind: "route", from: "bodega principal", to: null });
  assert.deepEqual(p("bodega principal a zamora", "from"), { kind: "route", from: "bodega principal", to: "zamora" });
  assert.deepEqual(p("de la bodega", "from"), { kind: "route", from: "bodega", to: null });
  assert.deepEqual(p("para zamora", "to"), { kind: "route", from: null, to: "zamora" });
  assert.deepEqual(p("ahora para norte"), { kind: "destination", to: "norte" });
});

test("agregar productos", () => {
  assert.deepEqual(p("tres de AB-1240"), { kind: "add", qty: 3, query: "ab-1240", to: null });
  assert.deepEqual(p("agrega cinco secadores para zamora"), { kind: "add", qty: 5, query: "secadores", to: "zamora" });
  assert.deepEqual(p("zapatera negra"), { kind: "add", qty: null, query: "zapatera negra", to: null });
  assert.deepEqual(p("1240"), { kind: "add", qty: null, query: "1240", to: null });
  assert.deepEqual(p("12 unidades de la zapatera"), { kind: "add", qty: 12, query: "zapatera", to: null });
  assert.deepEqual(p("una zapatera"), { kind: "add", qty: 1, query: "zapatera", to: null });
  assert.deepEqual(p("55 08"), { kind: "add", qty: null, query: "55 08", to: null });
});

test("respuestas cortas según lo que se preguntó", () => {
  assert.deepEqual(p("la dos", "choice"), { kind: "choice", index: 2 });
  assert.deepEqual(p("el primero", "choice"), { kind: "choice", index: 1 });
  assert.deepEqual(p("ninguno", "choice"), { kind: "choice", index: 0 });
  assert.deepEqual(p("cuatro", "qty"), { kind: "number", value: 4 });
  assert.deepEqual(p("cuatro"), { kind: "number", value: 4 });
  assert.deepEqual(p("sí"), { kind: "yes" });
  assert.deepEqual(p("Sí, envíalo"), { kind: "yes" });
  assert.deepEqual(p("no"), { kind: "no" });
  assert.deepEqual(p("listo"), { kind: "done" });
  assert.deepEqual(p("cancelar"), { kind: "stop" });
  assert.deepEqual(p("¿cuántos llevo?"), { kind: "summary" });
});

test("corregir y responsables", () => {
  assert.deepEqual(p("quita el último"), { kind: "undo" });
  assert.deepEqual(p("quita la zapatera"), { kind: "remove", query: "zapatera" });
  assert.deepEqual(p("cambia la zapatera a cuatro"), { kind: "set_qty", query: "zapatera", qty: 4 });
  assert.deepEqual(p("la zapatera son seis"), { kind: "set_qty", query: "zapatera", qty: 6 });
  assert.deepEqual(p("mejor dos"), { kind: "set_qty", query: null, qty: 2 });
  assert.deepEqual(p("lo lleva pedro gomez"), { kind: "carrier", name: "PEDRO GOMEZ" });
  assert.deepEqual(p("revisó juan"), { kind: "checker", name: "JUAN" });
  assert.deepEqual(p("pedro", "carrier"), { kind: "carrier", name: "PEDRO" });
  assert.deepEqual(p("nota llevar con cuidado"), { kind: "notes", text: "llevar con cuidado" });
});

test("conteo, foto y valores", async () => {
  const { parseAmount } = await import("@/lib/voice/spanish");
  const { wakeRest } = await import("@/lib/voice/speech");
  assert.deepEqual(p("zapatera negra hay doce"), { kind: "add", qty: 12, query: "zapatera negra", to: null, exact: true });
  assert.deepEqual(p("de la AB-1240 hay 3"), { kind: "add", qty: 3, query: "ab-1240", to: null, exact: true });
  assert.deepEqual(p("foto"), { kind: "photo" });
  assert.deepEqual(p("busca con foto"), { kind: "photo" });
  assert.equal(parseAmount("doce mil"), 12000);
  assert.equal(parseAmount("12.500 pesos"), 12500);
  assert.equal(parseAmount("$8.000"), 8000);
  assert.equal(parseAmount("doce mil quinientos"), 12500);
  assert.equal(parseAmount("zapatera"), null);
  assert.equal(wakeRest("Oye REM quiero hacer un traslado"), "quiero hacer un traslado");
  assert.equal(wakeRest("hola rem"), "");
  assert.equal(wakeRest("el reembolso de la remisión"), null);
  assert.equal(wakeRest("tráeme la remera"), null);
  // Como lo escribe el reconocedor.
  assert.equal(wakeRest("Oye, Ren. Quiero hacer un traslado."), "quiero hacer un traslado");
  assert.equal(wakeRest("olle rem"), "");
  assert.equal(wakeRest("oyeren"), "");
  assert.equal(wakeRest("Hey Ram vender"), "vender");
  assert.equal(wakeRest("R.E.M. quiero hacer un conteo"), "quiero hacer un conteo");
  assert.equal(wakeRest("Rem, quiero hacer un pedido"), "quiero hacer un pedido");
  assert.equal(wakeRest("la memoria ram del computador"), null);
  assert.equal(wakeRest("hoy en la tienda"), null);
  const { spokenText } = await import("@/lib/voice/speech");
  assert.equal(spokenText("Hola, soy REM. Toca REM."), "Hola, soy Rém. Toca Rém.");
  assert.equal(spokenText("remisión REMERA"), "remisión REMERA");
});

test("REM atiende la última pantalla abierta y vuelve a la de abajo", async () => {
  const { registerRemHandler, remHandler } = await import("@/lib/voice/rem");
  const mk = (title: string) => ({ title, examples: [], start: () => ({ say: title }), hear: () => ({ say: title }) });
  const offPos = registerRemHandler(mk("Venta"));
  const offReq = registerRemHandler(mk("Pedido interno"));
  assert.equal(remHandler()?.title, "Pedido interno");
  offReq();
  assert.equal(remHandler()?.title, "Venta");
  offPos();
  assert.equal(remHandler(), null);
});

test("vaciar la lista: «el traslado bórralo», «borra todo»", async () => {
  const { parseTransferCommand } = await import("@/lib/voice/spanish");
  const k = (t: string) => parseTransferCommand(t).kind;
  assert.equal(k("el traslado el traslado bórralo"), "clear");
  assert.equal(k("borra todo"), "clear");
  assert.equal(k("bórralo todo"), "clear");
  assert.equal(k("elimina el pedido"), "clear");
  assert.equal(k("borra todo el traslado"), "clear");
  assert.equal(k("empieza de nuevo"), "clear");
  assert.equal(k("quita la zapatera"), "remove");
  assert.equal(k("borra la zapatera del pedido"), "remove");
  assert.notEqual(k("la zapatera del pedido bórrala"), "clear", "es un producto, no todo el pedido");
});
