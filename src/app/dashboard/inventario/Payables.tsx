"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Chip, Field, Modal, Toggle } from "./dialog";
import { supabaseBrowser } from "@/lib/supabase/client";
import { playTone } from "@/lib/sounds/tones";
import { MoneyInput } from "../MoneyInput";
import { useSuppliers } from "./PurchasesTabs";
import { Btn, Empty, Kpi, Panel, StatusPill, errorMessage, inputClass, inputStyle, money, toast, useRunOnChange, type ErpCtx } from "./shared";
import {
  DEFAULT_SETTINGS, REASON_TEXT, dueColor, dueText, isMissingFn,
  type PayableReminder, type PayableRow, type PayableSettings, type PayablesBoard,
} from "./payables-shared";
import { DateField } from "@/components/forms/Fields";

const purchaseReceiptUrl = (id: string) => `/comprobante/ingreso/${id}`;
const DAY_CHOICES = [30, 15, 10, 7, 5, 3, 2, 1, 0];
const EVERY_CHOICES = [1, 2, 3, 5, 7, 15, 30];
const METHOD_TEXT: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", other: "Otro" };
type Filter = "open" | "overdue" | "week" | "alert" | "closed";

const dayLabel = (d: number) => (d === 0 ? "El mismo día" : d === 1 ? "1 día antes" : `${d} días antes`);
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "";
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const waPhone = (p: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length === 10 ? `57${d}` : d.length >= 11 ? d : ""; };

