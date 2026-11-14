import test from "node:test";
import assert from "node:assert/strict";
import { understand, type RemContext, type Topic } from "@/lib/rem/understand";
import { runAction, type ActionEnv, type RpcResult } from "@/lib/rem/actions";
import { emptyBrain, think } from "@/lib/rem/brain";
import { moneyIn } from "@/lib/rem/money";
import { parseRange } from "@/lib/rem/period";
import { setStorePhrases } from "@/lib/rem/memory";
import { learnedPhrase } from "@/lib/voice/navigate";
import { SEARCH_INDEX } from "@/lib/search-index";

const NOW = new Date("2026-11-13T15:00:00Z"); // viernes 13/11/2026
const ALL = SEARCH_INDEX.map((e) => ({ href: e.href, label: e.label, action: e.action }));
const ctx = (path = "/dashboard", links = ALL, topic: Topic | null = null): RemContext => ({ path, now: NOW, topic, links });
const intent = (t: string, c = ctx()) => understand(t, c)?.intent ?? null;

function env(perms: string[], answers: Record<string, RpcResult | ((args: Record<string, unknown>) => RpcResult)> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const e: ActionEnv = {
    storeId: "s1",
    can: (p) => perms.includes(p),
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const a = answers[fn];
      return typeof a === "function" ? a(args) : a ?? { data: null, error: { message: "sin respuesta" } };
    },
  };
  return { e, calls };
}

test("valores dichos dentro de la frase", () => {
  assert.equal(moneyIn("registra un gasto de 50 mil en arriendo")?.value, 50000);
  assert.equal(moneyIn("cincuenta mil pesos de transporte")?.value, 50000);
  assert.equal(moneyIn("un gasto de $20.000")?.value, 20000);
  assert.equal(moneyIn("1 millón 200 mil en mercancía")?.value, 1200000);
  assert.equal(moneyIn("un millón de pesos")?.value, 1000000);
  assert.equal(moneyIn("1.5 millones")?.value, 1500000);
  assert.equal(moneyIn("un gasto de arriendo"), null, "«un» suelto no es un valor");
});

test("rangos: este mes, el mes pasado, semanas, un mes dicho", () => {
  assert.deepEqual([parseRange("este mes", NOW)?.from, parseRange("este mes", NOW)?.to], ["2026-11-01", "2026-11-13"]);
  assert.deepEqual([parseRange("el mes pasado", NOW)?.from, parseRange("el mes pasado", NOW)?.to, parseRange("el mes pasado", NOW)?.label], ["2026-10-01", "2026-10-31", "en octubre"]);
  assert.deepEqual([parseRange("esta semana", NOW)?.from, parseRange("esta semana", NOW)?.days], ["2026-11-09", 5]);
  assert.deepEqual([parseRange("la semana pasada", NOW)?.from, parseRange("la semana pasada", NOW)?.to], ["2026-11-02", "2026-11-08"]);
  assert.equal(parseRange("gastos en octubre", NOW)?.from, "2026-10-01");
  assert.equal(parseRange("en diciembre", NOW)?.from, "2025-12-01", "un mes que no ha llegado: el del año pasado");
  assert.equal(parseRange("el 5 de octubre", NOW)?.days, 1, "una fecha es un día, no el mes");
  assert.equal(parseRange("ayer", NOW)?.from, "2026-11-12");
  assert.equal(parseRange("cuanto gastamos", NOW), null);
});

test("existencias: muchas formas, y nada de cantidades sueltas", () => {
  for (const [t, p] of [["cuántas hay de la cámara sc30a", "camara sc30a"], ["cuántas zapateras negras quedan", "zapateras negras"], ["hay termos", "termos"], ["stock de la vts30", "vts30"], ["existencias de la zapatera", "zapatera"]] as const) {
    const i = intent(t);
    assert.ok(i && i.kind === "stock", t);
    assert.equal(i.q.product, p, t);
  }
  for (const t of ["hay tres", "quedan 5", "hay que hacer un traslado", "cuántos pedidos hay", "hay dos unidades"]) assert.notEqual(intent(t)?.kind, "stock", t);
});

