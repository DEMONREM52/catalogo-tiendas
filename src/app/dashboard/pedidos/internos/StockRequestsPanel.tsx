"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Inbox, MessageCircle, Plus, RefreshCw, Search, Send, Truck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { useRunOnChange } from "../../inventario/shared";
import { NewStockRequest, type PointOption } from "./NewStockRequest";
import { RequestRoom } from "./RequestRoom";
import { OPEN_REQUEST_EVENT, SR_STATUS, isOpen, srError, timeAgo, type SrListItem } from "./types";

type Scope = "attend" | "mine" | "active" | "closed";

/** Pedidos internos entre puntos y bodegas: bandeja, filtros, nuevo pedido y sala con chat. */
export function StockRequestsPanel({ storeId, canRequest }: { storeId: string; canRequest: boolean }) {
  const [rows, setRows] = useState<SrListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<PointOption[]>([]);
  const [myPoint, setMyPoint] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabaseBrowser().rpc("erp_stock_requests_list", { p_store: storeId });
    setLoading(false);
    if (err) return setError(srError(err));
    setError(null);
    setRows((data ?? []) as SrListItem[]);
  }, [storeId]);
  useRunOnChange(load);

  useEffect(() => {
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("erp_warehouses").select("id,name,kind,is_default").eq("store_id", storeId).eq("active", true).order("name"),
      sb.rpc("erp_my_point", { p_store: storeId }),
    ]).then(([wh, pt]) => {
      setPoints((wh.data ?? []) as PointOption[]);
      setMyPoint((pt.data as string | null) ?? null);
    });
    // Abrir un pedido desde el enlace (?pedido=…) o desde un aviso.
    const fromUrl = new URLSearchParams(window.location.search).get("pedido");
    if (fromUrl) window.setTimeout(() => setOpenId(fromUrl), 0);
    const onOpen = (e: Event) => setOpenId(String((e as CustomEvent<string>).detail));
    window.addEventListener(OPEN_REQUEST_EVENT, onOpen);
    // Cambios en vivo (si Realtime está activo) + respaldo cada 30 s.
    const channel = sb
      .channel(`sr-list-${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_stock_requests", filter: `store_id=eq.${storeId}` }, () => void load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_stock_request_messages", filter: `store_id=eq.${storeId}` }, () => void load())
      .subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    return () => {
      window.removeEventListener(OPEN_REQUEST_EVENT, onOpen);
      void sb.removeChannel(channel);
      window.clearInterval(timer);
    };
  }, [storeId, load]);

  const counts = useMemo(() => ({
    attend: rows.filter((r) => r.access.attend && (r.status === "pending" || r.status === "preparing")).length,
    attendNew: rows.filter((r) => r.access.attend && r.status === "pending").length,
    mine: rows.filter((r) => r.access.request && isOpen(r.status)).length,
    arriving: rows.filter((r) => r.access.request && r.status === "dispatched").length,
    active: rows.filter((r) => isOpen(r.status)).length,
    closed: rows.filter((r) => !isOpen(r.status)).length,
    unread: rows.reduce((s, r) => s + (isOpen(r.status) ? r.unread : 0), 0),
  }), [rows]);

  const effectiveScope: Scope = scope ?? (counts.attend > 0 ? "attend" : counts.mine > 0 ? "mine" : "active");
  const list = useMemo(() => {
    const base = rows.filter((r) =>
      effectiveScope === "attend" ? r.access.attend && (r.status === "pending" || r.status === "preparing" || r.status === "dispatched")
        : effectiveScope === "mine" ? r.access.request && isOpen(r.status)
          : effectiveScope === "active" ? isOpen(r.status) : !isOpen(r.status));
    return smartFilter(base, q, (r) => `#${r.number} ${r.from_name} ${r.to_name} ${r.requested_by_name ?? ""} ${r.handled_by_name ?? ""} ${r.note ?? ""}`, { keepOrder: true });
  }, [rows, effectiveScope, q]);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          [<Inbox key="i" size={16} />, "Por atender", counts.attend, counts.attendNew ? `${counts.attendNew} nuevo${counts.attendNew === 1 ? "" : "s"}` : "Al día", counts.attendNew ? "#ef4444" : "var(--t-accent)"],
          [<Send key="s" size={16} />, "Mis pedidos activos", counts.mine, "Esperando respuesta o en camino", "#8b5cf6"],
          [<Truck key="t" size={16} />, "En camino a mi punto", counts.arriving, "Confirma al recibir", "#0ea5e9"],
          [<MessageCircle key="m" size={16} />, "Mensajes sin leer", counts.unread, "En pedidos activos", counts.unread ? "#f59e0b" : "var(--t-accent)"],
        ].map(([icon, label, value, sub, color]) => (
          <div key={label as string} className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)" }}>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
              <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color as string} 16%, transparent)`, color: color as string }}>{icon}</span>
              {label as string}
            </p>
            <p className="mt-2 text-2xl font-black tabular-nums">{loading ? "…" : (value as number)}</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{sub as string}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-full border p-1 text-xs font-bold [scrollbar-width:none]" style={{ borderColor: "var(--t-card-border)" }}>
          {([
            ["attend", `📥 Por atender${counts.attend ? ` (${counts.attend})` : ""}`],
            ["mine", `📤 Mis pedidos${counts.mine ? ` (${counts.mine})` : ""}`],
            ["active", `🔄 Todos activos (${counts.active})`],
            ["closed", `🗂️ Cerrados (${counts.closed})`],
          ] as Array<[Scope, string]>).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className="shrink-0 rounded-full px-3 py-1.5 transition" style={effectiveScope === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input className="w-full rounded-full border py-2 pr-3 text-sm outline-none" style={{ paddingLeft: "2.1rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, punto o persona…" />
        </div>
        <button type="button" onClick={() => { setLoading(true); void load(); }} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar" title="Actualizar">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        {canRequest ? (
          <button type="button" onClick={() => setCreating(Date.now())} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
            <Plus size={16} /> Pedir mercancía
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p>
      ) : loading && !rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-36 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg)" }} />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-3xl">{effectiveScope === "attend" ? "🎉" : "📦"}</p>
          <p className="mt-2 font-semibold">{effectiveScope === "attend" ? "No hay pedidos por atender" : "No hay pedidos aquí"}</p>
          {canRequest ? <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>¿Se te acabó algo? Toca “Pedir mercancía” y pídelo a otro punto o a la bodega.</p> : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r, i) => {
            const st = SR_STATUS[r.status];
            const needsMe = (r.access.attend && r.status === "pending") || (r.access.request && r.status === "dispatched");
            return (
              <motion.button
                key={r.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.025 }}
                onClick={() => setOpenId(r.id)}
                className="relative flex flex-col rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-xl"
                style={{
                  borderColor: needsMe ? `color-mix(in oklab, ${st.color} 55%, transparent)` : "var(--t-card-border)",
                  background: needsMe ? `color-mix(in oklab, ${st.color} 7%, var(--t-card-bg))` : "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
                }}
              >
                {needsMe ? <span className="absolute right-4 top-4 h-2.5 w-2.5 animate-ping rounded-full" style={{ background: st.color }} /> : null}
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <span className="text-sm font-black">#{r.number}</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${st.color} 16%, transparent)`, color: st.color }}>{st.icon} {st.short}</span>
                  {r.priority === "urgent" && isOpen(r.status) ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">⚡ Urgente</span> : null}
                  {r.unread > 0 && isOpen(r.status) ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: "#f59e0b" }}>💬 {r.unread}</span> : null}
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 font-bold">
                  {r.to_name} <ArrowRight size={14} style={{ color: "var(--t-muted)" }} /> {r.from_name}
                </p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {r.items} producto{r.items === 1 ? "" : "s"} · {r.units} und. · pidió {r.requested_by_name ?? "—"}{r.handled_by_name ? ` · atiende ${r.handled_by_name}` : ""}
                </p>
                {r.last_message ? (
                  <p className="mt-2 line-clamp-2 rounded-xl px-3 py-2 text-xs" style={{ background: "color-mix(in oklab, var(--t-card-border) 45%, transparent)" }}>
                    {r.last_message.kind === "message" ? <b>{r.last_message.user_name}: </b> : null}{r.last_message.body}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {timeAgo(r.updated_at)}
                  {needsMe ? <b style={{ color: st.color }}> · {r.status === "pending" ? "Te toca revisarlo" : "Confirma cuando llegue"}</b> : null}
                </p>
              </motion.button>
            );
          })}
        </div>
      )}

      {creating !== null ? (
        <NewStockRequest
          key={creating}
          open
          onClose={() => setCreating(null)}
          storeId={storeId}
          points={points}
          myPoint={myPoint}
          onCreated={(id) => {
            setCreating(null);
            setScope("mine");
            void load();
            setOpenId(id);
          }}
        />
      ) : null}
      <RequestRoom requestId={openId} onClose={() => { setOpenId(null); void load(); }} onChanged={() => void load()} />
    </section>
  );
}
