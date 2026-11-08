import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, scoreItem } from "@/lib/fuzzy-search";
import { SEARCH_INDEX } from "@/lib/search-index";

const top = (q: string) => {
  const pq = parseQuery(q);
  return SEARCH_INDEX.map((e) => ({ e, s: scoreItem(e, pq) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.e.label);
};

test("lleva directo a la pestaña", () => {
  assert.equal(top("vales")[0], "Vales y préstamos");
  assert.equal(top("kardex")[0], "Kardex");
  assert.equal(top("cartera")[0], "Cartera");
  assert.equal(top("usuarios")[0], "Usuarios y permisos");
});

test("con «nuevo», «crear» o «agregar» da la acción", () => {
  assert.equal(top("nuevo vale")[0], "Nuevo vale a empleado");
  assert.equal(top("crear factura")[0], "Ingresar factura de compra");
  assert.equal(top("agregar producto")[0], "Nuevo producto");
  assert.ok(top("empleado nuevo").slice(0, 2).includes("Nuevo empleado"));
});

test("tolera errores de escritura, tildes y plurales", () => {
  assert.ok(top("liquidasion").slice(0, 2).some((l) => /liquidaci/i.test(l)));
  assert.equal(top("provedor")[0], "Proveedores");
  assert.equal(top("nomina")[0].startsWith("Nómina"), true);
  assert.ok(top("devoluciones").slice(0, 2).some((l) => /devoluci/i.test(l)));
});

test("sinónimos y nombres propios", () => {
  assert.equal(top("reporte ventas")[0], "Informe de ventas");
  assert.ok(top("precios zamora").slice(0, 3).includes("Precios por punto"));
  assert.ok(top("cuadrar deuda").includes("Cuenta con puntos"));
});

test("lo que no tiene nada que ver no aparece", () => {
  assert.equal(top("xyzqw").length, 0);
});
