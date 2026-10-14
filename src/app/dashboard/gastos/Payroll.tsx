"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Banknote, Check, ChevronDown, Download, FileSpreadsheet, Pencil, Plus, Settings2, Trash2, Undo2, UserPlus, Users, XCircle } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  ChoiceChips, DateField, Field, METHODS, MoneyField, NumberField, PERIOD_LABEL, PaymentSheet, Sheet, ask, askDelete, cardStyle, cop, done, downloadCsv, fail, fdate, field, ghostBtn,
  inputStyle, label, n, periodWindow, primaryBg, primaryBtn, swalTheme, type Catalog, type Concept, type Employee, type Period, type Point,
} from "./shared";

type Run = { id: string; number: number; point_id: string | null; point_name: string | null; period_kind: Period; period_start: string; period_end: string; status: RunStatus;
  earnings: number; deductions: number; net: number; employer_cost: number; total_cost: number; created_by_name: string | null; approved_by_name: string | null; employees: number; paid: number };
type RunStatus = "draft" | "approved" | "partial" | "paid" | "void";
type Item = { concept_id: string; code: string; name: string; kind: Concept["kind"]; calc: Concept["calc"]; value: number; amount: number };
type Line = { id: string; employee_id: string; full_name: string; document: string | null; position: string | null; bank_name: string | null; bank_account: string | null;
  days: number; salary_base: number; manual: Record<string, number>; items: Item[]; earnings: number; deductions: number; net: number; employer_cost: number; paid: number; notes: string | null };
type Detail = { run: Run & { notes: string | null; void_reason: string | null }; lines: Line[]; payments: Array<{ id: string; line_id: string; amount: number; method: string; reference: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null }> };

const RUN_STATUS: Record<RunStatus, { label: string; color: string; icon: string }> = {
  draft: { label: "Borrador", color: "#3987e5", icon: "📝" }, approved: { label: "Aprobada · por pagar", color: "#8b5cf6", icon: "✅" }, partial: { label: "Pago parcial", color: "#d95926", icon: "⏳" },
  paid: { label: "Pagada", color: "#22c55e", icon: "💸" }, void: { label: "Anulada", color: "#94a3b8", icon: "🚫" },
};
const CONTRACT: Record<string, string> = { indefinite: "Término indefinido", fixed: "Término fijo", work: "Obra o labor", service: "Prestación de servicios", apprentice: "Aprendiz", other: "Otro" };
const KIND_LABEL: Record<Concept["kind"], { label: string; icon: string }> = { earning: { label: "Devengos (suman)", icon: "➕" }, deduction: { label: "Deducciones (restan)", icon: "➖" }, employer: { label: "Aportes y provisiones del empleador", icon: "🏢" } };
const initials = (name: string) => name.split(" ").filter(Boolean).map((x) => x[0]).slice(0, 2).join("");

