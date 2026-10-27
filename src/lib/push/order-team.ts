// Quién atiende los pedidos de una tienda (dueño, administradores y permiso «Pedidos») y aviso a sus celulares.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendToUsers, type PushPayload } from "@/lib/push/server";

export async function orderTeam(admin: SupabaseClient, storeId: string): Promise<Set<string>> {
  const [{ data: store }, { data: members }] = await Promise.all([
    admin.from("stores").select("owner_id").eq("id", storeId).maybeSingle(),
    admin.from("store_users").select("user_id,role,permissions,active").eq("store_id", storeId),
  ]);
  const users = new Set<string>();
  const owner = (store as { owner_id?: string } | null)?.owner_id;
  if (owner) users.add(owner);
  for (const m of (members ?? []) as Array<{ user_id: string; role: string | null; permissions: string[] | null; active: boolean | null }>) {
    if (m.active !== false && (m.role === "store_admin" || m.permissions?.includes("orders"))) users.add(m.user_id);
  }
  return users;
}

export async function notifyOrderTeam(admin: SupabaseClient, storeId: string, payload: PushPayload) {
  const users = await orderTeam(admin, storeId);
  if (users.size) await sendToUsers(admin, storeId, new Map([...users].map((u) => [u, payload])));
}
