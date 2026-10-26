"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { isNetworkError } from "@/lib/net/status";

/**
 * Simulacro mensual «vender sin internet» (20261244): cada cajero lo hace una vez al mes con el modo
 * práctica (nada se registra). Queda guardado quién lo hizo, cuándo y cuánto tardó.
 */
export type DrillStatus = {
  ok: boolean;
  message?: string;
  enabled: boolean;
  period: string;
  due_date: string;
  due_day: number;
  overdue: boolean;
  include_fiscal: boolean;
  must: boolean;
  manager: boolean;
  mine: { started_at: string; completed_at: string | null; steps: Record<string, unknown>; seconds: number | null } | null;
  team: Array<{ user_id: string; name: string; point_name: string | null; completed_at: string | null; started_at: string | null; last_completed: string | null }> | null;
};
export type DrillSteps = { sale: boolean; contingency: boolean | null; print: boolean | "skip"; ended: boolean };
export type ActiveDrill = { startedAt: number; printed: boolean; skipPrint: boolean };

/** Lo dispara el POS al imprimir un comprobante de práctica (paso «imprimir» del simulacro). */
export const PRACTICE_PRINT_EVENT = "remhub:practice-print";

const activeKey = (storeId: string) => `remhub:drill:${storeId}`;
const pendingKey = (storeId: string) => `remhub:drill-done:${storeId}`;

export async function loadDrillStatus(storeId: string): Promise<DrillStatus | null> {
  const { data, error } = await supabaseBrowser().rpc("erp_drill_status", { p_store: storeId });
  if (error) return null;
  const r = data as DrillStatus | null;
  return r?.ok ? r : null;
}

export function readActiveDrill(storeId: string): ActiveDrill | null {
  try {
    const raw = sessionStorage.getItem(activeKey(storeId));
    return raw ? (JSON.parse(raw) as ActiveDrill) : null;
  } catch {
    return null;
  }
}

export function writeActiveDrill(storeId: string, value: ActiveDrill | null) {
  try {
    if (value) sessionStorage.setItem(activeKey(storeId), JSON.stringify(value));
    else sessionStorage.removeItem(activeKey(storeId));
  } catch {
    // sin almacenamiento de sesión: el simulacro dura mientras la página siga abierta
  }
}

export async function startDrill(storeId: string, pointId: string | null) {
  const { data, error } = await supabaseBrowser().rpc("erp_drill_start", { p_store: storeId, p_point: pointId || null });
  const r = data as { ok?: boolean; message?: string } | null;
  if (error || !r?.ok) throw new Error(error ? (isNetworkError(error) ? "Necesitas conexión para empezar el simulacro." : error.message) : r?.message ?? "No se pudo empezar.");
}

/** Marca el simulacro como hecho. Si no hay conexión en ese momento, queda guardado y se envía después. */
export async function completeDrill(storeId: string, steps: DrillSteps, seconds: number): Promise<{ ok: boolean; queued?: boolean; message?: string }> {
  const { data, error } = await supabaseBrowser().rpc("erp_drill_complete", { p_store: storeId, p_steps: steps, p_seconds: Math.round(seconds) });
  if (error && isNetworkError(error)) {
    try {
      localStorage.setItem(pendingKey(storeId), JSON.stringify({ steps, seconds: Math.round(seconds) }));
    } catch {
      // nada
    }
    return { ok: true, queued: true };
  }
  const r = data as { ok?: boolean; message?: string } | null;
  return error || !r?.ok ? { ok: false, message: error?.message ?? r?.message } : { ok: true };
}

/** Envía un simulacro que se terminó sin conexión. */
export async function flushPendingDrill(storeId: string) {
  let pending: { steps: DrillSteps; seconds: number } | null = null;
  try {
    const raw = localStorage.getItem(pendingKey(storeId));
    pending = raw ? JSON.parse(raw) : null;
  } catch {
    pending = null;
  }
  if (!pending) return false;
  const r = await completeDrill(storeId, pending.steps, pending.seconds);
  if (r.ok && !r.queued) {
    try {
      localStorage.removeItem(pendingKey(storeId));
    } catch {
      // nada
    }
    return true;
  }
  return false;
}

export const monthName = (period: string) => new Date(`${period}-01T12:00:00`).toLocaleDateString("es-CO", { month: "long" });
export const dayMonth = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
