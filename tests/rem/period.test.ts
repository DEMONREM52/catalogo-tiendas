import test from "node:test";
import assert from "node:assert/strict";
import { parsePeriod } from "@/lib/rem/period";

// Viernes 13/11/2026 a las 10 p. m. en Colombia = sábado 14 a las 3 a. m. UTC: tiene que seguir siendo el 13.
const NIGHT = new Date("2026-11-14T03:00:00Z");
const NOW = new Date("2026-11-13T15:00:00Z");

test("hoy, ayer, antier con la fecha de Colombia (no la UTC)", () => {
  assert.equal(parsePeriod("cuanto vendimos hoy", NIGHT)?.day, "2026-11-13");
  assert.equal(parsePeriod("ventas de ayer", NIGHT)?.day, "2026-11-12");
  assert.equal(parsePeriod("y antier", NIGHT)?.day, "2026-11-11");
  assert.equal(parsePeriod("anteayer", NOW)?.label, "antier");
  assert.equal(parsePeriod("ayer", NOW)?.label, "ayer");
});

test("días de la semana, «hace N días», fechas dichas y con barra", () => {
  assert.equal(parsePeriod("el lunes", NOW)?.day, "2026-11-09");
  assert.equal(parsePeriod("el viernes", NOW)?.day, "2026-11-13", "hoy es viernes");
  assert.equal(parsePeriod("el viernes pasado", NOW)?.day, "2026-11-06");
  assert.equal(parsePeriod("hace tres dias", NOW)?.day, "2026-11-10");
  assert.equal(parsePeriod("hace 10 dias", NOW)?.day, "2026-11-03");
  assert.equal(parsePeriod("el 5 de noviembre", NOW)?.day, "2026-11-05");
  assert.equal(parsePeriod("el 5 de noviembre", NOW)?.label, "el jueves 5 de noviembre");
  assert.equal(parsePeriod("el 20 de diciembre", NOW)?.day, "2025-12-20", "sin año: el que ya pasó");
  assert.equal(parsePeriod("el primero de octubre de 2026", NOW)?.day, "2026-10-01");
  assert.equal(parsePeriod("ventas del 3/11", NOW)?.day, "2026-11-03", "DD/MM");
});

test("fechas que no existen o no dichas", () => {
  assert.equal(parsePeriod("el 31 de noviembre", NOW), null);
  assert.equal(parsePeriod("cuanto vendimos", NOW), null);
  assert.equal(parsePeriod("las ventas", NOW), null);
});
