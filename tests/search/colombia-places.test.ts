import test from "node:test";
import assert from "node:assert/strict";
import { CO_DEPTS, MUNICIPIOS } from "@/lib/colombia/municipios";
import { deptCode, placeKey, searchCities, searchDepts, uniqueCity } from "@/lib/colombia/place-search";

test("lista oficial completa: 1.122 municipios y 33 departamentos", () => {
  assert.equal(MUNICIPIOS.length, 1122);
  assert.equal(Object.keys(CO_DEPTS).length, 33);
  assert.ok(MUNICIPIOS.every((m) => /^\d{5}$/.test(m.code) && m.name && m.dept));
  assert.deepEqual(MUNICIPIOS.find((m) => m.code === "50001"), { code: "50001", name: "VILLAVICENCIO", dept: "META" });
});

test("ciudad: sin tildes y por el comienzo", () => {
  assert.equal(searchCities(MUNICIPIOS, "villav")[0].name, "VILLAVICENCIO");
  assert.equal(searchCities(MUNICIPIOS, "medellin")[0].code, "05001");
  assert.equal(searchCities(MUNICIPIOS, "bogota")[0].code, "11001");
  assert.deepEqual(searchCities(MUNICIPIOS, ""), []);
});

test("ciudad: con departamento escrito, primero los de ese departamento", () => {
  const meta = searchCities(MUNICIPIOS, "", "Meta", CO_DEPTS);
  assert.ok(meta.length > 20 && meta.every((m) => m.dept === "META"));
  // «San Andrés» existe en varios departamentos: con Santander sale el de Santander.
  assert.equal(searchCities(MUNICIPIOS, "san andres", "SANTANDER", CO_DEPTS)[0].code, "68669");
  // Si en ese departamento no hay ninguno, busca en todo el país.
  assert.equal(searchCities(MUNICIPIOS, "villavicencio", "ANTIOQUIA", CO_DEPTS)[0].name, "VILLAVICENCIO");
});

test("departamento: todos al abrir, y con nombres cortos", () => {
  assert.equal(searchDepts(CO_DEPTS, "").length, 33);
  assert.equal(searchDepts(CO_DEPTS, "met")[0], "META");
  assert.equal(searchDepts(CO_DEPTS, "valle")[0], "VALLE DEL CAUCA");
  assert.equal(deptCode(CO_DEPTS, "bogota"), "11");
  assert.equal(deptCode(CO_DEPTS, "Bogotá, D.C."), "11");
  assert.equal(deptCode(CO_DEPTS, "atlantico"), "08");
  assert.equal(deptCode(CO_DEPTS, "Narnia"), null);
});

test("llenar el departamento solo cuando la ciudad es única", () => {
  assert.equal(uniqueCity(MUNICIPIOS, "villavicencio")?.dept, "META");
  assert.equal(uniqueCity(MUNICIPIOS, "Restrepo"), null); // hay Restrepo en Meta y en Valle
  assert.equal(placeKey("  Bogotá,  D.C. "), "BOGOTA DC");
});
