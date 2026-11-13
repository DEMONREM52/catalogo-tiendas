import test from "node:test";
import assert from "node:assert/strict";
import { navRequest, navTarget, phraseKey } from "@/lib/voice/navigate";
import { missToLearn, relatedSpoken } from "@/lib/voice/fuzzy";
import { wakeRest } from "@/lib/voice/speech";

const LINKS = [
  { href: "/dashboard/gastos?tab=expenses", label: "Gastos", hint: "Gastos y nómina", keywords: "egresos pagos por pagar" },
  { href: "/dashboard/gastos?tab=payroll", label: "Nómina", hint: "Gastos y nómina", keywords: "empleados sueldos quincena pagos" },
  { href: "/dashboard/caja", label: "Abrir o cerrar caja", keywords: "arqueo cierre efectivo turno", action: true },
  { href: "/dashboard/rentabilidad?tab=points", label: "Rentabilidad por punto", hint: "Rentabilidad", keywords: "puntos sedes mes a mes" },
  { href: "/dashboard/clientes", label: "Clientes", keywords: "terceros compradores" },
];

test("REM abre cualquier página: «abre los gastos», «llévame a la nómina»", () => {
  assert.equal(navRequest("Abre los gastos"), "los gastos");
  assert.equal(navRequest("Rem, llévame a la nómina por favor"), "la nomina por favor");
  assert.equal(navRequest("abre la página de clientes"), "clientes");
  assert.equal(navRequest("tres de la zapatera"), null);
  assert.equal(navTarget("abre los gastos", LINKS)?.link.label, "Gastos");
  assert.equal(navTarget("llévame a la nómina", LINKS)?.link.label, "Nómina");
  assert.equal(navTarget("muéstrame la rentabilidad por punto", LINKS)?.link.label, "Rentabilidad por punto");
  assert.equal(navTarget("ve a clientes", LINKS)?.link.label, "Clientes");
});

test("sin verbo solo si se parece mucho; nada inventado", () => {
  assert.equal(navTarget("nómina", LINKS)?.link.label, "Nómina");
  assert.equal(navTarget("abre la licuadora", LINKS), null);
  assert.equal(navTarget("tres de la zapatera", LINKS), null);
  assert.equal(navTarget("", LINKS), null);
});

test("llave de frase aprendida: sin «Rem», sin relleno", () => {
  assert.equal(phraseKey("Rem, por favor, la plata de los muchachos"), "la plata de los muchachos");
  assert.equal(phraseKey("Oye REM bueno la plata de los muchachos ya"), "la plata de los muchachos");
});

test("aprende de lo que no encontró si enseguida lo dicen de otra forma parecida", () => {
  assert.ok(relatedSpoken("termólico ahora hm 03", "termo licuadora hm 03"));
  assert.ok(relatedSpoken("la bete ese 30", "cámara vts 30"), "mismo número");
  assert.ok(!relatedSpoken("zapatera negra", "cable usb"));
  assert.equal(missToLearn({ query: "termólico", turn: 4 }, "termo licuadora", 5), "termólico");
  assert.equal(missToLearn({ query: "termólico", turn: 1 }, "termo licuadora", 6), undefined, "muy viejo");
  assert.equal(missToLearn({ query: "zapatera negra", turn: 4 }, "cable usb", 5), undefined, "otra cosa");
  assert.equal(missToLearn(null, "termo licuadora", 5), undefined);
});

test("«Rem» en medio de la frase también lo llama", () => {
  assert.equal(wakeRest("bueno rem abre los gastos"), "abre los gastos");
  assert.equal(wakeRest("listo rem"), "");
  assert.equal(wakeRest("el reembolso de la remisión"), null);
  assert.equal(wakeRest("tráeme la remera"), null);
  assert.equal(wakeRest("la memoria ram del computador"), null);
});
