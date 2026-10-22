"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField } from "@/components/forms/Fields";

/**
 * Plata y control en el inicio (20261225):
 *  · CostAlertsCard: ventas por debajo del costo (quién, dónde, cuánto se perdió).
 *  · DailyCloseButton: el cierre del día (lo mismo que llega al celular a las 9 p. m.) con botón de WhatsApp.
 */

const money = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

type CostAlert = { id: string; product: string; qty: number; price: number; cost: number; loss: number; seller: string | null; doc: string | null; point: string | null; token: string | null; at: string; seen: boolean };

export function CostAlertsCard({ storeId }: { storeId: string }) {
  const [data, setData] = useState<{ unseen: number; items: CostAlert[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const { data: r, error } = await supabaseBrowser().rpc("erp_cost_alerts_list", { p_store: storeId, p_days: 30 });
    const v = r as { ok: boolean; unseen: number; items: CostAlert[] } | null;
    setData(!error && v?.ok ? v : null);
  }, [storeId]);
  useEffect(() => {
    const first = window.setTimeout(() => {
      void load();
      if (new URLSearchParams(window.location.search).get("alertas") === "costo") setOpen(true);
    }, 0);
    const t = window.setInterval(() => void load(), 2 * 60 * 1000);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, [load]);
  if (!data || (!data.unseen && !open)) return null;
  const items = open ? data.items : data.items.filter((i) => !i.seen);
  const loss = items.reduce((s, i) => s + Number(i.loss), 0);
  async function seen() {
    await supabaseBrowser().rpc("erp_cost_alerts_seen", { p_store: storeId });
    setOpen(false);
    void load();
  }
  return (
    <section className="rounded-[28px] border p-4 sm:p-5" style={{ ...card, borderColor: "color-mix(in oklab, #ef4444 45%, var(--t-card-border))" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">⚠️ Ventas por debajo del costo {data.unseen ? <span className="ml-1 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{data.unseen} nuevas</span> : null}</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{open ? "Solo nuevas" : "Ver 30 días"}</button>
          {data.unseen ? <button type="button" onClick={() => void seen()} className="rounded-lg px-2.5 py-1 font-semibold text-white" style={{ background: "var(--t-cta)" }}>✓ Marcar como vistas</button> : null}
        </div>
      </div>
      <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Se perdieron <b style={{ color: "#ef4444" }}>{money(loss)}</b> frente al costo en {items.length} producto(s). Revisa con quien vendió o sube el precio.</p>
      <div className="grid gap-2 md:grid-cols-2">
        {items.slice(0, 20).map((a) => (
          <div key={a.id} className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <p className="font-bold">{a.product} <span className="font-normal" style={{ color: "var(--t-muted)" }}>× {a.qty}</span></p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              Vendió a <b style={{ color: "var(--t-text)" }}>{money(a.price)}</b> · costo {money(a.cost)} · pérdida <b style={{ color: "#ef4444" }}>{money(a.loss)}</b>
            </p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              {a.seller ?? "—"}{a.point ? ` · ${a.point}` : ""} · {new Date(a.at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
              {a.token ? <> · <a href={`/pedido/${a.token}`} target="_blank" rel="noreferrer" className="font-semibold underline">{a.doc ?? "ver venta"}</a></> : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

type Close = {
  day: string; total: number; count: number;
  points: Array<{ name: string; count: number; total: number }>; sellers: Array<{ name: string; count: number; total: number }>;
  cash: Array<{ point: string; number: number; status: string; difference: number; by: string | null }>; cash_open: string[];
  transfers_pending: number; out_of_stock: string[]; out_count: number; below_cost: number;
};

function closeText(c: Close, store: string) {
  const day = new Date(`${c.day}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const L = [`📊 *Cierre del día · ${store}*`, `📅 ${day}`, "", `💰 Ventas: *${money(c.total)}* (${c.count})`];
  for (const p of c.points) L.push(`   • ${p.name}: ${money(p.total)} (${p.count})`);
  if (c.sellers[0]) L.push("", `🏆 Más vendió: *${c.sellers[0].name}* (${money(c.sellers[0].total)})`);
  if (c.cash.length || c.cash_open.length) {
    L.push("", "💵 Cajas:");
    for (const k of c.cash) L.push(`   • ${k.point}: ${Number(k.difference) === 0 ? "✅ cuadra" : Number(k.difference) < 0 ? `🔴 faltan ${money(Math.abs(k.difference))}` : `🟡 sobran ${money(k.difference)}`}${k.by ? ` (${k.by})` : ""}`);
    for (const k of c.cash_open) L.push(`   • ${k}: ⏳ sin cerrar`);
  }
  if (c.transfers_pending) L.push("", `🚚 Traslados pendientes: ${c.transfers_pending}`);
  if (c.out_count) L.push(`📦 Se agotaron hoy: ${c.out_count}${c.out_of_stock.length ? ` (${c.out_of_stock.slice(0, 8).join(", ")}${c.out_count > 8 ? "…" : ""})` : ""}`);
  if (c.below_cost) L.push(`⚠️ Ventas bajo el costo: ${c.below_cost}`);
  return L.join("\n");
}

export function DailyCloseButton({ storeId, storeName }: { storeId: string; storeName: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today);
  const [data, setData] = useState<Close | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => { if (new URLSearchParams(window.location.search).get("cierre") === "1") setOpen(true); }, 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_daily_close", { p_store: storeId, p_day: day }).then(({ data: r, error: e }) => {
      if (!alive) return;
      const v = r as (Close & { ok: boolean; error?: string }) | null;
      if (e || !v?.ok) { setError(e && /erp_daily_close|Could not find/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261225_plata_y_control.sql." : v?.error ?? e?.message ?? "No se pudo cargar."); setData(null); }
      else { setError(""); setData(v); }
    });
    return () => { alive = false; };
  }, [open, day, storeId]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>📊 Cierre de hoy</button>
      {mounted && open ? createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Cierre del día" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-black">📊 Cierre del día</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Cerrar</button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm"><span>Día:</span><DateField value={day} onChange={(v) => setDay(v || today())} max={today()} compact ariaLabel="Día del cierre" /></div>
            {error ? <p className="mt-3 text-sm text-amber-500">⚠️ {error}</p> : null}
            {!data && !error ? <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : null}
            {data ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                  <p className="text-xs uppercase" style={{ color: "var(--t-muted)" }}>Ventas</p>
                  <p className="text-2xl font-black">{money(data.total)} <span className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>· {data.count} venta(s)</span></p>
                  {data.points.map((p) => <p key={p.name} className="flex justify-between"><span>{p.name}</span><b>{money(p.total)}</b></p>)}
                </div>
                {data.sellers.length ? (
                  <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-xs uppercase" style={{ color: "var(--t-muted)" }}>Quién vendió más</p>
                    {data.sellers.map((s, i) => <p key={s.name} className="flex justify-between"><span>{i === 0 ? "🏆 " : ""}{s.name}</span><b>{money(s.total)}</b></p>)}
                  </div>
                ) : null}
                {data.cash.length || data.cash_open.length ? (
                  <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-xs uppercase" style={{ color: "var(--t-muted)" }}>Cajas</p>
                    {data.cash.map((c) => (
                      <p key={`${c.point}-${c.number}`} className="flex justify-between gap-2"><span>{c.point} #{c.number}{c.by ? ` · ${c.by}` : ""}</span>
                        <b style={{ color: Number(c.difference) === 0 ? "#10b981" : Number(c.difference) < 0 ? "#ef4444" : "#f59e0b" }}>{Number(c.difference) === 0 ? "Cuadra" : Number(c.difference) < 0 ? `Faltan ${money(Math.abs(c.difference))}` : `Sobran ${money(c.difference)}`}</b></p>
                    ))}
                    {data.cash_open.map((n) => <p key={n} className="flex justify-between"><span>{n}</span><b style={{ color: "#f59e0b" }}>Sin cerrar</b></p>)}
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}><b className="block text-lg">{data.transfers_pending}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Traslados pendientes</span></div>
                  <div className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}><b className="block text-lg">{data.out_count}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Se agotaron</span></div>
                  <div className="rounded-xl border p-2" style={{ borderColor: data.below_cost ? "#ef4444" : "var(--t-card-border)" }}><b className="block text-lg" style={{ color: data.below_cost ? "#ef4444" : undefined }}>{data.below_cost}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>Bajo el costo</span></div>
                </div>
                {data.out_of_stock.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Agotados: {data.out_of_stock.join(", ")}</p> : null}
                <a href={`https://wa.me/?text=${encodeURIComponent(closeText(data, storeName))}`} target="_blank" rel="noreferrer"
                  className="flex w-full items-center justify-center rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: "#16a34a" }}>💬 Enviar por WhatsApp</a>
                <p className="text-center text-[11px]" style={{ color: "var(--t-muted)" }}>Todos los días a las 9 p. m. te llega este resumen al celular (si activaste las notificaciones).</p>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
