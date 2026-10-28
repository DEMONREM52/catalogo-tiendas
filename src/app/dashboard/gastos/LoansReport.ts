import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadXlsx, xDate, type XCell, type XSheet } from "@/lib/data/xlsx";
import { logExport } from "@/lib/permission-runtime";
import { openPrint, storeName } from "./PayrollReport";
import { finishDates, loanPlan, stepsOn, upcoming, type Period, type PlanRun, type PlanStep, type StepSource } from "./loanPlan";

/**
 * Informe completo de vales y préstamos a empleados (20261240):
 *  · Cuánto se descuenta en la nómina que se paga en una fecha (por empleado y por vale).
 *  · Las próximas nóminas hasta terminar de pagar, por empleado, todos los vales y sus movimientos.
 * Usa las nóminas que ya existen (aprobadas = ya descontado; borrador = su cuota) y proyecta el resto.
 */

export type LoanPayment = { id: string; amount: number; source: "payroll" | "manual"; method: string | null; note: string | null; paid_at: string; by: string | null; voided: boolean; void_reason: string | null; run_number: number | null };
export type Loan = {
  id: string; number: number; employee_id: string; employee: string; document: string | null; position: string | null; pay_frequency: Period; base_salary: number;
  point_id: string | null; point: string | null; kind: "product" | "cash"; description: string; items: Array<{ product_id: string; name: string; sku: string | null; qty: number; price: number }>;
  principal: number; interest_mode: "none" | "total" | "monthly"; interest_pct: number; interest: number; total: number; installments: number; installment: number;
  start_on: string; balance: number; status: "active" | "paid" | "void"; paused: boolean; from_cash: boolean; notes: string | null; created_by_name: string | null;
  created_at: string; void_reason: string | null; paid_count: number; payments: LoanPayment[];
};

export type LoansReportData = { loans: Loan[]; steps: PlanStep[]; today: string; runsNote: string | null };

export const SOURCE: Record<StepSource, { label: string; color: string }> = {
  done: { label: "Ya descontado", color: "#16a34a" },
  draft: { label: "En nómina sin aprobar", color: "#2563eb" },
  missing: { label: "No está en la nómina", color: "#dc2626" },
  projected: { label: "Por descontar", color: "#8b5cf6" },
  paused: { label: "Pausado", color: "#94a3b8" },
};
const PERIOD: Record<Period, string> = { weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };
const METHOD: Record<string, string> = { cash: "efectivo", transfer: "transferencia", nequi: "Nequi / Daviplata", card: "tarjeta", other: "otro medio" };
const n = (v: unknown) => Number(v ?? 0);
const cop = (v: unknown) => `$${Math.round(n(v)).toLocaleString("es-CO")}`;
const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fd = (d: string | null | undefined) => xDate(d);

type RunRow = { id: string; number: number; status: string; period_start: string; period_end: string };
type DetailLine = { employee_id: string; items: Array<{ calc: string; loan_id?: string; amount: number }> };

export async function loadLoansReport(storeId: string, today: string): Promise<LoansReportData> {
  const sb = supabaseBrowser();
  const res = await sb.rpc("erp_employee_loans_list", { p_store: storeId });
  if (res.error) throw new Error(/Could not find the function|schema cache/i.test(res.error.message) ? "Falta ejecutar en Supabase la migración 20261240_vales_empleados.sql." : res.error.message);
  const r = res.data as { ok: boolean; error?: string; loans?: Loan[] };
  if (!r.ok) throw new Error(r.error ?? "No se pudo cargar.");
  const loans = r.loans ?? [];

  // Solo las nóminas que pueden tocar los vales: desde el primer «empieza a descontar».
  const from = loans.filter((l) => l.status !== "void").map((l) => l.start_on).sort()[0];
  let runs: PlanRun[] = [];
  let runsNote: string | null = null;
  if (from) {
    const list = await sb.rpc("erp_payroll_runs_list", { p_store: storeId });
    if (list.error) runsNote = "No se pudieron leer las nóminas: todo sale como proyectado.";
    else {
      const rows = ((list.data ?? []) as RunRow[]).filter((x) => x.status !== "void" && x.period_end >= from);
      const details = await Promise.all(rows.map((x) => sb.rpc("erp_payroll_detail", { p_run: x.id })));
      runs = details.flatMap((d, i) => (d.error ? [] : [{ ...rows[i], lines: ((d.data as { lines?: DetailLine[] } | null)?.lines ?? []) }]));
      if (details.some((d) => d.error)) runsNote = "Algunas nóminas (de puntos que no manejas) no se pudieron leer.";
    }
  }
  return { loans, steps: loanPlan(loans, runs, today), today, runsNote };
}

