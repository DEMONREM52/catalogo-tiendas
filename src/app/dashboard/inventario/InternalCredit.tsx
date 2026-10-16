"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, NumberField, ddmmyyyy } from "@/components/forms/Fields";
import { MoneyInput } from "../MoneyInput";
import { ProductPicker } from "./LineEditor";
import { Chip, Field, Modal, Toggle } from "./dialog";
import { Btn, Empty, Kpi, Panel, confirmAction, errorMessage, inputClass, inputStyle, money, toast, useRunOnChange, type ErpCtx, type ProductHit } from "./shared";

/* ----------------------------- tipos ----------------------------- */

type Settings = { default_pct: number; round_step: number; default_term_days: number };
type Summary = {
  charged: number; paid: number; credits: number; balance: number; overdue: number; due_7: number; next_due: string | null;
  oldest_overdue_days: number | null; in_transit: number; stock_value: number; pending_claims: number;
  /** Cuánto le debe a cada bodega (20261126). */
  by_creditor?: Array<{ creditor_id: string; name: string | null; balance: number }>;
};
type PointRow = Partial<Summary> & {
  point_id: string; name: string; kind: string; is_default: boolean; configured: boolean; enabled: boolean;
  pct: number | null; term_days: number | null; credit_limit: number | null; started_at: string | null;
};
type Rule = { id: string; pct: number; category_id: string | null; category: string | null; product_id: string | null; product: string | null };
type Claim = { id: string; point_id: string; point: string; product: string; image_url: string | null; qty: number; reason: string; note: string; photo_url: string | null; value: number; by: string | null; at: string };
type Creditor = { id: string; name: string; is_default: boolean };
type Board = { ok: boolean; error?: string; today: string; can_manage: boolean; can_see_costs: boolean; settings: Settings; creditors?: Creditor[]; points: PointRow[]; rules: Rule[] | null; claims: Claim[] };
type Move = {
  type: "doc" | "payment"; id: string; number?: number; kind: string; amount: number; due_date?: string | null; note: string | null; status: string;
  void_reason: string | null; transfer_number?: number | null; creditor?: string | null; method?: string; reference?: string | null; paid_at?: string; by: string | null; at: string;
};
type Charge = { id: string; number: number; kind: string; amount: number; pending: number; due_date: string | null; days_late: number | null; transfer_number: number | null; note: string | null; at: string };
type Statement = {
  ok: boolean; error?: string; today: string; point: { id: string; name: string; phone: string | null };
  config: { enabled: boolean; pct: number | null; term_days: number | null; credit_limit: number | null; started_at: string } | null;
  summary: Summary; moves: Move[]; charges: Charge[];
  claims: Array<{ id: string; product: string; qty: number; reason: string; note: string; status: string; value: number; by: string | null; at: string; decided_by: string | null; decision_note: string | null }>;
};

/* ----------------------------- textos ----------------------------- */

const KIND: Record<string, string> = {
  transfer: "🚚 Traslado recibido", opening: "🧾 Deuda inicial", charge: "➕ Cargo", return: "↩️ Devolución a la bodega",
  transfer_out: "➡️ Pasó a otro punto", loss: "💔 Novedad aprobada", credit: "➖ Nota crédito", payment: "💵 Abono",
};
const REASONS: Array<[string, string]> = [["damaged", "💔 Dañado"], ["lost", "🔍 Perdido"], ["expired", "⌛ Vencido"], ["stolen", "🚨 Robo"], ["other", "📝 Otro"]];
const REASON = Object.fromEntries(REASONS);
const METHODS: Array<[string, string]> = [["cash", "💵 Efectivo"], ["transfer", "🏦 Transferencia"], ["card", "💳 Tarjeta"], ["other", "Otro"]];
const TERMS: Array<[number, string]> = [[7, "Semanal"], [15, "Quincenal"], [30, "Mensual"], [40, "40 días"], [60, "2 meses"], [90, "Trimestral"], [180, "Semestral"], [365, "Anual"]];
const termLabel = (d: number) => TERMS.find(([n]) => n === d)?.[1] ?? `${d} días`;
const isMissing = (msg?: string) => /erp_internal_|Could not find the function|schema cache/i.test(msg ?? "");

/* ----------------------------- vista previa en Traslados ----------------------------- */

type Preview = {
  applies: boolean; kind?: "charge" | "return" | "move"; to_name?: string; from_name?: string; missing?: number; total?: number | null;
  balance?: number | null; in_transit?: number | null; credit_limit?: number | null; over_limit?: boolean; term_days?: number;
};

