"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField } from "@/components/forms/Fields";
import { Thumb } from "./LineEditor";
import { Btn, Empty, Panel, errorMessage, inputClass, inputStyle, money, toast, type ErpCtx, type Warehouse } from "./shared";

/**
 * Ayudas opcionales de inventario (20261226):
 *  · PurchaseSuggestions: qué comprar según lo vendido, lo que hay y lo que va en camino.
 *  · ExpiryDialog: anotar fechas de vencimiento después de un ingreso (opcional).
 *  · ExpiryTab: lo que vence pronto y lo vencido.
 */

const missing = (e: { message: string } | null, fn: string) => Boolean(e && new RegExp(`${fn}|Could not find`, "i").test(e.message));

type Sug = {
  product_id: string; name: string; sku: string | null; image_url: string | null; sold_30: number; per_day: number;
  stock: number; transit: number; days_left: number | null; qty: number; supplier_id: string | null; supplier: string | null; unit_cost: number | null;
};
export type SuggestedLine = { product_id: string; name: string; sku: string | null; qty: number; unit_cost: number };

export function PurchaseSuggestions({ storeId, supplier, onAdd }: { storeId: string; supplier: string; onAdd: (lines: SuggestedLine[], supplierId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [cover, setCover] = useState(30);
  const [only, setOnly] = useState(supplier || "");
  const [data, setData] = useState<{ items: Sug[]; suppliers: Array<{ id: string; name: string }>; total: number | null; can_cost: boolean } | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_purchase_suggestions", { p_store: storeId, p_cover: cover, p_supplier: only || null }).then(({ data: r, error: e }) => {
      if (!alive) return;
      const v = r as ({ ok: boolean; error?: string } & NonNullable<typeof data>) | null;
      if (e || !v?.ok) { setError(missing(e, "erp_purchase_suggestions") ? "Falta ejecutar en Supabase la migración 20261226_inventario_opcional.sql." : v?.error ?? errorMessage(e)); setData(null); return; }
      setError(""); setData(v);
      setPicked(Object.fromEntries(v.items.map((i) => [i.product_id, i.qty])));
    });
    return () => { alive = false; };
  }, [open, storeId, cover, only]);

  const items = data?.items ?? [];
  const chosen = items.filter((i) => (picked[i.product_id] ?? 0) > 0);
  return (
    <div className="mb-4 rounded-2xl border" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 35%, var(--t-card-border))" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold">
        <span>💡 Qué comprar <span className="font-normal" style={{ color: "var(--t-muted)" }}>· según lo que se vendió en 30 días (opcional)</span></span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Para que alcance</span>
            {[15, 30, 60].map((d) => <button key={d} type="button" onClick={() => setCover(d)} className="rounded-full border px-3 py-1 font-semibold" style={cover === d ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{d} días</button>)}
            <select className={`${inputClass} w-auto`} style={inputStyle} value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Proveedor">
              <option value="">Todos los proveedores</option>
              {(data?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {error ? <p className="text-sm text-amber-500">⚠️ {error}</p> : null}
          {data && !items.length ? <Empty icon="✅" title="No hace falta comprar" text={`Con lo que hay (y lo que va en camino) alcanza para más de ${cover} días.`} /> : null}
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {items.map((i) => (
              <div key={i.product_id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                <Thumb src={i.image_url} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{i.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                    Vende {i.per_day}/día · hay {Number(i.stock)}{Number(i.transit) ? ` + ${i.transit} en camino` : ""} · {i.days_left === null ? "sin existencias" : `alcanza ${i.days_left} días`}
                    {i.supplier ? ` · ${i.supplier}` : ""}{i.unit_cost ? ` · último costo ${money(i.unit_cost)}` : ""}
                  </p>
                </div>
                <input type="number" min={0} className={`${inputClass} w-24 text-right`} style={inputStyle} value={picked[i.product_id] ?? 0}
                  onChange={(e) => setPicked((c) => ({ ...c, [i.product_id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} aria-label={`Comprar ${i.name}`} />
              </div>
            ))}
          </div>
          {items.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs" style={{ color: "var(--t-muted)" }}>{chosen.length} productos · {chosen.reduce((s, i) => s + (picked[i.product_id] ?? 0), 0)} unidades{data?.can_cost ? ` · ${money(chosen.reduce((s, i) => s + (picked[i.product_id] ?? 0) * Number(i.unit_cost ?? 0), 0))} al último costo` : ""}</span>
              <Btn onClick={() => {
                onAdd(chosen.map((i) => ({ product_id: i.product_id, name: i.name, sku: i.sku, qty: picked[i.product_id] ?? i.qty, unit_cost: Number(i.unit_cost ?? 0) })), only || null);
                setOpen(false);
              }} disabled={!chosen.length}>➕ Agregar a esta factura</Btn>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type ExpiryLine = { product_id: string; name: string; qty: number; warehouse_id: string };

export function ExpiryDialog({ storeId, purchaseId, number, lines, onClose }: { storeId: string; purchaseId: string; number?: number | null; lines: ExpiryLine[]; onClose: () => void }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [rows, setRows] = useState(() => lines.map((l) => ({ ...l, expires_on: "", lot: "" })));
  const [busy, setBusy] = useState(false);
  async function save() {
    const items = rows.filter((r) => r.expires_on).map((r) => ({ product_id: r.product_id, warehouse_id: r.warehouse_id, qty: r.qty, expires_on: r.expires_on, lot: r.lot }));
    if (!items.length) return onClose();
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_lot_save", { p_store: storeId, p_items: items, p_purchase: purchaseId });
    setBusy(false);
    if (error || !(data as { ok?: boolean } | null)?.ok) return void toast("No se guardaron los vencimientos", "error", missing(error, "erp_lot_save") ? "Falta ejecutar en Supabase la migración 20261226_inventario_opcional.sql." : errorMessage(error));
    void toast(`${items.length} vencimiento(s) anotados`, "success", "Te avisamos en Inventario → Vencimientos.");
    onClose();
  }
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,.55)" }}>
      <div role="dialog" aria-modal="true" aria-label="Vencimientos" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border p-5 shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <h3 className="text-lg font-black">📅 Vencimientos del ingreso{number ? ` #${number}` : ""}</h3>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Opcional: escribe la fecha solo de lo que vence. Lo demás déjalo vacío.</p>
        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {rows.map((r, idx) => (
            <div key={`${r.product_id}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <span className="min-w-0 flex-1 truncate"><b>{r.name}</b> <span style={{ color: "var(--t-muted)" }}>· {r.qty} und.</span></span>
              <DateField compact value={r.expires_on} onChange={(v) => setRows((c) => c.map((x, i) => (i === idx ? { ...x, expires_on: v } : x)))} ariaLabel={`Vence ${r.name}`} placeholder="Vence DD/MM/AAAA" />
              <input className={`${inputClass} w-28`} style={inputStyle} placeholder="Lote" value={r.lot} onChange={(e) => setRows((c) => c.map((x, i) => (i === idx ? { ...x, lot: e.target.value.toUpperCase() } : x)))} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>No vence nada</Btn>
          <Btn onClick={() => void save()} disabled={busy}>{busy ? "Guardando…" : "💾 Guardar vencimientos"}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Lot = { id: string; product_id: string; name: string; sku: string | null; image_url: string | null; point: string | null; lot: string | null; qty: number; expires_on: string; days: number; status: string; note: string | null; by: string | null };

export function ExpiryTab({ ctx, warehouses }: { ctx: ErpCtx; warehouses: Warehouse[] }) {
  const [days, setDays] = useState(60);
  const [data, setData] = useState<{ expired: number; soon: number; items: Lot[] } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ product_id: "", name: "", qty: 1, expires_on: "", lot: "", warehouse_id: ctx.pointId ?? "" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; sku: string | null }>>([]);

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_lots_list", { p_store: ctx.storeId, p_days: days, p_all: false }).then(({ data: r, error: e }) => {
      if (!alive) return;
      const v = r as ({ ok: boolean; error?: string } & NonNullable<typeof data>) | null;
      if (e || !v?.ok) { setError(missing(e, "erp_lots_list") ? "Falta ejecutar en Supabase la migración 20261226_inventario_opcional.sql." : v?.error ?? errorMessage(e)); setData(null); }
      else { setError(""); setData(v); }
    });
    return () => { alive = false; };
  }, [ctx.storeId, days, tick]);

  useEffect(() => {
    const term = q.trim().replace(/[,()*%\\"]/g, " ");
    if (term.length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => {
      void supabaseBrowser().from("products").select("id,name,sku").eq("store_id", ctx.storeId).or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`).limit(8)
        .then(({ data: r }) => setHits((r ?? []) as typeof hits));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, ctx.storeId]);

  async function close(l: Lot, status: "sold" | "removed" | "damaged") {
    const { data: r, error: e } = await supabaseBrowser().rpc("erp_lot_close", { p_lot: l.id, p_status: status, p_note: null });
    if (e || !(r as { ok?: boolean } | null)?.ok) return void toast("No se pudo", "error", errorMessage(e));
    setTick((n) => n + 1);
  }
  async function add() {
    if (!form.product_id || !form.expires_on) return void toast("Elige el producto y la fecha", "warning");
    const { data: r, error: e } = await supabaseBrowser().rpc("erp_lot_save", { p_store: ctx.storeId, p_items: [form], p_purchase: null });
    if (e || !(r as { ok?: boolean } | null)?.ok) return void toast("No se pudo guardar", "error", errorMessage(e));
    setAdding(false); setForm({ ...form, product_id: "", name: "", qty: 1, expires_on: "", lot: "" }); setQ("");
    setTick((n) => n + 1);
  }

  const active = useMemo(() => warehouses.filter((w) => w.active && (!ctx.pointId || w.id === ctx.pointId)), [warehouses, ctx.pointId]);
  const color = (d: number) => (d < 0 ? "#ef4444" : d <= 30 ? "#f59e0b" : "#10b981");
  return (
    <Panel title="📅 Vencimientos" subtitle="Opcional: lo que anotas al ingresar mercancía que vence. Te muestra lo vencido y lo que vence pronto para venderlo o retirarlo a tiempo.">
      <div className="flex flex-wrap items-center gap-2">
        {[30, 60, 180].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className="rounded-full border px-3 py-1.5 text-sm font-semibold" style={days === d ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>Próximos {d} días</button>)}
        <Btn variant="ghost" onClick={() => setAdding((v) => !v)}>➕ Anotar vencimiento</Btn>
        {data ? <span className="text-sm"><b style={{ color: "#ef4444" }}>{data.expired}</b> vencidos · <b style={{ color: "#f59e0b" }}>{data.soon}</b> en 30 días</span> : null}
      </div>
      {adding ? (
        <div className="mt-3 grid gap-2 rounded-2xl border p-3 sm:grid-cols-5" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="relative sm:col-span-2">
            <input className={inputClass} style={inputStyle} placeholder="Producto…" value={form.product_id ? form.name : q} onChange={(e) => { setForm({ ...form, product_id: "", name: "" }); setQ(e.target.value); }} />
            {hits.length && !form.product_id ? (
              <div className="absolute z-10 mt-1 w-full rounded-xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                {hits.map((h) => <button key={h.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[color:var(--t-card-bg)]" onClick={() => { setForm({ ...form, product_id: h.id, name: h.name }); setHits([]); }}>{h.name}{h.sku ? ` · ${h.sku}` : ""}</button>)}
              </div>
            ) : null}
          </div>
          <select className={inputClass} style={inputStyle} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} aria-label="Bodega">
            <option value="">Bodega…</option>{active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input type="number" min={0} className={inputClass} style={inputStyle} value={form.qty} onChange={(e) => setForm({ ...form, qty: Math.max(0, Number(e.target.value) || 0) })} aria-label="Unidades" />
          <DateField value={form.expires_on} onChange={(v) => setForm({ ...form, expires_on: v })} ariaLabel="Vence" placeholder="Vence DD/MM/AAAA" />
          <input className={`${inputClass} sm:col-span-2`} style={inputStyle} placeholder="Lote (opcional)" value={form.lot} onChange={(e) => setForm({ ...form, lot: e.target.value.toUpperCase() })} />
          <Btn onClick={() => void add()}>💾 Guardar</Btn>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-amber-500">⚠️ {error}</p> : null}
      <div className="mt-3 space-y-1.5">
        {data && !data.items.length ? <Empty icon="📅" title="Nada por vencer" text={`No hay productos que venzan en los próximos ${days} días. Anota la fecha al ingresar mercancía que vence.`} /> : null}
        {(data?.items ?? []).map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: `color-mix(in oklab, ${color(l.days)} 40%, var(--t-card-border))` }}>
            <Thumb src={l.image_url} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{l.name}</p>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{l.qty} und.{l.point ? ` · ${l.point}` : ""}{l.lot ? ` · lote ${l.lot}` : ""} · vence {new Date(`${l.expires_on}T12:00:00`).toLocaleDateString("es-CO")}</p>
            </div>
            <b className="text-sm" style={{ color: color(l.days) }}>{l.days < 0 ? `Venció hace ${-l.days} d` : l.days === 0 ? "Vence hoy" : `En ${l.days} d`}</b>
            <div className="flex gap-1">
              <Btn variant="ghost" onClick={() => void close(l, "sold")}>Vendido</Btn>
              <Btn variant="ghost" onClick={() => void close(l, "removed")}>Retirado</Btn>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