test("cartera y gastos: qué se pregunta", () => {
  assert.deepEqual((intent("cuánto nos deben") as { q: unknown }).q, { customer: null });
  assert.deepEqual((intent("¿cómo va la cartera?") as { q: unknown }).q, { customer: null }, "«cómo va» no es «cómo se hace»");
  assert.deepEqual((intent("cuánto debe Juan Pérez") as { q: unknown }).q, { customer: "juan perez" });
  assert.equal(intent("cuánto le debemos al proveedor")?.kind, "payables", "lo que debemos no es cartera: son cuentas por pagar");
  assert.equal(intent("para qué sirve la cartera")?.kind, "explain");
  const g = intent("cuánto hemos gastado este mes");
  assert.ok(g && g.kind === "expenses" && g.q.range.from === "2026-11-01" && g.q.status === "all");
  const p = intent("gastos pendientes");
  assert.ok(p && p.kind === "expenses" && p.q.status === "open");
  const v = intent("gastos vencidos");
  assert.ok(v && v.kind === "expenses" && v.q.status === "overdue");
  assert.equal(intent("cómo registro un gasto")?.kind, "howto");
  assert.equal(intent("abre los gastos"), null);
  // Seguimiento: «¿y el mes pasado?»
  const topic: Topic = { kind: "expenses", q: g.q };
  const f = intent("y el mes pasado", ctx("/dashboard", ALL, topic));
  assert.ok(f && f.kind === "expenses" && f.q.range.label === "en octubre");
});

test("llenar un gasto hablando: valor y detalle, sin guardar", async () => {
  const d = intent("registra un gasto de 50 mil en arriendo");
  assert.ok(d && d.kind === "draft_expense");
  assert.deepEqual(d.draft, { amount: 50000, detail: "arriendo" });
  assert.deepEqual((intent("anota un gasto de almuerzo por 20.000") as { draft: unknown }).draft, { amount: 20000, detail: "almuerzo" });
  const r = await think("registra un gasto de 50 mil en arriendo", ctx(), null, emptyBrain());
  assert.equal(r?.go?.href, "/dashboard/gastos?tab=expenses&nuevo=gasto&valor=50000&detalle=arriendo");
  assert.match(r!.reply.say, /guárdalo tú/);
  // Sin permiso de gastos: no abre nada.
  const seller = ALL.filter((l) => l.href === "/dashboard/pos");
  const n = await think("registra un gasto de 50 mil en arriendo", ctx("/dashboard", seller), null, emptyBrain());
  assert.equal(n?.go, undefined);
  assert.match(n!.reply.say, /no tiene permiso/);
  // En medio de un traslado no abre formularios.
  assert.equal(await think("registra un gasto de 50 mil", ctx(), null, emptyBrain(), { inScreen: true }), null);
});

const PRODUCTS = [{ id: "p1", name: "Cámara SC30A", sku: "SC30A", active: true }, { id: "p2", name: "Cámara SC30A Pro", sku: "SC30AP", active: true }, { id: "p3", name: "Cámara solar", sku: null, active: false }];
const STOCK = [{ warehouse_id: "w1", name: "Bodega", kind: "warehouse", qty: 8 }, { warehouse_id: "w2", name: "Zamora", kind: "point", qty: 4 }, { warehouse_id: "w3", name: "Centro", kind: "point", qty: 0 }];

test("existencias: un producto exacto da el total por punto", async () => {
  const { e, calls } = env(["pos"], { search_products_safe: { data: PRODUCTS, error: null }, erp_product_stock_by_point: { data: STOCK, error: null } });
  const r = await runAction("stock.product", { product: "sc30a" }, e);
  assert.equal(r.ok, true);
  assert.match(r.reply.say, /hay 12 unidades: Bodega, 8; Zamora, 4/);
  assert.doesNotMatch(r.reply.say, /Centro/, "los puntos sin unidades no se nombran");
  assert.deepEqual(calls.map((c) => c.fn), ["search_products_safe", "erp_product_stock_by_point"]);
  assert.equal(calls[1].args.p_product, "p1");
});

