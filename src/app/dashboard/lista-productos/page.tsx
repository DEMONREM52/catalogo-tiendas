"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList, Eye, Loader2, Pencil, Plus, RotateCcw, Search, Send, X } from "lucide-react";
import { getDashboardStore, type DashboardStore } from "@/lib/store-utils";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { useRunOnChange } from "../inventario/shared";
import { Thumb } from "../inventario/LineEditor";
import { NewStockRequest, type PointOption, type PrefillLine } from "../pedidos/internos/NewStockRequest";
import { Badge, Button, EmptyState, ErrorBox, Skeleton, fmtMoney, fmtNumber, inputCls, inputStyle } from "../fiscal/ui";
import { PhotoSearchButton } from "../PhotoSearchControls";
import { useErpFinderSource } from "../useErpFinder";

type StockFilter = "all" | "has" | "missing" | "elsewhere";
type StatusFilter = "active" | "inactive" | "all";
type SortKey = "name" | "here" | "elsewhere" | "total";

type Item = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  product_no?: number | null;
  image_url: string | null;
  active: boolean;
  price: number | null;
  cost: number | null;
  here: number;
  elsewhere: number;
  total: number;
  levels: Record<string, number>;
};

type BrowseResult = {
  ok: boolean;
  code?: string;
  message?: string;
  total: number;
  counts: Record<StockFilter, number>;
  items: Item[];
  points: PointOption[];
  categories: Array<{ id: string; name: string }>;
  my_point: string | null;
  point_id: string | null;
  can_edit: boolean;
  can_request: boolean;
  show_cost: boolean;
};

const PAGE = 40;

const STOCK_CHIPS: Array<{ value: StockFilter; label: (point: string) => string; hint: string }> = [
  { value: "all", label: () => "Todos", hint: "Todos los productos" },
  { value: "has", label: (p) => `Hay en ${p}`, hint: "Con existencias en el punto elegido" },
  { value: "missing", label: (p) => `No hay en ${p}`, hint: "Agotados o sin existencias en el punto elegido" },
  { value: "elsewhere", label: () => "No hay aquí, sí en otro punto", hint: "Agotados en el punto elegido que sí hay en otra sede o bodega (para pedir)" },
];

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
  { value: "all", label: "Todos" },
];

const shortName = (name: string) => name.replace(/^(sede|punto|bodega)\s+/i, "");

