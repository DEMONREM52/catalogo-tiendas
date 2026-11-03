import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_LIST, PERMISSION_PRESETS, PERMISSION_REQUIRES, togglePermission } from "@/lib/permissions";

const sorted = (v: string[]) => [...v].sort();

test("marcar un permiso que no sirve solo marca también el que necesita", () => {
  assert.deepEqual(sorted(togglePermission([], "purchases_void")), ["purchases", "purchases_void"]);
  assert.deepEqual(sorted(togglePermission(["pos"], "fiscal_notes")), ["fiscal", "fiscal_notes", "pos"]);
});

test("quitar el base quita lo que dependía de él; quitar el hijo deja el base", () => {
  assert.deepEqual(sorted(togglePermission(["fiscal", "fiscal_notes", "fiscal_audit", "pos"], "fiscal")), ["pos"]);
  assert.deepEqual(sorted(togglePermission(["purchases", "purchases_void"], "purchases_void")), ["purchases"]);
});

test("las dependencias apuntan a permisos que existen y las plantillas las cumplen", () => {
  const all = new Set(PERMISSION_LIST.map((p) => p.value));
  for (const [child, parents] of Object.entries(PERMISSION_REQUIRES)) {
    assert.ok(all.has(child as never), `no existe ${child}`);
    for (const p of parents ?? []) assert.ok(all.has(p), `no existe ${p}`);
  }
  for (const preset of PERMISSION_PRESETS) {
    for (const p of preset.permissions) {
      for (const need of PERMISSION_REQUIRES[p] ?? []) assert.ok(preset.permissions.includes(need), `«${preset.label}» tiene ${p} sin ${need}`);
    }
  }
});