/** Archivo de calendario (.ics) con alarma un día antes y el mismo día. */
function downloadIcs(r: PayableRow) {
  if (!r.due_date) return;
  const d = r.due_date.replace(/-/g, "");
  const next = addDays(r.due_date, 1).replace(/-/g, "");
  const title = `Pagar a ${r.supplier_name ?? "proveedor"} (${money(r.balance)})`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//REMHUB//Cuentas por pagar//ES", "BEGIN:VEVENT",
    `UID:cxp-${r.id}@remhub.co`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${title}`,
    `DESCRIPTION:Factura ${r.invoice_ref ?? ""} · Ingreso #${r.purchase_number ?? ""} · Saldo ${money(r.balance)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:PT8H", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `pago-${(r.supplier_name ?? "proveedor").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Cómo quedó el recordatorio de una cuenta, en una línea. */
function reminderSummary(rem: PayableReminder | null, s: PayableSettings) {
  if (!rem) return `Como la tienda: ${s.days_before.map((d) => (d === 0 ? "el día" : `${d}d`)).join(", ")} antes`;
  if (rem.muted) return "🔕 Silenciada";
  const parts: string[] = [];
  if (rem.days_before) parts.push(`${rem.days_before.map((d) => (d === 0 ? "el día" : `${d}d`)).join(", ")} antes`);
  if (rem.overdue_every_days) parts.push(`vencida: cada ${rem.overdue_every_days} día${rem.overdue_every_days === 1 ? "" : "s"}`);
  if (rem.remind_on.length) parts.push(`fechas: ${rem.remind_on.map(shortDate).join(", ")}`);
  if (rem.snooze_until) parts.push(`pospuesta hasta ${shortDate(rem.snooze_until)}`);
  return parts.length ? `Personalizado: ${parts.join(" · ")}` : "Personalizado";
}

export function PayablesTab({ ctx }: { ctx: ErpCtx }) {
  const { suppliers } = useSuppliers(ctx.storeId);
  const [board, setBoard] = useState<PayablesBoard | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [reminderFor, setReminderFor] = useState<PayableRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canPay = ctx.can("payables");
  const names = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_payables_board", { p_store: ctx.storeId, p_only_alerts: false });
    const res = data as PayablesBoard | null;
    if (!error && res?.ok) { setLegacy(false); setBoard(res); return; }
    if (error && !isMissingFn(error.message)) return void toast("No se pudieron cargar las cuentas por pagar", "error", errorMessage(error));
    if (res && !res.ok) return void toast("Cuentas por pagar", "warning", res.error);
    // Sin la migración 20261122: lista básica como antes.
    const old = await supabaseBrowser().from("erp_payables").select("id,supplier_id,purchase_id,total,balance,due_date,status,created_at")
      .eq("store_id", ctx.storeId).order("status").order("due_date", { ascending: true, nullsFirst: false }).limit(100);
    if (old.error) return void toast("No se pudieron cargar las cuentas por pagar", "error", errorMessage(old.error));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const rows = (old.data ?? []).map((r) => ({
      ...r, supplier_name: null, supplier_phone: null, purchase_number: null, invoice_ref: null, warehouse_name: null,
      days_left: r.due_date ? Math.round((new Date(`${r.due_date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000) : null,
      reason: null, seen_today: false, snoozed_until: null, reminder: null, payments: [],
    })) as PayableRow[];
    setLegacy(true);
    setBoard({ ok: true, today, can_config: false, settings: DEFAULT_SETTINGS, rows });
  }, [ctx.storeId]);

  useRunOnChange(load);
  const reload = () => { void load(); window.dispatchEvent(new Event("remhub:payables-changed")); };

  async function pay(row: PayableRow) {
    const value = Number(amount);
    if (!value || value <= 0) return void toast("Escribe el monto del pago", "warning");
    const { error } = await supabaseBrowser().rpc("erp_pay_supplier", { p_payable: row.id, p_amount: value, p_method: method, p_reference: reference });
    if (error) return void toast("No se pudo registrar el pago", "error", errorMessage(error));
    setPayingId(null);
    setAmount("");
    setReference("");
    void toast(value >= Number(row.balance) ? "Cuenta pagada por completo ✅" : "Pago registrado");
    reload();
  }

  const rows = board?.rows ?? [];
  const settings = board?.settings ?? DEFAULT_SETTINGS;
  const open = rows.filter((r) => r.status === "open");
  const sum = (list: PayableRow[]) => list.reduce((s, r) => s + Number(r.balance), 0);
  const overdueRows = open.filter((r) => (r.days_left ?? 1) < 0);
  const todayRows = open.filter((r) => r.days_left === 0);
  const weekRows = open.filter((r) => r.days_left !== null && r.days_left > 0 && r.days_left <= 7);
  const supplierName = (r: PayableRow) => r.supplier_name ?? names.get(r.supplier_id) ?? "Proveedor";

  const shown = rows.filter((r) => {
    if (filter === "open" && r.status !== "open") return false;
    if (filter === "overdue" && !(r.status === "open" && (r.days_left ?? 1) < 0)) return false;
    if (filter === "week" && !(r.status === "open" && r.days_left !== null && r.days_left <= 7)) return false;
    if (filter === "alert" && !(r.status === "open" && r.reason)) return false;
    if (filter === "closed" && r.status === "open") return false;
    const needle = q.trim().toLowerCase();
    return !needle || [supplierName(r), r.invoice_ref, r.warehouse_name, String(r.purchase_number ?? "")].some((v) => (v ?? "").toLowerCase().includes(needle));
  });

  const chips: Array<[Filter, string, number]> = [
    ["open", "Abiertas", open.length],
    ["overdue", "🔴 Vencidas", overdueRows.length],
    ["week", "🟠 Próximos 7 días", open.filter((r) => r.days_left !== null && r.days_left <= 7).length],
    ["alert", "🔔 Con aviso hoy", open.filter((r) => r.reason).length],
    ["closed", "Pagadas / anuladas", rows.length - open.length],
  ];

  return (
    <Panel
      title="Cuentas por pagar"
      subtitle={`Saldo pendiente con proveedores: ${money(sum(open))}`}
      actions={board?.can_config ? <Btn variant="ghost" onClick={() => setSettingsOpen(true)}>⚙️ Avisos y recordatorios</Btn> : null}
    >
      {legacy ? (
        <p className="mb-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)", color: "var(--t-muted)" }}>
          ⚠️ Para usar avisos y recordatorios, ejecuta en Supabase la migración <b>20261122_alertas_cuentas_por_pagar.sql</b>.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="🔴" label="Vencido" value={money(sum(overdueRows))} tone={overdueRows.length ? "bad" : undefined} />
        <Kpi icon="⏰" label="Vence hoy" value={money(sum(todayRows))} tone={todayRows.length ? "bad" : undefined} />
        <Kpi icon="📅" label="Próximos 7 días" value={money(sum(weekRows))} tone={weekRows.length ? "warn" : undefined} />
        <Kpi icon="💰" label="Total pendiente" value={money(sum(open))} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {chips.map(([key, label, n]) => (
          <button key={key} type="button" onClick={() => setFilter(key)} className="rounded-full border px-3 py-1.5 font-semibold transition"
            style={filter === key
              ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "#fff", borderColor: "transparent" }
              : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
            {label} <span className="opacity-70">({n})</span>
          </button>
        ))}
        <input className={`${inputClass} ml-auto sm:max-w-64`} style={inputStyle} placeholder="🔎 Proveedor, factura o punto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!board ? <Empty text="Cargando…" /> : shown.length === 0 ? (
        <Empty text={rows.length ? "No hay cuentas con este filtro." : "No hay cuentas por pagar. Se crean al registrar compras a crédito."} />
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const color = dueColor(r);
            const paidPct = Number(r.total) > 0 ? Math.min(100, Math.round(((Number(r.total) - Number(r.balance)) / Number(r.total)) * 100)) : 0;
            const phone = waPhone(r.supplier_phone);
            return (
              <div key={r.id} className="glass-soft rounded-2xl border p-4" style={{ borderColor: r.status === "open" && (r.days_left ?? 1) <= 0 ? `color-mix(in oklab, ${color} 50%, transparent)` : "var(--t-card-border)" }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{supplierName(r)}</p>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                      {[r.purchase_number ? `Ingreso #${r.purchase_number}` : "", r.invoice_ref ? `Factura ${r.invoice_ref}` : "", r.warehouse_name ?? ""].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {r.status === "open" ? (
                      <span className="rounded-full px-2.5 py-0.5 font-bold" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color: `color-mix(in oklab, ${color} 75%, var(--t-text))` }}>
                        {dueText(r)}
                      </span>
                    ) : null}
                    {r.reason ? (
                      <span title={REASON_TEXT[r.reason]} className="rounded-full border px-2.5 py-0.5 font-semibold" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)" }}>
                        🔔 {r.reason === "date" ? "Tu recordatorio de hoy" : "Aviso hoy"}
                      </span>
                    ) : null}
                    {r.reminder?.muted && r.status === "open" ? <span className="rounded-full border px-2.5 py-0.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>🔕 Silenciada</span> : null}
                    {r.status !== "open" ? <StatusPill status={r.status} /> : null}
                  </div>
                </div>

                <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
                  Total {money(r.total)} · Saldo <b style={{ color: "var(--t-text)" }}>{money(r.balance)}</b>{r.due_date ? ` · vence ${shortDate(r.due_date)}` : ""}
                </p>
                {paidPct > 0 ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
                    <div className="h-full rounded-full" style={{ width: `${paidPct}%`, background: "linear-gradient(90deg,#22c55e,#3987e5)" }} />
                  </div>
                ) : null}
                {!legacy && r.status === "open" ? (
                  <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                    🔔 {reminderSummary(r.reminder, settings)}{r.reminder?.note ? <> · 📝 <b style={{ color: "var(--t-text)" }}>{r.reminder.note}</b></> : null}
                  </p>
                ) : null}

                {canPay && r.status === "open" && payingId === r.id ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="$ Monto" value={amount === "" ? null : Math.min(Number(amount), r.balance)} onValueChange={(v) => setAmount(v === null ? "" : String(Math.min(v, r.balance)))} />
                    <select className={inputClass} style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                      {Object.entries(METHOD_TEXT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input className={inputClass} style={inputStyle} placeholder="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} />
                    <div className="flex gap-2"><Btn onClick={() => void pay(r)}>Pagar</Btn><Btn variant="ghost" onClick={() => setPayingId(null)}>Cancelar</Btn></div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canPay && r.status === "open" ? <Btn onClick={() => { setPayingId(r.id); setAmount(String(r.balance)); }}>💸 Registrar pago</Btn> : null}
                    {!legacy && r.status === "open" ? <Btn variant="ghost" onClick={() => setReminderFor(r)}>🔔 Recordatorio</Btn> : null}
                    {r.due_date && r.status === "open" ? <Btn variant="ghost" onClick={() => downloadIcs(r)}>📅 Calendario</Btn> : null}
                    {r.purchase_id ? <Btn variant="ghost" onClick={() => window.open(purchaseReceiptUrl(r.purchase_id!), "_blank")}>🧾 Ingreso</Btn> : null}
                    {phone && r.status === "open" ? (
                      <Btn variant="ghost" onClick={() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${supplierName(r)}, te escribimos por la factura ${r.invoice_ref ?? ""} (saldo ${money(r.balance)}).`)}`, "_blank")}>💬 Proveedor</Btn>
                    ) : null}
                    {r.payments.length ? <Btn variant="ghost" onClick={() => setHistoryId(historyId === r.id ? null : r.id)}>📜 Pagos ({r.payments.length})</Btn> : null}
                  </div>
                )}

                {historyId === r.id ? (
                  <ul className="mt-3 space-y-1 border-t pt-3 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                    {r.payments.map((p, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2">
                        <span>{new Date(p.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} · {METHOD_TEXT[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                        <b>{money(p.amount)}</b>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {reminderFor && board ? <ReminderDialog key="rem" row={reminderFor} board={board} name={supplierName(reminderFor)} onClose={() => setReminderFor(null)} onSaved={() => { setReminderFor(null); reload(); }} /> : null}
        {settingsOpen && board ? <SettingsDialog key="set" storeId={ctx.storeId} initial={settings} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); reload(); }} /> : null}
      </AnimatePresence>
    </Panel>
  );
}

/* ----------------------------- piezas de los diálogos ----------------------------- */

/** Días antes del vencimiento: chips + un número propio. */
function DaysPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [custom, setCustom] = useState("");
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => b - a));
  const extra = value.filter((d) => !DAY_CHOICES.includes(d));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {[...DAY_CHOICES, ...extra].sort((a, b) => b - a).map((d) => <Chip key={d} on={value.includes(d)} onClick={() => toggle(d)}>{dayLabel(d)}</Chip>)}
      <span className="inline-flex items-center gap-1">
        <input className="w-16 rounded-full border px-2.5 py-1.5 text-center outline-none" style={inputStyle} inputMode="numeric" placeholder="Otro" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        <button type="button" className="rounded-full border px-2.5 py-1.5 font-bold" style={{ borderColor: "var(--t-card-border)" }}
          onClick={() => { const n = Number(custom); if (custom !== "" && n <= 90 && !value.includes(n)) onChange([...value, n].sort((a, b) => b - a)); setCustom(""); }}>+</button>
      </span>
    </div>
  );
}

