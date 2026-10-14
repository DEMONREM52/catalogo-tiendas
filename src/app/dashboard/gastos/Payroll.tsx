"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Banknote, Check, Download, FileSpreadsheet, Pencil, Plus, Settings2, Undo2, UserPlus, Users } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  METHODS, PERIOD_LABEL, Sheet, ask, esc, askPayment, cardStyle, cop, done, downloadCsv, fail, fdate, field, ghostBtn, inputStyle, label, n, periodWindow, primaryBg, primaryBtn, swalTheme,
  type Catalog, type Concept, type Employee, type Period, type Point,
} from "./shared";

type Run = { id: string; number: number; point_id: string | null; point_name: string | null; period_kind: Period; period_start: string; period_end: string; status: RunStatus;
  earnings: number; deductions: number; net: number; employer_cost: number; total_cost: number; created_by_name: string | null; approved_by_name: string | null; employees: number; paid: number };
type RunStatus = "draft" | "approved" | "partial" | "paid" | "void";
type Item = { concept_id: string; code: string; name: string; kind: Concept["kind"]; calc: Concept["calc"]; value: number; amount: number };
type Line = { id: string; employee_id: string; full_name: string; document: string | null; position: string | null; bank_name: string | null; bank_account: string | null;
  days: number; salary_base: number; manual: Record<string, number>; items: Item[]; earnings: number; deductions: number; net: number; employer_cost: number; paid: number; notes: string | null };
type Detail = { run: Run & { notes: string | null; void_reason: string | null; created_by: string | null }; lines: Line[]; payments: Array<{ id: string; line_id: string; amount: number; method: string; reference: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null }> };

const RUN_STATUS: Record<RunStatus, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "#3987e5" }, approved: { label: "Aprobada · por pagar", color: "#8b5cf6" }, partial: { label: "Pago parcial", color: "#d95926" },
  paid: { label: "Pagada", color: "#22c55e" }, void: { label: "Anulada", color: "#94a3b8" },
};
const CONTRACT: Record<string, string> = { indefinite: "Término indefinido", fixed: "Término fijo", work: "Obra o labor", service: "Prestación de servicios", apprentice: "Aprendiz", other: "Otro" };
const KIND_LABEL: Record<Concept["kind"], string> = { earning: "Devengos", deduction: "Deducciones", employer: "Aportes y provisiones del empleador" };

