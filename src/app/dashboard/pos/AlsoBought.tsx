"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * «Los que llevan esto también llevan…» (20261331): con lo que hay en el carrito, lo que más se ha vendido junto
 * en los últimos 120 días. Solo se muestra lo que se puede vender aquí (activo y con unidades en el punto).
 * Tocarlo lo agrega como cualquier producto (con su precio de siempre). Sin conexión o sin la migración no sale nada.
 */
type Hit = { product_id: string; name: string; times: number };

export function AlsoBought<P extends { id: string; name: string }>({ storeId, cartIds, sellable, onAdd }: {
  storeId: string;
  cartIds: string[];
  /** Productos que se pueden vender en este punto ahora. */
  sellable: Map<string, P>;
  onAdd: (product: P) => void;
}) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [orders, setOrders] = useState(0);
  const [hidden, setHidden] = useState(false);
  const key = [...new Set(cartIds)].sort().join(",");

  useEffect(() => {
    if (!key) { const t = window.setTimeout(() => { setHits([]); setHidden(false); }, 0); return () => window.clearTimeout(t); }
    let alive = true;
    // Espera un momento: mientras se escanean varios seguidos no se consulta por cada uno.
    const t = window.setTimeout(() => {
      void supabaseBrowser().rpc("erp_pos_also_bought", { p_store: storeId, p_products: key.split(","), p_limit: 8 }).then(({ data, error }) => {
        if (!alive) return;
        const d = data as { ok?: boolean; orders?: number; items?: Hit[] } | null;
        if (error || !d?.ok) { setHits([]); return; }
        setOrders(Number(d.orders ?? 0));
        setHits(d.items ?? []);
      }, () => { if (alive) setHits([]); });
    }, 700);
    return () => { alive = false; window.clearTimeout(t); };
  }, [key, storeId]);

  const shown = hits.filter((h) => sellable.has(h.product_id) && !cartIds.includes(h.product_id)).slice(0, 4);
  if (hidden || !shown.length) return null;
  return (
    <div className="mt-2 rounded-2xl border p-2.5" style={{ borderColor: "color-mix(in oklab, #8b5cf6 35%, var(--t-card-border))", background: "color-mix(in oklab, #8b5cf6 6%, transparent)" }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-black">💡 Los que llevan esto también llevan…</p>
        <button type="button" onClick={() => setHidden(true)} className="text-[11px] underline" style={{ color: "var(--t-muted)" }}>Ocultar</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((h) => {
          const p = sellable.get(h.product_id)!;
          const share = orders ? Math.max(1, Math.round((h.times / orders) * 10)) : 0;
          return (
            <button key={h.product_id} type="button" onClick={() => onAdd(p)}
              className="rounded-full border px-2.5 py-1 text-left text-xs font-bold transition hover:-translate-y-0.5"
              style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}
              title={`Se vendió junto ${h.times} veces en los últimos 120 días`}>
              ＋ {p.name}{share ? <span className="ml-1 font-normal" style={{ color: "var(--t-muted)" }}>· {share} de cada 10</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
