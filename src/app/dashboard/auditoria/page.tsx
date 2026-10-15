"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { AuditCenter } from "@/components/audit/AuditCenter";
import type { AuditFilters } from "@/components/audit/audit-labels";

const KEYS = ["from", "to", "module", "category", "severity", "result", "point_id", "user_id", "entity_id", "action", "event_id", "q"] as const;

/** Centro de auditoría de la tienda (los permisos los valida la base de datos). */
export default function AuditoriaPage() {
  const params = useSearchParams();
  const [store, setStore] = useState<{ id: string; points: Array<{ id: string; name: string }> } | null | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      if (!access?.store) return setStore(null);
      const { data } = await supabaseBrowser().from("erp_warehouses").select("id,name").eq("store_id", access.store.id).eq("active", true).order("name");
      setStore({ id: access.store.id, points: (data ?? []) as Array<{ id: string; name: string }> });
    })();
  }, []);
  const initial = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v)) as AuditFilters;
  if (store === undefined) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</main>;
  if (!store) return <main className="p-6 text-sm">No tienes acceso a ninguna tienda.</main>;
  return (
    <main className="mx-auto max-w-5xl px-3 py-4 sm:px-6">
      <AuditCenter key={params.toString()} storeId={store.id} points={store.points} initial={initial} />
    </main>
  );
}