/** Lista general de productos: todos los productos con lo que hay en cada punto (solo lectura). */
export default function ProductListPage() {
  const router = useRouter();
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [point, setPoint] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [sort, setSort] = useState<SortKey>("name");
  const [data, setData] = useState<BrowseResult | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Item>>(() => new Map());
  const [requestKey, setRequestKey] = useState<number | null>(null);
  const [requestTo, setRequestTo] = useState("");
  const reqId = useRef(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const finderSource = useErpFinderSource(store?.id, { priceLevel: 1 });
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getDashboardStore()
      .then((access) => (access.store ? setStore(access.store) : setFatal("No tienes acceso a ninguna tienda.")))
      .catch((err) => setFatal(errorText(err)));
  }, []);

  // Búsqueda con pausa corta para no consultar en cada tecla.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 280);
    return () => window.clearTimeout(t);
  }, [qInput]);

  // Atajo: «/» enfoca el buscador.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filters = useMemo(() => ({ q, point_id: point || null, category_id: category || null, stock, status, sort }), [q, point, category, stock, status, sort]);

  const fetchPage = useCallback(async (offset: number) => {
    if (!store) return null;
    return fiscalRpc<BrowseResult>("erp_product_catalog_browse", { p_store: store.id, p_filters: filters, p_limit: PAGE, p_offset: offset });
  }, [store, filters]);

  const load = useCallback(async () => {
    if (!store) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetchPage(0);
      if (id !== reqId.current || !res) return;
      if (!res.ok) throw new Error(res.message ?? "No se pudo cargar la lista.");
      setData(res);
      setItems(res.items);
      setError(null);
    } catch (err) {
      if (id === reqId.current) setError(errorText(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [store, fetchPage]);
  useRunOnChange(load);

  const hasMore = Boolean(data && items.length < data.total);
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(items.length);
      if (id !== reqId.current || !res?.ok) return;
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id));
        return [...cur, ...res.items.filter((i) => !seen.has(i.id))];
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, hasMore, fetchPage, items.length]);

  // Carga automática al llegar al final de la lista.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const points = useMemo(() => data?.points ?? [], [data]);
  const pointId = point || data?.point_id || "";
  const pointName = points.find((p) => p.id === pointId)?.name ?? "este punto";
  const others = points.filter((p) => p.id !== pointId);
  const pointLabel = (id: string) => points.find((p) => p.id === id)?.name ?? "Otro";
  const filtersOn = Boolean(q || category || stock !== "all" || status !== "active" || sort !== "name");

  function resetFilters() {
    setQInput("");
    setQ("");
    setCategory("");
    setStock("all");
    setStatus("active");
    setSort("name");
  }

  function toggle(item: Item) {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  // A quién pedir por defecto: el punto (distinto al mío) que tiene más de lo seleccionado.
  const suggestedTo = useMemo(() => {
    const score = new Map<string, number>();
    for (const item of selected.values()) {
      for (const [wh, qty] of Object.entries(item.levels)) {
        if (wh !== pointId && qty > 0) score.set(wh, (score.get(wh) ?? 0) + 1);
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? others[0]?.id ?? "";
  }, [selected, pointId, others]);
  const askTo = requestTo && requestTo !== pointId ? requestTo : suggestedTo;

  const prefill: PrefillLine[] = useMemo(
    () => [...selected.values()].map((i) => ({ product_id: i.id, name: i.name, sku: i.sku, qty: 1, levels: i.levels })),
    [selected],
  );

  if (fatal) return <ErrorBox message={fatal} />;
  if (!store || (!data && loading)) return <Skeleton rows={6} />;
  if (!data && error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const canRequest = data.can_request && points.length > 1;

  return (
    <main className={`space-y-4 ${selected.size ? "pb-28" : ""}`}>
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>{store.name} · todos los puntos</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-black sm:text-3xl"><ClipboardList size={26} /> Lista general de productos</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Mira todo lo que maneja la tienda y cuánto hay en cada punto o bodega. Filtra lo que falta en tu sede y pídelo en un clic.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.can_edit ? (
              <>
                <Badge tone="good"><Pencil size={12} /> Puedes editar</Badge>
                <Link href="/dashboard/products/crear" className="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
                  <Plus size={16} /> Nuevo producto
                </Link>
              </>
            ) : (
              <Badge tone="info" title="Tu usuario puede ver la lista, pero no crear, editar ni desactivar productos"><Eye size={12} /> Solo lectura</Badge>
            )}
          </div>
        </div>
      </section>

      <section className="sticky top-0 z-20 -mx-1 space-y-2.5 rounded-[22px] border p-3 backdrop-blur-md sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 88%, transparent)" }}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_14rem_12rem_11rem]">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
            <input
              ref={searchRef}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Nombre, código o código de barras…  ( / )"
              className={inputCls}
              style={{ ...inputStyle, paddingLeft: "2.4rem", paddingRight: qInput ? "4.6rem" : "2.8rem" }}
              aria-label="Buscar productos"
            />
            {qInput ? (
              <button type="button" onClick={() => setQInput("")} className="absolute right-11 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full opacity-70 hover:opacity-100" aria-label="Limpiar búsqueda">
                <X size={14} />
              </button>
            ) : null}
            <PhotoSearchButton
              source={finderSource}
              pickLabel="Ver en la lista"
              subtitle="Toma una foto del producto o escribe su nombre o código para ver cuánto hay en cada punto."
              storageKey={`lista:${store.id}`}
              className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 border-0 px-2"
              style={{ background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}
              onPick={(hit) => {
                // Se filtra la lista por el código del producto elegido.
                const code = hit.code ?? hit.name;
                setQInput(code);
                setQ(code);
                setStock("all");
                setStatus("all");
              }}
            />
          </div>
          <label className="relative block" title="El punto con el que se comparan las existencias">
            <span className="pointer-events-none absolute left-3 top-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Ver existencias en</span>
            <select value={pointId} onChange={(e) => setPoint(e.target.value)} className={`${inputCls} pb-1.5 pt-4`} style={inputStyle}>
              {points.map((p) => (
                <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}{p.id === data.my_point ? " (mi punto)" : ""}</option>
              ))}
            </select>
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} style={inputStyle} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={inputCls} style={inputStyle} aria-label="Ordenar">
            <option value="name">Orden: nombre</option>
            <option value="here">Menos existencias aquí</option>
            <option value="elsewhere">Más en otros puntos</option>
            <option value="total">Más existencias en total</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STOCK_CHIPS.map((chip) => (
            <Chip key={chip.value} active={stock === chip.value} onClick={() => setStock(chip.value)} title={chip.hint} count={data.counts?.[chip.value]} tone={chip.value === "missing" ? "bad" : chip.value === "elsewhere" ? "warn" : chip.value === "has" ? "good" : undefined}>
              {chip.label(shortName(pointName))}
            </Chip>
          ))}
          <span className="mx-1 hidden h-5 w-px sm:block" style={{ background: "var(--t-card-border)" }} />
          {STATUS_CHIPS.map((chip) => (
            <Chip key={chip.value} active={status === chip.value} onClick={() => setStatus(chip.value)} small>
              {chip.label}
            </Chip>
          ))}
          {filtersOn ? (
            <button type="button" onClick={resetFilters} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold opacity-75 transition hover:opacity-100">
              <RotateCcw size={12} /> Quitar filtros
            </button>
          ) : null}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2 px-1 text-xs" style={{ color: "var(--t-muted)" }}>
        <span className="flex items-center gap-2">
          {loading ? <Loader2 size={13} className="animate-spin" /> : null}
          {fmtNumber(data.total)} producto{data.total === 1 ? "" : "s"}
          {canRequest ? " · toca un producto para agregarlo al pedido" : ""}
        </span>
        {error ? <span style={{ color: "#dc2626" }}>{error}</span> : null}
      </div>

      {items.length === 0 && !loading ? (
        <EmptyState
          icon={stock === "missing" || stock === "elsewhere" ? "🎉" : "🔎"}
          title={stock === "missing" ? `No falta nada en ${pointName}` : stock === "elsewhere" ? "Nada para pedir con estos filtros" : "No hay productos con estos filtros"}
          text={filtersOn ? "Prueba con otra búsqueda o quita los filtros." : undefined}
          action={filtersOn ? <Button onClick={resetFilters} icon={<RotateCcw size={14} />}>Quitar filtros</Button> : undefined}
        />
      ) : (
        <ul className={`grid gap-2 transition-opacity md:grid-cols-2 2xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              pointId={pointId}
              pointName={pointName}
              pointLabel={pointLabel}
              showCost={data.show_cost}
              canEdit={data.can_edit}
              selectable={canRequest}
              selected={selected.has(item.id)}
              onToggle={() => toggle(item)}
            />
          ))}
        </ul>
      )}

      {hasMore ? (
        <div ref={sentinel} className="flex justify-center py-3">
          <Button onClick={() => void loadMore()} busy={loadingMore}>Cargar más ({fmtNumber(data.total - items.length)} restantes)</Button>
        </div>
      ) : null}

      <AnimatePresence>
        {selected.size ? (
          <motion.div
            key="tray"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border p-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] sm:flex-nowrap"
            style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))", background: "var(--t-bg-base)", color: "var(--t-text)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">{selected.size} producto{selected.size === 1 ? "" : "s"} para pedir</p>
              <p className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{[...selected.values()].map((i) => i.name).join(" · ")}</p>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--t-muted)" }}>
              Pedir a
              <select value={askTo} onChange={(e) => setRequestTo(e.target.value)} className="rounded-xl border px-2 py-2 text-sm" style={inputStyle}>
                {others.map((p) => <option key={p.id} value={p.id}>{p.kind === "point" ? "📍" : "🏬"} {p.name}</option>)}
              </select>
            </label>
            <Button variant="ghost" onClick={() => setSelected(new Map())} aria-label="Vaciar selección" icon={<X size={15} />} />
            <Button variant="primary" onClick={() => setRequestKey(Date.now())} icon={<Send size={15} />}>Crear pedido</Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {requestKey !== null ? (
        <NewStockRequest
          key={requestKey}
          open
          onClose={() => setRequestKey(null)}
          storeId={store.id}
          points={points}
          myPoint={data.my_point}
          initialFrom={pointId}
          initialTo={askTo}
          initialLines={prefill}
          onCreated={(id) => {
            setRequestKey(null);
            setSelected(new Map());
            router.push(`/dashboard/pedidos?tab=internos&pedido=${id}`);
          }}
        />
      ) : null}
    </main>
  );
}

function Chip({ active, onClick, children, count, title, tone, small = false }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  title?: string;
  tone?: "good" | "bad" | "warn";
  small?: boolean;
}) {
  const color = tone === "good" ? "#16a34a" : tone === "bad" ? "#dc2626" : tone === "warn" ? "#d97706" : "var(--t-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`relative inline-flex items-center gap-1.5 rounded-full border font-semibold transition hover:-translate-y-0.5 ${small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs sm:text-sm"}`}
      style={active
        ? { borderColor: color, background: `color-mix(in oklab, ${color} 16%, transparent)`, color }
        : { borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
    >
      {children}
      {count != null ? (
        <span className="rounded-full px-1.5 text-[11px] font-bold tabular-nums" style={{ background: active ? `color-mix(in oklab, ${color} 22%, transparent)` : "color-mix(in oklab, var(--t-text) 8%, transparent)" }}>
          {fmtNumber(count)}
        </span>
      ) : null}
    </button>
  );
}

function ProductRow({ item, pointId, pointName, pointLabel, showCost, canEdit, selectable, selected, onToggle }: {
  item: Item;
  pointId: string;
  pointName: string;
  pointLabel: (id: string) => string;
  showCost: boolean;
  canEdit: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const here = Number(item.here);
  const elsewhere = Object.entries(item.levels)
    .filter(([wh, qty]) => wh !== pointId && Number(qty) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const hereTone = here > 0 ? "#16a34a" : "#dc2626";
  const body = (
    <>
      <Thumb src={item.image_url} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-bold leading-snug">{item.name}</p>
          {!item.active ? <Badge tone="neutral" className="shrink-0">Inactivo</Badge> : null}
        </div>
        <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
          {[item.sku ? `Cód. ${item.sku}` : null, item.barcode].filter(Boolean).join(" · ") || "Sin código"}
          {" · "}<span className="font-semibold" style={{ color: "var(--t-text)" }}>{fmtMoney(item.price)}</span>
          {showCost && item.cost != null ? <> · costo {fmtMoney(item.cost)}</> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {elsewhere.length ? elsewhere.slice(0, 4).map(([wh, qty]) => (
            <span key={wh} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--t-card-border)" }}>
              {shortName(pointLabel(wh))} <b className="tabular-nums">{fmtNumber(qty)}</b>
            </span>
          )) : (
            <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>No hay en otros puntos</span>
          )}
          {elsewhere.length > 4 ? (
            <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: "var(--t-muted)" }} title={elsewhere.slice(4).map(([wh, qty]) => `${pointLabel(wh)}: ${qty}`).join("\n")}>
              +{elsewhere.length - 4} más
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }} title={pointName}>{shortName(pointName).slice(0, 14)}</p>
        <p className="text-xl font-black tabular-nums leading-none" style={{ color: hereTone }}>{fmtNumber(here)}</p>
        <p className="mt-1 text-[10px] tabular-nums" style={{ color: "var(--t-muted)" }}>total {fmtNumber(item.total)}</p>
      </div>
    </>
  );

  return (
    <li
      className="group relative flex items-stretch gap-1 rounded-2xl border transition"
      style={{
        borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)",
        background: selected ? "color-mix(in oklab, var(--t-accent) 9%, var(--t-card-bg))" : "color-mix(in oklab, var(--t-card-bg) 94%, transparent)",
        opacity: item.active ? 1 : 0.72,
      }}
    >
      {selectable ? (
        <button type="button" onClick={onToggle} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left" title={selected ? "Quitar del pedido" : "Agregar al pedido"}>
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] font-black text-white transition"
            style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-card-border)", background: selected ? "var(--t-accent)" : "transparent" }}
            aria-hidden
          >
            {selected ? "✓" : ""}
          </span>
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-3">{body}</div>
      )}
      {canEdit ? (
        <Link
          href={`/dashboard/products/${item.id}`}
          className="grid w-10 shrink-0 place-items-center rounded-r-2xl border-l opacity-60 transition hover:opacity-100"
          style={{ borderColor: "var(--t-card-border)" }}
          title="Editar producto"
          aria-label={`Editar ${item.name}`}
        >
          <Pencil size={15} />
        </Link>
      ) : null}
    </li>
  );
}
