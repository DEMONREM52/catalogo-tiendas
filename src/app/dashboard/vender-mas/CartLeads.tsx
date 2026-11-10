"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fillMessage, waLink } from "@/lib/features";
import { toast } from "@/app/dashboard/inventario/shared";

type LeadItem = { product_id: string; name: string; qty: number; price: number; image_url: string | null };
type Lead = {
  id: string; name: string | null; phone: string; items: LeadItem[]; units: number; total: number;
  status: "open" | "contacted" | "converted" | "dismissed"; catalog: string | null; catalog_slug: string | null;
  updated_at: string; contacted_at: string | null; contacted_by_name: string | null;
};

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};
const FILTERS = [
  { key: "open", label: "🛒 Por escribir" },
  { key: "contacted", label: "💬 Ya les escribí" },
  { key: "converted", label: "✅ Compraron" },
  { key: "dismissed", label: "🙈 Descartados" },
] as const;

/** Carritos abandonados (20261312): quién dejó productos sin enviar el pedido, con su WhatsApp. */
export function CartLeads({ storeId, storeName, canEdit, onSettings }: { storeId: string; storeName: string; canEdit: boolean; onSettings?: () => void }) {
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(14);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("cart_leads_list", { p_store: storeId, p_days: days });
    const r = data as { ok: boolean; message?: string; items?: Lead[] } | null;
    if (e || !r?.ok) return setError(e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setRows(r.items ?? []);
    setMessage(r.message ?? "");
  }, [storeId, days]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (rows ?? []).filter((r) => r.status === f.key).length])), [rows]);
  const shown = (rows ?? []).filter((r) => r.status === filter);
  const recovered = (rows ?? []).filter((r) => r.status === "converted").reduce((a, r) => a + Number(r.total), 0);
  const pending = (rows ?? []).filter((r) => r.status === "open").reduce((a, r) => a + Number(r.total), 0);

  async function mark(l: Lead, status: Lead["status"]) {
    const { data, error: e } = await supabaseBrowser().rpc("cart_lead_mark", { p_store: storeId, p_id: l.id, p_status: status });
    if (e || !(data as { ok?: boolean } | null)?.ok) return void toast("No se pudo", "error", e?.message);
    setRows((p) => (p ?? []).map((r) => (r.id === l.id ? { ...r, status } : r)));
  }

  function write(l: Lead) {
    const names = l.items.map((i) => i.name);
    const text = fillMessage(message, {
      cliente: (l.name ?? "").split(" ")[0] || "", productos: names.length > 2 ? `${names.slice(0, 2).join(", ")} y ${names.length - 2} más` : names.join(" y "),
      total: money(l.total), tienda: storeName, enlace: "",
    });
    window.open(waLink(l.phone, text), "_blank", "noopener");
    if (l.status === "open" && canEdit) void mark(l, "contacted");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">🛒 Carritos abandonados</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>Clientes que dejaron su WhatsApp en el carrito y no enviaron el pedido (salen 30 minutos después).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
            {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
          {onSettings ? <button type="button" onClick={onSettings} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>⚙️ Mensaje</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Por recuperar" value={money(pending)} hint={`${counts.open ?? 0} carrito(s)`} color="#f97316" />
        <Stat label="Recuperado" value={money(recovered)} hint={`${counts.converted ?? 0} compraron`} color="#10b981" />
        <Stat label="Les escribiste" value={String(counts.contacted ?? 0)} hint="esperando respuesta" color="#0ea5e9" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold"
            style={filter === f.key ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
            {f.label} <span className="opacity-70">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error ? <p className="text-sm" style={{ color: "#ef4444" }}>⚠️ {error}</p> : null}
      {rows === null && !error ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
      {rows && !shown.length ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          {filter === "open" ? "🎉 Nadie se fue sin comprar. Cuando alguien deje su WhatsApp y no envíe el pedido, aparece aquí." : "Nada por aquí."}
        </div>
      ) : null}

      <ul className="grid gap-3 lg:grid-cols-2">
        {shown.map((l) => (
          <li key={l.id} className="vm-row rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)" }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-extrabold">{l.name || "Cliente sin nombre"}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>📱 {l.phone} · {l.catalog ?? "Catálogo"} · {ago(l.updated_at)}</p>
                {l.contacted_at ? <p className="text-[11px]" style={{ color: "#0ea5e9" }}>💬 {l.contacted_by_name ?? "Alguien"} le escribió {ago(l.contacted_at)}</p> : null}
              </div>
              <p className="shrink-0 text-right text-base font-black">{money(l.total)}<span className="block text-[10px] font-bold opacity-60">{l.units} und.</span></p>
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto">
              {l.items.slice(0, 6).map((i) => (
                <div key={i.product_id} className="flex shrink-0 items-center gap-1.5 rounded-xl border py-1 pl-1 pr-2 text-[11px]" style={{ borderColor: "var(--t-card-border)" }} title={i.name}>
                  {i.image_url ? <img src={i.image_url} alt="" loading="lazy" className="h-7 w-7 rounded-lg object-cover" /> : <span className="grid h-7 w-7 place-items-center">🛍️</span>}
                  <span className="max-w-[120px] truncate font-semibold">{i.qty}× {i.name}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {l.status !== "converted" ? (
                <button type="button" onClick={() => write(l)} className="rounded-xl px-3 py-2 text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
                  💬 Escribirle por WhatsApp
                </button>
              ) : <span className="rounded-xl px-3 py-2 text-xs font-black" style={{ background: "color-mix(in oklab, #10b981 18%, transparent)", color: "#10b981" }}>✅ Compró</span>}
              {canEdit && l.status === "open" ? <button type="button" onClick={() => void mark(l, "dismissed")} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Descartar</button> : null}
              {canEdit && (l.status === "dismissed" || l.status === "contacted") ? <button type="button" onClick={() => void mark(l, "open")} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>↩️ Volver a «por escribir»</button> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color: string }) {
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: `color-mix(in oklab, ${color} 35%, var(--t-card-border))`, background: `color-mix(in oklab, ${color} 7%, transparent)` }}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</p>
      <p className="mt-0.5 text-xl font-black">{value}</p>
      {hint ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
    </div>
  );
}
