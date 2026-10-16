"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCan } from "@/lib/permission-runtime";

/** En el POS: muestra si la caja del punto está abierta (y cuánto debe haber) o invita a abrirla. */
export function CashStatusChip({ storeId, pointId }: { storeId?: string; pointId: string }) {
  const canCash = useCan("cash");
  const canManage = useCan("cash_manage");
  const can = canCash || canManage;
  const [state, setState] = useState<{ open: boolean; expected?: number } | null>(null);
  useEffect(() => {
    if (!storeId || !pointId || !can) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_cash_board", { p_store: storeId }).then(({ data, error }) => {
      const b = data as { ok?: boolean; points?: Array<{ point_id: string; open: { breakdown: { expected: number } } | null }> } | null;
      if (!alive) return;
      if (error || !b?.ok) return setState(null);
      const p = b.points?.find((x) => x.point_id === pointId);
      setState(p ? { open: Boolean(p.open), expected: p.open?.breakdown.expected } : null);
    });
    return () => { alive = false; };
  }, [storeId, pointId, can]);
  if (!state) return null;
  return (
    <Link href="/dashboard/caja" className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold"
      style={state.open ? { borderColor: "color-mix(in oklab, #22c55e 45%, transparent)" } : { borderColor: "color-mix(in oklab, #f59e0b 60%, transparent)", color: "#f59e0b" }}>
      {state.open ? `💵 Caja abierta · ${Math.round(state.expected ?? 0).toLocaleString("es-CO")}` : "💵 Caja cerrada · ábrela"}
    </Link>
  );
}
