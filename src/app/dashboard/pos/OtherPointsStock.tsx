"use client";

import { useState } from "react";
import Link from "next/link";
import { PackagePlus, Warehouse } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newRequestUrl } from "@/components/chat/chat-api";

type Level = { id: string; name: string; qty: number };

/**
 * POS: cuánto hay de este producto en los otros puntos y bodegas, y «Pedir» con un toque
 * (abre el pedido interno con el producto ya puesto). Se consulta solo cuando se toca.
 */
export function OtherPointsStock({ storeId, productId, name, compact }: { storeId: string; productId: string; name: string; compact?: boolean }) {
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("erp_chat_products", { p_store: storeId, p_ids: [productId] });
    setBusy(false);
    if (e) return setError("No se pudo consultar ahora.");
    const card = Array.isArray(data) ? (data[0] as { stock?: Level[] } | undefined) : undefined;
    setLevels((card?.stock ?? []).slice().sort((a, b) => b.qty - a.qty));
  }

  if (!levels) {
    return (
      <button type="button" onClick={() => void load()} disabled={busy}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold transition disabled:opacity-60 ${compact ? "" : "mt-1"}`}
        style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>
        <Warehouse size={12} /> {busy ? "Consultando…" : "¿Hay en otros puntos?"}
      </button>
    );
  }
  const withStock = levels.filter((l) => l.qty > 0);
  return (
    <div className="mt-1.5 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      <div className="flex flex-wrap gap-1">
        {levels.length ? levels.map((l) => (
          <span key={l.id} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: l.qty > 0 ? "rgba(22,163,74,.16)" : "rgba(127,127,127,.14)", opacity: l.qty > 0 ? 1 : 0.7 }}>
            {l.name}: <b>{l.qty}</b>
          </span>
        )) : <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>No hay existencias registradas.</span>}
      </div>
      {withStock.length ? (
        <Link href={newRequestUrl(`Pedido desde el POS: ${name}`, productId)} className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "var(--t-accent)" }}>
          <PackagePlus size={12} /> Pedir a otro punto
        </Link>
      ) : null}
    </div>
  );
}
