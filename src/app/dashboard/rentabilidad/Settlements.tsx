"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, ChevronDown, Download, FileCheck2, History, Plus, RefreshCw, Undo2, Users, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cardStyle, cop, downloadCsv, esc, inputStyle, rpcError, swalTheme, type Point } from "./shared";
import { DateField, Field, NumberField } from "@/components/forms/Fields";
import { PaymentSheet, Sheet as FormSheet } from "@/components/forms/Sheet";
import { ExportGate } from "@/components/ExportGate";
import { logExport } from "@/lib/permission-runtime";
import { BreakdownSheet } from "./Breakdown";
import { openSettlementReport } from "./report";

type Beneficiary = { id: string; name: string; kind: string; document: string | null; notes: string | null; active: boolean };
type Share = { beneficiary_id: string; pct: number };
type PreviewLine = { beneficiary_id: string; name: string; pct: number; share_amount: number; carried_amount: number; amount: number };
type Overview = {
  beneficiaries: Beneficiary[];
  split: { id: string; version: number; shares: Share[]; total_pct: number; reason: string; created_by_name: string | null; created_at: string } | null;
  split_history: Array<{ version: number; total_pct: number; reason: string; created_by_name: string | null; created_at: string }>;
  pending: {
    pool_total: number; carried_total: number; assigned_total: number; orders: number; lines: PreviewLine[];
    gross_total?: number; expenses_total?: number; expenses?: number; no_cost?: Array<{ order_id: string; product_id: string; name: string; qty: number; revenue: number }>;
  };
  /** Cómo se liquida el pozo (20261208): ganancia total o sobre el precio de la madre, y si se restan gastos. */
  settings?: { mode: "total" | "margin" | "mother"; mode_from: string | null; deduct_expenses: boolean; deduct_from: string | null; updated_by_name: string | null; updated_at: string | null; can_edit: boolean };
  open_settlement: { id: string; number: number; status: string } | null;
  can: { beneficiaries: boolean; settle: boolean; approve: boolean; pay: boolean };
};
type Row = { id: string; number: number; cutoff: string; status: Status; pool_total: number; carried_total: number; assigned_total: number; unassigned_total: number; sources_count: number; created_at: string; created_by_name: string | null; decided_by_name: string | null; to_pay: number; paid: number };
type Status = "calculated" | "review" | "approved" | "partially_paid" | "paid" | "rejected" | "reverted";
type Detail = {
  settlement: Row & { point_id: string | null; point_name: string | null; split_version: number | null; notes: string | null; decision_note: string | null; revert_reason: string | null; submitted_by_name: string | null; reverted_by_name: string | null;
    gross_total?: number | null; expenses_total?: number | null; mode?: string | null; deducted?: boolean };
  lines: Array<{ id: string; beneficiary_id: string; name: string; kind: string; document: string | null; pct: number; share_amount: number; carried_amount: number; amount: number; paid: number; carried_into: string | null }>;
  payments: Array<{ id: string; line_id: string; amount: number; method: string; reference: string | null; note: string | null; paid_at: string; created_by_name: string | null; voided: boolean; void_reason: string | null }>;
  sources: Array<{ order_id: string; eligible: number; delta: number; receipt_no: number | null; status: string; sold_at: string; doc_number: string | null; point_name: string | null; credit: boolean }>;
};

const STATUS: Record<Status, { label: string; color: string }> = {
  calculated: { label: "Calculada", color: "#3987e5" },
  review: { label: "En revisión", color: "#eda100" },
  approved: { label: "Aprobada · por pagar", color: "#8b5cf6" },
  partially_paid: { label: "Pago parcial", color: "#d95926" },
  paid: { label: "Pagada", color: "#22c55e" },
  rejected: { label: "Rechazada / descartada", color: "#94a3b8" },
  reverted: { label: "Revertida", color: "#94a3b8" },
};
const METHODS: Record<string, string> = { transfer: "Transferencia", cash: "Efectivo", nequi: "Nequi / Daviplata", other: "Otro" };
const KINDS: Record<string, string> = { owner: "Dueño", partner: "Socio", manager: "Responsable", point: "Punto", person: "Persona", other: "Otro" };
const n = (v: unknown) => Number(v ?? 0);
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");
const label = "text-xs font-bold uppercase tracking-wide";

async function ask(title: string, placeholder = "Motivo", required = true) {
  const r = await Swal.fire({ ...swalTheme, title: esc(title), input: "text", inputPlaceholder: placeholder, showCancelButton: true, confirmButtonText: "Confirmar", cancelButtonText: "Cancelar",
    inputValidator: (v) => (required && v.trim().length < 3 ? "Escribe al menos 3 letras" : null) });
  return r.isConfirmed ? String(r.value ?? "").trim() : null;
}
const fail = (e: unknown) => void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(e) });

