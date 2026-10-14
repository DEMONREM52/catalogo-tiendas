"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowDownCircle, ArrowUpCircle, CalendarClock, Check, Pencil, PiggyBank, Plus, Repeat, Tags, Target, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  ChoiceChips, DateField, FREQ_LABEL, Field, MoneyField, NumberField, PERIOD_LABEL, Sheet, askDelete, confirmDiscard, cardStyle, cop, done, fail, fdate, field, ghostBtn, inputStyle, iso, label, n,
  primaryBg, primaryBtn, type Budget, type Catalog, type Category, type Frequency, type Fund, type Period, type Point, type Recurring,
} from "./shared";

const pointName = (points: Point[], id: string | null) => (id ? `📍 ${points.find((p) => p.id === id)?.name ?? "Punto"}` : "🏬 Madre");
const MONTHLY_LIKE: Frequency[] = ["monthly", "bimonthly", "quarterly", "yearly"];
const PER_MONTH: Record<Frequency, number> = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12 };
const Empty = ({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) => (
  <div className="rounded-3xl border border-dashed p-8 text-center" style={{ borderColor: "var(--t-card-border)" }}>
    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>{icon}</span>
    <p className="mt-3 font-bold">{title}</p>
    <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{text}</p>
  </div>
);

// ================================================================ GASTOS FIJOS
export function RecurringTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const can = cat.can.budgets || cat.can.expenses;
  const totalMonthly = cat.recurring.filter((r) => r.active).reduce((s, r) => s + n(r.amount) * PER_MONTH[r.frequency], 0);

  async function remove(r: Recurring) {
    const reason = await askDelete(`«${r.description}»`, "Los gastos que ya se crearon con él se conservan; solo deja de crear nuevos.");
    if (!reason) return;
    const { data, error } = await supabaseBrowser().rpc("erp_recurring_delete", { p_id: r.id });
    if (error) return fail(error);
    const res = data as { hidden: boolean; generated: number };
    done("Gasto fijo eliminado", res.hidden ? `Sus ${res.generated} gastos ya creados se conservan en el historial.` : undefined);
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center" style={cardStyle}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#3987e5,#8b5cf6)" }}><Repeat size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">Se crean solos como <b>por pagar</b> cuando llega su fecha (y 15 días antes, para verlos venir).</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Equivalen a unos <b className="text-base" style={{ color: "var(--t-text)" }}>{cop(Math.round(totalMonthly))}</b> al mes</p>
        </div>
        {can ? <button type="button" onClick={() => setEditing("new")} className={primaryBtn} style={primaryBg}><Plus size={16} /> Gasto fijo</button> : null}
      </div>
      {cat.recurring.length === 0 ? (
        <Empty icon={<Repeat size={22} />} title="Sin gastos fijos" text="Agrega el arriendo, servicios, internet o software y deja de olvidarlos." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {cat.recurring.map((r) => {
            const c = cat.categories.find((x) => x.id === r.category_id);
            return (
              <li key={r.id} className="rounded-2xl border p-4 transition hover:-translate-y-0.5" style={{ ...cardStyle, opacity: r.active ? 1 : 0.55 }}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>{c?.emoji ?? "🔁"}</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{r.description}</b>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                      <span className="inline-flex items-center gap-1"><Repeat size={11} /> {FREQ_LABEL[r.frequency]}{MONTHLY_LIKE.includes(r.frequency) ? ` · día ${r.day_of_month}` : ""}</span>
                      <span>{pointName(points, r.point_id)}</span>
                      {r.payee_name ? <span>· {r.payee_name}</span> : null}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Desde {fdate(r.starts_on)}{r.ends_on ? ` hasta ${fdate(r.ends_on)}` : ""}{r.due_days ? ` · se paga en ${r.due_days} días` : ""}{r.active ? "" : " · ⏸️ pausado"}</p>
                  </div>
                  <b className="text-lg tabular-nums">{cop(r.amount)}</b>
                </div>
                {can ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setEditing(r)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Editar</button>
                    <button type="button" onClick={() => void remove(r)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)", color: "#e66767" }}><Trash2 size={12} /> Eliminar</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <AnimatePresence>{editing ? <RecurringForm key="r" storeId={storeId} points={points} cat={cat} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function RecurringForm({ storeId, points, cat, initial, onClose, onSaved }: { storeId: string; points: Point[]; cat: Catalog; initial: Recurring | null; onClose: () => void; onSaved: () => void }) {
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;
  const start = {
    category: initial?.category_id ?? cat.categories.find((c) => c.kind === "fixed" && !c.is_payroll && c.active)?.id ?? "", description: initial?.description ?? "", payee: initial?.payee_name ?? "",
    amount: initial ? n(initial.amount) : (null as number | null), frequency: (initial?.frequency ?? "monthly") as Frequency, day: initial?.day_of_month ?? new Date().getDate(),
    starts: initial?.starts_on ?? iso(new Date()), ends: initial?.ends_on ?? "", due: initial?.due_days ?? 0, active: initial?.active ?? true,
    point: initial ? initial.point_id ?? "" : cat.can.madre ? "" : visible[0]?.id ?? "",
  };
  const [f, setF] = useState(start);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const missing = !f.category ? "Elige una categoría" : !(f.amount && f.amount > 0) ? "Escribe el valor" : f.description.trim().length < 2 ? "Escribe la descripción" : !f.starts ? "Elige desde cuándo" : null;
  async function save() {
    if (missing) return;
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_recurring_save", {
      p_store: storeId, p_id: initial?.id ?? null, p_point: f.point || null, p_category: f.category, p_description: f.description, p_payee: f.payee, p_amount: f.amount,
      p_frequency: f.frequency, p_day: f.day, p_starts: f.starts, p_ends: f.ends || null, p_due_days: f.due, p_active: f.active,
    });
    if (!error) await supabaseBrowser().rpc("erp_finance_setup", { p_store: storeId });
    setSaving(false);
    if (error) return fail(error);
    done("Gasto fijo guardado", initial ? "Los cambios aplican a los que aún no se han creado." : undefined);
    onSaved();
  }
  const monthly = (f.amount ?? 0) * PER_MONTH[f.frequency];
  return (
    <Sheet title={initial ? "Editar gasto fijo" : "Nuevo gasto fijo"} subtitle="Se crea solo cada vez que toca" icon={<Repeat size={18} />} onClose={onClose} dirty={dirty} footer={
      <>
        {initial ? <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 accent-violet-500" /> Activo</label> : null}
        <span className="min-w-0 flex-1 text-right text-xs" style={{ color: missing ? "#eda100" : "var(--t-muted)" }}>{missing ? `⚠️ ${missing}` : `≈ ${cop(Math.round(monthly))} al mes`}</span>
        <button type="button" disabled={Boolean(missing) || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <Field label="Valor de cada pago"><MoneyField big autoFocus value={f.amount} onChange={(v) => set("amount", v)} /></Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Categoría</span>
        <ChoiceChips value={f.category} onChange={(v) => set("category", v)} options={cat.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, icon: <span>{c.emoji}</span> }))} />
      </div>
      <Field label="Descripción"><input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Ej.: Arriendo local centro" className={field} style={inputStyle} /></Field>
      <Field label="A quién se paga (opcional)"><input value={f.payee} onChange={(e) => set("payee", e.target.value)} placeholder="Ej.: Don Pedro" className={field} style={inputStyle} /></Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">¿Cada cuánto?</span>
        <ChoiceChips value={f.frequency} onChange={(v) => set("frequency", v)} options={(Object.keys(FREQ_LABEL) as Frequency[]).map((k) => ({ value: k, label: FREQ_LABEL[k] }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {MONTHLY_LIKE.includes(f.frequency) ? (
          <Field label="Día del mes" hint="31 = el último día de cada mes"><NumberField value={f.day} onChange={(v) => set("day", Math.round(v ?? 1))} min={1} max={31} decimals={0} align="left" /></Field>
        ) : null}
        <Field label="Días para pagarlo" hint="Desde que se crea el gasto"><NumberField value={f.due} onChange={(v) => set("due", Math.round(v ?? 0))} min={0} max={120} decimals={0} suffix="días" align="left" /></Field>
        <Field label="Desde"><DateField value={f.starts} disabled={Boolean(initial)} onChange={(v) => set("starts", v)} /></Field>
        <Field label="Hasta (opcional)"><DateField value={f.ends} min={f.starts} onChange={(v) => set("ends", v)} /></Field>
      </div>
      {!initial ? (
        <div>
          <span className="mb-1.5 block text-xs font-bold">¿De quién es?</span>
          <ChoiceChips value={f.point} onChange={(v) => set("point", v)} options={[...(cat.can.madre ? [{ value: "", label: "Madre", icon: <span>🏬</span> }] : []), ...visible.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
      ) : null}
    </Sheet>
  );
}

// ================================================================ PRESUPUESTOS Y CATEGORÍAS
export function BudgetsTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;
  const [scope, setScope] = useState<string>(cat.can.madre ? "" : visible[0]?.id ?? "");
  const [period, setPeriod] = useState<Period>("monthly");
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | "new" | null>(null);
  const keyOf = (category: string | null) => category ?? "total";
  const current = (category: string | null): Budget | undefined => cat.budgets.find((b) => (b.point_id ?? "") === scope && b.category_id === category && b.period === period);
  const value = (category: string | null) => (keyOf(category) in draft ? draft[keyOf(category)] : current(category)?.active ? n(current(category)!.amount) : null);
  const rows: Array<{ id: string | null; name: string; emoji: string }> = [{ id: null, name: "Total (todos los gastos)", emoji: "📊" }, ...cat.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))];
  const dirty = Object.keys(draft).length > 0;
  const sumCats = rows.slice(1).reduce((s, r) => s + (value(r.id) ?? 0), 0);

  async function switchTo(fn: () => void) {
    if (dirty && !(await confirmDiscard())) return;
    setDraft({});
    fn();
  }
  async function save() {
    setSaving(true);
    for (const [k, v] of Object.entries(draft)) {
      const { error } = await supabaseBrowser().rpc("erp_budget_save", { p_store: storeId, p_point: scope || null, p_category: k === "total" ? null : k, p_period: period, p_amount: v ?? 0, p_active: (v ?? 0) > 0 });
      if (error) { setSaving(false); return fail(error); }
    }
    setSaving(false);
    setDraft({});
    done("Presupuesto guardado");
    onChanged();
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border p-4" style={cardStyle}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#22c55e,#3987e5)" }}><Target size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">¿Cuánto quieres gastar como máximo?</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{period === "biweekly" ? "Quincenas: del 1 al 15 y del 16 al fin de mes." : period === "weekly" ? "Semanas de lunes a domingo." : "Mes calendario."} La nómina aprobada cuenta en «Total» y en la categoría de nómina.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ChoiceChips value={scope} onChange={(v) => void switchTo(() => setScope(v))} options={[...(cat.can.madre ? [{ value: "", label: "Toda la tienda", icon: <span>🏬</span> }] : []), ...visible.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
        <ChoiceChips value={period} onChange={(v) => void switchTo(() => setPeriod(v))} options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p], icon: <CalendarClock size={13} /> }))} />
        <ul>
          {rows.map((r, i) => (
            <li key={keyOf(r.id)} className="flex items-center gap-3 py-2.5" style={i ? { borderTop: "1px solid var(--t-card-border)" } : undefined}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "color-mix(in oklab, var(--t-accent) 8%, transparent)" }}>{r.emoji}</span>
              <span className={`min-w-0 flex-1 truncate text-sm ${r.id === null ? "font-black" : "font-semibold"}`}>{r.name}</span>
              <div className="w-40 shrink-0 sm:w-48">
                <MoneyField value={value(r.id)} onChange={(v) => setDraft({ ...draft, [keyOf(r.id)]: v })} placeholder="Sin límite" disabled={!cat.can.budgets} ariaLabel={`Presupuesto ${r.name}`} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--t-muted)" }}>
          <span>Suma de categorías: <b style={{ color: "var(--t-text)" }}>{cop(sumCats)}</b></span>
          {value(null) !== null && sumCats > (value(null) ?? 0) ? <span className="font-bold text-amber-400">⚠️ Las categorías suman más que el total</span> : null}
          <span className="flex-1" />
          {dirty && cat.can.budgets ? (
            <>
              <button type="button" onClick={() => setDraft({})} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}>Deshacer</button>
              <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> {saving ? "Guardando…" : "Guardar presupuesto"}</button>
            </>
          ) : null}
        </div>
      </section>
      {cat.can.budgets && cat.can.madre ? (
        <section className="rounded-2xl border p-4" style={cardStyle}>
          <div className="mb-3 flex items-center gap-2">
            <p className={`${label} flex flex-1 items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><Tags size={13} /> Categorías de gasto</p>
            <button type="button" onClick={() => setEditingCat("new")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Categoría</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cat.categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setEditingCat(c)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", opacity: c.active ? 1 : 0.5 }}>
                <span>{c.emoji}</span> {c.name}{c.kind === "fixed" ? <span style={{ color: "var(--t-muted)" }}>· fijo</span> : null}{c.is_payroll ? <span style={{ color: "var(--t-muted)" }}>· nómina</span> : null}{c.active ? null : <span style={{ color: "var(--t-muted)" }}>· apagada</span>}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <AnimatePresence>{editingCat ? <CategoryForm key="c" storeId={storeId} initial={editingCat === "new" ? null : editingCat} onClose={() => setEditingCat(null)} onSaved={() => { setEditingCat(null); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

const EMOJIS = ["🏠", "💡", "📶", "👥", "🚚", "📣", "🛠️", "📦", "🏛️", "🏦", "💻", "🍽️", "🧹", "⛽", "🧾", "🛡️", "🎁", "💸"];
function CategoryForm({ storeId, initial, onClose, onSaved }: { storeId: string; initial: Category | null; onClose: () => void; onSaved: () => void }) {
  const start = { name: initial?.name ?? "", emoji: initial?.emoji ?? "💸", kind: initial?.kind ?? "variable", active: initial?.active ?? true };
  const [f, setF] = useState(start);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_expense_category_save", { p_store: storeId, p_id: initial?.id ?? null, p_name: f.name, p_emoji: f.emoji, p_kind: f.kind, p_active: f.active });
    setSaving(false);
    if (error) return fail(error);
    onSaved();
  }
  return (
    <Sheet title={initial ? "Editar categoría" : "Nueva categoría"} icon={<Tags size={18} />} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} footer={
      <>
        {initial ? <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-violet-500" /> Activa</label> : null}
        <span className="flex-1" />
        <button type="button" disabled={f.name.trim().length < 2 || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> Guardar</button>
      </>
    }>
      <Field label="Nombre"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Aseo y cafetería" className={field} style={inputStyle} /></Field>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Ícono</span>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => <button key={e} type="button" onClick={() => setF({ ...f, emoji: e })} className="grid h-10 w-10 place-items-center rounded-xl border text-xl transition" style={f.emoji === e ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>{e}</button>)}
        </div>
      </div>
      <div>
        <span className="mb-1.5 block text-xs font-bold">Tipo</span>
        <ChoiceChips value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "variable", label: "Variable (cambia cada mes)" }, { value: "fixed", label: "Fijo (casi siempre igual)" }]} />
      </div>
      {initial && !f.active ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Una categoría apagada no aparece al registrar gastos nuevos; los gastos viejos la conservan.</p> : null}
    </Sheet>
  );
}

// ================================================================ RESERVAS
export function ReservesTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [editing, setEditing] = useState<Fund | "new" | null>(null);
  const [moving, setMoving] = useState<{ fund: Fund; kind: "in" | "out" } | null>(null);
  const total = cat.funds.filter((f) => f.active).reduce((s, f) => s + n(f.balance), 0);

  async function remove(f: Fund) {
    if (n(f.balance) !== 0) return fail(`La reserva todavía tiene ${cop(f.balance)}. Retira el saldo antes de eliminarla.`);
    const reason = await askDelete(`la reserva «${f.name}»`, f.moves.length ? "Sus movimientos se conservan en el historial." : "");
    if (!reason) return;
    const { error } = await supabaseBrowser().rpc("erp_reserve_fund_delete", { p_id: f.id });
    if (error) return fail(error);
    done("Reserva eliminada");
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center" style={cardStyle}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#3987e5,#22c55e)" }}><PiggyBank size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">Aparta dinero para pagos grandes que sabes que vienen: prima, impuestos, imprevistos.</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Total reservado: <b className="text-base" style={{ color: "var(--t-text)" }}>{cop(total)}</b></p>
        </div>
        {cat.can.budgets ? <button type="button" onClick={() => setEditing("new")} className={primaryBtn} style={primaryBg}><Plus size={16} /> Nueva reserva</button> : null}
      </div>
      {cat.funds.length === 0 ? (
        <Empty icon={<PiggyBank size={22} />} title="Sin reservas" text="Crea una reserva y ve aportando poco a poco." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {cat.funds.map((f) => {
            const pct = f.target ? Math.min(100, (n(f.balance) / n(f.target)) * 100) : null;
            return (
              <li key={f.id} className="rounded-2xl border p-4" style={{ ...cardStyle, opacity: f.active ? 1 : 0.6 }}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: "color-mix(in oklab, #3987e5 14%, transparent)" }}>🐷</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{f.name}</b>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>{pointName(points, f.point_id)}{f.purpose ? ` · ${f.purpose}` : ""}</p>
                  </div>
                  <b className="text-xl tabular-nums">{cop(f.balance)}</b>
                </div>
                {pct !== null ? (
                  <div className="mt-3">
                    <div className="h-2.5 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}><div className="h-full rounded-[4px] transition-all" style={{ width: `${pct}%`, background: pct >= 100 ? "#22c55e" : "#3987e5" }} /></div>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{pct >= 100 ? "🎉 ¡Meta cumplida!" : `${Math.round(pct)} % de la meta ${cop(f.target)} · faltan ${cop(n(f.target) - n(f.balance))}`}</p>
                  </div>
                ) : null}
                {cat.can.budgets ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setMoving({ fund: f, kind: "in" })} className={ghostBtn} style={{ borderColor: "rgba(34,197,94,.5)", color: "#22c55e" }}><ArrowDownCircle size={13} /> Aportar</button>
                    <button type="button" disabled={n(f.balance) <= 0} onClick={() => setMoving({ fund: f, kind: "out" })} className={`${ghostBtn} disabled:opacity-40`} style={{ borderColor: "var(--t-card-border)" }}><ArrowUpCircle size={13} /> Retirar</button>
                    <button type="button" onClick={() => setEditing(f)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Editar</button>
                    <button type="button" onClick={() => void remove(f)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)", color: "#e66767" }}><Trash2 size={12} /> Eliminar</button>
                  </div>
                ) : null}
                {f.moves.length ? (
                  <ul className="mt-3 space-y-1 border-t pt-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                    {f.moves.slice(0, 4).map((m) => (
                      <li key={m.id} className="flex items-center gap-2">
                        <span className={m.kind === "in" ? "text-emerald-400" : "text-red-400"}>{m.kind === "in" ? "＋" : "－"}</span>
                        <b className="tabular-nums">{cop(m.amount)}</b>
                        <span className="min-w-0 flex-1 truncate" style={{ color: "var(--t-muted)" }}>{new Date(m.moved_at).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })} · {m.by}{m.note ? ` · ${m.note}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <AnimatePresence>{editing ? <FundForm key="f" storeId={storeId} points={points} cat={cat} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : null}</AnimatePresence>
      <AnimatePresence>{moving ? <MoveForm key="m" fund={moving.fund} kind={moving.kind} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); onChanged(); }} /> : null}</AnimatePresence>
    </div>
  );
}

