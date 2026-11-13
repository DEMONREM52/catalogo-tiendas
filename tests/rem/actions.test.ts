import test from "node:test";
import assert from "node:assert/strict";
import { registerAction, runAction, type ActionEnv, type RpcResult } from "@/lib/rem/actions";
import { parsePeriod } from "@/lib/rem/period";
import type { SalesQuery } from "@/lib/rem/understand";

const NOW = new Date("2026-11-13T15:00:00Z");
const q = (text: string, extra: Partial<SalesQuery> = {}): SalesQuery => ({ period: parsePeriod(text, NOW)!, scope: "all", point: null, ...extra });

const HOME = {
  ok: true, points: [], today: { count: 12, total: 1250000 }, yesterday: { count: 10, total: 1000000 },
  mine: { count: 3, total: 300000 }, top: [{ name: "Cámara SC30A", qty: 7 }, { name: "Zapatera negra", qty: 4 }],
};
const CLOSE = { ok: true, day: "2026-11-09", total: 2000000, count: 20, points: [{ name: "Zamora", count: 12, total: 1500000 }, { name: "Centro", count: 8, total: 500000 }], sellers: [] };

function env(perms: string[], answers: Record<string, RpcResult> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const e: ActionEnv = {
    storeId: "store-1",
    can: (p) => perms.includes(p),
    rpc: async (fn, args) => { calls.push({ fn, args }); return answers[fn] ?? { data: null, error: { message: "sin respuesta" } }; },
  };
  return { e, calls };
}

test("ventas de hoy: dato de la base, comparado con ayer, con la tienda de la sesión", async () => {
  const { e, calls } = env(["pos"], { erp_home_today: { data: HOME, error: null } });
  const r = await runAction("sales.summary", q("hoy"), e);
  assert.equal(r.ok, true);
  assert.match(r.reply.say, /12 ventas/);
  assert.match(r.reply.say, /1\.250\.000 pesos/);
  assert.match(r.reply.say, /25 % más que ayer/);
  assert.deepEqual(calls, [{ fn: "erp_home_today", args: { p_store: "store-1" } }]);
  assert.equal(r.topic?.kind, "sales");
});

test("ayer, las mías y lo más vendido", async () => {
  const { e } = env(["pos"], { erp_home_today: { data: HOME, error: null } });
  assert.match((await runAction("sales.summary", q("ayer"), e)).reply.say, /Ayer fueron 10 ventas/);
  assert.match((await runAction("sales.summary", q("hoy", { scope: "mine" }), e)).reply.say, /llevas 3 ventas a tu nombre/);
  const top = await runAction("sales.summary", q("hoy", { scope: "top" }), e);
  assert.match(top.reply.show ?? "", /1\. Cámara SC30A · 7/);
});

test("otro día y por punto: cierre del día, solo con permiso de informes o caja", async () => {
  const { e, calls } = env(["reports"], { erp_daily_close: { data: CLOSE, error: null } });
  const r = await runAction("sales.summary", q("el lunes"), e);
  assert.match(r.reply.say, /fueron 20 ventas/);
  assert.match(r.reply.say, /La que más vendió: Zamora/);
  assert.deepEqual(calls[0], { fn: "erp_daily_close", args: { p_store: "store-1", p_day: "2026-11-09" } });
  const z = await runAction("sales.summary", q("el lunes", { point: "zamora" }), e);
  assert.match(z.reply.say, /en Zamora: 12 ventas/);
});

test("el punto se busca entre los que devuelve la base (solo los de quien pregunta)", async () => {
  const { e } = env(["reports"], { erp_daily_close: { data: CLOSE, error: null } });
  const r = await runAction("sales.summary", q("el lunes", { point: "principal" }), e);
  assert.equal(r.ok, false);
  assert.match(r.reply.say, /no encontré ventas en «principal»/);
  assert.match(r.reply.say, /Zamora, Centro/);
});

test("sin permiso no consulta nada (ni llama a la base)", async () => {
  const { e, calls } = env([]);
  const r = await runAction("sales.summary", q("hoy"), e);
  assert.equal(r.ok, false);
  assert.match(r.reply.say, /no tiene permiso/);
  assert.equal(calls.length, 0);
});