test("existencias: varios parecidos → pregunta cuál y con «el dos» consulta ese", async () => {
  const { e, calls } = env(["inventory"], { search_products_safe: { data: PRODUCTS, error: null }, erp_product_stock_by_point: { data: STOCK.slice(0, 1), error: null } });
  const st = emptyBrain();
  const a = await think("cuántas hay de la cámara", ctx(), e, st);
  assert.match(a!.reply.say, /Encontré varios\. ¿Cuál\?/);
  assert.equal(st.choices?.length, 3);
  const b = await think("la dos", ctx(), e, st);
  assert.match(b!.reply.say, /cámara sc30a pro hay 8 unidades, en Bodega/);
  assert.equal(calls.at(-1)?.args.p_product, "p2");
});

test("existencias: sin permiso, no encontrado, inactivo, agotado y sin conexión", async () => {
  const none = env([]);
  assert.match((await runAction("stock.product", { product: "camara" }, none.e)).reply.say, /no tiene permiso/);
  assert.equal(none.calls.length, 0);
  const empty = env(["pos"], { search_products_safe: { data: [], error: null } });
  assert.match((await runAction("stock.product", { product: "unicornio" }, empty.e)).reply.say, /No encontré «unicornio»/);
  const off = env(["pos"], { search_products_safe: { data: [PRODUCTS[2]], error: null }, erp_product_stock_by_point: { data: [{ ...STOCK[2] }], error: null } });
  const r = await runAction("stock.product", { product: "camara solar" }, off.e);
  assert.match(r.reply.say, /no hay unidades en ningún punto\. Está inactivo/);
  const down = env(["pos"], { search_products_safe: { data: null, error: { message: "Failed to fetch" } } });
  const d = await runAction("stock.product", { product: "camara" }, down.e);
  assert.equal(d.ok, false);
  assert.doesNotMatch(d.reply.say, /\d/);
});

test("gastos: el total del rango, con el permiso de gastos", async () => {
  const { e, calls } = env(["expenses"], { erp_expenses_list: { data: { total: 7, sum: 1830000, rows: [] }, error: null } });
  const r = await runAction("expenses.summary", { range: parseRange("este mes", NOW)!, status: "open" }, e);
  assert.match(r.reply.say, /Este mes van 7 gastos pendientes de pagar, por 1\.830\.000 pesos/);
  assert.equal(calls[0].args.p_from, "2026-11-01");
  assert.equal(calls[0].args.p_status, "open");
  assert.equal(r.offer?.href, "/dashboard/gastos?tab=expenses");
  const seller = env(["pos"]);
  assert.match((await runAction("expenses.summary", { range: parseRange("este mes", NOW)!, status: "all" }, seller.e)).reply.say, /no tiene permiso/);
  assert.equal(seller.calls.length, 0);
});

const RECEIVABLES = {
  kpis: { open: 900000, open_count: 3, overdue: 300000, overdue_count: 1, customers: 2 },
  items: [
    { customer_id: "c1", customer: "Juan Pérez", balance: 300000, late: 12 },
    { customer_id: "c1", customer: "Juan Pérez", balance: 200000, late: -3 },
    { customer_id: "c2", customer: "Martha Ruiz", balance: 400000, late: -10 },
  ],
};

test("cartera: total, por cliente y sin inventar", async () => {
  const { e } = env(["receivables"], { erp_receivables_overview: { data: RECEIVABLES, error: null } });
  const all = await runAction("debts.summary", { customer: null }, e);
  assert.match(all.reply.say, /Te deben 900\.000 pesos entre 2 clientes\. De eso, 300\.000 pesos está vencido/);
  const juan = await runAction("debts.summary", { customer: "juan perez" }, e);
  assert.match(juan.reply.say, /Juan Pérez debe 500\.000 pesos en 2 documentos\. Lo más viejo tiene 12 días de vencido/);
  const nadie = await runAction("debts.summary", { customer: "pedro" }, e);
  assert.match(nadie.reply.say, /No encontré deudas abiertas de «pedro»/);
  const sin = env(["pos"]);
  assert.match((await runAction("debts.summary", { customer: null }, sin.e)).reply.say, /no tiene permiso/);
});

