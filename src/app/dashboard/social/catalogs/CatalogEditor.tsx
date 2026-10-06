"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeDollarSign,
  Boxes,
  Check,
  Copy,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  LayoutList,
  Loader2,
  Lock,
  MapPin,
  Palette,
  RefreshCw,
  Save,
  Store as StoreIcon,
  Tags,
  Users,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { DashboardStore } from "@/lib/store-utils";
import { ImageUpload } from "@/app/dashboard/store/ImageUpload";
import {
  CATALOG_COLUMNS,
  PRICE_LEVELS,
  catalogPath,
  catalogSlug,
  generateCatalogKey,
  isValidCatalogSlug,
  productPriceForLevel,
  type CatalogLink,
  type CatalogLocation,
  type PriceLevel,
  type StoreCatalog,
} from "@/lib/catalogs";
import { CatalogPreview } from "./CatalogPreview";
import { CategoriesTab, categoryDisplayImage, categoryDisplayName } from "./CategoriesTab";
import { ContactTab } from "./ContactTab";
import { ProductsTab } from "./ProductsTab";
import {
  PRODUCT_LITE_COLUMNS,
  type BaseCategory,
  type CatalogCategoryRow,
  type CatalogProductRow,
  type PreviewItem,
  type ProductLite,
  type ThemeOption,
  type WarehouseOption,
} from "./types";
import { Field, Section, ToggleRow, errorText, inputCls, inputStyle, money, softBox, swalTheme } from "./ui";

export type { ThemeOption, WarehouseOption } from "./types";

type Tab = "identity" | "pricing" | "products" | "categories" | "contact";

const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: "identity", label: "Identidad", icon: <Palette size={15} /> },
  { key: "pricing", label: "Precios y acceso", icon: <BadgeDollarSign size={15} /> },
  { key: "products", label: "Productos", icon: <Boxes size={15} /> },
  { key: "categories", label: "Categorías", icon: <Tags size={15} /> },
  { key: "contact", label: "Contacto", icon: <Users size={15} /> },
];

function themeSwatch(theme: ThemeOption) {
  const cfg = (theme.config ?? {}) as Record<string, unknown>;
  const pick = (k: string, fallback: string) => (typeof cfg[k] === "string" && String(cfg[k]).trim() ? String(cfg[k]) : fallback);
  return { accent: pick("accent", "#a855f7"), accent2: pick("accent2", "#ec4899"), bg: pick("bg", "#100b18") };
}

function normalizeCatalog(row: StoreCatalog): StoreCatalog {
  return {
    ...row,
    price_level: Number(row.price_level) as PriceLevel,
    fallback_price_level: row.fallback_price_level ? (Number(row.fallback_price_level) as PriceLevel) : null,
    contact_channels: Array.isArray(row.contact_channels) ? row.contact_channels : [],
    locations: Array.isArray(row.locations) ? (row.locations as CatalogLocation[]) : [],
    links: Array.isArray(row.links) ? (row.links as CatalogLink[]) : [],
  };
}

