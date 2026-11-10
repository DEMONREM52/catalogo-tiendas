"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

/** «Estás en la tienda demo» (20261314): cuánto falta para que vuelva sola a como estaba. */
export function DemoBanner({ storeId }: { storeId: string }) {
  const [next, setNext] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void supabaseBrowser().rpc("demo_status", { p_store: storeId }).then(({ data, error }) => {
      const r = data as { demo?: boolean; next_reset_at?: string } | null;
      if (!error && r?.demo && r.next_reset_at) setNext(Date.parse(r.next_reset_at));
    });
  }, [storeId]);
  useEffect(() => {
    if (next === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [next]);
  if (next === null) return null;
  const mins = Math.max(0, Math.round((next - now) / 60000));
  const left = mins >= 120 ? `${Math.round(mins / 60)} h` : mins >= 1 ? `${mins} min` : "un momento";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold" role="status"
      style={{ borderColor: "color-mix(in oklab, #8b5cf6 45%, transparent)", background: "linear-gradient(90deg, color-mix(in oklab, #8b5cf6 14%, transparent), color-mix(in oklab, #ec4899 10%, transparent))" }}>
      <span aria-hidden>🧪</span>
      <span className="min-w-0 flex-1">Estás en la <b>tienda demo</b>: toca todo lo que quieras. Vuelve sola a como estaba en {left}.</span>
      <Link href="/registro" prefetch={false} className="rounded-xl px-3 py-1.5 text-[11px] font-black text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>Crear mi tienda</Link>
    </div>
  );
}
