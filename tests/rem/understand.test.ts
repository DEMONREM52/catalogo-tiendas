import test from "node:test";
import assert from "node:assert/strict";
import { understand, resolveChoice, type RemContext, type Topic } from "@/lib/rem/understand";
import { SEARCH_INDEX } from "@/lib/search-index";
import { MODULES } from "@/lib/rem/modules";

// Todo lo del buscador: como un administrador.
const ALL = SEARCH_INDEX.map((e) => ({ href: e.href, label: e.label, action: e.action }));
// Un vendedor: solo POS, productos y lista general.
const SELLER = ALL.filter((l) => ["/dashboard/pos", "/dashboard/products", "/dashboard/products/crear", "/dashboard/lista-productos"].includes(l.href.split("?")[0]));
const NOW = new Date("2026-11-13T15:00:00Z"); // viernes 13/11/2026, 10 a. m. en Colombia

const ctx = (path = "/dashboard", links = ALL, topic: Topic | null = null): RemContext => ({ path, now: NOW, topic, links });
const intent = (text: string, c = ctx()) => understand(text, c)?.intent ?? null;
const kind = (text: string, c = ctx()) => intent(text, c)?.kind ?? null;
const moduleName = (text: string, c = ctx()) => {
  const i = intent(text, c);
  return i && "module" in i && i.module ? i.module.name : null;
};

test("explicar un módulo, dicho de muchas formas (con y sin tildes, con «Rem»)", () => {
  assert.equal(moduleName("REM, ¿para qué sirve el módulo de productos?"), "Productos");
  assert.equal(moduleName("para que sirve productos"), "Productos");
  assert.equal(moduleName("Qué es la rentabilidad"), "Rentabilidad");
  assert.equal(moduleName("explícame el inventario"), "Inventario");
  assert.equal(moduleName("cómo funciona la caja"), "Caja");
  assert.equal(moduleName("de qué se trata el radar"), "Radar de productos");
  assert.equal(moduleName("qué es el kardex"), "Inventario", "una pestaña lleva a su módulo");
  assert.equal(moduleName("para qué sirve la nómina"), "Gastos y nómina", "nómina sola es la de Gastos, no la electrónica");
  assert.equal(moduleName("qué es la nómina electrónica"), "Nómina electrónica");
});

test("«¿para qué sirve esto?» es la página donde se está", () => {
  assert.equal(moduleName("para qué sirve esto", ctx("/dashboard/gastos?tab=payroll")), "Gastos y nómina");
  assert.equal(moduleName("qué es esta pantalla", ctx("/dashboard/products/radar")), "Radar de productos");
});

test("cómo se hace algo: pasos verificados de la pantalla", () => {
  const p = intent("¿Cómo registro un producto?");
  assert.equal(p?.kind, "howto");
  assert.equal(p && p.kind === "howto" ? p.howto?.id : null, "products.create");
  const g = intent("como hago para registrar un gasto");
  assert.equal(g && g.kind === "howto" ? g.howto?.id : null, "expenses.create");
  const c = intent("cómo ingreso una factura de compra");
  assert.equal(c && c.kind === "howto" ? c.howto?.id : null, "inventory.purchase");
  const t = intent("cómo se hace un traslado");
  assert.equal(t && t.kind === "howto" ? t.howto?.id : null, "inventory.transfer");
  // Sin pasos escritos: sabe en qué módulo es, pero no inventa pasos.
  const cl = intent("cómo creo un cliente");
  assert.equal(cl?.kind, "howto");
  assert.equal(cl && cl.kind === "howto" ? cl.howto : "x", null);
  assert.equal(moduleName("cómo creo un cliente"), "Terceros y cartera");
});

test("ventas: varias formas de preguntar, una sola intención", () => {
  for (const t of ["REM, muéstrame las ventas de hoy", "¿Cuánto vendimos hoy?", "quiero ver lo que hemos vendido", "¿Cómo van las ventas?", "cuanto vendimos", "dime las ventas"]) {
    const i = intent(t);
    assert.equal(i?.kind, "sales", t);
    assert.equal(i && i.kind === "sales" ? i.q.period.label : null, "hoy", t);
  }
  const y = intent("busca las ventas de ayer de la sede principal");
  assert.ok(y && y.kind === "sales");
  assert.equal(y.q.period.day, "2026-11-12");
  assert.equal(y.q.point, "principal");
  const mine = intent("cuánto he vendido yo hoy");
  assert.ok(mine && mine.kind === "sales" && mine.q.scope === "mine");
  const top = intent("qué es lo más vendido");
  assert.ok(top && top.kind === "sales" && top.q.scope === "top", "«qué es lo más vendido» no es explicar un módulo");
  const day = intent("ventas del lunes");
  assert.ok(day && day.kind === "sales" && day.q.period.day === "2026-11-09");
});