export function PayrollTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [view, setView] = useState<"runs" | "people" | "concepts">("runs");
  const [runs, setRuns] = useState<Run[]>([]);
  const [showVoid, setShowVoid] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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

  async function removeEmployee(e: Employee) {
    const reason = await askDelete(e.full_name, "Si ya tiene nóminas, se oculta y su historial se conserva.");
    if (!reason) return;
    const { data, error } = await supabaseBrowser().rpc("erp_employee_delete", { p_id: e.id });
    if (error) return fail(error);
    done("Empleado eliminado", (data as { hidden: boolean }).hidden ? "Sus nóminas anteriores se conservan." : undefined);
    onChanged();
  }

  const shownRuns = runs.filter((r) => showVoid || r.status !== "void");
  const voided = runs.length - runs.filter((r) => r.status !== "void").length;
  const tabs: Array<[typeof view, string, React.ReactNode]> = [["runs", "Nóminas", <FileSpreadsheet key="r" size={14} />], ["people", `Empleados (${employees.filter((e) => e.active).length})`, <Users key="p" size={14} />]];
  if (cat.can.payroll_approve && cat.can.madre) tabs.push(["concepts", "Conceptos", <Settings2 key="c" size={14} />]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
          {tabs.map(([k, l, icon]) => (
            <button key={k} type="button" onClick={() => setView(k)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={view === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{icon}{l}</button>
          ))}
        </div>
        <span className="flex-1" />
        {view === "runs" && cat.can.payroll ? <button type="button" onClick={() => setCreating(true)} className={primaryBtn} style={primaryBg}><FileSpreadsheet size={16} /> Nueva nómina</button> : null}
        {view === "people" && cat.can.payroll ? <button type="button" onClick={() => setEditingEmp("new")} className={primaryBtn} style={primaryBg}><UserPlus size={16} /> Empleado</button> : null}
      </div>

      {view === "runs" ? (
        <>
          {shownRuns.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-8 text-center" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-3xl">🧾</p>
              <p className="mt-2 font-bold">Aún no hay nóminas</p>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{employees.length ? "Toca «Nueva nómina» para calcular la del periodo." : "Primero agrega los empleados con su salario."}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {shownRuns.map((r) => {
                const st = RUN_STATUS[r.status];
                const pct = n(r.net) > 0 ? Math.min(100, (n(r.paid) / n(r.net)) * 100) : 0;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenRun(r.id)} className="w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5" style={{ ...cardStyle, opacity: r.status === "void" ? 0.55 : 1 }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xl">{st.icon}</span>
                        <b>Nómina #{r.number}</b>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${st.color} 18%, transparent)`, color: st.color }}>{st.label}</span>
                        <span className="ml-auto text-lg font-black tabular-nums">{cop(r.net)}</span>
                      </div>
                      <p className="mt-1 text-sm">{PERIOD_LABEL[r.period_kind]} · {fdate(r.period_start)} – {fdate(r.period_end)}</p>
                      <p className="text-xs" style={{ color: "var(--t-muted)" }}>👥 {r.employees} empleado{r.employees === 1 ? "" : "s"} · {r.point_name ?? "toda la tienda"} · costo total {cop(r.total_cost)}</p>
                      {r.status === "partial" || r.status === "paid" ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-sm" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}><div className="h-full rounded-sm" style={{ width: `${pct}%`, background: "#22c55e" }} /></div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {voided ? <button type="button" onClick={() => setShowVoid((v) => !v)} className="text-xs font-semibold underline" style={{ color: "var(--t-muted)" }}>{showVoid ? "Ocultar" : "Ver"} {voided} nómina{voided === 1 ? "" : "s"} anulada{voided === 1 ? "" : "s"}</button> : null}
        </>
      ) : view === "people" ? (
        employees.length === 0 ? (
          <div className="rounded-3xl border border-dashed p-8 text-center" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-3xl">👥</p>
            <p className="mt-2 font-bold">Sin empleados todavía</p>
            <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Agrégalos con su salario y cada cuánto se les paga.</p>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {employees.map((e) => (
              <li key={e.id} className="rounded-2xl border p-4" style={{ ...cardStyle, opacity: e.active ? 1 : 0.55 }}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}>{initials(e.full_name)}</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{e.full_name}</b>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>{e.position ?? "Sin cargo"} · {points.find((p) => p.id === e.point_id)?.name ?? "Madre"}</p>
                    <p className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                      <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>{PERIOD_LABEL[e.pay_frequency]}</span>
                      <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>{CONTRACT[e.contract_type] ?? e.contract_type}</span>
                      {e.transport_aid ? <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>🚌 Auxilio</span> : null}
                      {!e.active ? <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>Retirado</span> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <b className="block tabular-nums">{cop(e.base_salary)}</b>
                    <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>al mes</span>
                  </div>
                </div>
                {cat.can.payroll ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setEditingEmp(e)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Editar</button>
                    <button type="button" onClick={() => void removeEmployee(e)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)", color: "#e66767" }}><Trash2 size={12} /> Eliminar</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : (
        <ConceptsEditor storeId={storeId} concepts={cat.concepts ?? []} onChanged={onChanged} />
      )}

      <AnimatePresence>{creating ? <RunCreate key="new" storeId={storeId} points={visible} cat={cat} employees={employees} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void loadRuns(); setOpenRun(id); }} /> : null}</AnimatePresence>
      <AnimatePresence>{editingEmp ? <EmployeeForm key="emp" storeId={storeId} points={visible} cat={cat} initial={editingEmp === "new" ? null : editingEmp} onClose={() => setEditingEmp(null)} onSaved={() => { setEditingEmp(null); onChanged(); }} /> : null}</AnimatePresence>
      <AnimatePresence>{openRun ? <RunSheet key={openRun} id={openRun} cat={cat} onClose={() => setOpenRun(null)} onChanged={() => { void loadRuns(); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function RunCreate({ storeId, points, cat, employees, onClose, onCreated }: { storeId: string; points: Point[]; cat: Catalog; employees: Employee[]; onClose: () => void; onCreated: (id: string) => void }) {
  const kinds = [...new Set(employees.filter((e) => e.active).map((e) => e.pay_frequency))];
  const [kind, setKind] = useState<Period>(kinds[0] ?? "monthly");
  const [[start, end], setRange] = useState<[string, string]>(() => periodWindow(kinds[0] ?? "monthly"));
  const [point, setPoint] = useState(cat.can.madre ? "" : points[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const count = employees.filter((e) => e.active && e.pay_frequency === kind && (!point || e.point_id === point)).length;
  async function create() {
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_payroll_create", { p_store: storeId, p_point: point || null, p_kind: kind, p_start: start, p_end: end, p_notes: note || null });
    setSaving(false);
    if (error) return fail(error);
    const res = data as { id: string; employees: number; skipped: string[] };
    if (res.skipped?.length) void Swal.fire({ ...swalTheme, icon: "info", title: `Nómina con ${res.employees} empleados`, text: `No se incluyeron porque ya están en otra nómina del periodo: ${res.skipped.join(", ")}` });
    onCreated(res.id);
  }
  return (
    <Sheet title="Nueva nómina" subtitle="Calculamos el salario por días (meses de 30)" icon={<FileSpreadsheet size={18} />} onClose={onClose} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: count ? "var(--t-muted)" : "#eda100" }}>{count ? `👥 Incluirá a ${count} empleado${count === 1 ? "" : "s"}` : "⚠️ No hay empleados activos con ese tipo de pago"}</span>
        <button type="button" disabled={!count || !start || !end || end < start || saving} onClick={() => void create()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Calculando…" : "Crear y calcular"}</button>
      </>
    }>
      <div>
        <span className="mb-1.5 block text-xs font-bold">¿Qué nómina?</span>
        <ChoiceChips value={kind} onChange={(k) => { setKind(k); setRange(periodWindow(k)); }} options={(["monthly", "biweekly", "weekly"] as Period[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Desde"><DateField value={start} onChange={(v) => setRange([v, end])} /></Field>
        <Field label="Hasta"><DateField value={end} min={start} onChange={(v) => setRange([start, v])} /></Field>
      </div>
      {cat.can.madre || points.length > 1 ? (
        <div>
          <span className="mb-1.5 block text-xs font-bold">¿De quién?</span>
          <ChoiceChips value={point} onChange={setPoint} options={[...(cat.can.madre ? [{ value: "", label: "Toda la tienda", icon: <span>🏬</span> }] : []), ...points.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
      ) : null}
      <Field label="Nota (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: nómina de octubre" className={field} style={inputStyle} /></Field>
    </Sheet>
  );
}

function EmployeeForm({ storeId, points, cat, initial, onClose, onSaved }: { storeId: string; points: Point[]; cat: Catalog; initial: Employee | null; onClose: () => void; onSaved: () => void }) {
  const start = {
    full_name: initial?.full_name ?? "", document_type: initial?.document_type ?? "CC", document: initial?.document ?? "", position: initial?.position ?? "",
    contract_type: initial?.contract_type ?? "indefinite", base_salary: initial ? n(initial.base_salary) : (null as number | null), pay_frequency: (initial?.pay_frequency ?? "monthly") as Period,
    transport_aid: initial?.transport_aid ?? true, hired_on: initial?.hired_on ?? "", terminated_on: initial?.terminated_on ?? "", active: initial?.active ?? true,
    phone: initial?.phone ?? "", email: initial?.email ?? "", bank_name: initial?.bank_name ?? "", bank_account: initial?.bank_account ?? "", notes: initial?.notes ?? "",
    point_id: initial ? initial.point_id ?? "" : cat.can.madre ? "" : points[0]?.id ?? "",
  };
  const [f, setF] = useState(start);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: "full_name" | "document" | "position" | "phone" | "email" | "bank_name" | "bank_account" | "notes") => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value), className: field, style: inputStyle });
  const missing = f.full_name.trim().length < 2 ? "Escribe el nombre" : !(f.base_salary && f.base_salary > 0) ? "Escribe el salario" : null;
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_employee_save", { p_store: storeId, p_id: initial?.id ?? null, p_data: { ...f, base_salary: f.base_salary ?? 0 } });
    setSaving(false);
    if (error) return fail(error);
    done(initial ? "Empleado actualizado" : "Empleado creado");
    onSaved();
  }
  return (
    <Sheet title={initial ? "Editar empleado" : "Nuevo empleado"} subtitle="Los cambios de salario aplican a las nóminas nuevas" icon={<UserPlus size={18} />} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} footer={
      <>
        <span className="min-w-0 flex-1 text-xs" style={{ color: missing ? "#eda100" : "var(--t-muted)" }}>{missing ? `⚠️ ${missing}` : "✓ Listo para guardar"}</span>
        <button type="button" disabled={Boolean(missing) || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <Field label="Nombre completo"><input autoFocus {...text("full_name")} placeholder="Ej.: Ana Pérez" /></Field>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label="Documento">
          <select value={f.document_type} onChange={(e) => set("document_type", e.target.value)} className={field} style={inputStyle}>{["CC", "CE", "PPT", "PEP", "TI", "PAS", "NIT"].map((d) => <option key={d}>{d}</option>)}</select>
        </Field>
        <Field label="Número"><input inputMode="numeric" {...text("document")} /></Field>
      </div>
      <Field label="Cargo"><input {...text("position")} placeholder="Ej.: Vendedora" /></Field>
      <Field label="Salario mensual"><MoneyField big value={f.base_salary} onChange={(v) => set("base_salary", v)} /></Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Se le paga</span>
        <ChoiceChips value={f.pay_frequency} onChange={(v) => set("pay_frequency", v)} options={(Object.keys(PERIOD_LABEL) as Period[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))} />
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Contrato</span>
        <ChoiceChips value={f.contract_type} onChange={(v) => set("contract_type", v)} options={Object.entries(CONTRACT).map(([k, v]) => ({ value: k, label: v }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fecha de ingreso"><DateField value={f.hired_on} onChange={(v) => set("hired_on", v)} /></Field>
        <Field label="Fecha de retiro (si ya salió)"><DateField value={f.terminated_on} min={f.hired_on || undefined} onChange={(v) => set("terminated_on", v)} /></Field>
      </div>
      {points.length > 0 || cat.can.madre ? (
        <div>
          <span className="mb-1.5 block text-xs font-bold">¿Dónde trabaja?</span>
          <ChoiceChips value={f.point_id} onChange={(v) => set("point_id", v)} options={[...(cat.can.madre ? [{ value: "", label: "Madre", icon: <span>🏬</span> }] : []), ...points.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Teléfono"><input inputMode="tel" {...text("phone")} /></Field>
        <Field label="Banco"><input {...text("bank_name")} placeholder="Ej.: Bancolombia" /></Field>
        <Field label="Cuenta o Nequi"><input inputMode="numeric" {...text("bank_account")} /></Field>
      </div>
      <div className="space-y-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
        <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={f.transport_aid} onChange={(e) => set("transport_aid", e.target.checked)} className="h-5 w-5 accent-violet-500" /> 🚌 Recibe auxilio de transporte</label>
        <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} className="h-5 w-5 accent-violet-500" /> ✅ Activo (entra en las nóminas)</label>
      </div>
      <Field label="Notas (opcional)"><input {...text("notes")} /></Field>
    </Sheet>
  );
}

function RunSheet({ id, cat, onClose, onChanged }: { id: string; cat: Catalog; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [editLine, setEditLine] = useState<Line | null>(null);
  const [paying, setPaying] = useState<Line | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
  const anyPaid = d?.lines.some((l) => n(l.paid) > 0) ?? false;

  async function transition(action: "approve" | "reopen" | "void") {
    let note: string | null = "";
    if (action === "void") { note = await ask("¿Por qué anulas la nómina?"); if (!note) return; }
    else {
      const ok = await Swal.fire({ ...swalTheme, icon: "question", title: action === "approve" ? "¿Aprobar la nómina?" : "¿Volver a borrador?", text: action === "approve" ? "Después ya no se edita; queda lista para pagar." : "Podrás corregirla y volver a aprobarla.", showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No", reverseButtons: true });
      if (!ok.isConfirmed) return;
    }
    const { error } = await supabaseBrowser().rpc("erp_payroll_transition", { p_run: id, p_action: action, p_note: note || null });
    if (error) return fail(error);
    done(action === "approve" ? "Nómina aprobada" : action === "void" ? "Nómina anulada" : "Volvió a borrador");
    await after();
  }
  async function removeDraft() {
    const reason = await askDelete(`la nómina #${r?.number}`, "Es un borrador: se elimina por completo.");
    if (!reason) return;
    const { error } = await supabaseBrowser().rpc("erp_payroll_delete_draft", { p_run: id });
    if (error) return fail(error);
    done("Nómina eliminada");
    onChanged();
    onClose();
  }
  async function pay(l: Line, p: { amount: number; method: string; ref: string; key: string }) {
    const { error } = await supabaseBrowser().rpc("erp_payroll_pay", { p_line: l.id, p_amount: p.amount, p_method: p.method, p_reference: p.ref || null, p_paid_at: null, p_key: p.key });
    if (error) { fail(error); return false; }
    done("Pago registrado");
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
      [`RemHub · Nómina #${r.number}`, `${PERIOD_LABEL[r.period_kind]}: ${fdate(r.period_start)} a ${fdate(r.period_end)}`, `Estado: ${RUN_STATUS[r.status].label}`, `Generado: ${new Date().toLocaleString("es-CO")}`,
       "Valores calculados con los conceptos configurados en RemHub. Verifícalos con tu contador; no reemplaza la nómina electrónica DIAN."]);
  }

  return (
    <Sheet wide title={r ? `Nómina #${r.number} · ${PERIOD_LABEL[r.period_kind]}` : "Nómina"} icon={<FileSpreadsheet size={18} />}
      subtitle={r ? <><span style={{ color: RUN_STATUS[r.status].color, fontWeight: 700 }}>{RUN_STATUS[r.status].icon} {RUN_STATUS[r.status].label}</span> · {fdate(r.period_start)} – {fdate(r.period_end)} · preparó {r.created_by_name ?? "—"}{r.approved_by_name ? ` · aprobó ${r.approved_by_name}` : ""}</> : null}
      onClose={onClose} footer={r ? (
        <>
          <button type="button" onClick={exportCsv} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Planilla</button>
          {r.status === "draft" && (cat.can.payroll || cat.can.payroll_approve) ? <button type="button" onClick={() => void removeDraft()} className={ghostBtn} style={{ borderColor: "var(--t-card-border)", color: "#e66767" }}><Trash2 size={13} /> Eliminar</button> : null}
          {(r.status === "approved" || r.status === "partial") && cat.can.payroll_approve && !anyPaid ? <button type="button" onClick={() => void transition("reopen")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Undo2 size={13} /> Volver a borrador</button> : null}
          {r.status !== "void" && r.status !== "draft" && cat.can.payroll_approve && !anyPaid ? <button type="button" onClick={() => void transition("void")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><XCircle size={13} /> Anular</button> : null}
          <span className="flex-1" />
          {r.status === "draft" && cat.can.payroll_approve ? <button type="button" onClick={() => void transition("approve")} className={primaryBtn} style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><Check size={15} /> Aprobar</button> : null}
        </>
      ) : null}>
      {d && r ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["➕ Devengado", r.earnings, null], ["➖ Deducciones", r.deductions, null], ["💸 Neto a pagar", r.net, "#22c55e"], ["🏢 Costo total", r.total_cost, null]] as const).map(([l, v, c]) => (
              <div key={l} className="rounded-2xl border p-3" style={cardStyle}><p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{l}</p><p className="text-lg font-black tabular-nums" style={c ? { color: c } : undefined}>{cop(v)}</p></div>
            ))}
          </div>
          {r.void_reason ? <p className="text-sm text-red-400">🚫 Anulada: {r.void_reason}</p> : null}
          {r.status === "draft" ? <p className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">📝 Borrador: revisa a cada empleado (días, horas extra, comisiones…). Cuando esté bien, otra persona con permiso la aprueba.</p> : null}
          <ul className="space-y-2">
            {d.lines.map((l) => {
              const left = n(l.net) - n(l.paid);
              const isOpen = open === l.id;
              return (
                <li key={l.id} className="overflow-hidden rounded-2xl border" style={cardStyle}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} className="flex w-full items-center gap-3 p-3 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}>{initials(l.full_name)}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{l.full_name}</b>
                      <span className="text-xs" style={{ color: "var(--t-muted)" }}>{n(l.days)} días · devengado {cop(l.earnings)} · deducciones {cop(l.deductions)}</span>
                    </span>
                    <span className="text-right">
                      <b className="block text-lg tabular-nums">{cop(l.net)}</b>
                      {r.status !== "draft" ? <span className={`text-[11px] font-bold ${left <= 0 ? "text-emerald-400" : ""}`} style={left > 0 ? { color: "var(--t-muted)" } : undefined}>{left <= 0 && n(l.net) > 0 ? "✓ Pagado" : `falta ${cop(left)}`}</span> : null}
                    </span>
                    <ChevronDown size={16} className={isOpen ? "rotate-180 transition" : "transition"} />
                  </button>
                  {isOpen ? (
                    <div className="space-y-1 border-t px-4 py-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                      {l.items.filter((i) => n(i.amount) !== 0).map((i) => (
                        <div key={i.concept_id} className="flex items-baseline gap-2">
                          <span>{KIND_LABEL[i.kind].icon}</span>
                          <span className="min-w-0 flex-1 truncate">{i.name}{i.calc === "base_pct" ? <span className="text-xs" style={{ color: "var(--t-muted)" }}> · {n(i.value)} %</span> : null}</span>
                          <b className={`tabular-nums ${i.kind === "deduction" ? "text-red-400" : ""}`} style={i.kind === "employer" ? { color: "var(--t-muted)" } : undefined}>{i.kind === "deduction" ? "−" : ""}{cop(i.amount)}</b>
                        </div>
                      ))}
                      {l.bank_account ? <p className="pt-1 text-xs" style={{ color: "var(--t-muted)" }}>🏦 {l.bank_name ?? "Cuenta"} {l.bank_account}</p> : null}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                    {r.status === "draft" && cat.can.payroll ? <button type="button" onClick={() => setEditLine(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Días, horas extra, comisiones…</button> : null}
                    <span className="flex-1" />
                    {(r.status === "approved" || r.status === "partial") && cat.can.payroll_pay && left > 0 ? <button type="button" onClick={() => setPaying(l)} className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><Banknote size={13} /> Pagar</button> : null}
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
                    <b className={`tabular-nums ${p.voided ? "line-through" : ""}`}>{cop(p.amount)}</b>
                    <span>{d.lines.find((l) => l.id === p.line_id)?.full_name}</span>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{METHODS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""} · {new Date(p.paid_at).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {p.voided ? <span className="text-xs text-red-400">anulado: {p.void_reason}</span> : cat.can.payroll_approve ? <button type="button" onClick={() => void voidPay(p.id)} className="ml-auto text-xs font-bold underline">Anular</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Salario ÷ 30 × días. Verifícalo con tu contador; esto no reemplaza la nómina electrónica ante la DIAN.</p>
        </>
      ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>}
      <AnimatePresence>{editLine ? <LineEditor key={editLine.id} line={editLine} concepts={cat.concepts ?? []} onClose={() => setEditLine(null)} onSaved={() => { setEditLine(null); void after(); }} /> : null}</AnimatePresence>
      <PaymentSheet open={Boolean(paying)} title="Pago de nómina" who={paying ? `👤 ${paying.full_name}${paying.bank_account ? ` · ${paying.bank_name ?? ""} ${paying.bank_account}` : ""}` : ""} pending={paying ? n(paying.net) - n(paying.paid) : 0}
        onClose={() => setPaying(null)} onConfirm={(p) => (paying ? pay(paying, p) : Promise.resolve(false))} />
    </Sheet>
  );
}

function LineEditor({ line, concepts, onClose, onSaved }: { line: Line; concepts: Concept[]; onClose: () => void; onSaved: () => void }) {
  const manual = useMemo(() => concepts.filter((c) => c.active && c.calc === "manual"), [concepts]);
  const start = { days: n(line.days) as number | null, vals: Object.fromEntries(manual.map((c) => [c.id, line.manual?.[c.id] ? Number(line.manual[c.id]) : null])) as Record<string, number | null> };
  const [f, setF] = useState(start);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const m = Object.fromEntries(Object.entries(f.vals).filter(([, v]) => (v ?? 0) > 0));
    const { error } = await supabaseBrowser().rpc("erp_payroll_line_update", { p_line: line.id, p_days: f.days ?? 0, p_manual: m, p_notes: null });
    setSaving(false);
    if (error) return fail(error);
    onSaved();
  }
  return (
    <Sheet title={line.full_name} subtitle={`Salario mensual ${cop(line.salary_base)} · ${cop(Math.round(n(line.salary_base) / 30))} por día`} icon={<Pencil size={18} />} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><span className="flex-1" /><button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Calculando…" : "Guardar y recalcular"}</button></>}>
      <Field label="Días trabajados" hint="Máximo 30. Ej.: 30 si trabajó todo el mes, 15 si entró a mitad."><NumberField value={f.days} onChange={(v) => setF({ ...f, days: v })} min={0} max={30} decimals={1} suffix="días" align="left" /></Field>
      {(["earning", "deduction", "employer"] as const).map((k) => manual.filter((c) => c.kind === k).length ? (
        <div key={k} className="space-y-2">
          <p className={label} style={{ color: "var(--t-muted)" }}>{KIND_LABEL[k].icon} {KIND_LABEL[k].label}</p>
          {manual.filter((c) => c.kind === k).map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-sm font-semibold">{c.name}</span>
              <div className="w-44"><MoneyField value={f.vals[c.id] ?? null} onChange={(v) => setF({ ...f, vals: { ...f.vals, [c.id]: v } })} placeholder="$ 0" ariaLabel={c.name} /></div>
            </div>
          ))}
        </div>
      ) : null)}
    </Sheet>
  );
}

function ConceptsEditor({ storeId, concepts, onChanged }: { storeId: string; concepts: Concept[]; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [adding, setAdding] = useState(false);
  async function save(c: Concept, patch: Partial<Concept>) {
    const { error } = await supabaseBrowser().rpc("erp_payroll_concept_save", { p_store: storeId, p_id: c.id, p_name: patch.name ?? null, p_kind: null, p_calc: null, p_value: patch.value ?? null,
      p_in_base: patch.in_base ?? null, p_incl_transport: patch.base_includes_transport ?? null, p_active: patch.active ?? null });
    if (error) return fail(error);
    setVals((v) => { const x = { ...v }; delete x[c.id]; return x; });
    done("Concepto actualizado");
    onChanged();
  }
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <Settings2 size={16} className="mt-0.5 shrink-0" />
        <span>Los porcentajes y valores son <b>ejemplos editables</b>. Confírmalos con tu contador y actualiza el <b>auxilio de transporte</b> cada año. Los aportes del empleador vienen apagados.</span>
      </p>
      <div className="flex justify-end"><button type="button" onClick={() => setAdding(true)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Concepto</button></div>
      {(["earning", "deduction", "employer"] as const).map((k) => (
        <section key={k} className="rounded-2xl border p-3" style={cardStyle}>
          <p className={`${label} mb-2`} style={{ color: "var(--t-muted)" }}>{KIND_LABEL[k].icon} {KIND_LABEL[k].label}</p>
          <ul className="space-y-1.5">
            {concepts.filter((c) => c.kind === k).map((c) => {
              const editable = c.calc === "base_pct" || c.calc === "fixed" || c.calc === "transport";
              const changed = c.id in vals && vals[c.id] !== n(c.value);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)", opacity: c.active ? 1 : 0.6 }}>
                  <span className="min-w-0 flex-1">
                    <b className="block">{c.name}</b>
                    <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{c.calc === "salary" ? "Salario ÷ 30 × días" : c.calc === "transport" ? "Valor mensual ÷ 30 × días (a quien lo tenga)" : c.calc === "base_pct" ? `% de la base${c.base_includes_transport ? " + auxilio" : ""}` : c.calc === "fixed" ? "Valor fijo por nómina" : "Se escribe en cada nómina"}{c.note ? ` · ${c.note}` : ""}</span>
                  </span>
                  {editable ? (
                    <div className="w-36">
                      {c.calc === "base_pct"
                        ? <NumberField value={c.id in vals ? vals[c.id] : n(c.value)} onChange={(v) => setVals({ ...vals, [c.id]: v })} suffix="%" decimals={3} min={0} max={100} ariaLabel={`Porcentaje ${c.name}`} />
                        : <MoneyField value={c.id in vals ? vals[c.id] : n(c.value)} onChange={(v) => setVals({ ...vals, [c.id]: v })} ariaLabel={`Valor ${c.name}`} />}
                    </div>
                  ) : null}
                  {changed ? <button type="button" onClick={() => void save(c, { value: vals[c.id] ?? 0 })} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}><Check size={12} /> Guardar</button> : null}
                  {c.calc !== "salary" ? (
                    <button type="button" onClick={() => void save(c, { active: !c.active })} className="rounded-full px-3 py-1.5 text-xs font-bold" style={c.active ? { background: "#22c55e", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{c.active ? "✓ Activo" : "Apagado"}</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <AnimatePresence>{adding ? <ConceptForm key="cf" storeId={storeId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function ConceptForm({ storeId, onClose, onSaved }: { storeId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", kind: "earning" as Concept["kind"], calc: "manual" as "manual" | "fixed" | "base_pct", value: null as number | null });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_payroll_concept_save", { p_store: storeId, p_id: null, p_name: f.name, p_kind: f.kind, p_calc: f.calc, p_value: f.value ?? 0, p_in_base: f.kind === "earning" && f.calc === "manual", p_incl_transport: false, p_active: true });
    setSaving(false);
    if (error) return fail(error);
    done("Concepto creado");
    onSaved();
  }
  return (
    <Sheet title="Nuevo concepto de nómina" icon={<Plus size={18} />} onClose={onClose} dirty={f.name !== "" || f.value !== null} footer={
      <><span className="flex-1" /><button type="button" disabled={f.name.trim().length < 2 || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> Crear</button></>
    }>
      <Field label="Nombre"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Bono de puntualidad" className={field} style={inputStyle} /></Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">¿Qué hace?</span>
        <ChoiceChips value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={(Object.keys(KIND_LABEL) as Concept["kind"][]).map((k) => ({ value: k, label: KIND_LABEL[k].label, icon: <span>{KIND_LABEL[k].icon}</span> }))} />
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-bold">¿Cómo se calcula?</span>
        <ChoiceChips value={f.calc} onChange={(v) => setF({ ...f, calc: v, value: null })} options={[{ value: "manual", label: "Lo escribo en cada nómina" }, { value: "fixed", label: "Valor fijo" }, { value: "base_pct", label: "% de la base (IBC)" }]} />
      </div>
      {f.calc === "fixed" ? <Field label="Valor"><MoneyField value={f.value} onChange={(v) => setF({ ...f, value: v })} /></Field> : null}
      {f.calc === "base_pct" ? <Field label="Porcentaje"><NumberField value={f.value} onChange={(v) => setF({ ...f, value: v })} suffix="%" decimals={3} min={0} max={100} align="left" /></Field> : null}
    </Sheet>
  );
}
