import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRecipients } from "@/lib/push/server";
import { defaultConfig, normalizeConfig, resolveEvent, statusEvent } from "@/lib/sounds/prefs";
import { TONES, TONE_BY_ID } from "@/lib/sounds/tones";

const A = "point-a"; // pide
const B = "point-b"; // atiende
const build = (point: string | null) => ({ title: "t", body: "b", url: "/x", point });

function audience(cfg = defaultConfig()) {
  return {
    cfg,
    people: new Map<string, string[]>([
      ["owner", []],
      ["vendedor-a", [A]],
      ["bodega-b", [B]],
      ["multi", [A, B]],
      ["otro", ["point-c"]],
    ]),
  };
}

test("pedido nuevo: le llega al punto que atiende y al dueño, no a quien pidió", () => {
  const r = pickRecipients(audience(), [B], "new_request", ["vendedor-a"], build);
  assert.deepEqual([...r.keys()].sort(), ["bodega-b", "multi", "owner"]);
  assert.equal(r.get("bodega-b")?.point, B);
  assert.equal(r.get("owner")?.point, null);
});

test("mensaje: les llega a los dos puntos menos al que escribió", () => {
  const r = pickRecipients(audience(), [A, B], "message", ["bodega-b"], build);
  assert.deepEqual([...r.keys()].sort(), ["multi", "owner", "vendedor-a"]);
});

test("sin «dueño escucha todo» el dueño no recibe", () => {
  const cfg = defaultConfig();
  cfg.admins_all = false;
  const r = pickRecipients(audience(cfg), [B], "new_request", [], build);
  assert.deepEqual([...r.keys()].sort(), ["bodega-b", "multi"]);
});

test("push apagado en la tienda: nadie recibe", () => {
  const cfg = defaultConfig();
  cfg.push = false;
  assert.equal(pickRecipients(audience(cfg), [B], "new_request", [], build).size, 0);
});

test("un punto puede apagar un evento sin afectar a los demás", () => {
  const cfg = normalizeConfig({ points: { [B]: { events: { new_request: { on: false } } } } });
  const r = pickRecipients(audience(cfg), [B], "new_request", [], build);
  assert.ok(!r.has("bodega-b"));
  assert.ok(r.has("owner"));
  assert.equal(resolveEvent(cfg, "new_request", A).on, true);
});

test("configuración: tonos válidos, se ignoran valores raros", () => {
  assert.equal(TONES.length, 70);
  assert.equal(new Set(TONES.map((t) => t.id)).size, 70);
  assert.equal(TONES.filter((t) => t.id.startsWith("llamada-")).length, 20);
  assert.equal(normalizeConfig({}).events.video_call.tone, "llamada-marimba");
  const cfg = normalizeConfig({ volume: 7, events: { message: { tone: "no-existe", on: false } }, points: { x: { events: { message: { tone: "campanita" } } } } });
  assert.equal(cfg.volume, 1);
  assert.equal(cfg.events.message.on, false);
  assert.ok(TONE_BY_ID.has(cfg.events.message.tone));
  assert.equal(resolveEvent(cfg, "message", "x").tone, "campanita");
  for (const e of Object.values(defaultConfig().events)) assert.ok(TONE_BY_ID.has(e.tone), e.tone);
  assert.equal(statusEvent("pending"), null);
  assert.equal(statusEvent("dispatched"), "dispatched");
});
