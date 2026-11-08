"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Check, HandCoins, Plus, Receipt, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, Field, MoneyField, NumberField } from "@/components/forms/Fields";
import { Sheet as FormSheet } from "@/components/forms/Sheet";
import { ImageUpload } from "../store/ImageUpload";
import { cardStyle, cop, esc, inputStyle, rpcError, swalTheme } from "./shared";

type Kind = "advance" | "expense";
type Split = "one" | "pool" | "equal" | "custom";
type Share = { beneficiary_id: string; pct: number };
export type AdvanceRow = {
  id: string; number: number; kind?: Kind; split?: Split | null; shares?: Share[] | null;
  beneficiary_id: string | null; beneficiary_name: string | null; amount: number; given_at: string;
  method: string; reference: string | null; note: string; support_url: string | null; status: "pending" | "approved" | "rejected" | "voided";
  created_by_name: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  voided_by_name: string | null; void_reason: string | null; settlement: { id: string; number: number; status: string; cutoff: string } | null; mine: boolean;
  /** Lo ya abonado al costo en liquidaciones vigentes (20261289). */
  used?: number;
};
type Beneficiary = { id: string; name: string; active: boolean };

const METHODS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", nequi: "Nequi / Daviplata", other: "Otro" };
const KIND: Record<Kind, { label: string; icon: string; color: string }> = {
  advance: { label: "Anticipo", icon: "💸", color: "#f59e0b" },
  expense: { label: "Gasto", icon: "🧾", color: "#0ea5e9" },
};
const n = (v: unknown) => Number(v ?? 0);
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const fail = (e: unknown) => void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(e) });
const splitOf = (a: AdvanceRow): Split => a.split ?? (a.beneficiary_id ? "one" : "pool");

/** Cómo va cada uno: por aprobar → por descontar → descontado en la liquidación #N. */
function statusOf(a: AdvanceRow): { label: string; color: string } {
  if (a.status === "pending") return { label: "Por aprobar", color: "#eda100" };
  if (a.status === "rejected") return { label: "Rechazado", color: "#94a3b8" };
  if (a.status === "voided") return { label: "Anulado", color: "#94a3b8" };
  const left = n(a.amount) - n(a.used);
  if ((a.kind ?? "advance") === "advance" && a.settlement && left > 0.004) return { label: `Abonado ${cop(a.used)} de ${cop(a.amount)} · el resto en la próxima`, color: "#8b5cf6" };
  if (a.settlement) return { label: `${(a.kind ?? "advance") === "advance" ? "Abonado al costo" : "Descontado"} en la liquidación #${a.settlement.number}`, color: "#22c55e" };
  return { label: (a.kind ?? "advance") === "advance" ? "Por abonar al costo en la próxima liquidación" : "Por descontar en la próxima liquidación", color: "#8b5cf6" };
}

/** «A quién» en palabras: LOS MELLOS 70 % · ROBIN 30 %, mitad y mitad, según el reparto… */
function splitText(a: AdvanceRow, names: (id: string) => string) {
  if ((a.kind ?? "advance") === "advance") return "Abono al costo de la mercancía (no toca la ganancia)";
  const s = splitOf(a);
  if (s === "one") return `Solo ${a.beneficiary_name ?? names(a.beneficiary_id ?? "")}`;
  if (s === "equal") return "Mitad y mitad (partes iguales)";
  if (s === "custom") return (a.shares ?? []).map((x) => `${names(x.beneficiary_id)} ${n(x.pct)} %`).join(" · ");
  return "Según el reparto del pozo";
}

/**
 * Anticipos y gastos del pozo: dinero que salió antes de liquidar (anticipos) o gastos del punto (transporte,
 * consumo…) que se restan de la ganancia. En cada uno se escoge cómo se reparte. Lo registra quien prepara y
 * lo aprueba otra persona; se descuenta solo en la próxima liquidación.
 */
