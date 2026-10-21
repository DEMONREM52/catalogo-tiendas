"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Clientes frecuentes (20261223): quién compra más, cada cuánto vuelve y a quién conviene escribirle.
 * «Para recuperar» = no ha vuelto en el doble de lo que suele tardar (o más de 45 días).
 */

type Customer = {
  name: string; customer_id: string | null; phone: string | null; orders: number; total: number; avg: number;
  last_at: string; first_at: string; days_since: number; every_days: number | null; top: string[];
};

const money = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO");
const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const lost = (c: Customer) => c.orders >= 2 && c.days_since > Math.max(45, 2 * (c.every_days ?? 0));
const title = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

function waNumber(phone: string | null) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) return `57${d}`;
  return d.length >= 11 ? d : null;
}

export function FrequentCustomers({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState(365);
  const [view, setView] = useState<"top" | "lost" | "new">("top");
  const [q, setQ] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_customer_insights", { p_store: storeId, p_days: days }).then(({ data, error: e }) => {
      if (!alive) return;
      const r = data as { ok: boolean; error?: string; customers?: Customer[] } | null;
      if (e || !r?.ok) {
        setError(e && /erp_customer_insights|Could not find/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261223_clientes_frecuentes.sql." : r?.error ?? e?.message ?? "No se pudo cargar.");
        setRows([]);
      } else { setError(""); setRows(r.customers ?? []); }
    });
    return () => { alive = false; };
  }, [storeId, days]);

  const shown = useMemo(() => {
    let list = rows ?? [];
    if (view === "lost") list = list.filter(lost).sort((a, b) => b.total - a.total);
    if (view === "new") list = list.filter((c) => (now - new Date(c.first_at).getTime()) / 86400000 <= 30).sort((a, b) => new Date(b.first_at).getTime() - new Date(a.first_at).getTime());
    const w = fold(q.trim());
    return w ? list.filter((c) => fold(`${c.name} ${c.phone ?? ""} ${c.top.join(" ")}`).includes(w)) : list;
  }, [rows, view, q, now]);

  const message = (c: Customer) => {
    const name = title(c.name.split(" ")[0] ?? "");
    const fav = c.top[0] ? title(c.top[0]) : null;
    return lost(c)
      ? `Hola ${name}! 👋 Te extrañamos en ${storeName}. ${fav ? `Tenemos disponible ${fav} y novedades que te pueden gustar.` : "Tenemos novedades que te pueden gustar."} ¿Te mando el catálogo?`
      : `Hola ${name}! 👋 Gracias por comprar en ${storeName}. ${fav ? `Si necesitas más ${fav}, te lo separamos.` : "Cualquier cosa que necesites, aquí estamos."}`;
  };

  const box = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" };
  const lostCount = (rows ?? []).filter(lost).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([["top", "⭐ Los que más compran"], ["lost", `💤 Para recuperar${lostCount ? ` (${lostCount})` : ""}`], ["new", "🆕 Nuevos (30 días)"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className="rounded-full border px-4 py-2 text-sm font-semibold transition"
            style={view === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : box}>{label}</button>
        ))}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-full border px-3 py-2 text-sm" style={{ ...box, color: "var(--t-text)" }} aria-label="Periodo">
          <option value={90}>Últimos 3 meses</option><option value={180}>Últimos 6 meses</option><option value={365}>Último año</option><option value={730}>Últimos 2 años</option>
        </select>
        <div className="relative min-w-52 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input className="w-full rounded-full border py-2 pr-4 text-sm outline-none" style={{ ...box, paddingLeft: "2.3rem", color: "var(--t-text)" }}
            placeholder="Buscar cliente, celular o producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, transparent)" }}>⚠️ {error}</p> : null}
      {rows === null ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando clientes…</p> : null}
      {rows && !shown.length && !error ? (
        <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...box, color: "var(--t-muted)" }}>
          {view === "lost" ? "🎉 Nadie se ha perdido: todos tus clientes frecuentes han vuelto a tiempo." : "Aún no hay ventas con nombre de cliente en este periodo. Escribe el nombre del cliente al vender para verlo aquí."}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.slice(0, 120).map((c, i) => {
          const wa = waNumber(c.phone);
          return (
            <div key={c.name} className="flex flex-col rounded-2xl border p-4" style={box}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold" title={c.name}>{view === "top" ? `${i + 1}. ` : ""}{title(c.name)}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{c.phone ?? "Sin celular"}{c.every_days ? ` · vuelve cada ~${c.every_days} días` : ""}</p>
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                  style={lost(c) ? { background: "color-mix(in oklab, #f59e0b 18%, transparent)", color: "#d97706" } : { background: "color-mix(in oklab, #10b981 14%, transparent)", color: "#059669" }}>
                  {c.days_since === 0 ? "Compró hoy" : `Hace ${c.days_since} d`}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl px-1 py-2" style={{ background: "var(--t-card-bg-soft)" }}><b className="block text-sm tabular-nums">{money(c.total)}</b><span className="text-[10px]" style={{ color: "var(--t-muted)" }}>Total</span></div>
                <div className="rounded-xl px-1 py-2" style={{ background: "var(--t-card-bg-soft)" }}><b className="block text-sm tabular-nums">{c.orders}</b><span className="text-[10px]" style={{ color: "var(--t-muted)" }}>Compras</span></div>
                <div className="rounded-xl px-1 py-2" style={{ background: "var(--t-card-bg-soft)" }}><b className="block text-sm tabular-nums">{money(c.avg)}</b><span className="text-[10px]" style={{ color: "var(--t-muted)" }}>Promedio</span></div>
              </div>
              {c.top.length ? <p className="mt-2 line-clamp-2 text-xs" style={{ color: "var(--t-muted)" }}>Compra: {c.top.map(title).join(" · ")}</p> : null}
              <div className="mt-auto pt-3">
                {wa ? (
                  <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message(c))}`} target="_blank" rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white" style={{ background: "#16a34a" }}>
                    <MessageCircle size={16} /> {lost(c) ? "Escribirle para que vuelva" : "Escribir por WhatsApp"}
                  </a>
                ) : <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Agrega su celular en Terceros para escribirle.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