test("ofrecer abrir solo si la persona lo puede abrir", async () => {
  const { e } = env(["receivables"], { erp_receivables_overview: { data: RECEIVABLES, error: null } });
  const st = emptyBrain();
  const r = await think("cuánto nos deben", ctx("/dashboard", ALL), e, st);
  assert.equal(st.offer?.href, "/dashboard/clientes?tab=cartera");
  assert.match(r!.reply.say, /¿Te abro la cartera\?$/);
  const st2 = emptyBrain();
  const r2 = await think("cuánto nos deben", ctx("/dashboard", []), e, st2);
  assert.equal(st2.offer, null);
  assert.doesNotMatch(r2!.reply.say, /¿Te abro/);
});

const PROFIT = {
  kpis: { revenue: 5000000, cost: 3500000, profit: 1500000, orders: 40, units: 90, lines: 60, lines_estimated: 0 },
  by_point: [{ name: "Zamora", revenue: 3000000, profit: 900000, orders: 25 }, { name: "Centro", revenue: 2000000, profit: 600000, orders: 15 }],
  products: [{ name: "Termo", units: 10, revenue: 100000, profit: 20000 }, { name: "Cámara SC30A", units: 30, revenue: 900000, profit: 300000 }],
};

test("ventas de un rango: con permiso de rentabilidad, la suma; sin él, lo dice (no inventa)", async () => {
  const seller = env(["reports"]);
  const r = await think("cuánto vendimos este mes", ctx(), seller.e, emptyBrain());
  assert.match(r!.reply.say, /permiso de rentabilidad/);
  assert.equal(seller.calls.length, 0);
  const { e, calls } = env(["profit_view"], { erp_profit_summary: { data: PROFIT, error: null } });
  const m = await think("cuánto vendimos este mes", ctx(), e, emptyBrain());
  assert.match(m!.reply.say, /Este mes van 40 ventas, por 5\.000\.000 pesos\. La que más vendió: Zamora/);
  assert.deepEqual(calls[0].args, { p_store: "s1", p_from: "2026-11-01T00:00:00-05:00", p_to: "2026-11-14T00:00:00-05:00", p_point: null }, "hasta el final de hoy, hora de Colombia");
  const top = await think("lo más vendido este mes", ctx(), e, emptyBrain());
  assert.match(top!.reply.say, /1, cámara sc30a, 30; 2, termo, 10/, "por unidades");
  const z = await think("cuánto vendimos este mes en la sede zamora", ctx(), e, emptyBrain());
  assert.match(z!.reply.say, /en Zamora, por 3\.000\.000 pesos/);
});

test("ganancia: margen, seguimiento «¿y el mes pasado?» y sin permiso", async () => {
  const { e, calls } = env(["profit_view"], { erp_profit_summary: { data: PROFIT, error: null } });
  const st = emptyBrain();
  const a = await think("cuánto ganamos este mes", ctx(), e, st);
  assert.match(a!.reply.say, /la ganancia va en 1\.500\.000 pesos, sobre ventas de 5\.000\.000 pesos: un margen del 30 %/);
  await think("no", ctx(), e, st);
  await think("y el mes pasado", ctx(), e, st);
  assert.equal(calls.at(-1)?.args.p_from, "2026-10-01T00:00:00-05:00");
  assert.equal(calls.at(-1)?.args.p_to, "2026-11-01T00:00:00-05:00");
  const no = env(["pos"]);
  assert.match((await think("cuánto ganamos este mes", ctx(), no.e, emptyBrain()))!.reply.say, /no tiene permiso/);
  assert.equal(no.calls.length, 0);
});

