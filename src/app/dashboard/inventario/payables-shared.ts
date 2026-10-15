/** Tipos y textos compartidos por Cuentas por pagar y su aviso flotante. */

export type PayableSettings = {
  enabled: boolean;
  days_before: number[];
  overdue_every_days: number;
  from_hour: number;
  min_amount: number;
  sound: boolean;
  push: boolean;
};

export type PayableReminder = {
  muted: boolean;
  days_before: number[] | null;
  overdue_every_days: number | null;
  remind_on: string[];
  snooze_until: string | null;
  note: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type PayablePayment = { amount: number; method: string; reference: string | null; created_at: string };

export type PayableRow = {
  id: string;
  supplier_id: string;
  supplier_name: string | null;
  supplier_phone: string | null;
  purchase_id: string | null;
  purchase_number: number | null;
  invoice_ref: string | null;
  warehouse_name: string | null;
  total: number;
  balance: number;
  due_date: string | null;
  status: "open" | "paid" | "void" | string;
  created_at: string;
  days_left: number | null;
  reason: "before" | "today" | "overdue" | "date" | null;
  seen_today: boolean;
  snoozed_until: string | null;
  reminder: PayableReminder | null;
  payments: PayablePayment[];
};

export type PayablesBoard = { ok: boolean; error?: string; today: string; can_config: boolean; settings: PayableSettings; rows: PayableRow[] };

export const DEFAULT_SETTINGS: PayableSettings = { enabled: true, days_before: [7, 3, 1, 0], overdue_every_days: 1, from_hour: 7, min_amount: 0, sound: true, push: true };

/** «Vencida hace 3 días», «Vence hoy», «Vence en 5 días». */
export function dueText(r: Pick<PayableRow, "days_left" | "status">) {
  if (r.status === "paid") return "Pagada";
  if (r.status === "void") return "Anulada";
  const d = r.days_left;
  if (d === null || d === undefined) return "Sin fecha de vencimiento";
  if (d < 0) return `Vencida hace ${-d} día${d === -1 ? "" : "s"}`;
  if (d === 0) return "Vence hoy";
  if (d === 1) return "Vence mañana";
  return `Vence en ${d} días`;
}

/** Color del semáforo: rojo vencida/hoy, ámbar ≤ 7 días, verde lo demás. */
export function dueColor(r: Pick<PayableRow, "days_left" | "status">) {
  if (r.status !== "open") return "#94a3b8";
  const d = r.days_left;
  if (d === null || d === undefined) return "#94a3b8";
  if (d <= 0) return "#ef4444";
  if (d <= 7) return "#f59e0b";
  return "#22c55e";
}

export const REASON_TEXT: Record<string, string> = {
  before: "Aviso de vencimiento",
  today: "Vence hoy",
  overdue: "Vencida",
  date: "Recordatorio que pusiste",
};

export const isMissingFn = (msg: string | undefined) => /erp_payables_board|erp_payable_|Could not find the function|does not exist/i.test(msg ?? "");
