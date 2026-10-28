// Plan de descuentos de vales en la nómina: periodos, nóminas aprobadas, borradores y proyección.
import { test } from "node:test";
import assert from "node:assert/strict";
import { finishDates, loanPlan, periodOf, stepsOn, upcoming, type PlanLoan, type PlanRun } from "../../src/app/dashboard/gastos/loanPlan";

const loan = (over: Partial<PlanLoan> = {}): PlanLoan => ({
  id: "v1", number: 1, employee_id: "sara", employee: "Sara", pay_frequency: "biweekly", description: "9 × Audífonos",
  installment: 270000, balance: 270000, start_on: "2026-10-30", status: "active", paused: false, ...over,
});
const run = (number: number, status: string, start: string, end: string, items: Array<{ loan_id: string; amount: number }> = [], employee = "sara"): PlanRun => ({
  id: `r${number}`, number, status, period_start: start, period_end: end,
  lines: [{ employee_id: employee, items: items.map((i) => ({ calc: "loan", ...i })) }],
});

test("periodos como en la base: quincena 1-15 y 16-fin de mes, mes completo y semana de lunes a domingo", () => {
  assert.deepEqual(periodOf("biweekly", "2026-10-28"), ["2026-10-16", "2026-10-31"]);
  assert.deepEqual(periodOf("biweekly", "2026-02-15"), ["2026-02-01", "2026-02-15"]);
  assert.deepEqual(periodOf("biweekly", "2028-02-20"), ["2028-02-16", "2028-02-29"], "año bisiesto");
  assert.deepEqual(periodOf("monthly", "2026-12-31"), ["2026-12-01", "2026-12-31"]);
  assert.deepEqual(periodOf("weekly", "2026-10-28"), ["2026-10-26", "2026-11-01"], "miércoles → lunes a domingo");
});

test("el vale de la captura: una cuota de $270.000 en la quincena del 16 al 31 de octubre", () => {
  const steps = loanPlan([loan()], [], "2026-10-28");
  assert.equal(steps.length, 1);
  assert.deepEqual([steps[0].period_end, steps[0].amount, steps[0].after, steps[0].source], ["2026-10-31", 270000, 0, "projected"]);
  assert.equal(stepsOn(steps, "2026-10-31").length, 1);
  assert.equal(stepsOn(steps, "2026-11-15").length, 0, "en la quincena siguiente ya no debe nada");
  assert.equal(finishDates(steps).get("v1"), "2026-10-31");
});

test("préstamo en cuotas: la última es por lo que queda y la proyección sigue quincena a quincena", () => {
  const steps = loanPlan([loan({ installment: 400000, balance: 1000000, start_on: "2026-11-01" })], [], "2026-10-28");
  assert.deepEqual(steps.map((s) => [s.period_end, s.amount, s.after]), [["2026-11-15", 400000, 600000], ["2026-11-30", 400000, 200000], ["2026-12-15", 200000, 0]]);
  assert.deepEqual(upcoming(steps).map((g) => [g.date, g.total]), [["2026-11-15", 400000], ["2026-11-30", 400000], ["2026-12-15", 200000]]);
});

test("nómina aprobada: queda como descontada y lo que falta empieza en la quincena siguiente", () => {
  // Cobró 400.000 en la nómina #7 (saldo ya rebajado a 600.000).
  const steps = loanPlan([loan({ installment: 400000, balance: 600000, start_on: "2026-10-01" })], [run(7, "approved", "2026-10-16", "2026-10-31", [{ loan_id: "v1", amount: 400000 }])], "2026-10-28");
  assert.deepEqual(steps.map((s) => [s.period_end, s.source, s.amount, s.run_number]), [
    ["2026-10-31", "done", 400000, 7], ["2026-11-15", "projected", 400000, null], ["2026-11-30", "projected", 200000, null],
  ]);
  assert.equal(stepsOn(steps, "2026-10-31")[0].source, "done", "en esa fecha sale como ya descontado");
});

test("borrador con la cuota saltada (0): esa quincena no descuenta y el saldo se corre", () => {
  const steps = loanPlan([loan({ installment: 100000, balance: 200000, start_on: "2026-10-01" })], [run(8, "draft", "2026-10-16", "2026-10-31", [{ loan_id: "v1", amount: 0 }])], "2026-10-28");
  assert.deepEqual(steps.map((s) => [s.period_end, s.source, s.amount]), [["2026-10-31", "draft", 0], ["2026-11-15", "projected", 100000], ["2026-11-30", "projected", 100000]]);
});

test("vale creado después del borrador: avisa que esa nómina no lo va a descontar", () => {
  const steps = loanPlan([loan()], [run(9, "draft", "2026-10-16", "2026-10-31", [])], "2026-10-28");
  assert.equal(steps[0].source, "missing");
  assert.equal(steps[0].run_number, 9);
  assert.deepEqual([steps[1].period_end, steps[1].amount], ["2026-11-15", 270000], "lo cobra la quincena siguiente");
});

test("pausado: no se proyecta nada; las nóminas de otros empleados no cuentan", () => {
  const steps = loanPlan([loan({ paused: true })], [run(10, "approved", "2026-10-16", "2026-10-31", [], "otro")], "2026-10-28");
  assert.deepEqual(steps.map((s) => [s.source, s.amount, s.period_end]), [["paused", 0, "2026-10-31"]]);
});

test("pagados y anulados no se proyectan; nóminas anuladas no cuentan", () => {
  const paid = loan({ id: "v2", status: "paid", balance: 0 });
  const steps = loanPlan([paid, loan({ id: "v3", status: "void" })], [run(11, "approved", "2026-10-16", "2026-10-31", [{ loan_id: "v2", amount: 270000 }]), run(12, "void", "2026-11-01", "2026-11-15", [{ loan_id: "v2", amount: 5 }])], "2026-10-28");
  assert.deepEqual(steps.map((s) => [s.loan_id, s.source, s.amount]), [["v2", "done", 270000]]);
});

test("empieza a descontar en el futuro: la primera cuota es la de esa quincena", () => {
  const steps = loanPlan([loan({ start_on: "2026-12-05", pay_frequency: "monthly" })], [], "2026-10-28");
  assert.deepEqual([steps[0].period_start, steps[0].period_end], ["2026-12-01", "2026-12-31"]);
});
