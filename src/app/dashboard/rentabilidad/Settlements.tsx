"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, ChevronDown, Download, FileCheck2, History, Plus, RefreshCw, Undo2, Users, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cardStyle, cop, downloadCsv, esc, inputStyle, rpcError, swalTheme, type Point } from "./shared";

type Beneficiary = { id: string; name: string; kind: string; document: string | null; notes: string | null; active: boolean };
type Share = { beneficiary_id: string; pct: number };
type PreviewLine = { beneficiary_id: string; name: string; pct: number; share_amount: number; carried_amount: number; amount: number };
type Overview = {
  beneficiaries: Beneficiary[];
  split: { id: string; version: number; shares: Share[]; total_pct: number; reason: string; created_by_name: string | null; created_at: string } | null;
  split_history: Array<{ version: number; total_pct: number; reason: string; created_by_name: string | null; created_at: string }>;
  pending: { pool_total: number; carried_total: number; assigned_total: number; orders: number; lines: PreviewLine[] };
  open_settlement: { id: string; number: number; status: string } | null;
  can: { beneficiaries: boolean; settle: boolean; approve: boolean; pay: boolean };
};
type Row = { id: string; number: number; cutoff: string; status: Status; pool_total: number; carried_total: number; assigned_total: number; unassigned_total: number; sources_count: number; created_at: string; created_by_name: string | null; decided_by_name: string | null; to_pay: number; paid: number };
type Status = "calculated" | "review" | "approved" | "partially_paid" | "paid" | "rejected" | "reverted";
type Detail = {
  settlement: Row & { point_id: string | null; point_name: string | null; split_version: number | null; notes: string | null; decision_note: string | null; revert_reason: string | null; submitted_by_name: string | null; reverted_by_name: string | null };
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

  async function prepare() {
    const r = await Swal.fire({
      ...swalTheme,
      title: "Preparar liquidación",
      html: `<p style="font-size:14px;opacity:.8">Incluye todo lo pendiente hasta la fecha de corte: ventas de contado y lo ya cobrado de las ventas a crédito.</p>
        <input id="cut" type="datetime-local" class="swal2-input" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}" />
        <input id="note" class="swal2-input" placeholder="Nota (opcional)" />`,
      showCancelButton: true, confirmButtonText: "Calcular", cancelButtonText: "Cancelar",
      preConfirm: () => ({ cut: (document.getElementById("cut") as HTMLInputElement).value, note: (document.getElementById("note") as HTMLInputElement).value }),
    });
    if (!r.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_settlement_calculate", { p_store: storeId, p_point: point, p_cutoff: r.value.cut ? new Date(r.value.cut).toISOString() : null, p_notes: r.value.note || null });
    if (e) return fail(e);
    await load();
    setOpenId((data as { id: string }).id);
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
        <span className="order-last basis-full text-xs sm:order-none sm:basis-auto sm:flex-1" style={{ color: "var(--t-muted)" }}>{point ? "Pozo del punto: lo que el punto agrega sobre el precio de la madre." : "Pozo de la madre: precio de la madre − costo, de todas las ventas."}</span>
        <button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>

      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error.includes("20261106") ? "Falta ejecutar en Supabase la migración 20261109_repartos_liquidaciones.sql." : error}</p> : null}

      {ov && pending ? (
        <>
          <section className="rounded-2xl border p-4" style={cardStyle}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className={label} style={{ color: "var(--t-muted)" }}>Por liquidar hoy</p>
                <p className="mt-1 text-3xl font-black tabular-nums" style={n(pending.pool_total) + n(pending.carried_total) < 0 ? { color: "#e66767" } : undefined}>{cop(n(pending.pool_total) + n(pending.carried_total))}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {pending.orders} venta{pending.orders === 1 ? "" : "s"} con movimiento · contado + crédito cobrado{n(pending.carried_total) ? ` · saldo en contra traído ${cop(pending.carried_total)}` : ""}
                </p>
              </div>
              {open ? (
                <button type="button" onClick={() => setOpenId(open.id)} className="rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: STATUS[open.status as Status]?.color ?? "#3987e5" }}>Ver liquidación #{open.number} abierta</button>
              ) : ov.can.settle ? (
                <button type="button" disabled={!ov.split} onClick={() => void prepare()} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }} title={ov.split ? "" : "Define primero el reparto"}>
                  <FileCheck2 size={16} /> Preparar liquidación
                </button>
              ) : null}
            </div>
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

      <AnimatePresence>{openId && ov ? <SettlementSheet key={openId} id={openId} can={ov.can} onClose={() => setOpenId(null)} onChanged={() => void load()} /> : null}</AnimatePresence>
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
                <div className="flex w-24 items-center rounded-lg border px-2" style={inputStyle}>
                  <input type="number" inputMode="decimal" min={0} max={100} step={0.5} disabled={!can} value={values[b.id] ?? 0} onChange={(e) => setDraft({ ...values, [b.id]: Number(e.target.value) })} className="w-full bg-transparent py-1.5 text-right font-bold tabular-nums outline-none disabled:opacity-60" aria-label={`Porcentaje de ${b.name}`} />
                  <span className="text-xs">%</span>
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

function SettlementSheet({ id, can, onClose, onChanged }: { id: string; can: Overview["can"]; onClose: () => void; onChanged: () => void }) {
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

  async function pay(line: Detail["lines"][number]) {
    const left = n(line.amount) - n(line.paid);
    const key = `pay-${crypto.randomUUID()}`; // se genera una vez: si se reintenta, no se duplica
    const r = await Swal.fire({
      ...swalTheme,
      title: `Pago a ${esc(line.name)}`,
      html: `<p style="font-size:13px;opacity:.8">Pendiente ${cop(left)}. Se registra en RemHub; no confirma que el banco haya hecho la transferencia.</p>
        <input id="amt" type="number" class="swal2-input" value="${left}" min="0" step="0.01" />
        <select id="met" class="swal2-select"><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="nequi">Nequi / Daviplata</option><option value="other">Otro</option></select>
        <input id="ref" class="swal2-input" placeholder="Referencia o comprobante" />`,
      showCancelButton: true, confirmButtonText: "Registrar pago", cancelButtonText: "Cancelar",
      preConfirm: () => ({ amount: Number((document.getElementById("amt") as HTMLInputElement).value), method: (document.getElementById("met") as HTMLSelectElement).value, ref: (document.getElementById("ref") as HTMLInputElement).value }),
    });
    if (!r.isConfirmed) return;
    const { error: e } = await supabaseBrowser().rpc("erp_settlement_pay", { p_line: line.id, p_amount: r.value.amount, p_method: r.value.method, p_reference: r.value.ref || null, p_note: null, p_paid_at: null, p_idempotency_key: key });
    if (e) return fail(e);
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

  function exportCsv() {
    if (!d) return;
    const s = d.settlement;
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
          <button type="button" onClick={exportCsv} disabled={!d} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Exportar"><Download size={15} /></button>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
          {d && s ? (
            <>
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
                            <button type="button" onClick={() => void pay(l)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#8b5cf6" }}><Banknote size={13} /> Pagar</button>
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
      </motion.div>
    </motion.div>,
    document.body,
  );
}
