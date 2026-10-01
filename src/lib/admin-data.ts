import { supabaseBrowser } from "@/lib/supabase/client";

export async function requestAdmin<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");

  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const result = (await response.json()) as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud administrativa.");
  return (result.data ?? result) as T;
}

export async function fetchAdminData<T>(searchParams: URLSearchParams): Promise<T> {
  return requestAdmin<T>(`/api/admin/catalog?${searchParams.toString()}`);
}
