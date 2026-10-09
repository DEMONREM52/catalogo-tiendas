"use client";

import { useCallback, useEffect, useState } from "react";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import type { AccessScope, FiscalEntity, FiscalEstablishment, OrgSettings, PointReadiness, ProviderAccount, ProviderInfo, RangeInfo } from "@/lib/fiscal/types";

export type FiscalAccess = {
  loading: boolean;
  error: string | null;
  store: DashboardStore | null;
  scope: AccessScope | null;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
};

/** Tienda, alcance (global / tienda madre / puntos) y permisos efectivos del usuario. */
export function useFiscalAccess(): FiscalAccess {
  const [state, setState] = useState<{ loading: boolean; error: string | null; store: DashboardStore | null; scope: AccessScope | null }>({
    loading: true, error: null, store: null, scope: null,
  });
  useEffect(() => {
    void (async () => {
      try {
        const access = await getDashboardStore();
        if (!access.store) throw new Error("No tienes acceso a ninguna tienda.");
        const scope = await fiscalRpc<AccessScope>("erp_my_scope", { p_store: access.store.id });
        setState({ loading: false, error: null, store: access.store, scope });
      } catch (error) {
        setState({ loading: false, error: errorText(error), store: null, scope: null });
      }
    })();
  }, []);
  const can = useCallback((permission: string) => Boolean(state.scope?.permissions?.includes(permission)), [state.scope]);
  const canAny = useCallback((permissions: string[]) => permissions.some((p) => state.scope?.permissions?.includes(p)), [state.scope]);
  return { ...state, can, canAny };
}

export type FiscalOverview = {
  ok: true;
  scope: AccessScope;
  settings: OrgSettings | null;
  points: PointReadiness[];
  month: { by_status: Record<string, number>; accepted_total: number; credit_total: number };
  queue: { pending: number; errors: number; rejected: number; contingency: number };
  entities: FiscalEntity[];
  establishments: FiscalEstablishment[];
  accounts: ProviderAccount[];
  ranges: RangeInfo[];
  providers: ProviderInfo[];
  contingencies: Array<{ id: string; point_id: string | null; kind: string; reason: string; status: "open" | "closed"; started_at: string; started_by_name: string | null; ended_at: string | null; ended_by_name: string | null; end_notes: string | null }>;
  certificates: Array<{ id: string; fiscal_entity_id: string; managed_by: string; subject: string | null; issuer: string | null; serial_number: string | null; valid_from: string | null; valid_until: string; status: string; notes: string | null }>;
  webhooks: { failed: number; dead: number; rejected: number; last: string | null } | null;
  pending_sales: number;
};

/** Datos del centro fiscal (una sola consulta; las pestañas reutilizan esta información). */
export function useFiscalOverview(storeId: string | null) {
  const [data, setData] = useState<FiscalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      setData(await fiscalRpc<FiscalOverview>("fiscal_overview", { p_store: storeId }));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
     
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export const pointName = (points: Array<{ point: { id: string; name: string } }> | undefined, id: string | null | undefined) =>
  points?.find((p) => p.point.id === id)?.point.name ?? (id ? "Punto" : "Toda la tienda");
