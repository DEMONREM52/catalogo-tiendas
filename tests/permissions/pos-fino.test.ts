import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTS_MARK, PERMISSIONS_V2_MARK, POS_FINE_MARK } from "@/lib/store-user-auth";
import { POS_FINE_CHILDREN, PERMISSION_LIST, cleanPermissions, expandLegacyPermissions, togglePermission } from "@/lib/permissions";

test("POS fino: sin la marca, «pos» trae crédito, apartados, cotizaciones y ver todas las ventas", () => {
  const out = expandLegacyPermissions(["pos", PERMISSIONS_V2_MARK]);
  for (const p of POS_FINE_CHILDREN) assert.ok(out.includes(p), p);
});

test("POS fino: con la marca, lo quitado se queda quitado", () => {
  const out = expandLegacyPermissions(["pos", PERMISSIONS_V2_MARK, POS_FINE_MARK, "pos_credit"]);
  assert.ok(out.includes("pos_credit"));
  assert.ok(!out.includes("pos_all_sales"));
});

test("POS fino: sin «pos» no se hereda nada", () => {
  assert.ok(!expandLegacyPermissions(["orders", PERMISSIONS_V2_MARK]).includes("pos_quotes"));
});

test("POS fino: los cuatro salen en la pantalla, piden «pos» y la marca no se guarda", () => {
  for (const p of POS_FINE_CHILDREN) assert.ok(PERMISSION_LIST.some((x) => x.value === p), p);
  assert.ok(!togglePermission(["pos", "pos_credit"], "pos").includes("pos_credit"));
  assert.deepEqual(cleanPermissions(["pos", POS_FINE_MARK, PERMISSIONS_V2_MARK]), ["pos"]);
});

test("Conteos físicos: sin su marca, «inventory» los trae; con la marca, lo quitado se queda quitado", () => {
  assert.ok(expandLegacyPermissions(["inventory", PERMISSIONS_V2_MARK, POS_FINE_MARK]).includes("inventory_counts"));
  assert.ok(!expandLegacyPermissions(["inventory", PERMISSIONS_V2_MARK, POS_FINE_MARK, COUNTS_MARK]).includes("inventory_counts"));
  assert.ok(!expandLegacyPermissions(["pos", PERMISSIONS_V2_MARK]).includes("inventory_counts"));
  assert.ok(!togglePermission(["inventory", "inventory_counts"], "inventory").includes("inventory_counts"));
  assert.deepEqual(cleanPermissions(["inventory", COUNTS_MARK]), ["inventory"]);
});
