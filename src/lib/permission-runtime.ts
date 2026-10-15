"use client";

import { useSyncExternalStore } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Permisos del usuario en la tienda abierta, para cualquier pantalla del panel (lo carga DashboardShell).
 * Sirve para mostrar u ocultar botones; la seguridad real la valida siempre la base de datos.
 */
type Snapshot = { storeId: string | null; can: (permission: string) => boolean };
let snapshot: Snapshot = { storeId: null, can: () => false };
const listeners = new Set<() => void>();

export function setPermissionRuntime(storeId: string | null, can: (permission: string) => boolean) {
  snapshot = { storeId, can };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

/** ¿El usuario tiene este permiso en la tienda abierta? (false mientras carga). */
export function useCan(permission: string) {
  return useSyncExternalStore(subscribe, () => snapshot.can(permission), () => false);
}

/** Deja en la auditoría quién exportó qué y cuántas filas (no bloquea la descarga si falla). */
export function logExport(what: string, rows: number, detail: Record<string, unknown> = {}) {
  if (!snapshot.storeId) return;
  void Promise.resolve(supabaseBrowser().rpc("erp_audit_client_event", {
    p_store: snapshot.storeId,
    p_action: `export.${what}`,
    p_detail: { rows, ...detail },
  })).catch(() => null);
}