/** Al armar un traslado: cuánto quedará debiendo cada punto con crédito y si pasa su cupo. */
export function InternalCreditPreview({ storeId, from, legs }: { storeId: string; from: string; legs: Array<{ to: string; items: Array<{ product_id: string; qty: number }> }> }) {
  const [rows, setRows] = useState<Preview[]>([]);
  const key = JSON.stringify([from, legs]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const parsed = JSON.parse(key) as [string, typeof legs];
      const out: Preview[] = [];
      for (const leg of parsed[1]) {
        if (!leg.items.length) continue;
        const { data, error } = await supabaseBrowser().rpc("erp_internal_preview", { p_store: storeId, p_from: parsed[0], p_to: leg.to, p_items: leg.items });
        if (error) return; // sin la migración: no se muestra nada
        if ((data as Preview)?.applies) out.push(data as Preview);
      }
      if (alive) setRows(out);
    }, 450);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [key, storeId]);

  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      {rows.map((p, i) => {
        const color = p.over_limit ? "#ef4444" : "#8b5cf6";
        const after = p.total != null && p.balance != null ? p.balance + (p.in_transit ?? 0) + p.total : null;
        return (
          <div key={i} className="rounded-2xl border p-3 text-sm" style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, background: `color-mix(in oklab, ${color} 8%, transparent)` }}>
            <p className="font-bold">
              🤝 {p.kind === "return" ? `Devolución de ${p.from_name}: le baja la deuda` : p.kind === "move" ? `La deuda pasa de ${p.from_name} a ${p.to_name}` : `${p.to_name} tiene crédito con la bodega`}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>
              {p.total != null ? <>Valor interno de este traslado: <b style={{ color: "var(--t-text)" }}>{money(p.total)}</b>. </> : "Se cobra al precio interno cuando el punto confirme lo recibido. "}
              {p.kind === "charge" ? `Vence a los ${p.term_days} días de recibido.` : null}
              {after != null && p.kind === "charge" ? ` Quedará debiendo ${money(after)}${p.credit_limit != null ? ` de un cupo de ${money(p.credit_limit)}` : ""}.` : null}
              {p.missing ? ` ⚠️ ${p.missing} producto(s) sin costo no se cobrarán.` : null}
            </p>
            {p.over_limit ? <p className="mt-1 text-xs font-bold" style={{ color }}>⛔ Supera el cupo: solo la tienda madre puede autorizarlo.</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- pestaña ----------------------------- */

export function InternalCreditTab({ ctx }: { ctx: ErpCtx }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [missing, setMissing] = useState(false);
  const [statementOf, setStatementOf] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PointRow | null>(null);
  const [docFor, setDocFor] = useState<PointRow | null>(null);
  const [configFor, setConfigFor] = useState<PointRow | null>(null);
  const [claimFor, setClaimFor] = useState<PointRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_internal_board", { p_store: ctx.storeId });
    if (error) {
      if (isMissing(error.message)) setMissing(true);
      else void toast("No se pudo cargar la cuenta con puntos", "error", errorMessage(error));
      return;
    }
    setMissing(false);
    setBoard(data as Board);
  }, [ctx.storeId]);
  useRunOnChange(load);

  if (missing) {
    return <Panel title="🤝 Cuenta con puntos"><Empty text="Para usar el crédito en traslados ejecuta en Supabase la migración 20261124_credito_traslados.sql." /></Panel>;
  }
  if (!board) return <Panel title="🤝 Cuenta con puntos"><Empty text="Cargando…" /></Panel>;
  if (!board.ok) return <Panel title="🤝 Cuenta con puntos"><Empty text={board.error ?? "Sin permiso."} /></Panel>;

  const manage = board.can_manage;
  const active = board.points.filter((p) => p.configured);
  const inactive = board.points.filter((p) => !p.configured && !p.is_default);
  const sum = (k: keyof Summary) => active.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const done = () => { void load(); };

  return (
    <div className="space-y-5">
      <Panel
        title="🤝 Cuenta con puntos"
        subtitle={manage
          ? "Lo que cada punto le debe a la bodega por la mercancía que recibe. Se cobra al confirmar el recibido, a precio interno (costo + % de la bodega)."
          : "Lo que tu punto le debe a la bodega por la mercancía recibida, sus vencimientos y tus abonos."}
        actions={manage ? <Btn variant="ghost" onClick={() => setSettingsOpen(true)}>⚙️ Reglas y %</Btn> : null}
      >
        {manage && active.length ? (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon="💰" label="Por cobrar a puntos" value={money(sum("balance"))} />
            <Kpi icon="🔴" label="Vencido" value={money(sum("overdue"))} tone={sum("overdue") > 0 ? "bad" : "good"} />
            <Kpi icon="🚚" label="En camino" value={money(sum("in_transit"))} />
            <Kpi icon="📦" label="Mercancía en puntos" value={money(sum("stock_value"))} />
          </div>
        ) : null}

        {board.claims.length ? (
          <ClaimsPanel claims={board.claims} manage={manage} onDone={done} />
        ) : null}

        {active.length === 0 ? (
          <Empty text={manage ? "Ningún punto tiene crédito todavía. Actívalo abajo para que los traslados queden como deuda del punto." : "Tu punto todavía no tiene cuenta con la bodega."} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((p) => (
              <PointCard key={p.point_id} p={p} settings={board.settings} manage={manage}
                onStatement={() => setStatementOf(p.point_id)} onPay={() => setPayFor(p)} onDoc={() => setDocFor(p)}
                onConfig={() => setConfigFor(p)} onClaim={() => setClaimFor(p)} />
            ))}
          </div>
        )}

        {active.length > 0 && (manage || board.can_see_costs) ? <ChainProfit storeId={ctx.storeId} /> : null}

        {manage && inactive.length ? (
          <div className="mt-5 rounded-2xl border border-dashed p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-sm font-semibold">Puntos sin crédito</p>
            <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Al activarlo, los traslados que reciba ese punto quedan como deuda con la bodega. Puedes cargarle una deuda inicial por lo que ya tiene.</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {inactive.map((p) => <Btn key={p.point_id} variant="ghost" onClick={() => setConfigFor(p)}>{p.kind === "point" ? "📍" : "🏬"} {p.name} · Activar</Btn>)}
            </div>
          </div>
        ) : null}
      </Panel>

      <AnimatePresence>
        {statementOf ? (
          <StatementDialog key="st" storeId={ctx.storeId} pointId={statementOf} manage={manage} onClose={() => setStatementOf(null)} onChanged={done}
            onPay={() => { const p = board.points.find((x) => x.point_id === statementOf); if (p) setPayFor(p); }}
            onDoc={() => { const p = board.points.find((x) => x.point_id === statementOf); if (p) setDocFor(p); }} />
        ) : null}
        {payFor ? <PaymentDialog key="pay" storeId={ctx.storeId} p={payFor} creditors={board.creditors ?? []} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); done(); }} /> : null}
        {docFor ? <DocDialog key="doc" storeId={ctx.storeId} p={docFor} creditors={board.creditors ?? []} settings={board.settings} onClose={() => setDocFor(null)} onSaved={() => { setDocFor(null); done(); }} /> : null}
        {configFor ? <PointConfigDialog key="cfg" storeId={ctx.storeId} p={configFor} settings={board.settings} onClose={() => setConfigFor(null)} onSaved={() => { setConfigFor(null); done(); }} /> : null}
        {claimFor ? <ClaimDialog key="claim" storeId={ctx.storeId} p={claimFor} onClose={() => setClaimFor(null)} onSaved={() => { setClaimFor(null); done(); }} /> : null}
        {settingsOpen ? <SettingsDialog key="set" storeId={ctx.storeId} board={board} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); done(); }} onChanged={done} /> : null}
      </AnimatePresence>
    </div>
  );
}