export function AdvancesSection({ storeId, point, beneficiaries, shares, can, refreshKey, onChanged, onOpenSettlement }: {
  storeId: string; point: string | null; beneficiaries: Beneficiary[]; shares: Share[];
  can: { settle: boolean; approve: boolean }; refreshKey: number; onChanged: () => void; onOpenSettlement: (id: string) => void;
}) {
  const [rows, setRows] = useState<AdvanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [filter, setFilter] = useState<"all" | "pending">("all");

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_settlement_advances_list", { p_store: storeId, p_point: point });
    if (e) { setError(/erp_settlement_advances_list|schema cache|does not exist/i.test(e.message) ? "Para registrar anticipos y gastos ejecuta en Supabase las migraciones 20261286 y 20261288." : rpcError(e)); setRows([]); return; }
    setError(null);
    setRows((data ?? []) as AdvanceRow[]);
  }, [storeId, point]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  const names = useCallback((id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario", [beneficiaries]);
  const totals = useMemo(() => {
    const list = rows ?? [];
    const sum = (f: (a: AdvanceRow) => boolean) => list.filter(f).reduce((t, a) => t + n(a.amount), 0);
    return {
      waiting: sum((a) => a.status === "pending"),
      advances: list.filter((a) => a.status === "approved" && (a.kind ?? "advance") === "advance").reduce((t, a) => t + Math.max(0, n(a.amount) - n(a.used)), 0),
      expenses: sum((a) => a.status === "approved" && !a.settlement && a.kind === "expense"),
      done: list.filter((a) => a.status === "approved").reduce((t, a) => t + ((a.kind ?? "advance") === "advance" ? n(a.used) : a.settlement ? n(a.amount) : 0), 0),
    };
  }, [rows]);

  async function decide(a: AdvanceRow, action: "approve" | "reject") {
    let note: string | null = null;
    if (action === "reject") {
      const r = await Swal.fire({ ...swalTheme, title: "¿Por qué lo rechazas?", input: "text", inputPlaceholder: "Motivo", showCancelButton: true, confirmButtonText: "Rechazar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim().length < 3 ? "Escribe al menos 3 letras" : null) });
      if (!r.isConfirmed) return;
      note = String(r.value).trim();
    } else {
      const r = await Swal.fire({ ...swalTheme, icon: "question", title: `¿Aprobar el ${KIND[a.kind ?? "advance"].label.toLowerCase()} #${a.number}?`,
        html: `${esc(cop(a.amount))} · ${esc(splitText(a, names))}<br/><small>${esc(a.note)}</small><br/><small>Se descontará en la próxima liquidación.</small>`,
        showCancelButton: true, confirmButtonText: "Aprobar", cancelButtonText: "Cancelar", confirmButtonColor: "#22c55e" });
      if (!r.isConfirmed) return;
    }
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_advance_decide", { p_id: a.id, p_action: action, p_note: note });
    if (e) return fail(e);
    await load();
    onChanged();
  }
  async function voidIt(a: AdvanceRow) {
    const r = await Swal.fire({ ...swalTheme, icon: "warning", title: `Anular el #${a.number}`, input: "text", inputPlaceholder: "Motivo (ej.: se registró dos veces)", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444", inputValidator: (v) => (v.trim().length < 3 ? "Escribe el motivo" : null) });
    if (!r.isConfirmed) return;
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_advance_void", { p_id: a.id, p_reason: String(r.value).trim() });
    if (e) return fail(e);
    await load();
    onChanged();
  }

  const visible = (rows ?? []).filter((a) => filter === "all" || a.status === "pending" || (a.status === "approved" && !a.settlement));

  return (
    <section className="rounded-2xl border p-4" style={cardStyle}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d95926)" }}><HandCoins size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-black">Anticipos y gastos</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}><b>Anticipos:</b> dinero que la sede ya entregó; se abona al costo de la mercancía. <b>Gastos:</b> transporte, consumo…; se restan de la ganancia como escojas repartirlos.</p>
        </div>
        {can.settle ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAdding("expense")} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)" }}>
              <Receipt size={15} /> Gasto
            </button>
            <button type="button" onClick={() => setAdding("advance")} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d95926)" }}>
              <Plus size={15} /> Anticipo
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[["Por aprobar", totals.waiting, "#eda100"], ["Anticipos por abonar al costo", totals.advances, "#f59e0b"], ["Gastos por descontar", totals.expenses, "#0ea5e9"], ["Ya aplicado", totals.done, "#22c55e"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p>
            <p className="font-black tabular-nums" style={{ color: n(v) ? (c as string) : undefined }}>{cop(v as number)}</p>
          </div>
        ))}
      </div>

      {(rows ?? []).length ? (
        <div className="mt-3 flex gap-1 text-xs font-bold">
          {([["all", `Todos (${(rows ?? []).length})`], ["pending", "Solo pendientes"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-3 py-1" style={filter === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{l}</button>
          ))}
        </div>
      ) : null}

      {visible.length ? (
        <ul className="mt-2 space-y-2">
          {visible.map((a) => {
            const st = statusOf(a);
            const k = KIND[a.kind ?? "advance"];
            return (
              <li key={a.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: `color-mix(in oklab, ${st.color} 45%, var(--t-card-border))`, opacity: a.status === "rejected" || a.status === "voided" ? 0.6 : 1 }}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: `color-mix(in oklab, ${k.color} 18%, transparent)`, color: k.color }}>{k.icon} {k.label} #{a.number}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{a.note}</span>
                  <b className="tabular-nums" style={{ color: "#e66767" }}>−{cop(a.amount)}</b>
                </div>
                <p className="mt-0.5 text-xs font-semibold">👥 {splitText(a, names)}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                  {when(a.given_at)} · {METHODS[a.method] ?? a.method}{a.reference ? ` · ${a.reference}` : ""} · registró {a.created_by_name ?? "—"}
                  {a.decided_by_name ? ` · ${a.status === "rejected" ? "rechazó" : "aprobó"} ${a.decided_by_name}` : ""}{a.decision_note ? ` («${a.decision_note}»)` : ""}{a.void_reason ? ` · anulado: ${a.void_reason}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {a.settlement ? (
                    <button type="button" onClick={() => onOpenSettlement(a.settlement!.id)} className="rounded-full px-2.5 py-1 text-[11px] font-bold underline" style={{ background: `color-mix(in oklab, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</button>
                  ) : (
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${st.color} 16%, transparent)`, color: st.color }}>{st.label}</span>
                  )}
                  {a.support_url ? <a href={a.support_url} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline">📎 Ver soporte</a> : null}
                  <span className="flex-1" />
                  {a.status === "pending" && can.approve ? (
                    <>
                      <button type="button" onClick={() => void decide(a, "approve")} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#22c55e" }}><Check size={13} /> Aprobar</button>
                      <button type="button" onClick={() => void decide(a, "reject")} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Rechazar</button>
                    </>
                  ) : null}
                  {(a.status === "pending" && (a.mine || can.approve)) || (a.status === "approved" && !a.settlement && can.approve) ? (
                    <button type="button" onClick={() => void voidIt(a)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><X size={12} /> Anular</button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : rows && !error ? (
        <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          {rows.length ? "No hay pendientes." : "Sin anticipos ni gastos. Regístralos aquí para que se descuenten solos en la liquidación."}
        </p>
      ) : null}

      <AnimatePresence>
        {adding ? (
          <AdvanceSheet key={adding} kind={adding} storeId={storeId} point={point} beneficiaries={beneficiaries.filter((b) => b.active)} shares={shares}
            onClose={() => setAdding(null)} onSaved={async () => { setAdding(null); await load(); onChanged(); }} />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function AdvanceSheet({ kind: initialKind, storeId, point, beneficiaries, shares, onClose, onSaved }: {
  kind: Kind; storeId: string; point: string | null; beneficiaries: Beneficiary[]; shares: Share[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [now] = useState(nowLocal);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [split, setSplit] = useState<Split>(initialKind === "expense" ? "equal" : "one");
  const [who, setWho] = useState<string>(beneficiaries[0]?.id ?? "");
  const [custom, setCustom] = useState<Record<string, number | null>>(() => Object.fromEntries(beneficiaries.map((b) => [b.id, Math.round(100 / Math.max(1, beneficiaries.length))])));
  const [amount, setAmount] = useState<number | null>(null);
  const [given, setGiven] = useState(now);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [support, setSupport] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileName] = useState(() => `anticipo-${Date.now().toString(36)}.jpg`);

  const name = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario";
  const customSum = Object.values(custom).reduce<number>((t, v) => t + n(v), 0);
  const splitPeople = shares.filter((s) => n(s.pct) > 0);
  const totalPct = splitPeople.reduce((t, s) => t + n(s.pct), 0);

  /** Cuánto le toca a cada uno (vista previa). */
  const parts: Array<{ id: string; pct: number }> =
    split === "one" ? (who ? [{ id: who, pct: 100 }] : [])
      : split === "equal" ? splitPeople.map((s) => ({ id: s.beneficiary_id, pct: 100 / Math.max(1, splitPeople.length) }))
        : split === "custom" ? beneficiaries.filter((b) => n(custom[b.id]) > 0).map((b) => ({ id: b.id, pct: n(custom[b.id]) }))
          : splitPeople.map((s) => ({ id: s.beneficiary_id, pct: (n(s.pct) * 100) / Math.max(1, totalPct) }));
  const splitOk = kind === "advance" ? true : split === "one" ? !!who : split === "custom" ? Math.abs(customSum - 100) < 0.01 : splitPeople.length > 0;
  const ok = n(amount) > 0 && note.trim().length >= 3 && !!given && splitOk;

  async function save() {
    if (!ok) return;
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_settlement_advance_save", {
      p_store: storeId, p_point: point, p_kind: kind, p_split: split, p_beneficiary: split === "one" ? who : null,
      p_shares: split === "custom" ? beneficiaries.filter((b) => n(custom[b.id]) > 0).map((b) => ({ beneficiary_id: b.id, pct: n(custom[b.id]) })) : null,
      p_amount: amount, p_given_at: new Date(given).toISOString(), p_method: method, p_reference: reference.trim() || null, p_note: note.trim(), p_support_url: support,
    });
    setSaving(false);
    if (error) return fail(error);
    void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: `${KIND[kind].label} registrado · falta que otra persona lo apruebe`, timer: 2600, showConfirmButton: false });
    await onSaved();
  }

  const chip = (on: boolean, color = "#f59e0b") => (on ? { borderColor: color, background: `color-mix(in oklab, ${color} 12%, transparent)` } : { borderColor: "var(--t-card-border)" });
  const kc = KIND[kind].color;

  return (
    <FormSheet title={kind === "expense" ? "Registrar gasto" : "Registrar anticipo"} subtitle={kind === "expense" ? "Se resta de la ganancia antes de pagar" : "Dinero que salió antes de liquidar"} icon={kind === "expense" ? <Receipt size={18} /> : <HandCoins size={18} />} onClose={onClose} dirty={!!amount || !!note} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Queda «por aprobar» hasta que otra persona lo apruebe.</span>
        <button type="button" disabled={!ok || saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: kind === "expense" ? "linear-gradient(135deg,#0ea5e9,#6366f1)" : "linear-gradient(135deg,#f59e0b,#d95926)" }}>
          <Check size={15} /> {saving ? "Guardando…" : "Registrar"}
        </button>
      </>
    }>
      <div className="grid grid-cols-2 gap-2">
        {(["expense", "advance"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className="rounded-xl border px-3 py-2 text-left text-sm" style={chip(kind === k, KIND[k].color)}>
            <b className="block">{KIND[k].icon} {KIND[k].label}</b>
            <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{k === "expense" ? "Transporte, consumo, mecatos…" : "Alguien se llevó dinero antes"}</span>
          </button>
        ))}
      </div>
      <Field label="Valor"><MoneyField value={amount} onChange={setAmount} big autoFocus ariaLabel="Valor" /></Field>
      <Field label={kind === "expense" ? "¿En qué se gastó?" : "¿Para qué o quién lo recibió?"}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={kind === "expense" ? "Ej.: transporte de mercancía de la bodega" : "Ej.: la sede le entregó a Robin para el arriendo"} className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={inputStyle} />
      </Field>

      {kind === "advance" ? (
        <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: "color-mix(in oklab, #f59e0b 8%, transparent)" }}>
          💸 <b>Se abona al costo de la mercancía</b>: baja lo que la sede todavía debe entregar por la mercancía vendida. <b>No toca la ganancia</b> de los beneficiarios. Si es más que el costo de la liquidación, lo que sobra se abona en la siguiente.
        </p>
      ) : null}
      {kind === "expense" ? (<>
      <Field label="¿Cómo se reparte?">
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["equal", "⚖️ Mitad y mitad", "Partes iguales entre los del reparto"],
            ["pool", "📊 Según el reparto", "Con los % del pozo"],
            ["custom", "✍️ Otros %", "Escribe el % de cada uno"],
            ["one", "👤 Uno solo", "Se le resta solo a una persona"],
          ] as const).map(([k, t, d]) => (
            <button key={k} type="button" onClick={() => setSplit(k)} className="rounded-xl border px-3 py-2 text-left text-sm" style={chip(split === k, kc)}>
              <b className="block">{t}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{d}</span>
            </button>
          ))}
        </div>
      </Field>
      {split === "one" ? (
        <div className="flex flex-wrap gap-2">
          {beneficiaries.map((b) => <button key={b.id} type="button" onClick={() => setWho(b.id)} className="rounded-full border px-3 py-1.5 text-sm font-semibold" style={chip(who === b.id, kc)}>👤 {b.name}</button>)}
        </div>
      ) : null}
      {split === "custom" ? (
        <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          {beneficiaries.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.name}</span>
              <div className="w-28"><NumberField value={custom[b.id] ?? null} onChange={(v) => setCustom((c) => ({ ...c, [b.id]: v }))} suffix="%" decimals={2} min={0} max={100} /></div>
            </div>
          ))}
          <p className="text-right text-xs font-bold" style={{ color: Math.abs(customSum - 100) < 0.01 ? "#22c55e" : "#e66767" }}>Suman {customSum.toLocaleString("es-CO")} % {Math.abs(customSum - 100) < 0.01 ? "✓" : "(deben sumar 100)"}</p>
        </div>
      ) : null}
      </>) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "expense" ? "Fecha del gasto" : "¿Cuándo salió el dinero?"} hint="Se descuenta en la primera liquidación con corte después de esta fecha."><DateField withTime value={given} max={now} onChange={setGiven} /></Field>
        <Field label="¿Cómo se pagó?">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm" style={inputStyle}>
            {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Referencia (opcional)"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="N.º de transferencia o recibo" className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={inputStyle} /></Field>
      <ImageUpload label="Foto del soporte (opcional)" currentUrl={support} pathPrefix={`${storeId}/anticipos/`} fileName={fileName} onUploaded={setSupport} />

      {kind === "expense" && n(amount) > 0 && parts.length ? (
        <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: `color-mix(in oklab, ${kc} 45%, var(--t-card-border))`, background: `color-mix(in oklab, ${kc} 8%, transparent)` }}>
          <p className="font-bold">Así se descontará</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {parts.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{name(p.id)} · {Math.round(p.pct * 100) / 100} %</span><b className="tabular-nums">−{cop((n(amount) * p.pct) / 100)}</b></li>)}
          </ul>
          <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Si en la próxima liquidación no alcanza, lo que falta queda en contra y se descuenta en las siguientes.</p>
        </div>
      ) : null}
    </FormSheet>
  );
}
