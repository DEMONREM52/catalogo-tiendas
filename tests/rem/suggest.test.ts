import test from "node:test";
import assert from "node:assert/strict";

// localStorage de mentiras (para los atajos de cada persona).
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  },
});

const { correctWords, suggestFor, pickSuggestion, suggestionReply, learnAlias, aliasFor, listAliases, forgetAlias } = await import("@/lib/rem/suggest");
const { similarNames, runAction } = await import("@/lib/rem/actions");
const { emptyBrain, think } = await import("@/lib/rem/brain");
const { setRemScope } = await import("@/lib/rem/memory");
const { SEARCH_INDEX } = await import("@/lib/search-index");
type Env = import("@/lib/rem/actions").ActionEnv;

const ALL = SEARCH_INDEX.map((e) => ({ href: e.href, label: e.label, keywords: e.keywords, hint: e.hint, action: e.action }));
const ctx = (links = ALL) => ({ path: "/dashboard", now: new Date("2026-11-13T15:00:00Z"), topic: null, links });
const yes = () => true;
const says = (t: string, links = ALL, can: (p: string) => boolean = yes) => suggestFor(t, ctx(links), can).map((s) => s.say);

test("corrige palabras mal oídas o mal dichas, por cómo suenan", () => {
  assert.equal(correctWords("cuanto bendimos oy"), "cuanto vendimos hoy");
  assert.equal(correctWords("kuanto vendimos hoy"), "cuanto vendimos hoy");
  assert.equal(correctWords("para que sirbe la rentavilidad"), "para que sirve la rentabilidad");
  assert.equal(correctWords("abrir el inbentario"), "abrir el inventario");
  assert.equal(correctWords("como ago un traslado"), "como hago un traslado");
  assert.equal(correctWords("kiero ber la cartera"), "quiero ver la cartera");
  assert.equal(correctWords("sinkuenta mil"), "cincuenta mil");
  assert.equal(correctWords("mostrar los gastitos del mes"), "mostrar los gastos del mes");
  // No se inventa: «entró» no se vuelve «centro», y los nombres raros se dejan.
  assert.equal(correctWords("la plata que entro hoy"), "la plata que entro hoy");
  assert.equal(correctWords("camara sc30a"), "camara sc30a");
});

test("¿Quisiste decir…?: lo corregido primero, con tildes y signos", () => {
  assert.equal(says("cuanto bendimos oy")[0], "¿Cuánto vendimos hoy?");
  assert.equal(says("para que sirbe el radar")[0], "¿Para qué sirve el radar?");
  assert.equal(says("como ago un traslado")[0], "¿Cómo hago un traslado?");
  assert.ok(says("lo que le debo a los proveedores").includes("¿Cuánto le debemos a los proveedores?"));
  assert.ok(says("el cuadre de caja").includes("Abrir Caja"));
  assert.ok(says("cuanto bendimos oy").length <= 3);
  assert.deepEqual(says("tralalá"), [], "si no hay nada parecido, no inventa");
  // Sin repetidos («Abrir Abrir o cerrar caja» ni la misma frase dos veces).
  for (const t of ["el cuadre de caja", "cuanto bendimos oy", "kiero ber la cartera"]) {
    const s = says(t);
    assert.equal(new Set(s.map((x) => x.toLowerCase().replace(/[¿?]/g, ""))).size, s.length, t);
    assert.ok(!s.some((x) => /^Abrir Abrir/.test(x)), t);
  }
});

test("solo sugiere lo que la persona puede usar", () => {
  const seller = ALL.filter((l) => ["/dashboard/pos", "/dashboard/products", "/dashboard/caja"].includes(l.href.split("?")[0]));
  const can = (p: string) => ["pos", "products", "cash"].includes(p);
  const s = says("kiero ber la nomina de los empleados", seller, can);
  assert.ok(!s.some((x) => /nómina|Nómina/.test(x)), "un vendedor no recibe Nómina como sugerencia");
  const g = says("cuanto emos gastado este mes", seller, can);
  assert.ok(!g.some((x) => /gast/i.test(x)), "ni la consulta de gastos sin permiso de gastos");
});

test("contestar la sugerencia: sí, la dos, por nombre, no, u otra cosa", () => {
  const one = [{ say: "¿Cuánto vendimos hoy?", phrase: "cuanto vendimos hoy" }];
  const three = [{ say: "Abrir Caja", phrase: "abre Caja" }, { say: "¿Cuánto vendimos hoy?", phrase: "cuanto vendimos hoy" }, { say: "Abrir Gastos", phrase: "abre Gastos" }];
  assert.equal(pickSuggestion("sí", one), one[0]);
  assert.equal(pickSuggestion("eso", one), one[0]);
  assert.equal(pickSuggestion("sí", three), null, "con varias, «sí» no dice cuál");
  assert.equal(pickSuggestion("la dos", three), three[1]);
  assert.equal(pickSuggestion("el tercero", three), three[2]);
  assert.equal(pickSuggestion("la caja", three), three[0]);
  assert.equal(pickSuggestion("no", three), "no");
  assert.equal(pickSuggestion("ninguna de esas", three), "no");
  assert.equal(pickSuggestion("quiero hacer un traslado", three), null, "otra cosa: se procesa normal");
  assert.match(suggestionReply(one).say, /¿Quisiste decir «¿Cuánto vendimos hoy\?»\? Di sí o no\./);
  assert.match(suggestionReply(three).say, /uno, Abrir Caja; dos, ¿Cuánto vendimos hoy\?; tres, Abrir Gastos/);
});

