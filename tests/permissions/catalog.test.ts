import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS_V2_MARK, STORE_MENU_PERMISSIONS } from "@/lib/store-user-auth";
import {
  LEGACY_CHILDREN, PERMISSION_GROUPS, PERMISSION_LIST, PERMISSION_PRESETS, PERMISSION_REQUIRES,
  cleanPermissions, expandLegacyPermissions, riskScore, togglePermission,
} from "@/lib/permissions";

test("cada permiso que acepta el servidor está en la pantalla, una sola vez", () => {
  const shown = PERMISSION_LIST.map((p) => p.value);
  assert.equal(new Set(shown).size, shown.length, "repetidos");
  for (const p of STORE_MENU_PERMISSIONS) assert.ok(shown.includes(p), `falta ${p}`);
  assert.equal(shown.length, STORE_MENU_PERMISSIONS.length);
  assert.ok(PERMISSION_GROUPS.length >= 12);
});

test("plantillas y dependencias solo usan permisos que existen y respetan lo que necesitan", () => {
  const known = new Set<string>(STORE_MENU_PERMISSIONS);
  for (const preset of PERMISSION_PRESETS) {
    for (const p of preset.permissions) assert.ok(known.has(p), `${preset.key}: ${p}`);
    for (const p of preset.permissions) for (const need of PERMISSION_REQUIRES[p] ?? []) assert.ok(preset.permissions.includes(need), `${preset.key}: ${p} necesita ${need}`);
  }
  for (const [child, parents] of Object.entries(PERMISSION_REQUIRES)) {
    assert.ok(known.has(child));
    for (const p of parents!) assert.ok(known.has(p));
  }
});

test("lo guardado antes del desglose hereda los permisos nuevos; lo nuevo no", () => {
  const old = expandLegacyPermissions(["products", "users", "pos"]);
  for (const k of [...LEGACY_CHILDREN.products!, ...LEGACY_CHILDREN.users!, "messages"]) assert.ok(old.includes(k), k);
  assert.ok(!expandLegacyPermissions(["pos"]).includes("products_delete"));
  const v2 = expandLegacyPermissions(["products", PERMISSIONS_V2_MARK]);
  assert.ok(!v2.includes("products_delete") && !v2.includes("messages"));
  assert.deepEqual(expandLegacyPermissions(null), ["messages"]);
  assert.deepEqual(cleanPermissions(["pos", PERMISSIONS_V2_MARK, "pos"]), ["pos"]);
});

test("marcar un permiso hijo marca su base y quitar la base quita los hijos", () => {
  const on = togglePermission([], "products_delete");
  assert.ok(on.includes("products") && on.includes("products_delete"));
  const off = togglePermission(["products", "products_delete", "products_view", "catalogs", "pos"], "products");
  // «Catálogos» ya no depende de editar productos (20261316): se queda, con «Ver productos».
  assert.deepEqual(off.sort(), ["catalogs", "pos", "products_view"]);
  const cat = togglePermission([], "catalogs");
  assert.ok(cat.includes("products_view") && !cat.includes("products"), "Catálogos solo pide ver productos");
  assert.equal(riskScore([]), 0);
  assert.equal(riskScore(PERMISSION_LIST.map((p) => p.value)), 100);
});
