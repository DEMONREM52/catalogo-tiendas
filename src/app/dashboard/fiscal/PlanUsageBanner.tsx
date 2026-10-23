"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Paquete de facturación electrónica de la tienda (20261241): documentos usados del mes y aviso si falta o se pasa. */
type State = { active: boolean; expired: boolean; addon: { name: string } | null; used: number; included: number; extra: number; unit_price: number; extra_cost: number; open_overages: number; enforce: boolean };

const cop = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;

export function PlanUsageBanner({ storeId }: { storeId: string | null }) {
  const [st, setSt] = useState<State | null>(null);
  useEffect(() => {
    if (!storeId) return;
    void supabaseBrowser().rpc("saas_my_fiscal", { p_store: storeId }).then(({ data, error }) => {
      const r = data as { ok: boolean; state?: State } | null;
      if (!error && r?.ok && r.state) setSt(r.state);
    });
  }, [storeId]);
  if (!st) return null;
  const pct = st.included ? Math.min(100, Math.round((st.used / st.included) * 100)) : 0;
  const tone = !st.active ? (st.enforce || st.expired ? "#ef4444" : "#f59e0b") : st.extra ? "#f59e0b" : pct >= 80 ? "#f59e0b" : "#10b981";
  return (
    <div className="relative mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: `color-mix(in oklab, ${tone} 45%, var(--t-card-border))`, background: `color-mix(in oklab, ${tone} 8%, transparent)` }}>
      <span className="text-lg">🧾</span>
      <span className="min-w-0 flex-1">
        {st.active ? (
          <>
            <b>{st.addon?.name}</b> · {st.used.toLocaleString("es-CO")} de {st.included.toLocaleString("es-CO")} documentos este mes
            {st.extra ? <span style={{ color: "#f59e0b" }}> · {st.extra} extra ({cop(st.extra_cost)})</span> : null}
            {st.included ? <span className="mt-1 block h-1.5 max-w-md overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone }} /></span> : null}
          </>
        ) : st.expired ? (
          <><b>Tu paquete de facturación electrónica venció.</b> Renuévalo para seguir emitiendo ante la DIAN.</>
        ) : (
          <><b>Aún no tienes el adicional de facturación electrónica.</b> {st.enforce ? "Sin él no se puede emitir en producción." : "Actívalo para emitir ante la DIAN con tu propio paquete de documentos."}</>
        )}
        {st.open_overages ? <span className="block text-xs" style={{ color: "#f59e0b" }}>Tienes {cop(st.open_overages)} de documentos extra por pagar.</span> : null}
      </span>
      <Link href="/dashboard/plan" className="shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>{st.active && !st.open_overages ? "Ver mi paquete" : "Ir a Mi plan"}</Link>
    </div>
  );
}
