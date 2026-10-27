"use client";

import { BankSelect, NO_AUTOFILL } from "@/components/forms/BankSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { DateField } from "@/components/forms/Fields";
import { errorText, fiscalApi, fiscalRpc } from "@/lib/fiscal/client";
import {
  CONTRACT_TYPES, EMPTY_EPAYROLL, ID_TYPES, OVERTIME, PAYMENT_METHODS, WORKER_TYPES,
  epayrollProblems, epayrollTotals, prefillFromInternal, profileFromEmployee,
  type EPayrollData, type EPayrollProfile, type OvertimeType,
} from "@/lib/fiscal/epayroll";
import { MoneyInput } from "../MoneyInput";
import { Modal } from "../inventario/dialog";

/**
 * Nómina electrónica (DIAN) — módulo APARTE de la nómina interna (Gastos y nómina).
 * Un documento por trabajador y mes, transmitido por Alanube. Se puede llenar a mano o traer lo aprobado
 * en la nómina interna del mes; siempre se revisa antes de enviar.
 */

type Doc = { id: string; kind: "individual" | "replace" | "cancel"; status: string; prefix: string | null; number: number | null; devengados: number; deducciones: number; total: number; cune: string | null; dian_message: string | null; error_message: string | null; data: Partial<EPayrollData>; related_id: string | null };
type Emp = { id: string; full_name: string; document_type: string | null; document: string | null; position: string | null; contract_type: string | null; base_salary: number; pay_frequency: string | null; transport_aid: boolean; hired_on: string | null; terminated_on: string | null; bank_name: string | null; bank_account: string | null; profile: Partial<EPayrollProfile>; docs: Doc[] };
type Settings = { fiscal_entity_id: string | null; provider_account_id: string | null; environment: "sandbox" | "production"; prefix: string; next_number: number; adjust_prefix: string; adjust_next: number; city_code: string | null; address: string | null; payment_method: string };
type Overview = { ok: boolean; message?: string; period: string; settings: Settings | null; entities: Array<{ id: string; legal_name: string; document_number: string }>; accounts: Array<{ id: string; label: string; provider: string; environment: string; fiscal_entity_id: string }>; employees: Emp[] };

const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const input = "w-full rounded-xl border px-3 py-2 text-sm outline-none";
const inputStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const money = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Borrador", "#94a3b8"], QUEUED: ["En cola", "#0ea5e9"], PROCESSING: ["Enviando", "#0ea5e9"], SENT: ["Esperando a la DIAN", "#0ea5e9"],
  ACCEPTED: ["Aceptada", "#22c55e"], REJECTED: ["Rechazada", "#ef4444"], ERROR: ["Error de envío", "#f59e0b"], REPLACED: ["Reemplazada", "#94a3b8"], CANCELLED: ["Anulada", "#94a3b8"],
};
const KIND: Record<Doc["kind"], string> = { individual: "Nómina", replace: "Reemplazo", cancel: "Anulación" };

function prevMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function EPayrollPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [period, setPeriod] = useState(prevMonth);
  const [o, setO] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<{ emp: Emp; adjust?: Doc } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return setDenied("No tienes una tienda abierta.");
      if (!hasStorePermission(a, "payroll_electronic")) return setDenied("Necesitas el permiso «Nómina electrónica (DIAN)». Es aparte del permiso de nómina interna.");
      setStoreId(a.store.id);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    try {
      const r = await fiscalRpc<Overview>("erp_epayroll_overview", { p_store: storeId, p_period: period });
      setO(r);
      if (!r.settings) setShowSettings(true);
    } catch (e) {
      setO({ ok: false, message: /20261027/.test(errorText(e)) ? "Falta ejecutar la migración 20261250_nomina_electronica.sql en Supabase." : errorText(e) } as Overview);
    }
  }, [storeId, period]);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(doc: Doc, action: "send" | "status" = "send") {
    setBusy(doc.id);
    try {
      if (action === "send" && ["DRAFT", "REJECTED", "ERROR"].includes(doc.status)) await fiscalRpc("erp_epayroll_queue", { p_doc: doc.id });
      const r = await fiscalApi<{ result: { ok: boolean; status: string; message: string } }>("/api/fiscal/payroll", { doc_id: doc.id, action });
      void Swal.fire({ ...swal, icon: r.result.status === "ACCEPTED" ? "success" : r.result.ok ? "info" : "warning", title: STATUS[r.result.status]?.[0] ?? r.result.status, text: r.result.message });
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo enviar", text: errorText(e) });
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function cancelDoc(doc: Doc, emp: Emp) {
    const ask = await Swal.fire({ ...swal, icon: "warning", title: `Anular la nómina de ${emp.full_name}`, text: "Se transmite a la DIAN una nota de ajuste de eliminación. Úsala solo si esa nómina no debió existir.", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
    if (!ask.isConfirmed) return;
    try {
      const r = await fiscalRpc<{ id: string }>("erp_epayroll_adjust", { p_doc: doc.id, p_kind: "cancel", p_data: null, p_totals: null });
      await send({ ...doc, id: r.id, status: "QUEUED" });
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo anular", text: errorText(e) });
    }
  }

  if (denied) return <p className="rounded-2xl border p-5 text-sm" style={card}>🔒 {denied}</p>;
  if (!o) return <p className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;
  if (!o.ok) return <p className="rounded-2xl border p-5 text-sm" style={card}>🔒 {o.message}</p>;

  const [y, m] = period.split("-").map(Number);
  const accepted = o.employees.filter((e) => e.docs.some((d) => d.kind === "individual" && ["ACCEPTED", "REPLACED"].includes(d.status))).length;

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border p-5" style={card}>
        <h1 className="text-xl font-black">🧾 Nómina electrónica (DIAN)</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Aparte de la nómina interna: aquí se transmite a la DIAN un documento por trabajador y por mes (se presenta a más tardar en los primeros días hábiles del mes siguiente).
          Puedes traer lo aprobado en «Gastos y nómina» o llenarlo a mano; la nómina interna no cambia.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={`${input} w-auto`} style={inputStyle} value={m} onChange={(e) => setPeriod(`${y}-${String(e.target.value).padStart(2, "0")}-01`)} aria-label="Mes">
            {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
          <select className={`${input} w-auto`} style={inputStyle} value={y} onChange={(e) => setPeriod(`${e.target.value}-${String(m).padStart(2, "0")}-01`)} aria-label="Año">
            {[y - 1, y, y + 1].filter((x) => x <= new Date().getFullYear()).map((yy) => <option key={yy} value={yy}>{yy}</option>)}
          </select>
          <span className="text-sm font-bold">{accepted} de {o.employees.length} aceptadas</span>
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="ml-auto rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>⚙️ Empleador y Alanube</button>
        </div>
      </section>

      {showSettings ? <SettingsCard storeId={storeId!} o={o} onSaved={() => { setShowSettings(false); void load(); }} /> : null}

      <section className="space-y-2">
        {o.employees.length === 0 ? <p className="rounded-2xl border p-5 text-sm" style={card}>No hay trabajadores. Créalos en Gastos y nómina → Empleados.</p> : null}
        {o.employees.map((e) => {
          const main = e.docs.find((d) => d.kind === "individual");
          const last = e.docs.at(-1);
          const st = last ? STATUS[last.status] : null;
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm" style={card}>
              <div className="min-w-0 flex-1">
                <b className="block">{e.full_name}</b>
                <span className="text-xs" style={{ color: "var(--t-muted)" }}>{e.document_type ?? "CC"} {e.document ?? "sin documento"} · {e.position ?? "—"} · salario {money(e.base_salary)}</span>
                {e.docs.map((d) => (
                  <span key={d.id} className="block text-xs">
                    {KIND[d.kind]} {d.prefix ?? ""}{d.number ?? ""} · <b style={{ color: STATUS[d.status]?.[1] }}>{STATUS[d.status]?.[0] ?? d.status}</b> · neto {money(d.total)}
                    {d.error_message || (d.status === "REJECTED" && d.dian_message) ? <span className="block" style={{ color: "#ef4444" }}>{d.error_message ?? d.dian_message}</span> : null}
                  </span>
                ))}
              </div>
              {st ? <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: `color-mix(in oklab, ${st[1]} 18%, transparent)`, color: st[1] }}>{st[0]}</span> : <span className="text-xs" style={{ color: "var(--t-muted)" }}>Sin preparar</span>}
              <div className="flex flex-wrap gap-2">
                {!main || ["DRAFT", "REJECTED", "ERROR"].includes(main.status) ? (
                  <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => setEditing({ emp: e })}>{main ? "✏️ Editar" : "📝 Preparar"}</button>
                ) : null}
                {last && ["DRAFT", "REJECTED", "ERROR", "QUEUED"].includes(last.status) ? (
                  <button type="button" disabled={busy === last.id} className="rounded-full px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#16a34a" }} onClick={() => void send(last)}>{busy === last.id ? "Enviando…" : "📤 Enviar a la DIAN"}</button>
                ) : null}
                {last && ["SENT", "PROCESSING"].includes(last.status) ? (
                  <button type="button" disabled={busy === last.id} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void send(last, "status")}>🔄 Consultar</button>
                ) : null}
                {last && last.status === "ACCEPTED" && last.kind !== "cancel" ? (
                  <>
                    <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => setEditing({ emp: e, adjust: last })}>♻️ Reemplazar</button>
                    <button type="button" className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#ef4444", color: "#ef4444" }} onClick={() => void cancelDoc(last, e)}>Anular</button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      {editing ? <Editor storeId={storeId!} period={period} emp={editing.emp} adjust={editing.adjust} onClose={() => setEditing(null)} onSaved={(doc, sendNow) => { setEditing(null); if (sendNow && doc) void send(doc); else void load(); }} /> : null}
    </main>
  );
}

function SettingsCard({ storeId, o, onSaved }: { storeId: string; o: Overview; onSaved: () => void }) {
  const s = o.settings;
  const [f, setF] = useState({
    fiscal_entity_id: s?.fiscal_entity_id ?? o.entities[0]?.id ?? "", provider_account_id: s?.provider_account_id ?? "", environment: s?.environment ?? "sandbox",
    prefix: s?.prefix ?? "NE", next_number: String(s?.next_number ?? 1), adjust_prefix: s?.adjust_prefix ?? "NA", adjust_next: String(s?.adjust_next ?? 1),
    city_code: s?.city_code ?? "", address: s?.address ?? "", payment_method: s?.payment_method ?? "47",
  });
  const accounts = o.accounts.filter((a) => a.provider === "alegra" && (!f.fiscal_entity_id || a.fiscal_entity_id === f.fiscal_entity_id));
  const set = (k: keyof typeof f, v: string) => setF((c) => ({ ...c, [k]: v }));
  async function save() {
    try {
      await fiscalRpc("erp_epayroll_settings_save", { p_store: storeId, p_data: { ...f, next_number: Number(f.next_number) || 1, adjust_next: Number(f.adjust_next) || 1 } });
      void Swal.fire({ ...swal, icon: "success", title: "Guardado", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: errorText(e) });
    }
  }
  return (
    <section className="space-y-3 rounded-3xl border p-5 text-sm" style={card}>
      <h2 className="font-black">⚙️ Empleador y Alanube</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-bold">Empleador (NIT que reporta)
          <select className={`${input} mt-1`} style={inputStyle} value={f.fiscal_entity_id} onChange={(e) => set("fiscal_entity_id", e.target.value)}>
            <option value="">Elige…</option>
            {o.entities.map((x) => <option key={x.id} value={x.id}>{x.legal_name} · {x.document_number}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold">Cuenta de Alanube
          <select className={`${input} mt-1`} style={inputStyle} value={f.provider_account_id} onChange={(e) => set("provider_account_id", e.target.value)}>
            <option value="">Elige…</option>
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.environment === "sandbox" ? "pruebas" : "producción"})</option>)}
          </select>
          {!accounts.length ? <span className="mt-0.5 block font-normal" style={{ color: "#f59e0b" }}>Crea la cuenta de Alanube en Factura electrónica → Proveedor.</span> : null}
        </label>
        <label className="text-xs font-bold">Ambiente
          <select className={`${input} mt-1`} style={inputStyle} value={f.environment} onChange={(e) => set("environment", e.target.value)}>
            <option value="sandbox">Pruebas (habilitación)</option><option value="production">Producción (DIAN real)</option>
          </select>
        </label>
        <label className="text-xs font-bold">Municipio del empleador (código DANE)<input className={`${input} mt-1`} style={inputStyle} inputMode="numeric" placeholder="05001" value={f.city_code} onChange={(e) => set("city_code", e.target.value.replace(/\D/g, "").slice(0, 5))} /></label>
        <label className="text-xs font-bold sm:col-span-2">Dirección del empleador<input className={`${input} mt-1`} style={inputStyle} value={f.address} onChange={(e) => set("address", e.target.value)} /></label>
        <label className="text-xs font-bold">Prefijo / siguiente número
          <span className="mt-1 grid grid-cols-2 gap-2"><input className={input} style={inputStyle} value={f.prefix} onChange={(e) => set("prefix", e.target.value.toUpperCase().slice(0, 4))} /><input className={input} style={inputStyle} inputMode="numeric" value={f.next_number} onChange={(e) => set("next_number", e.target.value.replace(/\D/g, ""))} /></span>
        </label>
        <label className="text-xs font-bold">Prefijo / número de ajustes
          <span className="mt-1 grid grid-cols-2 gap-2"><input className={input} style={inputStyle} value={f.adjust_prefix} onChange={(e) => set("adjust_prefix", e.target.value.toUpperCase().slice(0, 4))} /><input className={input} style={inputStyle} inputMode="numeric" value={f.adjust_next} onChange={(e) => set("adjust_next", e.target.value.replace(/\D/g, ""))} /></span>
        </label>
        <label className="text-xs font-bold">Forma de pago habitual
          <select className={`${input} mt-1`} style={inputStyle} value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>Antes de producción, habilita la nómina electrónica con la DIAN desde Factura electrónica → Proveedor → «Habilitación automática» (marca «Nómina electrónica»). El consecutivo nunca baja.</p>
      <button type="button" onClick={() => void save()} className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-accent)" }}>Guardar</button>
    </section>
  );
}

