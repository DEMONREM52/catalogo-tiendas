"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowDownCircle, ArrowUpCircle, Pencil, PiggyBank, Plus, Repeat } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  FREQ_LABEL, PERIOD_LABEL, Sheet, esc, cardStyle, cop, done, fail, fdate, field, ghostBtn, inputStyle, iso, label, n, primaryBg, primaryBtn, swalTheme,
  type Budget, type Catalog, type Frequency, type Period, type Point, type Recurring,
} from "./shared";

const pointName = (points: Point[], id: string | null) => (id ? `📍 ${points.find((p) => p.id === id)?.name ?? "Punto"}` : "🏬 Madre");

// ================================================================ GASTOS FIJOS
export function RecurringTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const can = cat.can.budgets || cat.can.expenses;
  const monthly = (r: Recurring) => n(r.amount) * ({ weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12 } as Record<Frequency, number>)[r.frequency];
  const totalMonthly = cat.recurring.filter((r) => r.active).reduce((s, r) => s + monthly(r), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--t-muted)" }}>
          Los gastos fijos se crean solos como <b>por pagar</b> cuando llega su fecha (y hasta 15 días antes, para que los veas venir). Equivalen a unos <b style={{ color: "var(--t-text)" }}>{cop(Math.round(totalMonthly))}</b> al mes.
        </p>
        {can ? <button type="button" onClick={() => setEditing("new")} className={primaryBtn} style={primaryBg}><Plus size={16} /> Gasto fijo</button> : null}
      </div>
      {cat.recurring.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Agrega el arriendo, servicios, internet, software… y deja de olvidarlos.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {cat.recurring.map((r) => {
            const c = cat.categories.find((x) => x.id === r.category_id);
            return (
              <li key={r.id} className="rounded-2xl border p-3" style={{ ...cardStyle, opacity: r.active ? 1 : 0.55 }}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }}>{c?.emoji ?? "🔁"}</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{r.description}</b>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                      <Repeat size={11} className="inline" /> {FREQ_LABEL[r.frequency]}{["monthly", "bimonthly", "quarterly", "yearly"].includes(r.frequency) ? ` · día ${r.day_of_month}` : ""} · {pointName(points, r.point_id)}{r.payee_name ? ` · ${r.payee_name}` : ""}
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Desde {fdate(r.starts_on)}{r.ends_on ? ` hasta ${fdate(r.ends_on)}` : ""}{r.due_days ? ` · vence ${r.due_days} días después` : ""}{r.active ? "" : " · pausado"}</p>
                  </div>
                  <b className="tabular-nums">{cop(r.amount)}</b>
                </div>
                {can ? <button type="button" onClick={() => setEditing(r)} className={`${ghostBtn} mt-2`} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Editar</button> : null}
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
  const [f, setF] = useState({
    category: initial?.category_id ?? cat.categories.find((c) => c.kind === "fixed" && !c.is_payroll)?.id ?? "", description: initial?.description ?? "", payee: initial?.payee_name ?? "",
    amount: initial ? String(n(initial.amount)) : "", frequency: (initial?.frequency ?? "monthly") as Frequency, day: initial?.day_of_month ?? new Date().getDate(),
    starts: initial?.starts_on ?? iso(new Date()), ends: initial?.ends_on ?? "", due: initial?.due_days ?? 0, active: initial?.active ?? true,
    point: initial ? initial.point_id ?? "" : cat.can.madre ? "" : visible[0]?.id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const ok = f.category && Number(f.amount) > 0 && f.description.trim().length >= 2 && f.starts;
  async function save() {
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_recurring_save", {
      p_store: storeId, p_id: initial?.id ?? null, p_point: f.point || null, p_category: f.category, p_description: f.description, p_payee: f.payee, p_amount: Number(f.amount),
      p_frequency: f.frequency, p_day: f.day, p_starts: f.starts, p_ends: f.ends || null, p_due_days: f.due, p_active: f.active,
    });
    if (!error) await supabaseBrowser().rpc("erp_finance_setup", { p_store: storeId });
    setSaving(false);
    if (error) return fail(error);
    done("Gasto fijo guardado", initial ? "Los cambios aplican a los que aún no se han creado." : undefined);
    onSaved();
  }
  const monthlyLike = ["monthly", "bimonthly", "quarterly", "yearly"].includes(f.frequency);
  return (
    <Sheet title={initial ? "Editar gasto fijo" : "Nuevo gasto fijo"} onClose={onClose} footer={
      <>
        {initial ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-violet-500" /> Activo</label> : null}
        <span className="flex-1" />
        <button type="button" disabled={!ok || saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <label className="block"><span className="text-xs font-bold">Categoría</span>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={field} style={inputStyle}>
          <option value="">Elige…</option>{cat.categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </select>
      </label>
      <label className="block"><span className="text-xs font-bold">Descripción</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej.: Arriendo local centro" className={field} style={inputStyle} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-bold">Valor de cada pago</span><input type="number" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={field} style={inputStyle} /></label>
        <label className="block"><span className="text-xs font-bold">A quién se paga</span><input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} className={field} style={inputStyle} /></label>
        <label className="block"><span className="text-xs font-bold">¿Cada cuánto?</span>
          <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })} className={field} style={inputStyle}>
            {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {monthlyLike ? (
          <label className="block"><span className="text-xs font-bold">Día del mes (31 = último día)</span><input type="number" min={1} max={31} value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })} className={field} style={inputStyle} /></label>
        ) : <div />}
        <label className="block"><span className="text-xs font-bold">Desde</span><input type="date" value={f.starts} disabled={Boolean(initial)} onChange={(e) => setF({ ...f, starts: e.target.value })} className={field} style={inputStyle} /></label>
        <label className="block"><span className="text-xs font-bold">Hasta (opcional)</span><input type="date" value={f.ends} min={f.starts} onChange={(e) => setF({ ...f, ends: e.target.value })} className={field} style={inputStyle} /></label>
        <label className="block"><span className="text-xs font-bold">Días para pagarlo</span><input type="number" min={0} max={120} value={f.due} onChange={(e) => setF({ ...f, due: Number(e.target.value) })} className={field} style={inputStyle} /></label>
        {!initial ? (
          <label className="block"><span className="text-xs font-bold">¿De quién es?</span>
            <select value={f.point} onChange={(e) => setF({ ...f, point: e.target.value })} className={field} style={inputStyle}>
              {cat.can.madre ? <option value="">🏬 Madre</option> : null}{visible.map((p) => <option key={p.id} value={p.id}>📍 {p.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </Sheet>
  );
}

// ================================================================ PRESUPUESTOS Y CATEGORÍAS
export function BudgetsTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;
  const [scope, setScope] = useState<string>(cat.can.madre ? "" : visible[0]?.id ?? "");
  const [period, setPeriod] = useState<Period>("monthly");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const keyOf = (category: string | null) => category ?? "total";
  const current = (category: string | null): Budget | undefined => cat.budgets.find((b) => (b.point_id ?? "") === scope && b.category_id === category && b.period === period);
  const value = (category: string | null) => draft[keyOf(category)] ?? (current(category) && current(category)!.active ? String(n(current(category)!.amount)) : "");
  const rows: Array<{ id: string | null; name: string; emoji: string }> = [{ id: null, name: "Total (todos los gastos)", emoji: "📊" }, ...cat.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))];
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    for (const [k, v] of Object.entries(draft)) {
      const category = k === "total" ? null : k;
      const amount = v === "" ? 0 : Number(v);
      const { error } = await supabaseBrowser().rpc("erp_budget_save", { p_store: storeId, p_point: scope || null, p_category: category, p_period: period, p_amount: amount, p_active: v !== "" && amount > 0 });
      if (error) { setSaving(false); return fail(error); }
    }
    setSaving(false);
    setDraft({});
    done("Presupuesto guardado");
    onChanged();
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border p-4" style={cardStyle}>
        <div className="flex flex-wrap items-center gap-2">
          <select value={scope} onChange={(e) => { setScope(e.target.value); setDraft({}); }} className="rounded-full border px-3 py-2 text-sm" style={inputStyle} aria-label="Ámbito">
            {cat.can.madre ? <option value="">🏬 Toda la tienda (consolidado)</option> : null}
            {visible.map((p) => <option key={p.id} value={p.id}>📍 {p.name}</option>)}
          </select>
          <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => { setPeriod(p); setDraft({}); }} className="rounded-full px-3 py-1.5" style={period === p ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{PERIOD_LABEL[p]}</button>
            ))}
          </div>
          <span className="basis-full text-xs sm:basis-auto sm:flex-1" style={{ color: "var(--t-muted)" }}>{period === "biweekly" ? "Quincenas: del 1 al 15 y del 16 al fin de mes." : period === "weekly" ? "Semanas de lunes a domingo." : "Mes calendario."} La nómina aprobada cuenta en «Total» y en la categoría de nómina.</span>
        </div>
        <ul>
          {rows.map((r, i) => (
            <li key={keyOf(r.id)} className="flex items-center gap-3 py-2" style={i ? { borderTop: "1px solid var(--t-card-border)" } : undefined}>
              <span className="min-w-0 flex-1 truncate text-sm">{r.emoji} {r.name}</span>
              <div className="flex w-40 items-center rounded-lg border px-2" style={inputStyle}>
                <span className="text-xs">$</span>
                <input type="number" inputMode="decimal" min={0} disabled={!cat.can.budgets} value={value(r.id)} placeholder="Sin límite" onChange={(e) => setDraft({ ...draft, [keyOf(r.id)]: e.target.value })} className="w-full bg-transparent py-1.5 text-right text-sm font-bold tabular-nums outline-none" aria-label={`Presupuesto ${r.name}`} />
              </div>
            </li>
          ))}
        </ul>
        {dirty && cat.can.budgets ? (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft({})} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}>Deshacer</button>
            <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Guardando…" : "Guardar presupuesto"}</button>
          </div>
        ) : null}
      </section>
      {cat.can.budgets && cat.can.madre ? <CategoriesEditor storeId={storeId} cat={cat} onChanged={onChanged} /> : null}
    </div>
  );
}