/* ----------------------------- tarjeta de un punto ----------------------------- */

function PointCard({ p, settings, manage, onStatement, onPay, onDoc, onConfig, onClaim }: {
  p: PointRow; settings: Settings; manage: boolean;
  onStatement: () => void; onPay: () => void; onDoc: () => void; onConfig: () => void; onClaim: () => void;
}) {
  const balance = Number(p.balance ?? 0);
  const overdue = Number(p.overdue ?? 0);
  const used = balance + Number(p.in_transit ?? 0);
  const limitPct = p.credit_limit ? Math.min(100, Math.round((used / Number(p.credit_limit)) * 100)) : null;
  const color = overdue > 0 ? "#ef4444" : Number(p.due_7 ?? 0) > 0 ? "#f59e0b" : "#22c55e";
  return (
    <div className="glass-soft rounded-2xl border p-4" style={{ borderColor: overdue > 0 ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)", opacity: p.enabled ? 1 : 0.65 }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">📍 {p.name}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {p.enabled ? "" : "⏸️ Pausado · "}Plazo {termLabel(p.term_days ?? settings.default_term_days)} · % bodega {p.pct ?? settings.default_pct}%
          </p>
        </div>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} title="Semáforo de pago" />
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{balance < 0 ? "Saldo a favor del punto" : "Debe a la bodega"}</p>
      <p className="text-2xl font-black tabular-nums">{money(Math.abs(balance))}</p>
      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
        {overdue > 0 ? <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: "color-mix(in oklab, #ef4444 16%, transparent)", color: "#ef4444" }}>Vencido {money(overdue)}{p.oldest_overdue_days ? ` · hace ${p.oldest_overdue_days} d` : ""}</span> : null}
        {p.next_due ? <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>Próximo vence {ddmmyyyy(p.next_due)}</span> : null}
        {Number(p.pending_claims ?? 0) > 0 ? <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)" }}>💔 {p.pending_claims} novedad(es)</span> : null}
      </div>
      {(p.by_creditor?.length ?? 0) > 1 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
          Le debe a: {p.by_creditor!.map((c) => `${c.name ?? "Bodega"} ${money(c.balance)}`).join(" · ")}
        </p>
      ) : null}
      {limitPct !== null ? (
        <div className="mt-3">
          <div className="flex justify-between text-[11px]" style={{ color: "var(--t-muted)" }}><span>Cupo usado {limitPct}%</span><span>{money(p.credit_limit)}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
            <div className="h-full rounded-full" style={{ width: `${limitPct}%`, background: limitPct >= 90 ? "#ef4444" : limitPct >= 70 ? "#f59e0b" : "linear-gradient(90deg,#22c55e,#3987e5)" }} />
          </div>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border px-2.5 py-1.5" style={{ borderColor: "var(--t-card-border)" }}><p style={{ color: "var(--t-muted)" }}>🚚 En camino</p><b className="tabular-nums">{money(p.in_transit)}</b></div>
        <div className="rounded-xl border px-2.5 py-1.5" style={{ borderColor: "var(--t-card-border)" }}><p style={{ color: "var(--t-muted)" }}>📦 Mercancía en el punto</p><b className="tabular-nums">{money(p.stock_value)}</b></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Btn onClick={onStatement}>📄 Estado de cuenta</Btn>
        {manage ? <Btn variant="ghost" onClick={onPay}>💵 Abono</Btn> : null}
        {manage ? <Btn variant="ghost" onClick={onDoc}>🧾 Cargo / deuda inicial</Btn> : null}
        {manage ? <Btn variant="ghost" onClick={onConfig}>⚙️</Btn> : null}
        <Btn variant="ghost" onClick={onClaim}>💔 Reportar novedad</Btn>
      </div>
    </div>
  );
}

/* ----------------------------- novedades pendientes ----------------------------- */

