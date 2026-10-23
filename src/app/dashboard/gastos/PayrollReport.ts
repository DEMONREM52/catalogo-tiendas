import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadXlsx, xDate, type XCell, type XSheet } from "@/lib/data/xlsx";
import { logExport } from "@/lib/permission-runtime";

/**
 * Informes de nómina para entregar a quien paga:
 *  · De una nómina: hoja para imprimir (resumen, lista de pagos con banco y cuenta, detalle por empleado, vales,
 *    aportes del empleador y firmas) + desprendibles para cada empleado + Excel completo.
 *  · De un rango de fechas: todas las nóminas del periodo consolidadas por empleado y por concepto (Excel e impreso).
 */

type Item = { concept_id: string; code: string; name: string; kind: "earning" | "deduction" | "employer"; calc: string; value: number; amount: number; loan_id?: string; balance?: number };
type Line = { id: string; employee_id: string; full_name: string; document: string | null; position: string | null; bank_name: string | null; bank_account: string | null;
  days: number; salary_base: number; items: Item[]; earnings: number; deductions: number; net: number; employer_cost: number; paid: number; notes: string | null };
type Payment = { id: string; line_id: string; amount: number; method: string; reference: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null };
type Run = { id: string; number: number; point_name: string | null; period_kind: string; period_start: string; period_end: string; status: string; earnings: number; deductions: number;
  net: number; employer_cost: number; total_cost: number; created_by_name: string | null; approved_by_name: string | null; approved_at?: string | null; notes?: string | null };
export type PayrollDetail = { run: Run; lines: Line[]; payments: Payment[] };

const n = (v: unknown) => Number(v ?? 0);
const cop = (v: unknown) => `$${Math.round(n(v)).toLocaleString("es-CO")}`;
const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PERIOD: Record<string, string> = { weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };
const STATUS: Record<string, string> = { draft: "Borrador (sin aprobar)", approved: "Aprobada · por pagar", partial: "Pago parcial", paid: "Pagada", void: "Anulada" };
const METHOD: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", nequi: "Nequi / Daviplata", card: "Tarjeta", other: "Otro" };
const fd = (d: string | null | undefined) => xDate(d);

async function storeName(storeId: string) {
  const { data } = await supabaseBrowser().from("stores").select("name").eq("id", storeId).maybeSingle();
  return String((data as { name?: string } | null)?.name ?? "");
}