function CategoriesEditor({ storeId, cat, onChanged }: { storeId: string; cat: Catalog; onChanged: () => void }) {
  async function edit(id: string | null) {
    const c = cat.categories.find((x) => x.id === id);
    const r = await Swal.fire({
      ...swalTheme, title: c ? "Editar categoría" : "Nueva categoría",
      html: `<input id="em" class="swal2-input" style="width:5rem" maxlength="4" value="${esc(c?.emoji ?? "💸")}" /><input id="nm" class="swal2-input" placeholder="Nombre" value="${esc(c?.name)}" />
        <select id="kd" class="swal2-select"><option value="variable" ${c?.kind !== "fixed" ? "selected" : ""}>Variable</option><option value="fixed" ${c?.kind === "fixed" ? "selected" : ""}>Fijo</option></select>`,
      showCancelButton: true, showDenyButton: Boolean(c), denyButtonText: c?.active ? "Desactivar" : "Activar", confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      preConfirm: () => ({ em: (document.getElementById("em") as HTMLInputElement).value, nm: (document.getElementById("nm") as HTMLInputElement).value, kd: (document.getElementById("kd") as HTMLSelectElement).value }),
    });
    if (r.isDismissed) return;
    const v = (r.value ?? {}) as { em?: string; nm?: string; kd?: string };
    const { error } = await supabaseBrowser().rpc("erp_expense_category_save", { p_store: storeId, p_id: id, p_name: r.isDenied ? c!.name : v.nm, p_emoji: r.isDenied ? c!.emoji : v.em, p_kind: r.isDenied ? c!.kind : v.kd, p_active: r.isDenied ? !c!.active : c?.active ?? true });
    if (error) return fail(error);
    onChanged();
  }
  return (
    <section className="rounded-2xl border p-4" style={cardStyle}>
      <div className="mb-2 flex items-center gap-2">
        <p className={`${label} flex-1`} style={{ color: "var(--t-muted)" }}>Categorías de gasto</p>
        <button type="button" onClick={() => void edit(null)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Categoría</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cat.categories.map((c) => (
          <button key={c.id} type="button" onClick={() => void edit(c.id)} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", opacity: c.active ? 1 : 0.5 }}>
            {c.emoji} {c.name}{c.kind === "fixed" ? " · fijo" : ""}{c.is_payroll ? " · nómina" : ""}
          </button>
        ))}
      </div>
    </section>
  );
}