test("un vendedor (solo POS) no ve otros días ni por punto", async () => {
  const { e, calls } = env(["pos"], { erp_home_today: { data: HOME, error: null } });
  const r = await runAction("sales.summary", q("el lunes"), e);
  assert.equal(r.ok, false);
  assert.match(r.reply.say, /informes de ventas/);
  const p = await runAction("sales.summary", q("hoy", { point: "zamora" }), e);
  assert.equal(p.ok, false);
  assert.equal(calls.length, 0);
});

test("si la base dice que no, se dice eso; si falla la red, no inventa un número", async () => {
  const denied = env(["pos"], { erp_home_today: { data: { ok: false, error: "No perteneces a esta tienda." }, error: null } });
  const r1 = await runAction("sales.summary", q("hoy"), denied.e);
  assert.equal(r1.ok, false);
  assert.equal(r1.reply.say, "No perteneces a esta tienda.");
  const down = env(["pos"], { erp_home_today: { data: null, error: { message: "Failed to fetch" } } });
  const r2 = await runAction("sales.summary", q("hoy"), down.e);
  assert.equal(r2.ok, false);
  assert.doesNotMatch(r2.reply.say, /\d/, "ningún número inventado");
  const thrown: ActionEnv = { storeId: "s", can: () => true, rpc: async () => { throw new Error("offline"); } };
  const r3 = await runAction("sales.summary", q("hoy"), thrown);
  assert.equal(r3.ok, false);
  assert.match(r3.reply.say, /No cambié nada/);
});

test("días que no sirven: futuro, más de un año, «tus ventas» de otro día", async () => {
  const { e, calls } = env(["pos", "reports"], { erp_home_today: { data: HOME, error: null } });
  const future = await runAction("sales.summary", { period: { day: "2026-12-01", ago: -18, label: "el 1 de diciembre" }, scope: "all", point: null }, e);
  assert.match(future.reply.say, /todavía no llega/);
  const old = await runAction("sales.summary", { period: { day: "2024-01-01", ago: 1000, label: "x" }, scope: "all", point: null }, e);
  assert.match(old.reply.say, /un año/);
  const mine = await runAction("sales.summary", q("ayer", { scope: "mine" }), e);
  assert.match(mine.reply.say, /solo te las puedo decir de hoy/);
  assert.equal(calls.length, 0);
});

test("riesgo alto exige «sí»; crítico no se hace por voz; desconocida no existe", async () => {
  let ran = 0;
  registerAction<{ id: string }>({ id: "test.high", label: "Inactivar el producto", risk: "high", confirm: "yes", perms: ["products"], validate: (p) => (p.id ? null : "¿Cuál producto?"), run: async () => { ran++; return { ok: true, reply: { say: "Hecho." } }; } });
  registerAction<{ id: string }>({ id: "test.critical", label: "Borrar el producto", risk: "critical", confirm: "strong", perms: ["products"], validate: () => null, run: async () => { ran++; return { ok: true, reply: { say: "Hecho." } }; } });
  const { e } = env(["products"]);
  assert.match((await runAction("test.high", { id: "p1" }, e)).reply.say, /Di sí o no/);
  assert.equal(ran, 0);
  assert.match((await runAction("test.high", { id: "" }, e, { confirmed: true })).reply.say, /¿Cuál producto\?/, "sin saber cuál, no se hace");
  assert.equal(ran, 0);
  assert.equal((await runAction("test.high", { id: "p1" }, e, { confirmed: true })).ok, true);
  assert.equal(ran, 1);
  assert.match((await runAction("test.critical", { id: "p1" }, e, { confirmed: true })).reply.say, /no lo hago por voz/);
  assert.equal(ran, 1, "ni con «sí»");
  // La confirmación no reemplaza el permiso.
  const noPerm = env([]);
  assert.match((await runAction("test.high", { id: "p1" }, noPerm.e, { confirmed: true })).reply.say, /no tiene permiso/);
  assert.equal(ran, 1);
  assert.equal((await runAction("rm -rf /", {}, e, { confirmed: true })).ok, false);
});
