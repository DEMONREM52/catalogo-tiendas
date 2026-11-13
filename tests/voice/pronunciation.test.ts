import test from "node:test";
import assert from "node:assert/strict";
import { applyPronunciations, PRONUNCIATIONS } from "@/lib/voice/pronunciation";
import { spokenText } from "@/lib/voice/speech";

const rem = PRONUNCIATIONS.find((p) => p.id === "rem")!;

test("«REM» se dice /rem/ en español (solo en la voz)", () => {
  assert.equal(spokenText("Hola, soy REM. ¿En qué te ayudo?"), "Hola, soy rem. ¿En qué te ayudo?");
  assert.equal(spokenText("Rem, abre los gastos"), "rem, abre los gastos");
  assert.equal(spokenText("oye rem"), "oye rem");
  assert.equal(spokenText("Toca REM arriba. REM sigue."), "Toca rem arriba. rem sigue.");
});

test("no toca otras palabras con esas letras", () => {
  assert.equal(spokenText("remisión REMERA reembolso remá remó Rémora prem rems"), "remisión REMERA reembolso remá remó Rémora prem rems");
  assert.equal(spokenText("3 de la cámara HM 03"), "3 de la cámara HM 03");
});

test("se puede probar cada forma sin guardarla", () => {
  for (const o of rem.options) assert.equal(applyPronunciations("Hola, soy REM.", () => o), `Hola, soy ${o}.`);
  assert.equal(rem.options[0], "rem");
  assert.ok(rem.options.every((o) => !/[áéíóú]/i.test(o)), "ninguna con tilde: la voz del iPhone la deletrea");
});
