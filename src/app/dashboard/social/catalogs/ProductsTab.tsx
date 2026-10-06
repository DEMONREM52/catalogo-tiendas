"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Eye, EyeOff, Loader2, MapPin, PackageMinus, PackagePlus, Search, Star, X } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { catalogPrice, PRICE_LEVELS, productPriceForLevel, type StoreCatalog } from "@/lib/catalogs";
import type { BaseCategory, CatalogCategoryRow, CatalogProductRow } from "./types";
import { Pill, Switch, ToggleRow, errorText, inputCls, inputStyle, money, softBox, swalTheme } from "./ui";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  category_id: string | null;
  stock: number | null;
  cost_price: number | null;
  price_1: number;
  price_2: number;
  price_3: number;
  price_4: number;
  price_5: number;
  price_override: number | null;
  catalog_category_id: string | null;
  featured: boolean;
  in_catalog: boolean;
  catalog_stock: number | null;
  has_stock: boolean;
};

type Counts = { all: number; visible: number; in: number; out: number; special: number; noprice: number; featured: number };
type Filter = keyof Counts;
type StockFilter = "all" | "with" | "without";
type StockCounts = Record<StockFilter, number>;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "visible", label: "Se ven" },
  { key: "in", label: "En el catálogo" },
  { key: "out", label: "Fuera" },
  { key: "special", label: "Precio especial" },
  { key: "featured", label: "Destacados" },
  { key: "noprice", label: "Sin precio" },
];

const PAGE = 40;

function rpcErrorText(error: { code?: string; message: string }) {
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
    return "Falta un paso: ejecuta en Supabase el archivo supabase/migrations/20261015_catalog_point_stock.sql.";
  }
  return error.message;
}

