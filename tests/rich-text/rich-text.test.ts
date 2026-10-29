import { test } from "node:test";
import assert from "node:assert/strict";
import { hasFormat, parseInline, parseRich, richToEditorHtml, richToPlain } from "@/lib/rich-text";

test("lo que ya estaba escrito: ### título y **negrita**", () => {
  const blocks = parseRich("### 📏 DIMENSIONES\n\nLA PATINETA TIENE UNA **ALTURA DE 135 CM** Y MÁS.");
  assert.equal(blocks[0].t, "h3");
  assert.equal(blocks[1].t, "blank");
  assert.deepEqual(blocks[2], { t: "p", align: "left", c: [{ t: "text", v: "LA PATINETA TIENE UNA " }, { t: "b", c: [{ t: "text", v: "ALTURA DE 135 CM" }] }, { t: "text", v: " Y MÁS." }] });
});

test("formatos dentro de la línea, anidados", () => {
  const c = parseInline("**hola *mundo*** ++sub++ ~~no~~ ==ojo== {#e11d48|rojo} {grande|big} [web](https://remhub.co)");
  assert.deepEqual(c.map((x) => x.t), ["b", "text", "u", "text", "s", "text", "mark", "text", "color", "text", "size", "text", "link"]);
  const b = c[0] as { c: Array<{ t: string }> };
  assert.deepEqual(b.c.map((x) => x.t), ["text", "i"]);
});

test("lo que no es formato se deja como texto", () => {
  assert.deepEqual(parseInline("5 * 3 = 15 y 2 ** 3"), [{ t: "text", v: "5 * 3 = 15 y 2 ** 3" }]);
  assert.deepEqual(parseInline("{#zzz|x}"), [{ t: "text", v: "{#zzz|x}" }]);
  // Solo enlaces http(s): nada de javascript:
  assert.equal(parseInline("[x](javascript:alert(1))")[0].t, "text");
});

test("listas, citas, línea y alineación", () => {
  const b = parseRich("::c # Centrado\n- uno\n- dos\n1. primero\n> cita\n---");
  assert.deepEqual(b.map((x) => x.t), ["h1", "li", "li", "ol", "quote", "hr"]);
  assert.equal((b[0] as { align: string }).align, "center");
});

test("texto plano para Google y redes", () => {
  assert.equal(richToPlain("### Título\n- **uno**\n{#e11d48|rojo}"), "Título\n• uno\nrojo");
  assert.equal(richToPlain("sin formato"), "sin formato");
  assert.equal(hasFormat("sin formato"), false);
  assert.equal(hasFormat("con **negrita**"), true);
});

test("el HTML del editor va escapado", () => {
  const html = richToEditorHtml("<img src=x onerror=alert(1)> **ok**");
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("<b>ok</b>"));
  assert.equal(richToEditorHtml("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
});
