import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_TEMPLATES, renderTemplate, unknownVariables, SAMPLE_VARS } from "@/lib/products/publish-templates";

test("reemplaza variables y quita las líneas vacías", () => {
  const out = renderTemplate("🔥 {nombre}\n\n{descripcion}\n\n💲 {precio}\n📲 {enlace}", { nombre: "Carro", precio: "$10.000", descripcion: "" });
  assert.equal(out, "🔥 Carro\n\n💲 $10.000");
});

test("acepta tildes y mayúsculas en la variable, y deja otras llaves", () => {
  assert.equal(renderTemplate("{nombre} · {categoría} · {otra}", { nombre: "A", categoria: "Hogar" }), "A · Hogar · {otra}");
  assert.equal(renderTemplate("🔥 *{NOMBRE}* 🔥\n💰🔥 *PRECIO: {precio}* 🔥💰", { nombre: "Patineta eléctrica con silla ZYQ 4", precio: "$38.000" }),
    "🔥 *PATINETA ELÉCTRICA CON SILLA ZYQ 4* 🔥\n💰🔥 *PRECIO: $38.000* 🔥💰");
});

test("avisa variables que no existen", () => {
  assert.deepEqual(unknownVariables("{nombre} {precioo} {Tienda}"), ["precioo"]);
});

test("las plantillas de RemHub funcionan con todos los datos", () => {
  for (const t of BUILTIN_TEMPLATES) {
    const out = renderTemplate(t.body, SAMPLE_VARS);
    assert.ok(out.toLowerCase().includes(SAMPLE_VARS.nombre.toLowerCase()), t.name);
    assert.ok(!/\{[a-z]+\}/.test(out), t.name);
  }
});