test("pendientes, cuentas por pagar, caja y metas", async () => {
  const tasks = env(["pos"], { erp_my_tasks: { data: { ok: true, tasks: [
    { key: "a", title: "2 pedidos por despachar", body: "", href: "/dashboard/pedidos?tab=internos", count: 2, severity: "info" },
    { key: "b", title: "1 traslado por recibir", body: "", href: "/dashboard/inventario?tab=transfers", count: 1, severity: "warning" },
  ] }, error: null } });
  const st = emptyBrain();
  const t = await think("qué tengo pendiente", ctx(), tasks.e, st);
  assert.match(t!.reply.say, /Tienes 2 pendientes: 2 pedidos por despachar; 1 traslado por recibir\. ¿Te abro 1 traslado por recibir\?/, "lo urgente primero");
  assert.equal(st.offer?.href, "/dashboard/inventario?tab=transfers");
  const empty = env([], { erp_my_tasks: { data: { ok: true, tasks: [] }, error: null } });
  assert.match((await think("qué me falta por hacer", ctx(), empty.e, emptyBrain()))!.reply.say, /Todo al día/);

  const pay = env(["payables"], { erp_payables_board: { data: { ok: true, rows: [
    { supplier_name: "Distribuidora La Esperanza", balance: 500000, due_date: "2026-11-10", days_left: -3, status: "open" },
    { supplier_name: "Importadora Sol", balance: 300000, due_date: "2026-11-16", days_left: 3, status: "open" },
    { supplier_name: "Importadora Sol", balance: 100000, due_date: null, days_left: null, status: "paid" },
  ] }, error: null } });
  assert.match((await think("cuánto le debemos a los proveedores", ctx(), pay.e, emptyBrain()))!.reply.say, /Les debes a los proveedores 800\.000 pesos en 2 facturas\. Vencido: 500\.000 pesos\. 1 vence en los próximos 7 días/);
  assert.match((await think("cuánto le debemos a importadora sol", ctx(), pay.e, emptyBrain()))!.reply.say, /A Importadora Sol le debes 300\.000 pesos en 1 factura/);
  assert.match((await think("cuánto le debemos al proveedor pepito", ctx(), pay.e, emptyBrain()))!.reply.say, /No le debes nada a «pepito»/);
  assert.match((await think("cuánto le debemos a los proveedores", ctx(), env(["pos"]).e, emptyBrain()))!.reply.say, /no tiene permiso/);

  const cash = env(["cash"], { erp_cash_board: { data: { ok: true, points: [
    { name: "Zamora", open: { opened_at: "2026-11-13T13:05:00Z", opened_by: "Ana", breakdown: { expected: 350000 } }, last_closed: null },
    { name: "Centro", open: null, last_closed: { difference: 0 } },
  ] }, error: null } });
  assert.match((await think("cómo va la caja", ctx(), cash.e, emptyBrain()))!.reply.say, /Zamora: abierta desde las 8:05 a\.\s?m\., debería haber 350\.000 pesos\. Centro: cerrada/);
  assert.equal((await think("cómo abro la caja", ctx(), cash.e, emptyBrain()))?.reply.say.startsWith("Para abrir la caja"), true, "«cómo abro» es cómo se hace");

  const goals = env(["pos"], { erp_goals_progress: { data: { ok: true, goals: [{ point: "Zamora", seller: null, amount: 10000000, done: 6300000, pct: 63, per_day_needed: 214000 }] }, error: null },
    erp_commissions: { data: { ok: true, all: false, sellers: [{ seller: "Ana", commission: 120000, sales: 2400000 }] }, error: null } });
  assert.match((await think("cómo van las metas", ctx(), goals.e, emptyBrain()))!.reply.say, /Zamora va en 63 %, 6\.300\.000 pesos de 10\.000\.000 pesos; le faltan 214\.000 pesos por día/);
  assert.match((await think("cuánto llevo de comisión", ctx(), goals.e, emptyBrain()))!.reply.say, /llevas 120\.000 pesos de comisión/);
});

test("crear un cliente o un producto hablando: abre el formulario lleno, sin guardar", async () => {
  const c = await think("crea un cliente que se llama Juan Pérez con cédula 1020304050", ctx(), null, emptyBrain());
  assert.equal(c?.go?.href, "/dashboard/clientes?nuevo=tercero&tipo=customer&nombre=Juan+P%C3%A9rez&documento=1020304050");
  assert.match(c!.reply.say, /guárdalo tú/);
  const p = await think("registra un proveedor Distribuidora La Esperanza con NIT 900123456", ctx(), null, emptyBrain());
  assert.match(p!.go!.href, /tipo=supplier&nombre=Distribuidora\+la\+Esperanza&documento=900123456&nit=1/);
  const m = await think("agrega el cliente María Gómez celular 300 123 4567", ctx(), null, emptyBrain());
  assert.match(m!.go!.href, /nombre=Mar%C3%ADa\+G%C3%B3mez&celular=3001234567/);
  const pr = await think("crea un producto que se llama zapatera negra HM03", ctx(), null, emptyBrain());
  assert.equal(pr?.go?.href, "/dashboard/products/crear?nombre=" + encodeURIComponent("Zapatera Negra HM03"));
  // Sin permiso: no abre.
  const seller = ALL.filter((l) => l.href === "/dashboard/pos");
  assert.equal((await think("crea un cliente que se llama Juan", ctx("/dashboard", seller), null, emptyBrain()))?.go, undefined);
  assert.equal((await think("crea un producto que se llama termo", ctx("/dashboard", seller), null, emptyBrain()))?.go, undefined);
  // «Cómo creo un cliente» sigue siendo explicar.
  assert.equal((await think("cómo creo un cliente", ctx(), null, emptyBrain()))?.go, undefined);
});