export function PayrollTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [view, setView] = useState<"runs" | "people" | "concepts">("runs");
  const [runs, setRuns] = useState<Run[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [editingEmp, setEditingEmp] = useState<Employee | "new" | null>(null);
  const employees = cat.employees ?? [];
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;

  const loadRuns = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_payroll_runs_list", { p_store: storeId });
    if (!error) setRuns((data ?? []) as Run[]);
  }, [storeId]);
  useEffect(() => {
    const t = window.setTimeout(() => void loadRuns(), 0);
    return () => window.clearTimeout(t);
  }, [loadRuns]);

  async function createRun() {
    const kinds = [...new Set(employees.filter((e) => e.active).map((e) => e.pay_frequency))];
    if (!kinds.length) return void Swal.fire({ ...swalTheme, icon: "info", title: "Primero agrega empleados", text: "Crea los empleados con su salario y cada cuánto se les paga." });
    const kind0 = kinds[0];
    const [s0, e0] = periodWindow(kind0);
    const opts = [...(cat.can.madre ? [`<option value="">Toda la tienda</option>`] : []), ...visible.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)].join("");
    const r = await Swal.fire({
      ...swalTheme, title: "Nueva nómina",
      html: `<select id="kd" class="swal2-select">${(["monthly", "biweekly", "weekly"] as Period[]).map((k) => `<option value="${k}" ${k === kind0 ? "selected" : ""}>${PERIOD_LABEL[k]}</option>`).join("")}</select>
        <input id="st" type="date" class="swal2-input" value="${s0}" /><input id="en" type="date" class="swal2-input" value="${e0}" />
        <select id="pt" class="swal2-select">${opts}</select><input id="nt" class="swal2-input" placeholder="Nota (opcional)" />
        <p style="font-size:12px;opacity:.75">Incluye a los empleados activos con ese tipo de pago. El salario se calcula por días (meses de 30).</p>`,
      didOpen: () => {
        const kd = document.getElementById("kd") as HTMLSelectElement;
        kd.onchange = () => { const [a, b] = periodWindow(kd.value as Period); (document.getElementById("st") as HTMLInputElement).value = a; (document.getElementById("en") as HTMLInputElement).value = b; };
      },
      showCancelButton: true, confirmButtonText: "Crear", cancelButtonText: "Cancelar",
      preConfirm: () => ({ kd: (document.getElementById("kd") as HTMLSelectElement).value, st: (document.getElementById("st") as HTMLInputElement).value, en: (document.getElementById("en") as HTMLInputElement).value,
        pt: (document.getElementById("pt") as HTMLSelectElement).value, nt: (document.getElementById("nt") as HTMLInputElement).value }),
    });
    if (!r.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_payroll_create", { p_store: storeId, p_point: r.value.pt || null, p_kind: r.value.kd, p_start: r.value.st, p_end: r.value.en, p_notes: r.value.nt || null });
    if (error) return fail(error);
    const res = data as { id: string; employees: number; skipped: string[] };
    if (res.skipped?.length) void Swal.fire({ ...swalTheme, icon: "info", title: `Nómina con ${res.employees} empleados`, text: `No se incluyeron porque ya están en otra nómina del periodo: ${res.skipped.join(", ")}` });
    await loadRuns();
    setOpenRun(res.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
          {([["runs", "Nóminas"], ["people", `Empleados (${employees.filter((e) => e.active).length})`], ...(cat.can.payroll_approve && cat.can.madre ? [["concepts", "Conceptos"]] : [])] as Array<[typeof view, string]>).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} className="rounded-full px-3 py-1.5" style={view === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{l}</button>
          ))}
        </div>
        <span className="flex-1" />
        {view === "runs" && cat.can.payroll ? <button type="button" onClick={() => void createRun()} className={primaryBtn} style={primaryBg}><FileSpreadsheet size={16} /> Nueva nómina</button> : null}
        {view === "people" && cat.can.payroll ? <button type="button" onClick={() => setEditingEmp("new")} className={primaryBtn} style={primaryBg}><UserPlus size={16} /> Empleado</button> : null}
      </div>

      {view === "runs" ? (
        runs.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Aún no hay nóminas. Agrega los empleados y crea la primera.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenRun(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border p-3 text-left text-sm transition hover:-translate-y-0.5" style={{ ...cardStyle, opacity: r.status === "void" ? 0.55 : 1 }}>
                  <b>#{r.number}</b>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${RUN_STATUS[r.status].color} 18%, transparent)`, color: RUN_STATUS[r.status].color }}>{RUN_STATUS[r.status].label}</span>
                  <span>{PERIOD_LABEL[r.period_kind]} · {fdate(r.period_start)} – {fdate(r.period_end)}</span>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>{r.employees} empleados · {r.point_name ?? "toda la tienda"}</span>
                  <span className="ml-auto text-right"><b className="tabular-nums">{cop(r.net)}</b><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>neto · costo {cop(r.total_cost)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : view === "people" ? (
        employees.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Sin empleados todavía.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {employees.map((e) => (
              <li key={e.id} className="flex items-start gap-3 rounded-2xl border p-3" style={{ ...cardStyle, opacity: e.active ? 1 : 0.55 }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}>{e.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate">{e.full_name}</b>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{e.position ?? "Sin cargo"} · {points.find((p) => p.id === e.point_id)?.name ?? "Madre"} · {PERIOD_LABEL[e.pay_frequency]}{e.active ? "" : " · retirado"}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{CONTRACT[e.contract_type] ?? e.contract_type}{e.hired_on ? ` · desde ${fdate(e.hired_on)}` : ""}{e.transport_aid ? " · con auxilio" : ""}</p>
                </div>
                <div className="text-right">
                  <b className="block tabular-nums">{cop(e.base_salary)}</b>
                  <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>al mes</span>
                  {cat.can.payroll ? <button type="button" onClick={() => setEditingEmp(e)} className="mt-1 block text-xs font-bold underline">Editar</button> : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ConceptsEditor storeId={storeId} concepts={cat.concepts ?? []} onChanged={onChanged} />
      )}

      <AnimatePresence>{editingEmp ? <EmployeeForm key="emp" storeId={storeId} points={visible} cat={cat} initial={editingEmp === "new" ? null : editingEmp} onClose={() => setEditingEmp(null)} onSaved={() => { setEditingEmp(null); onChanged(); }} /> : null}</AnimatePresence>
      <AnimatePresence>{openRun ? <RunSheet key={openRun} id={openRun} cat={cat} onClose={() => setOpenRun(null)} onChanged={() => { void loadRuns(); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function EmployeeForm({ storeId, points, cat, initial, onClose, onSaved }: { storeId: string; points: Point[]; cat: Catalog; initial: Employee | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string | boolean | number>>(() => ({
    full_name: initial?.full_name ?? "", document_type: initial?.document_type ?? "CC", document: initial?.document ?? "", position: initial?.position ?? "",
    contract_type: initial?.contract_type ?? "indefinite", base_salary: initial ? n(initial.base_salary) : "", pay_frequency: initial?.pay_frequency ?? "monthly",
    transport_aid: initial?.transport_aid ?? true, hired_on: initial?.hired_on ?? "", terminated_on: initial?.terminated_on ?? "", active: initial?.active ?? true,
    phone: initial?.phone ?? "", email: initial?.email ?? "", bank_name: initial?.bank_name ?? "", bank_account: initial?.bank_account ?? "", notes: initial?.notes ?? "",
    point_id: initial ? initial.point_id ?? "" : cat.can.madre ? "" : points[0]?.id ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_employee_save", { p_store: storeId, p_id: initial?.id ?? null, p_data: { ...f, base_salary: Number(f.base_salary) || 0 } });
    setSaving(false);
    if (error) return fail(error);
    done(initial ? "Empleado actualizado" : "Empleado creado");
    onSaved();
  }
  const T = ({ k, l, type = "text" }: { k: string; l: string; type?: string }) => (
    <label className="block"><span className="text-xs font-bold">{l}</span><input type={type} value={String(f[k] ?? "")} onChange={set(k)} className={field} style={inputStyle} /></label>
  );
  return (
    <Sheet title={initial ? "Editar empleado" : "Nuevo empleado"} onClose={onClose} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Los cambios de salario aplican a las nóminas nuevas.</span>
        <button type="button" disabled={String(f.full_name).trim().length < 2 || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      {T({ k: "full_name", l: "Nombre completo" })}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-bold">Tipo de documento</span>
          <select value={String(f.document_type)} onChange={set("document_type")} className={field} style={inputStyle}>{["CC", "CE", "PPT", "PEP", "TI", "PAS", "NIT"].map((d) => <option key={d}>{d}</option>)}</select>
        </label>
        {T({ k: "document", l: "Número de documento" })}
        {T({ k: "position", l: "Cargo" })}
        <label className="block"><span className="text-xs font-bold">Contrato</span>
          <select value={String(f.contract_type)} onChange={set("contract_type")} className={field} style={inputStyle}>{Object.entries(CONTRACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        {T({ k: "base_salary", l: "Salario mensual", type: "number" })}
        <label className="block"><span className="text-xs font-bold">Se le paga</span>
          <select value={String(f.pay_frequency)} onChange={set("pay_frequency")} className={field} style={inputStyle}>{(Object.keys(PERIOD_LABEL) as Period[]).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}</select>
        </label>
        {T({ k: "hired_on", l: "Fecha de ingreso", type: "date" })}
        {T({ k: "terminated_on", l: "Fecha de retiro", type: "date" })}
        <label className="block"><span className="text-xs font-bold">Punto</span>
          <select value={String(f.point_id)} onChange={set("point_id")} className={field} style={inputStyle}>
            {cat.can.madre ? <option value="">🏬 Madre</option> : null}{points.map((p) => <option key={p.id} value={p.id}>📍 {p.name}</option>)}
          </select>
        </label>
        {T({ k: "phone", l: "Teléfono" })}
        {T({ k: "bank_name", l: "Banco" })}
        {T({ k: "bank_account", l: "Cuenta / Nequi" })}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.transport_aid)} onChange={set("transport_aid")} className="h-4 w-4 accent-violet-500" /> Recibe auxilio de transporte</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.active)} onChange={set("active")} className="h-4 w-4 accent-violet-500" /> Activo (entra en las nóminas)</label>
      {T({ k: "notes", l: "Notas" })}
    </Sheet>
  );
}

function RunSheet({ id, cat, onClose, onChanged }: { id: string; cat: Catalog; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [editLine, setEditLine] = useState<Line | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_payroll_detail", { p_run: id });
    if (error) return fail(error);
    setD(data as Detail);
  }, [id]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  const after = async () => { await load(); onChanged(); };
  const r = d?.run;

  async function transition(action: "approve" | "reopen" | "void") {
    let note: string | null = "";
    if (action === "void") { note = await ask("¿Por qué anulas la nómina?"); if (!note) return; }
    else {
      const ok = await Swal.fire({ ...swalTheme, icon: "question", title: action === "approve" ? "¿Aprobar la nómina?" : "¿Volver a borrador?", text: action === "approve" ? "Después ya no se edita; queda lista para pagar." : "", showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No" });
      if (!ok.isConfirmed) return;
    }
    const { error } = await supabaseBrowser().rpc("erp_payroll_transition", { p_run: id, p_action: action, p_note: note || null });
    if (error) return fail(error);
    await after();
  }
  async function pay(l: Line) {
    const p = await askPayment(`Pago a ${l.full_name}`, n(l.net) - n(l.paid), l.bank_account ? `${l.bank_name ?? ""} ${l.bank_account}. ` : "");
    if (!p) return;
    const { error } = await supabaseBrowser().rpc("erp_payroll_pay", { p_line: l.id, p_amount: p.amount, p_method: p.method, p_reference: p.ref || null, p_paid_at: null, p_key: p.key });
    if (error) return fail(error);
    await after();
  }
  async function voidPay(pid: string) {
    const reason = await ask("¿Por qué anulas este pago?");
    if (!reason) return;
    const { error } = await supabaseBrowser().rpc("erp_payroll_payment_void", { p_payment: pid, p_reason: reason });
    if (error) return fail(error);
    await after();
  }
  function exportCsv() {
    if (!d || !r) return;
    const concepts = [...new Map(d.lines.flatMap((l) => l.items).map((i) => [i.concept_id, i])).values()];
    downloadCsv(`nomina-${r.number}-${r.period_start}.csv`, ["Empleado", "Documento", "Cargo", "Días", ...concepts.map((c) => c.name), "Devengado", "Deducciones", "Neto a pagar", "Aportes empleador", "Pagado", "Banco", "Cuenta"],
      d.lines.map((l) => [l.full_name, l.document ?? "", l.position ?? "", n(l.days), ...concepts.map((c) => n(l.items.find((i) => i.concept_id === c.concept_id)?.amount ?? 0)), n(l.earnings), n(l.deductions), n(l.net), n(l.employer_cost), n(l.paid), l.bank_name ?? "", l.bank_account ?? ""]),
      [`RemHub · Nómina #${r.number}`, `${PERIOD_LABEL[r.period_kind]}: ${r.period_start} a ${r.period_end}`, `Estado: ${RUN_STATUS[r.status].label}`, `Generado: ${new Date().toLocaleString("es-CO")}`,
       "Valores calculados con los conceptos configurados en RemHub. Verifícalos con tu contador; no reemplaza la nómina electrónica DIAN."]);
  }

  return (
    <Sheet wide title={r ? `Nómina #${r.number} · ${PERIOD_LABEL[r.period_kind]}` : "Nómina"} subtitle={r ? <><span style={{ color: RUN_STATUS[r.status].color, fontWeight: 700 }}>{RUN_STATUS[r.status].label}</span> · {fdate(r.period_start)} – {fdate(r.period_end)} · preparó {r.created_by_name ?? "—"}{r.approved_by_name ? ` · aprobó ${r.approved_by_name}` : ""}</> : null}
      onClose={onClose} footer={r && r.status !== "void" ? (
        <>
          <button type="button" onClick={exportCsv} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Planilla CSV</button>
          {r.status === "draft" && (cat.can.payroll || cat.can.payroll_approve) ? <button type="button" onClick={() => void transition("void")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}>Anular</button> : null}
          {r.status === "approved" && cat.can.payroll_approve && d.lines.every((l) => n(l.paid) === 0) ? <button type="button" onClick={() => void transition("reopen")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Undo2 size={13} /> Volver a borrador</button> : null}
          <span className="flex-1" />
          {r.status === "draft" && cat.can.payroll_approve ? <button type="button" onClick={() => void transition("approve")} className={primaryBtn} style={{ background: "#22c55e" }}><Check size={15} /> Aprobar</button> : null}
        </>
      ) : null}>
      {d && r ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Devengado", r.earnings], ["Deducciones", r.deductions], ["Neto a pagar", r.net], ["Costo total", r.total_cost]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border p-2.5" style={cardStyle}><p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p><p className="font-black tabular-nums">{cop(v as number)}</p></div>
            ))}
          </div>
          {r.void_reason ? <p className="text-sm text-red-400">Anulada: {r.void_reason}</p> : null}
          <ul className="space-y-2">
            {d.lines.map((l) => {
              const left = n(l.net) - n(l.paid);
              return (
                <li key={l.id} className="rounded-2xl border p-3" style={cardStyle}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b className="min-w-0 flex-1 truncate">{l.full_name}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{n(l.days)} días</span>
                    <b className="tabular-nums">{cop(l.net)}</b>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {l.items.filter((i) => n(i.amount) !== 0).map((i) => <span key={i.concept_id}>{i.kind === "deduction" ? "−" : i.kind === "employer" ? "◦" : "+"} {i.name} {cop(i.amount)}</span>)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.status === "draft" && cat.can.payroll ? <button type="button" onClick={() => setEditLine(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Días, horas extra, comisiones…</button> : null}
                    {r.status !== "draft" ? <span className="text-xs tabular-nums" style={{ color: "var(--t-muted)" }}>pagado {cop(l.paid)}{left > 0 ? ` · falta ${cop(left)}` : ""}</span> : null}
                    <span className="flex-1" />
                    {(r.status === "approved" || r.status === "partial") && cat.can.payroll_pay && left > 0 ? <button type="button" onClick={() => void pay(l)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#8b5cf6" }}><Banknote size={13} /> Pagar</button> : null}
                    {r.status !== "draft" && left <= 0 && n(l.net) > 0 ? <span className="text-xs font-bold text-emerald-400">✓ Pagado</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {d.payments.length ? (
            <section>
              <p className={label} style={{ color: "var(--t-muted)" }}>Pagos registrados</p>
              <ul className="mt-1 space-y-1 text-sm">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)", opacity: p.voided ? 0.6 : 1 }}>
                    <b className={p.voided ? "line-through" : ""}>{cop(p.amount)}</b>
                    <span>{d.lines.find((l) => l.id === p.line_id)?.full_name}</span>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{METHODS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""} · {new Date(p.paid_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
                    {p.voided ? <span className="text-xs text-red-400">anulado: {p.void_reason}</span> : cat.can.payroll_approve ? <button type="button" onClick={() => void voidPay(p.id)} className="ml-auto text-xs font-bold underline">Anular</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Cálculo con los conceptos configurados (salario ÷ 30 × días). Verifícalo con tu contador; esto no reemplaza la nómina electrónica ante la DIAN.</p>
        </>
      ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>}
      <AnimatePresence>{editLine && d ? <LineEditor key={editLine.id} line={editLine} concepts={cat.concepts ?? []} onClose={() => setEditLine(null)} onSaved={() => { setEditLine(null); void after(); }} /> : null}</AnimatePresence>
    </Sheet>
  );
}

function LineEditor({ line, concepts, onClose, onSaved }: { line: Line; concepts: Concept[]; onClose: () => void; onSaved: () => void }) {
  const manual = useMemo(() => concepts.filter((c) => c.active && c.calc === "manual"), [concepts]);
  const [days, setDays] = useState(String(n(line.days)));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(manual.map((c) => [c.id, line.manual?.[c.id] ? String(line.manual[c.id]) : ""])));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const m = Object.fromEntries(Object.entries(vals).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const { error } = await supabaseBrowser().rpc("erp_payroll_line_update", { p_line: line.id, p_days: Number(days), p_manual: m, p_notes: null });
    setSaving(false);
    if (error) return fail(error);
    onSaved();
  }
  return (
    <Sheet title={line.full_name} subtitle={`Salario mensual ${cop(line.salary_base)}`} onClose={onClose} footer={<><span className="flex-1" /><button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Calculando…" : "Guardar y recalcular"}</button></>}>
      <label className="block"><span className="text-xs font-bold">Días trabajados (máx. 30)</span><input type="number" min={0} max={30} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} className={field} style={inputStyle} /></label>
      {(["earning", "deduction", "employer"] as const).map((k) => manual.filter((c) => c.kind === k).length ? (
        <div key={k}>
          <p className={label} style={{ color: "var(--t-muted)" }}>{KIND_LABEL[k]}</p>
          {manual.filter((c) => c.kind === k).map((c) => (
            <label key={c.id} className="mt-2 flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">{c.name}</span>
              <input type="number" inputMode="decimal" min={0} value={vals[c.id] ?? ""} onChange={(e) => setVals({ ...vals, [c.id]: e.target.value })} placeholder="0" className="w-36 rounded-lg border px-2 py-1.5 text-right font-bold tabular-nums" style={inputStyle} />
            </label>
          ))}
        </div>
      ) : null)}
    </Sheet>
  );
}

function ConceptsEditor({ storeId, concepts, onChanged }: { storeId: string; concepts: Concept[]; onChanged: () => void }) {
  async function save(c: Concept, patch: Partial<Concept>) {
    const { error } = await supabaseBrowser().rpc("erp_payroll_concept_save", { p_store: storeId, p_id: c.id, p_name: patch.name ?? null, p_kind: null, p_calc: null, p_value: patch.value ?? null,
      p_in_base: patch.in_base ?? null, p_incl_transport: patch.base_includes_transport ?? null, p_active: patch.active ?? null });
    if (error) return fail(error);
    onChanged();
  }
  async function add() {
    const r = await Swal.fire({
      ...swalTheme, title: "Nuevo concepto",
      html: `<input id="nm" class="swal2-input" placeholder="Nombre (ej.: Bono de puntualidad)" />
        <select id="kd" class="swal2-select"><option value="earning">Devengo (suma)</option><option value="deduction">Deducción (resta)</option><option value="employer">Aporte del empleador</option></select>
        <select id="cl" class="swal2-select"><option value="manual">Valor que se escribe en cada nómina</option><option value="fixed">Valor fijo</option><option value="base_pct">% de la base (IBC)</option></select>
        <input id="vl" type="number" class="swal2-input" placeholder="Valor o % (si aplica)" />`,
      showCancelButton: true, confirmButtonText: "Crear", cancelButtonText: "Cancelar",
      preConfirm: () => ({ nm: (document.getElementById("nm") as HTMLInputElement).value, kd: (document.getElementById("kd") as HTMLSelectElement).value, cl: (document.getElementById("cl") as HTMLSelectElement).value, vl: Number((document.getElementById("vl") as HTMLInputElement).value) || 0 }),
    });
    if (!r.isConfirmed || !r.value.nm.trim()) return;
    const { error } = await supabaseBrowser().rpc("erp_payroll_concept_save", { p_store: storeId, p_id: null, p_name: r.value.nm, p_kind: r.value.kd, p_calc: r.value.cl, p_value: r.value.vl, p_in_base: r.value.kd === "earning" && r.value.cl === "manual", p_incl_transport: false, p_active: true });
    if (error) return fail(error);
    onChanged();
  }
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <Settings2 size={16} className="mt-0.5 shrink-0" />
        <span>Los porcentajes y valores son <b>ejemplos editables</b> (salud, pensión, aportes, provisiones). Confírmalos con tu contador y actualiza el <b>auxilio de transporte</b> cada año. Los aportes del empleador vienen apagados.</span>
      </p>
      <div className="flex justify-end"><button type="button" onClick={() => void add()} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Concepto</button></div>
      {(["earning", "deduction", "employer"] as const).map((k) => (
        <section key={k} className="rounded-2xl border p-3" style={cardStyle}>
          <p className={`${label} mb-2 flex items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><Users size={13} /> {KIND_LABEL[k]}</p>
          <ul className="space-y-1.5">
            {concepts.filter((c) => c.kind === k).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", opacity: c.active ? 1 : 0.6 }}>
                <span className="min-w-0 flex-1">
                  <b className="block">{c.name}</b>
                  <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{c.calc === "salary" ? "Salario ÷ 30 × días" : c.calc === "transport" ? "Valor mensual ÷ 30 × días (a quien lo tenga)" : c.calc === "base_pct" ? `% de la base${c.base_includes_transport ? " + auxilio" : ""}` : c.calc === "fixed" ? "Valor fijo por nómina" : "Se escribe en cada nómina"}{c.note ? ` · ${c.note}` : ""}</span>
                </span>
                {c.calc === "base_pct" || c.calc === "fixed" || c.calc === "transport" ? (
                  <input type="number" inputMode="decimal" min={0} defaultValue={n(c.value)} onBlur={(e) => { if (Number(e.target.value) !== n(c.value)) void save(c, { value: Number(e.target.value) }); }} className="w-28 rounded-lg border px-2 py-1 text-right font-bold tabular-nums" style={inputStyle} aria-label={`Valor de ${c.name}`} />
                ) : null}
                {c.calc === "base_pct" ? <span className="text-xs">%</span> : null}
                {c.calc !== "salary" ? (
                  <button type="button" onClick={() => void save(c, { active: !c.active })} className="rounded-full px-3 py-1 text-xs font-bold" style={c.active ? { background: "#22c55e", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{c.active ? "Activo" : "Apagado"}</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
