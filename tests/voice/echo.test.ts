import test from "node:test";
import assert from "node:assert/strict";
import { isEchoOf, stripEcho } from "@/lib/voice/speech";

// Lo que pasó en la tienda: REM se oía por el parlante y se respondía a sí mismo.
test("REM oyéndose por el parlante", () => {
  assert.ok(isEchoOf("a Bodega principal", "Pedido a bodega principal. Dime los productos y cuántos."));
  assert.ok(isEchoOf("dime los productos", "Pedido a bodega principal. Dime los productos y cuántos."));
  assert.ok(isEchoOf("hola soy rem", "Hola, soy REM. ¿Qué hacemos?"));
  assert.ok(isEchoOf("cinco de cámara", "5 de cámara de seguridad. ¿Siguiente?"), "la voz dice «cinco» por «5»");
});

test("lo que sí dijo la persona (aunque se mezcle con REM)", () => {
  assert.ok(!isEchoOf("Hola soy Andrea qué hacemos quiero pedir mercancía", "Hola, soy REM. ¿Qué hacemos?"));
  assert.equal(stripEcho("Hola soy Andrea qué hacemos quiero pedir mercancía", "Hola, soy REM. ¿Qué hacemos?"), "Andrea qué hacemos quiero pedir mercancía");
  assert.ok(!isEchoOf("sí esa", "¿Estás intentando decir cámara de seguridad triple solar vts30?"));
  assert.ok(!isEchoOf("tres de la zapatera", "Pedido a bodega principal. Dime los productos y cuántos."));
  assert.ok(!isEchoOf("cualquier cosa", ""));
});
