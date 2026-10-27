"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Swal from "sweetalert2";
import { ArrowDown, ArrowLeft, ArrowUp, Eye, ImagePlus, Laptop, Maximize2, Minimize2, Monitor, Plus, Rocket, Save, Search, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { fiscalApi } from "@/lib/fiscal/client";
import type { ImportedProduct } from "@/lib/landing/import";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IMAGE_CACHE_SECONDS, prepareImage } from "@/lib/image-prepare";
import { DateField } from "@/components/forms/Fields";
import { EMPTY_PRODUCT_DETAILS } from "@/lib/product-details";
import { catalogSlug } from "@/lib/catalogs";
import { SOLD_WINDOWS, VIEWERS_WINDOWS, type SoldWindow, type ViewersWindow, DEFAULT_LANDING, LANDING_FONTS, LANDING_SLUG, SECTION_NAMES, normalizeLanding, optionDims, type LandingConfig, type LandingFont } from "@/lib/landing/config";
import { LANDING_TEMPLATES, applyTemplate } from "@/lib/landing/templates";
import type { LandingData, LandingItem } from "@/app/[slug]/oferta/[page]/LandingView";
import { Field, Pill, Switch, errorText, inputCls, inputStyle, softBox, swalTheme } from "../catalogs/ui";

export type CatalogOption = { id: string; slug: string; name: string; access_key: string | null; active: boolean; point_id: string | null; point_name?: string | null };
export type StoreInfo = { id: string; slug: string; name: string; logo_url: string | null; whatsapp: string | null };
export type LandingRow = { id?: string; name: string; slug: string; status: "draft" | "published" | "paused" | "archived"; catalog_id: string; product_ids: string[]; config: LandingConfig };
type ProductHit = { id: string; name: string; image_url: string | null; sku: string | null; stock: number | null };

const ACCENTS = ["#e11d48", "#db2777", "#9333ea", "#2563eb", "#0891b2", "#16a34a", "#ea580c", "#ca8a04", "#0f172a", "#b45309"];
const bogotaLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) - 5 * 3600_000).toISOString().slice(0, 16) : "");
const fromBogota = (local: string) => (local ? `${local.length === 10 ? `${local}T23:59` : local}:00-05:00` : null);

async function uploadImage(file: File): Promise<string> {
  const sb = supabaseBrowser();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("Tu sesión terminó.");
  const prepared = await prepareImage(file);
  if (prepared.blob.size > 2 * 1024 * 1024) throw new Error("La imagen pesa más de 2 MB. Prueba con otra.");
  const path = `${auth.user.id}/landing/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${prepared.ext}`;
  const { error } = await sb.storage.from("product-images").upload(path, prepared.blob, { upsert: true, cacheControl: IMAGE_CACHE_SECONDS, contentType: prepared.contentType });
  if (error) throw error;
  return sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

function Block({ title, emoji, hint, children, open = false }: { title: string; emoji: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-3xl border" style={softBox}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>{emoji}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{title}</span>{hint ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}</span>
        <span className="text-lg transition group-open:rotate-180" style={{ color: "var(--t-muted)" }}>⌄</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={softBox}>
      <div className="min-w-0"><p className="text-sm font-semibold">{label}</p>{hint ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}</div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Num({ value, onChange, min = 0, max = 100, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} className={inputCls} style={inputStyle} />
      {suffix ? <span className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}>{suffix}</span> : null}
    </div>
  );
}

function ImageInput({ value, onChange, label = "Foto" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {value ? <img src={value} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : null}
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={`${label}: pega un enlace https:// o sube una`} className={inputCls} style={inputStyle} />
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { onChange(await uploadImage(f)); } catch (err) { void Swal.fire({ icon: "error", title: "No se pudo subir", text: errorText(err), ...swalTheme }); } finally { setBusy(false); }
      }} />
      <button type="button" onClick={() => file.current?.click()} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={softBox} title="Subir foto">{busy ? "…" : <ImagePlus size={16} />}</button>
      {value ? <button type="button" onClick={() => onChange("")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={softBox} title="Quitar"><X size={16} /></button> : null}
    </div>
  );
}

/** Lista editable (agregar, quitar, subir, bajar). */
function ListEditor<T>({ items, onChange, make, render, addLabel, max = 12 }: { items: T[]; onChange: (v: T[]) => void; make: () => T; render: (item: T, set: (v: T) => void, i: number) => ReactNode; addLabel: string; max?: number }) {
  const move = (i: number, d: number) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-2xl border p-3" style={softBox}>
          <div className="mb-2 flex justify-end gap-1">
            <button type="button" disabled={!i} onClick={() => move(i, -1)} className="rounded-lg p-1 disabled:opacity-30" title="Subir"><ArrowUp size={14} /></button>
            <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="rounded-lg p-1 disabled:opacity-30" title="Bajar"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="rounded-lg p-1 text-red-500" title="Quitar"><Trash2 size={14} /></button>
          </div>
          {render(it, (v) => onChange(items.map((x, k) => (k === i ? v : x))), i)}
        </div>
      ))}
      {items.length < max ? <button type="button" onClick={() => onChange([...items, make()])} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><Plus size={14} /> {addLabel}</button> : null}
    </div>
  );
}

