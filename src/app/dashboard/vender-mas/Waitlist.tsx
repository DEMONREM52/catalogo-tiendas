"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { fillMessage, waLink } from "@/lib/features";
import { toast } from "@/app/dashboard/inventario/shared";
import { Stat } from "./CartLeads";

type Row = {
  id: string; product_id: string; product: string; image_url: string | null; name: string | null; phone: string;
  status: "waiting" | "notified" | "dismissed"; created_at: string; notified_at: string | null; notified_by_name: string | null;
  catalog: string | null; catalog_slug: string | null; stock: number; ready: boolean;
};
const dmy = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

/** «Avísame cuando llegue» (20261312): quién espera cada producto agotado y a quién ya se puede avisar. */
export function Waitlist({ storeId, storeSlug, storeName, onSettings }: { storeId: string; storeSlug: string; storeName: string; onSettings?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"ready" | "waiting" | "done">("ready");

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("stock_waitlist_list", { p_store: storeId });
    const r = data as { ok: boolean; message?: string; items?: Row[] } | null;
    if (e || !r?.ok) return setError(e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setRows(r.items ?? []);
    setMessage(r.message ?? "");
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const waiting = useMemo(() => (rows ?? []).filter((r) => r.status === "waiting"), [rows]);
  const ready = waiting.filter((r) => r.ready);
  const shown = view === "ready" ? ready : view === "waiting" ? waiting.filter((r) => !r.ready) : (rows ?? []).filter((r) => r.status !== "waiting");
  // Los más pedidos: cuántas personas esperan cada producto.
  const top = useMemo(() => {
    const m = new Map<string, { name: string; n: number; image: string | null }>();
    for (const r of waiting) m.set(r.product_id, { name: r.product, image: r.image_url, n: (m.get(r.product_id)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [waiting]);

  async function mark(ids: string[], status: Row["status"]) {
    const { data, error: e } = await supabaseBrowser().rpc("stock_waitlist_mark", { p_store: storeId, p_ids: ids, p_status: status });
    if (e || !(data as { ok?: boolean } | null)?.ok) return void toast("No se pudo", "error", e?.message);
    setRows((p) => (p ?? []).map((r) => (ids.includes(r.id) ? { ...r, status } : r)));
  }

  function notify(r: Row) {
    const link = `${PRODUCTION_ORIGIN}/${storeSlug}/producto/${r.product_id}${r.catalog_slug ? `?catalogo=${encodeURIComponent(r.catalog_slug)}` : ""}`;
    const text = fillMessage(message, { cliente: (r.name ?? "").split(" ")[0] || "", producto: r.product, tienda: storeName, enlace: link });
    window.open(waLink(r.phone, text), "_blank", "noopener");
    void mark([r.id], "notified");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">🔔 Avísame cuando llegue</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Clientes que esperan un producto agotado. Cuando entra mercancía al catálogo, pasan a «Ya llegó».</p>
        </div>
        {onSettings ? <button type="button" onClick={onSettings} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>⚙️ Botón y mensaje</button> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Ya llegó" value={String(ready.length)} hint="para avisar hoy" color="#10b981" />
        <Stat label="Esperando" value={String(waiting.length - ready.length)} hint="aún agotado" color="#8b5cf6" />
        <Stat label="Avisados" value={String((rows ?? []).filter((r) => r.status === "notified").length)} hint="últimos 30 días" color="#0ea5e9" />
      </div>

      {top.length ? (
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "#8b5cf6" }}>🔥 Lo que más están esperando (vale la pena volver a pedir)</p>
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {top.map((t) => (
              <div key={t.name} className="flex shrink-0 items-center gap-2 rounded-xl border py-1 pl-1 pr-3 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
                {t.image ? <img src={t.image} alt="" loading="lazy" className="h-8 w-8 rounded-lg object-cover" /> : <span className="grid h-8 w-8 place-items-center">🛍️</span>}
                <span className="max-w-[160px] truncate font-bold">{t.name}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: "#8b5cf6" }}>{t.n}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {([["ready", `✅ Ya llegó ${ready.length}`], ["waiting", `⏳ Esperando ${waiting.length - ready.length}`], ["done", "📁 Avisados y descartados"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold"
            style={view === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
        ))}
        {view === "ready" && ready.length > 1 ? (
          <button type="button" onClick={() => void mark(ready.map((r) => r.id), "notified")} className="ml-auto shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            Marcar todos como avisados
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm" style={{ color: "#ef4444" }}>⚠️ {error}</p> : null}
      {rows && !shown.length ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          {view === "ready" ? "Nadie por avisar ahora. Cuando entre mercancía de algo que esperan, aparece aquí." : "Nada por aquí."}
        </div>
      ) : null}

      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((r) => (
          <li key={r.id} className="vm-row flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: r.ready && r.status === "waiting" ? "color-mix(in oklab, #10b981 50%, var(--t-card-border))" : "var(--t-card-border)" }}>
            {r.image_url ? <img src={r.image_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>🛍️</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold">{r.product}</p>
              <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>{r.name || "Cliente"} · 📱 {r.phone} · desde {dmy(r.created_at)}</p>
              <p className="text-[11px] font-bold" style={{ color: r.ready ? "#10b981" : "#8b5cf6" }}>
                {r.status === "notified" ? `💬 Avisado por ${r.notified_by_name ?? "alguien"}` : r.status === "dismissed" ? "Descartado" : r.ready ? `✅ Hay ${r.stock} en ${r.catalog ?? "el catálogo"}` : "⏳ Aún agotado"}
              </p>
            </div>
            {r.status === "waiting" ? (
              <div className="flex shrink-0 flex-col gap-1">
                <button type="button" onClick={() => notify(r)} disabled={!r.ready} className="rounded-xl px-3 py-1.5 text-xs font-black text-white disabled:opacity-40" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }} title={r.ready ? "Avisar por WhatsApp" : "Aún no hay existencias"}>💬 Avisar</button>
                <button type="button" onClick={() => void mark([r.id], "dismissed")} className="rounded-xl border px-3 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar</button>
              </div>
            ) : (
              <button type="button" onClick={() => void mark([r.id], "waiting")} className="shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>↩️</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