/** Conceptos en el orden en que aparecen (devengos, deducciones, aportes). */
function conceptsOf(lines: Line[]) {
  const order = { earning: 0, deduction: 1, employer: 2 };
  const map = new Map<string, Item>();
  for (const l of lines) for (const i of l.items) if (!map.has(i.concept_id) && (n(i.amount) !== 0 || i.calc === "manual")) map.set(i.concept_id, i);
  return [...map.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}
const paidOf = (d: PayrollDetail, lineId: string) => d.payments.filter((p) => p.line_id === lineId && !p.voided);

// ======================================================================== una nómina
export function runSheets(d: PayrollDetail): XSheet[] {
  const r = d.run;
  const concepts = conceptsOf(d.lines);
  const loans = d.lines.flatMap((l) => l.items.filter((i) => i.calc === "loan" && n(i.amount) > 0).map((i) => ({ l, i })));
  return [
    { name: "Resumen", head: ["Dato", "Valor"], rows: [
      ["Nómina", `#${r.number}`], ["Tipo", PERIOD[r.period_kind] ?? r.period_kind], ["Periodo", `${fd(r.period_start)} a ${fd(r.period_end)}`], ["Punto", r.point_name ?? "Todos"],
      ["Estado", STATUS[r.status] ?? r.status], ["Empleados", d.lines.length], ["Devengado", n(r.earnings)], ["Deducciones", n(r.deductions)], ["Neto a pagar", n(r.net)],
      ["Pagado", d.lines.reduce((s, l) => s + n(l.paid), 0)], ["Falta por pagar", d.lines.reduce((s, l) => s + Math.max(0, n(l.net) - n(l.paid)), 0)],
      ["Aportes y provisiones del empleador", n(r.employer_cost)], ["Costo total", n(r.total_cost)], ["Preparó", r.created_by_name ?? ""], ["Aprobó", r.approved_by_name ?? ""],
    ] },
    { name: "Para pagar", head: ["Empleado", "Documento", "Cargo", "Banco", "Cuenta", "Neto a pagar", "Pagado", "Falta"],
      rows: d.lines.map((l) => [l.full_name, l.document ?? "", l.position ?? "", l.bank_name ?? "", l.bank_account ?? "", n(l.net), n(l.paid), Math.max(0, n(l.net) - n(l.paid))]) },
    { name: "Detalle por empleado", head: ["Empleado", "Documento", "Días", "Salario base", ...concepts.map((c) => `${c.kind === "earning" ? "+" : c.kind === "deduction" ? "−" : "Empleador:"} ${c.name}`), "Devengado", "Deducciones", "Neto", "Aportes empleador"],
      rows: d.lines.map((l) => [l.full_name, l.document ?? "", n(l.days), n(l.salary_base), ...concepts.map((c) => n(l.items.find((i) => i.concept_id === c.concept_id)?.amount ?? 0)), n(l.earnings), n(l.deductions), n(l.net), n(l.employer_cost)]) },
    { name: "Vales descontados", head: ["Empleado", "Vale", "Descontado", "Saldo antes", "Saldo después"],
      rows: loans.map(({ l, i }) => [l.full_name, i.name, n(i.amount), n(i.balance), Math.max(0, n(i.balance) - n(i.amount))]) },
    { name: "Pagos", head: ["Fecha", "Empleado", "Valor", "Medio", "Referencia", "Registró", "Anulado"],
      rows: d.payments.map((p) => [xDate(p.paid_at, true), d.lines.find((l) => l.id === p.line_id)?.full_name ?? "", n(p.amount), METHOD[p.method] ?? p.method, p.reference ?? "", p.created_by_name ?? "", p.voided ? `Sí (${p.void_reason ?? ""})` : "No"]) },
  ];
}

export function downloadRunExcel(d: PayrollDetail) {
  logExport("nomina_informe", d.lines.length, { run: d.run.number });
  downloadXlsx(`nomina-${d.run.number}-${d.run.period_start}`, runSheets(d));
}

const CSS = `body{font-family:system-ui,Arial,sans-serif;color:#111;margin:0;padding:24px;font-size:12px}
h1{font-size:19px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #6d28d9;padding-bottom:3px}
table{width:100%;border-collapse:collapse;margin:6px 0}td,th{border-bottom:1px solid #e5e5e5;padding:4px 5px;text-align:left;vertical-align:top}th{background:#f4f0ff;font-size:11px}
.r{text-align:right;white-space:nowrap}.muted{color:#666}.tot td{font-weight:700;border-top:2px solid #111}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.box{border:1px solid #ddd;border-radius:8px;padding:8px}.box b{display:block;font-size:15px}.sign{display:flex;gap:28px;margin-top:46px}.sign div{flex:1;border-top:1px solid #111;padding-top:5px;text-align:center}
.slip{page-break-before:always;max-width:640px}.bar{position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:8px;border-bottom:1px solid #eee}
@media print{.bar{display:none}body{padding:0}@page{size:letter;margin:12mm}}`;

function open(title: string, body: string) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
    <div class="bar"><button onclick="window.print()">🖨️ Imprimir o guardar en PDF</button></div>${body}</body></html>`);
  w.document.close();
}

function slipHtml(d: PayrollDetail, l: Line, store: string) {
  const r = d.run;
  const rows = (kind: Item["kind"]) => l.items.filter((i) => i.kind === kind && n(i.amount) !== 0)
    .map((i) => `<tr><td>${esc(i.name)}${i.calc === "loan" ? ` <span class="muted">(saldo que queda ${cop(Math.max(0, n(i.balance) - n(i.amount)))})</span>` : ""}</td><td class="r">${cop(i.amount)}</td></tr>`).join("");
  const pays = paidOf(d, l.id).map((p) => `${fd(p.paid_at.slice(0, 10))} · ${cop(p.amount)} · ${esc(METHOD[p.method] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ""}`).join("<br/>");
  return `<section class="slip"><h1>Comprobante de pago de nómina</h1>
    <p>${esc(store)} · Nómina #${r.number} · ${esc(PERIOD[r.period_kind] ?? "")} del ${fd(r.period_start)} al ${fd(r.period_end)}</p>
    <p><b>${esc(l.full_name)}</b>${l.document ? ` · Doc. ${esc(l.document)}` : ""}${l.position ? ` · ${esc(l.position)}` : ""} · ${n(l.days)} días · salario base ${cop(l.salary_base)}</p>
    <h2>Devengos</h2><table>${rows("earning")}<tr class="tot"><td>Total devengado</td><td class="r">${cop(l.earnings)}</td></tr></table>
    <h2>Deducciones</h2><table>${rows("deduction") || `<tr><td class="muted">Sin deducciones</td><td></td></tr>`}<tr class="tot"><td>Total deducciones</td><td class="r">${cop(l.deductions)}</td></tr></table>
    <table><tr class="tot"><td style="font-size:15px">NETO A PAGAR</td><td class="r" style="font-size:15px">${cop(l.net)}</td></tr></table>
    ${l.bank_account ? `<p>Se paga a: ${esc(l.bank_name ?? "Cuenta")} ${esc(l.bank_account)}</p>` : ""}
    ${pays ? `<p><b>Pagos:</b><br/>${pays}</p>` : `<p class="muted">Pago pendiente.</p>`}
    <div class="sign"><div>Recibí conforme<br/>${esc(l.full_name)}</div><div>Entregó<br/>&nbsp;</div></div></section>`;
}

/** Informe completo de una nómina para imprimir (o guardar en PDF). Con `slips`, agrega un desprendible por empleado. */
export async function printRunReport(storeId: string, d: PayrollDetail, slips = true) {
  const store = await storeName(storeId);
  const r = d.run;
  logExport("nomina_informe_impreso", d.lines.length, { run: r.number });
  const concepts = conceptsOf(d.lines);
  const sum = (c: Item) => d.lines.reduce((s, l) => s + n(l.items.find((i) => i.concept_id === c.concept_id)?.amount ?? 0), 0);
  const pending = d.lines.reduce((s, l) => s + Math.max(0, n(l.net) - n(l.paid)), 0);
  const paid = d.lines.reduce((s, l) => s + n(l.paid), 0);
  const loans = d.lines.flatMap((l) => l.items.filter((i) => i.calc === "loan" && n(i.amount) > 0).map((i) => ({ l, i })));
  const conceptRows = (kind: Item["kind"]) => concepts.filter((c) => c.kind === kind).map((c) => `<tr><td>${esc(c.name)}${c.calc === "base_pct" ? ` <span class="muted">(${n(c.value)} %)</span>` : ""}</td><td class="r">${cop(sum(c))}</td></tr>`).join("");
  const body = `
    <h1>Informe de nómina #${r.number}</h1>
    <p>${esc(store)} · ${esc(PERIOD[r.period_kind] ?? "")} del <b>${fd(r.period_start)}</b> al <b>${fd(r.period_end)}</b>${r.point_name ? ` · ${esc(r.point_name)}` : ""} · <b>${esc(STATUS[r.status] ?? r.status)}</b></p>
    <p class="muted">Preparó ${esc(r.created_by_name ?? "—")}${r.approved_by_name ? ` · aprobó ${esc(r.approved_by_name)}` : " · sin aprobar"} · impreso ${xDate(new Date().toISOString(), true)}</p>
    <div class="grid">
      <div class="box">Empleados<b>${d.lines.length}</b></div><div class="box">Neto a pagar<b>${cop(r.net)}</b></div>
      <div class="box">Ya pagado<b>${cop(paid)}</b></div><div class="box">Falta por pagar<b>${cop(pending)}</b></div>
      <div class="box">Devengado<b>${cop(r.earnings)}</b></div><div class="box">Deducciones<b>${cop(r.deductions)}</b></div>
      <div class="box">Aportes empleador<b>${cop(r.employer_cost)}</b></div><div class="box">Costo total<b>${cop(r.total_cost)}</b></div>
    </div>
    <h2>1. Lista para pagar</h2>
    <table><tr><th>Empleado</th><th>Documento</th><th>Banco</th><th>Cuenta</th><th class="r">Neto</th><th class="r">Pagado</th><th class="r">Falta</th></tr>
      ${d.lines.map((l) => `<tr><td>${esc(l.full_name)}</td><td>${esc(l.document ?? "")}</td><td>${esc(l.bank_name ?? "")}</td><td>${esc(l.bank_account ?? "")}</td><td class="r">${cop(l.net)}</td><td class="r">${cop(l.paid)}</td><td class="r">${cop(Math.max(0, n(l.net) - n(l.paid)))}</td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Total</td><td class="r">${cop(r.net)}</td><td class="r">${cop(paid)}</td><td class="r">${cop(pending)}</td></tr></table>
    <h2>2. Detalle por empleado</h2>
    <table><tr><th>Empleado</th><th class="r">Días</th><th class="r">Devengado</th><th class="r">Deducciones</th><th>Deducciones en detalle</th><th class="r">Neto</th></tr>
      ${d.lines.map((l) => `<tr><td>${esc(l.full_name)}${l.position ? `<br/><span class="muted">${esc(l.position)}</span>` : ""}</td><td class="r">${n(l.days)}</td><td class="r">${cop(l.earnings)}</td><td class="r">${cop(l.deductions)}</td>
        <td>${l.items.filter((i) => i.kind === "deduction" && n(i.amount) !== 0).map((i) => `${esc(i.name)}: ${cop(i.amount)}`).join("<br/>") || "—"}</td><td class="r"><b>${cop(l.net)}</b></td></tr>`).join("")}</table>
    <h2>3. Totales por concepto</h2>
    <table><tr><th colspan="2">➕ Devengos</th></tr>${conceptRows("earning")}<tr><th colspan="2">➖ Deducciones</th></tr>${conceptRows("deduction") || `<tr><td class="muted">—</td><td></td></tr>`}
      <tr><th colspan="2">🏢 Aportes y provisiones del empleador (no se le pagan al empleado)</th></tr>${conceptRows("employer") || `<tr><td class="muted">—</td><td></td></tr>`}</table>
    ${loans.length ? `<h2>4. Vales y préstamos descontados</h2><table><tr><th>Empleado</th><th>Vale</th><th class="r">Descontado</th><th class="r">Saldo que queda</th></tr>
      ${loans.map(({ l, i }) => `<tr><td>${esc(l.full_name)}</td><td>${esc(i.name)}</td><td class="r">${cop(i.amount)}</td><td class="r">${cop(Math.max(0, n(i.balance) - n(i.amount)))}</td></tr>`).join("")}</table>` : ""}
    ${d.payments.length ? `<h2>${loans.length ? "5" : "4"}. Pagos registrados</h2><table><tr><th>Fecha</th><th>Empleado</th><th>Medio</th><th>Referencia</th><th class="r">Valor</th></tr>
      ${d.payments.filter((p) => !p.voided).map((p) => `<tr><td>${xDate(p.paid_at, true)}</td><td>${esc(d.lines.find((l) => l.id === p.line_id)?.full_name ?? "")}</td><td>${esc(METHOD[p.method] ?? p.method)}</td><td>${esc(p.reference ?? "")}</td><td class="r">${cop(p.amount)}</td></tr>`).join("")}</table>` : ""}
    ${r.status === "draft" ? `<p style="color:#b45309"><b>⚠️ Esta nómina está en borrador:</b> los valores pueden cambiar hasta que se apruebe.</p>` : ""}
    <p class="muted">Valores calculados con los conceptos configurados en RemHub. Verifícalos con tu contador; no reemplaza la nómina electrónica de la DIAN.</p>
    <div class="sign"><div>Preparó<br/>${esc(r.created_by_name ?? "")}</div><div>Aprobó<br/>${esc(r.approved_by_name ?? "")}</div><div>Recibe para pagar<br/>&nbsp;</div></div>
    ${slips ? d.lines.map((l) => slipHtml(d, l, store)).join("") : ""}`;
  open(`Nómina #${r.number}`, body);
}

// ======================================================================== varias nóminas (periodo)
type RunRow = { id: string; number: number; status: string; period_start: string; period_end: string };

async function details(storeId: string, from: string, to: string, step: (t: string) => void) {
  const { data, error } = await supabaseBrowser().rpc("erp_payroll_runs_list", { p_store: storeId });
  if (error) throw new Error(error.message);
  const runs = ((data ?? []) as RunRow[]).filter((r) => r.status !== "void" && r.period_start <= to && r.period_end >= from).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const out: PayrollDetail[] = [];
  for (const [i, r] of runs.entries()) {
    step(`Nómina ${i + 1} de ${runs.length}…`);
    const res = await supabaseBrowser().rpc("erp_payroll_detail", { p_run: r.id });
    if (res.error) throw new Error(res.error.message);
    out.push(res.data as PayrollDetail);
  }
  return out;
}

function consolidate(list: PayrollDetail[]) {
  const people = new Map<string, { name: string; doc: string; bank: string; account: string; runs: number; days: number; earnings: number; deductions: number; net: number; paid: number; employer: number; loans: number }>();
  const concepts = new Map<string, { name: string; kind: Item["kind"]; total: number }>();
  for (const d of list) for (const l of d.lines) {
    const p = people.get(l.employee_id) ?? { name: l.full_name, doc: l.document ?? "", bank: l.bank_name ?? "", account: l.bank_account ?? "", runs: 0, days: 0, earnings: 0, deductions: 0, net: 0, paid: 0, employer: 0, loans: 0 };
    p.runs++; p.days += n(l.days); p.earnings += n(l.earnings); p.deductions += n(l.deductions); p.net += n(l.net); p.paid += n(l.paid); p.employer += n(l.employer_cost);
    p.loans += l.items.filter((i) => i.calc === "loan").reduce((s, i) => s + n(i.amount), 0);
    people.set(l.employee_id, p);
    for (const i of l.items) {
      if (!n(i.amount)) continue;
      const key = i.calc === "loan" ? "loan" : i.concept_id;
      const c = concepts.get(key) ?? { name: i.calc === "loan" ? "Vales y préstamos" : i.name, kind: i.kind, total: 0 };
      c.total += n(i.amount);
      concepts.set(key, c);
    }
  }
  return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), concepts: [...concepts.values()] };
}

export async function periodReport(storeId: string, from: string, to: string, format: "excel" | "print", step: (t: string) => void) {
  const list = await details(storeId, from, to, step);
  if (!list.length) throw new Error("No hay nóminas (sin anular) en esas fechas.");
  step("Armando el informe…");
  const { people, concepts } = consolidate(list);
  const sum = (k: "earnings" | "deductions" | "net" | "employer_cost" | "total_cost") => list.reduce((s, d) => s + n(d.run[k]), 0);
  const paid = people.reduce((s, p) => s + p.paid, 0);
  // Saldo pendiente de vales a la fecha (si existe el módulo).
  const loansRes = await supabaseBrowser().rpc("erp_employee_loans_list", { p_store: storeId });
  const loans = ((loansRes.data as { loans?: Array<Record<string, unknown>> } | null)?.loans ?? []).filter((l) => l.status === "active");
  logExport("nomina_periodo", people.length, { desde: from, hasta: to, nominas: list.length });
  if (format === "excel") {
    const kindLabel = { earning: "Devengo", deduction: "Deducción", employer: "Aporte del empleador" } as const;
    const sheets: XSheet[] = [
      { name: "Resumen", head: ["Dato", "Valor"], rows: [["Desde", fd(from)], ["Hasta", fd(to)], ["Nóminas", list.length], ["Empleados", people.length], ["Devengado", sum("earnings")], ["Deducciones", sum("deductions")],
        ["Neto", sum("net")], ["Pagado", paid], ["Falta por pagar", Math.max(0, sum("net") - paid)], ["Aportes empleador", sum("employer_cost")], ["Costo total", sum("total_cost")]] as XCell[][] },
      { name: "Nóminas", head: ["Número", "Tipo", "Desde", "Hasta", "Punto", "Estado", "Empleados", "Devengado", "Deducciones", "Neto", "Pagado", "Aportes", "Costo total", "Aprobó"],
        rows: list.map((d) => [d.run.number, PERIOD[d.run.period_kind] ?? "", fd(d.run.period_start), fd(d.run.period_end), d.run.point_name ?? "Todos", STATUS[d.run.status] ?? d.run.status, d.lines.length,
          n(d.run.earnings), n(d.run.deductions), n(d.run.net), d.lines.reduce((s, l) => s + n(l.paid), 0), n(d.run.employer_cost), n(d.run.total_cost), d.run.approved_by_name ?? ""]) },
      { name: "Por empleado", head: ["Empleado", "Documento", "Nóminas", "Días", "Devengado", "Deducciones", "De eso, vales", "Neto", "Pagado", "Falta", "Aportes empleador", "Banco", "Cuenta"],
        rows: people.map((p) => [p.name, p.doc, p.runs, p.days, p.earnings, p.deductions, p.loans, p.net, p.paid, Math.max(0, p.net - p.paid), p.employer, p.bank, p.account]) },
      { name: "Por concepto", head: ["Concepto", "Tipo", "Total"], rows: concepts.map((c) => [c.name, kindLabel[c.kind], c.total]) },
      { name: "Vales pendientes", head: ["Empleado", "Vale", "Descripción", "Total", "Saldo", "Cuota", "Pausado"],
        rows: loans.map((l) => [String(l.employee ?? ""), `#${l.number}`, String(l.description ?? ""), n(l.total), n(l.balance), n(l.installment), l.paused ? "Sí" : "No"]) },
      ...list.flatMap((d) => runSheets(d).slice(2, 3).map((s) => ({ ...s, name: `Nómina ${d.run.number}` }))),
    ];
    downloadXlsx(`nomina-${from}-a-${to}`, sheets);
    return;
  }
  const store = await storeName(storeId);
  const body = `
    <h1>Informe de nómina del ${fd(from)} al ${fd(to)}</h1>
    <p>${esc(store)} · ${list.length} nómina${list.length === 1 ? "" : "s"} · ${people.length} empleados · impreso ${xDate(new Date().toISOString(), true)}</p>
    <div class="grid">
      <div class="box">Devengado<b>${cop(sum("earnings"))}</b></div><div class="box">Deducciones<b>${cop(sum("deductions"))}</b></div>
      <div class="box">Neto<b>${cop(sum("net"))}</b></div><div class="box">Falta por pagar<b>${cop(Math.max(0, sum("net") - paid))}</b></div>
      <div class="box">Pagado<b>${cop(paid)}</b></div><div class="box">Aportes empleador<b>${cop(sum("employer_cost"))}</b></div>
      <div class="box">Costo total<b>${cop(sum("total_cost"))}</b></div><div class="box">Vales por cobrar<b>${cop(loans.reduce((s, l) => s + n(l.balance), 0))}</b></div>
    </div>
    <h2>Nóminas del periodo</h2>
    <table><tr><th>#</th><th>Periodo</th><th>Estado</th><th class="r">Neto</th><th class="r">Pagado</th><th class="r">Costo total</th></tr>
      ${list.map((d) => `<tr><td>${d.run.number}</td><td>${esc(PERIOD[d.run.period_kind] ?? "")} ${fd(d.run.period_start)} – ${fd(d.run.period_end)}</td><td>${esc(STATUS[d.run.status] ?? "")}</td><td class="r">${cop(d.run.net)}</td><td class="r">${cop(d.lines.reduce((s, l) => s + n(l.paid), 0))}</td><td class="r">${cop(d.run.total_cost)}</td></tr>`).join("")}</table>
    <h2>Por empleado</h2>
    <table><tr><th>Empleado</th><th class="r">Días</th><th class="r">Devengado</th><th class="r">Deducciones</th><th class="r">Vales</th><th class="r">Neto</th><th class="r">Pagado</th><th class="r">Falta</th></tr>
      ${people.map((p) => `<tr><td>${esc(p.name)}${p.doc ? `<br/><span class="muted">${esc(p.doc)}</span>` : ""}</td><td class="r">${p.days}</td><td class="r">${cop(p.earnings)}</td><td class="r">${cop(p.deductions)}</td><td class="r">${cop(p.loans)}</td><td class="r"><b>${cop(p.net)}</b></td><td class="r">${cop(p.paid)}</td><td class="r">${cop(Math.max(0, p.net - p.paid))}</td></tr>`).join("")}</table>
    <h2>Por concepto</h2>
    <table>${(["earning", "deduction", "employer"] as const).map((k) => `<tr><th colspan="2">${k === "earning" ? "➕ Devengos" : k === "deduction" ? "➖ Deducciones" : "🏢 Aportes del empleador"}</th></tr>${concepts.filter((c) => c.kind === k).map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${cop(c.total)}</td></tr>`).join("") || `<tr><td class="muted">—</td><td></td></tr>`}`).join("")}</table>
    ${loans.length ? `<h2>Vales y préstamos pendientes hoy</h2><table><tr><th>Empleado</th><th>Vale</th><th class="r">Saldo</th><th class="r">Cuota</th></tr>
      ${loans.map((l) => `<tr><td>${esc(l.employee)}</td><td>#${esc(l.number)} · ${esc(l.description)}${l.paused ? " (pausado)" : ""}</td><td class="r">${cop(l.balance)}</td><td class="r">${cop(l.installment)}</td></tr>`).join("")}</table>` : ""}
    <p class="muted">Valores calculados con los conceptos configurados en RemHub. Verifícalos con tu contador; no reemplaza la nómina electrónica de la DIAN.</p>
    <div class="sign"><div>Preparó</div><div>Revisó / pagó</div></div>`;
  open(`Nómina ${fd(from)} a ${fd(to)}`, body);
}
