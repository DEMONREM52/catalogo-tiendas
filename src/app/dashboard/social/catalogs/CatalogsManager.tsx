"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeDollarSign,
  Copy,
  ExternalLink,
  LayoutGrid,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import { QrCode } from "lucide-react";
import { QrDialog } from "@/components/pwa/QrDialog";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission, type DashboardStore } from "@/lib/store-utils";
import {
  CATALOG_COLUMNS,
  CATALOG_TEMPLATES,
  PRICE_LEVELS,
  catalogPath,
  catalogSlug,
  generateCatalogKey,
  isValidCatalogSlug,
  type PriceLevel,
  type StoreCatalog,
} from "@/lib/catalogs";
import { CatalogEditor, type ThemeOption, type WarehouseOption } from "./CatalogEditor";
import { Pill, Switch, errorText, inputCls, inputStyle, softBox, swalTheme } from "./ui";

type Summary = { catalog_id: string; products: number; available: number; without_price: number; orders_30d: number };

function isMissingTable(error: unknown) {
  const message = errorText(error).toLowerCase();
  return message.includes("store_catalogs") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

export default function CatalogsManager() {
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [qrFor, setQrFor] = useState<StoreCatalog | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [catalogs, setCatalogs] = useState<StoreCatalog[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missingMigration, setMissingMigration] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const access = await getDashboardStore();
      if (!access.store) throw new Error("No se encontró la tienda de esta sesión.");
      setStore(access.store);
      setCanEdit(hasStorePermission(access, "products"));
      const sb = supabaseBrowser();
      const [catalogsRes, whRes, themesRes, summaryRes] = await Promise.all([
        sb.from("store_catalogs").select(CATALOG_COLUMNS).eq("store_id", access.store.id).order("sort_order").order("created_at"),
        sb.from("erp_warehouses").select("id,name,kind,active,logo_url,address,city,phone").eq("store_id", access.store.id).order("name"),
        sb.from("themes").select("id,name,config").eq("active", true).order("sort_order"),
        sb.rpc("catalog_admin_summary", { p_store: access.store.id }),
      ]);
      if (catalogsRes.error) {
        if (isMissingTable(catalogsRes.error)) {
          setMissingMigration(true);
          return;
        }
        throw catalogsRes.error;
      }
      setMissingMigration(false);
      setCatalogs((catalogsRes.data ?? []) as unknown as StoreCatalog[]);
      setWarehouses(((whRes.data ?? []) as WarehouseOption[]).filter((w) => w.active));
      setThemes((themesRes.data ?? []) as ThemeOption[]);
      const map: Record<string, Summary> = {};
      for (const row of (summaryRes.data ?? []) as Summary[]) map[row.catalog_id] = row;
      setSummaries(map);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = catalogs.filter((c) => c.active).length;
    const orders = Object.values(summaries).reduce((sum, s) => sum + Number(s.orders_30d ?? 0), 0);
    return { total: catalogs.length, active, orders };
  }, [catalogs, summaries]);

  async function createCatalog(input: {
    name: string;
    slug: string;
    price_level: PriceLevel;
    wholesale_rules: boolean;
    private: boolean;
    point_id: string | null;
  }) {
    if (!store) return null;
    const sb = supabaseBrowser();
    const { data, error: insertError } = await sb
      .from("store_catalogs")
      .insert({
        store_id: store.id,
        name: input.name.trim(),
        slug: input.slug,
        price_level: input.price_level,
        fallback_price_level: input.price_level === 3 ? null : 3,
        wholesale_rules: input.wholesale_rules,
        access_key: input.private ? (input.slug === "mayor" && store.wholesale_key ? store.wholesale_key : generateCatalogKey()) : null,
        point_id: input.point_id,
        sort_order: catalogs.length,
      })
      .select("id")
      .single();
    if (insertError) {
      const duplicated = insertError.code === "23505";
      throw new Error(duplicated ? "Ya tienes un catálogo con ese enlace. Usa otro nombre de enlace." : insertError.message);
    }
    const { data: baseCategories } = await sb
      .from("product_categories")
      .select("id,sort_order")
      .eq("store_id", store.id)
      .eq("active", true);
    if (baseCategories?.length) {
      await sb.from("store_catalog_categories").insert(
        baseCategories.map((category) => ({
          catalog_id: data.id,
          store_id: store.id,
          category_id: category.id,
          sort_order: category.sort_order ?? 0,
        })),
      );
    }
    return data.id as string;
  }

  async function seedClassicCatalogs() {
    if (!store) return;
    setBusyId("seed");
    try {
      const existing = new Set(catalogs.map((c) => c.slug));
      if (!existing.has("detal")) {
        await createCatalog({ name: "Detal", slug: "detal", price_level: 3, wholesale_rules: false, private: false, point_id: null });
      }
      if (!existing.has("mayor")) {
        await createCatalog({ name: "Por mayor", slug: "mayor", price_level: 2, wholesale_rules: true, private: true, point_id: null });
      }
      await load();
      void Swal.fire({
        ...swalTheme,
        icon: "success",
        title: "Catálogos listos",
        text: "Tus enlaces /detal y /mayor siguen funcionando igual; ahora puedes personalizarlos aquí.",
      });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(catalog: StoreCatalog) {
    setBusyId(catalog.id);
    const { error: updateError } = await supabaseBrowser().from("store_catalogs").update({ active: !catalog.active }).eq("id", catalog.id);
    setBusyId(null);
    if (updateError) return setError(updateError.message);
    setCatalogs((current) => current.map((c) => (c.id === catalog.id ? { ...c, active: !c.active } : c)));
  }

  async function copyLink(catalog: StoreCatalog) {
    if (!store) return;
    const url = `${origin}${catalogPath(store.slug, catalog)}`;
    try {
      await navigator.clipboard.writeText(url);
      void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: "Enlace copiado", timer: 1400, showConfirmButton: false });
    } catch {
      window.prompt("Copia el enlace:", url);
    }
  }

  function shareWhatsApp(catalog: StoreCatalog) {
    if (!store) return;
    const url = `${origin}${catalogPath(store.slug, catalog)}`;
    const text = `🛍️ ${catalog.name} · ${store.name}\nMira nuestro catálogo y haz tu pedido aquí:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  async function duplicate(catalog: StoreCatalog) {
    const result = await Swal.fire({
      ...swalTheme,
      title: `Duplicar "${catalog.name}"`,
      html: `
        <p style="font-size:13px;opacity:.75;margin-bottom:10px">Se copian diseño, contactos, categorías y productos. La copia queda pausada para que la revises.</p>
        <input id="dup-name" class="swal2-input" placeholder="Nombre del nuevo catálogo" value="${catalog.name.replace(/"/g, "&quot;")} copia" />
        <select id="dup-price" class="swal2-select" style="display:flex;margin:12px auto 0">
          ${PRICE_LEVELS.map((p) => `<option value="${p.level}" ${p.level === catalog.price_level ? "selected" : ""}>${p.label} · ${p.hint}</option>`).join("")}
        </select>`,
      showCancelButton: true,
      confirmButtonText: "Duplicar",
      cancelButtonText: "Cancelar",
      preConfirm: () => {
        const name = (document.getElementById("dup-name") as HTMLInputElement | null)?.value.trim() ?? "";
        const price = Number((document.getElementById("dup-price") as HTMLSelectElement | null)?.value ?? catalog.price_level);
        if (name.length < 2) {
          Swal.showValidationMessage("Escribe un nombre de al menos 2 letras.");
          return false;
        }
        let slug = catalogSlug(name) || "catalogo";
        const used = new Set(catalogs.map((c) => c.slug));
        for (let i = 2; used.has(slug) || !isValidCatalogSlug(slug); i += 1) slug = `${catalogSlug(name).slice(0, 44) || "catalogo"}-${i}`;
        return { name, price, slug };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    setBusyId(catalog.id);
    const { data, error: rpcError } = await supabaseBrowser().rpc("catalog_admin_duplicate", {
      p_catalog: catalog.id,
      p_name: result.value.name,
      p_slug: result.value.slug,
      p_price_level: result.value.price,
    });
    setBusyId(null);
    if (rpcError) return setError(rpcError.message);
    await load();
    setEditingId(data as string);
  }

  async function remove(catalog: StoreCatalog) {
    const result = await Swal.fire({
      ...swalTheme,
      icon: "warning",
      title: `Eliminar "${catalog.name}"`,
      html: `<p style="font-size:14px">El enlace dejará de funcionar. Los productos y pedidos no se borran.</p><p style="font-size:13px;opacity:.75;margin-top:8px">Escribe <b>${catalog.slug}</b> para confirmar.</p>`,
      input: "text",
      showCancelButton: true,
      confirmButtonText: "Eliminar catálogo",
      cancelButtonText: "Conservar",
      confirmButtonColor: "#e11d48",
      preConfirm: (value) => {
        if (String(value).trim().toLowerCase() !== catalog.slug) {
          Swal.showValidationMessage("El texto no coincide.");
          return false;
        }
        return true;
      },
    });
    if (!result.isConfirmed) return;
    setBusyId(catalog.id);
    const { error: deleteError } = await supabaseBrowser().from("store_catalogs").delete().eq("id", catalog.id);
    setBusyId(null);
    if (deleteError) return setError(deleteError.message);
    setCatalogs((current) => current.filter((c) => c.id !== catalog.id));
  }

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg-soft)" }} />)}
      </div>
    );
  }

  if (missingMigration) {
    return (
      <div className="rounded-3xl border border-dashed p-6 text-sm" style={{ borderColor: "var(--t-accent)" }}>
        <p className="text-base font-bold">Activa los catálogos múltiples</p>
        <p className="mt-1" style={{ color: "var(--t-muted)" }}>
          Ejecuta en Supabase (SQL Editor) el archivo <b>supabase/migrations/20261014_catalogs_reports.sql</b> y recarga esta página.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border p-5 sm:p-7" style={softBox}>
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 22%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>
              <LayoutGrid size={15} /> Catálogos
            </p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">Un catálogo para cada público</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              Crea catálogos con su propio precio (Precio 1 a 5), logo, portada, campañas, categorías, contactos y punto de inventario. Cada uno tiene su enlace para compartir.
            </p>
          </div>
          {canEdit ? (
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg"
              style={{ background: "var(--t-cta)" }}
            >
              <Plus size={17} /> Nuevo catálogo
            </motion.button>
          ) : null}
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2 sm:max-w-lg">
          {[
            { label: "Catálogos", value: stats.total, icon: <LayoutGrid size={15} /> },
            { label: "Activos", value: stats.active, icon: <Sparkles size={15} /> },
            { label: "Pedidos 30 días", value: stats.orders, icon: <ShoppingBag size={15} /> },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border px-3 py-2.5" style={softBox}>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>{s.icon} {s.label}</p>
              <p className="mt-0.5 text-xl font-black">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm" style={{ borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", background: "color-mix(in oklab, #ef4444 10%, transparent)" }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Cerrar"><X size={16} /></button>
        </div>
      ) : null}

      {catalogs.length === 0 ? (
        <section className="rounded-3xl border p-6 text-center sm:p-10" style={softBox}>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl text-3xl" style={{ background: "var(--t-cta)" }}>🛍️</div>
          <h3 className="mt-4 text-xl font-black">Aún no tienes catálogos personalizados</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: "var(--t-muted)" }}>
            Empieza con tus catálogos de siempre (Detal con Precio 3 y Por mayor con Precio 2) o crea uno nuevo desde una plantilla.
          </p>
          {canEdit ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={busyId === "seed"}
                onClick={() => void seedClassicCatalogs()}
                className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60"
                style={{ background: "var(--t-cta)" }}
              >
                {busyId === "seed" ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Crear Detal y Por mayor
              </button>
              <button type="button" onClick={() => setCreating(true)} className="rounded-2xl border px-5 py-3 text-sm font-semibold" style={softBox}>
                Elegir plantilla
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {catalogs.map((catalog, index) => {
              const summary = summaries[catalog.id];
              const point = warehouses.find((w) => w.id === catalog.point_id);
              const level = PRICE_LEVELS.find((p) => p.level === catalog.price_level);
              const logo = catalog.logo_url || store?.logo_url;
              const banner = catalog.banner_url || store?.banner_url;
              return (
                <motion.article
                  key={catalog.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 6) * 0.04 } }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  whileHover={{ y: -3 }}
                  className="group overflow-hidden rounded-3xl border shadow-sm transition-shadow hover:shadow-xl"
                  style={{ ...softBox, opacity: catalog.active ? 1 : 0.72 }}
                >
                  <div className="relative h-28 overflow-hidden" style={{ background: "var(--t-cta)" }}>
                    {banner ? <img src={banner} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                    <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-black/40 px-2 py-1 backdrop-blur">
                      <span className="text-[11px] font-semibold text-white">{catalog.active ? "Activo" : "Pausado"}</span>
                      <Switch checked={catalog.active} onChange={() => void toggleActive(catalog)} label={`Activar ${catalog.name}`} disabled={!canEdit || busyId === catalog.id} />
                    </div>
                  </div>
                  <div className="relative px-4 pb-4">
                    <div className="-mt-8 flex items-end gap-3">
                      {logo ? (
                        <img src={logo} alt="" className="h-16 w-16 rounded-2xl border-4 bg-white object-cover shadow" style={{ borderColor: "var(--t-bg-base)" }} />
                      ) : (
                        <span className="grid h-16 w-16 place-items-center rounded-2xl border-4 text-2xl shadow" style={{ borderColor: "var(--t-bg-base)", background: "var(--t-card-bg)" }}>🛍️</span>
                      )}
                      <div className="min-w-0 pb-1">
                        <h3 className="truncate text-lg font-black">{catalog.name}</h3>
                        <p className="truncate font-mono text-[11px]" style={{ color: "var(--t-muted)" }}>/{store?.slug}/{catalog.slug}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Pill tone="accent"><BadgeDollarSign size={12} /> {level?.label} · {level?.hint}</Pill>
                      {catalog.access_key ? <Pill tone="warn"><Lock size={12} /> Privado</Pill> : <Pill tone="good">Público</Pill>}
                      {point ? <Pill><MapPin size={12} /> {point.name}</Pill> : <Pill>Inventario total</Pill>}
                      {catalog.wholesale_rules ? <Pill>Mínimos de mayor</Pill> : null}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl border px-2 py-2" style={softBox} title={point ? `Productos que se ven: los del catálogo con unidades en ${point.name}` : "Productos que se ven en el catálogo"}>
                        <p className="text-base font-black">{summary?.available ?? "—"}</p>
                        <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>{point ? "con unidades" : "disponibles"}</p>
                      </div>
                      <div className="rounded-xl border px-2 py-2" style={softBox}>
                        <p className="text-base font-black">{summary?.orders_30d ?? 0}</p>
                        <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>pedidos 30 d</p>
                      </div>
                      <div className="rounded-xl border px-2 py-2" style={softBox} title="Productos del catálogo sin precio en este nivel">
                        <p className="text-base font-black">{summary?.without_price ?? 0}</p>
                        <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>sin precio</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditingId(catalog.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
                          style={{ background: "var(--t-cta)" }}
                        >
                          <Pencil size={14} /> Editar
                        </button>
                      ) : null}
                      <a
                        href={store ? catalogPath(store.slug, catalog) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-9 w-9 place-items-center rounded-xl border"
                        style={softBox}
                        title="Abrir catálogo"
                        aria-label="Abrir catálogo"
                      >
                        <ExternalLink size={15} />
                      </a>
                      <button type="button" onClick={() => void copyLink(catalog)} className="grid h-9 w-9 place-items-center rounded-xl border" style={softBox} title="Copiar enlace" aria-label="Copiar enlace">
                        <Copy size={15} />
                      </button>
                      <button type="button" onClick={() => shareWhatsApp(catalog)} className="grid h-9 w-9 place-items-center rounded-xl border" style={softBox} title="Enviar por WhatsApp" aria-label="Enviar por WhatsApp">
                        <MessageCircle size={15} />
                      </button>
                      <button type="button" onClick={() => setQrFor(catalog)} className="grid h-9 w-9 place-items-center rounded-xl border" style={softBox} title="Código QR del catálogo" aria-label="Código QR del catálogo">
                        <QrCode size={15} />
                      </button>
                      {canEdit ? (
                        <>
                          <button type="button" disabled={busyId === catalog.id} onClick={() => void duplicate(catalog)} className="grid h-9 w-9 place-items-center rounded-xl border disabled:opacity-50" style={softBox} title="Duplicar" aria-label="Duplicar">
                            <Sparkles size={15} />
                          </button>
                          <button type="button" disabled={busyId === catalog.id} onClick={() => void remove(catalog)} className="grid h-9 w-9 place-items-center rounded-xl border text-rose-500 disabled:opacity-50" style={softBox} title="Eliminar" aria-label="Eliminar">
                            <Trash2 size={15} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {creating && store ? (
          <CreateCatalogDialog
            existingSlugs={catalogs.map((c) => c.slug)}
            warehouses={warehouses}
            onClose={() => setCreating(false)}
            onCreate={async (input) => {
              const id = await createCatalog(input);
              setCreating(false);
              await load();
              if (id) setEditingId(id);
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {editingId && store ? (
          <CatalogEditor
            key={editingId}
            catalogId={editingId}
            store={store}
            warehouses={warehouses}
            themes={themes}
            otherSlugs={catalogs.filter((c) => c.id !== editingId).map((c) => c.slug)}
            onClose={() => {
              setEditingId(null);
              void load();
            }}
          />
        ) : null}
      </AnimatePresence>
      <QrDialog
        open={Boolean(qrFor && store)}
        onClose={() => setQrFor(null)}
        path={qrFor && store ? catalogPath(store.slug, qrFor) : "/"}
        title={qrFor?.name ?? "Catálogo"}
        subtitle="Imprímelo o compártelo: al escanearlo se abre este catálogo."
      />
    </div>
  );
}

function CreateCatalogDialog({
  existingSlugs,
  warehouses,
  onClose,
  onCreate,
}: {
  existingSlugs: string[];
  warehouses: WarehouseOption[];
  onClose: () => void;
  onCreate: (input: { name: string; slug: string; price_level: PriceLevel; wholesale_rules: boolean; private: boolean; point_id: string | null }) => Promise<void>;
}) {
  const [template, setTemplate] = useState(CATALOG_TEMPLATES[0].key);
  const [name, setName] = useState(CATALOG_TEMPLATES[0].name);
  const [slug, setSlug] = useState(CATALOG_TEMPLATES[0].slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [priceLevel, setPriceLevel] = useState<PriceLevel>(3);
  const [rules, setRules] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [pointId, setPointId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const slugTaken = existingSlugs.includes(slug);
  const slugValid = isValidCatalogSlug(slug) && !slugTaken;

  function pick(key: string) {
    const t = CATALOG_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setTemplate(key);
    setName(t.name);
    setPriceLevel(t.price_level);
    setRules(t.wholesale_rules);
    setIsPrivate(t.private);
    if (!slugTouched) setSlug(t.slug);
    if (key !== "sede") setPointId("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Escribe un nombre de al menos 2 letras.");
    if (!slugValid) return setError(slugTaken ? "Ese enlace ya lo usa otro catálogo." : "El enlace solo puede tener letras, números y guiones.");
    setSaving(true);
    try {
      await onCreate({ name, slug, price_level: priceLevel, wholesale_rules: rules, private: isPrivate, point_id: pointId || null });
    } catch (cause) {
      setError(errorText(cause));
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-end justify-center p-2 sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ background: "color-mix(in oklab, black 55%, transparent)", backdropFilter: "blur(6px)" }}
    >
      <motion.form
        onSubmit={(e) => void submit(e)}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border p-5 sm:p-6"
        style={{ background: "color-mix(in oklab, var(--t-bg-base) 92%, var(--t-card-bg))", borderColor: "var(--t-card-border)", color: "var(--t-text)", boxShadow: "0 30px 90px rgba(0,0,0,.45)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Nuevo catálogo</h2>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>Elige una plantilla; después podrás personalizar todo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full border" style={softBox}><X size={16} /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CATALOG_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              className="rounded-2xl border-2 p-3 text-left transition"
              style={{ borderColor: template === t.key ? "var(--t-accent)" : "var(--t-card-border)", background: template === t.key ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent" }}
            >
              <span className="text-2xl">{t.icon}</span>
              <span className="mt-1 block text-sm font-bold">{t.name}</span>
              <span className="block text-[11px] leading-tight" style={{ color: "var(--t-muted)" }}>{t.description}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Nombre del catálogo</span>
            <input
              className={`${inputCls} mt-1`}
              style={inputStyle}
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(catalogSlug(e.target.value));
              }}
              placeholder="Ej. San Roque"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Enlace</span>
            <input
              className={`${inputCls} mt-1 font-mono`}
              style={{ ...inputStyle, borderColor: slugValid ? inputStyle.borderColor : "#ef4444" }}
              value={slug}
              maxLength={48}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(catalogSlug(e.target.value));
              }}
            />
            <span className="mt-1 block text-[11px]" style={{ color: slugValid ? "var(--t-muted)" : "#ef4444" }}>
              {slugTaken ? "Ya existe un catálogo con este enlace." : "Solo letras, números y guiones."}
            </span>
          </label>
        </div>

        <p className="mt-4 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Precio que verán tus clientes</p>
        <div className="mt-1 grid grid-cols-5 gap-1.5">
          {PRICE_LEVELS.map((p) => (
            <button
              key={p.level}
              type="button"
              onClick={() => setPriceLevel(p.level)}
              className="rounded-xl border-2 px-1 py-2 text-center"
              style={{ borderColor: priceLevel === p.level ? "var(--t-accent)" : "var(--t-card-border)", background: priceLevel === p.level ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent" }}
            >
              <span className="block text-sm font-black">P{p.level}</span>
              <span className="block text-[10px]" style={{ color: "var(--t-muted)" }}>{p.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm" style={softBox}>
            <span><b>Privado</b><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Solo con el enlace que incluye la clave</span></span>
            <Switch checked={isPrivate} onChange={setIsPrivate} label="Catálogo privado" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm" style={softBox}>
            <span><b>Mínimos de mayor</b><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Exige la cantidad mínima por producto</span></span>
            <Switch checked={rules} onChange={setRules} label="Mínimos de mayor" />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Inventario que muestra y vende</span>
          <select className={`${inputCls} mt-1`} style={inputStyle} value={pointId} onChange={(e) => setPointId(e.target.value)}>
            <option value="">Inventario total de la tienda</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.kind === "point" ? "📍" : "🏬"} Solo {w.name}</option>)}
          </select>
        </label>

        {error ? <p className="mt-3 rounded-xl border p-2.5 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-2xl border px-5 py-2.5 text-sm font-semibold" style={softBox}>Cancelar</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "var(--t-cta)" }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Crear y personalizar
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
