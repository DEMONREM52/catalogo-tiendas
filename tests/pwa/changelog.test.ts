import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_RELEASE, RELEASES, releaseTouches } from "@/lib/pwa/changelog";

test("novedades: números únicos y en orden (el aviso compara por número)", () => {
  const ids = RELEASES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal(BUILD_RELEASE, Math.max(...ids));
});

test("novedades: solo avisan en su página", () => {
  const r = { id: 99, date: "", title: "", summary: "", paths: ["/dashboard/pedidos"] };
  assert.equal(releaseTouches(r, "/dashboard/pedidos"), true);
  assert.equal(releaseTouches(r, "/dashboard/pedidos/internos"), true);
  assert.equal(releaseTouches(r, "/dashboard/pedidosx"), false);
  assert.equal(releaseTouches(r, "/dashboard/products"), false);
  assert.equal(releaseTouches({ ...r, paths: [] }, "/dashboard/pedidos"), false);
  assert.equal(releaseTouches({ ...r, paths: [], important: true }, "/dashboard/caja"), true);
  // Fuera del panel (catálogo, landings, producto) nunca hay aviso, ni siquiera de una novedad importante.
  assert.equal(releaseTouches({ ...r, paths: [], important: true }, "/"), false);
  assert.equal(releaseTouches({ ...r, paths: ["/dashboard"], important: true }, "/producto/abc"), false);
  assert.equal(releaseTouches({ ...r, paths: ["/"], important: true }, "/catalogo"), false);
});

test("novedades: las que avisan traen qué cambió", () => {
  for (const r of RELEASES) {
    assert.ok(r.title && r.summary, `«${r.id}» sin título o resumen`);
    if (r.paths.length) assert.ok(r.demo?.length, `«${r.title}» avisa pero no trae simulador`);
  }
});
