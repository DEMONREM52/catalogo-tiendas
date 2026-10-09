"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";

/**
 * Si ya hay una sesión guardada en este equipo (o en la app instalada), la retoma sin pedir la contraseña:
 * renueva la cookie del panel y devuelve true para entrar directo a /dashboard.
 *   expectStoreId: en el enlace de acceso de un punto, la sesión debe ser de un usuario de ESA tienda.
 * Las reglas de acceso no cambian: la base de datos sigue validando cada permiso.
 */
export async function resumeExistingSession(expectStoreId?: string): Promise<boolean> {
  try {
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) return false;
    const access = await getDashboardStore();
    const isAdmin = access.profileRole === "admin";
    if (!access.store && !isAdmin) return false;
    if (expectStoreId && access.store?.id !== expectStoreId) return false;
    if (access.membership && !access.membership.active) return false;
    document.cookie = `app_session=${session.access_token}; path=/; max-age=604800`;
    return true;
  } catch {
    return false;
  }
}

const STAFF_COOKIE = "remhub_staff_access";

/**
 * Recuerda en este navegador el enlace de acceso del trabajador (solo tienda y usuario; nunca la contraseña),
 * para que «Agregar a pantalla de inicio» desde el panel instale la app con su enlace.
 */
export function rememberStaffAccess(path: string) {
  if (!/^\/acceso\/[^/?#]+\?/.test(path)) return;
  document.cookie = `${STAFF_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=31536000; samesite=lax`;
}

export function forgetStaffAccess() {
  document.cookie = `${STAFF_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
