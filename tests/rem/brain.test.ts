import test from "node:test";
import assert from "node:assert/strict";
import { emptyBrain, think } from "@/lib/rem/brain";
import type { ActionEnv } from "@/lib/rem/actions";
import type { RemContext } from "@/lib/rem/understand";
import { SEARCH_INDEX } from "@/lib/search-index";

const NOW = new Date("2026-11-13T15:00:00Z");
const ALL = SEARCH_INDEX.map((e) => ({ href: e.href, label: e.label, action: e.action }));
const ctx = (path = "/dashboard", links = ALL): RemContext => ({ path, now: NOW, topic: null, links });
const HOME = { ok: true, points: ["Zamora"], today: { count: 2, total: 50000 }, yesterday: { count: 4, total: 100000 }, mine: { count: 1, total: 20000 }, top: [] };

function env(perms: string[]) {
  const calls: string[] = [];
  const e: ActionEnv = { storeId: "s1", can: (p) => perms.includes(p), rpc: async (fn) => { calls.push(fn); return { data: HOME, error: null }; } };
  return { e, calls };
}

test("explica, ofrece abrir y con «sí» abre (solo si la persona puede abrirlo)", async () => {
  const st = emptyBrain();
  const a = await think("para qué sirve la caja", ctx(), env(["cash"]).e, st);
  assert.match(a!.reply.say, /abrir y cerrar la caja/);
  assert.match(a!.reply.say, /¿(?:Te la abro|Quieres que la abra|Te llevo)\?/);
  assert.equal(st.offer?.href, "/dashboard/caja");
  const b = await think("sí", ctx(), env(["cash"]).e, st);
  assert.equal(b?.go?.href, "/dashboard/caja");
  assert.equal(st.offer, null);
});

test("«no» a la oferta: no abre nada", async () => {
  const st = emptyBrain();
  await think("qué es la rentabilidad", ctx(), null, st);
  const r = await think("no gracias", ctx(), null, st);
  assert.equal(r?.go, undefined);
  assert.match(r!.reply.say, /Algo más/);
});

test("sin acceso: lo dice y no ofrece abrir", async () => {
  const st = emptyBrain();
  const seller = ALL.filter((l) => l.href === "/dashboard/pos");
  const r = await think("para qué sirve la nómina", ctx("/dashboard", seller), env(["pos"]).e, st);
  assert.match(r!.reply.say, /no tiene acceso/);
  assert.equal(st.offer, null);
  // Y aunque diga «sí», no hay nada que abrir.
  const yes = await think("sí", ctx("/dashboard", seller), env(["pos"]).e, st);
  assert.equal(yes?.go, undefined);
});

test("ventas en varios turnos: «¿cuánto vendimos hoy?» → «¿y ayer?»", async () => {
  const st = emptyBrain();
  const { e, calls } = env(["pos"]);
  const a = await think("cuánto vendimos hoy", ctx(), e, st);
  assert.match(a!.reply.say, /Hoy van 2 ventas en Zamora/);
  const b = await think("¿y ayer?", ctx(), e, st);
  assert.match(b!.reply.say, /Ayer fueron 4 ventas/);
  assert.deepEqual(calls, ["erp_home_today", "erp_home_today"], "cada vez pregunta a la base (permisos al día)");
});

test("los permisos se revisan en cada frase: si se los quitan en plena conversación, ya no consulta", async () => {
  const st = emptyBrain();
  let perms = ["pos"];
  const calls: string[] = [];
  const e: ActionEnv = { storeId: "s1", can: (p) => perms.includes(p), rpc: async (fn) => { calls.push(fn); return { data: HOME, error: null }; } };
  await think("cuánto vendimos hoy", ctx(), e, st);
  perms = [];
  const r = await think("y ayer", ctx(), e, st);
  assert.match(r!.reply.say, /no tiene permiso/);
  assert.equal(calls.length, 1, "la memoria de la conversación no da permisos");
});

test("«crea uno nuevo» en Productos abre el formulario vacío; en Nómina pregunta cuál", async () => {
  const p = await think("ayúdame a crear uno nuevo", ctx("/dashboard/products"), null, emptyBrain());
  assert.equal(p?.go?.href, "/dashboard/products/crear");
  const st = emptyBrain();
  const n = await think("crea uno nuevo", ctx("/dashboard/gastos?tab=payroll"), null, st);
  assert.match(n!.reply.say, /¿Qué quieres crear\?/);
  assert.equal(n?.go, undefined);
  const pick = await think("el empleado", ctx("/dashboard/gastos?tab=payroll"), null, st);
  assert.equal(pick?.go?.href, "/dashboard/gastos?tab=payroll&nuevo=empleado");
});

test("ambiguo: pregunta antes de elegir y entiende «la segunda»", async () => {
  const st = emptyBrain();
  const r = await think("qué son los precios", ctx(), null, st);
  assert.equal(r!.reply.say, "¿Te refieres a Lista general de productos o a Rentabilidad?");
  assert.equal(st.choices?.length, 2);
  const b = await think("la segunda", ctx(), null, st);
  assert.match(b!.reply.say, /venta menos el costo/, "explica Rentabilidad");
  assert.equal(st.choices, null);
});

test("en una pantalla con voz: responde la pregunta, no ofrece abrir ni crea nada", async () => {
  const st = emptyBrain();
  const r = await think("para qué sirve la caja", ctx("/dashboard/inventario?tab=transfers"), null, st, { inScreen: true });
  assert.match(r!.reply.say, /¿Seguimos\?$/);
  assert.equal(st.offer, null);
  assert.equal(await think("crea uno nuevo", ctx("/dashboard/inventario?tab=transfers"), null, emptyBrain(), { inScreen: true }), null);
});

test("lo que no es de este motor sigue su camino (null)", async () => {
  for (const t of ["abre los gastos", "quiero hacer un traslado", "inactiva el dos", "tralalá"]) {
    assert.equal(await think(t, ctx(), null, emptyBrain()), null, t);
  }
});

test("«¿qué sabes hacer?» según los permisos", async () => {
  const seller = await think("qué sabes hacer", ctx(), env(["pos"]).e, emptyBrain());
  assert.match(seller!.reply.say, /pos/);
  assert.doesNotMatch(seller!.reply.say, /traslados/);
  const nobody = await think("qué sabes hacer", ctx(), env([]).e, emptyBrain());
  assert.doesNotMatch(nobody!.reply.say, /vendido/);
});