// ================================================================ RESERVAS
export function ReservesTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;
  async function editFund(id: string | null) {
    const f = cat.funds.find((x) => x.id === id);
    const opts = [...(cat.can.madre ? [`<option value="">🏬 Madre</option>`] : []), ...visible.map((p) => `<option value="${esc(p.id)}">📍 ${esc(p.name)}</option>`)].join("");
    const r = await Swal.fire({
      ...swalTheme, title: f ? "Editar reserva" : "Nueva reserva",
      html: `<input id="nm" class="swal2-input" placeholder="Ej.: Prima de diciembre" value="${esc(f?.name)}" />
        <input id="pp" class="swal2-input" placeholder="Para qué es (opcional)" value="${esc(f?.purpose)}" />
        <input id="tg" type="number" class="swal2-input" placeholder="Meta (opcional)" value="${esc(f?.target ?? "")}" />
        ${f ? "" : `<select id="pt" class="swal2-select">${opts}</select>`}`,
      showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
      preConfirm: () => ({ nm: (document.getElementById("nm") as HTMLInputElement).value, pp: (document.getElementById("pp") as HTMLInputElement).value, tg: Number((document.getElementById("tg") as HTMLInputElement).value) || null, pt: (document.getElementById("pt") as HTMLSelectElement | null)?.value ?? null }),
    });
    if (!r.isConfirmed) return;
    const { error } = await supabaseBrowser().rpc("erp_reserve_fund_save", { p_store: storeId, p_id: id, p_point: r.value.pt || null, p_name: r.value.nm, p_purpose: r.value.pp, p_target: r.value.tg, p_active: true });
    if (error) return fail(error);
    onChanged();
  }
  async function move(id: string, kind: "in" | "out") {
    const r = await Swal.fire({
      ...swalTheme, title: kind === "in" ? "Aportar a la reserva" : "Retirar de la reserva",
      html: `<input id="am" type="number" class="swal2-input" placeholder="Valor" /><input id="nt" class="swal2-input" placeholder="Nota (opcional)" />`,
      showCancelButton: true, confirmButtonText: kind === "in" ? "Aportar" : "Retirar", cancelButtonText: "Cancelar",
      preConfirm: () => ({ am: Number((document.getElementById("am") as HTMLInputElement).value), nt: (document.getElementById("nt") as HTMLInputElement).value }),
    });
    if (!r.isConfirmed) return;
    const { error } = await supabaseBrowser().rpc("erp_reserve_move", { p_fund: id, p_kind: kind, p_amount: r.value.am, p_note: r.value.nt });
    if (error) return fail(error);
    onChanged();
  }
  const total = cat.funds.filter((f) => f.active).reduce((s, f) => s + n(f.balance), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--t-muted)" }}>Aparta dinero para pagos grandes que sabes que vienen (prima, impuestos, imprevistos). Total reservado: <b style={{ color: "var(--t-text)" }}>{cop(total)}</b>.</p>
        {cat.can.budgets ? <button type="button" onClick={() => void editFund(null)} className={primaryBtn} style={primaryBg}><PiggyBank size={16} /> Nueva reserva</button> : null}
      </div>
      {cat.funds.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Sin reservas todavía.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {cat.funds.map((f) => (
            <li key={f.id} className="rounded-2xl border p-4" style={cardStyle}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <b className="block truncate">🐷 {f.name}</b>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{pointName(points, f.point_id)}{f.purpose ? ` · ${f.purpose}` : ""}</p>
                </div>
                <b className="text-xl tabular-nums">{cop(f.balance)}</b>
              </div>
              {f.target ? (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}><div className="h-full rounded-[4px]" style={{ width: `${Math.min(100, (n(f.balance) / n(f.target)) * 100)}%`, background: "#3987e5" }} /></div>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>{Math.round((n(f.balance) / n(f.target)) * 100)} % de la meta {cop(f.target)}</p>
                </>
              ) : null}
              {cat.can.budgets ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void move(f.id, "in")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><ArrowDownCircle size={13} /> Aportar</button>
                  <button type="button" onClick={() => void move(f.id, "out")} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><ArrowUpCircle size={13} /> Retirar</button>
                  <button type="button" onClick={() => void editFund(f.id)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={12} /> Editar</button>
                </div>
              ) : null}
              {f.moves.length ? (
                <ul className="mt-2 space-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {f.moves.slice(0, 4).map((m) => <li key={m.id}>{m.kind === "in" ? "＋" : "－"} {cop(m.amount)} · {new Date(m.moved_at).toLocaleDateString("es-CO")} · {m.by}{m.note ? ` · ${m.note}` : ""}</li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
