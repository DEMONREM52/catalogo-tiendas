"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Check, HandCoins, Plus, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, Field, MoneyField } from "@/components/forms/Fields";
import { Sheet as FormSheet } from "@/components/forms/Sheet";
import { ImageUpload } from "../store/ImageUpload";
import { cardStyle, cop, esc, inputStyle, rpcError, swalTheme } from "./shared";

export type AdvanceRow = {
  id: string; number: number; beneficiary_id: string | null; beneficiary_name: string | null; amount: number; given_at: string;
  method: string; reference: string | null; note: string; support_url: string | null; status: "pending" | "approved" | "rejected" | "voided";
  created_by_name: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  voided_by_name: string | null; void_reason: string | null; settlement: { id: string; number: number; status: string; cutoff: string } | null; mine: boolean;
};
type Beneficiary = { id: string; name: string; active: boolean };
type Share = { beneficiary_id: string; pct: number };

const METHODS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", nequi: "Nequi / Daviplata", other: "Otro" };
const n = (v: unknown) => Number(v ?? 0);
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const fail = (e: unknown) => void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(e) });

/** Cómo va cada anticipo: por aprobar → por descontar → descontado en la liquidación #N. */
function statusOf(a: AdvanceRow): { label: string; color: string } {
  if (a.status === "pending") return { label: "Por aprobar", color: "#eda100" };
  if (a.status === "rejected") return { label: "Rechazado", color: "#94a3b8" };
  if (a.status === "voided") return { label: "Anulado", color: "#94a3b8" };
  if (a.settlement) return { label: `Descontado en la liquidación #${a.settlement.number}`, color: "#22c55e" };
  return { label: "Por descontar en la próxima liquidación", color: "#8b5cf6" };
}

/**
 * Anticipos del pozo: dinero que salió antes de liquidar y que se descuenta en la siguiente liquidación,
 * de un beneficiario o de todo el pozo (según los %). Lo registra quien prepara y lo aprueba otra persona.
 */
