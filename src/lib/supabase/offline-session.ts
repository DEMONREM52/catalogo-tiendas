"use client";

import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "./client";
import { isNetworkError } from "@/lib/net/status";
import { withTimeout } from "@/lib/offline/cache";

/**
 * Usuario de la sesión guardada en el equipo, leída directo del almacenamiento de Supabase.
 * Sin internet, cuando el token de una hora vence, Supabase conserva la sesión pero ya no la entrega
 * (no puede renovarla): con esto se sigue trabajando y se renueva sola al volver la conexión.
 */
export function storedSessionUser(): User | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    const ref = new URL(url).hostname.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User; refresh_token?: string; currentSession?: { user?: User; refresh_token?: string } };
    const session = parsed.currentSession ?? parsed;
    // Sin token de renovación la sesión ya no sirve aunque quede el usuario.
    return session.refresh_token && session.user?.id ? session.user : null;
  } catch {
    return null;
  }
}

/**
 * Cierra la sesión también sin conexión. Supabase, sin internet, no borra la sesión guardada
 * (no logra avisarle al servidor) y el siguiente que use el equipo quedaría con ella: aquí se borra igual.
 */
export async function signOutEverywhere() {
  const sb = supabaseBrowser();
  let removed = false;
  try {
    const { error } = await withTimeout(sb.auth.signOut(), 6_000, "salida");
    removed = !error;
  } catch {
    removed = false;
  }
  if (removed) return;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const ref = url ? new URL(url).hostname.split(".")[0] : "";
    for (const k of [`sb-${ref}-auth-token`, `sb-${ref}-auth-token-code-verifier`]) localStorage.removeItem(k);
  } catch {
    // sin almacenamiento: no hay nada guardado
  }
  await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
}

/**
 * ¿Quién está usando el panel? Pregunta al servidor; si no hay conexión (o no contesta) usa la sesión
 * guardada en el equipo. `offline: true` = se está trabajando con la sesión guardada.
 * Solo devuelve null cuando de verdad no hay sesión (o el servidor la rechazó).
 */
export async function resilientUser(): Promise<{ user: User | null; offline: boolean }> {
  const sb = supabaseBrowser();
  try {
    const { data, error } = await withTimeout(sb.auth.getUser(), 10_000, "validación de sesión");
    if (data?.user) return { user: data.user, offline: false };
    if (error && !isNetworkError(error)) return { user: null, offline: false };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
  }
  try {
    const { data } = await withTimeout(sb.auth.getSession(), 5_000, "sesión guardada");
    if (data.session?.user) return { user: data.session.user, offline: true };
  } catch {
    // sigue con la copia del equipo
  }
  const stored = storedSessionUser();
  return { user: stored, offline: Boolean(stored) };
}
