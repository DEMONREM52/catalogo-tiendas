"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { ArrowDown, ArrowUp, Flame, Loader2, Pin, RotateCcw, Save, Search, Sparkles, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { EmojiPicker } from "@/components/products/EmojiPicker";

/**
 * «Lo más vendido» en los catálogos (20261308 / 20261311):
 *   · General: la base para todos (y en qué catálogos sale).
 *   · Cada catálogo puede tener la suya, independiente: modo, productos, título, emoji, cantidad, días, insignias.
 *   · En automático, un catálogo con punto cuenta las ventas de ese punto. Los precios son los de cada catálogo.
 */

type Mode = "auto" | "manual" | "off";
type Config = { mode: Mode; title: string | null; product_ids: string[]; days: number; show_badges: boolean; catalog_slugs?: string[]; max_items?: number; subtitle?: string | null; icon?: string | null };
type Lite = { id: string; name: string; image_url: string | null };
type CatalogLite = { slug: string; name: string; point_id: string | null };

const MODES: Array<{ key: Mode; label: string; emoji: string; hint: string }> = [
  { key: "auto", label: "Automático", emoji: "🤖", hint: "Por lo que más se vende. Los que fijes salen primero." },
  { key: "manual", label: "A mano", emoji: "✋", hint: "Solo los productos que escojas, en tu orden." },
  { key: "off", label: "Apagado", emoji: "🚫", hint: "No se muestra." },
];
const DEFAULT: Config = { mode: "auto", title: null, product_ids: [], days: 60, show_badges: true, catalog_slugs: [], max_items: 12, subtitle: null, icon: null };
const missingFn = (m: string) => /Could not find the function|schema cache|does not exist/i.test(m);
const toast = (title: string, icon: "success" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function BestSellersSettings() {
  const [store, setStore] = useState<{ id: string; slug: string } | null>(null);
  const [general, setGeneral] = useState<Config | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Config>>({});
  const [catalogs, setCatalogs] = useState<CatalogLite[]>([]);
  const [tab, setTab] = useState("");
  const [names, setNames] = useState<Map<string, Lite>>(new Map());
  const [missing, setMissing] = useState(false);
  const [noPerCatalog, setNoPerCatalog] = useState(false);
  const [now, setNow] = useState<Lite[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Lite[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState(false);

  const loadNames = useCallback(async (storeId: string, ids: string[]) => {
    const want = [...new Set(ids)];
    if (!want.length) return;
    const { data } = await supabaseBrowser().from("products").select("id,name,image_url").eq("store_id", storeId).in("id", want);
    setNames((m) => { const n = new Map(m); for (const r of (data ?? []) as Lite[]) n.set(r.id, r); return n; });
  }, []);

  const loadPreview = useCallback(async (s: { id: string; slug: string }, cat: string) => {
    const sb = supabaseBrowser();
    let res = await sb.rpc("store_public_best_sellers", { p_store: s.slug, p_limit: 30, p_catalog: cat || null });
    if (res.error && missingFn(res.error.message)) res = await sb.rpc("store_public_best_sellers", { p_store: s.slug, p_limit: 30 });
    const d = res.data;
    const ids = ((Array.isArray(d) ? d : (d as { ids?: string[] } | null)?.ids) ?? []).map(String);
    if (!ids.length) { setNow([]); return; }
    const { data: rows } = await sb.from("products").select("id,name,image_url").eq("store_id", s.id).in("id", ids);
    const byId = new Map(((rows ?? []) as Lite[]).map((r) => [r.id, r]));
    setNow(ids.map((id) => byId.get(id)).filter((x): x is Lite => Boolean(x)));
  }, []);

  function apply(d: { config?: Config; catalogs?: Record<string, Config> }) {
    if (d.config) setGeneral({ ...DEFAULT, ...d.config });
    if (d.catalogs) setOverrides(Object.fromEntries(Object.entries(d.catalogs).map(([k, v]) => [k, { ...DEFAULT, ...v }])));
  }

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return;
      const s = { id: a.store.id, slug: a.store.slug };
      setStore(s);
      const sb = supabaseBrowser();
      const [{ data, error }, cats] = await Promise.all([
        sb.rpc("best_sellers_config_get", { p_store: s.id }),
        sb.from("store_catalogs").select("slug,name,active,point_id").eq("store_id", s.id).order("sort_order"),
      ]);
      setCatalogs(((cats.data ?? []) as Array<CatalogLite & { active?: boolean | null }>).filter((c) => c.slug && c.active !== false));
      if (error) { setMissing(missingFn(error.message)); return; }
      const d = data as { ok?: boolean; config?: Config; catalogs?: Record<string, Config> } | null;
      if (!d?.ok) return;
      if (!d.catalogs) setNoPerCatalog(true);
      apply(d);
      void loadNames(s.id, [...(d.config?.product_ids ?? []), ...Object.values(d.catalogs ?? {}).flatMap((c) => c.product_ids ?? [])]);
      void loadPreview(s, "");
    })();
  }, [loadNames, loadPreview]);

  useEffect(() => {
    if (!store || q.trim().length < 2) return;
    const t = window.setTimeout(async () => {
      const { data } = await supabaseBrowser().from("products").select("id,name,image_url").eq("store_id", store.id).eq("active", true).ilike("name", `%${q.trim()}%`).order("name").limit(12);
      setFound((data ?? []) as Lite[]);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, store]);

  const current: Config | null = tab ? overrides[tab] ?? null : general;
  const usingGeneral = Boolean(tab && !overrides[tab]);
  const picked = useMemo(() => (current?.product_ids ?? []).map((id) => names.get(id) ?? { id, name: "…", image_url: null }), [current, names]);
  const setCurrent = (patch: Partial<Config>) => {
    if (tab) setOverrides((o) => ({ ...o, [tab]: { ...(o[tab] ?? DEFAULT), ...patch } }));
    else setGeneral((g) => ({ ...(g ?? DEFAULT), ...patch }));
  };

  function chooseTab(next: string) {
    setTab(next); setQ(""); setFound([]); setEmoji(false);
    if (store) void loadPreview(store, next);
  }

  async function save() {
    if (!store || !current) return;
    setBusy(true);
    const sb = supabaseBrowser();
    let data: unknown = null;
    let error: { message: string } | null = null;
    if (!tab) {
      const base = { p_store: store.id, p_mode: current.mode, p_title: current.title, p_product_ids: current.product_ids, p_days: current.days, p_show_badges: current.show_badges };
      ({ data, error } = await sb.rpc("best_sellers_config_save", { ...base, p_catalog_slugs: current.catalog_slugs ?? [], p_max_items: current.max_items ?? 12, p_subtitle: current.subtitle ?? null, p_icon: current.icon ?? null }));
      if (error && missingFn(error.message)) {
        ({ data, error } = await sb.rpc("best_sellers_config_save", base));
        if (!error) toast("Guardado. Para catálogos, cantidad, subtítulo, emoji y por catálogo corre la migración 20261311.", "error");
      }
    } else {
      ({ data, error } = await sb.rpc("best_sellers_catalog_save", {
        p_store: store.id, p_catalog: tab, p_mode: current.mode, p_title: current.title, p_product_ids: current.product_ids, p_days: current.days,
        p_show_badges: current.show_badges, p_max_items: current.max_items ?? 12, p_subtitle: current.subtitle ?? null, p_icon: current.icon ?? null,
      }));
      if (error && missingFn(error.message)) error = { message: "Para configurar cada catálogo aparte corre la migración 20261311." };
    }
    setBusy(false);
    const d = data as { ok?: boolean; message?: string; config?: Config; catalogs?: Record<string, Config> } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se guardó", "error"); return; }
    apply(d);
    toast(tab ? `🔥 Guardado para «${catalogs.find((c) => c.slug === tab)?.name ?? tab}»` : "🔥 Guardado: así sale en tus catálogos");
    void loadPreview(store, tab);
  }

  async function reset() {
    if (!store || !tab || !overrides[tab]) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("best_sellers_catalog_reset", { p_store: store.id, p_catalog: tab });
    setBusy(false);
    const d = data as { ok?: boolean; config?: Config; catalogs?: Record<string, Config> } | null;
    if (error || !d?.ok) {
      // Aún sin guardar: solo se descarta lo que se estaba armando.
      setOverrides((o) => { const n = { ...o }; delete n[tab]; return n; });
      return;
    }
    setOverrides({});
    apply(d);
    toast("Este catálogo vuelve a usar la configuración general");
    void loadPreview(store, tab);
  }

  const move = (i: number, dir: -1 | 1) => {
    const ids = [...(current?.product_ids ?? [])];
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setCurrent({ product_ids: ids });
  };
  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  const ownCount = Object.keys(overrides).length;
  const tabName = tab ? catalogs.find((c) => c.slug === tab)?.name ?? tab : "General";
  const tabPoint = tab ? catalogs.find((c) => c.slug === tab)?.point_id : null;

  return (
    <section className="overflow-hidden rounded-3xl border" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: "linear-gradient(135deg, color-mix(in oklab, #f59e0b 10%, var(--t-card-bg)), var(--t-card-bg))", color: "var(--t-text)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}><Flame size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-black">Lo más vendido en tus catálogos</span>
          <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
            {missing ? "Falta correr la migración 20261308." : !general ? "Cargando…" : `${MODES.find((m) => m.key === general.mode)?.emoji} General: ${MODES.find((m) => m.key === general.mode)?.label}${ownCount ? ` · ${ownCount} catálogo${ownCount === 1 ? "" : "s"} con la suya` : ""}`}
          </span>
        </span>
        <span className="text-sm font-bold" style={{ color: "var(--t-muted)" }}>{open ? "Cerrar" : "Configurar"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && general ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
            {/* Pestañas: General + cada catálogo */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
              {[{ slug: "", name: "🌐 General", point_id: null }, ...catalogs].map((c) => {
                const on = tab === c.slug;
                const own = c.slug && overrides[c.slug];
                return (
                  <button key={c.slug || "general"} type="button" onClick={() => chooseTab(c.slug)} disabled={Boolean(c.slug) && noPerCatalog}
                    className="relative shrink-0 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-40"
                    style={on ? { borderColor: "#f59e0b", background: "#f59e0b", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                    {c.name}{own ? <span className="ml-1 rounded-full bg-white/80 px-1.5 text-[10px] text-amber-700">propia</span> : null}
                  </button>
                );
              })}
            </div>
            {noPerCatalog ? <p className="px-4 pt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Para configurar cada catálogo aparte corre la migración 20261311.</p> : null}

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                {usingGeneral ? (
                  <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="font-black">«{tabName}» usa la configuración general.</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                      {(general.catalog_slugs ?? []).length && !(general.catalog_slugs ?? []).includes(tab) ? "Con la general NO se muestra aquí (no está escogido)." : "Muestra lo mismo que la general"}{tabPoint ? ", contando las ventas de su punto." : "."}
                    </p>
                    <button type="button" onClick={() => setOverrides((o) => ({ ...o, [tab]: { ...general, catalog_slugs: [] } }))}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
                      <Sparkles size={15} /> Personalizar este catálogo
                    </button>
                  </div>
                ) : current ? (
                  <>
                    {tab ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "color-mix(in oklab, #f59e0b 12%, transparent)" }}>
                        <span>✨ <b>{tabName}</b> tiene su propia configuración{tabPoint ? " (en automático cuenta las ventas de su punto)" : ""}.</span>
                        <button type="button" onClick={() => void reset()} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-bold" style={{ borderColor: "var(--t-card-border)" }}><RotateCcw size={12} /> Usar la general</button>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-3">
                      {MODES.map((m) => (
                        <button key={m.key} type="button" onClick={() => setCurrent({ mode: m.key })} className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                          style={current.mode === m.key ? { borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                          <p className="text-sm font-black">{m.emoji} {m.label}</p>
                          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{m.hint}</p>
                        </button>
                      ))}
                    </div>
                    {current.mode !== "off" ? (
                      <>
                        {!tab ? (
                          <div>
                            <p className="text-xs font-bold">🛍️ ¿En qué catálogos se muestra la general?</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <button type="button" onClick={() => setCurrent({ catalog_slugs: [] })} className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
                                style={!(current.catalog_slugs ?? []).length ? { borderColor: "#f59e0b", background: "#f59e0b", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>✅ En todos</button>
                              {catalogs.map((c) => {
                                const on = (current.catalog_slugs ?? []).includes(c.slug);
                                return (
                                  <button key={c.slug} type="button" className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
                                    onClick={() => setCurrent({ catalog_slugs: on ? (current.catalog_slugs ?? []).filter((x) => x !== c.slug) : [...(current.catalog_slugs ?? []), c.slug] })}
                                    style={on ? { borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 20%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                                    {on ? "✓ " : ""}{c.name}{overrides[c.slug] ? " (propia)" : ""}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Los catálogos con configuración propia usan la suya. Los precios siempre son los de cada catálogo.</p>
                          </div>
                        ) : null}
                        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                          <div>
                            <p className="text-xs font-bold">Emoji</p>
                            <button type="button" onClick={() => setEmoji((x) => !x)} className="mt-1 grid h-11 w-14 place-items-center rounded-xl border text-2xl" style={field} aria-label="Escoger emoji del título">{current.icon || "🔥"}</button>
                            {current.icon ? <button type="button" onClick={() => setCurrent({ icon: null })} className="mt-1 block text-[10px] underline" style={{ color: "var(--t-muted)" }}>Quitar</button> : null}
                          </div>
                          <label className="block text-xs font-bold">Título
                            <input value={current.title ?? ""} maxLength={60} placeholder="Lo más vendido" onChange={(e) => setCurrent({ title: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field} />
                          </label>
                          <label className="block text-xs font-bold">Subtítulo (opcional)
                            <input value={current.subtitle ?? ""} maxLength={80} placeholder="Lo que todos están llevando" onChange={(e) => setCurrent({ subtitle: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field} />
                          </label>
                        </div>
                        {emoji ? <EmojiPicker onPick={(e) => { setCurrent({ icon: e }); setEmoji(false); }} onClose={() => setEmoji(false)} /> : null}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs font-bold">Cuántos mostrar
                            <select value={current.max_items ?? 12} onChange={(e) => setCurrent({ max_items: Number(e.target.value) })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field}>
                              {[3, 4, 6, 8, 10, 12, 16, 20, 30].map((n) => <option key={n} value={n}>{n} productos</option>)}
                            </select>
                          </label>
                          {current.mode === "auto" ? (
                            <label className="block text-xs font-bold">Contar ventas de los últimos
                              <select value={current.days} onChange={(e) => setCurrent({ days: Number(e.target.value) })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field}>
                                {[7, 15, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} días</option>)}
                              </select>
                            </label>
                          ) : null}
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                          <input type="checkbox" checked={current.show_badges} onChange={(e) => setCurrent({ show_badges: e.target.checked })} /> Mostrar la insignia «🔥 Top ventas» en las tarjetas de esos productos
                        </label>
                        <div>
                          <p className="text-xs font-bold">{current.mode === "manual" ? "✋ Productos que se muestran (en este orden)" : "📌 Fijados primero (opcional)"}</p>
                          <label className="mt-1 flex items-center gap-2 rounded-xl border px-3" style={field}>
                            <Search size={14} style={{ color: "var(--t-muted)" }} />
                            <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setFound([]); }} placeholder="Buscar producto para agregar…" className="w-full bg-transparent py-2.5 text-sm outline-none" />
                          </label>
                          {found.length ? (
                            <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
                              {found.map((p) => {
                                const has = current.product_ids.includes(p.id);
                                return (
                                  <li key={p.id}>
                                    <button type="button" disabled={has || current.product_ids.length >= 30}
                                      onClick={() => { setNames((m) => new Map(m).set(p.id, p)); setCurrent({ product_ids: [...current.product_ids, p.id] }); setQ(""); setFound([]); }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-40">
                                      {p.image_url ? <img src={p.image_url} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="grid h-8 w-8 place-items-center">📦</span>}
                                      <span className="truncate">{p.name}</span>{has ? <span className="ml-auto text-[11px]">✓</span> : null}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                          <ul className="mt-2 space-y-1.5">
                            <AnimatePresence initial={false}>
                              {picked.map((p, i) => (
                                <motion.li key={p.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-xl border p-1.5" style={{ borderColor: "var(--t-card-border)" }}>
                                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: i === 0 ? "linear-gradient(135deg,#f59e0b,#ef4444)" : "#64748b" }}>{i + 1}</span>
                                  {p.image_url ? <img src={p.image_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : null}
                                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{p.name}</span>
                                  <button type="button" onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Subir"><ArrowUp size={12} /></button>
                                  <button type="button" onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Bajar"><ArrowDown size={12} /></button>
                                  <button type="button" onClick={() => setCurrent({ product_ids: current.product_ids.filter((x) => x !== p.id) })} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Quitar"><X size={12} /></button>
                                </motion.li>
                              ))}
                            </AnimatePresence>
                            {!picked.length ? <li className="text-[11px]" style={{ color: "var(--t-muted)" }}>{current.mode === "manual" ? "Agrega al menos 3 productos para que se muestre la sección." : <><Pin size={11} className="inline" /> Sin fijados: todo sale por ventas.</>}</li> : null}
                          </ul>
                        </div>
                      </>
                    ) : null}
                    <button type="button" onClick={() => void save()} disabled={busy || missing} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar {tab ? `para «${tabName}»` : "general"}
                    </button>
                  </>
                ) : null}
              </div>
              <aside className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-xs font-black">👀 Así sale ahora {tab ? `en «${tabName}»` : "(general)"}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Se ve si hay 3 o más. Los agotados no salen. Precio de cada catálogo.</p>
                {now === null ? <p className="mt-2 text-[11px]"><Loader2 size={12} className="inline animate-spin" /></p> : now.length === 0 ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Nada todavía.</p> : (
                  <ol className="mt-2 grid grid-cols-3 gap-1.5">
                    {now.map((p, i) => (
                      <li key={p.id} className="relative overflow-hidden rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} title={p.name}>
                        {p.image_url ? <img src={p.image_url} alt="" className="aspect-square w-full object-cover" /> : <span className="grid aspect-square place-items-center">📦</span>}
                        <span className="absolute left-1 top-1 rounded-full bg-black/70 px-1.5 text-[10px] font-black text-white">#{i + 1}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </aside>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
