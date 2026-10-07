export type SrStatus = "pending" | "preparing" | "dispatched" | "received" | "rejected" | "cancelled";
export type SrAccess = { attend: boolean; request: boolean; view: boolean; chat?: boolean };

export const SR_STATUS: Record<SrStatus, { label: string; short: string; color: string; icon: string; step: number }> = {
  pending: { label: "Enviado · esperando respuesta", short: "Enviado", color: "#8b5cf6", icon: "📨", step: 0 },
  preparing: { label: "En preparación", short: "Preparando", color: "#f59e0b", icon: "🧑‍🔧", step: 1 },
  dispatched: { label: "En camino", short: "En camino", color: "#0ea5e9", icon: "🚚", step: 2 },
  received: { label: "Recibido", short: "Recibido", color: "#22c55e", icon: "✅", step: 3 },
  rejected: { label: "Rechazado", short: "Rechazado", color: "#ef4444", icon: "⛔", step: -1 },
  cancelled: { label: "Cancelado", short: "Cancelado", color: "#94a3b8", icon: "🚫", step: -1 },
};
export const SR_STEPS: SrStatus[] = ["pending", "preparing", "dispatched", "received"];
export const isOpen = (s: SrStatus) => s === "pending" || s === "preparing" || s === "dispatched";

export type SrListItem = {
  id: string; number: number; status: SrStatus; priority: "normal" | "urgent"; note: string | null; needed_by: string | null;
  from_point_id: string; from_name: string; to_point_id: string; to_name: string;
  requested_by_name: string | null; handled_by_name: string | null;
  created_at: string; updated_at: string; closed_at: string | null; items: number; units: number;
  last_message: { body: string; user_name: string | null; kind: "message" | "system"; created_at: string } | null;
  unread: number; access: SrAccess;
};

export type SrItem = {
  id: string; product_id: string; name: string; sku: string | null; image_url: string | null;
  qty_requested: number; qty_approved: number | null; qty_received: number | null; note: string | null;
  source_now: number; dest_now: number; source_at_request: number | null;
};
export type SrMessage = { id: string; user_id: string | null; user_name: string | null; point_name: string | null; kind: "message" | "system"; body: string; created_at: string; mine: boolean };
export type SrDetail = {
  request: { id: string; store_id: string; number: number; status: SrStatus; priority: "normal" | "urgent"; note: string | null; needed_by: string | null;
    from_point_id: string; from_name: string; to_point_id: string; to_name: string; requested_by_name: string | null; handled_by_name: string | null;
    created_at: string; closed_at: string | null; close_reason: string | null };
  access: SrAccess & { chat: boolean };
  items: SrItem[];
  messages: SrMessage[];
  transfer: { id: string; number: number; status: string; track_token: string | null } | null;
};

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return "ahora";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d < 8 ? `hace ${d} d` : new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

export function srError(error: unknown) {
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
  if (/Could not find the function|schema cache|does not exist/i.test(msg)) return "Falta ejecutar en Supabase la migración 20261019_pedidos_internos.sql.";
  return msg;
}

/** Abre un pedido interno desde cualquier parte del panel (notificaciones, avisos…). */
export const OPEN_REQUEST_EVENT = "remhub-open-stock-request";
