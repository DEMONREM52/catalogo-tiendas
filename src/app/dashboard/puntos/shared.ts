"use client";

import { fiscalApi } from "@/lib/fiscal/client";
import type { PointStatus } from "@/lib/fiscal/types";

export type TeamMember = {
  user_id: string; username: string | null; display_name: string | null; role: string; permissions: string[];
  point_id: string | null; point_ids?: string[] | null; active: boolean;
};

export type PointRow = {
  id: string; code: string; name: string; kind: "point" | "warehouse"; status: PointStatus; is_default: boolean; address: string | null; phone: string | null;
  city: string | null; email: string | null; description: string | null; responsible_name: string | null; responsible_user_id: string | null;
  status_reason: string | null; status_changed_at: string | null; users: number; units: number; skus: number; sales_today: number; sales_month: number;
  fiscal: { ready: boolean; missing: number; enabled: boolean; environment: string; configured: boolean; entity: string | null; warnings: string[] } | null;
};

/** Usuarios de la tienda (requiere permiso de Usuarios; si no, devuelve lista vacía). */
export async function loadTeam(storeId: string): Promise<TeamMember[]> {
  try {
    const res = await fiscalApi<{ users: TeamMember[] }>(`/api/store-team/users?store_id=${encodeURIComponent(storeId)}`, undefined, "GET");
    return (res.users ?? []).filter((u) => u.active);
  } catch {
    return [];
  }
}

export const memberName = (m: TeamMember) => m.display_name?.trim() || m.username || "Usuario";
