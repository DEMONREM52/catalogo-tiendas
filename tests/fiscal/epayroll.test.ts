import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_EPAYROLL, buildPayrollBody, epayrollProblems, epayrollTotals, prefillFromInternal, profileFromEmployee } from "../../src/lib/fiscal/epayroll";

const profile = { ...profileFromEmployee({ full_name: "Ana María Pérez Gómez", document_type: "CC", bank_name: "BANCOLOMBIA", bank_account: "123" }), city_code: "05001", address: "CALLE 1" };

test("separa nombres y apellidos de la ficha interna", () => {
  assert.deepEqual([profile.first_name, profile.other_names, profile.last_name, profile.second_last_name, profile.doc_type, profile.payment_method], ["ANA", "MARÍA", "PÉREZ", "GÓMEZ", "13", "47"]);
  const two = profileFromEmployee({ full_name: "Luis Díaz" });
  assert.deepEqual([two.first_name, two.last_name, two.second_last_name], ["LUIS", "DÍAZ", ""]);
});

test("trae de la nómina interna y avisa lo que hay que revisar", () => {
  const { data, review } = prefillFromInternal([
    { code: "SALARIO", name: "Salario", kind: "earning", value: 0, amount: 2000000 },
    { code: "AUX_TRANSPORTE", name: "Auxilio", kind: "earning", value: 0, amount: 200000 },
    { code: "HORAS_EXTRA", name: "Horas extra y recargos", kind: "earning", value: 0, amount: 50000 },
    { code: "SALUD", name: "Salud", kind: "deduction", value: 4, amount: 80000 },
    { code: "PENSION", name: "Pensión", kind: "deduction", value: 4, amount: 80000 },
    { code: "VALE", name: "Vale #1", kind: "deduction", value: 40000, amount: 40000 },
    { code: "SALUD_EMP", name: "Salud empleador", kind: "employer", value: 8.5, amount: 170000 },
  ], 30, ["2026-10-15", "2026-10-30"]);
  assert.equal(data.salary, 2000000);
  assert.equal(data.transport, 200000);
  assert.equal(data.debt, 40000);
  assert.equal(data.others[0].amount, 50000);
  assert.ok(review.some((r) => /Horas extra/.test(r)));
  assert.deepEqual(epayrollTotals(data), { devengados: 2250000, deducciones: 200000, total: 2050000 });
});

test("arma el documento DIAN con totales que cuadran", () => {
  const data = { ...EMPTY_EPAYROLL, days: 30, salary: 2000000, transport: 200000, health: 80000, pension: 80000, bonus_ns: 100000,
    overtime: [{ type: "HED" as const, hours: 4, amount: 41667 }], payment_dates: ["2026-10-30"] };
  const body = buildPayrollBody({
    prefix: "NE", number: 5, companyId: "comp-1", period: "2026-10-01",
    employer: { legal_name: "LA VITRINA SAS", person_type: "juridica", document_number: "900373913", verification_digit: "4" },
    settings: { city_code: "05001", address: "CALLE 10", payment_method: "47" },
    employee: { document: "1.017.555", base_salary: 2000000, pay_frequency: "monthly", hired_on: "2026-10-10", terminated_on: null },
    profile, data,
  });
  const g = body.governmentData;
  assert.equal(body.number, 5);
  assert.deepEqual(g.Periodo, { FechaIngreso: "2026-10-10", FechaLiquidacionInicio: "2026-10-10", FechaLiquidacionFin: "2026-10-31", TiempoLaborado: 22 });
  assert.equal(g.Empleador.NIT, 900373913);
  assert.equal(g.Empleador.DV, 4);
  assert.equal(g.Trabajador.NumeroDocumento, 1017555);
  assert.equal(g.InformacionGeneral.PeriodoNomina, "5");
  assert.deepEqual((g.Devengados as Record<string, unknown>).HEDs, { HED: [{ Cantidad: 4, Porcentaje: "1", Pago: 41667 }] });
  assert.equal(g.DevengadosTotal, 2341667);
  assert.equal(g.DeduccionesTotal, 160000);
  assert.equal(g.ComprobanteTotal, 2181667);
  assert.equal(g.Pago.Banco, "BANCOLOMBIA");
});

test("avisa lo que falta antes de enviar", () => {
  const p = epayrollProblems({ ...EMPTY_EPAYROLL, salary: 0, payment_dates: [] }, { ...profile, city_code: "" });
  assert.ok(p.some((x) => /sueldo/.test(x)) && p.some((x) => /DANE/.test(x)) && p.some((x) => /fecha de pago/.test(x)));
  assert.deepEqual(epayrollProblems({ ...EMPTY_EPAYROLL, salary: 1, payment_dates: ["2026-10-30"] }, profile), []);
});
