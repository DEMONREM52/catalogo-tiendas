"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import Swal from "sweetalert2";

/** Ejecuta una carga asíncrona al montar y cuando cambia su dependencia. */
export function useRunOnChange(load: () => void | Promise<void>) {
  useEffect(() => {
    void load();
  }, [load]);
}

export type ErpCtx = {
  storeId: string;
  /** Punto/bodega al que está restringido el usuario; null si ve todo. */
  pointId: string | null;
  can: (permission: string) => boolean;
};

export type Warehouse = {
  id: string; code: string; name: string; address: string | null; is_default: boolean; active: boolean;
  kind: "warehouse" | "point"; phone: string | null; invoice_prefix: string; remision_prefix: string;
  next_invoice_number: number; next_remision_number: number;
};
export const WAREHOUSE_COLUMNS = "id,code,name,address,is_default,active,kind,phone,invoice_prefix,remision_prefix,next_invoice_number,next_remision_number";
export type ProductHit = { id: string; name: string; sku: string | null; barcode: string | null; cost_price: number; tax_rate: number; stock: number; wh_qty: number };

export const money = (value: number | null | undefined) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Compra",
  purchase_void: "Anulación de compra",
  transfer_out: "Traslado · salida",
  transfer_in: "Traslado · entrada",
  transfer_void: "Traslado anulado",
  transfer_return: "Traslado · faltante devuelto",
  adjustment: "Ajuste",
  sale: "Venta",
  sale_return: "Devolución de venta",
  manual_in: "Entrada manual",
  manual_out: "Salida manual",
};

export const ADJUST_REASONS: Array<[string, string]> = [
  ["count", "Conteo físico"],
  ["damage", "Producto dañado"],
  ["loss", "Pérdida / faltante"],
  ["expired", "Vencido"],
  ["found", "Sobrante encontrado"],
  ["correction", "Corrección de registro"],
  ["other", "Otro"],
];

export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (/does not exist|schema cache|PGRST20|Could not find the function/i.test(error.message)) {
      return "Falta ejecutar el SQL del módulo (supabase/erp_core.sql y supabase/erp_ops.sql) en Supabase.";
    }
    return error.message;
  }
  return "Ocurrió un error inesperado.";
}

export function toast(title: string, icon: "success" | "error" | "warning" = "success", text?: string) {
  return Swal.fire({
    icon,
    title,
    text,
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
    confirmButtonColor: "#8b5cf6",
    timer: icon === "success" ? 1800 : undefined,
    showConfirmButton: icon !== "success",
  });
}

export async function confirmAction(title: string, text: string, confirmText = "Confirmar") {
  const result = await Swal.fire({
    icon: "question",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancelar",
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
    confirmButtonColor: "#8b5cf6",
  });
  return result.isConfirmed;
}

export async function askReason(title: string) {
  const result = await Swal.fire({
    title,
    input: "text",
    inputPlaceholder: "Motivo (obligatorio)",
    showCancelButton: true,
    confirmButtonText: "Continuar",
    cancelButtonText: "Cancelar",
    background: "var(--t-bg-base)",
    color: "var(--t-text)",
    confirmButtonColor: "#8b5cf6",
    inputValidator: (value) => (value.trim() ? null : "Escribe un motivo."),
  });
  return result.isConfirmed ? String(result.value).trim() : null;
}

export const inputClass = "w-full rounded-xl border px-3 py-2.5 text-sm outline-none";
export const inputStyle: CSSProperties = {
  borderColor: "var(--t-card-border)",
  background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
  color: "var(--t-text)",
};

export function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass rounded-[24px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)" }}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Kpi({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "#ef4444" : tone === "warn" ? "#f59e0b" : tone === "good" ? "#10b981" : "var(--t-accent)";
  return (
    <div className="glass-soft rounded-[20px] border p-4" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
        <span className="grid h-8 w-8 place-items-center rounded-xl text-base" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}>{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-2xl font-bold" style={{ color: tone ? color : "var(--t-text)" }}>{value}</p>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const style: CSSProperties =
    variant === "primary"
      ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "var(--t-cta-text, #fff)", borderColor: "transparent" }
      : variant === "danger"
        ? { background: "color-mix(in oklab, #ef4444 14%, transparent)", color: "color-mix(in oklab, #ef4444 70%, var(--t-text))", borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }
        : { background: "transparent", color: "var(--t-text)", borderColor: "var(--t-card-border)" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      style={style}
    >
      {children}
    </button>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
      {text}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    received: ["Recibida", "#10b981"],
    in_transit: ["En tránsito", "#f59e0b"],
    cancelled: ["Anulada", "#ef4444"],
    open: ["Abierta", "#f59e0b"],
    paid: ["Pagada", "#10b981"],
    void: ["Anulada", "#ef4444"],
  };
  const [label, color] = map[status] ?? [status, "#94a3b8"];
  return (
    <span
      className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{
        color: `color-mix(in oklab, ${color} 68%, var(--t-text))`,
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

export const tableWrap = "overflow-x-auto rounded-2xl border";
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide";
export const td = "px-3 py-2.5 text-sm align-middle";