function ClaimsPanel({ claims, manage, onDone }: { claims: Claim[]; manage: boolean; onDone: () => void }) {
  async function decide(c: Claim, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = window.prompt("¿Por qué se rechaza?")?.trim() ?? null;
      if (!note) return;
    } else if (!(await confirmAction("Aprobar novedad", `${c.qty} und. de ${c.product} salen del inventario de ${c.point} y le bajan ${money(c.value)} a su deuda. La pérdida la asume la bodega.`, "Aprobar"))) return;
    const { error } = await supabaseBrowser().rpc("erp_internal_claim_decide", { p_claim: c.id, p_approve: approve, p_note: note });
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    void toast(approve ? "Novedad aprobada" : "Novedad rechazada");
    onDone();
  }
  return (
    <div className="mb-4 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)" }}>
      <p className="mb-2 text-sm font-bold">💔 Novedades por revisar ({claims.length})</p>
      <ul className="space-y-2 text-sm">
        {claims.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="min-w-0 flex-1">
              <b>{c.point}</b> · {c.qty} und. {c.product} · {REASON[c.reason] ?? c.reason} · <b>{money(c.value)}</b>
              <span className="block text-xs" style={{ color: "var(--t-muted)" }}>“{c.note}” — {c.by ?? "—"}{c.photo_url ? <> · <a href={c.photo_url} target="_blank" rel="noreferrer" className="underline">foto</a></> : null}</span>
            </span>
            {manage ? (
              <span className="flex gap-2 text-xs">
                <Btn onClick={() => void decide(c, true)}>✅ Aprobar</Btn>
                <Btn variant="danger" onClick={() => void decide(c, false)}>Rechazar</Btn>
              </span>
            ) : <span className="text-xs" style={{ color: "var(--t-muted)" }}>Esperando a la tienda madre</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- estado de cuenta ----------------------------- */

function StatementDialog({ storeId, pointId, manage, onClose, onChanged, onPay, onDoc }: {
  storeId: string; pointId: string; manage: boolean; onClose: () => void; onChanged: () => void; onPay: () => void; onDoc: () => void;
}) {
  const [st, setSt] = useState<Statement | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_internal_statement", { p_store: storeId, p_point: pointId });
    if (error) return void toast("No se pudo cargar el estado de cuenta", "error", errorMessage(error));
    setSt(data as Statement);
  }, [storeId, pointId]);
  useRunOnChange(load);

  // Saldo corrido (de lo más antiguo a lo más nuevo, solo lo vigente).
  const running = useMemo(() => {
    let acc = 0;
    const map = new Map<string, number>();
    for (const m of st?.moves ?? []) {
      if (m.status !== "void") acc += Number(m.amount);
      map.set(m.id, acc);
    }
    return map;
  }, [st]);

  async function voidMove(m: Move) {
    const reason = window.prompt(`Motivo para anular ${m.type === "payment" ? "el abono" : "el documento"}:`)?.trim();
    if (!reason) return;
    const { error } = m.type === "payment"
      ? await supabaseBrowser().rpc("erp_internal_payment_void", { p_payment: m.id, p_reason: reason })
      : await supabaseBrowser().rpc("erp_internal_doc_void", { p_doc: m.id, p_reason: reason });
    if (error) return void toast("No se pudo anular", "error", errorMessage(error));
    void toast("Anulado");
    void load();
    onChanged();
  }

  function share() {
    if (!st) return;
    const s = st.summary;
    const lines = [
      `*Estado de cuenta · ${st.point.name}*`,
      `Debe a la bodega: ${money(s.balance)}`,
      s.overdue > 0 ? `Vencido: ${money(s.overdue)}${s.oldest_overdue_days ? ` (hace ${s.oldest_overdue_days} días)` : ""}` : "Sin saldos vencidos ✅",
      s.next_due ? `Próximo vencimiento: ${ddmmyyyy(s.next_due)}` : "",
      ...st.charges.filter((c) => c.pending > 0).slice(0, 8).map((c) => `• ${KIND[c.kind] ?? c.kind}${c.transfer_number ? ` #${c.transfer_number}` : ""}: ${money(c.pending)} · vence ${ddmmyyyy(c.due_date)}`),
    ].filter(Boolean);
    const phone = (st.point.phone ?? "").replace(/\D/g, "");
    window.open(`https://wa.me/${phone.length === 10 ? `57${phone}` : phone}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
  }

  const s = st?.summary;
  return (
    <Modal wide title={`📄 Estado de cuenta · ${st?.point.name ?? "…"}`} subtitle={st?.config ? `Plazo ${st.config.term_days ?? "de la tienda"} días · cupo ${st.config.credit_limit != null ? money(st.config.credit_limit) : "sin límite"}` : undefined}
      onClose={onClose}
      footer={<>
        <Btn variant="ghost" onClick={share}>💬 Enviar por WhatsApp</Btn>
        <Btn variant="ghost" onClick={() => window.print()}>🖨️ Imprimir</Btn>
        {manage ? <Btn variant="ghost" onClick={onDoc}>🧾 Cargo / nota</Btn> : null}
        {manage ? <Btn onClick={onPay}>💵 Registrar abono</Btn> : null}
        <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
      </>}>
      {!st || !s ? <Empty text="Cargando…" /> : !st.ok ? <Empty text={st.error ?? "Sin permiso."} /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Debe", money(s.balance), s.balance > 0 ? "var(--t-text)" : "#22c55e"], ["Vencido", money(s.overdue), s.overdue > 0 ? "#ef4444" : "#22c55e"],
              ["Vence en 7 días", money(s.due_7), s.due_7 > 0 ? "#f59e0b" : "var(--t-text)"], ["Abonado", money(s.paid), "var(--t-text)"]].map(([l, v, c]) => (
              <div key={l} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{l}</p>
                <p className="text-lg font-black tabular-nums" style={{ color: c }}>{v}</p>
              </div>
            ))}
          </div>

          <Field label="Por pagar (lo más antiguo se paga primero)">
            {st.charges.filter((c) => c.pending > 0).length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Nada pendiente ✅</p> : (
              <ul className="space-y-1.5">
                {st.charges.filter((c) => c.pending > 0).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: c.days_late ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)" }}>
                    <span>{KIND[c.kind] ?? c.kind}{c.transfer_number ? ` #${c.transfer_number}` : ""} <span className="text-xs" style={{ color: "var(--t-muted)" }}>· de {money(c.amount)}</span></span>
                    <span className="text-xs" style={{ color: c.days_late ? "#ef4444" : "var(--t-muted)" }}>{c.days_late ? `Vencido hace ${c.days_late} d` : `Vence ${ddmmyyyy(c.due_date)}`}</span>
                    <b className="tabular-nums">{money(c.pending)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field label="Movimientos">
            {st.moves.length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin movimientos.</p> : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
                <table className="w-full min-w-[640px] text-xs">
                  <thead style={{ color: "var(--t-muted)" }}>
                    <tr><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Concepto</th><th className="px-3 py-2 text-right">Cargo</th><th className="px-3 py-2 text-right">Abono / crédito</th><th className="px-3 py-2 text-right">Saldo</th><th /></tr>
                  </thead>
                  <tbody>
                    {[...st.moves].reverse().map((m) => {
                      const v = Number(m.amount);
                      const isVoid = m.status === "void";
                      return (
                        <tr key={m.id} className="border-t" style={{ borderColor: "var(--t-card-border)", opacity: isVoid ? 0.45 : 1 }}>
                          <td className="px-3 py-2">{new Date(m.at).toLocaleDateString("es-CO")}</td>
                          <td className="px-3 py-2">
                            <b>{KIND[m.kind] ?? m.kind}</b>{m.transfer_number ? ` #${m.transfer_number}` : ""}{m.number ? <span style={{ color: "var(--t-muted)" }}> · doc {m.number}</span> : null}
                            <span className="block" style={{ color: "var(--t-muted)" }}>
                              {[m.creditor ? `🏬 ${m.creditor}` : null, m.note, m.reference, m.by ? `por ${m.by}` : null, isVoid ? `ANULADO: ${m.void_reason ?? ""}` : null].filter(Boolean).join(" · ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{v > 0 ? money(v) : ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "#22c55e" }}>{v < 0 ? money(-v) : ""}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{money(running.get(m.id))}</td>
                          <td className="px-2 py-2 text-right">
                            {manage && !isVoid && (m.type === "payment" || ["opening", "charge", "credit"].includes(m.kind))
                              ? <button type="button" className="underline" onClick={() => void voidMove(m)}>Anular</button> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Field>

          {st.claims.length ? (
            <Field label="Novedades">
              <ul className="space-y-1 text-xs">
                {st.claims.map((c) => (
                  <li key={c.id}>{c.status === "pending" ? "⏳" : c.status === "approved" ? "✅" : "⛔"} {c.qty} und. {c.product} · {REASON[c.reason] ?? c.reason} · {money(c.value)} <span style={{ color: "var(--t-muted)" }}>— {c.note}{c.decision_note ? ` · ${c.decision_note}` : ""}</span></li>
                ))}
              </ul>
            </Field>
          ) : null}
        </>
      )}
    </Modal>
  );
}

/* ----------------------------- abono ----------------------------- */

/** Escoger la bodega que presta (solo si hay más de una). */
function CreditorPicker({ creditors, value, onChange, owed }: { creditors: Creditor[]; value: string; onChange: (v: string) => void; owed?: PointRow["by_creditor"] }) {
  if (creditors.length < 2) return null;
  return (
    <Field label="Bodega" hint="A cuál bodega le corresponde.">
      <div className="flex flex-wrap gap-2 text-xs">
        {creditors.map((c) => {
          const debt = owed?.find((o) => o.creditor_id === c.id)?.balance;
          return <Chip key={c.id} on={value === c.id} onClick={() => onChange(c.id)}>🏬 {c.name}{debt ? ` · debe ${money(debt)}` : ""}</Chip>;
        })}
      </div>
    </Field>
  );
}

function PaymentDialog({ storeId, p, creditors, onClose, onSaved }: { storeId: string; p: PointRow; creditors: Creditor[]; onClose: () => void; onSaved: () => void }) {
  // Por defecto, la bodega a la que más le debe.
  const [creditor, setCreditor] = useState(() => [...(p.by_creditor ?? [])].sort((x, y) => y.balance - x.balance)[0]?.creditor_id ?? creditors.find((c) => c.is_default)?.id ?? "");
  const [amount, setAmount] = useState<number | null>(Number(p.overdue ?? 0) > 0 ? Number(p.overdue) : null);
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!amount) return void toast("Escribe el valor del abono", "warning");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_internal_payment_add", {
      p_store: storeId, p_point: p.point_id, p_amount: amount, p_method: method, p_reference: reference || null, p_paid_at: paidAt || null, p_note: note || null,
      ...(creditors.length > 1 && creditor ? { p_creditor: creditor } : {}),
    });
    setBusy(false);
    if (error) return void toast("No se pudo registrar", "error", errorMessage(error));
    void toast("Abono registrado 💵");
    onSaved();
  }
  return (
    <Modal title={`💵 Abono de ${p.name}`} subtitle={`Debe ${money(p.balance)}${Number(p.overdue ?? 0) > 0 ? ` · vencido ${money(p.overdue)}` : ""}. El abono paga primero lo más antiguo.`} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Registrar abono"}</Btn></>}>
      <Field label="Valor">
        <MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="$ 0" value={amount} onValueChange={setAmount} />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {Number(p.overdue ?? 0) > 0 ? <Chip on={amount === Number(p.overdue)} onClick={() => setAmount(Number(p.overdue))}>Lo vencido</Chip> : null}
          {Number(p.balance ?? 0) > 0 ? <Chip on={amount === Number(p.balance)} onClick={() => setAmount(Number(p.balance))}>Todo ({money(p.balance)})</Chip> : null}
        </div>
      </Field>
      <CreditorPicker creditors={creditors} value={creditor} onChange={setCreditor} owed={p.by_creditor} />
      <Field label="Forma de pago">
        <div className="flex flex-wrap gap-2 text-xs">{METHODS.map(([v, l]) => <Chip key={v} on={method === v} onClick={() => setMethod(v)}>{l}</Chip>)}</div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Referencia (opcional)"><input className={inputClass} style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N.º de transferencia" /></Field>
        <Field label="Fecha del pago" hint="Vacío = hoy"><DateField value={paidAt} onChange={setPaidAt} /></Field>
      </div>
      <Field label="Nota (opcional)"><input className={inputClass} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

/* ----------------------------- deuda inicial, cargos y notas ----------------------------- */

function DocDialog({ storeId, p, settings, creditors, onClose, onSaved }: { storeId: string; p: PointRow; settings: Settings; creditors: Creditor[]; onClose: () => void; onSaved: () => void }) {
  const [creditor, setCreditor] = useState(creditors.find((c) => c.is_default)?.id ?? "");
  const [kind, setKind] = useState<"stock" | "opening" | "charge" | "credit">("stock");
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const term = p.term_days ?? settings.default_term_days;
  async function save() {
    setBusy(true);
    const res = kind === "stock"
      ? await supabaseBrowser().rpc("erp_internal_opening_from_stock", { p_store: storeId, p_point: p.point_id, p_due: due || null, p_note: note || null, ...(creditors.length > 1 && creditor ? { p_creditor: creditor } : {}) })
      : await supabaseBrowser().rpc("erp_internal_doc_add", { p_store: storeId, p_point: p.point_id, p_kind: kind, p_amount: amount, p_due: due || null, p_note: note || null, ...(creditors.length > 1 && creditor ? { p_creditor: creditor } : {}) });
    setBusy(false);
    if (res.error) return void toast("No se pudo guardar", "error", errorMessage(res.error));
    if (kind === "stock") {
      const r = res.data as { amount: number; products: number; missing: number };
      void toast("Deuda inicial creada", "success", `${r.products} producto(s) por ${money(r.amount)}${r.missing ? ` · ${r.missing} sin costo no se cobraron` : ""}.`);
    } else void toast("Guardado");
    onSaved();
  }
  const options: Array<[typeof kind, string, string]> = [
    ["stock", "📦 Deuda inicial por lo que tiene", "Valoriza la mercancía que hoy está en el punto a precio interno"],
    ["opening", "🧾 Deuda inicial (valor)", "Escribe el valor que ya debía"],
    ["charge", "➕ Cargo", "Algo más que debe (con motivo)"],
    ["credit", "➖ Nota crédito", "Le baja la deuda (con motivo)"],
  ];
  return (
    <Modal title={`🧾 ${p.name}: cargos y deuda inicial`} subtitle="Todo queda en la auditoría. Los cargos manuales se pueden anular con motivo." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Btn></>}>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([k, t, h]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className="rounded-2xl border p-3 text-left"
            style={kind === k ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <b className="block">{t}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{h}</span>
          </button>
        ))}
      </div>
      <CreditorPicker creditors={creditors} value={creditor} onChange={setCreditor} owed={p.by_creditor} />
      {kind !== "stock" ? <Field label="Valor"><MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="$ 0" value={amount} onValueChange={setAmount} /></Field> : null}
      {kind !== "credit" ? <Field label="Vence" hint={`Vacío = en ${term} días`}><DateField value={due} onChange={setDue} /></Field> : null}
      <Field label={kind === "charge" || kind === "credit" ? "Motivo" : "Nota (opcional)"}><input className={inputClass} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

/* ----------------------------- configuración de un punto ----------------------------- */

function TermPicker({ value, onChange, allowDefault }: { value: number | null; onChange: (v: number | null) => void; allowDefault?: string }) {
  const custom = value !== null && !TERMS.some(([n]) => n === value);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {allowDefault ? <Chip on={value === null} onClick={() => onChange(null)}>{allowDefault}</Chip> : null}
      {TERMS.map(([n, l]) => <Chip key={n} on={value === n} onClick={() => onChange(n)}>{l}</Chip>)}
      <span className="inline-flex w-32 items-center gap-1"><NumberField value={custom ? value : null} onChange={(v) => onChange(v === null ? null : Math.max(0, Math.min(730, Math.round(v))))} decimals={0} suffix="días" placeholder="Otro" /></span>
    </div>
  );
}

function PointConfigDialog({ storeId, p, settings, onClose, onSaved }: { storeId: string; p: PointRow; settings: Settings; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(p.configured ? p.enabled : true);
  const [pct, setPct] = useState<number | null>(p.pct);
  const [term, setTerm] = useState<number | null>(p.term_days);
  const [limit, setLimit] = useState<number | null>(p.credit_limit);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_internal_point_save", { p_store: storeId, p_point: p.point_id, p_cfg: { enabled, pct, term_days: term, credit_limit: limit } });
    setBusy(false);
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    void toast(p.configured ? "Guardado" : `Crédito activado para ${p.name} 🤝`, "success", p.configured ? undefined : "Desde ahora, lo que reciba por traslado queda como deuda. Si ya tiene mercancía, cárgale la deuda inicial.");
    onSaved();
  }
  return (
    <Modal title={`⚙️ Crédito de ${p.name}`} subtitle="Lo que dejes vacío usa la regla general de la tienda." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : p.configured ? "Guardar" : "Activar crédito"}</Btn></>}>
      <Toggle on={enabled} onChange={setEnabled} label={enabled ? "✅ Los traslados a este punto quedan como deuda" : "⏸️ Pausado: los traslados no generan deuda"} />
      <Field label="% de la bodega para este punto" hint={`Vacío = el de la tienda (${settings.default_pct}%). Las reglas por categoría o producto mandan sobre este.`}>
        <div className="w-40"><NumberField value={pct} onChange={setPct} suffix="%" min={0} max={1000} placeholder={`${settings.default_pct}`} /></div>
      </Field>
      <Field label="Plazo para pagar cada traslado" hint="Cuenta desde que el punto confirma lo recibido.">
        <TermPicker value={term} onChange={setTerm} allowDefault={`Como la tienda (${termLabel(settings.default_term_days)})`} />
      </Field>
      <Field label="Cupo máximo de deuda (opcional)" hint="Si un traslado lo supera, solo la tienda madre puede enviarlo.">
        <MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="Sin límite" value={limit} onValueChange={setLimit} />
      </Field>
    </Modal>
  );
}

/* ----------------------------- reglas generales ----------------------------- */

function SettingsDialog({ storeId, board, onClose, onSaved, onChanged }: { storeId: string; board: Board; onClose: () => void; onSaved: () => void; onChanged: () => void }) {
  const [pct, setPct] = useState<number | null>(board.settings.default_pct);
  const [step, setStep] = useState(board.settings.round_step);
  const [term, setTerm] = useState<number | null>(board.settings.default_term_days);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [ruleCat, setRuleCat] = useState("");
  const [ruleProduct, setRuleProduct] = useState<ProductHit | null>(null);
  const [rulePct, setRulePct] = useState<number | null>(null);

  useEffect(() => {
    void supabaseBrowser().from("product_categories").select("id,name").eq("store_id", storeId).order("name")
      .then(({ data }) => setCategories((data ?? []) as Array<{ id: string; name: string }>));
  }, [storeId]);

  async function save() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_internal_settings_save", { p_store: storeId, p_cfg: { default_pct: pct ?? 15, round_step: step, default_term_days: term ?? 30 } });
    setBusy(false);
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    void toast("Reglas guardadas");
    onSaved();
  }
  async function saveRule(category: string | null, product: string | null, value: number | null) {
    const { error } = await supabaseBrowser().rpc("erp_internal_pct_rule_save", { p_store: storeId, p_category: category, p_product: product, p_pct: value });
    if (error) return void toast("No se pudo guardar la regla", "error", errorMessage(error));
    setRuleCat(""); setRuleProduct(null); setRulePct(null);
    onChanged();
  }
  const example = Math.ceil((18000 * (1 + (pct ?? 15) / 100)) / Math.max(step, 1)) * Math.max(step, 1);
  return (
    <Modal wide title="⚙️ Reglas del crédito con puntos" subtitle="Crear productos no cambia: el % se busca solo (producto → categoría → punto → tienda)." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cerrar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar reglas generales"}</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="% de la bodega (por defecto)" hint={`Ej.: costo $18.000 → precio interno ${money(example)}`}>
          <div className="w-40"><NumberField value={pct} onChange={setPct} suffix="%" min={0} max={1000} /></div>
        </Field>
        <Field label="Redondear el precio interno hacia arriba a">
          <div className="flex flex-wrap gap-2 text-xs">{[[0, "Sin redondeo"], [100, "$100"], [500, "$500"], [1000, "$1.000"]].map(([v, l]) => <Chip key={v} on={step === v} onClick={() => setStep(Number(v))}>{l}</Chip>)}</div>
        </Field>
      </div>
      <Field label="Plazo de pago por defecto" hint="Cada punto puede tener el suyo (botón ⚙️ en su tarjeta).">
        <TermPicker value={term} onChange={setTerm} />
      </Field>

      <Field label="% especial por categoría o producto" hint="Mandan sobre el % del punto y de la tienda.">
        <div className="space-y-2">
          {(board.rules ?? []).length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin reglas especiales.</p> : (
            <ul className="space-y-1.5 text-sm">
              {(board.rules ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: "var(--t-card-border)" }}>
                  <span>{r.category ? `🗂️ ${r.category}` : `📦 ${r.product}`}</span>
                  <span className="flex items-center gap-2"><b>{Number(r.pct)}%</b><button type="button" className="text-xs underline" onClick={() => void saveRule(r.category_id, r.product_id, null)}>Quitar</button></span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[1fr_1fr_8rem_auto]" style={{ borderColor: "var(--t-card-border)" }}>
            <select className={inputClass} style={inputStyle} value={ruleCat} onChange={(e) => { setRuleCat(e.target.value); setRuleProduct(null); }}>
              <option value="">🗂️ Categoría…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {ruleProduct ? (
              <button type="button" className={`${inputClass} text-left`} style={inputStyle} onClick={() => setRuleProduct(null)}>📦 {ruleProduct.name} ✕</button>
            ) : (
              <ProductPicker storeId={storeId} placeholder="…o un producto" onPick={(h) => { setRuleProduct(h); setRuleCat(""); }} />
            )}
            <NumberField value={rulePct} onChange={setRulePct} suffix="%" min={0} max={1000} placeholder="Ej. 20" />
            <Btn onClick={() => { if ((!ruleCat && !ruleProduct) || rulePct === null) return void toast("Escoge categoría o producto y el %", "warning"); void saveRule(ruleCat || null, ruleProduct?.id ?? null, rulePct); }}>Agregar</Btn>
          </div>
        </div>
      </Field>
    </Modal>
  );
}

/* ----------------------------- reportar novedad ----------------------------- */

function ClaimDialog({ storeId, p, onClose, onSaved }: { storeId: string; p: PointRow; onClose: () => void; onSaved: () => void }) {
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [qty, setQty] = useState<number | null>(1);
  const [reason, setReason] = useState("damaged");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!product) return void toast("Escoge el producto", "warning");
    if (!qty || qty < 1) return void toast("Escribe la cantidad", "warning");
    if (!note.trim()) return void toast("Cuenta qué pasó", "warning");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_internal_claim_create", {
      p_store: storeId, p_point: p.point_id, p_product: product.id, p_qty: qty, p_reason: reason, p_note: note, p_photo: null,
    });
    setBusy(false);
    if (error) return void toast("No se pudo reportar", "error", errorMessage(error));
    void toast("Novedad enviada", "success", "La tienda madre la revisa. Si la aprueba, la pérdida la asume la bodega y te baja la deuda.");
    onSaved();
  }
  return (
    <Modal title={`💔 Reportar novedad · ${p.name}`} subtitle="Mercancía dañada, perdida, vencida o robada. La madre la aprueba." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Enviando…" : "Enviar novedad"}</Btn></>}>
      <Field label="Producto">
        {product ? (
          <button type="button" className={`${inputClass} text-left`} style={inputStyle} onClick={() => setProduct(null)}>📦 {product.name} · hay {product.wh_qty} ✕</button>
        ) : <ProductPicker storeId={storeId} warehouseId={p.point_id} inStockOnly onPick={setProduct} placeholder={`Buscar en ${p.name}…`} />}
      </Field>
      <Field label="Cantidad"><div className="w-32"><NumberField value={qty} onChange={setQty} decimals={0} min={1} suffix="und." /></div></Field>
      <Field label="Motivo"><div className="flex flex-wrap gap-2 text-xs">{REASONS.map(([v, l]) => <Chip key={v} on={reason === v} onClick={() => setReason(v)}>{l}</Chip>)}</div></Field>
      <Field label="¿Qué pasó?"><textarea className={inputClass} style={inputStyle} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

/* ----------------------------- ganancia de la cadena ----------------------------- */

type ChainPoint = {
  point_id: string; name: string; revenue: number; internal_cost: number; real_cost: number; point_profit: number; bodega_profit: number;
  other_revenue: number; orders: number; charged: number; charged_cost: number; credited: number; loss_value: number; loss_cost: number; paid: number; balance: number;
};
type ByCreditor = { creditor_id: string; name: string | null; charged: number; charged_cost: number; margin: number; returned: number; loss_cost: number; paid: number };
type Chain = { ok: boolean; error?: string; points: ChainPoint[]; by_creditor?: ByCreditor[]; totals: { revenue: number; internal_cost: number; real_cost: number; point_profit: number; bodega_profit: number; loss_cost: number; charged: number; paid: number; balance: number } };
const PERIODS: Array<[string, string]> = [["month", "Este mes"], ["30", "Últimos 30 días"], ["90", "Últimos 3 meses"], ["year", "Este año"]];

function periodRange(key: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const d = new Date(`${today}T12:00:00Z`);
  if (key === "month") return [`${today.slice(0, 8)}01`, today];
  if (key === "year") return [`${today.slice(0, 4)}-01-01`, today];
  d.setUTCDate(d.getUTCDate() - Number(key));
  return [d.toISOString().slice(0, 10), today];
}

/** Proveedor → bodega → puntos: lo vendido y lo que gana cada uno (de lo que se vendió en el periodo). */
export function ChainProfit({ storeId }: { storeId: string }) {
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<Chain | null>(null);
  const load = useCallback(async () => {
    const [from, to] = periodRange(period);
    const { data: res, error } = await supabaseBrowser().rpc("erp_internal_profit", { p_store: storeId, p_from: from, p_to: to });
    setData(error ? null : (res as Chain));
  }, [storeId, period]);
  useRunOnChange(load);
  if (!data?.ok) return null;
  const t = data.totals;
  const total = t.bodega_profit + t.point_profit - t.loss_cost;
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}%` : "—");
  const steps: Array<[string, string, number, string]> = [
    ["🏭", "Costo de proveedor", t.real_cost, "Lo que costó lo vendido"],
    ["🏬", "La bodega cobró", t.internal_cost, `Ganó ${money(t.bodega_profit)} (${pct(t.bodega_profit, t.internal_cost)})`],
    ["📍", "Los puntos vendieron", t.revenue, `Ganaron ${money(t.point_profit)} (${pct(t.point_profit, t.revenue)})`],
  ];
  return (
    <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold">📈 Ganancia de la cadena</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>De lo que vendieron los puntos con crédito. Los repartos usan lo vendido y cobrado.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">{PERIODS.map(([k, l]) => <Chip key={k} on={period === k} onClick={() => setPeriod(k)}>{l}</Chip>)}</div>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {steps.map(([icon, label, value, sub], i) => (
          <div key={label} className="contents">
            {i > 0 ? <div className="hidden items-center justify-center text-xl md:flex" style={{ color: "var(--t-muted)" }}>→</div> : null}
            <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{icon} {label}</p>
              <p className="text-xl font-black tabular-nums">{money(value)}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{sub}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["🏬 Ganancia bodega", t.bodega_profit, "#8b5cf6"], ["📍 Ganancia puntos", t.point_profit, "#22c55e"], ["💔 Pérdidas (bodega)", -t.loss_cost, "#ef4444"], ["💰 Ganancia total", total, "var(--t-text)"]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>{l}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: c as string }}>{money(v as number)}</p>
          </div>
        ))}
      </div>
      {(data.by_creditor?.length ?? 0) > 1 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.by_creditor!.map((c) => (
            <div key={c.creditor_id} className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="text-sm font-bold">🏬 {c.name ?? "Bodega"}</p>
              <p style={{ color: "var(--t-muted)" }}>Trasladó {money(c.charged)} · ganó <b style={{ color: "#8b5cf6" }}>{money(c.margin)}</b> · cobró {money(c.paid)}{c.loss_cost ? ` · perdió ${money(c.loss_cost)}` : ""}</p>
            </div>
          ))}
        </div>
      ) : null}
      {data.points.length ? (
        <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[720px] text-xs">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr>{["Punto", "Vendió", "Le costó", "Ganó el punto", "Ganó la bodega", "Reparto", "Abonó", "Debe"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.points.map((p) => {
                const sum = p.point_profit + p.bodega_profit;
                const share = sum > 0 ? Math.round((p.bodega_profit / sum) * 100) : 0;
                return (
                  <tr key={p.point_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className="px-3 py-2 font-bold">📍 {p.name}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(p.internal_cost)}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: "#22c55e" }}>{money(p.point_profit)}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: "#8b5cf6" }}>{money(p.bodega_profit)}</td>
                    <td className="px-3 py-2">
                      {sum > 0 ? (
                        <div className="flex h-2 w-28 overflow-hidden rounded-full" title={`Bodega ${share}% · punto ${100 - share}%`}>
                          <div style={{ width: `${share}%`, background: "#8b5cf6" }} /><div style={{ width: `${100 - share}%`, background: "#22c55e" }} />
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(p.paid)}</td>
                    <td className="px-3 py-2 font-bold tabular-nums">{money(p.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
