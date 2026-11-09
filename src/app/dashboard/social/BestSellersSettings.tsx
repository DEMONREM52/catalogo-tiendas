"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Flame, Loader2, Pin, Save, Search, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";

/**
 * «Lo más vendido» en los catálogos: automático (por ventas, con fijados primero), a mano o apagado.
 * Título propio, días a contar e insignias en las tarjetas (20261308).
 */

type Mode = "auto" | "manual" | "off";
type Config = { mode: Mode; title: string | null; product_ids: string[]; days: number; show_badges: boolean };
type Lite = { id: string; name: string; image_url: string | null };

const MODES: Array<{ key: Mode; label: string; emoji: string; hint: string }> = [
  { key: "auto", label: "Automático", emoji: "🤖", hint: "Por lo que más se vende. Los que fijes salen primero." },
  { key: "manual", label: "A mano", emoji: "✋", hint: "Solo los productos que escojas, en tu orden." },
  { key: "off", label: "Apagado", emoji: "🚫", hint: "No se muestra en los catálogos." },
];
const toast = (title: string, icon: "success" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function BestSellersSettings() {
  const [store, setStore] = useState<{ id: string; slug: string } | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<Lite[]>([]);
  const [now, setNow] = useState<Lite[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Lite[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadPreview = useCallback(async (s: { id: string; slug: string }) => {
    const sb = supabaseBrowser();
    const { data } = await sb.rpc("store_public_best_sellers", { p_store: s.slug, p_limit: 12 });
    const ids = ((Array.isArray(data) ? data : (data as { ids?: string[] } | null)?.ids) ?? []).map(String);
    if (!ids.length) { setNow([]); return; }
    const { data: rows } = await sb.from("products").select("id,name,image_url").eq("store_id", s.id).in("id", ids);
    const byId = new Map(((rows ?? []) as Lite[]).map((r) => [r.id, r]));
    setNow(ids.map((id) => byId.get(id)).filter((x): x is Lite => Boolean(x)));
  }, []);

  useEffect(() => {
    void (async () => {
      const a = await getDashboardStore().catch(() => null);
      if (!a?.store) return;
      const s = { id: a.store.id, slug: a.store.slug };
      setStore(s);
      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("best_sellers_config_get", { p_store: s.id });
      if (error) { setMissing(/Could not find the function|schema cache|does not exist/i.test(error.message)); return; }
      const d = data as { ok?: boolean; config?: Config } | null;
      if (!d?.ok || !d.config) return;
      setCfg(d.config);
      if (d.config.product_ids.length) {
        const { data: rows } = await sb.from("products").select("id,name,image_url").eq("store_id", s.id).in("id", d.config.product_ids);
        const byId = new Map(((rows ?? []) as Lite[]).map((r) => [r.id, r]));
        setPicked(d.config.product_ids.map((id) => byId.get(id)).filter((x): x is Lite => Boolean(x)));
      }
      void loadPreview(s);
    })();
  }, [loadPreview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!store || q.trim().length < 2) { setFound([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabaseBrowser().from("products").select("id,name,image_url").eq("store_id", store.id).eq("active", true).ilike("name", `%${q.trim()}%`).order("name").limit(12);
      setFound((data ?? []) as Lite[]);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, store]);

  async function save() {
    if (!store || !cfg) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("best_sellers_config_save", {
      p_store: store.id, p_mode: cfg.mode, p_title: cfg.title, p_product_ids: picked.map((p) => p.id), p_days: cfg.days, p_show_badges: cfg.show_badges,
    });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se guardó", "error"); return; }
    toast("🔥 Guardado: así sale en tus catálogos");
    void loadPreview(store);
  }

  const move = (i: number, dir: -1 | 1) => setPicked((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;

  return (
    <section className="overflow-hidden rounded-3xl border" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))", background: "linear-gradient(135deg, color-mix(in oklab, #f59e0b 10%, var(--t-card-bg)), var(--t-card-bg))", color: "var(--t-text)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}><Flame size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-black">Lo más vendido en tus catálogos</span>
          <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
            {missing ? "Falta correr la migración 20261308." : !cfg ? "Cargando…" : `${MODES.find((m) => m.key === cfg.mode)?.emoji} ${MODES.find((m) => m.key === cfg.mode)?.label}${cfg.mode !== "off" && now ? ` · ${now.length} productos se están mostrando` : ""}`}
          </span>
        </span>
        <span className="text-sm font-bold" style={{ color: "var(--t-muted)" }}>{open ? "Cerrar" : "Configurar"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && cfg ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODES.map((m) => (
                    <button key={m.key} type="button" onClick={() => setCfg({ ...cfg, mode: m.key })} className="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                      style={cfg.mode === m.key ? { borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                      <p className="text-sm font-black">{m.emoji} {m.label}</p>
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{m.hint}</p>
                    </button>
                  ))}
                </div>
                {cfg.mode !== "off" ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-bold">Título de la sección
                        <input value={cfg.title ?? ""} maxLength={60} placeholder="Lo más vendido" onChange={(e) => setCfg({ ...cfg, title: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field} />
                      </label>
                      {cfg.mode === "auto" ? (
                        <label className="block text-xs font-bold">Contar ventas de los últimos
                          <select value={cfg.days} onChange={(e) => setCfg({ ...cfg, days: Number(e.target.value) })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field}>
                            {[7, 15, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} días</option>)}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                      <input type="checkbox" checked={cfg.show_badges} onChange={(e) => setCfg({ ...cfg, show_badges: e.target.checked })} /> Mostrar la insignia «🔥 Top ventas» en las tarjetas de esos productos
                    </label>
                    <div>
                      <p className="text-xs font-bold">{cfg.mode === "manual" ? "✋ Productos que se muestran (en este orden)" : "📌 Fijados primero (opcional)"}</p>
                      <label className="mt-1 flex items-center gap-2 rounded-xl border px-3" style={field}>
                        <Search size={14} style={{ color: "var(--t-muted)" }} />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto para agregar…" className="w-full bg-transparent py-2.5 text-sm outline-none" />
                      </label>
                      {found.length ? (
                        <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
                          {found.map((p) => {
                            const has = picked.some((x) => x.id === p.id);
                            return (
                              <li key={p.id}>
                                <button type="button" disabled={has || picked.length >= 30} onClick={() => { setPicked((l) => [...l, p]); setQ(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-40">
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
                              <button type="button" onClick={() => setPicked((l) => l.filter((x) => x.id !== p.id))} className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Quitar"><X size={12} /></button>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                        {!picked.length ? <li className="text-[11px]" style={{ color: "var(--t-muted)" }}>{cfg.mode === "manual" ? "Agrega al menos 3 productos para que se muestre la sección." : <><Pin size={11} className="inline" /> Sin fijados: todo sale por ventas.</>}</li> : null}
                      </ul>
                    </div>
                  </>
                ) : null}
                <button type="button" onClick={() => void save()} disabled={busy || missing} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar
                </button>
              </div>
              <aside className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-xs font-black">👀 Así sale ahora en tus catálogos</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Se ve si hay 3 o más. Los agotados no salen.</p>
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
