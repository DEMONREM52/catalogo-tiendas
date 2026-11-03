import { test } from "node:test";
import assert from "node:assert/strict";
import { allowRequest } from "@/lib/server/rate-limit";

test("deja pasar hasta el límite, frena el siguiente y se libera al vencer la ventana", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(allowRequest("t:1.2.3.4", 3, 60_000, t0 + i).ok, true);
  const blocked = allowRequest("t:1.2.3.4", 3, 60_000, t0 + 10);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 59);
  assert.equal(allowRequest("t:5.6.7.8", 3, 60_000, t0 + 10).ok, true, "otra IP no se afecta");
  assert.equal(allowRequest("t:1.2.3.4", 3, 60_000, t0 + 60_001).ok, true, "pasada la ventana vuelve a dejar");
});
