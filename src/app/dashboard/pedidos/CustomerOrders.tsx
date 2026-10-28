"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { smartFilter } from "@/lib/search";
import { VoidSaleDialog, useSaleVoidRights, type VoidTarget } from "../pos/VoidSaleDialog";

/** =========================
 * Helpers (UI)
 * ========================= */
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

function statusLabel(s: string) {
  if (s === "draft") return "Borrador";
  if (s === "sent") return "Enviado (editable)";
  if (s === "confirmed") return "Confirmado";
  if (s === "completed") return "Completado";
  if (s === "cancelled") return "Anulado";
  return s;
}

function paymentStatusLabel(s: string | null | undefined) {
  if (s === "paid") return "Pagado";
  if (s === "pending") return "Pago pendiente";
  if (s === "failed") return "Pago rechazado";
  return "Sin pagar";
}

type OrderStatus = "draft" | "sent" | "confirmed" | "completed" | "cancelled";

/** =========================
 * ✅ Tokens (auto claro/oscuro por tu CSS)
 * ========================= */
function tokenCard() {
  return "glass";
}

function inputBase() {
  // ✅ mejor en móvil: más alto, más legible, sin desbordes
  // ✅ ahora usa tokens (fondo/borde/texto) desde CSS global
  return "w-full rounded-2xl border px-4 py-3 text-sm outline-none backdrop-blur-xl";
}
function selectBase() {
  return "w-full rounded-2xl border px-4 py-3 text-sm outline-none backdrop-blur-xl";
}

function btnSoft() {
  // ✅ usa tokens globales (te quedan iguales en toda la app)
  return "btn-soft px-4 py-2 text-sm font-semibold";
}

/** Badge por estado con tokens:
 * - Para colores “semantic” (sky/emerald/indigo) uso color-mix sin hardcode a white/black.
 * - En draft usa card tokens.
 */
function statusBadge(st: OrderStatus) {
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold";

  if (st === "draft")
    return `${base}`;
  if (st === "sent")
    return `${base}`;
  if (st === "confirmed")
    return `${base}`;
  return `${base}`;
}

/** estilos inline (tokens) para los badges, para que sean 100% auto tema */
function statusBadgeStyle(st: OrderStatus): React.CSSProperties {
  if (st === "cancelled") {
    return {
      borderColor: "color-mix(in oklab, #ef4444 45%, var(--t-card-border))",
      background: "color-mix(in oklab, #ef4444 12%, transparent)",
      color: "#ef4444",
    };
  }
  const borderBase = "var(--t-card-border)";
  const bgBase = "color-mix(in oklab, var(--t-card-bg) 88%, transparent)";
  const textBase = "color-mix(in oklab, var(--t-text) 88%, transparent)";

  if (st === "draft") {
    return {
      borderColor: borderBase,
      background: bgBase,
      color: textBase,
    };
  }
  if (st === "sent") {
    return {
      borderColor: "color-mix(in oklab, deepskyblue 35%, var(--t-card-border))",
      background: "color-mix(in oklab, deepskyblue 12%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 88%, deepskyblue 12%)",
    };
  }
  if (st === "confirmed") {
    return {
      borderColor: "color-mix(in oklab, lime 35%, var(--t-card-border))",
      background: "color-mix(in oklab, lime 12%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 88%, lime 12%)",
    };
  }
  return {
    borderColor: "color-mix(in oklab, dodgerblue 35%, var(--t-card-border))",
    background: "color-mix(in oklab, dodgerblue 12%, transparent)",
    color: "color-mix(in oklab, var(--t-text) 88%, dodgerblue 12%)",
  };
}

function cleanText(v: string | null | undefined) {
  return (v ?? "").trim();
}

function safeCustomer(v: string | null | undefined) {
  return cleanText(v) || "—";
}

type OrderRow = {
  id: string;
  token: string;
  store_id: string;
  receipt_no: number | null;
  status: OrderStatus;
  payment_status: string;
  total: number;
  created_at: string;
  customer_name: string | null;
  customer_whatsapp: string | null;

  customer_note: string | null; // ✅ observaciones
  catalog_type: "retail" | "wholesale";
};

type ItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price: number;
  product?: { name: string; image_url: string | null } | null;
};

