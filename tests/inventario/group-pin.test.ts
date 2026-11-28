import test from "node:test";
import assert from "node:assert/strict";
import { cleanPin, isValidPin } from "../../src/app/dashboard/inventario/group-pin";

test("contraseña del conteo en grupo: de 4 a 8 números", () => {
  for (const ok of ["2020", "0482", "12345678", " 2020 "]) assert.equal(isValidPin(ok), true, ok);
  for (const bad of ["123", "123456789", "12a4", "dddd", "", null, undefined, "20 20"]) assert.equal(isValidPin(bad), false, String(bad));
  assert.equal(cleanPin(" 0482 "), "0482");
});