/** Repartos y liquidaciones: cada pozo (madre o punto) con sus beneficiarios, su reparto y sus liquidaciones. */
export function Settlements({ storeId, points, myPoints }: { storeId: string; points: Point[]; myPoints: string[] | null }) {
  const pools = useMemo(() => [...(myPoints ? [] : [{ id: "", name: "🏬 Madre" }]), ...points.filter((p) => !myPoints || myPoints.includes(p.id)).map((p) => ({ id: p.id, name: `📍 ${p.name}` }))], [points, myPoints]);
  const [pool, setPool] = useState(pools[0]?.id ?? "");
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const point = pool || null;

  const load = useCallback(async () => {
    setLoading(true);
    const sb = supabaseBrowser();
    const [o, l] = await Promise.all([sb.rpc("erp_pool_overview", { p_store: storeId, p_point: point }), sb.rpc("erp_settlements_list", { p_store: storeId, p_point: point })]);
    setLoading(false);
    if (o.error) return setError(rpcError(o.error));
    setError(null);
    setOv(o.data as Overview);
    setRows(((l.data ?? []) as Row[]) ?? []);
  }, [storeId, point]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const [preparing, setPreparing] = useState(false);
  const [breakdown, setBreakdown] = useState<{ id: string | null; title: string } | null>(null);
  async function prepare(cut: string, note: string) {
    const { data, error: e } = await supabaseBrowser().rpc("erp_settlement_calculate", { p_store: storeId, p_point: point, p_cutoff: cut ? new Date(cut).toISOString() : null, p_notes: note || null });
    if (e) { fail(e); return false; }
    setPreparing(false);
    await load();
    setOpenId((data as { id: string }).id);
    return true;
  }

  if (!pools.length) return <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>No tienes pozos asignados.</p>;
  const pending = ov?.pending;
  const open = ov?.open_settlement;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold [scrollbar-width:none]" style={{ borderColor: "var(--t-card-border)" }}>
          {pools.map((p) => (
            <button key={p.id || "madre"} type="button" onClick={() => { setPool(p.id); setOv(null); }} className="shrink-0 rounded-full px-3 py-1.5" style={pool === p.id ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{p.name}</button>
          ))}
        </div>
        <span className="order-last basis-full text-xs sm:order-none sm:basis-auto sm:flex-1" style={{ color: "var(--t-muted)" }}>
          {!point ? "Pozo de la madre: precio de la madre − costo, de las ventas de los puntos que no liquidan su ganancia total."
            : ov?.settings?.mode === "total" ? "Pozo del punto: ganancia total de sus ventas (venta − costo al vender)."
            : "Pozo del punto: lo que el punto agrega sobre el precio de la madre."}
        </span>
        <button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>

      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error.includes("20261106") ? "Falta ejecutar en Supabase la migración 20261109_repartos_liquidaciones.sql." : error}</p> : null}

      {ov && pending ? (
        <>
          {ov.settings ? <PoolSettings storeId={storeId} point={point} settings={ov.settings} hasOpen={Boolean(open)} onSaved={() => void load()} /> : null}
          <section className="rounded-2xl border p-4" style={cardStyle}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className={label} style={{ color: "var(--t-muted)" }}>Por liquidar hoy</p>
                <p className="mt-1 text-3xl font-black tabular-nums" style={n(pending.pool_total) + n(pending.carried_total) < 0 ? { color: "#e66767" } : undefined}>{cop(n(pending.pool_total) + n(pending.carried_total))}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {pending.orders} venta{pending.orders === 1 ? "" : "s"} con movimiento · contado + crédito cobrado{n(pending.carried_total) ? ` · saldo en contra traído ${cop(pending.carried_total)}` : ""}
                </p>
                {ov.settings?.deduct_expenses || n(pending.expenses_total) ? (
                  <p className="mt-1 text-sm tabular-nums">
                    Ganancia bruta <b>{cop(pending.gross_total)}</b> − gastos y nómina <b style={{ color: "#e66767" }}>{cop(pending.expenses_total)}</b>
                    {" "}= <b>{cop(pending.pool_total)}</b> a repartir
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                {open ? (
                  <button type="button" onClick={() => setOpenId(open.id)} className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: STATUS[open.status as Status]?.color ?? "#3987e5" }}>Ver liquidación #{open.number} abierta</button>
                ) : ov.can.settle ? (
                  <button type="button" disabled={!ov.split || Boolean(pending.no_cost?.length)} onClick={() => setPreparing(true)} className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}
                    title={!ov.split ? "Define primero el reparto" : pending.no_cost?.length ? "Hay productos vendidos sin costo" : ""}>
                    <FileCheck2 size={16} /> Preparar liquidación
                  </button>
                ) : null}
                {pending.gross_total !== undefined && (pending.orders > 0 || n(pending.expenses)) ? (
                  <button type="button" onClick={() => setBreakdown({ id: null, title: `Pendiente por liquidar · ${pools.find((p) => p.id === pool)?.name ?? ""}` })}
                    className="rounded-full border px-4 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    🔎 Ver detalle por producto
                  </button>
                ) : null}
              </div>
            </div>
            {pending.no_cost?.length ? (
              <NoCostWarning storeId={storeId} point={point} items={pending.no_cost} canFix={ov.can.settle} onFixed={() => void load()} />
            ) : null}
            {pending.lines.length ? (
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {pending.lines.map((l) => (
                  <li key={l.beneficiary_id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{n(l.pct)} %</span>
                    <b className="tabular-nums" style={n(l.amount) < 0 ? { color: "#e66767" } : undefined}>{cop(l.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : null}
            {n(pending.pool_total) - n(pending.assigned_total) !== 0 && ov.split ? (
              <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Sin asignar (queda en el pozo): {cop(n(pending.pool_total) - n(pending.assigned_total))}</p>
            ) : null}
          </section>

          <SplitEditor storeId={storeId} point={point} ov={ov} onSaved={() => void load()} />

          <section>
            <p className={`${label} mb-2 flex items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><History size={13} /> Liquidaciones</p>
            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Aún no hay liquidaciones de este pozo.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border p-3 text-left text-sm transition hover:-translate-y-0.5" style={cardStyle}>
                      <b>#{r.number}</b>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${STATUS[r.status].color} 18%, transparent)`, color: STATUS[r.status].color }}>{STATUS[r.status].label}</span>
                      <span className="text-xs" style={{ color: "var(--t-muted)" }}>corte {when(r.cutoff)} · {r.sources_count} ventas</span>
                      <span className="ml-auto tabular-nums font-bold">{cop(n(r.pool_total) + n(r.carried_total))}</span>
                      {n(r.to_pay) > 0 ? <span className="w-full text-xs sm:w-auto" style={{ color: "var(--t-muted)" }}>pagado {cop(r.paid)} de {cop(r.to_pay)}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} />)}</div>
      ) : null}

      <AnimatePresence>{preparing ? <PrepareSheet key="prep" poolName={pools.find((p) => p.id === pool)?.name ?? ""} onClose={() => setPreparing(false)} onConfirm={prepare} /> : null}</AnimatePresence>
      <AnimatePresence>{openId && ov ? <SettlementSheet key={openId} id={openId} can={ov.can} onClose={() => setOpenId(null)} onChanged={() => void load()}
        onBreakdown={(sid, t) => setBreakdown({ id: sid, title: t })} /> : null}</AnimatePresence>
      <AnimatePresence>{breakdown ? <BreakdownSheet key={breakdown.id ?? "pend"} storeId={storeId} point={point} settlementId={breakdown.id} title={breakdown.title} onClose={() => setBreakdown(null)} /> : null}</AnimatePresence>
    </div>
  );
}

function SplitEditor({ storeId, point, ov, onSaved }: { storeId: string; point: string | null; ov: Overview; onSaved: () => void }) {
  const current = useMemo(() => new Map((ov.split?.shares ?? []).map((s) => [s.beneficiary_id, Number(s.pct)])), [ov.split]);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("partner");
  const [doc, setDoc] = useState("");
  const [showHist, setShowHist] = useState(false);
  const active = ov.beneficiaries.filter((b) => b.active);
  const values = draft ?? Object.fromEntries(active.map((b) => [b.id, current.get(b.id) ?? 0]));
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);
  const dirty = draft !== null;
  const can = ov.can.beneficiaries;

  async function addBeneficiary() {
    const { error } = await supabaseBrowser().rpc("erp_beneficiary_save", { p_store: storeId, p_id: null, p_point: point, p_name: name, p_kind: kind, p_document: doc || null, p_notes: null, p_active: true });
    if (error) return fail(error);
    setName(""); setDoc(""); setAdding(false);
    onSaved();
  }
  async function toggle(b: Beneficiary) {
    if (b.active && (current.get(b.id) ?? 0) > 0) return void Swal.fire({ ...swalTheme, icon: "info", title: "Tiene participación", text: "Ponle 0 % y guarda el reparto antes de desactivarlo." });
    const { error } = await supabaseBrowser().rpc("erp_beneficiary_save", { p_store: storeId, p_id: b.id, p_point: point, p_name: b.name, p_kind: b.kind, p_document: b.document, p_notes: b.notes, p_active: !b.active });
    if (error) return fail(error);
    onSaved();
  }
  async function save() {
    const reason = await ask("Motivo del nuevo reparto", "Ej.: entra un socio nuevo");
    if (!reason) return;
    const shares = Object.entries(values).map(([beneficiary_id, pct]) => ({ beneficiary_id, pct: Number(pct) || 0 }));
    const { error } = await supabaseBrowser().rpc("erp_split_save", { p_store: storeId, p_point: point, p_shares: shares, p_reason: reason });
    if (error) return fail(error);
    setDraft(null);
    void Swal.fire({ ...swalTheme, icon: "success", title: "Reparto guardado", text: "Se usa desde la próxima liquidación. Las anteriores conservan el suyo.", timer: 2200, showConfirmButton: false });
    onSaved();
  }

  return (
    <section className="space-y-3 rounded-2xl border p-4" style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={`${label} flex flex-1 items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><Users size={13} /> Beneficiarios y reparto {ov.split ? `· versión ${ov.split.version}` : ""}</p>
        {can ? <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Plus size={13} /> Beneficiario</button> : null}
      </div>
      <AnimatePresence initial={false}>
        {adding ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto_auto_auto]" style={{ borderColor: "var(--t-card-border)" }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Documento (opcional)" className="rounded-lg border px-3 py-2 text-sm sm:w-40" style={inputStyle} />
              <button type="button" disabled={name.trim().length < 2} onClick={() => void addBeneficiary()} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "var(--t-accent)" }}>Agregar</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {ov.beneficiaries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>Agrega a las personas que reciben parte de este pozo (socios, responsables…).</p>
      ) : (
        <ul className="space-y-1.5">
          {ov.beneficiaries.map((b) => (
            <li key={b.id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", opacity: b.active ? 1 : 0.55 }}>
              <span className="min-w-0 flex-1">
                <b className="block truncate">{b.name}</b>
                <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{KINDS[b.kind] ?? b.kind}{b.document ? ` · ${b.document}` : ""}{b.active ? "" : " · inactivo"}</span>
              </span>
              {b.active ? (
                <div className="w-28">
                  <NumberField value={values[b.id] ?? 0} onChange={(v) => setDraft({ ...values, [b.id]: v ?? 0 })} suffix="%" min={0} max={100} decimals={4} disabled={!can} ariaLabel={`Porcentaje de ${b.name}`} />
                </div>
              ) : null}
              {can ? <button type="button" onClick={() => void toggle(b)} className="rounded-lg border px-2 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>{b.active ? "Desactivar" : "Activar"}</button> : null}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }} role="img" aria-label={`Asignado ${total} %`}>
          <div className="h-full rounded-[4px]" style={{ width: `${Math.min(100, total)}%`, background: total > 100 ? "#e66767" : "#3987e5" }} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span style={{ color: total > 100 ? "#e66767" : "var(--t-muted)" }}>{total > 100 ? `Pasa del 100 % (${total} %)` : `Asignado ${total.toLocaleString("es-CO")} % · sin asignar ${(100 - total).toLocaleString("es-CO")} %`}</span>
          <span className="flex-1" />
          {dirty && can ? (
            <>
              <button type="button" onClick={() => setDraft(null)} className="rounded-full border px-3 py-1.5 font-bold" style={{ borderColor: "var(--t-card-border)" }}>Deshacer</button>
              <button type="button" disabled={total > 100} onClick={() => void save()} className="rounded-full px-4 py-1.5 font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>Guardar reparto</button>
            </>
          ) : null}
        </div>
      </div>
      {ov.split_history.length ? (
        <div>
          <button type="button" onClick={() => setShowHist((v) => !v)} className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: "var(--t-muted)" }}>Historial del reparto <ChevronDown size={12} className={showHist ? "rotate-180" : ""} /></button>
          {showHist ? (
            <ul className="mt-1 space-y-1 text-xs" style={{ color: "var(--t-muted)" }}>
              {ov.split_history.map((h) => <li key={h.version}>v{h.version} · {n(h.total_pct)} % asignado · «{h.reason}» · {h.created_by_name ?? "—"}, {when(h.created_at)}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SettlementSheet({ id, can, onClose, onChanged, onBreakdown }: {
  id: string; can: Overview["can"]; onClose: () => void; onChanged: () => void; onBreakdown: (id: string, title: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_settlement_detail", { p_id: id });
    if (e) return setError(rpcError(e));
    setD(data as Detail);
  }, [id]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(action: "submit" | "approve" | "reject" | "discard" | "revert") {
    const needs = action === "reject" || action === "discard" || action === "revert";
    const titles = { submit: "¿Enviar a revisión?", approve: "¿Aprobar la liquidación?", reject: "¿Por qué la rechazas?", discard: "¿Por qué la descartas?", revert: "¿Por qué la reviertes?" };
    let note: string | null = "";
    if (needs) note = await ask(titles[action]);
    else {
      const ok = await Swal.fire({ ...swalTheme, icon: "question", title: titles[action], text: action === "approve" ? "Después ya no se recalcula: los cambios futuros entran como ajuste en la siguiente." : "", showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No" });
      if (!ok.isConfirmed) return;
    }
    if (note === null) return;
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_transition", { p_id: id, p_action: action, p_note: note || null });
    if (e) return fail(e);
    await load();
    onChanged();
  }

  const [paying, setPaying] = useState<Detail["lines"][number] | null>(null);
  async function pay(line: Detail["lines"][number], p: { amount: number; method: string; ref: string; key: string }) {
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_pay", { p_line: line.id, p_amount: p.amount, p_method: p.method, p_reference: p.ref || null, p_note: null, p_paid_at: null, p_idempotency_key: p.key });
    if (e) { fail(e); return false; }
    await load();
    onChanged();
  }

  async function voidPay(pid: string) {
    const reason = await ask("¿Por qué anulas este pago?");
    if (!reason) return;
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_payment_void", { p_payment: pid, p_reason: reason });
    if (e) return fail(e);
    await load();
    onChanged();
  }

  /** Informe completo para guardar como PDF: resumen, reparto, pagos, ventas con sus productos, gastos y firmas. */
  async function pdf() {
    if (!d) return;
    logExport("liquidacion_pdf", d.lines.length, { settlement: d.settlement.number });
    const err = await openSettlementReport(d);
    if (err) fail(err);
  }

  function exportCsv() {
    if (!d) return;
    const s = d.settlement;
    logExport("liquidacion", d.lines.length, { settlement: s.number });
    downloadCsv(`liquidacion-${s.number}.csv`, ["Beneficiario", "Documento", "%", "Parte del periodo", "Saldo traído", "Total", "Pagado", "Pendiente"],
      d.lines.map((l) => [l.name, l.document ?? "", n(l.pct), n(l.share_amount), n(l.carried_amount), n(l.amount), n(l.paid), Math.max(0, n(l.amount) - n(l.paid))]),
      [`RemHub · Liquidación #${s.number} · ${s.point_name ? `Punto ${s.point_name}` : "Madre"}`, `Corte: ${when(s.cutoff)} · Estado: ${STATUS[s.status].label}`,
       `Generado: ${new Date().toLocaleString("es-CO")}`, "Incluye ventas de contado confirmadas y lo cobrado de ventas a crédito; las anuladas restan si ya se habían liquidado.",
       "Los pagos son registros en RemHub, no confirmación bancaria."]);
  }

  const s = d?.settlement;
  const st = s ? STATUS[s.status] : null;
  const open = s && (s.status === "calculated" || s.status === "review");
  const payable = s && (s.status === "approved" || s.status === "partially_paid");

  return createPortal(
    <motion.div className="fixed inset-0 z-140 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label="Liquidación" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black">Liquidación {s ? `#${s.number}` : ""} {s ? <span className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>· {s.point_name ? `Punto ${s.point_name}` : "Madre"}</span> : null}</h2>
            {s && st ? <p className="text-xs"><span className="font-bold" style={{ color: st.color }}>{st.label}</span> · corte {when(s.cutoff)} · preparó {s.created_by_name ?? "—"}{s.decided_by_name ? ` · decidió ${s.decided_by_name}` : ""}</p> : null}
          </div>
          <ExportGate><button type="button" onClick={() => void pdf()} disabled={!d} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }} aria-label="Informe PDF">📄 Informe PDF</button></ExportGate>
          <ExportGate><button type="button" onClick={exportCsv} disabled={!d} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Exportar a Excel" title="Excel"><Download size={15} /></button></ExportGate>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
          {d && s ? (
            <>
              {s.gross_total !== null && s.gross_total !== undefined ? (
                <div className="rounded-xl border p-3 text-sm tabular-nums" style={cardStyle}>
                  <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>
                    {s.mode === "total" ? "Ganancia total del punto (venta − costo)" : s.mode === "mother" ? "Parte de la madre" : "Lo que el punto agrega sobre la madre"}
                  </p>
                  <p className="mt-1">
                    Ganancia <b>{cop(s.gross_total)}</b>
                    {s.deducted || n(s.expenses_total) ? <> − gastos y nómina <b style={{ color: "#e66767" }}>{cop(s.expenses_total)}</b></> : null}
                    {" "}= <b>{cop(s.pool_total)}</b> a repartir
                  </p>
                </div>
              ) : null}
              <button type="button" onClick={() => onBreakdown(s.id, `Liquidación #${s.number} · ${s.point_name ? `Punto ${s.point_name}` : "Madre"} · corte ${when(s.cutoff)}`)}
                className="w-full rounded-xl border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                🔎 Ver detalle por producto (venta, costo y ganancia de cada factura) · Excel · PDF
              </button>
              <ExportGate>
                <button type="button" onClick={() => void pdf()} className="w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>
                  📄 Descargar informe completo en PDF
                </button>
              </ExportGate>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Del periodo", s.pool_total], ["Saldo traído", s.carried_total], ["Asignado", s.assigned_total], ["Sin asignar", s.unassigned_total]].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl border p-2.5" style={cardStyle}>
                    <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{l as string}</p>
                    <p className="font-black tabular-nums" style={n(v) < 0 ? { color: "#e66767" } : undefined}>{cop(v as number)}</p>
                  </div>
                ))}
              </div>
              {s.decision_note || s.revert_reason || s.notes ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{[s.notes && `Nota: ${s.notes}`, s.decision_note && `Decisión: ${s.decision_note}`, s.revert_reason && `Reversión: ${s.revert_reason}`].filter(Boolean).join(" · ")}</p> : null}

              <div className="flex flex-wrap gap-2">
                {s.status === "calculated" && can.settle ? <button type="button" onClick={() => void act("submit")} className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "#eda100" }}>Enviar a revisión</button> : null}
                {open && can.approve ? (
                  <>
                    <button type="button" onClick={() => void act("approve")} className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "#22c55e" }}><Check size={15} /> Aprobar</button>
                    <button type="button" onClick={() => void act("reject")} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Rechazar</button>
                  </>
                ) : null}
                {open && can.settle ? <button type="button" onClick={() => void act("discard")} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Descartar y recalcular después</button> : null}
                {s.status !== "rejected" && s.status !== "reverted" && !open && can.approve ? <button type="button" onClick={() => void act("revert")} className="inline-flex items-center gap-1 rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}><Undo2 size={14} /> Revertir</button> : null}
              </div>

              <ul className="space-y-2">
                {d.lines.map((l) => {
                  const left = n(l.amount) - n(l.paid);
                  return (
                    <li key={l.id} className="rounded-2xl border p-3" style={cardStyle}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <b className="min-w-0 flex-1 truncate">{l.name}</b>
                        <span className="text-xs" style={{ color: "var(--t-muted)" }}>{n(l.pct)} %</span>
                        <b className="tabular-nums" style={n(l.amount) < 0 ? { color: "#e66767" } : undefined}>{cop(l.amount)}</b>
                      </div>
                      {n(l.carried_amount) ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>periodo {cop(l.share_amount)} · saldo traído {cop(l.carried_amount)}</p> : null}
                      {l.carried_into ? <p className="text-[11px] text-amber-400">Saldo en contra: se compensa en la siguiente liquidación</p> : null}
                      {n(l.amount) > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
                            <div className="h-full rounded-[4px]" style={{ width: `${Math.min(100, (n(l.paid) / n(l.amount)) * 100)}%`, background: "#22c55e" }} />
                          </div>
                          <span className="text-xs tabular-nums" style={{ color: "var(--t-muted)" }}>pagado {cop(l.paid)}{left > 0 ? ` · falta ${cop(left)}` : ""}</span>
                          {payable && can.pay && left > 0 ? (
                            <button type="button" onClick={() => setPaying(l)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#8b5cf6" }}><Banknote size={13} /> Pagar</button>
                          ) : left <= 0 ? <span className="text-xs font-bold text-emerald-400">✓ Pagado</span> : null}
                        </div>
                      ) : null}
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
                        <span>{d.lines.find((l) => l.id === p.line_id)?.name}</span>
                        <span className="text-xs" style={{ color: "var(--t-muted)" }}>{METHODS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""} · {when(p.paid_at)} · {p.created_by_name}</span>
                        {p.voided ? <span className="text-xs text-red-400">anulado: {p.void_reason}</span> : can.approve ? <button type="button" onClick={() => void voidPay(p.id)} className="ml-auto text-xs font-bold underline">Anular</button> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section>
                <button type="button" onClick={() => setShowSources((v) => !v)} className={`${label} inline-flex items-center gap-1`} style={{ color: "var(--t-muted)" }}>Ventas incluidas ({d.sources.length}) <ChevronDown size={12} className={showSources ? "rotate-180" : ""} /></button>
                {showSources ? (
                  <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto text-xs">
                    {d.sources.map((x) => (
                      <li key={x.order_id} className="flex flex-wrap gap-x-2 rounded-lg border px-3 py-1.5" style={{ borderColor: "var(--t-card-border)" }}>
                        <b>{x.doc_number ?? `#${x.receipt_no}`}</b>
                        <span style={{ color: "var(--t-muted)" }}>{when(x.sold_at)}{x.point_name ? ` · ${x.point_name}` : ""}{x.credit ? " · crédito" : ""}{x.status === "cancelled" ? " · anulada" : ""}</span>
                        <span className="ml-auto tabular-nums" style={n(x.delta) < 0 ? { color: "#e66767" } : undefined}>{n(x.delta) < 0 ? "ajuste " : ""}{cop(x.delta)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          ) : !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
        </div>
        <PaymentSheet open={Boolean(paying)} title="Pago de liquidación" who={paying ? `👤 ${paying.name}${paying.document ? " · " + paying.document : ""}` : ""} pending={paying ? n(paying.amount) - n(paying.paid) : 0}
          onClose={() => setPaying(null)} onConfirm={(p) => (paying ? pay(paying, p) : Promise.resolve(false))} />
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function PrepareSheet({ poolName, onClose, onConfirm }: { poolName: string; onClose: () => void; onConfirm: (cut: string, note: string) => Promise<boolean> }) {
  const [now] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [cut, setCut] = useState(now);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <FormSheet title="Preparar liquidación" subtitle={poolName} icon={<FileCheck2 size={18} />} onClose={onClose} dirty={cut !== now || note !== ""} footer={
      <>
        <span className="flex-1" />
        <button type="button" disabled={!cut || saving} onClick={async () => { setSaving(true); await onConfirm(cut, note); setSaving(false); }}
          className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>
          <FileCheck2 size={15} /> {saving ? "Calculando…" : "Calcular"}
        </button>
      </>
    }>
      <p className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
        Incluye todo lo pendiente hasta la fecha de corte: <b style={{ color: "var(--t-text)" }}>ventas de contado</b> y lo <b style={{ color: "var(--t-text)" }}>ya cobrado</b> de las ventas a crédito. Lo que se cobre después entra en la siguiente.
      </p>
      <Field label="Fecha y hora de corte" hint="Normalmente: ahora mismo o el último día del mes."><DateField withTime value={cut} max={now} onChange={setCut} /></Field>
      <Field label="Nota (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: cierre de octubre" className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={inputStyle} /></Field>
    </FormSheet>
  );
}

const todayIso = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const dayText = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const startOfDay = (d: string) => `${d}T00:00:00-05:00`;

/**
 * Cómo se liquida el pozo: el punto reparte su GANANCIA TOTAL (venta − costo) o solo lo que agrega sobre la madre;
 * y si se restan sus gastos y nómina antes de repartir. Lo decide la tienda madre; aplica desde una fecha y nunca
 * cambia lo ya liquidado.
 */
function PoolSettings({ storeId, point, settings, hasOpen, onSaved }: {
  storeId: string; point: string | null; settings: NonNullable<Overview["settings"]>; hasOpen: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"total" | "margin">(settings.mode === "total" ? "total" : "margin");
  const [modeFrom, setModeFrom] = useState(todayIso());
  const [deduct, setDeduct] = useState(settings.deduct_expenses);
  const [deductFrom, setDeductFrom] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const isMother = !point;
  const modeChanged = !isMother && mode !== (settings.mode === "total" ? "total" : "margin");
  const deductChanged = deduct !== settings.deduct_expenses;

  async function save() {
    const parts = [
      modeChanged ? `• Este punto reparte ${mode === "total" ? "<b>su ganancia total (venta − costo)</b>" : "<b>solo lo que agrega sobre la madre</b>"} desde el <b>${esc(dayText(startOfDay(modeFrom)))}</b>.` : "",
      deductChanged ? (deduct ? `• Se restan <b>gastos y nómina</b> desde el <b>${esc(dayText(startOfDay(deductFrom)))}</b>.` : "• Ya <b>no se restan</b> gastos (solo ganancias).") : "",
    ].filter(Boolean);
    if (!parts.length) return setEditing(false);
    const ok = await Swal.fire({
      ...swalTheme, icon: "question", title: "¿Guardar cómo se liquida?",
      html: `${parts.join("<br/>")}<p style="margin-top:10px;opacity:.75;font-size:13px">Las ventas y gastos anteriores a esa fecha se quedan como estaban. Lo ya liquidado no cambia.</p>`,
      showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;
    setSaving(true);
    const { error } = await supabaseBrowser().rpc("erp_pool_settings_save", {
      p_store: storeId, p_point: point, p_mode: isMother ? "margin" : mode,
      p_mode_from: modeChanged ? startOfDay(modeFrom) : null, p_deduct: deduct, p_deduct_from: deductChanged && deduct ? startOfDay(deductFrom) : null,
    });
    setSaving(false);
    if (error) return fail(error);
    setEditing(false);
    onSaved();
  }

  return (
    <section className="rounded-2xl border p-4" style={cardStyle}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={label} style={{ color: "var(--t-muted)" }}>Cómo se liquida este pozo</p>
          <p className="mt-1 text-sm">
            {isMother ? <>Parte de la madre (precio de la madre − costo). Las ventas de puntos que reparten su ganancia total <b>no</b> entran aquí.</>
              : settings.mode === "total" ? <>📈 <b>Ganancia total</b> de las ventas del punto (venta − costo){settings.mode_from ? ` desde el ${dayText(settings.mode_from)}` : ""}. La madre solo recibe si la agregas como beneficiaria.</>
              : <>➕ Solo lo que el punto <b>agrega sobre el precio de la madre</b>.</>}
          </p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {settings.deduct_expenses ? `💸 Resta gastos y nómina del ${isMother ? "pozo" : "punto"}${settings.deduct_from ? ` desde el ${dayText(settings.deduct_from)}` : ""}.` : "💸 No resta gastos: se reparte solo la ganancia."}
            {settings.updated_by_name ? ` · Configuró ${settings.updated_by_name}, ${dayText(settings.updated_at)}` : ""}
          </p>
        </div>
        {settings.can_edit && !editing ? (
          <button type="button" disabled={hasOpen} title={hasOpen ? "Termina o descarta la liquidación abierta" : ""} onClick={() => setEditing(true)}
            className="rounded-full border px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }}>Cambiar</button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          {!isMother ? (
            <div className="space-y-2">
              <p className="text-xs font-bold">¿Qué reparte este punto?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([["total", "📈 Su ganancia total", "Venta − costo de cada producto. Ej.: vendido en $100.000 con costo $75.650 → $24.350 para repartir."],
                   ["margin", "➕ Solo lo que agrega sobre la madre", "Venta − precio de la madre. La madre se queda con precio de la madre − costo."]] as const).map(([v, t, d]) => (
                  <button key={v} type="button" onClick={() => setMode(v)} className="rounded-xl border p-3 text-left text-sm"
                    style={{ borderColor: mode === v ? "var(--t-accent)" : "var(--t-card-border)", background: mode === v ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : undefined }}>
                    <b className="block">{t}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{d}</span>
                  </button>
                ))}
              </div>
              {modeChanged ? <Field label="Aplicar desde" hint="Las ventas de antes de esta fecha se quedan como estaban."><DateField value={modeFrom} max={todayIso()} onChange={setModeFrom} /></Field> : null}
            </div>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
            <span><b>Restar gastos y nómina antes de repartir</b><span className="block text-xs" style={{ color: "var(--t-muted)" }}>Arriendo, servicios, nómina… registrados en Gastos para {isMother ? "la madre" : "este punto"}. Apagado: se reparte solo la ganancia.</span></span>
          </label>
          {deduct && deductChanged ? <Field label="Restar gastos desde"><DateField value={deductFrom} max={todayIso()} onChange={setDeductFrom} /></Field> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-full border px-4 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-full px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Productos vendidos sin costo: bloquean la liquidación (la ganancia saldría inflada) hasta ponerles costo. */
function NoCostWarning({ storeId, point, items, canFix, onFixed }: {
  storeId: string; point: string | null; items: NonNullable<Overview["pending"]["no_cost"]>; canFix: boolean; onFixed: () => void;
}) {
  const names = [...new Set(items.map((i) => i.name))];
  async function fix() {
    const { data, error } = await supabaseBrowser().rpc("erp_sale_finance_fix_costs", { p_store: storeId, p_point: point });
    if (error) return fail(error);
    const r = data as { fixed: number; left: number };
    await Swal.fire({
      ...swalTheme, icon: r.left ? "warning" : "success",
      title: r.fixed ? `Se corrigieron ${r.fixed} venta(s)` : "No se corrigió ninguna",
      text: r.left ? `Aún quedan ${r.left} sin costo: esos productos todavía no tienen costo. Haz su ingreso de factura y vuelve a intentarlo.` : "Ya puedes preparar la liquidación.",
    });
    onFixed();
  }
  return (
    <div className="mt-3 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm">
      <p className="font-bold">⛔ {items.length} producto(s) vendido(s) sin costo: no se puede liquidar todavía</p>
      <p className="mt-1 text-xs">Con costo $0 la ganancia sale inflada. {names.slice(0, 8).join(", ")}{names.length > 8 ? ` y ${names.length - 8} más` : ""}.</p>
      <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>1. Ponles costo con un ingreso de factura. 2. Pulsa «Tomar el costo actual» para corregir esas ventas.</p>
      {canFix ? <button type="button" onClick={() => void fix()} className="mt-2 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "#ef4444" }}>Tomar el costo actual</button> : null}
    </div>
  );
}
