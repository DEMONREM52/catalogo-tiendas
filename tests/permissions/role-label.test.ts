import test from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_PRESETS, roleLabelFor } from "@/lib/permissions";
import { STORE_MENU_PERMISSIONS } from "@/lib/store-user-auth";

test("con todos los permisos es Administrador", () => {
  assert.equal(roleLabelFor([...STORE_MENU_PERMISSIONS, "perm_v2"]).label, "Administrador");
});

test("si coincide con una plantilla, usa su nombre", () => {
  const seller = PERMISSION_PRESETS.find((p) => p.key === "seller")!;
  assert.deepEqual(roleLabelFor([...seller.permissions].reverse()), { icon: seller.icon, label: "Vendedor" });
});

test("un rol guardado de la tienda gana", () => {
  const r = roleLabelFor(["pos", "cash"], [{ name: "Jefe de caja", icon: "💼", permissions: ["cash", "pos"] }]);
  assert.deepEqual(r, { icon: "💼", label: "Jefe de caja" });
});

test("si no coincide con ninguno, es personalizado", () => {
  assert.equal(roleLabelFor(["pos", "audit"]).label, "Rol personalizado");
});
