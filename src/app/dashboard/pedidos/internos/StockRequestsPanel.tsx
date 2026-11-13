"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { draftAge, onStockDraftChange, readStockDraft } from "@/lib/stock-request-draft";
import { m as motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, BellRing, MessageCircle, MessageCirclePlus, Plus, RefreshCw, Search, Truck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { URL_CHANGE_EVENT } from "@/lib/url-intent";
import { useRunOnChange } from "../../inventario/shared";
import { NewStockRequest, type PointOption, type PrefillLine } from "./NewStockRequest";
import { NotificationSettings } from "./NotificationSettings";
import { RequestRoom } from "./RequestRoom";
import { OPEN_REQUEST_EVENT, STOCK_REQUESTS_CHANGED_EVENT, SR_STATUS, SR_STEPS, isOpen, srError, timeAgo, type SrListItem } from "./types";
import { SkeletonCards } from "@/components/ui/Skeleton";

/** Color de los mensajes sin leer (distinto de todos los estados). */
const UNREAD = "#ec4899";

type Scope = "attend" | "mine" | "active" | "closed";

/** Pedidos internos entre puntos y bodegas: bandeja, filtros, nuevo pedido y sala con chat. */
export function StockRequestsPanel({ storeId, canRequest }: { storeId: string; canRequest: boolean }) {
  // Pedido interno a medio armar en este equipo (se guarda solo): se avisa para seguirlo.
  const draftSig = useSyncExternalStore(onStockDraftChange, () => { const d = readStockDraft(storeId); return d ? `${d.lines.length}|${d.at}` : ""; }, () => "");
  const [draftCount, draftAt] = draftSig ? [Number(draftSig.split("|")[0]), draftSig.split("|")[1]] : [0, ""];
  const [rows, setRows] = useState<SrListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<PointOption[]>([]);
  const [myPoint, setMyPoint] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  // Desde el chat («Crear pedido con esto» o «Pedir a otro punto»): nota y producto ya puestos.
  const [prefill, setPrefill] = useState<{ note: string; lines: PrefillLine[] } | null>(null);
  const [sounds, setSounds] = useState(false);

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
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("pedido");
    if (fromUrl) window.setTimeout(() => setOpenId(fromUrl), 0);
    // ?nuevo=1 abre el formulario; también si llega sin recargar (REM o el buscador Ctrl+K estando ya aquí).
    const checkNew = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("nuevo") !== "1") return;
      const note = params.get("nota") ?? "";
      const product = params.get("producto");
      void (async () => {
        let lines: PrefillLine[] = [];
        if (product) {
          const { data: cards } = await sb.rpc("erp_chat_products", { p_store: storeId, p_ids: [product] });
          const c = Array.isArray(cards) ? (cards[0] as { id: string; name: string; sku: string | null; stock: Array<{ id: string; qty: number }> } | undefined) : undefined;
          if (c) lines = [{ product_id: c.id, name: c.name, sku: c.sku, qty: 1, levels: Object.fromEntries(c.stock.map((x) => [x.id, x.qty])) }];
        }
        setPrefill({ note, lines });
        setCreating(Date.now());
        const u = new URL(window.location.href);
        ["nuevo", "nota", "producto"].forEach((k) => u.searchParams.delete(k));
        window.history.replaceState(null, "", u.toString());
      })();
    };
    checkNew();
    window.addEventListener(URL_CHANGE_EVENT, checkNew);
    const onOpen = (e: Event) => setOpenId(String((e as CustomEvent<string>).detail));
    window.addEventListener(OPEN_REQUEST_EVENT, onOpen);
    // Cambios en vivo: aviso de la conexión única del panel (StockRequestWatcher) + respaldo cada 30 s.
    const onChange = () => void load();
    window.addEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    return () => {
      window.removeEventListener(URL_CHANGE_EVENT, checkNew);
      window.removeEventListener(OPEN_REQUEST_EVENT, onOpen);
      window.removeEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
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
    <section className="space-y-3">
      {/* Antes eran 4 recuadros grandes; los números ya van en las pestañas y aquí solo lo que pide acción. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 text-xs font-bold [scrollbar-width:none] sm:mx-0 sm:rounded-full sm:border sm:p-1" style={{ borderColor: "var(--t-card-border)" }}>
          {([
            ["attend", "📥 Por atender", counts.attend, counts.attendNew > 0],
            ["mine", "📤 Mis pedidos", counts.mine, false],
            ["active", "🔄 Activos", counts.active, false],
            ["closed", "🗂️ Cerrados", counts.closed, false],
          ] as Array<[Scope, string, number, boolean]>).map(([k, l, n, hot]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 transition sm:border-0"
              style={effectiveScope === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { color: "var(--t-muted)", borderColor: "var(--t-card-border)" }}>
              {l}
              {n ? <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={hot ? { background: "#ef4444", color: "#fff" } : { background: "color-mix(in oklab, currentColor 18%, transparent)" }}>{n}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
            <input type="search" className="w-full rounded-full border py-2 pr-3 text-sm outline-none" style={{ paddingLeft: "2.1rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número, punto o persona…" />
          </div>
          <button type="button" onClick={() => { setLoading(true); void load(); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar" title="Actualizar">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button type="button" onClick={() => setSounds(true)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-full border text-sm font-bold lg:w-auto lg:px-3" style={{ borderColor: "var(--t-card-border)" }} title="Sonidos y avisos" aria-label="Sonidos y avisos">
            <BellRing size={15} /> <span className="hidden lg:inline">Sonidos</span>
          </button>
          <Link href="/dashboard/mensajes?nuevo=1" className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-full border text-sm font-bold lg:w-auto lg:px-3" style={{ borderColor: "var(--t-card-border)" }} title="Abrir un chat o un grupo con quien quieras, sin hacer un pedido" aria-label="Nuevo chat">
            <MessageCirclePlus size={15} /> <span className="hidden lg:inline">Nuevo chat</span>
          </Link>
          {canRequest ? (
            <button type="button" onClick={() => setCreating(Date.now())} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-white shadow-lg sm:px-4" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              <Plus size={16} /> Pedir<span className="hidden sm:inline"> mercancía</span>
            </button>
          ) : null}
        </div>
      </div>

      {canRequest && draftCount && creating === null ? (
        <button type="button" onClick={() => setCreating(Date.now())}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition hover:-translate-y-0.5"
          style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,.1)" }}>
          <span><b>📝 Tienes un pedido sin enviar</b> · {draftCount} producto{draftCount === 1 ? "" : "s"} · guardado {draftAge(draftAt)}</span>
          <span className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-black text-white" style={{ background: "#f59e0b" }}>Seguir armándolo</span>
        </button>
      ) : null}

      {counts.arriving || counts.unread ? (
        <div className="flex flex-wrap gap-1.5 text-xs font-bold">
          {counts.arriving ? (
            <button type="button" onClick={() => setScope("mine")} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "color-mix(in oklab, #0ea5e9 16%, transparent)", color: "#38bdf8" }}>
              <Truck size={13} /> {counts.arriving} en camino a tu punto · confirma al recibir
            </button>
          ) : null}
          {counts.unread ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: `color-mix(in oklab, ${UNREAD} 16%, transparent)`, color: UNREAD }}>
              <MessageCircle size={13} /> {counts.unread} mensaje{counts.unread === 1 ? "" : "s"} sin leer
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p>
      ) : loading && !rows.length ? (
        <SkeletonCards count={4} label="Cargando pedidos internos…" />
      ) : list.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-3xl">{effectiveScope === "attend" ? "🎉" : "📦"}</p>
          <p className="mt-2 font-semibold">{effectiveScope === "attend" ? "No hay pedidos por atender" : "No hay pedidos aquí"}</p>
          {canRequest ? <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>¿Se te acabó algo? Toca “Pedir mercancía” y pídelo a otro punto o a la bodega.</p> : null}
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2 md:gap-3">
            {list.map((r, i) => {
              const st = SR_STATUS[r.status];
              const needsMe = (r.access.attend && r.status === "pending") || (r.access.request && r.status === "dispatched");
              const urgent = r.priority === "urgent" && isOpen(r.status);
              const unread = r.unread > 0 && isOpen(r.status);
              return (
                <motion.button
                  key={r.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.025 }}
                  onClick={() => setOpenId(r.id)}
                  className="relative flex flex-col overflow-hidden rounded-2xl border p-3 pl-4 text-left transition hover:-translate-y-0.5 hover:shadow-xl sm:p-4 sm:pl-5"
                  style={{
                    borderColor: `color-mix(in oklab, ${st.color} ${needsMe ? 80 : 40}%, transparent)`,
                    background: `color-mix(in oklab, ${st.color} ${needsMe ? 12 : 6}%, var(--t-card-bg))`,
                    boxShadow: needsMe ? `0 0 0 1px color-mix(in oklab, ${st.color} 35%, transparent), 0 8px 28px -12px ${st.color}` : undefined,
                  }}
                >
                  {/* Franja del estado (roja arriba si es urgente). */}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: urgent ? `linear-gradient(180deg, #ef4444 0 35%, ${st.color} 35%)` : st.color }} />
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-black">#{r.number}</span>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: st.color }} title={st.label}>{st.icon} {st.short}</span>
                    {urgent ? <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Urgente">⚡<span className="hidden sm:inline"> Urgente</span></span> : null}
                    {unread ? <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: UNREAD }} title={`${r.unread} mensajes sin leer`}>💬 {r.unread}</span> : null}
                    <span className="ml-auto shrink-0 text-[11px]" style={{ color: "var(--t-muted)" }}>{timeAgo(r.updated_at)}</span>
                  </div>
                  <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm font-bold">
                    <span className="min-w-0 truncate rounded-md px-1.5 py-0.5" style={{ background: "color-mix(in oklab, #f59e0b 14%, transparent)", color: "#fbbf24" }} title={`Envía: ${r.to_name}`}>📤 {r.to_name}</span>
                    <ArrowRight size={14} className="shrink-0" style={{ color: st.color }} />
                    <span className="min-w-0 truncate rounded-md px-1.5 py-0.5" style={{ background: "color-mix(in oklab, #22c55e 14%, transparent)", color: "#4ade80" }} title={`Recibe: ${r.from_name}`}>📥 {r.from_name}</span>
                  </p>
                  {st.step >= 0 ? (
                    <div className="mt-2 flex gap-1" aria-label={`Paso ${st.step + 1} de ${SR_STEPS.length}: ${st.label}`}>
                      {SR_STEPS.map((k, n) => (
                        <span key={k} className="h-1 flex-1 rounded-full" style={{ background: n <= st.step ? SR_STATUS[k].color : "var(--t-card-border)" }} />
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" style={{ color: "var(--t-muted)" }}>
                    <span>📦 {r.items} prod. · {r.units} und.</span>
                    <span className="hidden sm:inline">· pidió <b style={{ color: "var(--t-text)" }}>{r.requested_by_name ?? "—"}</b>{r.handled_by_name ? <> · atiende <b style={{ color: "var(--t-text)" }}>{r.handled_by_name}</b></> : null}</span>
                    {needsMe ? <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: st.color }}>👉 {r.status === "pending" ? "Te toca revisarlo" : "Confirma al llegar"}</span> : null}
                  </p>
                  {r.last_message && r.last_message.kind === "message" && (unread || isOpen(r.status)) ? (
                    <p className="mt-1.5 truncate rounded-lg border-l-4 px-2 py-1 text-xs"
                      style={{ borderColor: UNREAD, background: `color-mix(in oklab, ${UNREAD} 9%, transparent)` }}>
                      <b>💬 {r.last_message.user_name}: </b>{r.last_message.body}
                    </p>
                  ) : null}
                </motion.button>
              );
            })}
          </div>
          {/* Guía de colores plegada al final: se consulta una vez, no tiene que ocupar espacio arriba. */}
          <details className="text-[11px]" style={{ color: "var(--t-muted)" }}>
            <summary className="cursor-pointer select-none font-semibold">🎨 ¿Qué significa cada color?</summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-semibold">
              {(["pending", "preparing", "dispatched", "received", "rejected"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SR_STATUS[k].color }} />{SR_STATUS[k].short}</span>
              ))}
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Urgente</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: UNREAD }} />Mensajes sin leer</span>
            </div>
          </details>
        </>
      )}

      {creating !== null ? (
        <NewStockRequest
          key={creating}
          open
          onClose={() => { setCreating(null); setPrefill(null); }}
          initialNote={prefill?.note}
          initialLines={prefill?.lines}
          storeId={storeId}
          points={points}
          myPoint={myPoint}
          onCreated={(id) => {
            setCreating(null);
            setPrefill(null);
            setScope("mine");
            void load();
            setOpenId(id);
          }}
        />
      ) : null}
      <NotificationSettings open={sounds} onClose={() => setSounds(false)} storeId={storeId} points={points} />
      <RequestRoom requestId={openId} onClose={() => { setOpenId(null); void load(); }} onChanged={() => void load()} />
    </section>
  );
}