function Num({ label, value, onChange, money: isMoney = true }: { label: string; value: number; onChange: (v: number) => void; money?: boolean }) {
  return (
    <label className="text-xs font-bold">{label}
      {isMoney
        ? <MoneyInput className={`${input} mt-1`} style={inputStyle} value={value || null} allowEmpty onValueChange={(v) => onChange(v ?? 0)} />
        : <input className={`${input} mt-1`} style={inputStyle} inputMode="decimal" value={value || ""} onChange={(e) => onChange(Number(e.target.value.replace(",", ".")) || 0)} />}
    </label>
  );
}

function Editor({ storeId, period, emp, adjust, onClose, onSaved }: { storeId: string; period: string; emp: Emp; adjust?: Doc; onClose: () => void; onSaved: (doc: Doc | null, sendNow: boolean) => void }) {
  const current = adjust ?? emp.docs.find((d) => d.kind === "individual");
  const [d, setD] = useState<EPayrollData>(() => ({ ...EMPTY_EPAYROLL, ...(current?.data ?? {}) } as EPayrollData));
  const [p, setP] = useState<EPayrollProfile>(() => profileFromEmployee(emp, emp.profile));
  const [review, setReview] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const totals = useMemo(() => epayrollTotals(d), [d]);
  const problems = useMemo(() => epayrollProblems(d, p), [d, p]);
  const set = <K extends keyof EPayrollData>(k: K, v: EPayrollData[K]) => setD((c) => ({ ...c, [k]: v }));
  const setPr = <K extends keyof EPayrollProfile>(k: K, v: EPayrollProfile[K]) => setP((c) => ({ ...c, [k]: v }));

  async function bring() {
    try {
      const r = await fiscalRpc<{ items: Array<{ code: string; name: string; kind: string; value: number | null; amount: number }>; days: number; payment_dates: string[]; runs: unknown[] }>("erp_epayroll_prefill", { p_store: storeId, p_employee: emp.id, p_period: period });
      if (!r.runs.length) return void Swal.fire({ ...swal, icon: "info", title: "Sin nómina interna aprobada", text: "No hay nóminas aprobadas de este trabajador en ese mes. Llena los valores a mano." });
      const { data, review: rv } = prefillFromInternal(r.items, r.days, r.payment_dates);
      setD(data);
      setReview(rv);
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo traer", text: errorText(e) });
    }
  }

  async function save(sendNow: boolean) {
    setBusy(true);
    try {
      await fiscalRpc("erp_epayroll_profile_save", { p_store: storeId, p_employee: emp.id, p_data: p });
      let doc: Doc | null = null;
      if (adjust) {
        const r = await fiscalRpc<{ id: string }>("erp_epayroll_adjust", { p_doc: adjust.id, p_kind: "replace", p_data: d, p_totals: totals });
        doc = { ...adjust, id: r.id, kind: "replace", status: "QUEUED" };
      } else {
        const r = await fiscalRpc<{ id: string; status: string }>("erp_epayroll_doc_save", { p_store: storeId, p_employee: emp.id, p_period: period, p_data: d, p_totals: totals });
        doc = { ...(current ?? ({} as Doc)), id: r.id, kind: "individual", status: r.status };
      }
      onSaved(doc, sendNow);
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const sel = (label: string, value: string, opts: Array<[string, string]>, onChange: (v: string) => void) => (
    <label className="text-xs font-bold">{label}<select className={`${input} mt-1`} style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  );
  const txt = (label: string, k: keyof EPayrollProfile, extra: { numeric?: boolean; placeholder?: string } = {}) => (
    <label className="text-xs font-bold">{label}<input className={`${input} mt-1`} style={inputStyle} name={`trabajador-${k}`} {...NO_AUTOFILL} inputMode={extra.numeric ? "numeric" : undefined} placeholder={extra.placeholder} value={String(p[k] ?? "")} onChange={(e) => setPr(k, (extra.numeric ? e.target.value.replace(/\D/g, "") : e.target.value) as never)} /></label>
  );

  return (
    <Modal wide title={`${adjust ? "♻️ Reemplazar" : "🧾"} Nómina electrónica · ${emp.full_name}`} subtitle={`${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)} · aparte de la nómina interna`} onClose={onClose}
      footer={<>
        <button type="button" className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={onClose}>Cancelar</button>
        {!adjust ? <button type="button" disabled={busy} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void save(false)}>Guardar borrador</button> : null}
        <button type="button" disabled={busy || problems.length > 0} className="rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#16a34a" }} onClick={() => void save(true)}>{adjust ? "Reemplazar y enviar" : "Guardar y enviar"}</button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} onClick={() => void bring()}>⬇️ Traer de la nómina interna del mes</button>
        <span className="text-xs" style={{ color: "var(--t-muted)" }}>Suma lo aprobado del mes; revísalo antes de enviar.</span>
      </div>
      {review.length ? <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "#f59e0b" }}>{review.map((r) => <p key={r}>⚠️ {r}</p>)}</div> : null}

      <details className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }} open={!emp.profile?.city_code}>
        <summary className="cursor-pointer text-sm font-black">Datos DIAN del trabajador</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {txt("Primer nombre", "first_name")}{txt("Otros nombres", "other_names")}{txt("Primer apellido", "last_name")}{txt("Segundo apellido", "second_last_name")}
          {sel("Tipo de documento", p.doc_type, ID_TYPES, (v) => setPr("doc_type", v))}
          {sel("Tipo de trabajador", p.worker_type, WORKER_TYPES, (v) => setPr("worker_type", v))}
          {sel("Tipo de contrato", p.contract_type, CONTRACT_TYPES, (v) => setPr("contract_type", v))}
          {sel("Forma de pago", p.payment_method, PAYMENT_METHODS, (v) => setPr("payment_method", v))}
          {txt("Municipio donde trabaja (DANE)", "city_code", { numeric: true, placeholder: "05001" })}
          {txt("Dirección del trabajador", "address")}
          <label className="text-xs font-bold">Banco<span className="mt-1 block"><BankSelect value={p.bank} onChange={(v) => setPr("bank", v)} className={input} style={inputStyle} /></span></label>{txt("Número de cuenta", "account_number", { numeric: true })}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.integral} onChange={(e) => setPr("integral", e.target.checked)} /> Salario integral</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.high_risk} onChange={(e) => setPr("high_risk", e.target.checked)} /> Alto riesgo de pensión</label>
        </div>
      </details>

      <div>
        <p className="mb-2 text-sm font-black">Devengados</p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Num label="Días trabajados" money={false} value={d.days} onChange={(v) => set("days", Math.min(30, v))} />
          <Num label="Sueldo trabajado" value={d.salary} onChange={(v) => set("salary", v)} />
          <Num label="Auxilio de transporte" value={d.transport} onChange={(v) => set("transport", v)} />
          <Num label="Comisiones" value={d.commissions} onChange={(v) => set("commissions", v)} />
          <Num label="Bonificación salarial" value={d.bonus_s} onChange={(v) => set("bonus_s", v)} />
          <Num label="Bonificación no salarial" value={d.bonus_ns} onChange={(v) => set("bonus_ns", v)} />
          <Num label="Auxilio salarial" value={d.aid_s} onChange={(v) => set("aid_s", v)} />
          <Num label="Auxilio no salarial" value={d.aid_ns} onChange={(v) => set("aid_ns", v)} />
          <Num label="Días de vacaciones" money={false} value={d.vacation_days} onChange={(v) => set("vacation_days", v)} />
          <Num label="Pago de vacaciones" value={d.vacation} onChange={(v) => set("vacation", v)} />
          <Num label="Días de prima" money={false} value={d.prima_days} onChange={(v) => set("prima_days", v)} />
          <Num label="Prima" value={d.prima} onChange={(v) => set("prima", v)} />
          <Num label="Cesantías pagadas" value={d.cesantias} onChange={(v) => set("cesantias", v)} />
          <Num label="Intereses de cesantías" value={d.cesantias_interest} onChange={(v) => set("cesantias_interest", v)} />
          <Num label="Días de licencia remunerada" money={false} value={d.paid_leave_days} onChange={(v) => set("paid_leave_days", v)} />
          <Num label="Pago de licencia" value={d.paid_leave} onChange={(v) => set("paid_leave", v)} />
        </div>
        <Rows title="Horas extra y recargos" rows={d.overtime} empty={{ type: "HED" as OvertimeType, hours: 0, amount: 0 }} onChange={(rows) => set("overtime", rows)}
          render={(r, upd) => (<>
            <select className={input} style={inputStyle} value={r.type} onChange={(e) => upd({ type: e.target.value as OvertimeType })}>{(Object.keys(OVERTIME) as OvertimeType[]).map((t) => <option key={t} value={t}>{OVERTIME[t].label}</option>)}</select>
            <input className={input} style={inputStyle} inputMode="decimal" placeholder="Horas" value={r.hours || ""} onChange={(e) => upd({ hours: Number(e.target.value.replace(",", ".")) || 0 })} />
            <MoneyInput className={input} style={inputStyle} value={r.amount || null} allowEmpty onValueChange={(v) => upd({ amount: v ?? 0 })} />
          </>)} />
        <Rows title="Incapacidades" rows={d.disabilities} empty={{ type: "1" as const, days: 0, amount: 0 }} onChange={(rows) => set("disabilities", rows)}
          render={(r, upd) => (<>
            <select className={input} style={inputStyle} value={r.type} onChange={(e) => upd({ type: e.target.value as "1" | "2" | "3" })}><option value="1">Común</option><option value="2">Profesional</option><option value="3">Laboral</option></select>
            <input className={input} style={inputStyle} inputMode="numeric" placeholder="Días" value={r.days || ""} onChange={(e) => upd({ days: Number(e.target.value) || 0 })} />
            <MoneyInput className={input} style={inputStyle} value={r.amount || null} allowEmpty onValueChange={(v) => upd({ amount: v ?? 0 })} />
          </>)} />
        <Rows title="Otros pagos" rows={d.others} empty={{ description: "", salary: true, amount: 0 }} onChange={(rows) => set("others", rows)}
          render={(r, upd) => (<>
            <input className={input} style={inputStyle} placeholder="Concepto" value={r.description} onChange={(e) => upd({ description: e.target.value })} />
            <select className={input} style={inputStyle} value={r.salary ? "s" : "ns"} onChange={(e) => upd({ salary: e.target.value === "s" })}><option value="s">Salarial</option><option value="ns">No salarial</option></select>
            <MoneyInput className={input} style={inputStyle} value={r.amount || null} allowEmpty onValueChange={(v) => upd({ amount: v ?? 0 })} />
          </>)} />
      </div>

      <div>
        <p className="mb-2 text-sm font-black">Deducciones</p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Num label="% salud" money={false} value={d.health_pct} onChange={(v) => set("health_pct", v)} />
          <Num label="Salud" value={d.health} onChange={(v) => set("health", v)} />
          <Num label="% pensión" money={false} value={d.pension_pct} onChange={(v) => set("pension_pct", v)} />
          <Num label="Pensión" value={d.pension} onChange={(v) => set("pension", v)} />
          <Num label="% fondo de solidaridad" money={false} value={d.fsp_pct} onChange={(v) => set("fsp_pct", v)} />
          <Num label="Fondo de solidaridad" value={d.fsp} onChange={(v) => set("fsp", v)} />
          <Num label="Anticipos" value={d.advances} onChange={(v) => set("advances", v)} />
          <Num label="Préstamos y vales" value={d.debt} onChange={(v) => set("debt", v)} />
          <Num label="Retención en la fuente" value={d.withholding} onChange={(v) => set("withholding", v)} />
          <Num label="Otras deducciones" value={d.other_deductions} onChange={(v) => set("other_deductions", v)} />
        </div>
        <Rows title="Libranzas" rows={d.libranzas} empty={{ description: "", amount: 0 }} onChange={(rows) => set("libranzas", rows)}
          render={(r, upd) => (<>
            <input className={input} style={inputStyle} placeholder="Entidad" value={r.description} onChange={(e) => upd({ description: e.target.value })} />
            <span />
            <MoneyInput className={input} style={inputStyle} value={r.amount || null} allowEmpty onValueChange={(v) => upd({ amount: v ?? 0 })} />
          </>)} />
      </div>

      <div>
        <p className="mb-1 text-sm font-black">Fechas de pago</p>
        <div className="flex flex-wrap items-center gap-2">
          {d.payment_dates.map((x, i) => (
            <span key={i} className="flex items-center gap-1">
              <DateField compact value={x} onChange={(v) => set("payment_dates", d.payment_dates.map((y, j) => (j === i ? v : y)))} ariaLabel="Fecha de pago" />
              <button type="button" onClick={() => set("payment_dates", d.payment_dates.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
            </span>
          ))}
          <button type="button" className="text-xs font-bold underline" onClick={() => set("payment_dates", [...d.payment_dates, ""])}>+ Agregar fecha</button>
        </div>
      </div>

      <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
        <p>Devengado <b>{money(totals.devengados)}</b> · Deducciones <b>{money(totals.deducciones)}</b> · Neto a pagar <b>{money(totals.total)}</b></p>
        {problems.length ? problems.map((x) => <p key={x} className="text-xs" style={{ color: "#ef4444" }}>• {x}</p>) : <p className="text-xs" style={{ color: "#22c55e" }}>✓ Lista para enviar</p>}
      </div>
    </Modal>
  );
}

function Rows<T>({ title, rows, empty, onChange, render }: { title: string; rows: T[]; empty: T; onChange: (rows: T[]) => void; render: (row: T, update: (patch: Partial<T>) => void) => React.ReactNode }) {
  return (
    <div className="mt-3 space-y-1">
      <p className="text-xs font-bold">{title}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[1.4fr_0.8fr_1fr_auto]">
          {render(r, (patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
        </div>
      ))}
      <button type="button" className="text-xs font-bold underline" onClick={() => onChange([...rows, { ...empty }])}>+ Agregar</button>
    </div>
  );
}
