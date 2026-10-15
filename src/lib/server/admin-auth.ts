import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class AdminAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Solo el administrador global de RemHub. Valida la sesión (Authorization: Bearer) en el servidor
 * y el rol en la base; nunca confía en datos del navegador. Devuelve el cliente de servicio.
 */
export async function authorizePlatformAdmin(request: Request): Promise<{ admin: SupabaseClient; userId: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) throw new AdminAuthError("Falta configurar Supabase en el servidor.", 500);

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) throw new AdminAuthError("Inicia sesión para continuar.", 401);
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) throw new AdminAuthError("La sesión no es válida. Inicia sesión de nuevo.", 401);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles").select("role").eq("user_id", data.user.id).maybeSingle();
  if (profileError) throw new AdminAuthError("No se pudo validar el permiso.", 500);
  if (profile?.role !== "admin") throw new AdminAuthError("No tienes permisos de administrador.", 403);
  return { admin, userId: data.user.id };
}

export function adminErrorResponse(error: unknown) {
  const status = error instanceof AdminAuthError ? error.status : 500;
  const message = error instanceof AdminAuthError ? error.message : "Error inesperado.";
  if (status >= 500) console.error("Error en ruta de administración:", error instanceof Error ? error.message : error);
  return Response.json({ ok: false, error: message }, { status });
}