type View = "pending" | "to_confirm" | "to_complete" | "completed" | "cancelled" | "all";
type Period = "today" | "7d" | "30d" | "90d" | "all";
type Meta = { point_id: string | null; doc_number: string | null; seller_name: string | null; source: string };
type Row = OrderRow & Meta & { point_name: string };

const NO_POINT = "__none__";
const PAGE = 1000;
const VIEWS: Array<[View, string]> = [["pending", "⏳ Pendientes"], ["to_confirm", "✏️ Por confirmar"], ["to_complete", "📦 Por completar"], ["completed", "🎉 Completados"], ["cancelled", "⊘ Anulados"], ["all", "Todos"]];
const PERIODS: Array<[Period, string]> = [["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"], ["all", "Todo"]];
const isToConfirm = (s: string) => s === "draft" || s === "sent";
const inView = (s: string, v: View) =>
  v === "all" || (v === "pending" ? isToConfirm(s) || s === "confirmed" : v === "to_confirm" ? isToConfirm(s) : v === "to_complete" ? s === "confirmed" : s === v);

function sinceOf(p: Period) {
  if (p === "all") return null;
  const d = new Date();
  if (p === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (p === "7d" ? 7 : p === "30d" ? 30 : 90));
  return d.toISOString();
}

/** Cuánto lleva el pedido sin cerrarse (solo pendientes): texto y color. */
function age(o: { created_at: string; status: string }, now: number) {
  const h = (now - Date.parse(o.created_at)) / 3_600_000;
  const text = h < 1 ? `hace ${Math.max(1, Math.round(h * 60))} min` : h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.floor(h / 24)} día${Math.floor(h / 24) === 1 ? "" : "s"}`;
  const pending = isToConfirm(o.status) || o.status === "confirmed";
  return { text, hours: h, color: !pending ? "var(--t-muted)" : h >= 24 ? "#ef4444" : h >= 4 ? "#f59e0b" : "var(--t-muted)", stale: pending && h >= 24 };
}

async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await run(ids.slice(i, i + 200));
    if (!error && Array.isArray(data)) out.push(...(data as T[]));
  }
  return out;
}

export function CustomerOrders() {
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("pending");
  const [point, setPoint] = useState<string>("all");
  const [period, setPeriod] = useState<Period>("30d");
  const [oldFirst, setOldFirst] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const voidRights = useSaleVoidRights(storeId);

  function askVoid(o: OrderRow) {
    setVoidTarget({
      orderId: o.id,
      label: `Pedido #${o.receipt_no ?? "—"}`,
      total: Number(o.total ?? 0),
      confirmed: o.status === "confirmed" || o.status === "completed",
      customer: o.customer_name,
    });
  }

  async function load(p: Period = period) {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;
      if (!userData.user) {
        await Swal.fire({ icon: "error", title: "Debes iniciar sesión", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" });
        return;
      }
      const access = await getDashboardStore();
      if (!access.store) {
        await Swal.fire({ icon: "error", title: "No se encontró tu tienda", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" });
        return;
      }
      const sid = access.store.id;
      setStoreId(sid);

      // Enlace de una landing (?pedido=123): abre el pedido completo para atenderlo y terminar la venta.
      const wanted = new URLSearchParams(window.location.search).get("pedido");
      if (wanted && /^\d{1,12}$/.test(wanted)) {
        const { data: hit } = await sb.from("orders").select("token").eq("store_id", sid).eq("receipt_no", Number(wanted)).maybeSingle();
        if ((hit as { token?: string } | null)?.token) {
          window.location.replace(`/pedido/${(hit as { token: string }).token}`);
          return;
        }
      }

      // Pedidos del periodo, de a 1.000 (la base no entrega más de 1.000 por consulta).
      const since = sinceOf(p);
      const list: OrderRow[] = [];
      for (let from = 0; from < 50_000; from += PAGE) {
        let query = sb.from("orders")
          .select("id,token,store_id,receipt_no,status,payment_status,total,created_at,customer_name,customer_whatsapp,customer_note,catalog_type")
          .eq("store_id", sid);
        if (since) query = query.gte("created_at", since);
        const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(from, from + PAGE - 1);
        if (error) throw error;
        list.push(...((data ?? []) as OrderRow[]));
        if ((data ?? []).length < PAGE) break;
      }

      // Punto, documento y vendedor (ventas de punto) o catálogo por donde entró.
      const ids = list.map((o) => o.id);
      const [metas, viaCatalog, catalogs, places] = await Promise.all([
        inChunks<{ order_id: string; point_id: string | null; doc_number: string | null; seller_name: string | null }>(ids, (c) => sb.from("erp_order_meta").select("order_id,point_id,doc_number,seller_name").in("order_id", c)),
        inChunks<{ order_id: string; catalog_id: string }>(ids, (c) => sb.from("store_catalog_orders").select("order_id,catalog_id").in("order_id", c)),
        sb.from("store_catalogs").select("id,name,point_id").eq("store_id", sid).then(({ data }) => (data ?? []) as Array<{ id: string; name: string | null; point_id: string | null }>),
        sb.from("erp_warehouses").select("id,name").eq("store_id", sid).then(({ data }) => (data ?? []) as Array<{ id: string; name: string }>),
      ]);
      const metaBy = new Map(metas.map((m) => [m.order_id, m]));
      const catBy = new Map(viaCatalog.map((c) => [c.order_id, catalogs.find((k) => k.id === c.catalog_id)]));
      const pointName = new Map(places.map((w) => [w.id, w.name]));
      setOrders(list.map((o) => {
        const m = metaBy.get(o.id);
        const cat = catBy.get(o.id);
        const pid = m?.point_id ?? cat?.point_id ?? null;
        return { ...o, point_id: pid, point_name: pid ? pointName.get(pid) ?? "Punto" : "Sin punto", doc_number: m?.doc_number ?? null, seller_name: m?.seller_name ?? null,
          source: m ? "Venta en punto" : cat ? `Catálogo ${cat.name ?? ""}`.trim() : "Catálogo" };
      }));
      setNow(Date.now());
      setPicked(new Set());
    } catch (e: any) {
      await Swal.fire({ icon: "error", title: "Error cargando pedidos", text: e?.message ?? "Error", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Si el pedido del enlace no aparece, queda la lista buscando ese número.
    const wanted = new URLSearchParams(window.location.search).get("pedido");
    if (wanted && /^\d{1,12}$/.test(wanted)) { setQ(wanted); setView("all"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tablero por punto: lo que falta por confirmar y por completar, lo que lleva más de un día y lo completado hoy.
  const board = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const map = new Map<string, { key: string; name: string; toConfirm: number; toComplete: number; stale: number; doneToday: number; doneTotal: number }>();
    for (const o of orders) {
      const key = o.point_id ?? NO_POINT;
      const b = map.get(key) ?? { key, name: o.point_name, toConfirm: 0, toComplete: 0, stale: 0, doneToday: 0, doneTotal: 0 };
      if (isToConfirm(o.status)) b.toConfirm++;
      if (o.status === "confirmed") b.toComplete++;
      if (age(o, now).stale) b.stale++;
      if (o.status === "completed" && Date.parse(o.created_at) >= today.getTime()) { b.doneToday++; b.doneTotal += Number(o.total || 0); }
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => b.stale - a.stale || b.toConfirm + b.toComplete - (a.toConfirm + a.toComplete) || a.name.localeCompare(b.name));
  }, [orders, now]);

  const filtered = useMemo(() => {
    const base = orders.filter((o) => inView(o.status, view) && (point === "all" || (o.point_id ?? NO_POINT) === point));
    const hits = smartFilter(base, q,
      (o) => `${o.receipt_no ?? ""} ${o.doc_number ?? ""} ${statusLabel(o.status)} ${paymentStatusLabel(o.payment_status)} ${o.customer_name ?? ""} ${o.customer_whatsapp ?? ""} ${o.customer_note ?? ""} ${o.point_name} ${o.seller_name ?? ""} ${o.source}`,
      { keepOrder: true });
    return oldFirst ? [...hits].reverse() : hits;
  }, [orders, q, view, point, oldFirst]);

  const counts = useMemo(() => {
    const inPoint = orders.filter((o) => point === "all" || (o.point_id ?? NO_POINT) === point);
    return Object.fromEntries(VIEWS.map(([v]) => [v, inPoint.filter((o) => inView(o.status, v)).length])) as Record<View, number>;
  }, [orders, point]);
  const pickable = filtered.filter((o) => o.status === "confirmed");

  async function setOrderStatus(o: OrderRow, nextStatus: OrderStatus) {
    const confirm = await Swal.fire({
      icon: "question", title: nextStatus === "completed" ? "¿Completar el pedido?" : "¿Confirmar el pedido?",
      text: `Pedido #${o.receipt_no ?? "—"} → ${statusLabel(nextStatus)}`,
      showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#22c55e",
    });
    if (!confirm.isConfirmed) return;
    const { error } = await supabaseBrowser().rpc("store_team_set_order_status", { p_order_id: o.id, p_status: nextStatus });
    if (error) {
      await Swal.fire({ icon: "error", title: "No se pudo actualizar", text: error.message, background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" });
      return;
    }
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: nextStatus } : x)));
    void Swal.fire({ toast: true, position: "top", icon: "success", title: nextStatus === "completed" ? "Pedido completado" : "Pedido confirmado", timer: 1400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
  }

  async function completePicked() {
    const list = orders.filter((o) => picked.has(o.id) && o.status === "confirmed");
    if (!list.length) return;
    const ok = await Swal.fire({
      icon: "question", title: `¿Completar ${list.length} pedido${list.length === 1 ? "" : "s"}?`, text: "Quedan como entregados y finalizados.",
      showCancelButton: true, confirmButtonText: "Sí, completar", cancelButtonText: "Cancelar", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#22c55e",
    });
    if (!ok.isConfirmed) return;
    const failed: string[] = [];
    const done = new Set<string>();
    for (const [i, o] of list.entries()) {
      setBusy(`Completando ${i + 1} de ${list.length}…`);
      const { error } = await supabaseBrowser().rpc("store_team_set_order_status", { p_order_id: o.id, p_status: "completed" });
      if (error) failed.push(`#${o.receipt_no ?? "—"}: ${error.message}`); else done.add(o.id);
    }
    setBusy(null);
    setOrders((prev) => prev.map((x) => (done.has(x.id) ? { ...x, status: "completed" } : x)));
    setPicked(new Set());
    await Swal.fire({ icon: failed.length ? "warning" : "success", title: `${done.size} completado${done.size === 1 ? "" : "s"}`, text: failed.length ? `No se pudieron: ${failed.join(" · ")}` : undefined, background: "var(--t-bg-base)", color: "var(--t-text)" });
  }

  async function openOrder(o: OrderRow) {
    try {
      const { data, error } = await supabaseBrowser().from("order_items").select("id,order_id,product_id,quantity,price, products(name,image_url)").eq("order_id", o.id).order("id", { ascending: true });
      if (error) throw error;
      const items: ItemRow[] = (data as any[]).map((x) => ({ ...x, product: x.products ?? null }));
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await Swal.fire({
        title: `Pedido #${o.receipt_no ?? "—"}`,
        html: `<div style="text-align:left;line-height:1.5">
          <b>Cliente:</b> ${esc(safeCustomer(o.customer_name))} · ${esc(safeCustomer(o.customer_whatsapp))}<br/>
          <b>Estado:</b> ${statusLabel(o.status)} · ${paymentStatusLabel(o.payment_status)}<br/>
          <b>Total:</b> ${money(o.total)} · ${new Date(o.created_at).toLocaleString("es-CO")}<br/>
          <b>Observaciones:</b> ${esc(safeCustomer(o.customer_note))}
          <hr style="border-color:rgba(127,127,127,.25);margin:10px 0"/>
          ${items.map((i) => `<div style="margin:6px 0"><b>${esc(i.product?.name ?? i.product_id)}</b><div style="opacity:.8">${i.quantity} × ${money(i.price)} = ${money(Number(i.price) * Number(i.quantity))}</div></div>`).join("")}
        </div>`,
        background: "var(--t-bg-base)", color: "var(--t-text)", width: 640, confirmButtonText: "Cerrar",
      });
    } catch (e: any) {
      await Swal.fire({ icon: "error", title: "Error cargando el detalle", text: e?.message ?? "Error", background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444" });
    }
  }

  async function copyLink(o: OrderRow) {
    const link = `${window.location.origin}/pedido/${o.token}`;
    try { await navigator.clipboard.writeText(link); void Swal.fire({ toast: true, position: "top", icon: "success", title: "Enlace copiado", timer: 1200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" }); }
    catch { window.prompt("Copia el enlace:", link); }
  }

  const chip = (on: boolean): React.CSSProperties => (on
    ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" }
    : { borderColor: "var(--t-card-border)", color: "var(--t-text)" });

  return (
    <main className="space-y-4 p-4 panel-enter sm:p-6" style={{ color: "var(--t-text)" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Pedidos</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Ventas de los puntos, catálogos y landings. Vigila que ninguno se quede sin confirmar o sin completar.</p>
        </div>
        <button className={btnSoft()} onClick={() => void load()} disabled={loading}>{loading ? "Cargando…" : "Recargar"}</button>
      </div>

      {/* Tablero por punto */}
      {board.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          <button type="button" onClick={() => setPoint("all")} className="min-w-[150px] shrink-0 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5" style={point === "all" ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <p className="text-sm font-black">🏬 Todos los puntos</p>
            <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{board.reduce((s, b) => s + b.toConfirm, 0)} por confirmar · {board.reduce((s, b) => s + b.toComplete, 0)} por completar</p>
            {board.some((b) => b.stale) ? <p className="mt-1 text-xs font-bold text-red-500">🔴 {board.reduce((s, b) => s + b.stale, 0)} con más de un día</p> : null}
          </button>
          {board.map((b) => (
            <button key={b.key} type="button" onClick={() => setPoint(point === b.key ? "all" : b.key)} className="min-w-[170px] shrink-0 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
              style={point === b.key ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: b.stale ? "color-mix(in oklab, #ef4444 45%, var(--t-card-border))" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <p className="truncate text-sm font-black">📍 {b.name}</p>
              <p className="mt-1 text-xs"><b>{b.toConfirm}</b> por confirmar · <b>{b.toComplete}</b> por completar</p>
              {b.stale ? <p className="mt-0.5 text-xs font-bold text-red-500">🔴 {b.stale} con más de un día</p> : <p className="mt-0.5 text-xs text-emerald-500">✓ Al día</p>}
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>De hoy ya completados: {b.doneToday} · {money(b.doneTotal)}</p>
            </button>
          ))}
        </div>
      ) : null}

      {/* Filtros */}
      <div className={`${tokenCard()} space-y-3 p-4`}>
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => { setView(v); setPicked(new Set()); }} className="rounded-full border px-3 py-1.5 text-xs font-bold transition" style={chip(view === v)}>
              {label} <span className="opacity-80">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <input className={inputBase()} placeholder="Buscar: número, REMZ-…, cliente, WhatsApp, vendedor, punto…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={selectBase()} value={point} onChange={(e) => setPoint(e.target.value)} aria-label="Punto">
            <option value="all">Todos los puntos</option>
            {board.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
          </select>
          <select className={selectBase()} value={period} onChange={(e) => { const p = e.target.value as Period; setPeriod(p); void load(p); }} aria-label="Periodo">
            {PERIODS.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
          </select>
          <button type="button" onClick={() => setOldFirst((v) => !v)} className={btnSoft()} title="Ordenar por fecha">{oldFirst ? "⬆ Más viejos primero" : "⬇ Más nuevos primero"}</button>
        </div>
        {pickable.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-emerald-500" style={{ minHeight: 0, padding: 0 }} checked={picked.size > 0 && pickable.every((o) => picked.has(o.id))}
                onChange={(e) => setPicked(e.target.checked ? new Set(pickable.map((o) => o.id)) : new Set())} />
              Seleccionar los {pickable.length} por completar
            </label>
            {picked.size ? (
              <button type="button" disabled={!!busy} onClick={() => void completePicked()} className="rounded-full px-4 py-2 text-sm font-black text-white shadow-lg disabled:opacity-60" style={{ background: "linear-gradient(135deg,#22c55e,#10b981)" }}>
                {busy ?? `🎉 Completar ${picked.size}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Lista */}
      {loading ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando pedidos…</p> : !filtered.length ? (
        <div className={`${tokenCard()} p-6 text-center`}>
          <p className="font-semibold">{view === "pending" ? "🎉 No hay pedidos pendientes" : "No hay pedidos con estos filtros"}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{view === "pending" ? "Todo está confirmado y completado en este periodo." : "Prueba con otro estado, punto o periodo."}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((o) => {
            const a = age(o, now);
            const toConfirm = isToConfirm(o.status);
            const returnable = o.status === "confirmed" || o.status === "completed";
            return (
              <li key={o.id} className={`${tokenCard()} p-3`} style={a.stale ? { borderColor: "color-mix(in oklab, #ef4444 55%, var(--t-card-border))" } : undefined}>
                <div className="flex flex-wrap items-start gap-3">
                  {o.status === "confirmed" ? (
                    <input type="checkbox" aria-label={`Seleccionar pedido ${o.receipt_no ?? ""}`} className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" style={{ minHeight: 0, padding: 0 }}
                      checked={picked.has(o.id)} onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                  ) : <span className="w-5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-base">#{o.receipt_no ?? "—"}</b>
                      {o.doc_number ? <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{o.doc_number}</span> : null}
                      <span className={statusBadge(o.status)} style={statusBadgeStyle(o.status)}>{statusLabel(o.status)}</span>
                      <span className="text-xs" style={{ color: o.payment_status === "paid" ? "#22c55e" : "var(--t-muted)" }}>{paymentStatusLabel(o.payment_status)}</span>
                    </div>
                    <p className="mt-1 text-sm">
                      📍 <b>{o.point_name}</b>{o.seller_name ? <> · 👤 {o.seller_name}</> : null} · <span style={{ color: "var(--t-muted)" }}>{o.source}</span>
                    </p>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                      {safeCustomer(o.customer_name)}{cleanText(o.customer_whatsapp) ? ` · ${o.customer_whatsapp}` : ""} · {new Date(o.created_at).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {" · "}<b style={{ color: a.color }}>{a.stale ? "🔴 " : ""}{a.text}{toConfirm ? " sin confirmar" : o.status === "confirmed" ? " sin completar" : ""}</b>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <b className="block text-lg tabular-nums">{money(o.total)}</b>
                    <span className="text-xs" style={{ color: "var(--t-muted)" }}>{o.catalog_type === "retail" ? "Detal" : "Mayor"}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <a href={`/pedido/${o.token}`} target="_blank" rel="noreferrer" className="btn-soft px-3 py-1 text-sm">Abrir</a>
                  <button className="btn-soft px-3 py-1 text-sm" onClick={() => void openOrder(o)}>Detalle</button>
                  <button className="btn-soft px-3 py-1 text-sm" onClick={() => void copyLink(o)}>Copiar enlace</button>
                  {toConfirm ? (
                    <button className="btn-soft px-3 py-1 text-sm font-semibold" style={{ borderColor: "color-mix(in oklab, lime 35%, var(--t-card-border))", background: "color-mix(in oklab, lime 10%, transparent)" }} onClick={() => void setOrderStatus(o, "confirmed")}>Confirmar</button>
                  ) : null}
                  {o.status === "confirmed" ? (
                    <button className="btn-soft px-3 py-1 text-sm font-semibold" style={{ borderColor: "color-mix(in oklab, #22c55e 45%, var(--t-card-border))", background: "color-mix(in oklab, #22c55e 14%, transparent)" }} onClick={() => void setOrderStatus(o, "completed")}>🎉 Completar</button>
                  ) : null}
                  {o.status !== "cancelled" && voidRights && (returnable ? voidRights.return : voidRights.void) ? (
                    <button className="btn-soft px-3 py-1 text-sm font-semibold" onClick={() => askVoid(o)}
                      style={{ borderColor: returnable ? "color-mix(in oklab, #f97316 45%, var(--t-card-border))" : "color-mix(in oklab, #ef4444 45%, var(--t-card-border))", color: returnable ? "#f97316" : "#ef4444" }}>
                      {returnable ? "↩ Devolución" : "⊘ Anular"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <VoidSaleDialog
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onDone={(r) => {
          setVoidTarget(null);
          setOrders((prev) => prev.map((x) => (x.id === voidTarget?.orderId ? { ...x, status: "cancelled" } : x)));
          void Swal.fire({ icon: "success", title: r.kind === "return" ? "Devolución lista" : "Pedido anulado", text: r.units_returned ? `${r.units_returned} unidades volvieron al inventario.` : undefined, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
        }}
      />

      <p className="text-xs" style={{ color: "var(--t-muted)" }}>
        En rojo: pedidos con más de un día sin confirmar o sin completar. El cliente puede editar mientras esté en <b>Enviado</b>; al confirmarlo queda bloqueado.
      </p>
    </main>
  );
}