// ------------------------------------------------------------------ vistas
export type DayGroup = { employee_id: string; name: string; document: string | null; frequency: Period; period: [string, string]; rows: Array<{ loan: Loan; step: PlanStep }>; total: number; done: number };

/** La nómina que incluye esa fecha: por empleado, qué se descuenta de cada vale. */
export function payrollOn(d: LoansReportData, iso: string): DayGroup[] {
  const byId = new Map(d.loans.map((l) => [l.id, l]));
  const groups = new Map<string, DayGroup>();
  for (const step of stepsOn(d.steps, iso)) {
    const loan = byId.get(step.loan_id);
    if (!loan) continue;
    const g = groups.get(step.employee_id) ?? { employee_id: step.employee_id, name: loan.employee, document: loan.document, frequency: loan.pay_frequency, period: [step.period_start, step.period_end] as [string, string], rows: [], total: 0, done: 0 };
    g.rows.push({ loan, step });
    if (step.source === "done") g.done += step.amount; else g.total += step.amount;
    groups.set(step.employee_id, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Person = { employee_id: string; name: string; document: string | null; frequency: Period; active: number; given: number; paid: number; balance: number; perPayroll: number; finish: string | null; paused: number };

export function people(d: LoansReportData): Person[] {
  const finish = finishDates(d.steps);
  const map = new Map<string, Person>();
  for (const l of d.loans) {
    if (l.status === "void") continue;
    const p = map.get(l.employee_id) ?? { employee_id: l.employee_id, name: l.employee, document: l.document, frequency: l.pay_frequency, active: 0, given: 0, paid: 0, balance: 0, perPayroll: 0, finish: null, paused: 0 };
    p.given += n(l.total);
    p.paid += n(l.total) - n(l.balance);
    p.balance += n(l.balance);
    if (l.status === "active") {
      p.active++;
      if (l.paused) p.paused++;
      else p.perPayroll += Math.min(n(l.installment), n(l.balance));
      const f = finish.get(l.id);
      if (f && (!p.finish || f > p.finish)) p.finish = f;
    }
    map.set(l.employee_id, p);
  }
  return [...map.values()].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

export type Move = { at: string; employee: string; loan: number; description: string; kind: string; amount: number; sign: 1 | -1; voided: string | null; by: string | null };

/** Vales entregados, descuentos de nómina y abonos entre dos fechas (incluidas). */
export function moves(d: LoansReportData, from: string, to: string): Move[] {
  const inRange = (iso: string) => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
  const out: Move[] = [];
  for (const l of d.loans) {
    if (inRange(l.created_at)) out.push({ at: l.created_at, employee: l.employee, loan: l.number, description: l.description, sign: 1,
      kind: `${l.kind === "product" ? "Vale de mercancía" : "Préstamo"}${n(l.interest) ? ` (incluye interés ${cop(l.interest)})` : ""}`, amount: n(l.total), voided: l.status === "void" ? l.void_reason ?? "anulado" : null, by: l.created_by_name });
    for (const p of l.payments) {
      if (!inRange(p.paid_at)) continue;
      out.push({ at: p.paid_at, employee: l.employee, loan: l.number, description: l.description, sign: -1, amount: n(p.amount), voided: p.voided ? p.void_reason ?? "anulado" : null, by: p.by,
        kind: p.source === "payroll" ? `Descuento nómina #${p.run_number ?? ""}` : `Abono en ${METHOD[p.method ?? ""] ?? p.method ?? "efectivo"}${p.note ? ` · ${p.note}` : ""}` });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function totals(d: LoansReportData) {
  const live = d.loans.filter((l) => l.status !== "void");
  const active = live.filter((l) => l.status === "active");
  return {
    active: active.length, employees: new Set(active.map((l) => l.employee_id)).size,
    given: live.reduce((s, l) => s + n(l.total), 0), paid: live.reduce((s, l) => s + n(l.total) - n(l.balance), 0),
    balance: active.reduce((s, l) => s + n(l.balance), 0),
    missing: d.steps.filter((s) => s.source === "missing").length,
  };
}

// ------------------------------------------------------------------ Excel e impresión
const stepState = (s: PlanStep) => `${SOURCE[s.source].label}${s.run_number ? ` (nómina #${s.run_number})` : ""}`;

export function loansExcel(d: LoansReportData, day: string, from: string, to: string) {
  const t = totals(d);
  const groups = payrollOn(d, day);
  const next = upcoming(d.steps);
  const ppl = people(d);
  const mv = moves(d, from, to);
  const byId = new Map(d.loans.map((l) => [l.id, l]));
  const finish = finishDates(d.steps);
  const sheets: XSheet[] = [
    { name: "Resumen", head: ["Dato", "Valor"], rows: [
      ["Informe del", fd(d.today)], ["Vales activos", t.active], ["Empleados con saldo", t.employees], ["Total entregado (sin anulados)", t.given], ["Ya pagado", t.paid], ["Saldo por cobrar", t.balance],
      [`Nómina que se paga el ${fd(day)}: por descontar`, groups.reduce((s, g) => s + g.total, 0)], [`Nómina del ${fd(day)}: ya descontado`, groups.reduce((s, g) => s + g.done, 0)],
      ["Próxima fecha de pago con descuentos", next[0] ? fd(next[0].date) : "—"], ["Total de esa fecha", next[0]?.total ?? 0],
      ["Vales que una nómina en borrador no va a descontar", t.missing],
    ] as XCell[][] },
    { name: `Nómina ${day.split("-").reverse().join("-")}`, head: ["Empleado", "Documento", "Periodo", "Vale", "Descripción", "Cuota", "Saldo antes", "Descuenta", "Saldo después", "Estado"],
      rows: groups.flatMap((g) => g.rows.map(({ loan, step }) => [g.name, g.document ?? "", `${fd(g.period[0])} a ${fd(g.period[1])}`, `#${loan.number}`, loan.description, n(loan.installment),
        step.before ?? "", step.amount, step.after ?? "", stepState(step)])) },
    { name: "Próximas nóminas", head: ["Fecha de pago", "Periodo", "Empleado", "Vale", "Descripción", "Descuenta", "Saldo después", "Estado"],
      rows: next.flatMap((g) => g.steps.map((s) => { const l = byId.get(s.loan_id); return [fd(g.date), `${fd(s.period_start)} a ${fd(s.period_end)}`, l?.employee ?? "", `#${l?.number ?? ""}`, l?.description ?? "", s.amount, s.after ?? "", stepState(s)]; })) },
    { name: "Por empleado", head: ["Empleado", "Documento", "Le pagan", "Vales activos", "Entregado", "Pagado", "Saldo", "Descuento por nómina", "Termina aprox.", "Pausados"],
      rows: ppl.map((p) => [p.name, p.document ?? "", PERIOD[p.frequency], p.active, p.given, p.paid, p.balance, p.perPayroll, p.finish ? fd(p.finish) : "", p.paused]) },
    { name: "Vales", head: ["Vale", "Fecha", "Empleado", "Documento", "Tipo", "Descripción", "Punto", "Valor", "Interés", "Total", "Pagado", "Saldo", "Cuotas", "Cuota", "Desde", "Termina aprox.", "Estado", "Entregó", "Notas"],
      rows: d.loans.map((l) => [`#${l.number}`, xDate(l.created_at, true), l.employee, l.document ?? "", l.kind === "product" ? "Mercancía" : "Dinero", l.description, l.point ?? "", n(l.principal), n(l.interest), n(l.total),
        l.status === "void" ? 0 : n(l.total) - n(l.balance), n(l.balance), l.installments, n(l.installment), fd(l.start_on), finish.get(l.id) ? fd(finish.get(l.id)) : "",
        l.status === "void" ? `Anulado: ${l.void_reason ?? ""}` : l.status === "paid" ? "Pagado" : l.paused ? "Pausado" : "Activo", l.created_by_name ?? "", l.notes ?? ""]) },
    { name: "Movimientos", head: ["Fecha", "Empleado", "Vale", "Movimiento", "Debe (+)", "Paga (−)", "Registró", "Anulado"],
      rows: mv.map((m) => [xDate(m.at, true), m.employee, `#${m.loan}`, m.kind, m.sign > 0 ? m.amount : "", m.sign < 0 ? m.amount : "", m.by ?? "", m.voided ?? ""]) },
  ];
  logExport("vales_informe", d.loans.length, { fecha: day, desde: from, hasta: to });
  downloadXlsx(`vales-${d.today}`, sheets);
}

export async function printLoansReport(storeId: string, d: LoansReportData, day: string, from: string, to: string) {
  const store = await storeName(storeId);
  const t = totals(d);
  const groups = payrollOn(d, day);
  const next = upcoming(d.steps).slice(0, 12);
  const ppl = people(d);
  const mv = moves(d, from, to);
  const byId = new Map(d.loans.map((l) => [l.id, l]));
  const due = groups.reduce((s, g) => s + g.total, 0);
  const badge = (s: PlanStep) => `<span style="color:${SOURCE[s.source].color};font-weight:700">${esc(stepState(s))}</span>`;
  logExport("vales_informe_impreso", d.loans.length, { fecha: day });
  const body = `
    <h1>Informe de vales y préstamos a empleados</h1>
    <p>${store ? `${esc(store)} · ` : ""}impreso ${xDate(new Date().toISOString(), true)}</p>
    <div class="grid">
      <div class="box">Vales activos<b>${t.active}</b></div><div class="box">Empleados con saldo<b>${t.employees}</b></div>
      <div class="box">Saldo por cobrar<b>${cop(t.balance)}</b></div><div class="box">Nómina del ${fd(day)}<b>${cop(due)}</b></div>
    </div>
    <h2>1. Nómina que ${groups.length && groups.every((g) => g.period[1] === day) ? "se paga el" : "incluye el"} ${fd(day)}</h2>
    ${groups.length ? `<table><tr><th>Empleado</th><th>Vale</th><th class="r">Saldo antes</th><th class="r">Descuenta</th><th class="r">Queda</th><th>Estado</th></tr>
      ${groups.map((g) => g.rows.map(({ loan, step }, i) => `<tr><td>${i ? "" : `<b>${esc(g.name)}</b><br/><span class="muted">${esc(PERIOD[g.frequency])} ${fd(g.period[0])} – ${fd(g.period[1])}</span>`}</td>
        <td>#${loan.number} · ${esc(loan.description)}</td><td class="r">${step.before === null ? "—" : cop(step.before)}</td><td class="r"><b>${cop(step.amount)}</b></td><td class="r">${step.after === null ? "—" : cop(step.after)}</td><td>${badge(step)}</td></tr>`).join("")
        + (g.rows.length > 1 ? `<tr><td></td><td class="muted">Total de ${esc(g.name.split(/\s+/)[0])}</td><td></td><td class="r"><b>${cop(g.total + g.done)}</b></td><td></td><td></td></tr>` : "")).join("")}
      <tr class="tot"><td colspan="3">Total a descontar en esa nómina</td><td class="r">${cop(due)}</td><td colspan="2">${groups.some((g) => g.done) ? `+ ${cop(groups.reduce((s, g) => s + g.done, 0))} ya descontado` : ""}</td></tr></table>`
      : `<p class="muted">Ningún vale se descuenta en la nómina de esa fecha.</p>`}
    <p class="muted">Cada empleado según cada cuánto le pagan. Si lo devengado en esa nómina no alcanza, la nómina descuenta solo hasta lo devengado y el resto queda para la siguiente.</p>
    <h2>2. Próximas nóminas</h2>
    ${next.length ? `<table><tr><th>Fecha de pago</th><th>Empleado · vale</th><th class="r">Descuenta</th><th class="r">Queda</th></tr>
      ${next.map((g) => g.steps.map((s, i) => { const l = byId.get(s.loan_id); return `<tr><td>${i ? "" : `<b>${fd(g.date)}</b><br/><span class="muted">total ${cop(g.total)}</span>`}</td><td>${esc(l?.employee)} · #${l?.number ?? ""} ${s.source === "projected" ? "" : badge(s)}</td><td class="r">${cop(s.amount)}</td><td class="r">${s.after === null ? "—" : cop(s.after)}</td></tr>`; }).join("")).join("")}</table>`
      : `<p class="muted">No hay descuentos pendientes.</p>`}
    <h2>3. Por empleado</h2>
    <table><tr><th>Empleado</th><th class="r">Vales activos</th><th class="r">Entregado</th><th class="r">Pagado</th><th class="r">Saldo</th><th class="r">Por nómina</th><th>Termina aprox.</th></tr>
      ${ppl.map((p) => `<tr><td>${esc(p.name)}${p.document ? `<br/><span class="muted">${esc(p.document)}</span>` : ""}</td><td class="r">${p.active}${p.paused ? ` (${p.paused} pausado${p.paused === 1 ? "" : "s"})` : ""}</td><td class="r">${cop(p.given)}</td><td class="r">${cop(p.paid)}</td><td class="r"><b>${cop(p.balance)}</b></td><td class="r">${cop(p.perPayroll)}</td><td>${p.finish ? fd(p.finish) : "—"}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td class="r">${t.active}</td><td class="r">${cop(t.given)}</td><td class="r">${cop(t.paid)}</td><td class="r">${cop(t.balance)}</td><td></td><td></td></tr></table>
    <h2>4. Vales activos</h2>
    <table><tr><th>Vale</th><th>Empleado</th><th>Detalle</th><th class="r">Total</th><th class="r">Saldo</th><th>Cuota</th></tr>
      ${d.loans.filter((l) => l.status === "active").map((l) => `<tr><td>#${l.number}<br/><span class="muted">${xDate(l.created_at)}</span></td><td>${esc(l.employee)}</td><td>${esc(l.description)}${l.point ? `<br/><span class="muted">${esc(l.point)} · entregó ${esc(l.created_by_name ?? "—")}</span>` : ""}</td>
        <td class="r">${cop(l.total)}${n(l.interest) ? `<br/><span class="muted">interés ${cop(l.interest)}</span>` : ""}</td><td class="r"><b>${cop(l.balance)}</b></td><td>${cop(l.installment)} × ${l.installments}${l.paused ? " · pausado" : ""}<br/><span class="muted">desde ${fd(l.start_on)}</span></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No hay vales activos.</td></tr>`}</table>
    <h2>5. Movimientos${from || to ? ` del ${from ? fd(from) : "inicio"} al ${to ? fd(to) : "hoy"}` : ""}</h2>
    ${mv.length ? `<table><tr><th>Fecha</th><th>Empleado</th><th>Movimiento</th><th class="r">Debe</th><th class="r">Paga</th></tr>
      ${mv.map((m) => `<tr style="${m.voided ? "opacity:.5;text-decoration:line-through" : ""}"><td>${xDate(m.at, true)}</td><td>${esc(m.employee)} · #${m.loan}</td><td>${esc(m.kind)}${m.voided ? ` (anulado: ${esc(m.voided)})` : ""}</td><td class="r">${m.sign > 0 ? cop(m.amount) : ""}</td><td class="r">${m.sign < 0 ? cop(m.amount) : ""}</td></tr>`).join("")}</table>`
      : `<p class="muted">Sin movimientos en esas fechas.</p>`}
    ${d.runsNote ? `<p class="muted">${esc(d.runsNote)}</p>` : ""}
    <p class="muted">Las fechas de pago son el último día de cada periodo (semana, quincena o mes). Lo proyectado puede cambiar si se pausa un vale, se cambia la cuota en una nómina o se hace un abono.</p>
    <div class="sign"><div>Preparó</div><div>Revisó</div></div>`;
  openPrint(`Vales ${fd(day)}`, body);
}