function EveryPicker({ value, onChange, allowDefault }: { value: number | null; onChange: (v: number | null) => void; allowDefault?: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {allowDefault ? <Chip on={value === null} onClick={() => onChange(null)}>{allowDefault}</Chip> : null}
      {EVERY_CHOICES.map((d) => <Chip key={d} on={value === d} onClick={() => onChange(d)}>{d === 1 ? "Todos los días" : `Cada ${d} días`}</Chip>)}
    </div>
  );
}

/* ----------------------------- recordatorio de una cuenta ----------------------------- */

type Mode = "store" | "custom" | "muted";

function ReminderDialog({ row, board, name, onClose, onSaved }: { row: PayableRow; board: PayablesBoard; name: string; onClose: () => void; onSaved: () => void }) {
  const rem = row.reminder;
  const today = board.today;
  const [mode, setMode] = useState<Mode>(!rem ? "store" : rem.muted ? "muted" : "custom");
  const [ownDays, setOwnDays] = useState(rem?.days_before !== null && rem?.days_before !== undefined);
  const [days, setDays] = useState<number[]>(rem?.days_before ?? board.settings.days_before);
  const [every, setEvery] = useState<number | null>(rem?.overdue_every_days ?? null);
  const [dates, setDates] = useState<string[]>(rem?.remind_on ?? []);
  const [newDate, setNewDate] = useState("");
  const [snooze, setSnooze] = useState(rem?.snooze_until ?? "");
  const [note, setNote] = useState(rem?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const cfg = mode === "store" && !note.trim() ? null : {
      muted: mode === "muted",
      days_before: mode === "custom" && ownDays ? days : null,
      overdue_every_days: mode === "custom" ? every : null,
      remind_on: mode === "custom" ? dates : [],
      snooze_until: mode === "custom" && snooze ? snooze : null,
      note: note.trim() || null,
    };
    const { error } = await supabaseBrowser().rpc("erp_payable_reminder_save", { p_payable: row.id, p_cfg: cfg });
    setBusy(false);
    if (error) return void toast("No se guardó el recordatorio", "error", errorMessage(error));
    void toast(cfg === null ? "La cuenta sigue las reglas de la tienda" : mode === "muted" ? "Avisos silenciados para esta cuenta 🔕" : "Recordatorio guardado 🔔");
    onSaved();
  }

  const quick: Array<[string, string]> = [["Mañana", addDays(today, 1)], ["En 3 días", addDays(today, 3)], ["En 1 semana", addDays(today, 7)]];
  if (row.due_date && row.due_date > today) quick.push(["1 día antes de vencer", addDays(row.due_date, -1)]);

  return (
    <Modal
      title={`🔔 Recordatorio · ${name}`}
      subtitle={`${dueText(row)} · Saldo ${money(row.balance)}. Lo que pongas aquí aplica a todos los que manejan esta cuenta.`}
      onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Btn></>}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {([["store", "🏪 Como la tienda", "Usa las reglas generales"], ["custom", "✏️ Personalizado", "Días, frecuencia y fechas propias"], ["muted", "🔕 Silenciar", "No avisar de esta cuenta"]] as Array<[Mode, string, string]>).map(([m, t, h]) => (
          <button key={m} type="button" onClick={() => setMode(m)} className="rounded-2xl border p-3 text-left transition"
            style={mode === m ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <b className="block">{t}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{h}</span>
          </button>
        ))}
      </div>

      {mode === "store" ? (
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>{reminderSummary(null, board.settings)}; vencida: {board.settings.overdue_every_days === 1 ? "todos los días" : `cada ${board.settings.overdue_every_days} días`}.</p>
      ) : null}

      {mode === "custom" ? (
        <>
          <Field label="Avisar antes de vencer" hint="Escoge los días. Si no lo cambias, usa los de la tienda.">
            <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" className="accent-violet-500" checked={ownDays} onChange={(e) => setOwnDays(e.target.checked)} /> Usar días propios para esta cuenta</label>
            {ownDays ? <DaysPicker value={days} onChange={setDays} /> : null}
          </Field>
          <Field label="Si se vence, insistir">
            <EveryPicker value={every} onChange={setEvery} allowDefault="Como la tienda" />
          </Field>
          <Field label="Recuérdame en fechas exactas" hint="Ej.: el día que llega la plata o el día de pago al proveedor.">
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              {quick.map(([l, d]) => <Chip key={l} on={dates.includes(d)} onClick={() => setDates((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}>{l}</Chip>)}
            </div>
            <div className="flex gap-2">
              <DateField value={newDate} onChange={(v) => setNewDate(v)} min={today} />
              <Btn variant="ghost" onClick={() => { if (newDate && !dates.includes(newDate)) setDates([...dates, newDate].sort()); setNewDate(""); }}>Agregar</Btn>
            </div>
            {dates.length ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {dates.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1" style={{ borderColor: "var(--t-card-border)" }}>
                    📅 {shortDate(d)} <button type="button" className="font-bold opacity-70" onClick={() => setDates(dates.filter((x) => x !== d))} aria-label="Quitar">×</button>
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
          <Field label="Posponer avisos hasta" hint="Ej.: ya acordaste con el proveedor pagar más tarde.">
            <div className="flex gap-2">
              <DateField value={snooze} onChange={(v) => setSnooze(v)} min={today} />
              {snooze ? <Btn variant="ghost" onClick={() => setSnooze("")}>Quitar</Btn> : null}
            </div>
          </Field>
        </>
      ) : null}

      <Field label="Nota para el aviso (opcional)" hint="Sale en el aviso. Ej.: «Pagar con la transferencia del lunes».">
        <textarea className={inputClass} style={inputStyle} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {rem?.updated_by_name ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Último cambio: {rem.updated_by_name} · {new Date(rem.updated_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
    </Modal>
  );
}

/* ----------------------------- reglas de la tienda ----------------------------- */

function SettingsDialog({ storeId, initial, onClose, onSaved }: { storeId: string; initial: PayableSettings; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<PayableSettings>(initial);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<PayableSettings>) => setS((cur) => ({ ...cur, ...p }));

  async function save() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("erp_payable_alert_settings_save", { p_store: storeId, p_cfg: s });
    setBusy(false);
    if (error) return void toast("No se guardaron los avisos", "error", errorMessage(error));
    void toast("Avisos de cuentas por pagar guardados");
    onSaved();
  }

  return (
    <Modal
      title="⚙️ Avisos de cuentas por pagar"
      subtitle="Reglas para toda la tienda. Cada cuenta puede tener su propio recordatorio (botón 🔔 en la cuenta)."
      onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</Btn></>}
    >
      <Toggle on={s.enabled} onChange={(v) => patch({ enabled: v })} label="Avisar de cuentas por pagar" />
      {s.enabled ? (
        <>
          <Field label="¿Cuántos días antes de vencer avisar?" hint="Puedes escoger varios. Ej.: una semana antes, 3 días, el día anterior y el mismo día.">
            <DaysPicker value={s.days_before} onChange={(v) => patch({ days_before: v })} />
          </Field>
          <Field label="Cuando ya está vencida, insistir">
            <EveryPicker value={s.overdue_every_days} onChange={(v) => patch({ overdue_every_days: v ?? 1 })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mostrar avisos desde las" hint="Antes de esa hora no salen en pantalla.">
              <select className={inputClass} style={inputStyle} value={s.from_hour} onChange={(e) => patch({ from_hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "a. m." : "p. m."}`}</option>)}
              </select>
            </Field>
            <Field label="Solo cuentas desde" hint="Las de menor saldo no avisan (salvo recordatorio propio).">
              <MoneyInput allowEmpty className={inputClass} style={inputStyle} placeholder="$ 0 = todas" value={s.min_amount || null} onValueChange={(v) => patch({ min_amount: v ?? 0 })} />
            </Field>
          </div>
          <Toggle on={s.sound} onChange={(v) => patch({ sound: v })} label="🔊 Sonido con el aviso en pantalla" />
          {s.sound ? (
            <div className="flex gap-2 text-xs">
              <Btn variant="ghost" onClick={() => playTone("campana-dorada", 0.8)}>▶ Por vencer</Btn>
              <Btn variant="ghost" onClick={() => playTone("intercomunicador", 0.8)}>▶ Vencida</Btn>
            </div>
          ) : null}
          <Toggle on={s.push} onChange={(v) => patch({ push: v })} label="📲 Resumen diario al celular (8:00 a. m.)" />
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            Reciben los avisos el dueño y quienes tengan el permiso «Cuentas por pagar», cada uno solo con las cuentas de sus puntos.
            Cada persona puede marcar «Ya lo vi» o «En 1 hora» sin callárselo a los demás.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
