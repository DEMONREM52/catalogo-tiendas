import test from "node:test";
import assert from "node:assert/strict";
import { codeVariants, decide, fuzzyQueries, phonetic, rankFuzzy, resolveSpoken, singular, spokenParts } from "@/lib/voice/fuzzy";
import { isQuickAnswer, isYes, parseCorrection, parseTransferCommand as p } from "@/lib/voice/spanish";

type P = { id: string; name: string; sku: string | null; barcode: string | null };
const VTS: P = { id: "vts", name: "CÁMARA DE SEGURIDAD TRIPLE SOLAR VTS30 W F", sku: "VTS30 W F", barcode: null };
const OMNI: P = { id: "omni", name: "CAMARA OMNI 3 CAMARAS CON REFLECTOR", sku: "OM-3", barcode: null };
const BOMBILLO: P = { id: "bombillo", name: "CAMARA PHILIPS TIPO BOMBILLO", sku: "PH-200", barcode: null };
const SECADOR: P = { id: "secador", name: "CEPILLO SECADOR GIRATORIO AGUACATE", sku: "RSV-2580", barcode: "7701234567030" };
const ALL = [VTS, OMNI, BOMBILLO, SECADOR];

/**
 * Como el buscador del panel: todas las palabras dentro del nombre/código, o el código completo; además
 * a veces devuelve algo «parecido» que no es (como pasó con «cámaras vts 30» → OMNI 3 CÁMARAS).
 */
async function search(q: string, limit = 6) {
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const hay = (h: P) => norm(`${h.name} ${h.sku} ${(h.sku ?? "").replace(/\s/g, "")}`);
  const hits = ALL.filter((h) => toks.every((t) => hay(h).includes(t)));
  if (!hits.length && toks.includes("camaras")) hits.push(OMNI);
  return hits.slice(0, limit);
}

test("muletillas y la palabra «referencia»", () => {
  assert.deepEqual(p("Necesito cinco cámaras de la bts 30"), { kind: "add", qty: 5, query: "camaras de la bts 30", to: null });
  assert.deepEqual(p("Quiero cinco cámaras referencias vtf 30"), { kind: "add", qty: 5, query: "camaras vtf 30", to: null });
  assert.deepEqual(p("agrega por favor cinco cámaras de la referencia vts 30"), { kind: "add", qty: 5, query: "camaras vts 30", to: null });
  assert.deepEqual(p("necesito que me mandes tres secadores"), { kind: "add", qty: 3, query: "secadores", to: null });
  // «de la referencia…» es un producto, no de dónde sale un traslado.
  assert.deepEqual(p("de la referencia vts 30"), { kind: "add", qty: null, query: "vts 30", to: null });
});

test("correcciones de lo último", () => {
  assert.deepEqual(parseCorrection("de la referencia vts 30"), { query: "vts 30", qty: null });
  assert.deepEqual(parseCorrection("no, es la vts 30"), { query: "vts 30", qty: null });
  assert.deepEqual(parseCorrection("esa no, la zapatera negra"), { query: "zapatera negra", qty: null });
  assert.deepEqual(parseCorrection("me refiero a tres de la AB-1240"), { query: "ab-1240", qty: 3 });
  for (const s of ["listo", "sí", "no", "tres de la zapatera", "cancelar"]) assert.equal(parseCorrection(s), null, s);
});

test("cómo suena y singular", () => {
  assert.equal(phonetic("bts30"), phonetic("vts30"));
  assert.equal(phonetic("zapatera"), phonetic("sapatera"));
  assert.equal(phonetic("llavero"), phonetic("yabero"));
  assert.equal(singular("camaras"), "camara");
  assert.equal(singular("secadores"), "secador");
  assert.equal(singular("luces"), "luz");
});

test("lo dicho en partes y qué más buscar", () => {
  assert.deepEqual(spokenParts("camaras de la bts 30"), { words: ["camara"], codes: ["bts30"] });
  assert.deepEqual(spokenParts("camaras referencias vtf 30"), { words: ["camara"], codes: ["vtf30"] });
  assert.deepEqual(spokenParts("camaras triple vts treinta"), { words: ["camara", "triple"], codes: ["vts30"] });
  assert.deepEqual(spokenParts("be te ese treinta"), { words: [], codes: ["bts30"] });
  assert.ok(codeVariants("vtf30").includes("vts30"), JSON.stringify(codeVariants("vtf30")));
  const qs = fuzzyQueries("camaras vtf 30");
  assert.ok(qs.includes("camara 30"), JSON.stringify(qs));
});

test("ordena por parecido: nunca se queda con lo primero que devuelva el buscador", () => {
  const ranked = rankFuzzy("camaras vts 30", [OMNI, BOMBILLO, VTS]);
  assert.equal(ranked[0].hit.id, "vts");
  assert.ok(ranked[0].score > 0.95);
  // El código de barras no cuenta por un pedazo («…030»).
  assert.equal(rankFuzzy("30", [SECADOR]).length, 0);
});

test("decide: seguro, preguntar, opciones o nada", () => {
  const r = (score: number, id: string) => ({ hit: { id }, score });
  assert.equal(decide([r(1, "a"), r(0.33, "b")], true, true).kind, "sure");
  assert.equal(decide([r(0.92, "a"), r(0.33, "b")], false, true).kind, "ask", "la referencia no está tal cual: pregunta");
  assert.equal(decide([r(0.7, "a"), r(0.4, "b")], false, false).kind, "ask");
  assert.equal(decide([r(1, "a"), r(1, "b")], false, false).kind, "choose");
  assert.equal(decide([r(0.2, "a")], false, false).kind, "none");
});

test("tus frases reales", async () => {
  // Antes: agregó «cámara omni 3 cámaras con reflector».
  const a = await resolveSpoken(search, ["camaras vts 30"]);
  assert.equal(a.kind, "sure");
  assert.equal(a.kind === "sure" && a.hit.id, "vts");
  // Antes: «No encontré». El reconocedor escribió «vtf» por «VTS»: pregunta por la cámara VTS30.
  const b = await resolveSpoken(search, ["camaras vtf 30"]);
  assert.equal(b.kind, "ask");
  assert.equal(b.kind === "ask" && b.ranked[0].hit.id, "vts");
  // «bts» suena igual que «VTS»: seguro.
  const c = await resolveSpoken(search, ["camaras de la bts 30"]);
  assert.equal(c.kind === "sure" && c.hit.id, "vts");
  // Solo «cámara»: hay varias, lee opciones.
  assert.equal((await resolveSpoken(search, ["camara"])).kind, "choose");
  assert.equal((await resolveSpoken(search, ["licuadora"])).kind, "none");
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