test("por qué no: el plan o el permiso", async () => {
  const noPayroll = ALL.filter((l) => !l.href.startsWith("/dashboard/gastos"));
  const plan = await think("para qué sirve la nómina", { ...ctx("/dashboard", noPayroll), blockedBy: () => "plan" }, null, emptyBrain());
  assert.match(plan!.reply.say, /El plan de la tienda no incluye/);
  const perm = await think("para qué sirve la nómina", { ...ctx("/dashboard", noPayroll), blockedBy: () => "permission" }, null, emptyBrain());
  assert.match(perm!.reply.say, /Tu usuario no tiene acceso/);
});

test("en medio de un traslado: «hay termos» es de la pantalla; la pregunta completa sí se responde", async () => {
  const { e } = env(["pos"], { search_products_safe: { data: [PRODUCTS[0]], error: null }, erp_product_stock_by_point: { data: STOCK, error: null } });
  assert.equal(await think("hay termos", ctx(), e, emptyBrain(), { inScreen: true }), null);
  assert.equal(await think("hay tres", ctx(), e, emptyBrain(), { inScreen: true }), null);
  const r = await think("cuántas hay de la cámara sc30a", ctx(), e, emptyBrain(), { inScreen: true });
  assert.match(r!.reply.say, /hay 12 unidades/);
});

test("frases que la tienda le enseñó: valen para todos, pero lo de cada persona va primero", () => {
  setStorePhrases([{ key: "la plata de los muchachos", href: "/dashboard/gastos?tab=payroll", label: "Nómina" }, { key: "malo", href: "https://afuera.com", label: "x" }]);
  assert.equal(learnedPhrase("La plata de los muchachos")?.label, "Nómina");
  assert.equal(learnedPhrase("malo"), null, "un enlace de afuera no se acepta");
  setStorePhrases([]);
  assert.equal(learnedPhrase("la plata de los muchachos"), null);
});

test("más «cómo se hace» leídos de las pantallas", () => {
  for (const [t, id] of [["cómo hago un apartado", "layaways.create"], ["cómo aparto un producto", "layaways.create"], ["cómo hago una cotización", "quotes.create"],
    ["cómo creo una promoción", "promos.create"], ["cómo hago un descuento", "promos.create"], ["cómo registro una garantía", "warranty.create"], ["cómo hago una devolución", "warranty.create"]] as const) {
    const i = intent(t);
    assert.equal(i && i.kind === "howto" ? i.howto?.id : null, id, t);
  }
});

test("«¿qué sabes hacer?» nombra solo lo que la persona puede usar (sale del catálogo)", async () => {
  const seller = (await think("qué sabes hacer", ctx(), env(["pos", "products"]).e, emptyBrain()))!.reply.say;
  assert.match(seller, /las ventas, las existencias/);
  assert.match(seller, /te lleno hablando un producto/);
  assert.doesNotMatch(seller, /gasto|cartera|proveedores|ganancia/);
  const boss = (await think("qué sabes hacer", ctx(), env(["pos", "expenses", "receivables", "profit_view", "payables", "cash", "clients", "products"]).e, emptyBrain()))!.reply.say;
  for (const w of ["la ganancia", "la cartera", "los gastos", "la caja", "un gasto", "un cliente o proveedor"]) assert.ok(boss.includes(w), w);
});