export function ProductsTab({
  catalogId,
  draft,
  onToggleIncludeAll,
  baseCategories,
  catalogCategories,
  categoryRows,
  edits,
  setEdit,
  refreshKey,
  onBulk,
  pointName,
  pointPending,
}: {
  catalogId: string;
  draft: StoreCatalog;
  onToggleIncludeAll: (next: boolean) => void;
  baseCategories: BaseCategory[];
  catalogCategories: Array<{ id: string; name: string }>;
  categoryRows: CatalogCategoryRow[];
  edits: Record<string, CatalogProductRow>;
  setEdit: (productId: string, row: CatalogProductRow) => void;
  refreshKey: number;
  onBulk: (action: "include" | "exclude", category: string | null, q: string, stock: StockFilter) => Promise<void>;
  /** Punto guardado del catálogo: de ahí salen las existencias que se muestran. */
  pointName: string | null;
  pointPending: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [stock, setStock] = useState<StockFilter>(pointName ? "with" : "all");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [stockCounts, setStockCounts] = useState<StockCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void supabaseBrowser()
        .rpc("catalog_admin_products", {
          p_catalog: catalogId,
          p_q: q.trim() || null,
          p_category: category || null,
          p_filter: filter,
          p_stock: stock,
          p_limit: PAGE,
          p_offset: 0,
        })
        .then(({ data, error: rpcError }) => {
          if (!alive) return;
          setLoading(false);
          if (rpcError) return setError(rpcErrorText(rpcError));
          const payload = data as { total: number; items: Item[]; counts: Counts; stock: StockCounts };
          setError("");
          setItems(payload.items ?? []);
          setTotal(payload.total ?? 0);
          setCounts(payload.counts ?? null);
          setStockCounts(payload.stock ?? null);
        });
    }, 260);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [catalogId, q, category, filter, stock, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    const { data, error: rpcError } = await supabaseBrowser().rpc("catalog_admin_products", {
      p_catalog: catalogId,
      p_q: q.trim() || null,
      p_category: category || null,
      p_filter: filter,
      p_stock: stock,
      p_limit: PAGE,
      p_offset: items.length,
    });
    setLoadingMore(false);
    if (rpcError) return setError(rpcErrorText(rpcError));
    const payload = data as { items: Item[] };
    setItems((current) => [...current, ...(payload.items ?? [])]);
  }

  function rowOf(item: Item): CatalogProductRow {
    return edits[item.id] ?? {
      product_id: item.id,
      included: item.in_catalog,
      price_override: item.price_override,
      catalog_category_id: item.catalog_category_id,
      featured: item.featured,
    };
  }

  function patch(item: Item, change: Partial<CatalogProductRow>) {
    setEdit(item.id, { ...rowOf(item), ...change });
  }

  const stockLabels: Record<StockFilter, string> = pointName
    ? { all: "Todas las existencias", with: "Con unidades", without: "Sin unidades" }
    : { all: "Todas las existencias", with: "Con existencias", without: "Agotados" };
  const stockScope: Record<StockFilter, string | null> = pointName
    ? { all: null, with: `con unidades en ${pointName}`, without: `sin unidades en ${pointName}` }
    : { all: null, with: "con existencias", without: "agotados" };

  async function bulk(action: "include" | "exclude") {
    const scope = [
      stockScope[stock],
      category ? "de la categoría seleccionada" : null,
      q.trim() ? `que coinciden con “${q.trim()}”` : null,
    ].filter(Boolean).join(", ");
    const confirm = await Swal.fire({
      ...swalTheme,
      icon: "question",
      title: action === "include" ? "Agregar productos" : "Quitar productos",
      text: `${action === "include" ? "Se agregarán" : "Se quitarán"} todos los productos ${scope || "de la tienda"}. Tus cambios pendientes se guardan antes.`,
      showCancelButton: true,
      confirmButtonText: action === "include" ? "Agregar todos" : "Quitar todos",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;
    setBulkBusy(true);
    try {
      await onBulk(action, category || null, q.trim(), stock);
    } catch (cause) {
      setError(rpcErrorText({ code: (cause as { code?: string } | null)?.code, message: errorText(cause) }));
    } finally {
      setBulkBusy(false);
    }
  }

  const level = PRICE_LEVELS.find((p) => p.level === draft.price_level);
  const pendingCount = useMemo(() => Object.keys(edits).length, [edits]);
  const filtered = Boolean(category || q.trim() || stock !== "all");

  const hiddenCategory = useMemo(() => {
    const byBase = new Map(categoryRows.filter((r) => r.category_id).map((r) => [r.category_id as string, r]));
    const byId = new Map(categoryRows.map((r) => [r.id, r]));
    return (item: Item, row: CatalogProductRow) => {
      const target = row.catalog_category_id ? byId.get(row.catalog_category_id) : item.category_id ? byBase.get(item.category_id) : undefined;
      return target ? !target.visible : false;
    };
  }, [categoryRows]);

  function statusOf(item: Item, row: CatalogProductRow, price: number) {
    if (!row.included) return { tone: "neutral" as const, label: "No está en el catálogo", visible: false };
    if (price <= 0) return { tone: "danger" as const, label: "Oculto: sin precio", visible: false };
    if (item.catalog_stock !== null && item.catalog_stock <= 0) {
      return { tone: "warn" as const, label: pointName ? "Oculto: sin unidades en el punto" : "Oculto: agotado", visible: false };
    }
    if (hiddenCategory(item, row)) return { tone: "neutral" as const, label: "Oculto: categoría oculta", visible: false };
    return { tone: "good" as const, label: "Se ve en el catálogo", visible: true };
  }

  return (
    <div className="space-y-4">
      {pointName ? (
        <div className="flex items-start gap-3 rounded-2xl border p-3.5 text-xs" style={{ ...softBox, borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))" }}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: "var(--t-cta)" }}><MapPin size={16} /></span>
          <p style={{ color: "var(--t-muted)" }}>
            <b style={{ color: "var(--t-text)" }}>Este catálogo vende solo lo que hay en {pointName}.</b>{" "}
            Los productos sin unidades se ocultan solos y vuelven a aparecer cuando llegan por compra, traslado o ajuste.
            {pointPending ? <span className="mt-1 block font-semibold" style={{ color: "var(--t-text)" }}>Cambiaste el punto: guarda para ver las existencias del nuevo.</span> : null}
          </p>
        </div>
      ) : pointPending ? (
        <p className="rounded-2xl border p-3 text-xs font-semibold" style={softBox}>Cambiaste el punto del catálogo: guarda para ver sus existencias aquí.</p>
      ) : null}

      <ToggleRow
        title={pointName ? `Mostrar todo lo que tenga unidades en ${pointName}` : "Mostrar todos los productos de la tienda"}
        hint={draft.include_all_products
          ? pointName
            ? "Aparece todo producto con unidades en el punto, salvo los que quites aquí. Lo que llegue al punto entra solo."
            : "Todo producto activo aparece en este catálogo, salvo los que quites aquí. Los productos nuevos entran solos."
          : pointName
            ? "Solo aparecen los productos que agregues aquí y que tengan unidades en el punto."
            : "Solo aparecen los productos que agregues aquí. Ideal para catálogos especiales."}
        checked={draft.include_all_products}
        onChange={onToggleIncludeAll}
        icon={<CheckCheck size={17} />}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="relative shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            style={filter === f.key ? { color: "#fff" } : { ...softBox, border: "1px solid var(--t-card-border)" }}
          >
            {filter === f.key ? <motion.span layoutId="products-filter" className="absolute inset-0 rounded-full" style={{ background: "var(--t-cta)" }} /> : null}
            <span className="relative">{f.label}{counts ? ` · ${counts[f.key] ?? 0}` : ""}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_220px]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
          <input className={inputCls} style={{ ...inputStyle, paddingLeft: "2.25rem" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, SKU o código de barras…" />
          {q ? (
            <button type="button" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2" aria-label="Limpiar">
              <X size={15} style={{ color: "var(--t-muted)" }} />
            </button>
          ) : null}
        </div>
        <select className={inputCls} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {baseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={stock} onChange={(e) => setStock(e.target.value as StockFilter)} aria-label="Existencias" title={pointName ? `Existencias en ${pointName}` : "Existencias"}>
          {(["all", "with", "without"] as const).map((key) => (
            <option key={key} value={key}>{stockLabels[key]}{stockCounts ? ` (${stockCounts[key] ?? 0})` : ""}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={bulkBusy} onClick={() => void bulk("include")} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50" style={softBox}>
          {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />} Agregar todos{filtered ? " los filtrados" : ""}
        </button>
        <button type="button" disabled={bulkBusy} onClick={() => void bulk("exclude")} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50" style={softBox}>
          <PackageMinus size={14} /> Quitar todos{filtered ? " los filtrados" : ""}
        </button>
        <span className="ml-auto text-xs" style={{ color: "var(--t-muted)" }}>
          Precio del catálogo: <b style={{ color: "var(--t-text)" }}>{level?.label} · {level?.hint}</b>
          {pendingCount ? ` · ${pendingCount} cambio${pendingCount === 1 ? "" : "s"} sin guardar` : ""}
        </span>
      </div>

      {error ? <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}

      <div className={`space-y-2 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {!loading && items.length === 0 && !error ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            {stock === "with" && pointName && !q.trim() && !category && filter === "all"
              ? `${pointName} no tiene productos con unidades. Haz un traslado o un ingreso de factura a este punto.`
              : "No hay productos con estos filtros."}
          </p>
        ) : null}
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const row = rowOf(item);
            const levelPrice = productPriceForLevel(item, draft.price_level);
            const price = catalogPrice(item, draft, row.price_override);
            const changed = Boolean(edits[item.id]);
            const status = statusOf(item, row, price);
            const units = item.catalog_stock;
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid gap-3 rounded-2xl border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                style={{ ...softBox, borderColor: changed ? "var(--t-accent)" : softBox.borderColor, opacity: status.visible ? 1 : 0.72 }}
              >
                <div className="flex items-center gap-3">
                  <Switch checked={row.included} onChange={(next) => patch(item, { included: next })} label={`Incluir ${item.name}`} />
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {item.sku ? <span>{item.sku}</span> : null}
                    <span>P{draft.price_level}: {levelPrice > 0 ? money(levelPrice) : "sin precio"}</span>
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: units === null || units > 0 ? "var(--t-text)" : "#ef4444" }}>
                      {pointName ? <MapPin size={11} /> : null}
                      {pointName ? `${pointName}: ` : "Stock: "}
                      {units === null ? "ilimitado" : units > 0 ? `${units} und.` : pointName ? "sin unidades" : "agotado"}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border px-2 py-1 text-[11px]"
                      style={inputStyle}
                      value={row.catalog_category_id ?? ""}
                      onChange={(e) => patch(item, { catalog_category_id: e.target.value || null })}
                      aria-label="Categoría en este catálogo"
                    >
                      <option value="">Categoría de la tienda</option>
                      {catalogCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => patch(item, { featured: !row.featured })}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold"
                      style={{ ...softBox, color: row.featured ? "#f59e0b" : "var(--t-muted)" }}
                    >
                      <Star size={12} fill={row.featured ? "#f59e0b" : "none"} /> {row.featured ? "Destacado" : "Destacar"}
                    </button>
                    <Pill tone={status.tone}>
                      {status.visible ? <Eye size={12} /> : <EyeOff size={12} />} {status.label}
                    </Pill>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <MoneyInput
                    allowEmpty
                    value={row.price_override}
                    onValueChange={(value) => patch(item, { price_override: value })}
                    placeholder="Precio especial"
                    ariaLabel={`Precio especial de ${item.name}`}
                    className="w-36 rounded-xl border px-3 py-2 text-right text-sm outline-none"
                    style={inputStyle}
                  />
                  <span className="text-right text-xs" style={{ color: "var(--t-muted)" }}>
                    Se vende a <b style={{ color: price > 0 ? "var(--t-text)" : "#ef4444" }}>{price > 0 ? money(price) : "sin precio"}</b>
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {items.length < total ? (
        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="w-full rounded-2xl border py-3 text-sm font-semibold disabled:opacity-60" style={softBox}>
          {loadingMore ? "Cargando…" : `Cargar más (${total - items.length} restantes)`}
        </button>
      ) : null}
    </div>
  );
}
