"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { BarChart3, Copy, Copy as Duplicate, ExternalLink, Megaphone, Pause, Pencil, Play, Plus, QrCode, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { storeShareUrl } from "@/lib/share/store-host";
import { QrDialog } from "@/components/pwa/QrDialog";
import { normalizeLanding } from "@/lib/landing/config";
import { Pill, errorText, money, softBox, swalTheme } from "../catalogs/ui";
import { LandingEditor, type CatalogOption, type LandingRow, type StoreInfo } from "./LandingEditor";
import { AdKit, LandingStats, LandingSummary, MetaConnect } from "./LandingTools";

type ListItem = {
  id: string; slug: string; name: string; status: LandingRow["status"]; catalog_id: string; catalog_slug: string | null; product_ids: string[]; image: string | null;
  updated_at: string; visits_7d: number; orders_7d: number; revenue_7d: number; leads_open: number; live: number; wa_7d: number; spend_7d: number;
};
type View = { kind: "list" } | { kind: "edit"; row: LandingRow | null } | { kind: "stats"; id: string } | { kind: "kit"; id: string };

const SUBDOMAINS = process.env.NEXT_PUBLIC_STORE_SUBDOMAINS === "1";

export default function LandingManager() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ kind: "list" });
  const [qr, setQr] = useState<ListItem | null>(null);
  const [configs, setConfigs] = useState<Record<string, LandingRow>>({});

  const url = useCallback((slug: string) => (store ? storeShareUrl(store.slug, `/oferta/${slug}`, SUBDOMAINS) : ""), [store]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const access = await getDashboardStore();
      if (!access.store) throw new Error("No se encontró la tienda de esta sesión.");
      const s = access.store;
      setStore({ id: s.id, slug: s.slug, name: s.name, logo_url: s.logo_url, whatsapp: s.whatsapp });
      setCanEdit(hasStorePermission(access, "products"));
      const sb = supabaseBrowser();
      const [cats, list] = await Promise.all([
        sb.from("store_catalogs").select("id,slug,name,access_key,active,point_id").eq("store_id", s.id).order("sort_order").order("created_at"),
        sb.rpc("erp_landing_list", { p_store: s.id }),
      ]);
      if (list.error) throw new Error(/Could not find the function|schema cache/i.test(list.error.message) ? "Falta ejecutar la migración 20261252_landing_pages.sql en Supabase." : list.error.message);
      const r = list.data as { ok: boolean; items?: ListItem[]; message?: string };
      if (!r.ok) throw new Error(r.message ?? "Sin permiso.");
      const { data: wh } = await sb.from("erp_warehouses").select("id,name").eq("store_id", s.id);
      const pn = new Map(((wh ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
      setCatalogs(((cats.data ?? []) as CatalogOption[]).map((c) => ({ ...c, point_name: c.point_id ? pn.get(c.point_id) ?? null : null })));
      setItems(r.items ?? []);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function getRow(id: string): Promise<LandingRow | null> {
    if (configs[id]) return configs[id];
    const { data } = await supabaseBrowser().rpc("erp_landing_get", { p_store: store!.id, p_id: id });
    const r = data as { ok: boolean; page?: LandingRow & { config: unknown } };
    if (!r?.ok || !r.page) return null;
    const row: LandingRow = { id: r.page.id, name: r.page.name, slug: r.page.slug, status: r.page.status, catalog_id: r.page.catalog_id, product_ids: r.page.product_ids, config: normalizeLanding(r.page.config) };
    setConfigs((c) => ({ ...c, [id]: row }));
    return row;
  }

  async function edit(id: string | null) {
    if (!id) { setView({ kind: "edit", row: null }); return; }
    const row = await getRow(id);
    if (row) setView({ kind: "edit", row });
  }

  async function act(it: ListItem, action: "pause" | "publish" | "duplicate" | "delete") {
    const sb = supabaseBrowser();
    if (action === "delete") {
      const ok = await Swal.fire({ icon: "warning", title: `¿Quitar «${it.name}»?`, text: "Si ya tuvo pedidos, se archiva (los pedidos se conservan). Si no, se borra.", showCancelButton: true, confirmButtonText: "Sí, quitar", cancelButtonText: "Cancelar", ...swalTheme });
      if (!ok.isConfirmed) return;
    }
    const call = action === "duplicate" ? sb.rpc("erp_landing_duplicate", { p_store: store!.id, p_id: it.id })
      : action === "delete" ? sb.rpc("erp_landing_delete", { p_store: store!.id, p_id: it.id })
      : sb.rpc("erp_landing_set_status", { p_store: store!.id, p_id: it.id, p_status: action === "pause" ? "paused" : "published" });
    const { data, error } = await call;
    if (error || !(data as { ok?: boolean })?.ok) { void Swal.fire({ icon: "error", title: "No se pudo", text: error?.message ?? (data as { message?: string })?.message, ...swalTheme }); return; }
    setConfigs((c) => { const n = { ...c }; delete n[it.id]; return n; });
    await load();
  }

  async function copyLink(it: ListItem) {
    try { await navigator.clipboard.writeText(url(it.slug)); void Swal.fire({ icon: "success", title: "Enlace copiado", timer: 1100, showConfirmButton: false, ...swalTheme }); } catch { window.prompt("Copia el enlace:", url(it.slug)); }
  }

  if (loading && !store) return <p className="py-10 text-center text-sm" style={{ color: "var(--t-muted)" }}>Cargando landings…</p>;
  if (error) return <div className="rounded-3xl border p-5 text-sm" style={softBox}>⚠️ {error}</div>;
  if (!store) return null;

  if (view.kind === "edit") {
    return <LandingEditor store={store} catalogs={catalogs} initial={view.row} publicUrl={url} onClose={() => { setView({ kind: "list" }); void load(); }}
      onSaved={(id) => { setConfigs((c) => { const n = { ...c }; delete n[id]; return n; }); }} />;
  }
  if (view.kind === "stats" || view.kind === "kit") {
    const it = items.find((x) => x.id === view.id);
    const row = configs[view.id];
    if (!it || !row) return null;
    return view.kind === "stats"
      ? <LandingStats storeId={store.id} page={{ id: it.id, name: it.name }} config={row.config} url={url(it.slug)} onBack={() => setView({ kind: "list" })} />
      : <KitLoader store={store} row={row} url={url(it.slug)} onBack={() => setView({ kind: "list" })} />;
  }

  const live = items.reduce((s, i) => s + i.live, 0);
  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl p-5 text-white sm:p-7" style={{ background: "linear-gradient(135deg, #e11d48, #9333ea 55%, #2563eb)" }}>
        <div className="relative z-10 max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] opacity-80">Landing pages · para pauta</p>
          <h2 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">Una página por producto, hecha para vender 🚀</h2>
          <p className="mt-2 text-sm opacity-90">Sin menú ni catálogo: solo ese producto, con paquetes 2x y 3x, pago contraentrega, en línea o a cuotas, urgencia real, adicional de último momento, píxel de Meta y TikTok, y estadísticas de qué mejorar.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canEdit ? <button type="button" onClick={() => void edit(null)} disabled={!catalogs.length} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-black text-slate-900 shadow-lg disabled:opacity-60"><Plus size={16} /> Nueva landing</button> : null}
            {live ? <span className="inline-flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-sm font-bold"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> {live} personas viendo tus landings ahora</span> : null}
          </div>
          {!catalogs.length ? <p className="mt-3 text-xs font-semibold">Primero crea un catálogo (pestaña Catálogos): de ahí salen el precio y las existencias.</p> : null}
        </div>
        <div className="pointer-events-none absolute -right-10 -top-10 text-[160px] opacity-15">🛍️</div>
      </section>

      {items.length ? <LandingSummary storeId={store.id} onOpen={async (id) => { if (await getRow(id)) setView({ kind: "stats", id }); }} /> : null}

      {items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <article key={it.id} className="overflow-hidden rounded-3xl border" style={{ ...softBox, opacity: it.status === "archived" ? 0.6 : 1 }}>
              <div className="flex gap-3 p-4">
                {it.image ? <img src={it.image} alt="" className="h-20 w-16 shrink-0 rounded-2xl object-cover" /> : <span className="grid h-20 w-16 shrink-0 place-items-center rounded-2xl text-3xl" style={softBox}>🛍️</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {it.status === "published" ? <Pill tone="good">● Publicada</Pill> : it.status === "paused" ? <Pill tone="warn">Pausada</Pill> : it.status === "archived" ? <Pill>Archivada</Pill> : <Pill>Borrador</Pill>}
                    {it.live ? <Pill tone="danger">👀 {it.live} ahora</Pill> : null}
                  </div>
                  <h3 className="mt-1 truncate font-black">{it.name}</h3>
                  <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>/oferta/{it.slug} · {it.product_ids.length} {it.product_ids.length === 1 ? "opción" : "opciones"}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 border-t text-center" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="p-2"><p className="text-[10px] uppercase" style={{ color: "var(--t-muted)" }}>Visitas 7d</p><p className="font-black">{it.visits_7d}</p></div>
                <div className="border-x p-2" style={{ borderColor: "var(--t-card-border)" }}><p className="text-[10px] uppercase" style={{ color: "var(--t-muted)" }}>Pedidos 7d</p><p className="font-black">{it.orders_7d}</p></div>
                <div className="p-2"><p className="text-[10px] uppercase" style={{ color: "var(--t-muted)" }}>Ventas 7d</p><p className="font-black">{money(it.revenue_7d)}</p></div>
              </div>
              <p className="border-t px-4 py-1.5 text-[11px]" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>💬 {it.wa_7d} escribieron por WhatsApp · 📣 pauta {money(it.spend_7d)} (7 días)</p>
              {it.leads_open ? <p className="border-t px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, #16a34a 10%, transparent)" }}>📲 {it.leads_open} {it.leads_open === 1 ? "cliente" : "clientes"} por recuperar</p> : null}
              <div className="flex flex-wrap gap-1.5 border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
                {canEdit ? <Btn onClick={() => void edit(it.id)} icon={<Pencil size={13} />}>Editar</Btn> : null}
                <Btn onClick={async () => { if (await getRow(it.id)) setView({ kind: "stats", id: it.id }); }} icon={<BarChart3 size={13} />}>Estadísticas</Btn>
                <Btn onClick={async () => { if (await getRow(it.id)) setView({ kind: "kit", id: it.id }); }} icon={<Megaphone size={13} />}>Kit de pauta</Btn>
                <Btn onClick={() => void copyLink(it)} icon={<Copy size={13} />}>Enlace</Btn>
                <Btn onClick={() => setQr(it)} icon={<QrCode size={13} />}>QR</Btn>
                <a href={url(it.slug)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold" style={softBox}><ExternalLink size={13} /> Ver</a>
                {canEdit ? (
                  <>
                    {it.status === "published" ? <Btn onClick={() => void act(it, "pause")} icon={<Pause size={13} />}>Pausar</Btn> : <Btn onClick={() => void act(it, "publish")} icon={<Play size={13} />}>Publicar</Btn>}
                    <Btn onClick={() => void act(it, "duplicate")} icon={<Duplicate size={13} />}>Duplicar</Btn>
                    <Btn onClick={() => void act(it, "delete")} icon={<Trash2 size={13} />} danger>Quitar</Btn>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border p-8 text-center" style={softBox}>
          <p className="text-4xl">✨</p>
          <p className="mt-2 font-bold">Aún no tienes landings</p>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Crea la primera con una plantilla: en 5 minutos queda lista para tus anuncios.</p>
        </div>
      )}

      <MetaConnect storeId={store.id} />
      <QrDialog open={Boolean(qr)} onClose={() => setQr(null)} path={qr ? url(qr.slug) : ""} title={qr?.name ?? ""} subtitle="Escanea para ver la oferta" />
    </div>
  );
}

function Btn({ onClick, icon, children, danger }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${danger ? "text-red-500" : ""}`} style={softBox}>{icon} {children}</button>;
}

/** El kit necesita el precio real del catálogo para los textos. */
function KitLoader({ store, row, url, onBack }: { store: StoreInfo; row: LandingRow; url: string; onBack: () => void }) {
  // El precio de los textos es el mismo de la página: el propio de la landing y, si no tiene, el del catálogo.
  const own = (row.product_ids[0] && row.config.option_prices[row.product_ids[0]]) || row.config.sale_price || null;
  const [catalogPrice, setPrice] = useState<number | null>(null);
  const price = own ?? catalogPrice;
  useEffect(() => {
    if (own) return;
    void (async () => {
      const sb = supabaseBrowser();
      const { data: cat } = await sb.from("store_catalogs").select("slug,access_key").eq("id", row.catalog_id).maybeSingle();
      if (!cat || !row.product_ids[0]) return;
      const { data } = await sb.rpc("catalog_public_stock", { p_store: store.slug, p_catalog: (cat as { slug: string }).slug, p_key: (cat as { access_key: string | null }).access_key, p_ids: [row.product_ids[0]] });
      const p = Number((data as Array<{ price: number | null }> | null)?.[0]?.price);
      if (p > 0) setPrice(p);
    })();
  }, [store.slug, row.catalog_id, row.product_ids, own]);
  return <AdKit page={{ name: row.name, slug: row.slug }} config={row.config} url={url} price={price} onBack={onBack} />;
}