test("atajos: lo elegido queda para esa persona (y se puede borrar)", () => {
  store.clear();
  setRemScope("ana", "t1");
  learnAlias("la plata que entró hoy", "cuanto vendimos hoy");
  assert.equal(aliasFor("La plata que entró hoy, por favor"), "cuanto vendimos hoy");
  learnAlias("eh", "abre Caja");
  assert.equal(aliasFor("eh"), null, "una palabra suelta no se aprende");
  setRemScope("beto", "t1");
  assert.equal(aliasFor("la plata que entro hoy"), null, "Beto no tiene los atajos de Ana");
  setRemScope("ana", "t1");
  assert.equal(listAliases().length, 1);
  forgetAlias(listAliases()[0].key);
  assert.equal(aliasFor("la plata que entro hoy"), null);
  setRemScope(null, null);
});

test("nombres parecidos (cliente, proveedor, producto, punto)", () => {
  assert.equal(similarNames("juan peres", ["Martha Ruiz", "Juana Paz", "Juan Pérez"])[0], "Juan Pérez");
  assert.ok(!similarNames("juan peres", ["Martha Ruiz", "Juan Pérez"]).includes("Martha Ruiz"));
  assert.deepEqual(similarNames("importadora zol", ["Importadora Sol", "Distribuidora La Esperanza"]), ["Importadora Sol"]);
  assert.deepEqual(similarNames("samora", ["Zamora", "Centro"]), ["Zamora"]);
  assert.deepEqual(similarNames("pepito", ["Zamora", "Centro"]), []);
});

function env(perms: string[], rpc: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const e: Env = { storeId: "s1", can: (p) => perms.includes(p), rpc: async (fn, args) => { calls.push({ fn, args }); return rpc(fn, args); } };
  return { e, calls };
}

test("producto mal dicho: busca por palabras y pregunta; con «la uno» consulta ese", async () => {
  const PRODUCTS = [{ id: "p1", name: "Zapatera negra 3 niveles", sku: "ZN3", active: true }, { id: "p2", name: "Zapatero de madera", sku: null, active: true }];
  const { e, calls } = env(["pos"], (fn, args) => {
    if (fn === "search_products_safe") return { data: args.p_query === "zapatera" ? PRODUCTS : [], error: null };
    if (fn === "erp_product_stock_by_point") return { data: [{ warehouse_id: "w", name: "Bodega", kind: "warehouse", qty: 6 }], error: null };
    return { data: null, error: { message: "x" } };
  });
  const st = emptyBrain();
  const r = await think("cuántas hay de la zapatera negrra", ctx(), e, st);
  assert.match(r!.reply.say, /No encontré «zapatera negrra»\. ¿Quisiste decir: uno, zapatera negra 3 niveles/);
  const b = await think("la uno", ctx(), e, st);
  assert.match(b!.reply.say, /hay 6 unidades, en Bodega/);
  assert.equal(calls.at(-1)?.args.p_product, "p1");
});

test("cliente o proveedor mal dicho: ¿Quisiste decir…?", async () => {
  const REC = { kpis: { open: 1, open_count: 1, overdue: 0, overdue_count: 0, customers: 1 }, items: [{ customer_id: "c1", customer: "Juan Pérez", balance: 300000, late: 0 }] };
  const { e } = env(["receivables"], () => ({ data: REC, error: null }));
  const st = emptyBrain();
  const r = await think("cuánto debe juan peres", ctx(), e, st);
  assert.match(r!.reply.say, /No encontré a «juan peres» en la cartera\. ¿Quisiste decir: uno, Juan Pérez\?/);
  const b = await think("sí, la uno", ctx(), e, st);
  assert.match(b!.reply.say, /Juan Pérez debe 300\.000 pesos/);

  const PAY = { ok: true, rows: [{ supplier_name: "Importadora Sol", balance: 200000, due_date: null, days_left: null, status: "open" }] };
  const p = env(["payables"], () => ({ data: PAY, error: null }));
  const r2 = await runAction("payables.summary", { supplier: "importadora zol" }, p.e);
  assert.match(r2.reply.say, /¿Quisiste decir: uno, Importadora Sol\?/);
  assert.equal(r2.choices?.[0].action, "payables.summary");
});
