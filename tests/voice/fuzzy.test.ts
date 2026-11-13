import test from "node:test";
import assert from "node:assert/strict";
import { codeVariants, fuzzyQueries, guessMode, guessSpoken, phonetic, rankFuzzy, singular, spokenParts } from "@/lib/voice/fuzzy";
import { isQuickAnswer, isYes, parseTransferCommand as p } from "@/lib/voice/spanish";

const CAMARA = { id: "1", name: "CÁMARA DE SEGURIDAD TRIPLE SOLAR VTS30 W F", sku: "VTS30 W F", barcode: null };
const BOMBILLO = { id: "2", name: "CAMARA PHILIPS TIPO BOMBILLO", sku: "PH-200", barcode: null };
const SECADOR = { id: "3", name: "CEPILLO SECADOR GIRATORIO AGUACATE", sku: "RSV-2580", barcode: null };

test("muletillas: «necesito cinco cámaras de la bts 30»", () => {
  assert.deepEqual(p("Necesito cinco cámaras de la bts 30"), { kind: "add", qty: 5, query: "camaras de la bts 30", to: null });
  assert.deepEqual(p("Necesito cinco cámaras triple de la referencia vts 30"), { kind: "add", qty: 5, query: "camaras triple vts 30", to: null });
  assert.deepEqual(p("necesito que me mandes tres secadores"), { kind: "add", qty: 3, query: "secadores", to: null });
  assert.deepEqual(p("dame dos de la AB-1240"), { kind: "add", qty: 2, query: "ab-1240", to: null });
});

test("cómo suena y singular", () => {
  assert.equal(phonetic("bts30"), phonetic("vts30"));
  assert.equal(phonetic("zapatera"), phonetic("sapatera"));
  assert.equal(phonetic("llavero"), phonetic("yabero"));
  assert.equal(singular("camaras"), "camara");
  assert.equal(singular("secadores"), "secador");
  assert.equal(singular("luces"), "luz");
});

test("lo dicho en partes y sus variantes", () => {
  assert.deepEqual(spokenParts("camaras de la bts 30"), { words: ["camara"], codes: ["bts30"] });
  assert.deepEqual(spokenParts("camaras triple vts treinta"), { words: ["camara", "triple"], codes: ["vts30"] });
  assert.deepEqual(spokenParts("be te ese treinta"), { words: [], codes: ["bts30"] });
  assert.ok(codeVariants("bts30").includes("vts30"));
  const qs = fuzzyQueries("camaras de la bts 30");
  assert.ok(qs.includes("VTS30"), JSON.stringify(qs));
  assert.ok(qs.includes("camara"), JSON.stringify(qs));
});

test("ordena por parecido aunque el reconocimiento se equivoque", () => {
  const ranked = rankFuzzy("camaras de la bts 30", [BOMBILLO, SECADOR, CAMARA]);
  assert.equal(ranked[0].hit.id, "1");
  assert.ok(ranked[0].score >= 0.9, String(ranked[0].score));
  assert.equal(guessMode(ranked), "ask");
  assert.equal(rankFuzzy("cepillo secador", [CAMARA, SECADOR])[0].hit.id, "3");
  assert.equal(rankFuzzy("licuadora", [CAMARA, BOMBILLO, SECADOR]).length, 0);
  // Dos cámaras igual de parecidas: lee opciones.
  assert.equal(guessMode(rankFuzzy("camara", [CAMARA, BOMBILLO])), "choose");
});

test("busca con las variantes (como el buscador del panel: por palabra o código completo)", async () => {
  const all = [CAMARA, BOMBILLO, SECADOR];
  const search = async (q: string) => all.filter((h) => `${h.name} ${h.sku}`.toLowerCase().includes(q.toLowerCase()));
  const g = await guessSpoken(search, "camaras de la bts 30");
  assert.equal(g[0]?.hit.id, "1");
});

test("sí dicho de muchas formas", () => {
  for (const s of ["sí", "sí esa", "esa esa", "esa", "ese mismo", "claro que sí", "sí señor", "ajá", "correcto", "de una", "sí, esa es"]) assert.ok(isYes(s), s);
  for (const s of ["no", "esa no", "no es esa", "eso es todo", "listo", "la dos", "esa zapatera"]) assert.ok(!isYes(s), s);
  assert.equal(p("no esa no").kind, "no");
  assert.equal(p("eso es todo").kind, "done");
});

test("respuestas cortas que interrumpen a REM", () => {
  for (const s of ["sí", "sí esa", "no", "la dos", "tres", "ninguno", "cancelar"]) assert.ok(isQuickAnswer(s), s);
  for (const s of ["estás intentando decir cámara de seguridad triple solar", "encontré tres uno zapatera negra dos zapatera café"]) assert.ok(!isQuickAnswer(s), s);
});
