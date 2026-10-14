"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import Swal from "sweetalert2";

export { cop, cardStyle, inputStyle, swalTheme, Stat, downloadCsv, esc } from "../rentabilidad/shared";
import { esc, swalTheme } from "../rentabilidad/shared";

export type Category = { id: string; name: string; emoji: string; kind: "fixed" | "variable"; is_payroll: boolean; active: boolean; sort_order: number };
export type Recurring = { id: string; point_id: string | null; category_id: string; description: string; payee_name: string | null; amount: number; frequency: Frequency; day_of_month: number; starts_on: string; ends_on: string | null; due_days: number; active: boolean; last_generated_on: string | null };
export type Budget = { id: string; point_id: string | null; category_id: string | null; period: Period; amount: number; active: boolean };
export type Fund = { id: string; point_id: string | null; name: string; purpose: string | null; target: number | null; active: boolean; balance: number; moves: Array<{ id: string; kind: "in" | "out"; amount: number; note: string | null; moved_at: string; by: string | null }> };
export type Employee = { id: string; point_id: string | null; full_name: string; document_type: string; document: string | null; position: string | null; contract_type: string; base_salary: number; pay_frequency: Period; transport_aid: boolean; hired_on: string | null; terminated_on: string | null; active: boolean; phone: string | null; email: string | null; bank_name: string | null; bank_account: string | null; notes: string | null };
export type Concept = { id: string; code: string; name: string; kind: "earning" | "deduction" | "employer"; calc: "salary" | "transport" | "base_pct" | "fixed" | "manual"; value: number; in_base: boolean; base_includes_transport: boolean; active: boolean; note: string | null };
export type Catalog = {
  categories: Category[]; recurring: Recurring[]; budgets: Budget[]; funds: Fund[]; employees: Employee[] | null; concepts: Concept[] | null;
  can: { expenses: boolean; pay: boolean; budgets: boolean; payroll: boolean; payroll_approve: boolean; payroll_pay: boolean; profit: boolean; madre: boolean };
  my_points: string[] | null;
};
export type Point = { id: string; name: string };
export type Period = "weekly" | "biweekly" | "monthly";
export type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "bimonthly" | "quarterly" | "yearly";

export const PERIOD_LABEL: Record<Period, string> = { weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };
export const FREQ_LABEL: Record<Frequency, string> = {
  weekly: "Cada semana", biweekly: "Cada 2 semanas", semimonthly: "Quincenal (15 y fin de mes)", monthly: "Cada mes",
  bimonthly: "Cada 2 meses", quarterly: "Cada 3 meses", yearly: "Cada año",
};
export const METHODS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", nequi: "Nequi / Daviplata", card: "Tarjeta", other: "Otro" };
export const n = (v: unknown) => Number(v ?? 0);

export const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const fdate = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const label = "text-xs font-bold uppercase tracking-wide";
export const field = "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none";

/** Ventana del periodo que contiene una fecha (igual que en la base: quincena = 1-15 y 16-fin de mes). */
export function periodWindow(kind: Period | "prev_month", ref = new Date()): [string, string] {
  const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate();
  if (kind === "weekly") {
    const dow = (ref.getDay() + 6) % 7;
    const start = new Date(y, m, d - dow);
    return [iso(start), iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))];
  }
  if (kind === "biweekly") return d <= 15 ? [iso(new Date(y, m, 1)), iso(new Date(y, m, 15))] : [iso(new Date(y, m, 16)), iso(new Date(y, m + 1, 0))];
  if (kind === "prev_month") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
}

export function rpcError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/Could not find the function|schema cache|does not exist/i.test(msg)) return "Falta ejecutar en Supabase la migración 20261110_gastos_presupuestos_nomina.sql.";
  return msg;
}
export const fail = (e: unknown) => void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo", text: rpcError(e) });
export const done = (title: string, text?: string) => void Swal.fire({ ...swalTheme, icon: "success", title, text, timer: 1600, showConfirmButton: false });

export async function ask(title: string, placeholder = "Motivo") {
  const r = await Swal.fire({ ...swalTheme, title: esc(title), input: "text", inputPlaceholder: placeholder, showCancelButton: true, confirmButtonText: "Confirmar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim().length < 3 ? "Escribe al menos 3 letras" : null) });
  return r.isConfirmed ? String(r.value).trim() : null;
}

/** Pide un pago (valor, método, referencia). La llave se crea una vez: si se reintenta, no se duplica. */
export async function askPayment(title: string, pending: number, hint = "Se registra en RemHub; no confirma que el banco haya hecho la transferencia.") {
  const r = await Swal.fire({
    ...swalTheme,
    title: esc(title),
    html: `<p style="font-size:13px;opacity:.8">Pendiente $${pending.toLocaleString("es-CO")}. ${hint}</p>
      <input id="amt" type="number" class="swal2-input" value="${pending}" min="0" step="0.01" />
      <select id="met" class="swal2-select">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <input id="ref" class="swal2-input" placeholder="Referencia o comprobante (opcional)" />`,
    showCancelButton: true, confirmButtonText: "Registrar pago", cancelButtonText: "Cancelar",
    preConfirm: () => ({ amount: Number((document.getElementById("amt") as HTMLInputElement).value), method: (document.getElementById("met") as HTMLSelectElement).value, ref: (document.getElementById("ref") as HTMLInputElement).value }),
  });
  return r.isConfirmed ? { ...(r.value as { amount: number; method: string; ref: string }), key: `pay-${crypto.randomUUID()}` } : null;
}

export function Sheet({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return createPortal(
    <motion.div className="fixed inset-0 z-140 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[94dvh] w-full ${wide ? "max-w-4xl" : "max-w-xl"} flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl`} style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black">{title}</h2>
            {subtitle ? <div className="text-xs" style={{ color: "var(--t-muted)" }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer> : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold [scrollbar-width:none]" style={{ borderColor: "var(--t-card-border)" }}>
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className="shrink-0 rounded-full px-3 py-1.5" style={value === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{l}</button>
      ))}
    </div>
  );
}

export const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-40";
export const primaryBg = { background: "linear-gradient(135deg,#d95926,#8b5cf6)" };
export const ghostBtn = "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold";