export function CatalogEditor({
  catalogId,
  store,
  warehouses,
  themes,
  otherSlugs,
  onClose,
}: {
  catalogId: string;
  store: DashboardStore;
  warehouses: WarehouseOption[];
  themes: ThemeOption[];
  otherSlugs: string[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("identity");
  const [original, setOriginal] = useState<StoreCatalog | null>(null);
  const [draft, setDraft] = useState<StoreCatalog | null>(null);
  const [baseCategories, setBaseCategories] = useState<BaseCategory[]>([]);
  const [categoryRows, setCategoryRows] = useState<CatalogCategoryRow[]>([]);
  const [originalCategories, setOriginalCategories] = useState<CatalogCategoryRow[]>([]);
  const [productEdits, setProductEdits] = useState<Record<string, CatalogProductRow>>({});
  const [samples, setSamples] = useState<ProductLite[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [storeChannels, setStoreChannels] = useState<unknown[]>([]);
  const [storeLocations, setStoreLocations] = useState<CatalogLocation[]>([]);
  const [storeLinks, setStoreLinks] = useState<CatalogLink[]>([]);
  const [productsRefresh, setProductsRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [catalogRes, baseRes, rowsRes, profileRes, linksRes, samplesRes] = await Promise.all([
      sb.from("store_catalogs").select(CATALOG_COLUMNS).eq("id", catalogId).single(),
      sb.from("product_categories").select("id,name,image_url,sort_order,active").eq("store_id", store.id).order("sort_order"),
      sb.from("store_catalog_categories").select("id,category_id,name,image_url,sort_order,visible").eq("catalog_id", catalogId).order("sort_order"),
      sb.from("store_profiles").select("contact_channels,locations").eq("store_id", store.id).maybeSingle(),
      sb.from("store_links").select("id,type,label,url,icon_url").eq("store_id", store.id).eq("active", true).order("sort_order"),
      sb.from("products").select(PRODUCT_LITE_COLUMNS).eq("store_id", store.id).eq("active", true).not("image_url", "is", null).order("created_at", { ascending: false }).limit(12),
    ]);
    if (catalogRes.error) throw catalogRes.error;
    const catalog = normalizeCatalog(catalogRes.data as unknown as StoreCatalog);
    const bases = (baseRes.data ?? []) as BaseCategory[];
    let rows = (rowsRes.data ?? []) as CatalogCategoryRow[];
    const missing = bases.filter((b) => b.active && !rows.some((r) => r.category_id === b.id));
    if (missing.length) {
      const { data: inserted } = await sb
        .from("store_catalog_categories")
        .insert(missing.map((b) => ({ catalog_id: catalogId, store_id: store.id, category_id: b.id, sort_order: b.sort_order ?? 0 })))
        .select("id,category_id,name,image_url,sort_order,visible");
      rows = [...rows, ...((inserted ?? []) as CatalogCategoryRow[])];
    }
    setOriginal(catalog);
    setDraft(catalog);
    setBaseCategories(bases);
    setCategoryRows(rows);
    setOriginalCategories(rows);
    setStoreChannels(Array.isArray(profileRes.data?.contact_channels) ? profileRes.data.contact_channels : []);
    setStoreLocations(Array.isArray(profileRes.data?.locations) ? (profileRes.data.locations as CatalogLocation[]) : []);
    setStoreLinks(((linksRes.data ?? []) as CatalogLink[]).map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url, icon_url: l.icon_url ?? null })));
    setSamples((samplesRes.data ?? []) as ProductLite[]);
  }, [catalogId, store.id]);

  useEffect(() => {
    let alive = true;
    load()
      .catch((cause) => alive && setError(errorText(cause)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    let alive = true;
    void supabaseBrowser()
      .rpc("catalog_admin_products", { p_catalog: catalogId, p_filter: "visible", p_stock: "all", p_limit: 4, p_offset: 0 })
      .then(({ data, error: rpcError }) => {
        if (alive) setPreviewItems(rpcError ? [] : ((data as { items?: PreviewItem[] } | null)?.items ?? []));
      });
    return () => {
      alive = false;
    };
  }, [catalogId, productsRefresh]);

  const baseMap = useMemo(() => new Map(baseCategories.map((c) => [c.id, c])), [baseCategories]);
  const categoriesDirty = JSON.stringify(categoryRows) !== JSON.stringify(originalCategories);
  const dirty = Boolean(draft && original && (JSON.stringify(draft) !== JSON.stringify(original) || categoriesDirty || Object.keys(productEdits).length > 0));
  const slugChanged = Boolean(draft && original && draft.slug !== original.slug);
  const slugError = draft
    ? !isValidCatalogSlug(draft.slug)
      ? "Usa solo letras minúsculas, números y guiones."
      : otherSlugs.includes(draft.slug)
        ? "Otro catálogo ya usa este enlace."
        : ""
    : "";

  const visibleCategories = useMemo(
    () => [...categoryRows]
      .filter((r) => r.visible)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ id: r.id, name: categoryDisplayName(r, baseMap), image_url: categoryDisplayImage(r, baseMap) })),
    [categoryRows, baseMap],
  );

  function patch(change: Partial<StoreCatalog>) {
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function saveProducts() {
    const rows = Object.values(productEdits);
    if (!rows.length) return;
    const { error: upsertError } = await supabaseBrowser()
      .from("store_catalog_products")
      .upsert(
        rows.map((r) => ({
          catalog_id: catalogId,
          product_id: r.product_id,
          store_id: store.id,
          included: r.included,
          price_override: r.price_override,
          catalog_category_id: r.catalog_category_id,
          featured: r.featured,
        })),
        { onConflict: "catalog_id,product_id" },
      );
    if (upsertError) throw upsertError;
    setProductEdits({});
  }

  async function saveCategories() {
    if (!categoriesDirty) return;
    const sb = supabaseBrowser();
    const current = new Set(categoryRows.map((r) => r.id));
    const removed = originalCategories.filter((r) => !r.category_id && !current.has(r.id)).map((r) => r.id);
    if (removed.length) {
      const { error: deleteError } = await sb.from("store_catalog_categories").delete().in("id", removed);
      if (deleteError) throw deleteError;
    }
    const { error: upsertError } = await sb.from("store_catalog_categories").upsert(
      categoryRows.map((r) => ({
        id: r.id,
        catalog_id: catalogId,
        store_id: store.id,
        category_id: r.category_id,
        name: r.name?.trim() || null,
        image_url: r.image_url,
        sort_order: r.sort_order,
        visible: r.visible,
      })),
      { onConflict: "id" },
    );
    if (upsertError) throw upsertError;
    const clean = categoryRows.map((row) => ({ ...row, isNew: undefined }));
    setCategoryRows(clean);
    setOriginalCategories(clean);
  }

  async function save() {
    if (!draft) return;
    setError("");
    if (draft.name.trim().length < 2) {
      setTab("identity");
      return setError("El nombre del catálogo debe tener al menos 2 letras.");
    }
    if (slugError) {
      setTab("identity");
      return setError(slugError);
    }
    setSaving(true);
    try {
      const channels = (draft.contact_channels as Array<Record<string, unknown>>).filter(
        (c) => c.id === "primary" || (String(c.label ?? "").trim() && String(c.phone ?? "").replace(/\D/g, "").length >= 8),
      );
      const fields = {
        slug: draft.slug,
        name: draft.name.trim(),
        headline: draft.headline?.trim() || null,
        description: draft.description?.trim() || null,
        logo_url: draft.logo_url,
        banner_url: draft.banner_url,
        theme: draft.theme,
        price_level: draft.price_level,
        fallback_price_level: draft.fallback_price_level,
        wholesale_rules: draft.wholesale_rules,
        access_key: draft.access_key,
        point_id: draft.point_id,
        include_all_products: draft.include_all_products,
        show_stock: draft.show_stock,
        whatsapp: draft.whatsapp?.trim() || null,
        contact_channels: channels.length === 1 && channels[0].id === "primary" ? [] : channels,
        locations: draft.locations.filter((l) => l.name.trim()),
        links: draft.links.filter((l) => l.url.trim()),
        address: draft.address?.trim() || null,
        city: draft.city?.trim() || null,
        phone: draft.phone?.trim() || null,
        email: draft.email?.trim() || null,
        footer_note: draft.footer_note?.trim() || null,
        active: draft.active,
      };
      const { data, error: updateError } = await supabaseBrowser().from("store_catalogs").update(fields).eq("id", catalogId).select(CATALOG_COLUMNS).single();
      if (updateError) throw updateError.code === "23505" ? new Error("Otro catálogo ya usa este enlace.") : updateError;
      await saveCategories();
      await saveProducts();
      const fresh = normalizeCatalog(data as unknown as StoreCatalog);
      setOriginal(fresh);
      setDraft(fresh);
      setProductsRefresh((n) => n + 1);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (dirty) {
      const result = await Swal.fire({
        ...swalTheme,
        icon: "warning",
        title: "Tienes cambios sin guardar",
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: "Guardar y salir",
        denyButtonText: "Salir sin guardar",
        cancelButtonText: "Seguir editando",
      });
      if (result.isConfirmed) {
        await save();
        onClose();
      } else if (result.isDenied) {
        onClose();
      }
      return;
    }
    onClose();
  }

  async function toggleIncludeAll(next: boolean) {
    patch({ include_all_products: next });
    const { error: updateError } = await supabaseBrowser().from("store_catalogs").update({ include_all_products: next }).eq("id", catalogId);
    if (updateError) return setError(updateError.message);
    setOriginal((current) => (current ? { ...current, include_all_products: next } : current));
    setProductsRefresh((n) => n + 1);
  }

  async function bulk(action: "include" | "exclude", category: string | null, q: string, stock: "all" | "with" | "without") {
    await saveProducts();
    const { error: rpcError } = await supabaseBrowser().rpc("catalog_admin_bulk", {
      p_catalog: catalogId,
      p_action: action,
      p_category: category,
      p_q: q || null,
      p_stock: stock,
    });
    if (rpcError) throw rpcError;
    setProductsRefresh((n) => n + 1);
  }

  const point = warehouses.find((w) => w.id === draft?.point_id) ?? null;
  const savedPoint = warehouses.find((w) => w.id === original?.point_id) ?? null;
  const sample = samples[0];
  const link = draft ? `${typeof window !== "undefined" ? window.location.origin : ""}${catalogPath(store.slug, draft)}` : "";

  return (
    <motion.div
      className="fixed inset-0 z-[95] flex items-stretch justify-center sm:p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: "color-mix(in oklab, black 60%, transparent)", backdropFilter: "blur(6px)" }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden border sm:rounded-3xl"
        style={{ background: "color-mix(in oklab, var(--t-bg-base) 94%, var(--t-card-bg))", borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Editar catálogo"
      >
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {draft?.logo_url || store.logo_url ? (
              <img src={draft?.logo_url || store.logo_url || ""} alt="" className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--t-cta)" }}><StoreIcon size={18} className="text-white" /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-black">{draft?.name || "Catálogo"}</p>
              <p className="truncate font-mono text-[11px]" style={{ color: "var(--t-muted)" }}>/{store.slug}/{draft?.slug}</p>
            </div>
          </div>
          {draft ? (
            <a href={catalogPath(store.slug, draft)} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold sm:inline-flex" style={softBox}>
              <ExternalLink size={14} /> Ver catálogo
            </a>
          ) : null}
          <button type="button" onClick={() => void close()} className="grid h-10 w-10 place-items-center rounded-full border transition hover:rotate-90" style={softBox} aria-label="Cerrar editor">
            <X size={18} />
          </button>
          <nav className="flex w-full gap-1.5 overflow-x-auto pb-0.5" aria-label="Secciones del catálogo">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold sm:text-sm"
                style={tab === t.key ? { color: "#fff" } : { color: "var(--t-text)" }}
              >
                {tab === t.key ? <motion.span layoutId="catalog-tab" className="absolute inset-0 rounded-full" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 380, damping: 30 }} /> : null}
                <span className="relative inline-flex items-center gap-1.5">{t.icon}{t.label}</span>
              </button>
            ))}
          </nav>
        </header>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {error ? (
              <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-2xl border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", background: "color-mix(in oklab, #ef4444 10%, transparent)" }}>
                <span>{error}</span>
                <button type="button" onClick={() => setError("")} aria-label="Cerrar"><X size={15} /></button>
              </div>
            ) : null}

            {loading || !draft ? (
              <div className="grid h-64 place-items-center"><Loader2 className="animate-spin" style={{ color: "var(--t-accent)" }} /></div>
            ) : (
              <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {tab === "identity" ? (
                  <div className="space-y-4">
                    <Section title="Nombre y enlace" hint="Así aparece el catálogo y así lo compartes." icon={<StoreIcon size={18} />}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nombre del catálogo">
                          <input className={inputCls} style={inputStyle} value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
                        </Field>
                        <Field label="Enlace" hint={slugError || (slugChanged ? "Al guardar, el enlace anterior dejará de funcionar." : undefined)}>
                          <div className="flex items-center overflow-hidden rounded-xl border" style={{ ...inputStyle, borderColor: slugError ? "#ef4444" : inputStyle.borderColor }}>
                            <span className="shrink-0 truncate pl-3 font-mono text-xs" style={{ color: "var(--t-muted)" }}>/{store.slug}/</span>
                            <input className="min-w-0 flex-1 bg-transparent px-1 py-2.5 font-mono text-sm outline-none" value={draft.slug} maxLength={48} onChange={(e) => patch({ slug: catalogSlug(e.target.value) })} />
                          </div>
                        </Field>
                        <Field label="Frase corta" className="sm:col-span-2">
                          <input className={inputCls} style={inputStyle} value={draft.headline ?? ""} maxLength={140} onChange={(e) => patch({ headline: e.target.value || null })} placeholder="Ej. Precios especiales para la sede San Roque" />
                        </Field>
                        <Field label="Descripción (al pie del catálogo)" className="sm:col-span-2">
                          <textarea className={`${inputCls} min-h-20`} style={inputStyle} value={draft.description ?? ""} maxLength={600} onChange={(e) => patch({ description: e.target.value || null })} />
                        </Field>
                      </div>
                      <div className="mt-3">
                        <ToggleRow title="Catálogo activo" hint={draft.active ? "Tus clientes pueden abrirlo y hacer pedidos." : "Pausado: el enlace muestra que no está disponible."} checked={draft.active} onChange={(next) => patch({ active: next })} icon={<Eye size={17} />} />
                      </div>
                    </Section>

                    <Section title="Logo y portada" hint="Si no subes nada, se usan los de tu tienda." icon={<ImageIcon size={18} />}>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <ImageUpload label="Logo del catálogo" currentUrl={draft.logo_url} pathPrefix={`${store.id}/catalogs/${catalogId}/`} fileName="logo.png" onUploaded={(url) => patch({ logo_url: url })} />
                          {draft.logo_url ? <button type="button" onClick={() => patch({ logo_url: null })} className="mt-1 text-xs underline" style={{ color: "var(--t-muted)" }}>Usar el logo de la tienda</button> : null}
                        </div>
                        <div>
                          <ImageUpload label="Portada (carrusel sin campañas)" currentUrl={draft.banner_url} pathPrefix={`${store.id}/catalogs/${catalogId}/`} fileName="banner.png" onUploaded={(url) => patch({ banner_url: url })} />
                          {draft.banner_url ? <button type="button" onClick={() => patch({ banner_url: null })} className="mt-1 text-xs underline" style={{ color: "var(--t-muted)" }}>Usar la portada de la tienda</button> : null}
                        </div>
                      </div>
                    </Section>

                    <Section title="Tema de colores" hint="Elige cómo se ve este catálogo." icon={<Palette size={18} />}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        <button
                          type="button"
                          onClick={() => patch({ theme: null })}
                          className="rounded-2xl border-2 p-2 text-left text-xs font-semibold"
                          style={{ borderColor: !draft.theme ? "var(--t-accent)" : "var(--t-card-border)" }}
                        >
                          <span className="mb-1.5 grid h-10 place-items-center rounded-xl" style={{ background: "var(--t-card-bg-soft)" }}><StoreIcon size={16} /></span>
                          Igual a la tienda
                        </button>
                        {themes.map((t) => {
                          const sw = themeSwatch(t);
                          const selected = draft.theme === t.id;
                          return (
                            <button key={t.id} type="button" onClick={() => patch({ theme: t.id })} className="relative rounded-2xl border-2 p-2 text-left text-xs font-semibold" style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)" }}>
                              <span className="mb-1.5 flex h-10 overflow-hidden rounded-xl" style={{ background: sw.bg }}>
                                <span className="m-auto h-5 w-5 rounded-full" style={{ background: sw.accent }} />
                                <span className="m-auto h-5 w-5 rounded-full" style={{ background: sw.accent2 }} />
                              </span>
                              <span className="line-clamp-1">{t.name}</span>
                              {selected ? <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }}><Check size={12} /></span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </Section>
                  </div>
                ) : null}

                {tab === "pricing" ? (
                  <div className="space-y-4">
                    <Section title="Precio de este catálogo" hint="Todos los productos se muestran con la lista que elijas." icon={<BadgeDollarSign size={18} />}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {PRICE_LEVELS.map((p) => {
                          const selected = draft.price_level === p.level;
                          const example = sample ? productPriceForLevel(sample, p.level) : 0;
                          return (
                            <motion.button key={p.level} type="button" whileTap={{ scale: 0.97 }} onClick={() => patch({ price_level: p.level })} className="rounded-2xl border-2 p-3 text-left" style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)", background: selected ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent" }}>
                              <span className="block text-lg font-black">P{p.level}</span>
                              <span className="block text-xs font-semibold">{p.hint}</span>
                              {sample ? <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>Ej.: {example > 0 ? money(example) : "sin precio"}</span> : null}
                            </motion.button>
                          );
                        })}
                      </div>
                      {sample ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Ejemplo con “{sample.name}”.</p> : null}
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Si un producto no tiene ese precio" hint="Usa otra lista como respaldo en lugar de ocultarlo.">
                          <select className={inputCls} style={inputStyle} value={draft.fallback_price_level ?? ""} onChange={(e) => patch({ fallback_price_level: e.target.value ? (Number(e.target.value) as PriceLevel) : null })}>
                            <option value="">Ocultar el producto</option>
                            {PRICE_LEVELS.filter((p) => p.level !== draft.price_level).map((p) => <option key={p.level} value={p.level}>Usar {p.label} ({p.hint})</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="mt-3">
                        <ToggleRow title="Exigir mínimos de mayor" hint="Cada producto pide su cantidad mínima de compra (Mínimo Mayor)." checked={draft.wholesale_rules} onChange={(next) => patch({ wholesale_rules: next })} icon={<LayoutList size={17} />} />
                      </div>
                    </Section>

                    <Section title="Acceso" hint="Decide quién puede ver este catálogo." icon={<Lock size={18} />}>
                      <ToggleRow
                        title="Catálogo privado"
                        hint={draft.access_key ? "Solo se abre con el enlace que incluye la clave." : "Cualquiera con el enlace puede verlo."}
                        checked={Boolean(draft.access_key)}
                        onChange={(next) => patch({ access_key: next ? draft.access_key || generateCatalogKey() : null })}
                        icon={<KeyRound size={17} />}
                      />
                      {draft.access_key ? (
                        <div className="mt-3 rounded-2xl border p-3" style={softBox}>
                          <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Enlace privado para compartir</p>
                          <p className="mt-1 break-all font-mono text-xs">{link}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(link).then(() => Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: "Enlace copiado", timer: 1300, showConfirmButton: false }))}
                              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
                              style={{ background: "var(--t-cta)" }}
                            >
                              <Copy size={14} /> Copiar enlace
                            </button>
                            <button type="button" onClick={() => patch({ access_key: generateCatalogKey() })} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={softBox}>
                              <RefreshCw size={14} /> Cambiar clave
                            </button>
                          </div>
                          <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Si cambias la clave, el enlace anterior deja de funcionar al guardar.</p>
                        </div>
                      ) : null}
                    </Section>

                    <Section title="Inventario" hint="Qué existencias muestra y vende este catálogo." icon={<MapPin size={18} />}>
                      <Field label="Punto o bodega del catálogo" hint={draft.point_id ? "Solo se muestran los productos con unidades en este lugar (los agotados se ocultan solos) y los pedidos se descuentan de ahí al confirmarlos." :"Se muestra el inventario total; al confirmar se descuenta primero de la bodega principal."}>
                        <select className={inputCls} style={inputStyle} value={draft.point_id ?? ""} onChange={(e) => patch({ point_id: e.target.value || null })}>
                          <option value="">Inventario total de la tienda</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.kind === "point" ? "📍" : "🏬"} {w.name}</option>)}
                        </select>
                      </Field>
                      <div className="mt-3">
                        <ToggleRow title="Mostrar unidades disponibles" hint="Si lo apagas, tus clientes no ven cuántas unidades quedan (igual no pueden pedir más de las que hay)." checked={draft.show_stock} onChange={(next) => patch({ show_stock: next })} icon={<Boxes size={17} />} />
                      </div>
                    </Section>
                  </div>
                ) : null}

                {tab === "products" ? (
                  <ProductsTab
                    key={original?.point_id ?? "total"}
                    catalogId={catalogId}
                    draft={draft}
                    onToggleIncludeAll={(next) => void toggleIncludeAll(next)}
                    baseCategories={baseCategories.filter((c) => c.active)}
                    catalogCategories={[...categoryRows].sort((a, b) => a.sort_order - b.sort_order).map((r) => ({ id: r.id, name: categoryDisplayName(r, baseMap) }))}
                    categoryRows={categoryRows}
                    edits={productEdits}
                    setEdit={(productId, row) => setProductEdits((current) => ({ ...current, [productId]: row }))}
                    refreshKey={productsRefresh}
                    onBulk={bulk}
                    pointName={savedPoint?.name ?? null}
                    pointPending={(draft.point_id ?? null) !== (original?.point_id ?? null)}
                  />
                ) : null}

                {tab === "categories" ? (
                  <CategoriesTab storeId={store.id} catalogId={catalogId} rows={categoryRows} setRows={setCategoryRows} baseCategories={baseCategories} />
                ) : null}

                {tab === "contact" ? (
                  <ContactTab
                    storeId={store.id}
                    draft={draft}
                    patch={patch}
                    storeWhatsapp={store.whatsapp}
                    storeChannels={storeChannels}
                    storeLocations={storeLocations}
                    storeLinks={storeLinks}
                  />
                ) : null}
              </motion.div>
            )}
          </div>

          <aside className="hidden min-h-0 overflow-y-auto border-l px-5 py-5 xl:block" style={{ borderColor: "var(--t-card-border)" }}>
            {draft ? (
              <CatalogPreview
                draft={draft}
                storeName={store.name}
                storeLogo={store.logo_url}
                storeBanner={store.banner_url}
                theme={themes.find((t) => t.id === (draft.theme || store.theme))}
                categories={visibleCategories}
                products={previewItems}
                pointName={point?.name ?? null}
              />
            ) : null}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5" style={{ borderColor: "var(--t-card-border)" }}>
          <p className="text-xs" style={{ color: dirty ? "var(--t-text)" : "var(--t-muted)" }}>
            {savedFlash ? "✅ Cambios guardados" : dirty ? "● Tienes cambios sin guardar" : "Todo está guardado"}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void close()} className="rounded-2xl border px-4 py-2.5 text-sm font-semibold" style={softBox}>Cerrar</button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={saving || !dirty}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50"
              style={{ background: "var(--t-cta)" }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar cambios
            </motion.button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