function FundForm({ storeId, points, cat, initial, onClose, onSaved }: { storeId: string; points: Point[]; cat: Catalog; initial: Fund | null; onClose: () => void; onSaved: () => void }) {
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;
  const start = { name: initial?.name ?? "", purpose: initial?.purpose ?? "", target: initial?.target ? n(initial.target) : (null as number | null), point: initial ? initial.point_id ?? "" : cat.can.madre ? "" : visible[0]?.id ?? "" };
  const [f, setF] = useState(start);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_reserve_fund_save", { p_store: storeId, p_id: initial?.id ?? null, p_point: f.point || null, p_name: f.name, p_purpose: f.purpose, p_target: f.target, p_active: true });
    setSaving(false);
    if (error) return fail(error);
    done(initial ? "Reserva actualizada" : "Reserva creada");
    onSaved();
  }
  return (
    <Sheet title={initial ? "Editar reserva" : "Nueva reserva"} icon={<PiggyBank size={18} />} onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} footer={
      <><span className="flex-1" /><button type="button" disabled={f.name.trim().length < 2 || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}><Check size={16} /> Guardar</button></>
    }>
      <Field label="Nombre"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Prima de diciembre" className={field} style={inputStyle} /></Field>
      <Field label="¿Para qué es? (opcional)"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Ej.: pagar la prima de los empleados" className={field} style={inputStyle} /></Field>
      <Field label="Meta (opcional)" hint="Te mostramos cuánto falta."><MoneyField value={f.target} onChange={(v) => setF({ ...f, target: v })} /></Field>
      {!initial ? (
        <div>
          <span className="mb-1.5 block text-xs font-bold">¿De quién es?</span>
          <ChoiceChips value={f.point} onChange={(v) => setF({ ...f, point: v })} options={[...(cat.can.madre ? [{ value: "", label: "Madre", icon: <span>🏬</span> }] : []), ...visible.map((p) => ({ value: p.id, label: p.name, icon: <span>📍</span> }))]} />
        </div>
      ) : null}
    </Sheet>
  );
}

