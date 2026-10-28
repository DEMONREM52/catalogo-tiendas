// Plan de descuentos de los vales en la nómina (sin dependencias: se prueba aparte).
// Sigue la misma regla de la base (erp__payroll_compute, 20261240): en cada nómina se descuenta la cuota de
// cada vale activo y sin pausar cuyo «empieza a descontar» cae hasta el fin del periodo, sin pasar el saldo.
//  · Nómina aprobada (o pagada): ya descontado, ya está en el saldo.
//  · Nómina en borrador: lo que dice su línea (con la cuota cambiada o saltada). Si el vale no aparece en la
//    línea, al aprobarla NO se descuenta (la línea se calculó antes de crear el vale).
//  · Periodos sin nómina todavía: se proyecta la cuota hasta terminar de pagar.

export type Period = "weekly" | "biweekly" | "monthly";

export type PlanLoan = {
  id: string; number: number; employee_id: string; employee: string; pay_frequency: Period; description: string;
  installment: number; balance: number; start_on: string; status: "active" | "paid" | "void"; paused: boolean;
};
export type PlanRun = {
  id: string; number: number; status: string; period_start: string; period_end: string;
  lines: Array<{ employee_id: string; items: Array<{ calc: string; loan_id?: string; amount: number }> }>;
};
export type StepSource = "done" | "draft" | "missing" | "projected" | "paused";
export type PlanStep = {
  loan_id: string; employee_id: string; period_start: string; period_end: string; amount: number;
  /** Saldo antes y después (null en lo ya descontado: el saldo de entonces no se guarda). */
  before: number | null; after: number | null; source: StepSource; run_number: number | null;
};

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const parts = (iso: string) => iso.slice(0, 10).split("-").map(Number) as [number, number, number];
export const addDays = (iso: string, n: number) => { const [y, m, d] = parts(iso); return day(y, m - 1, d + n); };
const maxIso = (...xs: string[]) => xs.filter(Boolean).sort().at(-1) ?? "";

/** Periodo de nómina que contiene una fecha (igual que en la base: semana lunes-domingo, quincena 1-15 y 16-fin de mes). */
export function periodOf(kind: Period, iso: string): [string, string] {
  const [y, m, d] = parts(iso);
  if (kind === "weekly") {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return [day(y, m - 1, d - dow), day(y, m - 1, d - dow + 6)];
  }
  if (kind === "biweekly") return d <= 15 ? [day(y, m - 1, 1), day(y, m - 1, 15)] : [day(y, m - 1, 16), day(y, m, 0)];
  return [day(y, m - 1, 1), day(y, m, 0)];
}

const LIVE = new Set(["approved", "partial", "paid", "draft"]);

/** Todos los pasos de cada vale: lo descontado en nóminas, lo que trae cada borrador y lo que falta (proyectado). */
export function loanPlan(loans: PlanLoan[], runs: PlanRun[], today: string, maxPeriods = 60): PlanStep[] {
  const live = runs.filter((r) => LIVE.has(r.status)).sort((a, b) => a.period_end.localeCompare(b.period_end) || a.number - b.number);
  const steps: PlanStep[] = [];
  for (const l of loans) {
    if (l.status === "void") continue;
    const mine = live.filter((r) => r.lines.some((x) => x.employee_id === l.employee_id));
    const itemOf = (r: PlanRun) => r.lines.find((x) => x.employee_id === l.employee_id)?.items.find((i) => i.calc === "loan" && i.loan_id === l.id);
    const step = (r: { period_start: string; period_end: string }, amount: number, before: number | null, source: StepSource, run: number | null) =>
      steps.push({ loan_id: l.id, employee_id: l.employee_id, period_start: r.period_start, period_end: r.period_end, amount, before, after: before === null ? null : before - amount, source, run_number: run });

    for (const r of mine) {
      if (r.status === "draft") continue;
      const it = itemOf(r);
      if (it && Number(it.amount) > 0) step(r, Number(it.amount), null, "done", r.number);
    }
    if (l.status !== "active") continue;

    let left = Number(l.balance) || 0;
    for (const r of mine) {
      if (r.status !== "draft" || left <= 0) continue;
      const it = itemOf(r);
      if (it) {
        const amount = Math.min(Number(it.amount) || 0, left);
        step(r, amount, left, "draft", r.number);
        left -= amount;
      } else if (!l.paused && l.start_on <= r.period_end) {
        step(r, 0, left, "missing", r.number);
      }
    }

    // Después de la última nómina del empleado (y nunca antes del periodo de hoy ni de «empieza a descontar»).
    const lastEnd = mine.at(-1)?.period_end;
    let p = periodOf(l.pay_frequency, maxIso(l.start_on, lastEnd ? addDays(lastEnd, 1) : "", periodOf(l.pay_frequency, today)[0]));
    const installment = Number(l.installment) || 0;
    for (let i = 0; left > 0 && installment > 0 && i < maxPeriods; i++) {
      if (l.paused) { step({ period_start: p[0], period_end: p[1] }, 0, left, "paused", null); break; }
      const amount = Math.min(installment, left);
      step({ period_start: p[0], period_end: p[1] }, amount, left, "projected", null);
      left -= amount;
      p = periodOf(l.pay_frequency, addDays(p[1], 1));
    }
  }
  return steps.sort((a, b) => a.period_end.localeCompare(b.period_end) || a.employee_id.localeCompare(b.employee_id));
}

/** Pasos de la nómina que incluye esa fecha (el periodo de cada empleado según cada cuánto le pagan). */
export const stepsOn = (steps: PlanStep[], iso: string) => steps.filter((s) => s.period_start <= iso && iso <= s.period_end);

/** Lo que falta descontar agrupado por fecha de pago (fin del periodo), de la más cercana a la más lejana. */
export function upcoming(steps: PlanStep[]) {
  const map = new Map<string, PlanStep[]>();
  for (const s of steps) {
    if (s.source === "done") continue;
    map.set(s.period_end, [...(map.get(s.period_end) ?? []), s]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, steps: list, total: list.reduce((t, s) => t + s.amount, 0) }));
}

/** Fecha aproximada en que termina de pagar cada vale (fin del último periodo con descuento). */
export function finishDates(steps: PlanStep[]) {
  const out = new Map<string, string>();
  for (const s of steps) if (s.amount > 0 && s.source !== "done" && (s.after ?? 1) <= 0) out.set(s.loan_id, s.period_end);
  return out;
}