test("vender NO es consultar ventas; abrir el informe es navegar", () => {
  assert.equal(kind("quiero hacer una venta"), null);
  assert.equal(kind("vender"), null);
  assert.equal(kind("vamos a vender dos cámaras"), null);
  assert.equal(kind("abre el resumen de ventas"), null, "«abre…» lo maneja la navegación de siempre");
  assert.equal(kind("quiero hacer un traslado"), null);
  assert.equal(kind("abre los gastos"), null);
});

test("conversación: «¿y las de ayer?» sigue hablando de ventas", () => {
  const today = intent("cuánto vendimos hoy");
  assert.ok(today && today.kind === "sales");
  const topic: Topic = { kind: "sales", q: today.q };
  const c = ctx("/dashboard", ALL, topic);
  const ayer = intent("¿Y las de ayer?", c);
  assert.ok(ayer && ayer.kind === "sales" && ayer.q.period.label === "ayer");
  const solo = intent("ayer", c);
  assert.ok(solo && solo.kind === "sales" && solo.q.period.label === "ayer");
  const mias = intent("y las mías", c);
  assert.ok(mias && mias.kind === "sales" && mias.q.scope === "mine" && mias.q.period.label === "hoy");
  const sede = intent("y en la sede centro", c);
  assert.ok(sede && sede.kind === "sales" && sede.q.point === "centro");
  // Sin tema de ventas, «ayer» solo no es nada.
  assert.equal(kind("ayer"), null);
  // Cambio de tema en medio: no se queda pegado a ventas.
  assert.equal(kind("y abre los gastos", c), null);
});

test("«ayúdame a crear uno nuevo» depende de dónde se está", () => {
  const p = intent("ayúdame a crear uno nuevo", ctx("/dashboard/products"));
  assert.ok(p && p.kind === "create");
  assert.deepEqual(p.options.map((o) => o.label), ["Nuevo producto"]);
  const pay = intent("crea uno nuevo", ctx("/dashboard/gastos?tab=payroll"));
  assert.ok(pay && pay.kind === "create");
  assert.deepEqual(pay.options.map((o) => o.label).sort(), ["Nueva nómina", "Nuevo empleado"]);
  const cli = intent("agrega otro", ctx("/dashboard/clientes"));
  assert.ok(cli && cli.kind === "create" && cli.options[0]?.label === "Nuevo cliente o tercero");
});

test("permisos: lo que no puede abrir no aparece como disponible", () => {
  const nom = intent("para qué sirve la nómina", ctx("/dashboard", SELLER));
  assert.ok(nom && nom.kind === "explain");
  assert.equal(nom.available, false, "un vendedor no tiene nómina");
  const prod = intent("para qué sirve productos", ctx("/dashboard", SELLER));
  assert.ok(prod && prod.kind === "explain" && prod.available === true);
  // En Gastos sin permiso de nómina: «crea uno nuevo» no ofrece la nómina.
  const noPay = intent("crea uno nuevo", ctx("/dashboard/gastos?tab=payroll", SELLER));
  assert.ok(noPay && noPay.kind === "create");
  assert.equal(noPay.options.length, 0);
  assert.ok(noPay.hidden > 0, "sabe que hay algo, pero no lo ofrece");
});

test("cosas que no son para este motor", () => {
  for (const t of ["tralalá", "", "qué hora es", "como estas", "hola", "tres de la zapatera", "inactiva el dos"]) assert.equal(kind(t), null, t);
});

test("elegir entre opciones: «la segunda», o por nombre", () => {
  const opts = [{ name: "Pedidos" }, { name: "Terceros y cartera" }];
  assert.equal(resolveChoice("la segunda", opts)?.name, "Terceros y cartera");
  assert.equal(resolveChoice("la primera", opts)?.name, "Pedidos");
  assert.equal(resolveChoice("terceros", opts)?.name, "Terceros y cartera");
  assert.equal(resolveChoice("ninguna de esas cosas raras", opts), null);
});

test("cada módulo se encuentra por su propio nombre", () => {
  for (const m of MODULES) assert.equal(moduleName(`para qué sirve ${m.name}`), m.name, m.name);
});
