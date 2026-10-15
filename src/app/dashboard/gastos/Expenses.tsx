"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Banknote, Camera, Check, Download, FileText, Hash, Paperclip, Pencil, Plus, Receipt, Search, Store, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { compressImage, MAX_PDF_BYTES } from "../inventario/attachments";
import { PAY_METHODS } from "@/components/forms/Sheet";
import {
  ChoiceChips, DateField, Field, METHODS, MoneyField, PaymentSheet, Sheet, ask, askDelete, cardStyle, cop, done, downloadCsv, fail, fdate, field, ghostBtn, inputStyle, iso, label, n, primaryBg, primaryBtn, rpcError, swalTheme,
  type Catalog, type Point,
} from "./shared";
import { ExportGate } from "@/components/ExportGate";
import { logExport } from "@/lib/permission-runtime";

type Expense = {
  id: string; store_id: string; number: number; point_id: string | null; point_name: string | null; category_id: string; category_name: string; emoji: string; description: string;
  payee_name: string | null; reference: string | null; amount: number; paid: number; incurred_on: string; due_on: string | null; status: "pending" | "partial" | "paid" | "void";
  notes: string | null; attachments: Array<{ path: string; name: string; mime: string; size: number }>; recurring_id: string | null; created_by_name: string | null; void_reason: string | null;
};
type Payment = { id: string; amount: number; method: string; reference: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null };

const STATUS: Record<Expense["status"], { label: string; color: string }> = {
  pending: { label: "Por pagar", color: "#eda100" }, partial: { label: "Pago parcial", color: "#d95926" }, paid: { label: "Pagado", color: "#22c55e" }, void: { label: "Anulado", color: "#94a3b8" },
};
const BUCKET = "expense-docs";
const safe = (s: string) => s.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60);

