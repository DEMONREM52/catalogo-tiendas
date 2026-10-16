"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyField, NumberField } from "@/components/forms/Fields";
import { Chip, Field, Modal } from "../inventario/dialog";
import { Btn, Empty, Kpi, Panel, errorMessage, inputClass, inputStyle, money, toast, useRunOnChange } from "../inventario/shared";

/* ----------------------------- tipos ----------------------------- */

type Breakdown = {
  opening: number; pos_cash: number; pos_sales: number; pos_by_method: Record<string, number>; receivables_cash: number;
  expenses_cash: number; to_bodega: number; moves_in: number; moves_out: number; expected: number;
};
type OpenSession = { id: string; number: number; opened_at: string; opened_by: string | null; opening: number; breakdown: Breakdown };
type PointCash = { point_id: string; name: string; kind: string; open: OpenSession | null; last_closed: { closed_at: string; difference: number; status: string } | null };
type History = {
  id: string; number: number; point: string; point_id: string; status: "review" | "closed"; opened_at: string; closed_at: string;
  opened_by: string | null; closed_by: string | null; expected: number; counted: number; difference: number; closing_note: string | null;
  review_note: string | null; reviewed_by: string | null;
};
type Board = { ok: boolean; error?: string; can_manage: boolean; tolerance: number; points: PointCash[]; history: History[] };

const METHOD_LABEL: Record<string, string> = { efectivo: "💵 Efectivo", transferencia: "🏦 Transferencia", nequi: "📱 Nequi / Daviplata", tarjeta: "💳 Tarjeta" };
const BILLS = [100000, 50000, 20000, 10000, 5000, 2000, 1000];
const COINS = [1000, 500, 200, 100, 50];
const dt = (iso: string) => new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const diffColor = (d: number) => (d === 0 ? "#22c55e" : d < 0 ? "#ef4444" : "#f59e0b");
const diffText = (d: number) => (d === 0 ? "Cuadró exacto" : d < 0 ? `Faltante ${money(-d)}` : `Sobrante ${money(d)}`);

/* ----------------------------- pantalla ----------------------------- */

export function CashRegister({ storeId }: { storeId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [missing, setMissing] = useState(false);
  const [openFor, setOpenFor] = useState<PointCash | null>(null);
  const [closeFor, setCloseFor] = useState<PointCash | null>(null);
  const [moveFor, setMoveFor] = useState<PointCash | null>(null);
  const [filter, setFilter] = useState<"all" | "review">("all");

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_cash_board", { p_store: storeId });
    if (error) {
      if (/erp_cash_board|Could not find the function|schema cache/i.test(error.message)) setMissing(true);
      else void toast("No se pudo cargar la caja", "error", errorMessage(error));
      return;
    }
    setMissing(false);
    setBoard(data as Board);
  }, [storeId]);
  useRunOnChange(load);
  // El cuadre de las cajas abiertas se actualiza solo cada minuto.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (missing) return <Panel title="💵 Caja"><Empty text="Para usar la caja ejecuta en Supabase la migración 20261128_caja.sql." /></Panel>;
  if (!board) return <Panel title="💵 Caja"><Empty text="Cargando…" /></Panel>;
  if (!board.ok) return <Panel title="💵 Caja"><Empty text={board.error ?? "Sin permiso."} /></Panel>;

  const openNow = board.points.filter((p) => p.open);
  const review = board.history.filter((h) => h.status === "review");
  const shown = filter === "review" ? review : board.history;
  const done = () => void load();

  return (
    <div className="space-y-5">
      <Panel title="💵 Caja" subtitle="Abre la caja con la base, registra entradas y salidas, y ciérrala contando el efectivo. El sistema te dice cuánto debe haber."
        actions={board.can_manage ? <ToleranceEditor storeId={storeId} value={board.tolerance} onSaved={done} /> : null}>
        {board.can_manage ? (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon="🟢" label="Cajas abiertas" value={`${openNow.length} de ${board.points.length}`} />
            <Kpi icon="💵" label="Efectivo en cajas" value={money(openNow.reduce((s, p) => s + Number(p.open?.breakdown.expected ?? 0), 0))} />
            <Kpi icon="⚠️" label="Por revisar" value={String(review.length)} tone={review.length ? "warn" : "good"} />
            <Kpi icon="📉" label="Faltantes (60 cierres)" value={money(board.history.filter((h) => h.difference < 0).reduce((s, h) => s - Number(h.difference), 0))} tone="bad" />
          </div>
        ) : null}

        {board.points.length === 0 ? <Empty text="No tienes puntos con caja asignados." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {board.points.map((p) => <PointCashCard key={p.point_id} p={p} onOpen={() => setOpenFor(p)} onClose={() => setCloseFor(p)} onMove={() => setMoveFor(p)} />)}
          </div>
        )}
      </Panel>

      <Panel title="📒 Cierres anteriores" actions={
        <div className="flex gap-1.5 text-xs">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>
          <Chip on={filter === "review"} onClick={() => setFilter("review")}>⚠️ Por revisar ({review.length})</Chip>
        </div>
      }>
        {shown.length === 0 ? <Empty text={filter === "review" ? "Nada por revisar ✅" : "Aún no hay cierres."} /> : (
          <div className="space-y-2">
            {shown.map((h) => <HistoryRow key={h.id} h={h} canManage={board.can_manage} onDone={done} />)}
          </div>
        )}
      </Panel>

      <AnimatePresence>
        {openFor ? <OpenDialog key="o" storeId={storeId} p={openFor} onClose={() => setOpenFor(null)} onSaved={() => { setOpenFor(null); done(); }} /> : null}
        {closeFor?.open ? <CloseDialog key="c" p={closeFor} tolerance={board.tolerance} onClose={() => setCloseFor(null)} onSaved={() => { setCloseFor(null); done(); }} /> : null}
        {moveFor?.open ? <MoveDialog key="m" p={moveFor} onClose={() => setMoveFor(null)} onSaved={() => { setMoveFor(null); done(); }} /> : null}
      </AnimatePresence>
    </div>
  );
}