function MoveForm({ fund, kind, onClose, onSaved }: { fund: Fund; kind: "in" | "out"; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const too = kind === "out" && (amount ?? 0) > n(fund.balance);
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_reserve_move", { p_fund: fund.id, p_kind: kind, p_amount: amount, p_note: note });
    setSaving(false);
    if (error) return fail(error);
    done(kind === "in" ? "Aporte registrado" : "Retiro registrado");
    onSaved();
  }
  const after = n(fund.balance) + (kind === "in" ? 1 : -1) * (amount ?? 0);
  return (
    <Sheet title={kind === "in" ? "Aportar a la reserva" : "Retirar de la reserva"} subtitle={`🐷 ${fund.name}`} icon={kind === "in" ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />} onClose={onClose} dirty={amount !== null || note !== ""} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Quedaría en <b style={{ color: too ? "#e66767" : "var(--t-text)" }}>{cop(Math.max(0, after))}</b></span>
        <button type="button" disabled={!(amount && amount > 0) || too || saving} onClick={() => void save()} className={primaryBtn} style={{ background: kind === "in" ? "linear-gradient(135deg,#22c55e,#3987e5)" : "linear-gradient(135deg,#f59e0b,#ef4444)" }}><Check size={16} /> {kind === "in" ? "Aportar" : "Retirar"}</button>
      </>
    }>
      <p className="text-sm" style={{ color: "var(--t-muted)" }}>Saldo actual: <b style={{ color: "var(--t-text)" }}>{cop(fund.balance)}</b></p>
      <Field label="Valor" error={too ? "No puedes retirar más de lo que hay." : undefined}><MoneyField big autoFocus value={amount} onChange={setAmount} /></Field>
      <Field label="Nota (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "in" ? "Ej.: aporte de octubre" : "Ej.: pago de la prima"} className={field} style={inputStyle} /></Field>
    </Sheet>
  );
}