/** Gastos: lista con filtros, registro rápido, pagos parciales y soportes. */
export function Expenses({ storeId, points, cat, openId, onOpen, onChanged }: { storeId: string; points: Point[]; cat: Catalog; openId: string | null; onOpen: (id: string | null) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Expense[]>([]);
  const [total, setTotal] = useState({ n: 0, sum: 0 });
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [pointId, setPointId] = useState("");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<[string, string]>(() => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 2, 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_expenses_list", { p_store: storeId, p_point: pointId || null, p_from: range[0] || null, p_to: range[1] || null,
      p_status: status || null, p_category: category || null, p_query: q || null, p_limit: 200, p_offset: 0 });
    if (e) return setError(rpcError(e));
    setError(null);
    const res = data as { total: number; sum: number; rows: Expense[] };
    setRows(res.rows);
    setTotal({ n: res.total, sum: n(res.sum) });
  }, [storeId, pointId, range, status, category, q]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  function exportCsv() {
    logExport("gastos", rows.length, { from: range[0], to: range[1] });
    downloadCsv(`gastos-${range[0]}-${range[1]}.csv`, ["N.º", "Fecha", "Vence", "Categoría", "Descripción", "Proveedor", "Factura", "Punto", "Valor", "Pagado", "Pendiente", "Estado"],
      rows.map((r) => [r.number, r.incurred_on, r.due_on ?? "", r.category_name, r.description, r.payee_name ?? "", r.reference ?? "", r.point_name ?? "Madre", n(r.amount), n(r.paid), n(r.amount) - n(r.paid), STATUS[r.status].label]),
      ["RemHub · Gastos", `Del ${range[0]} al ${range[1]}`, `Generado: ${new Date().toLocaleString("es-CO")}`, "Pagos registrados en RemHub (no confirmación bancaria)."]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por descripción, proveedor, factura o número…" className="w-full rounded-full border py-2 pr-3 text-sm outline-none" style={{ ...inputStyle, paddingLeft: "2.1rem" }} />
        </div>
        {cat.can.expenses ? <button type="button" onClick={() => setEditing("new")} className={primaryBtn} style={primaryBg}><Plus size={16} /> Nuevo gasto</button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border px-3 py-1.5" style={inputStyle} aria-label="Estado">
          <option value="">Todos (sin anulados)</option><option value="open">Por pagar</option><option value="overdue">Vencidos</option><option value="paid">Pagados</option><option value="void">Anulados / eliminados</option><option value="all">Todo, incluso anulados</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-full border px-3 py-1.5" style={inputStyle} aria-label="Categoría">
          <option value="">Todas las categorías</option>{cat.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </select>
        {visible.length > 1 || cat.can.madre ? (
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className="rounded-full border px-3 py-1.5" style={inputStyle} aria-label="Punto">
            <option value="">{cat.can.madre ? "Madre y puntos" : "Mis puntos"}</option>{visible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <div className="w-40"><DateField value={range[0]} onChange={(v) => setRange([v, range[1]])} ariaLabel="Desde" /></div>
        <span className="text-xs" style={{ color: "var(--t-muted)" }}>a</span>
        <div className="w-40"><DateField value={range[1]} onChange={(v) => setRange([range[0], v])} ariaLabel="Hasta" /></div>
        <span className="flex-1 text-right text-xs" style={{ color: "var(--t-muted)" }}>{total.n} gastos · {cop(total.sum)}</span>
        <ExportGate><button type="button" onClick={exportCsv} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> CSV</button></ExportGate>
      </div>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}
      {rows.length === 0 && !error ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Sin gastos con estos filtros.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {rows.map((r) => {
            const late = (r.status === "pending" || r.status === "partial") && r.due_on && r.due_on < iso(new Date());
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5" style={{ ...cardStyle, borderColor: late ? "rgba(230,103,103,.55)" : "var(--t-card-border)", opacity: r.status === "void" ? 0.6 : 1 }}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>{r.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <b className="truncate">{r.description}</b>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `color-mix(in oklab, ${STATUS[r.status].color} 18%, transparent)`, color: STATUS[r.status].color }}>{late ? "Vencido" : STATUS[r.status].label}</span>
                      {r.recurring_id ? <span className="text-[10px]" title="Gasto fijo">🔁</span> : null}
                      {r.attachments?.length ? <Paperclip size={11} aria-label="Con soporte" /> : null}
                    </span>
                    <span className="block text-xs" style={{ color: "var(--t-muted)" }}>#{r.number} · {fdate(r.incurred_on)}{r.due_on && r.status !== "paid" ? ` · vence ${fdate(r.due_on)}` : ""} · {r.point_name ?? "Madre"}{r.payee_name ? ` · ${r.payee_name}` : ""}</span>
                  </span>
                  <span className="text-right">
                    <b className="block tabular-nums">{cop(r.amount)}</b>
                    {r.status === "partial" ? <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>falta {cop(n(r.amount) - n(r.paid))}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <AnimatePresence>
        {editing ? <ExpenseForm key="form" storeId={storeId} points={visible} cat={cat} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); void load(); onChanged(); if (editing === "new") onOpen(id); }} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {openId ? <ExpenseDetail key={openId} id={openId} cat={cat} onClose={() => onOpen(null)} onEdit={(e) => { onOpen(null); setEditing(e); }} onChanged={() => { void load(); onChanged(); }} /> : null}
      </AnimatePresence>
    </div>
  );
}

function ExpenseForm({ storeId, points, cat, initial, onClose, onSaved }: { storeId: string; points: Point[]; cat: Catalog; initial: Expense | null; onClose: () => void; onSaved: (id: string) => void }) {
  const active = cat.categories.filter((c) => c.active || c.id === initial?.category_id);
  const start = {
    category: initial?.category_id ?? "", amount: initial ? n(initial.amount) : null as number | null, description: initial?.description ?? "", payee: initial?.payee_name ?? "",
    reference: initial?.reference ?? "", incurred: initial?.incurred_on ?? iso(new Date()), due: initial?.due_on ?? "", notes: initial?.notes ?? "",
    point: initial ? initial.point_id ?? "" : cat.can.madre ? "" : points[0]?.id ?? "", payNow: false, method: "cash",
  };
  const [f, setF] = useState(start);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => `exp-${crypto.randomUUID()}`);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(start) || file !== null;
  const missing = !f.category ? "Elige una categoría" : !(f.amount && f.amount > 0) ? "Escribe el valor" : f.description.trim().length < 2 ? "Escribe en qué se gastó" : !f.incurred ? "Elige la fecha" : null;
  const tooLowForPaid = initial && f.amount !== null && f.amount < n(initial.paid);

  async function save() {
    if (missing || tooLowForPaid) return;
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_expense_save", {
      p_store: storeId, p_id: initial?.id ?? null, p_point: f.point || null, p_category: f.category, p_description: f.description, p_payee: f.payee, p_reference: f.reference,
      p_amount: f.amount, p_incurred: f.incurred, p_due: f.due || null, p_notes: f.notes, p_pay_now: f.payNow, p_method: f.method, p_key: key,
    });
    if (error) { setSaving(false); return fail(error); }
    const id = (data as { id: string }).id;
    if (file) await uploadAttachment(storeId, f.point || null, id, file).catch((e) => fail(e));
    setSaving(false);
    done(initial ? "Gasto actualizado" : f.payNow ? "Gasto registrado y pagado" : "Gasto registrado");
    onSaved(id);
  }

  return (
    <Sheet title={initial ? `Editar gasto #${initial.number}` : "Nuevo gasto"} subtitle={initial ? `${initial.category_name} · ${initial.point_name ?? "Madre"}` : "Registra lo que salió o lo que hay que pagar"}
      icon={<Receipt size={18} />} onClose={onClose} dirty={dirty} footer={
      <>
        <span className="min-w-0 flex-1 text-xs" style={{ color: missing ? "#eda100" : "var(--t-muted)" }}>{missing ? `⚠️ ${missing}` : initial && n(initial.paid) > 0 ? `Ya tiene ${cop(initial.paid)} pagado.` : "✓ Listo para guardar"}</span>
        <button type="button" disabled={Boolean(missing) || Boolean(tooLowForPaid) || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <Field label="¿Cuánto fue? (valor total, con impuestos)" error={tooLowForPaid ? `No puede ser menor a lo ya pagado (${cop(initial!.paid)}).` : undefined}>
        <MoneyField big autoFocus value={f.amount} onChange={(v) => set("amount", v)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Categoría</span>
        <ChoiceChips value={f.category} onChange={(v) => set("category", v)} options={active.map((c) => ({ value: c.id, label: c.name, icon: <span>{c.emoji}</span> }))} />
      </div>
      <Field label="¿En qué se gastó?">
        <input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Ej.: Recibo de energía de octubre" className={field} style={inputStyle} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={<><Store size={12} className="mr-1 inline" />Proveedor o a quién se paga</>}>
          <input value={f.payee} onChange={(e) => set("payee", e.target.value)} placeholder="Ej.: EPM" className={field} style={inputStyle} />
        </Field>
        <Field label={<><Hash size={12} className="mr-1 inline" />N.º de factura o recibo</>}>
          <input value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Opcional" className={field} style={inputStyle} />
        </Field>
        <Field label="Fecha del gasto"><DateField value={f.incurred} onChange={(v) => set("incurred", v)} /></Field>
        <Field label="Fecha límite de pago (opcional)" hint="Te avisamos cuando se acerque.">
          <DateField value={f.due} min={f.incurred} onChange={(v) => set("due", v)} />
        </Field>
      </div>
      {!initial && (points.length > 0 || cat.can.madre) ? (
        <div>
          <span className="mb-1.5 block text-xs font-bold">¿De quién es el gasto?</span>
          <ChoiceChips value={f.point} onChange={(v) => set("point", v)} options={[...(cat.can.madre ? [{ value: "", label: "Madre (general)", icon: <span>🏬</span> }] : []), ...points.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
      ) : null}
      <Field label="Notas (opcional)"><input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={field} style={inputStyle} /></Field>
      {!initial ? (
        <>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}><Camera size={16} /></span>
            <span className="min-w-0 flex-1"><b className="block truncate">{file ? file.name : "Foto o PDF del soporte"}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{file ? "Toca para cambiarlo" : "Opcional · se comprime solo"}</span></span>
            <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {cat.can.pay ? (
            <div className="rounded-2xl border p-3" style={{ borderColor: f.payNow ? "rgba(34,197,94,.5)" : "var(--t-card-border)" }}>
              <label className="flex cursor-pointer items-center gap-3 text-sm font-bold">
                <input type="checkbox" checked={f.payNow} onChange={(e) => set("payNow", e.target.checked)} className="h-5 w-5 accent-emerald-500" />
                <Banknote size={16} /> Ya está pagado
              </label>
              {f.payNow ? (
                <div className="mt-2.5"><ChoiceChips value={f.method} onChange={(v) => set("method", v)} options={PAY_METHODS.map((m) => ({ value: m.value, label: m.label, icon: m.icon }))} /></div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

async function uploadAttachment(storeId: string, pointId: string | null, expenseId: string, file: File) {
  const sb = supabaseBrowser();
  let blob: Blob = file;
  let mime = file.type || "application/octet-stream";
  if (mime.startsWith("image/")) {
    const c = await compressImage(file);
    blob = c.blob;
    mime = c.type;
  } else if (mime === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("El PDF pesa más de 10 MB.");
  } else throw new Error("Solo fotos o PDF.");
  const path = `${storeId}/${pointId ?? "madre"}/${expenseId}/${crypto.randomUUID().slice(0, 8)}-${safe(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: mime });
  if (up.error) throw up.error;
  const { error } = await sb.rpc("erp_expense_attach", { p_expense: expenseId, p_file: { path, name: file.name, mime, size: blob.size }, p_remove_path: null });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]);
    throw error;
  }
}

function ExpenseDetail({ id, cat, onClose, onEdit, onChanged }: { id: string; cat: Catalog; onClose: () => void; onEdit: (e: Expense) => void; onChanged: () => void }) {
  const [d, setD] = useState<{ expense: Expense; payments: Payment[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_expense_detail", { p_expense: id });
    if (error) return fail(error);
    setD(data as { expense: Expense; payments: Payment[] });
  }, [id]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const e = d?.expense;
  const pending = e ? n(e.amount) - n(e.paid) : 0;
  const after = async () => { await load(); onChanged(); };

  const [paying, setPaying] = useState(false);
  async function pay(p: { amount: number; method: string; ref: string; key: string }) {
    if (!e) return false;
    const { error } = await supabaseBrowser().rpc("erp_expense_pay", { p_expense: e.id, p_amount: p.amount, p_method: p.method, p_reference: p.ref || null, p_paid_at: null, p_key: p.key });
    if (error) { fail(error); return false; }
    done("Pago registrado");
    await after();
  }
  async function voidPay(pid: string) {
    const r = await ask("¿Por qué anulas este pago?");
    if (!r) return;
    const { error } = await supabaseBrowser().rpc("erp_expense_payment_void", { p_payment: pid, p_reason: r });
    if (error) return fail(error);
    await after();
  }
  async function voidExpense() {
    if (!e) return;
    const r = await askDelete(`el gasto #${e.number}`, "Queda guardado como anulado para la auditoría y deja de contar en los totales.");
    if (!r) return;
    const { error } = await supabaseBrowser().rpc("erp_expense_void", { p_expense: e.id, p_reason: r });
    if (error) return fail(error);
    await after();
  }
  async function addFile(file: File | undefined) {
    if (!file || !e) return;
    setBusy(true);
    await uploadAttachment(e.store_id, e.point_id, e.id, file).then(() => done("Soporte agregado")).catch(fail);
    setBusy(false);
    await load();
  }
  async function openFile(path: string) {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(path, 600);
    if (error || !data) return fail(error ?? "No se pudo abrir.");
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function removeFile(path: string) {
    if (!e) return;
    const ok = await Swal.fire({ ...swalTheme, icon: "warning", title: "¿Quitar este soporte?", showCancelButton: true, confirmButtonText: "Quitar", cancelButtonText: "Cancelar" });
    if (!ok.isConfirmed) return;
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("erp_expense_attach", { p_expense: e.id, p_file: {}, p_remove_path: path });
    if (error) return fail(error);
    await sb.storage.from(BUCKET).remove([path]);
    await load();
  }

  return (
    <Sheet title={e ? `${e.emoji} ${e.description}` : "Gasto"} subtitle={e ? <><span style={{ color: STATUS[e.status].color, fontWeight: 700 }}>{STATUS[e.status].label}</span> · #{e.number} · {e.category_name} · {e.point_name ?? "Madre"}</> : null} onClose={onClose}
      footer={e && e.status !== "void" ? (
        <>
          {cat.can.expenses ? <button type="button" onClick={() => onEdit(e)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={13} /> Editar</button> : null}
          {cat.can.expenses && cat.can.pay && n(e.paid) === 0 ? <button type="button" onClick={() => void voidExpense()} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Trash2 size={13} /> Eliminar</button> : null}
          <span className="flex-1" />
          {cat.can.pay && pending > 0 ? <button type="button" onClick={() => setPaying(true)} className={primaryBtn} style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><Banknote size={15} /> Registrar pago</button> : null}
        </>
      ) : null}>
      {e ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Valor", e.amount], ["Pagado", e.paid], ["Pendiente", pending]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border p-2" style={cardStyle}><p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p><p className="font-black tabular-nums">{cop(v as number)}</p></div>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt style={{ color: "var(--t-muted)" }}>Fecha</dt><dd>{fdate(e.incurred_on)}</dd>
            <dt style={{ color: "var(--t-muted)" }}>Vence</dt><dd>{fdate(e.due_on)}</dd>
            <dt style={{ color: "var(--t-muted)" }}>Proveedor</dt><dd>{e.payee_name ?? "—"}</dd>
            <dt style={{ color: "var(--t-muted)" }}>Factura</dt><dd>{e.reference ?? "—"}</dd>
            <dt style={{ color: "var(--t-muted)" }}>Registró</dt><dd>{e.created_by_name ?? "—"}{e.recurring_id ? " · 🔁 gasto fijo" : ""}</dd>
          </dl>
          {e.notes ? <p className="text-sm">📝 {e.notes}</p> : null}
          {e.void_reason ? <p className="text-sm text-red-400">Anulado: {e.void_reason}</p> : null}
          <section>
            <p className={label} style={{ color: "var(--t-muted)" }}>Soportes</p>
            <ul className="mt-1 space-y-1">
              {e.attachments.map((a) => (
                <li key={a.path} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                  <FileText size={14} />
                  <button type="button" onClick={() => void openFile(a.path)} className="min-w-0 flex-1 truncate text-left underline">{a.name}</button>
                  {cat.can.expenses && e.status !== "void" ? <button type="button" onClick={() => void removeFile(a.path)} aria-label="Quitar"><Trash2 size={13} /></button> : null}
                </li>
              ))}
            </ul>
            {cat.can.expenses && e.status !== "void" ? (
              <label className={`${ghostBtn} mt-2 cursor-pointer`} style={{ borderColor: "var(--t-card-border)" }}>
                <Camera size={13} /> {busy ? "Subiendo…" : "Agregar foto o PDF"}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={busy} onChange={(ev) => void addFile(ev.target.files?.[0])} />
              </label>
            ) : null}
          </section>
          <section>
            <p className={label} style={{ color: "var(--t-muted)" }}>Pagos</p>
            {d!.payments.length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin pagos.</p> : (
              <ul className="mt-1 space-y-1 text-sm">
                {d!.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)", opacity: p.voided ? 0.6 : 1 }}>
                    <b className={p.voided ? "line-through" : ""}>{cop(p.amount)}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{METHODS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""} · {new Date(p.paid_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} · {p.created_by_name}</span>
                    {p.voided ? <span className="text-xs text-red-400">anulado: {p.void_reason}</span> : cat.can.pay ? <button type="button" onClick={() => void voidPay(p.id)} className="ml-auto text-xs font-bold underline">Anular</button> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>}
      {e ? <PaymentSheet open={paying} title="Registrar pago" who={`${e.emoji} ${e.description}${e.payee_name ? " · " + e.payee_name : ""}`} pending={pending} defaultMethod="cash" onClose={() => setPaying(false)} onConfirm={pay} /> : null}
    </Sheet>
  );
}
