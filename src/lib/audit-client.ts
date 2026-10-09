"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

/** Registra inicio/cierre de sesión en la auditoría (no bloquea: si falla, el usuario sigue). */
export async function logSessionEvent(action: "auth.login" | "auth.logout", storeId: string | null = null) {
  try {
    await Promise.race([
      supabaseBrowser().rpc("erp_audit_client_event", { p_store: storeId, p_action: action, p_detail: { via: "web" } }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // La auditoría de sesión nunca impide entrar o salir.
  }
}
