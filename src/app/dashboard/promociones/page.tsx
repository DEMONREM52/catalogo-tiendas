"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { DateField } from "@/components/forms/Fields";

/**
 * Promociones programadas y combos (20261228).
 * Las promociones se aplican solas en el POS mientras estén vigentes; los combos se agregan desde «🎁 Combos».
 */

type Promo = { id: string; name: string; kind: "pct" | "price"; value: number; scope: "all" | "category" | "product"; category_id: string | null; product_ids: string[]; point_ids: string[]; starts_at: string; ends_at: string; active: boolean; running: boolean };
type Combo = { id: string; name: string; sku: string | null; price: number; items: Array<{ product_id: string; name: string; qty: number }>; active: boolean; regular: number };
type Hit = { id: string; name: string; sku: string | null; price_3: number | null };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dmy = (v: string) => new Date(v).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
const missing = (e: { message: string } | null) => Boolean(e && /Could not find the function|schema cache/i.test(e.message));

function useProductSearch(storeId: string | null, q: string) {
  const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => {
    const term = q.trim().replace(/[,()*%\\"]/g, " ");
    if (!storeId || term.length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => {
      void supabaseBrowser().from("products").select("id,name,sku,price_3").eq("store_id", storeId).eq("active", true)
        .or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`).order("name").limit(10).then(({ data }) => setHits((data ?? []) as Hit[]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [storeId, q]);
  return hits;
}

export default function PromotionsPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [can, setCan] = useState<{ promo: boolean; combo: boolean } | null>(null);
  const [tab, setTab] = useState<"promos" | "combos">("promos");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [points, setPoints] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return setCan({ promo: false, combo: false });
      const has = (p: string) => hasStorePermission(access, p);
      const promo = has("products_prices") || has("profit_rules") || has("price_approve");
      setCan({ promo, combo: promo && has("products") });
      setStoreId(s.id);
      const sb = supabaseBrowser();
      const [c, w] = await Promise.all([
        sb.from("product_categories").select("id,name").eq("store_id", s.id).order("name"),
        sb.from("erp_warehouses").select("id,name").eq("store_id", s.id).eq("active", true).order("name"),
      ]);
      setCats((c.data ?? []) as typeof cats);
      setPoints((w.data ?? []) as typeof points);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    const sb = supabaseBrowser();
    const [p, c] = await Promise.all([sb.rpc("erp_promotions_list", { p_store: storeId, p_point: null, p_active_only: false }), sb.rpc("erp_combos_list", { p_store: storeId })]);
    if (missing(p.error)) return setError("Falta ejecutar en Supabase la migración 20261228_ventas_extra.sql.");
    const list = (Array.isArray(p.data) ? p.data : []) as Promo[];
    setPromos(list);
    setCombos((Array.isArray(c.data) ? c.data : []) as Combo[]);
    const ids = [...new Set(list.flatMap((x) => x.product_ids))];
    if (ids.length) {
      const { data } = await sb.from("products").select("id,name").in("id", ids.slice(0, 300));
      setNames(new Map(((data ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name])));
    }
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  if (can && !can.promo) return <main className="p-6"><p className="rounded-2xl border p-4 text-sm" style={card}>🔒 Necesitas «Cambiar precios», «Reglas de rentabilidad» o «Aprobar precios» para manejar promociones.</p></main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      <header>
        <h1 className="text-2xl font-black">🏷️ Promociones y combos</h1>
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>Las promociones se activan y se apagan solas en el POS. Los combos se venden desde «🎁 Combos» y cada producto descuenta su inventario.</p>
      </header>
      <nav className="flex w-fit gap-1 rounded-full border p-1 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
        {([["promos", "Promociones"], ["combos", "Combos"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="rounded-full px-4 py-2" style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>{l}</button>
        ))}
      </nav>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}
      {tab === "promos" && storeId ? <Promotions storeId={storeId} promos={promos} cats={cats} points={points} names={names} onChanged={load} /> : null}
      {tab === "combos" && storeId ? (can?.combo ? <Combos storeId={storeId} combos={combos} onChanged={load} /> : <p className="text-sm">🔒 Para crear combos necesitas también el permiso de Productos.</p>) : null}
    </main>
  );
}

function Promotions({ storeId, promos, cats, points, names, onChanged }: { storeId: string; promos: Promo[]; cats: Array<{ id: string; name: string }>; points: Array<{ id: string; name: string }>; names: Map<string, string>; onChanged: () => void }) {
  const empty = () => ({ id: "", name: "", kind: "pct" as "pct" | "price", value: "", scope: "product" as Promo["scope"], category_id: "", products: [] as Hit[], point_ids: [] as string[], from: iso(new Date()), to: iso(new Date(Date.now() + 2 * 86400000)) });
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const hits = useProductSearch(storeId, q);

  async function save() {
    const value = Number(String(form.value).replace(/[^\d.]/g, ""));
    if (form.name.trim().length < 2 || !(value > 0)) return void Swal.fire({ icon: "warning", title: "Ponle nombre y valor", ...swal });
    if (form.scope === "product" && !form.products.length) return void Swal.fire({ icon: "warning", title: "Agrega al menos un producto", ...swal });
    if (form.scope === "category" && !form.category_id) return void Swal.fire({ icon: "warning", title: "Elige la categoría", ...swal });
    const { data, error } = await supabaseBrowser().rpc("erp_promotion_save", { p_store: storeId, p: {
      id: form.id || null, name: form.name, kind: form.kind, value, scope: form.scope, category_id: form.category_id || null,
      product_ids: form.products.map((p) => p.id), point_ids: form.point_ids,
      starts_at: new Date(`${form.from}T00:00:00-05:00`).toISOString(), ends_at: new Date(`${form.to}T23:59:59-05:00`).toISOString(), active: true,
    } });
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: error?.message ?? r?.error, ...swal });
    setForm(empty()); setOpen(false); onChanged();
  }
  async function toggle(p: Promo) {
    await supabaseBrowser().rpc("erp_promotion_save", { p_store: storeId, p: { ...p, active: !p.active } });
    onChanged();
  }
  async function remove(p: Promo) {
    const go = await Swal.fire({ icon: "warning", title: `¿Borrar «${p.name}»?`, showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "No", ...swal });
    if (!go.isConfirmed) return;
    await supabaseBrowser().rpc("erp_promotion_delete", { p_id: p.id });
    onChanged();
  }
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>{open ? "Cerrar" : "➕ Nueva promoción"}</button>
      {open ? (
        <div className="grid gap-2 rounded-2xl border p-4 sm:grid-cols-2" style={card}>
          <input className={field} style={fs} placeholder="Nombre (ej. Fin de semana audio)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            <select className={field} style={fs} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "pct" | "price" })} aria-label="Tipo">
              <option value="pct">% de descuento</option><option value="price">Precio fijo</option>
            </select>
            <input className={field} style={fs} inputMode="numeric" placeholder={form.kind === "pct" ? "10" : "25000"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label="Valor" />
          </div>
          <select className={field} style={fs} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Promo["scope"] })} aria-label="Aplica a">
            <option value="product">Productos elegidos</option><option value="category">Una categoría</option><option value="all">Toda la tienda</option>
          </select>
          {form.scope === "category" ? (
            <select className={field} style={fs} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} aria-label="Categoría">
              <option value="">Categoría…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : form.scope === "product" ? (
            <div className="relative">
              <input className={field} style={fs} placeholder="Buscar producto para agregar…" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length ? (
                <div className="absolute z-10 mt-1 w-full rounded-xl border p-1 shadow-xl" style={{ ...fs, background: "var(--t-bg-base)" }}>
                  {hits.map((h) => <button key={h.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm" onClick={() => { if (!form.products.some((p) => p.id === h.id)) setForm({ ...form, products: [...form.products, h] }); setQ(""); }}>{h.name} <span style={{ color: "var(--t-muted)" }}>{money(Number(h.price_3))}</span></button>)}
                </div>
              ) : null}
            </div>
          ) : <span className="text-sm" style={{ color: "var(--t-muted)" }}>Aplica a todos los productos.</span>}
          {form.products.length ? (
            <div className="flex flex-wrap gap-1.5 sm:col-span-2">
              {form.products.map((p) => <span key={p.id} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--t-card-border)" }}>{p.name} <button type="button" onClick={() => setForm({ ...form, products: form.products.filter((x) => x.id !== p.id) })}>✕</button></span>)}
            </div>
          ) : null}
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Desde<DateField value={form.from} onChange={(v) => setForm({ ...form, from: v || form.from })} ariaLabel="Desde" /></label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Hasta (incluido)<DateField value={form.to} onChange={(v) => setForm({ ...form, to: v || form.to })} ariaLabel="Hasta" /></label>
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Puntos (ninguno marcado = todos)</p>
            <div className="flex flex-wrap gap-1.5">
              {points.map((p) => { const on = form.point_ids.includes(p.id); return <button key={p.id} type="button" onClick={() => setForm({ ...form, point_ids: on ? form.point_ids.filter((x) => x !== p.id) : [...form.point_ids, p.id] })} className="rounded-full border px-3 py-1 text-xs font-semibold" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{p.name}</button>; })}
            </div>
          </div>
          <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white sm:col-span-2" style={{ background: "var(--t-cta)" }}>💾 Guardar promoción</button>
        </div>
      ) : null}
      {!promos.length ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Aún no hay promociones. Crea una con fecha de inicio y fin: se aplica sola en el POS.</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {promos.map((p) => (
          <div key={p.id} className="rounded-2xl border p-3 text-sm" style={{ ...card, borderColor: p.running ? "color-mix(in oklab, #10b981 50%, var(--t-card-border))" : "var(--t-card-border)" }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b>{p.name}</b>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.kind === "pct" ? `${p.value} % de descuento` : `Precio fijo ${money(p.value)}`} · {dmy(p.starts_at)} → {dmy(p.ends_at)}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.scope === "all" ? "Toda la tienda" : p.scope === "category" ? `Categoría ${cats.find((c) => c.id === p.category_id)?.name ?? ""}` : p.product_ids.map((id) => names.get(id) ?? "producto").join(", ")}{p.point_ids.length ? ` · en ${p.point_ids.map((id) => points.find((x) => x.id === id)?.name).filter(Boolean).join(", ")}` : ""}</p>
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: p.running ? "rgba(16,185,129,.15)" : "rgba(148,163,184,.15)", color: p.running ? "#10b981" : "var(--t-muted)" }}>{p.running ? "Activa" : !p.active ? "Pausada" : new Date(p.ends_at) < new Date() ? "Terminó" : "Programada"}</span>
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" onClick={() => void toggle(p)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{p.active ? "⏸ Pausar" : "▶️ Reanudar"}</button>
              <button type="button" onClick={() => void remove(p)} className="rounded-lg px-2.5 py-1 font-semibold text-red-500">Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Combos({ storeId, combos, onChanged }: { storeId: string; combos: Combo[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [items, setItems] = useState<Array<Hit & { qty: number }>>([]);
  const [q, setQ] = useState("");
  const hits = useProductSearch(storeId, q);
  const regular = useMemo(() => items.reduce((s, i) => s + Number(i.price_3 ?? 0) * i.qty, 0), [items]);
  async function save() {
    const value = Number(price.replace(/\D/g, ""));
    if (name.trim().length < 2 || !(value > 0) || items.length < 2) return void Swal.fire({ icon: "warning", title: "Nombre, precio y al menos 2 productos", ...swal });
    const { data, error } = await supabaseBrowser().rpc("erp_combo_save", { p_store: storeId, p: { name, price: value, items: items.map((i) => ({ product_id: i.id, qty: i.qty })) } });
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: error?.message ?? r?.error, ...swal });
    setName(""); setPrice(""); setItems([]); onChanged();
  }
  async function toggle(c: Combo) {
    await supabaseBrowser().rpc("erp_combo_save", { p_store: storeId, p: { id: c.id, name: c.name, sku: c.sku, price: c.price, items: c.items, active: !c.active } });
    onChanged();
  }
  async function remove(c: Combo) {
    const go = await Swal.fire({ icon: "warning", title: `¿Borrar el combo «${c.name}»?`, showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "No", ...swal });
    if (!go.isConfirmed) return;
    await supabaseBrowser().rpc("erp_combo_delete", { p_id: c.id });
    onChanged();
  }
  return (
    <section className="space-y-3">
      <div className="space-y-2 rounded-2xl border p-4" style={card}>
        <p className="text-sm font-bold">➕ Nuevo combo</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={field} style={fs} placeholder="Nombre (ej. Cargador + cable)" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
          <input className={field} style={fs} placeholder="Precio del combo $" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")).toLocaleString("es-CO") : "")} />
        </div>
        <div className="relative">
          <input className={field} style={fs} placeholder="Buscar producto para el combo…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length ? (
            <div className="absolute z-10 mt-1 w-full rounded-xl border p-1 shadow-xl" style={{ ...fs, background: "var(--t-bg-base)" }}>
              {hits.map((h) => <button key={h.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm" onClick={() => { setItems((c) => (c.some((x) => x.id === h.id) ? c : [...c, { ...h, qty: 1 }])); setQ(""); }}>{h.name} <span style={{ color: "var(--t-muted)" }}>{money(Number(h.price_3))}</span></button>)}
            </div>
          ) : null}
        </div>
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{i.name} <span style={{ color: "var(--t-muted)" }}>{money(Number(i.price_3))}</span></span>
            <input type="number" min={1} className="w-20 rounded-lg border px-2 py-1 text-right" style={fs} value={i.qty} onChange={(e) => setItems((c) => c.map((x) => (x.id === i.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} aria-label="Cantidad" />
            <button type="button" onClick={() => setItems((c) => c.filter((x) => x.id !== i.id))} className="text-red-500">✕</button>
          </div>
        ))}
        {items.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Por separado: {money(regular)}{Number(price.replace(/\D/g, "")) ? ` · el cliente ahorra ${money(regular - Number(price.replace(/\D/g, "")))}` : ""}</p> : null}
        <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>💾 Guardar combo</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {combos.map((c) => (
          <div key={c.id} className="rounded-2xl border p-3 text-sm" style={{ ...card, opacity: c.active ? 1 : 0.6 }}>
            <p className="flex justify-between gap-2"><b>{c.name}</b><b>{money(c.price)}</b></p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>{c.items.map((i) => `${i.qty}× ${i.name}`).join(" + ")}{Number(c.regular) > Number(c.price) ? ` · ahorra ${money(Number(c.regular) - Number(c.price))}` : ""}</p>
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" onClick={() => void toggle(c)} className="rounded-lg border px-2.5 py-1 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>{c.active ? "⏸ Pausar" : "▶️ Activar"}</button>
              <button type="button" onClick={() => void remove(c)} className="rounded-lg px-2.5 py-1 font-semibold text-red-500">Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