/* ----------------------------- tarjeta de un punto ----------------------------- */

function Line({ label, value, sign, muted }: { label: string; value: number; sign?: "+" | "−"; muted?: boolean }) {
  if (!value && muted) return null;
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span style={{ color: "var(--t-muted)" }}>{label}</span>
      <span className="tabular-nums font-semibold">{sign ? `${sign} ` : ""}{money(value)}</span>
    </div>
  );
}

function PointCashCard({ p, onOpen, onClose, onMove }: { p: PointCash; onOpen: () => void; onClose: () => void; onMove: () => void }) {
  const b = p.open?.breakdown;
  return (
    <div className="glass-soft rounded-2xl border p-4" style={{ borderColor: p.open ? "color-mix(in oklab, #22c55e 45%, transparent)" : "var(--t-card-border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">{p.kind === "point" ? "📍" : "🏬"} {p.name}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {p.open ? `🟢 Abierta #${p.open.number} · ${dt(p.open.opened_at)} · ${p.open.opened_by ?? ""}` : "⚪ Cerrada"}
          </p>
        </div>
        {p.last_closed && !p.open ? (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${diffColor(Number(p.last_closed.difference))} 16%, transparent)`, color: diffColor(Number(p.last_closed.difference)) }}>
            Último: {diffText(Number(p.last_closed.difference))}
          </span>
        ) : null}
      </div>
      {b ? (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Debe haber en el cajón</p>
          <p className="text-2xl font-black tabular-nums">{money(b.expected)}</p>
          <div className="mt-2 space-y-1 rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
            <Line label="Base" value={b.opening} />
            <Line label={`Ventas en efectivo (${b.pos_sales} ventas)`} value={b.pos_cash} sign="+" />
            <Line label="Abonos de cartera" value={b.receivables_cash} sign="+" muted />
            <Line label="Entradas" value={b.moves_in} sign="+" muted />
            <Line label="Gastos pagados" value={b.expenses_cash} sign="−" muted />
            <Line label="Entregado a la bodega" value={b.to_bodega} sign="−" muted />
            <Line label="Salidas" value={b.moves_out} sign="−" muted />
          </div>
          {Object.keys(b.pos_by_method ?? {}).filter((m) => m !== "efectivo").length ? (
            <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
              Otros medios (no van al cajón): {Object.entries(b.pos_by_method).filter(([m]) => m !== "efectivo").map(([m, v]) => `${METHOD_LABEL[m] ?? m} ${money(v)}`).join(" · ")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Btn onClick={onClose}>🔒 Cerrar caja</Btn>
            <Btn variant="ghost" onClick={onMove}>↕️ Entrada / salida</Btn>
          </div>
        </>
      ) : (
        <div className="mt-3"><Btn onClick={onOpen}>🔓 Abrir caja</Btn></div>
      )}
    </div>
  );
}

/* ----------------------------- historial ----------------------------- */

function HistoryRow({ h, canManage, onDone }: { h: History; canManage: boolean; onDone: () => void }) {
  async function approve() {
    const note = window.prompt(`Nota de revisión (${diffText(Number(h.difference))}):`)?.trim();
    if (!note) return;
    const { error } = await supabaseBrowser().rpc("erp_cash_review", { p_session: h.id, p_note: note });
    if (error) return void toast("No se pudo aprobar", "error", errorMessage(error));
    void toast("Revisada");
    onDone();
  }
  const d = Number(h.difference);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: h.status === "review" ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)" }}>
      <span className="min-w-0 flex-1">
        <b>{h.point}</b> · caja #{h.number} · {dt(h.closed_at)}
        <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
          Abrió {h.opened_by ?? "—"} · cerró {h.closed_by ?? "—"} · debía {money(h.expected)} · contó {money(h.counted)}
          {h.closing_note ? ` · «${h.closing_note}»` : ""}{h.review_note ? ` · revisó ${h.reviewed_by ?? ""}: ${h.review_note}` : ""}
        </span>
      </span>
      <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: `color-mix(in oklab, ${diffColor(d)} 16%, transparent)`, color: diffColor(d) }}>{diffText(d)}</span>
      {h.status === "review" ? (canManage ? <Btn onClick={() => void approve()}>Revisar</Btn> : <span className="text-xs" style={{ color: "#f59e0b" }}>⚠️ Por revisar</span>) : null}
    </div>
  );
}

/* ----------------------------- abrir ----------------------------- */

function OpenDialog({ storeId, p, onClose, onSaved }: { storeId: string; p: PointCash; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (amount === null) return void toast("Escribe la base (puede ser $0)", "warning");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_cash_open", { p_store: storeId, p_point: p.point_id, p_amount: amount, p_note: note || null });
    setBusy(false);
    if (error) return void toast("No se pudo abrir", "error", errorMessage(error));
    void toast(`Caja de ${p.name} abierta`);
    onSaved();
  }
  return (
    <Modal title={`🔓 Abrir caja · ${p.name}`} subtitle="Cuenta el efectivo con el que empiezas (la base)." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Abriendo…" : "Abrir caja"}</Btn></>}>
      <Field label="Base inicial"><MoneyField big value={amount} onChange={setAmount} autoFocus /></Field>
      <div className="flex flex-wrap gap-2 text-xs">{[0, 50000, 100000, 200000].map((v) => <Chip key={v} on={amount === v} onClick={() => setAmount(v)}>{money(v)}</Chip>)}</div>
      <Field label="Nota (opcional)"><input className={inputClass} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

/* ----------------------------- entrada / salida ----------------------------- */

function MoveDialog({ p, onClose, onSaved }: { p: PointCash; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const quick = kind === "out" ? ["Retiro para consignar", "Pago a domiciliario", "Compra menor", "Cambio de billetes"] : ["Más base", "Devolución de cambio", "Otro ingreso"];
  async function save() {
    if (!amount) return void toast("Escribe el valor", "warning");
    if (!reason.trim()) return void toast("Escribe el motivo", "warning");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_cash_move", { p_session: p.open!.id, p_kind: kind, p_amount: amount, p_reason: reason });
    setBusy(false);
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    void toast("Guardado");
    onSaved();
  }
  return (
    <Modal title={`↕️ Entrada o salida · ${p.name}`} subtitle="Todo lo que entra o sale del cajón y no es una venta, con su motivo." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Btn></>}>
      <div className="flex gap-2 text-xs"><Chip on={kind === "out"} onClick={() => setKind("out")}>➖ Salida</Chip><Chip on={kind === "in"} onClick={() => setKind("in")}>➕ Entrada</Chip></div>
      <Field label="Valor"><MoneyField value={amount} onChange={setAmount} /></Field>
      <Field label="Motivo">
        <input className={inputClass} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{quick.map((q) => <Chip key={q} on={reason === q} onClick={() => setReason(q)}>{q}</Chip>)}</div>
      </Field>
    </Modal>
  );
}

/* ----------------------------- cerrar con conteo ----------------------------- */

function CloseDialog({ p, tolerance, onClose, onSaved }: { p: PointCash; tolerance: number; onClose: () => void; onSaved: () => void }) {
  const [count, setCount] = useState<Record<string, number | null>>({});
  const [direct, setDirect] = useState<number | null>(null);
  const [byDenom, setByDenom] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = Number(p.open?.breakdown.expected ?? 0);
  const counted = useMemo(() => (byDenom ? Object.entries(count).reduce((s, [d, n]) => s + Number(d) * Number(n ?? 0), 0) : Number(direct ?? 0)), [byDenom, count, direct]);
  const diff = counted - expected;
  const needsNote = Math.abs(diff) > tolerance;

  async function save() {
    if (needsNote && !note.trim()) return void toast("Explica la diferencia", "warning");
    setBusy(true);
    const detail = byDenom ? Object.fromEntries(Object.entries(count).filter(([, n]) => Number(n) > 0)) : null;
    const { data, error } = await supabaseBrowser().rpc("erp_cash_close", { p_session: p.open!.id, p_counted: counted, p_detail: detail, p_note: note || null });
    setBusy(false);
    if (error) return void toast("No se pudo cerrar", "error", errorMessage(error));
    const r = data as { status: string; difference: number };
    void toast(r.status === "review" ? "Caja cerrada · por revisar" : "Caja cerrada ✅", r.status === "review" ? "warning" : "success", diffText(Number(r.difference)));
    onSaved();
  }

  const row = (d: number, kind: string) => (
    <div key={`${kind}${d}`} className="flex items-center gap-2 text-xs">
      <span className="w-24 font-semibold">{kind === "c" ? "🪙" : "💵"} {money(d)}</span>
      <div className="w-24"><NumberField value={count[d] ?? null} onChange={(v) => setCount((c) => ({ ...c, [d]: v === null ? null : Math.max(0, Math.round(v)) }))} decimals={0} align="left" placeholder="0" /></div>
      <span className="tabular-nums" style={{ color: "var(--t-muted)" }}>= {money(d * Number(count[d] ?? 0))}</span>
    </div>
  );

  return (
    <Modal wide title={`🔒 Cerrar caja · ${p.name}`} subtitle={`Debe haber ${money(expected)}. Cuenta el efectivo y el sistema calcula la diferencia.`} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Cerrando…" : "Cerrar caja"}</Btn></>}>
      <div className="flex gap-2 text-xs"><Chip on={byDenom} onClick={() => setByDenom(true)}>Contar billetes y monedas</Chip><Chip on={!byDenom} onClick={() => setByDenom(false)}>Escribir el total</Chip></div>
      {byDenom ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><p className="text-xs font-bold">Billetes</p>{BILLS.map((d) => row(d, "b"))}</div>
          <div className="space-y-1.5"><p className="text-xs font-bold">Monedas</p>{COINS.map((d) => row(d, "c"))}</div>
        </div>
      ) : <Field label="Total contado"><MoneyField big value={direct} onChange={setDirect} /></Field>}
      <div className="grid grid-cols-3 gap-2">
        {[["Debe haber", money(expected), "var(--t-text)"], ["Contaste", money(counted), "var(--t-text)"], [diff === 0 ? "Cuadra" : diff < 0 ? "Faltante" : "Sobrante", money(Math.abs(diff)), diffColor(diff)]].map(([l, v, c]) => (
          <div key={l} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px] font-semibold uppercase" style={{ color: "var(--t-muted)" }}>{l}</p>
            <p className="text-lg font-black tabular-nums" style={{ color: c }}>{v}</p>
          </div>
        ))}
      </div>
      <Field label={needsNote ? "¿Qué pasó? (obligatorio)" : "Nota (opcional)"} hint={needsNote ? `La diferencia pasa la tolerancia (${money(tolerance)}): la madre la revisará.` : undefined}>
        <textarea className={inputClass} style={inputStyle} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ----------------------------- tolerancia ----------------------------- */

function ToleranceEditor({ storeId, value, onSaved }: { storeId: string; value: number; onSaved: () => void }) {
  async function edit() {
    const v = window.prompt("Diferencia permitida sin revisión (en pesos):", String(value))?.replace(/\D/g, "");
    if (v === undefined || v === "") return;
    const { error } = await supabaseBrowser().rpc("erp_cash_settings_save", { p_store: storeId, p_tolerance: Number(v) });
    if (error) return void toast("No se pudo guardar", "error", errorMessage(error));
    void toast("Tolerancia guardada");
    onSaved();
  }
  return <Btn variant="ghost" onClick={() => void edit()}>⚙️ Tolerancia: {money(value)}</Btn>;
}