export function AdvancesSection({ storeId, point, beneficiaries, shares, can, refreshKey, onChanged, onOpenSettlement }: {
  storeId: string; point: string | null; beneficiaries: Beneficiary[]; shares: Share[];
  can: { settle: boolean; approve: boolean }; refreshKey: number; onChanged: () => void; onOpenSettlement: (id: string) => void;
}) {
  const [rows, setRows] = useState<AdvanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_settlement_advances_list", { p_store: storeId, p_point: point });
    if (e) { setError(/erp_settlement_advances_list|schema cache|does not exist/i.test(e.message) ? "Para registrar anticipos ejecuta en Supabase la migración 20261286_anticipos_liquidacion.sql." : rpcError(e)); setRows([]); return; }
    setError(null);
    setRows((data ?? []) as AdvanceRow[]);
  }, [storeId, point]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      waiting: list.filter((a) => a.status === "pending").reduce((t, a) => t + n(a.amount), 0),
      toDeduct: list.filter((a) => a.status === "approved" && !a.settlement).reduce((t, a) => t + n(a.amount), 0),
      done: list.filter((a) => a.status === "approved" && a.settlement).reduce((t, a) => t + n(a.amount), 0),
    };
  }, [rows]);

  async function decide(a: AdvanceRow, action: "approve" | "reject") {
    let note: string | null = null;
    if (action === "reject") {
      const r = await Swal.fire({ ...swalTheme, title: "¿Por qué lo rechazas?", input: "text", inputPlaceholder: "Motivo", showCancelButton: true, confirmButtonText: "Rechazar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim().length < 3 ? "Escribe al menos 3 letras" : null) });
      if (!r.isConfirmed) return;
      note = String(r.value).trim();
    } else {
      const r = await Swal.fire({ ...swalTheme, icon: "question", title: `¿Aprobar el anticipo #${a.number}?`,
        html: `${esc(cop(a.amount))} · ${esc(a.beneficiary_name ?? "todo el pozo (según los %)")}<br/><small>Se descontará en la próxima liquidación con corte después del ${esc(when(a.given_at))}.</small>`,
        showCancelButton: true, confirmButtonText: "Aprobar", cancelButtonText: "Cancelar", confirmButtonColor: "#22c55e" });
      if (!r.isConfirmed) return;
    }
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_advance_decide", { p_id: a.id, p_action: action, p_note: note });
    if (e) return fail(e);
    await load();
    onChanged();
  }
  async function voidIt(a: AdvanceRow) {
    const r = await Swal.fire({ ...swalTheme, icon: "warning", title: `Anular el anticipo #${a.number}`, input: "text", inputPlaceholder: "Motivo (ej.: se registró dos veces)", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444", inputValidator: (v) => (v.trim().length < 3 ? "Escribe el motivo" : null) });
    if (!r.isConfirmed) return;
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_advance_void", { p_id: a.id, p_reason: String(r.value).trim() });
    if (e) return fail(e);
    await load();
    onChanged();
  }

  const visible = (rows ?? []).filter((a) => showAll || a.status === "pending" || (a.status === "approved" && !a.settlement));
  const hidden = (rows ?? []).length - visible.length;

  return (
    <section className="rounded-2xl border p-4" style={cardStyle}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d95926)" }}><HandCoins size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-black">Anticipos</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Dinero que salió antes de liquidar. Se descuenta solo en la próxima liquidación; si no alcanza, el resto pasa a la siguiente.</p>
        </div>
        {can.settle ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d95926)" }}>
            <Plus size={15} /> Registrar anticipo
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}

      {rows && rows.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[["Por aprobar", totals.waiting, "#eda100"], ["Por descontar", totals.toDeduct, "#8b5cf6"], ["Ya descontado", totals.done, "#22c55e"]].map(([l, v, c]) => (
            <div key={l as string} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p>
              <p className="font-black tabular-nums" style={{ color: n(v) ? (c as string) : undefined }}>{cop(v as number)}</p>
            </div>
          ))}
        </div>
      ) : null}

      {visible.length ? (
        <ul className="mt-3 space-y-2">
          {visible.map((a) => {
            const st = statusOf(a);
            return (
              <li key={a.id} className="rounded-xl border p-3 text-sm" style={{ borderColor: `color-mix(in oklab, ${st.color} 45%, var(--t-card-border))`, opacity: a.status === "rejected" || a.status === "voided" ? 0.6 : 1 }}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b>#{a.number}</b>
                  <span className="min-w-0 flex-1 truncate font-semibold">{a.beneficiary_name ?? "Todo el pozo (según los %)"}</span>
                  <b className="tabular-nums" style={{ color: "#e66767" }}>−{cop(a.amount)}</b>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
                  Salió el {when(a.given_at)} · {METHODS[a.method] ?? a.method}{a.reference ? ` · ${a.reference}` : ""} · {a.note}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  Registró {a.created_by_name ?? "—"}{a.decided_by_name ? ` · ${a.status === "rejected" ? "rechazó" : "aprobó"} ${a.decided_by_name}` : ""}{a.decision_note ? ` («${a.decision_note}»)` : ""}{a.void_reason ? ` · anulado: ${a.void_reason}` : ""}
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
          {rows.length ? "No hay anticipos pendientes." : "Sin anticipos. Si alguien recibe dinero antes de liquidar, regístralo aquí para que se descuente solo."}
        </p>
      ) : null}
      {hidden > 0 || showAll ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-bold underline" style={{ color: "var(--t-muted)" }}>
          {showAll ? "Ver solo los pendientes" : `Ver historial (${hidden} descontados, rechazados o anulados)`}
        </button>
      ) : null}

      <AnimatePresence>
        {adding ? (
          <AdvanceSheet key="adv" storeId={storeId} point={point} beneficiaries={beneficiaries.filter((b) => b.active)} shares={shares}
            onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load(); onChanged(); }} />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function AdvanceSheet({ storeId, point, beneficiaries, shares, onClose, onSaved }: {
  storeId: string; point: string | null; beneficiaries: Beneficiary[]; shares: Share[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [now] = useState(nowLocal);
  const [who, setWho] = useState<string>("pool");
  const [amount, setAmount] = useState<number | null>(null);
  const [given, setGiven] = useState(now);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [support, setSupport] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileName] = useState(() => `anticipo-${Date.now().toString(36)}.jpg`);

  const totalPct = shares.reduce((t, s) => t + n(s.pct), 0);
  const name = (id: string) => beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario";
  const ok = n(amount) > 0 && note.trim().length >= 3 && !!given;

  async function save() {
    if (!ok) return;
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_settlement_advance_save", {
      p_store: storeId, p_point: point, p_beneficiary: who === "pool" ? null : who, p_amount: amount, p_given_at: new Date(given).toISOString(),
      p_method: method, p_reference: reference.trim() || null, p_note: note.trim(), p_support_url: support,
    });
    setSaving(false);
    if (error) return fail(error);
    void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: "Anticipo registrado · falta que otra persona lo apruebe", timer: 2600, showConfirmButton: false });
    await onSaved();
  }

  return (
    <FormSheet title="Registrar anticipo" subtitle="Dinero que salió antes de liquidar" icon={<HandCoins size={18} />} onClose={onClose} dirty={!!amount || !!note} footer={
      <>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>Queda «por aprobar» hasta que otra persona lo apruebe.</span>
        <button type="button" disabled={!ok || saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#f59e0b,#d95926)" }}>
          <Check size={15} /> {saving ? "Guardando…" : "Registrar"}
        </button>
      </>
    }>
      <Field label="¿De quién se descuenta?">
        <div className="grid gap-2 sm:grid-cols-2">
          {[{ id: "pool", title: "Todo el pozo", text: "Se reparte según los % del reparto" }, ...beneficiaries.map((b) => ({ id: b.id, title: b.name, text: "Solo de su parte" }))].map((o) => (
            <button key={o.id} type="button" onClick={() => setWho(o.id)} className="rounded-xl border px-3 py-2 text-left text-sm transition"
              style={who === o.id ? { borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
              <b className="block">{o.id === "pool" ? "👥 " : "👤 "}{o.title}</b>
              <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{o.text}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Valor que salió"><MoneyField value={amount} onChange={setAmount} big autoFocus ariaLabel="Valor del anticipo" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="¿Cuándo salió el dinero?" hint="Se descuenta en la primera liquidación con corte después de esta fecha."><DateField withTime value={given} max={now} onChange={setGiven} /></Field>
        <Field label="¿Cómo se entregó?">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm" style={inputStyle}>
            {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Para qué o quién lo recibió"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ej.: la sede entregó a Robin para pagar el arriendo" className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={inputStyle} /></Field>
      <Field label="Referencia (opcional)"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="N.º de transferencia o recibo" className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={inputStyle} /></Field>
      <ImageUpload label="Foto del soporte (opcional)" currentUrl={support} pathPrefix={`${storeId}/anticipos/`} fileName={fileName} onUploaded={setSupport} />

      {n(amount) > 0 ? (
        <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: "color-mix(in oklab, #f59e0b 8%, transparent)" }}>
          <p className="font-bold">Así se descontará</p>
          {who === "pool" ? (
            totalPct > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs">
                {shares.filter((s) => n(s.pct) > 0).map((s) => (
                  <li key={s.beneficiary_id} className="flex justify-between gap-2"><span>{name(s.beneficiary_id)} · {n(s.pct)} %</span><b className="tabular-nums">−{cop((n(amount) * n(s.pct)) / totalPct)}</b></li>
                ))}
              </ul>
            ) : <p className="mt-1 text-xs text-amber-500">Primero define el reparto de este pozo.</p>
          ) : (
            <p className="mt-1 text-xs">Se le restan <b>{cop(amount)}</b> a <b>{name(who)}</b>. A los demás les llega completo.</p>
          )}
          <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Si la próxima liquidación no alcanza, lo que falta queda en contra y se sigue descontando en las siguientes.</p>
        </div>
      ) : null}
    </FormSheet>
  );
}
