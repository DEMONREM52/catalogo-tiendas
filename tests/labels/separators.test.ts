import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEPARATORS, arrangeWithSeparators, normalizeSeparators, separatorLabelDesign, separatorLabelText, type SeparatorSettings } from "../../src/lib/labels/separators";
import { labelSvg } from "../../src/lib/labels/render";
import { approxMeasure } from "../../src/lib/labels/text-fit";
import { paginate, STARPOS_IF4 } from "../../src/lib/labels/layout";

const S = (p: Partial<SeparatorSettings> = {}) => ({ ...DEFAULT_SEPARATORS, ...p });
const arr = (groups: string[][], s: SeparatorSettings, start = 0) =>
  arrangeWithSeparators(groups, s, 3, start, (slot) => (slot.kind === "fin" ? "fin" : slot.kind === "fila" ? "fila" : "una"));

test("como el dibujo: termina a mitad de fila → completa la fila marcada + una fila entera, y el siguiente empieza en fila nueva", () => {
  // 7 relojes: fila 3 queda con 1; luego 2 «fin», fila entera, y la máquina arranca en fila nueva.
  const out = arr([Array(7).fill("K41"), ["WB", "WB", "WB"]], S());
  assert.deepEqual(paginate(out, STARPOS_IF4), [
    ["K41", "K41", "K41"], ["K41", "K41", "K41"], ["K41", "fin", "fin"], ["fila", "fila", "fila"], ["WB", "WB", "WB"],
  ]);
});

test("si termina justo al final de la fila, igual va la fila entera", () => {
  const out = arr([Array(6).fill("K7"), ["K41"]], S());
  assert.deepEqual(paginate(out, STARPOS_IF4), [["K7", "K7", "K7"], ["K7", "K7", "K7"], ["fila", "fila", "fila"], ["K41", null, null]]);
});

test("filas enteras configurables (1 a 3) y respeta la posición de inicio", () => {
  const out = arr([["A"], ["B"]], S({ rows: 2 }), 1);
  // Empieza en la posición 2: A, fin → luego 2 filas enteras → B en fila nueva.
  assert.deepEqual(paginate(out, STARPOS_IF4, 1), [[null, "A", "fin"], ["fila", "fila", "fila"], ["fila", "fila", "fila"], ["B", null, null]]);
});

test("modo «fila»: solo completa; si ya estaba completa, una fila entera", () => {
  assert.deepEqual(arr([["A"], ["B"]], S({ mode: "fila" })), ["A", "fin", "fin", "B"]);
  assert.deepEqual(arr([["A", "A", "A"], ["B"]], S({ mode: "fila" })), ["A", "A", "A", "fila", "fila", "fila", "B"]);
});

test("modo «una» (como antes) y apagado", () => {
  assert.deepEqual(arr([["A", "A"], ["B"]], S({ mode: "una" })), ["A", "A", "una", "B"]);
  assert.deepEqual(arr([["A", "A"], ["B"]], S({ on: false })), ["A", "A", "B"]);
  assert.deepEqual(arr([["A"], [], ["B"]], S({ mode: "una" })), ["A", "una", "B"]);
});

test("nunca pasa del máximo", () => {
  assert.equal(arrangeWithSeparators([Array(10).fill(1), Array(10).fill(2)], S(), 3, 0, () => 0, 12).length, 12);
});

test("lo guardado se limpia", () => {
  assert.deepEqual(normalizeSeparators({ mode: "x", rows: 9, thickness: 0.2, mark: "equis", text: "nombres", on: false }),
    { on: false, mode: "fila+", rows: 3, mark: "equis", thickness: 1, text: "nombres" });
  assert.deepEqual(normalizeSeparators(null), DEFAULT_SEPARATORS);
});

test("cada marca se dibuja sin errores y con el grosor elegido", () => {
  for (const mark of ["franja", "doble", "cortada", "recuadro", "equis", "llena"] as const) {
    const out = labelSvg({ design: separatorLabelDesign(31, 25, S({ mark, thickness: 5, text: "nombres" }), "SIGUE · MAQUINA PATILLERA WB 999"), data: {}, dpi: 203, measure: approxMeasure });
    assert.equal(out.issues.filter((i) => i.level === "error").length, 0, mark);
  }
  const franja = labelSvg({ design: separatorLabelDesign(31, 25, S({ thickness: 5 })), data: {}, dpi: 203, measure: approxMeasure });
  assert.match(franja.svg, /width="31" height="5"/);
});

test("texto: FIN en lo que completa la fila, SIGUE en la fila entera", () => {
  const names = ["RELOJ K41", "MAQUINA WB 999"];
  assert.equal(separatorLabelText(S({ text: "nombres" }), { kind: "fin", after: 0, before: 1 }, names), "FIN · RELOJ K41");
  assert.equal(separatorLabelText(S({ text: "nombres" }), { kind: "fila", after: 0, before: 1 }, names), "SIGUE · MAQUINA WB 999");
  assert.equal(separatorLabelText(S(), { kind: "fila", after: 0, before: 1 }, names), undefined);
});