function ProductPicker({ storeId, exclude, onPick, placeholder }: { storeId: string; exclude: string[]; onPick: (p: ProductHit) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const { data } = await supabaseBrowser().from("products").select("id,name,image_url,sku,stock").eq("store_id", storeId).eq("active", true).or(`name.ilike.${like},sku.ilike.${like}`).order("name").limit(20);
      setHits(((data ?? []) as ProductHit[]).filter((p) => !exclude.includes(p.id)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, storeId, exclude]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border px-3" style={inputStyle}>
        <Search size={15} style={{ color: "var(--t-muted)" }} />
        <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }} placeholder={placeholder} className="w-full bg-transparent py-2.5 text-sm outline-none" />
      </div>
      {hits.length ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border p-1 shadow-xl" style={{ ...softBox, background: "var(--t-bg-base)" }}>
          {hits.map((p) => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(""); setHits([]); }} className="flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm hover:opacity-80">
              {p.image_url ? <img src={p.image_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg" style={softBox}>📦</span>}
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}</span><span className="text-xs" style={{ color: "var(--t-muted)" }}>{p.sku ? `${p.sku} · ` : ""}{p.stock === null ? "sin control" : `${p.stock} en existencia`}</span></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LandingEditor({ store, catalogs, initial, onClose, onSaved, publicUrl }: {
  store: StoreInfo; catalogs: CatalogOption[]; initial: LandingRow | null; onClose: () => void; onSaved: (id: string) => void; publicUrl: (slug: string) => string;
}) {
  const [row, setRow] = useState<LandingRow>(() => initial ?? {
    name: "", slug: "", status: "draft", catalog_id: catalogs.find((c) => c.active)?.id ?? catalogs[0]?.id ?? "", product_ids: [],
    config: applyTemplate(DEFAULT_LANDING, "moda"),
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [names, setNames] = useState<Record<string, ProductHit>>({});
  const [items, setItems] = useState<LandingItem[]>([]);
  const [upsellItem, setUpsellItem] = useState<LandingItem | null>(null);
  const [pay, setPay] = useState({ wompi: false, addi: false });
  const [trust, setTrust] = useState<LandingData["trust"]>(null);
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<Device>("phone");
  const [full, setFull] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportedProduct | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [mine, setMine] = useState<Array<{ id: string; name: string; emoji: string; config: Partial<LandingConfig> }>>([]);
  const [sample, setSample] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const cfg = row.config;
  const setCfg = useCallback((patch: Partial<LandingConfig>) => setRow((r) => ({ ...r, config: { ...r.config, ...patch } })), []);
  const catalog = catalogs.find((c) => c.id === row.catalog_id) ?? null;

  // Nombres de los productos ya elegidos (al editar).
  useEffect(() => {
    const ids = [...row.product_ids, cfg.upsell.product_id].filter((id) => id && !names[id]);
    if (!ids.length) return;
    void supabaseBrowser().from("products").select("id,name,image_url,sku,stock").in("id", ids).then(({ data }) => {
      if (data) setNames((n) => ({ ...n, ...Object.fromEntries((data as ProductHit[]).map((p) => [p.id, p])) }));
    });
  }, [row.product_ids, cfg.upsell.product_id, names]);

  useEffect(() => {
    void supabaseBrowser().from("store_payment_methods").select("provider,enabled,show_on_invoice").eq("store_id", store.id).then(({ data }) => {
      const rows = (data ?? []) as Array<{ provider: string; enabled: boolean; show_on_invoice: boolean | null }>;
      setPay({ wompi: rows.some((r) => r.provider === "wompi" && r.enabled && r.show_on_invoice !== false), addi: rows.some((r) => r.provider === "addi" && r.enabled && r.show_on_invoice !== false) });
    });
  }, [store.id]);

  // Datos de confianza reales (los mismos que verá el cliente; los pedidos entregados se cuentan en la página real).
  useEffect(() => {
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("billing_settings").select("business_name,nit").eq("store_id", store.id).maybeSingle(),
      sb.from("erp_warehouses").select("name,city,address,kind,active").eq("store_id", store.id),
      sb.from("store_links").select("type,url,active").eq("store_id", store.id),
    ]).then(([bs, wh, ln]) => {
      const b = bs.data as { business_name?: string | null; nit?: string | null } | null;
      setTrust({
        business_name: b?.business_name ?? null, nit: b?.nit ?? null,
        points: ((wh.data ?? []) as Array<{ name: string; city: string | null; address: string | null; kind: string | null; active: boolean }>).filter((w) => w.active && w.kind !== "warehouse" && w.address).slice(0, 4),
        links: ((ln.data ?? []) as Array<{ type: string; url: string; active: boolean }>).filter((l) => l.active && /^https:/.test(l.url)).slice(0, 4),
        orders_done: 0, since: null,
      });
    });
  }, [store.id]);

  // Productos con el precio y las existencias del catálogo (para la vista previa).
  const idsKey = [...row.product_ids, cfg.upsell.enabled ? cfg.upsell.product_id : ""].join(",");
  useEffect(() => {
    const ids = idsKey.split(",").filter(Boolean);
    if (!ids.length || !catalog) { setItems([]); setUpsellItem(null); return; }
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const [prod, stock] = await Promise.all([
        sb.from("products").select("id,name,image_url,description,product_details,stock,price_retail").in("id", ids),
        sb.rpc("catalog_public_stock", { p_store: store.slug, p_catalog: catalog.slug, p_key: catalog.access_key, p_ids: ids }),
      ]);
      if (!alive) return;
      const prices = new Map(((stock.data ?? []) as Array<{ id: string; price: number | null; stock: number | null }>).map((r) => [String(r.id), r]));
      const toItem = (p: Record<string, unknown>): LandingItem => {
        const d = (p.product_details ?? {}) as Record<string, unknown>;
        const pr = prices.get(String(p.id));
        return {
          id: String(p.id), name: String(p.name), option: String(p.name), image: (p.image_url as string) ?? null,
          gallery: Array.isArray(d.gallery_urls) ? (d.gallery_urls as string[]) : [], description: (d.long_description as string) || (p.description as string) || null,
          highlights: Array.isArray(d.highlights) ? (d.highlights as string[]) : [], specifications: Array.isArray(d.specifications) ? (d.specifications as LandingItem["specifications"]) : [],
          video_url: (d.video_url as string) ?? null,
          price: Number(pr?.price ?? p.price_retail) || 0, stock: pr ? (pr.stock === null ? null : Number(pr.stock)) : (p.stock as number | null),
        };
      };
      const all = ((prod.data ?? []) as Array<Record<string, unknown>>).map(toItem);
      setItems(row.product_ids.map((id) => all.find((x) => x.id === id)).filter((x): x is LandingItem => Boolean(x)));
      setUpsellItem(cfg.upsell.enabled ? all.find((x) => x.id === cfg.upsell.product_id) ?? null : null);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, catalog?.id, store.slug]);

  const previewData: LandingData = useMemo(() => ({
    store: { id: store.id, slug: store.slug, name: store.name, logo_url: store.logo_url, whatsapp: store.whatsapp },
    page: { id: row.id ?? "nuevo", slug: row.slug || "vista-previa", name: row.name || "Tu producto", config: cfg, catalog: catalog?.slug ?? "" },
    items: items.map((i) => ({ ...i, option: cfg.option_names[i.id] || i.name })),
    upsell: upsellItem,
    payments: { cod: cfg.payments.cod, online: cfg.payments.online && pay.wompi, addi: cfg.payments.addi && pay.addi },
    trust,
    social: sample ? { live: 7, sold_week: 23, recent: [{ name: "Ejemplo", city: "Pereira", units: 2, minutes: 4 }, { name: "Ejemplo", city: "Medellín", units: 1, minutes: 18 }] } : { live: 0, sold_week: 0, recent: [] },
  }), [store, row.id, row.slug, row.name, cfg, catalog, items, upsellItem, pay, sample, trust]);

  const post = useCallback((reset = false) => {
    frame.current?.contentWindow?.postMessage({ type: "remhub-landing-preview", data: previewData, reset }, window.location.origin);
  }, [previewData]);
  useEffect(() => { const t = window.setTimeout(() => post(), 150); return () => window.clearTimeout(t); }, [post]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && (e.data as { type?: string })?.type === "remhub-landing-preview-ready") post(true); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [post]);

  /** Trae la información del producto de la lista (fotos, video, descripción, características) para seguir editándola aquí. */
  async function importProduct(id: string, quiet: boolean) {
    const { data } = await supabaseBrowser().from("products").select("name,description,image_url,product_details").eq("id", id).maybeSingle();
    if (!data) return;
    const p = data as { name: string; description: string | null; image_url: string | null; product_details: Record<string, unknown> | null };
    const d = p.product_details ?? {};
    const gallery = [p.image_url, ...(Array.isArray(d.gallery_urls) ? (d.gallery_urls as string[]) : [])].filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
    const highlights = Array.isArray(d.highlights) ? (d.highlights as string[]).filter(Boolean) : [];
    const specs = Array.isArray(d.specifications) ? (d.specifications as Array<{ name: string; value: string }>) : [];
    const long = typeof d.long_description === "string" ? d.long_description.trim() : "";
    const apply = () => setRow((r) => ({
      ...r,
      name: r.name || p.name,
      config: {
        ...r.config,
        images: [...new Set(gallery)].slice(0, 20),
        video_url: typeof d.video_url === "string" && /^https:\/\//.test(d.video_url) ? d.video_url : r.config.video_url,
        subheadline: r.config.subheadline || (p.description ?? "").slice(0, 300),
        benefits: highlights.length ? highlights.slice(0, 8).map((h) => ({ icon: "✨", title: h.slice(0, 60), text: "" })) : r.config.benefits,
        stories: long ? [{ title: "¿Por qué te va a encantar?", text: long.slice(0, 1500), image: gallery[1] ?? "" }] : r.config.stories,
        compare_rows: r.config.compare_rows.length ? r.config.compare_rows : [],
        faqs: specs.length ? [{ q: "¿Qué características tiene?", a: specs.map((x) => `• ${x.name}: ${x.value}`).join("\n") }, ...r.config.faqs] : r.config.faqs,
        // Lo traído ya va en fotos, beneficios e historia: se oculta el bloque de detalles para no repetir.
        sections: r.config.sections.map((x) => (x.key === "details" ? { ...x, on: false } : x)),
      },
    }));
    if (quiet) { apply(); return; }
    const ok = await Swal.fire({ icon: "question", title: "¿Traer la información del producto?", text: "Se copian las fotos, el video, la descripción, las características y las especificaciones. Reemplaza las fotos, beneficios e historia de la landing; después puedes cambiar todo.", showCancelButton: true, confirmButtonText: "Sí, traer", cancelButtonText: "Cancelar", ...swalTheme });
    if (ok.isConfirmed) apply();
  }

  // Plantillas propias de la tienda.
  const loadMine = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("erp_landing_templates_list", { p_store: store.id });
    const r = data as { ok?: boolean; items?: typeof mine } | null;
    if (r?.ok) setMine(r.items ?? []);
  }, [store.id]);
  useEffect(() => { void loadMine(); }, [loadMine]);

  function applyMine(t: (typeof mine)[number]) {
    setRow((r) => ({
      ...r,
      config: normalizeLanding({
        ...t.config,
        images: r.config.images, option_names: r.config.option_names, compare_at_price: r.config.compare_at_price, promo_ends_at: r.config.promo_ends_at,
        upsell: r.config.upsell, meta_pixel_id: r.config.meta_pixel_id, tiktok_pixel_id: r.config.tiktok_pixel_id,
        poster_images: t.config.poster_images?.length ? t.config.poster_images : r.config.poster_images,
        template: `mine:${t.id}`,
      }),
    }));
  }

  async function saveMine() {
    const res = await Swal.fire({ title: "Guardar como plantilla", input: "text", inputLabel: "Nombre de la plantilla", inputValue: row.name ? `Estilo ${row.name}` : "", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", ...swalTheme, inputValidator: (v) => (v.trim() ? null : "Escribe un nombre") });
    if (!res.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_landing_template_save", { p_store: store.id, p_name: String(res.value), p_emoji: "⭐", p_config: normalizeLanding(cfg) });
    if (error || !(data as { ok?: boolean })?.ok) { void Swal.fire({ icon: "error", title: "No se pudo", text: error?.message ?? (data as { message?: string })?.message, ...swalTheme }); return; }
    void Swal.fire({ icon: "success", title: "Plantilla guardada", text: "La encuentras en «Plantilla» al crear otra landing.", timer: 1800, showConfirmButton: false, ...swalTheme });
    void loadMine();
  }

  async function removeMine(id: string) {
    await supabaseBrowser().rpc("erp_landing_template_delete", { p_store: store.id, p_id: id });
    void loadMine();
  }

  /** Crear desde el enlace de otra tienda: trae título, descripción, fotos y características. */
  async function importLink() {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const { product } = await fiscalApi<{ product: ImportedProduct }>("/api/landing/import", { store_id: store.id, url: importUrl.trim() });
      setImported(product);
      const text = product.description.trim();
      const firstLine = text.split(/\n|(?<=\.)\s/)[0]?.slice(0, 300) ?? "";
      setRow((r) => ({
        ...r,
        name: r.name || product.title.slice(0, 80),
        slug: slugTouched || r.slug ? r.slug : catalogSlug(product.title).slice(0, 60),
        config: {
          ...r.config,
          images: product.images.length ? product.images : r.config.images,
          video_url: product.video && /^https:/.test(product.video) ? product.video : r.config.video_url,
          subheadline: firstLine || r.config.subheadline,
          benefits: product.bullets.length ? product.bullets.slice(0, 8).map((b) => ({ icon: "✨", title: b.slice(0, 60), text: b.length > 60 ? b.slice(60, 260) : "" })) : r.config.benefits,
          stories: text.length > firstLine.length + 20 ? [{ title: "¿Por qué te va a encantar?", text: text.slice(0, 1500), image: product.images[1] ?? "" }] : r.config.stories,
        },
      }));
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo leer el enlace", text: errorText(e), ...swalTheme });
    } finally {
      setImporting(false);
    }
  }

  /** Crea el producto en RemHub con lo traído del enlace (las existencias y el costo entran luego por un ingreso o traslado). */
  async function createFromImport() {
    if (!imported) return;
    const price = Number(newPrice.replace(/\D/g, "")) || 0;
    const sb = supabaseBrowser();
    const details = { ...EMPTY_PRODUCT_DETAILS, long_description: imported.description.slice(0, 3000), gallery_urls: imported.images.slice(1, 12), highlights: imported.bullets.slice(0, 8), video_url: imported.video && /^https:/.test(imported.video) ? imported.video : "" };
    const base = { store_id: store.id, name: (row.name || imported.title).trim().toUpperCase().slice(0, 120), description: imported.description.slice(0, 500), cost_price: 0, stock: 0, active: true, image_url: imported.images[0] ?? null, product_details: details, min_wholesale: 1 };
    const prices = price ? { price_1: price, price_2: price, price_3: price, price_4: price, price_5: price, price_retail: price, price_wholesale: price } : {};
    let { data, error } = await sb.from("products").insert({ ...base, ...prices }).select("id,name,image_url,sku,stock").single();
    if (error && price && /permission|price/i.test(error.message)) ({ data, error } = await sb.from("products").insert(base).select("id,name,image_url,sku,stock").single());
    if (error || !data) { void Swal.fire({ icon: "error", title: "No se pudo crear el producto", text: errorText(error), ...swalTheme }); return; }
    addOption(data as ProductHit);
    setImported(null);
    void Swal.fire({ icon: "success", title: "Producto creado", html: "Ya está en tu lista de productos y en esta landing.<br/><b>Falta:</b> darle precio si no lo pusiste y entrarle existencias con un <b>ingreso</b> (o un traslado al punto de ventas online).", ...swalTheme });
  }

  async function resetCounters() {
    const ok = await Swal.fire({ icon: "question", title: "¿Reiniciar contadores?", text: "Lo que se ve en la página (personas viendo, vendidos y pedidos recientes) vuelve a contar desde cero. Tus estadísticas, pedidos y ganancia no se borran.", showCancelButton: true, confirmButtonText: "Sí, reiniciar", cancelButtonText: "Cancelar", ...swalTheme });
    if (!ok.isConfirmed || !row.id) return;
    const { data, error } = await supabaseBrowser().rpc("erp_landing_reset_counters", { p_store: store.id, p_id: row.id });
    if (error || !(data as { ok?: boolean })?.ok) { void Swal.fire({ icon: "error", title: "No se pudo", text: error?.message?.includes("erp_landing_reset_counters") ? "Falta ejecutar la migración 20261253_landing_contadores.sql." : error?.message, ...swalTheme }); return; }
    void Swal.fire({ icon: "success", title: "Contadores en cero", timer: 1400, showConfirmButton: false, ...swalTheme });
  }

  function addOption(p: ProductHit) {
    setNames((n) => ({ ...n, [p.id]: p }));
    setRow((r) => {
      const ids = [...r.product_ids, p.id];
      const name = r.name || p.name;
      return { ...r, product_ids: ids, name, slug: slugTouched ? r.slug : catalogSlug(name).slice(0, 60) };
    });
    // Primer producto: se trae su información para empezar (fotos, video, textos).
    if (!row.product_ids.length && !cfg.images.length && !cfg.stories.length) void importProduct(p.id, true);
  }

  async function save(status: LandingRow["status"]) {
    const clean = normalizeLanding(cfg);
    const payload = { ...row, status, config: clean, slug: row.slug.trim().toLowerCase() };
    if (!LANDING_SLUG.test(payload.slug)) { void Swal.fire({ icon: "warning", title: "Revisa el enlace", text: "Solo letras minúsculas, números y guiones (mínimo 2).", ...swalTheme }); return; }
    if (status === "published" && clean.compare_at_price && items[0] && clean.compare_at_price <= items[0].price) {
      void Swal.fire({ icon: "warning", title: "El precio «antes» debe ser mayor", text: "Si no tuviste un precio anterior real, déjalo vacío.", ...swalTheme });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabaseBrowser().rpc("erp_landing_save", { p_store: store.id, p_id: row.id ?? null, p: payload });
      if (error) throw new Error(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261252_landing_pages.sql en Supabase." : error.message);
      const r = data as { ok: boolean; id?: string; message?: string };
      if (!r.ok || !r.id) throw new Error(r.message ?? "No se pudo guardar.");
      setRow((x) => ({ ...x, id: r.id, status }));
      onSaved(r.id);
      const url = publicUrl(payload.slug);
      void Swal.fire({
        icon: "success", title: status === "published" ? "¡Landing publicada! 🚀" : "Guardada",
        html: status === "published" ? `Ya puedes usarla en tus anuncios:<br/><a href="${url}" target="_blank" rel="noopener" style="word-break:break-all;font-weight:700">${url}</a>` : "Quedó como borrador (nadie la ve todavía).",
        ...swalTheme,
      });
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se pudo guardar", text: errorText(e), ...swalTheme });
    } finally {
      setSaving(false);
    }
  }

  const missingPay = (cfg.payments.online && !pay.wompi) || (cfg.payments.addi && !pay.addi);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><ArrowLeft size={15} /> Volver</button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-black">{row.id ? `Editar · ${row.name}` : "Nueva landing"}</h2>
        {row.status === "published" ? <Pill tone="good">● Publicada</Pill> : <Pill>Borrador</Pill>}
        <button type="button" onClick={() => setShowPreview((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold lg:hidden" style={softBox}><Eye size={15} /> {showPreview ? "Editar" : "Ver cómo se ve"}</button>
        <button type="button" disabled={saving} onClick={() => void save(row.status === "published" ? "published" : "draft")} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}><Save size={15} /> Guardar</button>
        {row.status !== "published" ? <button type="button" disabled={saving} onClick={() => void save("published")} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}><Rocket size={15} /> Publicar</button> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className={`space-y-3 ${showPreview ? "hidden lg:block" : ""}`}>
          <Block title="Crear desde un enlace" emoji="🔗" hint="Pega el enlace de AliExpress, Amazon, Shopify, Mercado Libre u otra tienda: traemos título, fotos, descripción y características" open={!row.id}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void importLink(); }} placeholder="https://es.aliexpress.com/item/…" className={inputCls} style={inputStyle} inputMode="url" />
              <button type="button" disabled={importing || !importUrl.trim()} onClick={() => void importLink()} className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--t-cta)" }}>{importing ? "Leyendo…" : "Traer información"}</button>
            </div>
            {imported ? (
              <div className="rounded-2xl border p-3 text-sm" style={softBox}>
                <p className="font-bold">✅ Traído de {imported.source}: {imported.images.length} fotos{imported.bullets.length ? `, ${imported.bullets.length} características` : ""}{imported.video ? ", video" : ""}.</p>
                {imported.price ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Precio en esa página: {imported.currency ?? ""} {imported.price.toLocaleString("es-CO")} (solo referencia; tu precio sale de tu catálogo).</p> : null}
                {imported.options.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Opciones que tiene allá: {imported.options.slice(0, 8).join(", ")}{imported.options.length > 8 ? "…" : ""}</p> : null}
                {!row.product_ids.length ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input inputMode="numeric" value={newPrice ? Number(newPrice.replace(/\D/g, "")).toLocaleString("es-CO") : ""} onChange={(e) => setNewPrice(e.target.value)} placeholder="Tu precio de venta (opcional)" className={inputCls} style={inputStyle} />
                    <button type="button" onClick={() => void createFromImport()} className="shrink-0 rounded-xl border px-3 py-2 text-sm font-bold" style={softBox}>➕ Crear el producto en RemHub con estos datos</button>
                  </div>
                ) : null}
                <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Usa solo fotos y textos que tengas derecho a usar (las de tu proveedor normalmente sí). Revisa y ajusta los textos antes de publicar.</p>
              </div>
            ) : null}
          </Block>

          <Block title="Plantilla" emoji="🎨" hint="Empieza con textos, beneficios y preguntas pensados para tu tipo de producto" open={!row.id}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANDING_TEMPLATES.map((t) => (
                <button key={t.key} type="button" onClick={() => setRow((r) => ({ ...r, config: applyTemplate(r.config, t.key) }))}
                  className="rounded-2xl border-2 p-3 text-left transition hover:-translate-y-0.5" style={{ ...softBox, borderColor: cfg.template === t.key ? "var(--t-accent)" : "var(--t-card-border)" }}>
                  <span className="text-2xl">{t.emoji}</span>
                  <span className="mt-1 block text-sm font-bold">{t.name}</span>
                  <span className="block text-[11px] leading-4" style={{ color: "var(--t-muted)" }}>{t.hint}</span>
                  <span className="mt-2 block h-1.5 w-10 rounded-full" style={{ background: t.config.accent }} />
                </button>
              ))}
            </div>
            {mine.length ? (
              <>
                <p className="pt-1 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Mis plantillas</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {mine.map((t) => (
                    <div key={t.id} className="relative rounded-2xl border-2 p-3" style={{ ...softBox, borderColor: cfg.template === `mine:${t.id}` ? "var(--t-accent)" : "var(--t-card-border)" }}>
                      <button type="button" onClick={() => applyMine(t)} className="block w-full text-left">
                        <span className="text-2xl">{t.emoji}</span>
                        <span className="mt-1 block truncate text-sm font-bold">{t.name}</span>
                        <span className="mt-2 block h-1.5 w-10 rounded-full" style={{ background: t.config.accent ?? "var(--t-accent)" }} />
                      </button>
                      <button type="button" onClick={() => void removeMine(t.id)} className="absolute right-2 top-2 text-xs text-red-500" title="Borrar plantilla">✕</button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cambiar de plantilla reemplaza los textos, pero conserva tus fotos, opciones, precio anterior, adicional y píxeles.</p>
              <button type="button" onClick={() => void saveMine()} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={softBox}>⭐ Guardar esta como plantilla</button>
            </div>

          </Block>

          <Block title="Producto y opciones" emoji="🛍️" hint="El catálogo pone el precio y las existencias reales" open>
            <Field label="Catálogo (precio y existencias)">
              <select value={row.catalog_id} onChange={(e) => setRow((r) => ({ ...r, catalog_id: e.target.value }))} className={inputCls} style={inputStyle}>
                {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inactivo)"}</option>)}
              </select>
            </Field>
            <p className="rounded-xl p-2 text-xs" style={{ ...softBox, color: "var(--t-muted)" }}>
              📦 {catalog?.point_id ? <>El inventario sale del punto <b style={{ color: "var(--t-text)" }}>{catalog.point_name ?? "del catálogo"}</b>.</> : <>Este catálogo usa el inventario general de la tienda.</>}
              {" "}Para manejar la pauta <b style={{ color: "var(--t-text)" }}>por aparte</b>, crea un punto «Ventas online», pásale mercancía con un traslado y crea un catálogo con ese punto: la landing vende y descuenta solo de ahí.
            </p>
            <ProductPicker storeId={store.id} exclude={row.product_ids} onPick={addOption} placeholder={row.product_ids.length ? "Agregar otra opción (color, talla…)" : "Busca el producto por nombre o código"} />
            {row.product_ids.length ? (
              <>
                <button type="button" onClick={() => void importProduct(row.product_ids[0], false)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}>📥 Traer fotos, video y textos del producto</button>
                <Field label="¿Cómo se llaman las opciones?" hint="Ej. Color, Talla, Modelo. Para dos selectores (estilo y color) escribe «Estilo / Color» y nombra cada opción «Manga larga / Negro»">
                  <input value={cfg.option_label} onChange={(e) => setCfg({ option_label: e.target.value })} className={inputCls} style={inputStyle} />
                </Field>
                <div className="space-y-2">
                  {row.product_ids.map((id, i) => {
                    const p = names[id];
                    const it = items.find((x) => x.id === id);
                    return (
                      <div key={id} className="flex items-center gap-2 rounded-2xl border p-2" style={softBox}>
                        {p?.image_url ? <img src={p.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-lg">📦</span>}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{p?.name ?? "…"}{it ? ` · $${Math.round(it.price).toLocaleString("es-CO")} · ${it.stock === null ? "sin control" : `${it.stock} disp.`}` : ""}</p>
                          <input value={cfg.option_names[id] ?? ""} onChange={(e) => setCfg({ option_names: { ...cfg.option_names, [id]: e.target.value } })} placeholder={`Nombre corto (ej. Negro)`} className="w-full bg-transparent text-sm font-semibold outline-none" />
                        </div>
                        <button type="button" disabled={!i} onClick={() => setRow((r) => { const n = [...r.product_ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return { ...r, product_ids: n }; })} className="p-1 disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button type="button" onClick={() => setRow((r) => ({ ...r, product_ids: r.product_ids.filter((x) => x !== id) }))} className="p-1 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
                {optionDims(row.product_ids.map((id) => cfg.option_names[id] || names[id]?.name || ""), cfg.option_label) ? <p className="rounded-xl bg-emerald-500/15 p-2 text-xs font-semibold">✅ Opciones dobles activas: el cliente elige {cfg.option_label} en dos selectores por cada unidad.</p> : null}
                {items.length && items.every((i) => !i.price) ? <p className="rounded-xl bg-amber-500/15 p-2 text-xs font-semibold">⚠️ Este catálogo no le da precio a estos productos. Elige otro catálogo o ponles precio.</p> : null}
              </>
            ) : null}
          </Block>

          <Block title="Diseño: orden de las secciones, letra y barras" emoji="🧩" hint="Sube, baja u oculta cada parte. Personaliza todo">
            <div className="space-y-1.5">
              {cfg.sections.map((sec, i) => (
                <div key={sec.key} className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ ...softBox, opacity: sec.on ? 1 : 0.55 }}>
                  <span className="w-5 text-xs font-black" style={{ color: "var(--t-muted)" }}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{SECTION_NAMES[sec.key]}</span>
                  <button type="button" disabled={!i} onClick={() => { const n = [...cfg.sections]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setCfg({ sections: n }); }} className="p-1 disabled:opacity-30" title="Subir"><ArrowUp size={14} /></button>
                  <button type="button" disabled={i === cfg.sections.length - 1} onClick={() => { const n = [...cfg.sections]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setCfg({ sections: n }); }} className="p-1 disabled:opacity-30" title="Bajar"><ArrowDown size={14} /></button>
                  <Switch checked={sec.on} onChange={(on) => setCfg({ sections: cfg.sections.map((x, k) => (k === i ? { ...x, on } : x)) })} label={SECTION_NAMES[sec.key]} />
                </div>
              ))}
            </div>
            <Field label="Tipo de letra">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(LANDING_FONTS) as LandingFont[]).map((k) => (
                  <button key={k} type="button" onClick={() => setCfg({ font: k })} className="rounded-xl border-2 px-3 py-2 text-sm font-bold" style={{ ...softBox, borderColor: cfg.font === k ? "var(--t-accent)" : "var(--t-card-border)", fontFamily: k === "elegante" ? "Georgia, serif" : k === "fuerte" ? "Impact, 'Arial Black', sans-serif" : k === "amable" ? "'Trebuchet MS', sans-serif" : undefined }}>{LANDING_FONTS[k]}</button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Texto de la barra de arriba" hint="Vacío = envío y «paga al recibir». Con fecha de promo sale la cuenta regresiva"><input value={cfg.topbar_text} onChange={(e) => setCfg({ topbar_text: e.target.value })} className={inputCls} style={inputStyle} /></Field>
              <Field label="Botón de la barra fija (abajo)"><input value={cfg.sticky_text} onChange={(e) => setCfg({ sticky_text: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            </div>
          </Block>

          <Block title="Afiche (imágenes largas)" emoji="🖼️" hint="Como las landings tipo combo: diseña en Canva y súbelas en orden">
            <Field label="Título antes de las imágenes (opcional)"><input value={cfg.poster_title} onChange={(e) => setCfg({ poster_title: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            <ListEditor items={cfg.poster_images} max={30} onChange={(poster_images) => setCfg({ poster_images })} make={() => ""} addLabel="Agregar imagen" render={(src, set) => <ImageInput value={src} onChange={set} label="Imagen" />} />
            <Field label="Botón de compra cada" hint="0 = solo al final"><Num value={cfg.poster_cta_every} max={10} suffix="imágenes" onChange={(poster_cta_every) => setCfg({ poster_cta_every })} /></Field>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Consejo: imágenes de 1080 px de ancho, livianas (menos de 400 KB). Al subirlas aquí se optimizan solas.</p>
          </Block>

          <Block title="Nombre, enlace y textos" emoji="✍️" hint="Lo primero que ve el cliente">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre del producto en la landing"><input value={row.name} onChange={(e) => setRow((r) => ({ ...r, name: e.target.value, slug: slugTouched ? r.slug : catalogSlug(e.target.value).slice(0, 60) }))} className={inputCls} style={inputStyle} /></Field>
              <Field label="Enlace" hint={publicUrl(row.slug || "…")}><input value={row.slug} onChange={(e) => { setSlugTouched(true); setRow((r) => ({ ...r, slug: catalogSlug(e.target.value).slice(0, 60) })); }} className={inputCls} style={inputStyle} /></Field>
            </div>
            <Field label="Titular" hint="{producto} se reemplaza por el nombre"><input value={cfg.headline} onChange={(e) => setCfg({ headline: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            <Field label="Subtítulo"><textarea value={cfg.subheadline} onChange={(e) => setCfg({ subheadline: e.target.value })} rows={2} className={inputCls} style={inputStyle} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Etiqueta (arriba del titular)"><input value={cfg.badge} onChange={(e) => setCfg({ badge: e.target.value })} className={inputCls} style={inputStyle} /></Field>
              <Field label="Texto del botón"><input value={cfg.cta_text} onChange={(e) => setCfg({ cta_text: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            </div>
            <Field label="Color principal">
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => <button key={c} type="button" onClick={() => setCfg({ accent: c })} className="h-8 w-8 rounded-full border-2" style={{ background: c, borderColor: cfg.accent === c ? "var(--t-text)" : "transparent" }} aria-label={c} />)}
                <input type="color" value={cfg.accent} onChange={(e) => setCfg({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded" aria-label="Otro color" />
              </div>
            </Field>
          </Block>

          <Block title="Precio, promo y cuenta regresiva" emoji="⏰" hint="Solo datos reales: es la ley y Meta lo revisa">
            <Field label="Precio «antes» (opcional)" hint="Solo si de verdad lo vendías a ese precio. Si no, déjalo vacío y no sale «Antes».">
              <input inputMode="numeric" value={cfg.compare_at_price ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); setCfg({ compare_at_price: n > 0 ? n : null }); }} placeholder="Ej. 199800" className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Texto de la promo"><input value={cfg.promo_text} onChange={(e) => setCfg({ promo_text: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            <Field label="La promo termina (hora Colombia)" hint="Cuando llegue la fecha, la cuenta regresiva desaparece sola. Nunca se reinicia para engañar.">
              <DateField withTime value={bogotaLocal(cfg.promo_ends_at)} onChange={(v) => setCfg({ promo_ends_at: fromBogota(v) })} />
            </Field>
          </Block>

          <Block title="Paquetes: lleva más y ahorra" emoji="📦" hint="El paquete 2x sube mucho el valor de cada venta">
            <ListEditor items={cfg.bundles} max={4} onChange={(bundles) => setCfg({ bundles })} addLabel="Agregar paquete"
              make={() => ({ qty: (cfg.bundles.at(-1)?.qty ?? 0) + 1, pct: 10, label: `Lleva ${(cfg.bundles.at(-1)?.qty ?? 0) + 1}`, highlight: false })}
              render={(b, set) => (
                <div className="grid gap-2 sm:grid-cols-[90px_110px_1fr_auto] sm:items-end">
                  <Field label="Unidades"><Num value={b.qty} min={1} max={10} onChange={(qty) => set({ ...b, qty })} /></Field>
                  <Field label="Descuento"><Num value={b.pct} max={90} suffix="%" onChange={(pct) => set({ ...b, pct })} /></Field>
                  <Field label="Texto"><input value={b.label} onChange={(e) => set({ ...b, label: e.target.value })} className={inputCls} style={inputStyle} /></Field>
                  <label className="flex items-center gap-2 pb-2 text-xs font-semibold"><input type="checkbox" checked={b.highlight} onChange={(e) => set({ ...b, highlight: e.target.checked })} /> Destacar</label>
                </div>
              )} />
          </Block>

          <Block title="Formas de pago" emoji="💳" hint="Contraentrega, en línea con Wompi y cuotas con Addi">
            <Toggle label="💵 Contraentrega (paga al recibir)" hint="La que más vende en Colombia" checked={cfg.payments.cod} onChange={(v) => setCfg({ payments: { ...cfg.payments, cod: v } })} />
            <Toggle label="💳 Pagar en línea (Wompi)" hint={pay.wompi ? "Tarjeta, PSE, Nequi, Bancolombia" : "Primero actívalo en Mi tienda → Facturación → Métodos de pago"} checked={cfg.payments.online} onChange={(v) => setCfg({ payments: { ...cfg.payments, online: v } })} />
            {cfg.payments.online ? <Field label="Descuento por pagar en línea"><Num value={cfg.payments.online_pct} max={30} suffix="%" onChange={(online_pct) => setCfg({ payments: { ...cfg.payments, online_pct } })} /></Field> : null}
            <Toggle label="🗓️ A cuotas con Addi" hint={pay.addi ? "Sujeto a aprobación de Addi" : "Primero conéctalo en Mi tienda → Facturación → Métodos de pago"} checked={cfg.payments.addi} onChange={(v) => setCfg({ payments: { ...cfg.payments, addi: v } })} />
            {missingPay ? <p className="rounded-xl bg-amber-500/15 p-2 text-xs font-semibold">⚠️ Algún pago no está activo en la tienda: no aparecerá en la landing hasta que lo actives.</p> : null}
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>El pago en línea y con Addi se hace desde el enlace del pedido, cuando lo confirmas (así nunca cobras algo que no tienes).</p>
          </Block>

          <Block title="Envío y entrega" emoji="🚚">
            <Toggle label="Envío gratis" checked={cfg.shipping.free} onChange={(v) => setCfg({ shipping: { ...cfg.shipping, free: v } })} />
            <Field label="Texto del envío"><input value={cfg.shipping.text} onChange={(e) => setCfg({ shipping: { ...cfg.shipping, text: e.target.value } })} className={inputCls} style={inputStyle} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Entrega desde"><Num value={cfg.shipping.days_min} max={30} suffix="días" onChange={(days_min) => setCfg({ shipping: { ...cfg.shipping, days_min } })} /></Field>
              <Field label="Hasta"><Num value={cfg.shipping.days_max} max={60} suffix="días" onChange={(days_max) => setCfg({ shipping: { ...cfg.shipping, days_max } })} /></Field>
              <Field label="Despacho hoy si piden antes de"><Num value={cfg.shipping.cutoff_hour} max={23} suffix="h" onChange={(cutoff_hour) => setCfg({ shipping: { ...cfg.shipping, cutoff_hour } })} /></Field>
            </div>
          </Block>

          <Block title="Formulario del pedido" emoji="📝" hint="Menos campos = más ventas">
            <Toggle label="Pedir cédula" hint="Útil para la guía de la transportadora" checked={cfg.form.ask_document} onChange={(v) => setCfg({ form: { ...cfg.form, ask_document: v } })} />
            <Toggle label="Pedir correo (obligatorio)" checked={cfg.form.ask_email} onChange={(v) => setCfg({ form: { ...cfg.form, ask_email: v } })} />
            <Toggle label="Pedir barrio" checked={cfg.form.ask_neighborhood} onChange={(v) => setCfg({ form: { ...cfg.form, ask_neighborhood: v } })} />
            <Toggle label="«Confirmo la dirección de entrega»" hint="Baja las devoluciones en contraentrega" checked={cfg.form.confirm_address} onChange={(v) => setCfg({ form: { ...cfg.form, confirm_address: v } })} />
          </Block>

          <Block title="Urgencia y prueba social (real)" emoji="🔥" hint="Todo sale de la base: nada inventado">
            <Toggle label="👁️ Personas viendo" hint="El número se mueve solo a medida que entra la gente (se actualiza cada 25 s)" checked={cfg.urgency.live_viewers} onChange={(v) => setCfg({ urgency: { ...cfg.urgency, live_viewers: v } })} />
            {cfg.urgency.live_viewers ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="¿Qué periodo cuenta?" hint={`Se verá: «👁️ 128 ${VIEWERS_WINDOWS[cfg.urgency.viewers_window].text}»`}>
                  <select value={cfg.urgency.viewers_window} onChange={(e) => setCfg({ urgency: { ...cfg.urgency, viewers_window: e.target.value as ViewersWindow } })} className={inputCls} style={inputStyle}>
                    {(Object.keys(VIEWERS_WINDOWS) as ViewersWindow[]).map((k) => <option key={k} value={k}>{VIEWERS_WINDOWS[k].label}</option>)}
                  </select>
                </Field>
                <Field label="Mostrar desde" hint="Si hay menos, no aparece"><Num value={cfg.urgency.viewers_min} min={1} max={10000} suffix="personas" onChange={(viewers_min) => setCfg({ urgency: { ...cfg.urgency, viewers_min } })} /></Field>
              </div>
            ) : null}
            <Toggle label="🛍️ «Fulana de Pereira pidió hace 5 min»" hint="Pedidos reales: solo primer nombre y ciudad" checked={cfg.urgency.recent_orders} onChange={(v) => setCfg({ urgency: { ...cfg.urgency, recent_orders: v } })} />
            {cfg.urgency.recent_orders ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Pedidos de los últimos">
                  <select value={cfg.urgency.recent_hours} onChange={(e) => setCfg({ urgency: { ...cfg.urgency, recent_hours: Number(e.target.value) } })} className={inputCls} style={inputStyle}>
                    {[[24, "1 día"], [72, "3 días"], [168, "7 días"], [720, "30 días"]].map(([h, l]) => <option key={h} value={h}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Mostrar un aviso cada"><Num value={cfg.urgency.recent_every} min={8} max={120} suffix="segundos" onChange={(recent_every) => setCfg({ urgency: { ...cfg.urgency, recent_every } })} /></Field>
              </div>
            ) : null}
            <Toggle label="📦 «¡Solo quedan N!»" hint="Existencias reales del catálogo" checked={cfg.urgency.stock} onChange={(v) => setCfg({ urgency: { ...cfg.urgency, stock: v } })} />
            {cfg.urgency.stock ? <Field label="Mostrar cuando queden"><Num value={cfg.urgency.low_stock_at} max={1000} suffix="o menos" onChange={(low_stock_at) => setCfg({ urgency: { ...cfg.urgency, low_stock_at } })} /></Field> : null}
            <Toggle label="📈 Vendidos" hint="Sale desde 3 vendidos" checked={cfg.urgency.sold_week} onChange={(v) => setCfg({ urgency: { ...cfg.urgency, sold_week: v } })} />
            {cfg.urgency.sold_week ? (
              <Field label="Contar los vendidos de">
                <select value={cfg.urgency.sold_window} onChange={(e) => setCfg({ urgency: { ...cfg.urgency, sold_window: e.target.value as SoldWindow } })} className={inputCls} style={inputStyle}>
                  {(Object.keys(SOLD_WINDOWS) as SoldWindow[]).map((k) => <option key={k} value={k}>{SOLD_WINDOWS[k].label} («N {SOLD_WINDOWS[k].text}»)</option>)}
                </select>
              </Field>
            ) : null}
            <Toggle label="⏰ Cuenta regresiva" checked={cfg.urgency.countdown} onChange={(v) => setCfg({ urgency: { ...cfg.urgency, countdown: v } })} />
            {cfg.urgency.countdown ? (
              <Field label="¿Hasta cuándo?" hint={cfg.urgency.countdown_mode === "midnight" ? "Úsalo si la oferta de verdad es del día: el precio de promo vale hasta medianoche." : "Pon la fecha en «Precio, promo y cuenta regresiva»."}>
                <select value={cfg.urgency.countdown_mode} onChange={(e) => setCfg({ urgency: { ...cfg.urgency, countdown_mode: e.target.value === "midnight" ? "midnight" : "date" } })} className={inputCls} style={inputStyle}>
                  <option value="date">Hasta la fecha de fin de la promo</option>
                  <option value="midnight">Oferta del día: termina hoy a medianoche</option>
                </select>
              </Field>
            ) : null}
            {row.id ? (
              <button type="button" onClick={() => void resetCounters()} className="rounded-xl border px-3 py-2 text-sm font-semibold" style={softBox}>🔄 Reiniciar contadores (personas viendo, vendidos y pedidos recientes)</button>
            ) : null}
          </Block>

          <Block title="Compra con confianza" emoji="🤝" hint="Credibilidad con datos reales de tu tienda: lo que más convence a comprar">
            <Toggle label="Mostrar «Compra con confianza»" hint="Siempre incluye el derecho de retracto y cómo se paga" checked={cfg.trust.enabled} onChange={(v) => setCfg({ trust: { ...cfg.trust, enabled: v } })} />
            {cfg.trust.enabled ? (
              <>
                <Toggle label="🏢 Empresa y NIT" hint="De Mi tienda → Facturación (si los tienes)" checked={cfg.trust.business} onChange={(v) => setCfg({ trust: { ...cfg.trust, business: v } })} />
                <Toggle label="📍 Tiendas físicas" hint="Los puntos que tienen dirección" checked={cfg.trust.points} onChange={(v) => setCfg({ trust: { ...cfg.trust, points: v } })} />
                <Toggle label="📦 Pedidos entregados y año de inicio" hint="Se cuentan los pedidos confirmados reales (sale desde 20)" checked={cfg.trust.orders} onChange={(v) => setCfg({ trust: { ...cfg.trust, orders: v } })} />
                <Toggle label="📸 Redes sociales" hint="Las de Mi tienda → Enlaces" checked={cfg.trust.links} onChange={(v) => setCfg({ trust: { ...cfg.trust, links: v } })} />
              </>
            ) : null}
          </Block>

          <Block title="Adicional de último momento" emoji="➕" hint="«¡Espera! Agrégalo con descuento» antes de enviar el pedido">
            <Toggle label="Ofrecer un adicional" checked={cfg.upsell.enabled} onChange={(v) => setCfg({ upsell: { ...cfg.upsell, enabled: v } })} />
            {cfg.upsell.enabled ? (
              <>
                {cfg.upsell.product_id && names[cfg.upsell.product_id] ? <p className="text-sm font-semibold">Producto: {names[cfg.upsell.product_id].name}</p> : null}
                <ProductPicker storeId={store.id} exclude={row.product_ids} onPick={(p) => { setNames((n) => ({ ...n, [p.id]: p })); setCfg({ upsell: { ...cfg.upsell, product_id: p.id } }); }} placeholder="Busca el producto adicional (ej. una correa, un accesorio)" />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Descuento"><Num value={cfg.upsell.pct} max={90} suffix="%" onChange={(pct) => setCfg({ upsell: { ...cfg.upsell, pct } })} /></Field>
                  <Field label="Segundos para decidir" hint="0 = sin tiempo"><Num value={cfg.upsell.seconds} max={180} suffix="s" onChange={(seconds) => setCfg({ upsell: { ...cfg.upsell, seconds } })} /></Field>
                </div>
                <Field label="Título"><input value={cfg.upsell.title} onChange={(e) => setCfg({ upsell: { ...cfg.upsell, title: e.target.value } })} className={inputCls} style={inputStyle} /></Field>
                <Field label="Texto"><input value={cfg.upsell.text} onChange={(e) => setCfg({ upsell: { ...cfg.upsell, text: e.target.value } })} className={inputCls} style={inputStyle} /></Field>
              </>
            ) : null}
          </Block>

          <Block title="Oferta de salida" emoji="🎁" hint="Si alguien se va a ir sin comprar, le ofreces un descuento extra (real)">
            <Toggle label="Activar oferta de salida" hint="Computador: al mover el mouse para cerrar. Celular: tras 45 s sin abrir el pedido. Una vez por visita." checked={cfg.exit_offer.enabled} onChange={(v) => setCfg({ exit_offer: { ...cfg.exit_offer, enabled: v } })} />
            {cfg.exit_offer.enabled ? (
              <>
                <Field label="Descuento adicional"><Num value={cfg.exit_offer.pct} min={1} max={30} suffix="%" onChange={(pct) => setCfg({ exit_offer: { ...cfg.exit_offer, pct } })} /></Field>
                <Field label="Título"><input value={cfg.exit_offer.title} onChange={(e) => setCfg({ exit_offer: { ...cfg.exit_offer, title: e.target.value } })} className={inputCls} style={inputStyle} /></Field>
                <Field label="Texto"><input value={cfg.exit_offer.text} onChange={(e) => setCfg({ exit_offer: { ...cfg.exit_offer, text: e.target.value } })} className={inputCls} style={inputStyle} /></Field>
              </>
            ) : null}
          </Block>

          <Block title="Fotos, video y guía de tallas" emoji="📸" hint="Si no pones fotos, se usan las del producto">
            <ListEditor items={cfg.images} max={20} onChange={(images) => setCfg({ images })} make={() => ""} addLabel="Agregar foto" render={(src, set) => <ImageInput value={src} onChange={set} />} />
            <Field label="Video (YouTube, TikTok descargado en .mp4 o enlace .mp4)" hint="Un video de 15 s con el producto en uso vende muchísimo"><input value={cfg.video_url} onChange={(e) => setCfg({ video_url: e.target.value.trim() })} placeholder="https://…" className={inputCls} style={inputStyle} /></Field>
            <Field label="Guía de tallas (imagen)"><ImageInput value={cfg.size_guide_image} onChange={(size_guide_image) => setCfg({ size_guide_image })} label="Guía" /></Field>
          </Block>

          <Block title="Beneficios" emoji="✨">
            <ListEditor items={cfg.benefits} max={8} onChange={(benefits) => setCfg({ benefits })} make={() => ({ icon: "✨", title: "", text: "" })} addLabel="Agregar beneficio"
              render={(b, set) => (
                <div className="grid gap-2 sm:grid-cols-[70px_1fr]">
                  <input value={b.icon} onChange={(e) => set({ ...b, icon: e.target.value })} className={`${inputCls} text-center text-xl`} style={inputStyle} aria-label="Emoji" />
                  <div className="space-y-2"><input value={b.title} onChange={(e) => set({ ...b, title: e.target.value })} placeholder="Título" className={inputCls} style={inputStyle} /><input value={b.text} onChange={(e) => set({ ...b, text: e.target.value })} placeholder="Texto corto" className={inputCls} style={inputStyle} /></div>
                </div>
              )} />
          </Block>

          <Block title="Bloques de historia (foto + texto)" emoji="📖" hint="Cuenta por qué lo necesitan; cada bloque trae su botón de compra">
            <ListEditor items={cfg.stories} max={8} onChange={(stories) => setCfg({ stories })} make={() => ({ title: "", text: "", image: "" })} addLabel="Agregar bloque"
              render={(s, set) => (
                <div className="space-y-2">
                  <input value={s.title} onChange={(e) => set({ ...s, title: e.target.value })} placeholder="Título (ej. ¿Por qué te vas a enamorar?)" className={inputCls} style={inputStyle} />
                  <textarea value={s.text} onChange={(e) => set({ ...s, text: e.target.value })} rows={3} placeholder="Texto" className={inputCls} style={inputStyle} />
                  <ImageInput value={s.image} onChange={(image) => set({ ...s, image })} />
                </div>
              )} />
          </Block>

          <Block title="Comparación «Nosotros vs. otros»" emoji="🆚">
            <ListEditor items={cfg.compare_rows} max={8} onChange={(compare_rows) => setCfg({ compare_rows })} make={() => ({ label: "", us: "✅", them: "❌" })} addLabel="Agregar fila"
              render={(r, set) => (
                <div className="grid grid-cols-3 gap-2">
                  <input value={r.label} onChange={(e) => set({ ...r, label: e.target.value })} placeholder="Ej. Paga al recibir" className={inputCls} style={inputStyle} />
                  <input value={r.us} onChange={(e) => set({ ...r, us: e.target.value })} placeholder="Nosotros" className={inputCls} style={inputStyle} />
                  <input value={r.them} onChange={(e) => set({ ...r, them: e.target.value })} placeholder="Otros" className={inputCls} style={inputStyle} />
                </div>
              )} />
          </Block>

          <Block title="Opiniones de clientes" emoji="⭐" hint="Solo opiniones reales, con permiso de la persona">
            <ListEditor items={cfg.testimonials} max={12} onChange={(testimonials) => setCfg({ testimonials })} make={() => ({ name: "", city: "", text: "", stars: 5, image: "" })} addLabel="Agregar opinión"
              render={(t, set) => (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_90px] gap-2">
                    <input value={t.name} onChange={(e) => set({ ...t, name: e.target.value })} placeholder="Nombre" className={inputCls} style={inputStyle} />
                    <input value={t.city} onChange={(e) => set({ ...t, city: e.target.value })} placeholder="Ciudad" className={inputCls} style={inputStyle} />
                    <select value={t.stars} onChange={(e) => set({ ...t, stars: Number(e.target.value) })} className={inputCls} style={inputStyle}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select>
                  </div>
                  <textarea value={t.text} onChange={(e) => set({ ...t, text: e.target.value })} rows={2} placeholder="Lo que dijo" className={inputCls} style={inputStyle} />
                  <ImageInput value={t.image} onChange={(image) => set({ ...t, image })} label="Foto (opcional)" />
                </div>
              )} />
          </Block>

          <Block title="Preguntas frecuentes y garantías" emoji="❓">
            <ListEditor items={cfg.faqs} max={15} onChange={(faqs) => setCfg({ faqs })} make={() => ({ q: "", a: "" })} addLabel="Agregar pregunta"
              render={(f, set) => <div className="space-y-2"><input value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} placeholder="Pregunta" className={inputCls} style={inputStyle} /><textarea value={f.a} onChange={(e) => set({ ...f, a: e.target.value })} rows={2} placeholder="Respuesta" className={inputCls} style={inputStyle} /></div>} />
            <Field label="Garantías (franja oscura)" hint="Una por línea, máximo 6">
              <textarea value={cfg.guarantees.join("\n")} onChange={(e) => setCfg({ guarantees: e.target.value.split("\n").slice(0, 6) })} rows={3} className={inputCls} style={inputStyle} />
            </Field>
          </Block>

          <Block title="WhatsApp, compartir, políticas y gracias" emoji="💬">
            <Toggle label="Botón flotante de WhatsApp" hint={store.whatsapp ? `Al ${store.whatsapp}` : "La tienda no tiene WhatsApp en Mi tienda"} checked={cfg.whatsapp_button} onChange={(v) => setCfg({ whatsapp_button: v })} />
            <Field label="Mensaje que llega por WhatsApp"><input value={cfg.whatsapp_text} onChange={(e) => setCfg({ whatsapp_text: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            <Toggle label="«Recomiéndalo a un amigo»" hint="Lo comparten por WhatsApp: ventas gratis" checked={cfg.share_button} onChange={(v) => setCfg({ share_button: v })} />
            <Field label="Políticas propias (cambios, garantía)" hint="Siempre se agregan el derecho de retracto y la reversión del pago que exige la ley"><textarea value={cfg.policies} onChange={(e) => setCfg({ policies: e.target.value })} rows={3} className={inputCls} style={inputStyle} /></Field>
            <Field label="Mensaje de gracias"><textarea value={cfg.thank_you} onChange={(e) => setCfg({ thank_you: e.target.value })} rows={2} className={inputCls} style={inputStyle} /></Field>
          </Block>

          <Block title="Píxeles propios de esta landing" emoji="📊" hint="Opcional: el píxel de la tienda (Mi tienda → Marketing) ya mide todo">
            <Field label="ID de otro píxel de Meta" hint="Si esta campaña usa una cuenta publicitaria distinta"><input inputMode="numeric" value={cfg.meta_pixel_id} onChange={(e) => setCfg({ meta_pixel_id: e.target.value.replace(/\D/g, "") })} className={inputCls} style={inputStyle} /></Field>
            <Field label="ID del píxel de TikTok" hint="TikTok Ads → Herramientas → Eventos → Píxel (ej. C1ABC2DEF3GHI4JK)"><input value={cfg.tiktok_pixel_id} onChange={(e) => setCfg({ tiktok_pixel_id: e.target.value.trim().toUpperCase() })} className={inputCls} style={inputStyle} /></Field>
          </Block>
        </div>

        <div className={`${showPreview ? "" : "hidden lg:block"}`}>
          <div className={full ? "fixed inset-0 z-[90] flex flex-col gap-3 bg-slate-950/95 p-4" : "sticky top-4 space-y-2"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-xl border p-1" style={full ? { borderColor: "rgba(255,255,255,.2)", color: "#fff" } : softBox}>
                {DEVICES.map((d) => (
                  <button key={d.key} type="button" onClick={() => setDevice(d.key)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold" style={{ background: device === d.key ? "color-mix(in oklab, var(--t-accent) 30%, transparent)" : undefined }} title={`${d.label} (${d.w} px)`}>
                    {d.key === "phone" ? <Smartphone size={15} /> : d.key === "tablet" ? <Tablet size={15} /> : d.key === "laptop" ? <Laptop size={15} /> : <Monitor size={15} />}
                    <span className={full ? "" : "hidden xl:inline"}>{d.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2" style={full ? { color: "#fff" } : undefined}>
                <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} /> Simular visitas</label>
                <button type="button" onClick={() => setFull((v) => !v)} className="grid h-8 w-8 place-items-center rounded-lg border" style={full ? { borderColor: "rgba(255,255,255,.3)" } : softBox} title={full ? "Salir de pantalla completa" : "Pantalla completa"}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
              </div>
            </div>
            <DeviceFrame device={device} full={full}>
              <iframe ref={frame} src="/documento/landing-vista" title="Vista previa de la landing" className="h-full w-full border-0 bg-white" />
            </DeviceFrame>
            <p className="text-center text-[11px]" style={{ color: full ? "rgba(255,255,255,.7)" : "var(--t-muted)" }}>Vista previa en vivo · {DEVICES.find((d) => d.key === device)?.label} de {DEVICES.find((d) => d.key === device)?.w} px{sample ? " · visitas y pedidos de ejemplo" : ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

type Device = "phone" | "tablet" | "laptop" | "desktop";
const DEVICES: Array<{ key: Device; label: string; w: number; h: number }> = [
  { key: "phone", label: "Celular", w: 390, h: 844 },
  { key: "tablet", label: "Tablet", w: 820, h: 1180 },
  { key: "laptop", label: "Portátil", w: 1280, h: 800 },
  { key: "desktop", label: "Computador", w: 1536, h: 900 },
];

/** Marco del equipo: la página se dibuja a su ancho real y se escala para que quepa. */
function DeviceFrame({ device, full, children }: { device: Device; full: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 400, h: 800 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: full ? el.clientHeight : window.innerHeight - 140 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [full]);
  const d = DEVICES.find((x) => x.key === device)!;
  const bezel = device === "phone" ? 12 : device === "tablet" ? 16 : 10;
  const outerW = d.w + bezel * 2, outerH = d.h + bezel * 2 + (device === "laptop" || device === "desktop" ? 18 : 0);
  const scale = Math.min(1, room.w / outerW, Math.max(0.2, room.h / outerH));
  return (
    <div ref={box} className={full ? "flex min-h-0 flex-1 items-start justify-center overflow-auto" : "flex justify-center"}>
      <div style={{ width: outerW * scale, height: outerH * scale }}>
        <div style={{ width: outerW, height: outerH, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <div className="overflow-hidden bg-slate-900 shadow-2xl" style={{ padding: bezel, borderRadius: device === "phone" ? 48 : device === "tablet" ? 32 : 14 }}>
            {device === "laptop" || device === "desktop" ? <div className="mb-[8px] flex h-[10px] items-center gap-1.5 pl-1"><span className="h-2 w-2 rounded-full bg-red-400" /><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="h-2 w-2 rounded-full bg-emerald-400" /></div> : null}
            <div className="overflow-hidden bg-white" style={{ width: d.w, height: d.h, borderRadius: device === "phone" ? 36 : device === "tablet" ? 18 : 6 }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
