"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Eye, EyeOff, ImageOff, LayoutGrid, List, Minus, Package, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { smartFilter } from "@/lib/search";
import { mapLimit } from "@/lib/net/map-limit";
import { thumbPath, thumbTarget } from "@/lib/images/thumb";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ThumbImg } from "@/components/ui/ThumbImg";
import { ImageUpload } from "../store/ImageUpload";

type Category = {
  id: string;
  store_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  active: boolean;
};
type Draft = Category & { isNew: boolean };
type Filter = "all" | "active" | "hidden" | "noimage";
type View = "grid" | "list";

const COLS = "id,store_id,name,image_url,sort_order,active";
const VIEW_KEY = "remhub:categories-view";
const swalBase = { background: "var(--t-bg-base)", color: "var(--t-text)" };
const toast = { ...swalBase, toast: true, position: "top" as const, timer: 1800, showConfirmButton: false };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
const byOrder = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es");

/** Cuántos productos tiene cada categoría (en paralelo, de a 6). null si no se pudo contar. */
async function countProducts(ids: string[]): Promise<Map<string, number> | null> {
  if (!ids.length) return new Map();
  const sb = supabaseBrowser();
  const res = await mapLimit(ids, 6, async (id) => {
    const { count, error } = await sb.from("product_category_links").select("product_id", { count: "exact", head: true }).eq("category_id", id);
    if (error) throw error;
    return count ?? 0;
  });
  if (res.every((r) => !r.ok)) return null;
  const out = new Map<string, number>();
  res.forEach((r, i) => { if (r.ok) out.set(ids[i], r.value); });
  return out;
}

/** Borra la foto de una categoría (y su miniatura). Solo si el archivo es de esa categoría (`<id>.png` o `<id>-….png`). */
async function removeCategoryImage(url: string | null, categoryId: string) {
  const t = thumbTarget(url);
  if (!t) return;
  const file = t.path.slice(t.path.lastIndexOf("/") + 1);
  if (!file.startsWith(categoryId)) return;
  try {
    await supabaseBrowser().storage.from(t.bucket).remove([t.path, thumbPath(t.path, t.version)]);
  } catch { /* si no se puede, queda el archivo: no afecta a nada */ }
}

export default function CategoriesPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    try {
      const [{ data: userData, error: userErr }, access] = await Promise.all([sb.auth.getUser(), getDashboardStore()]);
      if (userErr) throw userErr;
      if (!userData.user) throw new Error("Debes iniciar sesión.");
      if (!access.store) throw new Error("No se encontró tu tienda.");
      setUserId(userData.user.id);
      setStoreId(access.store.id);
      try { const v = window.localStorage.getItem(VIEW_KEY); if (v === "grid" || v === "list") setView(v); } catch { /* opcional */ }

      const { data, error } = await sb.from("product_categories").select(COLS).eq("store_id", access.store.id)
        .order("sort_order", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Category[];
      setCategories(rows);
      // Los conteos llegan después: la pantalla no los espera.
      void countProducts(rows.map((c) => c.id)).then(setCounts);
    } catch (e) {
      await Swal.fire({ ...swalBase, icon: "error", title: "No se pudieron cargar las categorías", text: (e as Error)?.message ?? "Error", confirmButtonColor: "#ef4444" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() cambia el estado después de consultar (async)
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    all: categories.length,
    active: categories.filter((c) => c.active).length,
    hidden: categories.filter((c) => !c.active).length,
    noimage: categories.filter((c) => !c.image_url).length,
  }), [categories]);

  const shown = useMemo(() => {
    const list = smartFilter(categories, q, (c) => c.name).filter((c) =>
      filter === "active" ? c.active : filter === "hidden" ? !c.active : filter === "noimage" ? !c.image_url : true);
    return q.trim() ? list : [...list].sort(byOrder);
  }, [categories, q, filter]);

  function changeView(v: View) {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* opcional */ }
  }

  function startNew() {
    if (!storeId) return;
    const next = categories.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0) + 1;
    setEditing({ id: crypto.randomUUID(), store_id: storeId, name: "", image_url: null, sort_order: next, active: true, isNew: true });
  }

  async function save(d: Draft): Promise<boolean> {
    const sb = supabaseBrowser();
    const row = { name: d.name.trim(), image_url: d.image_url, sort_order: Math.round(Number(d.sort_order) || 0), active: d.active };
    const { data, error } = d.isNew
      ? await sb.from("product_categories").insert({ id: d.id, store_id: d.store_id, ...row }).select(COLS).single()
      : await sb.from("product_categories").update(row).eq("id", d.id).select(COLS).single();
    if (error || !data) {
      await Swal.fire({ ...swalBase, icon: "error", title: d.isNew ? "No se pudo crear" : "No se pudo guardar", text: error?.message ?? "Inténtalo de nuevo.", confirmButtonColor: "#ef4444" });
      return false;
    }
    const saved = data as Category;
    setCategories((prev) => (d.isNew ? [...prev, saved] : prev.map((c) => (c.id === saved.id ? saved : c))));
    if (d.isNew) setCounts((prev) => (prev ? new Map(prev).set(saved.id, 0) : prev));
    void Swal.fire({ ...toast, icon: "success", title: d.isNew ? "Categoría creada" : "Cambios guardados" });
    return true;
  }

  async function remove(c: Category): Promise<boolean> {
    const n = counts?.get(c.id) ?? null;
    const res = await Swal.fire({
      ...swalBase,
      icon: "warning",
      title: `¿Eliminar «${esc(c.name)}»?`,
      html: `${n ? `Tiene <b>${plural(n, "producto", "productos")}</b>. ` : ""}Los productos <b>no se borran</b>: solo quedan sin esta categoría.`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
    });
    if (!res.isConfirmed) return false;
    const { error } = await supabaseBrowser().from("product_categories").delete().eq("id", c.id);
    if (error) {
      await Swal.fire({ ...swalBase, icon: "error", title: "No se pudo eliminar", text: error.message, confirmButtonColor: "#ef4444" });
      return false;
    }
    // La foto se borra después de la fila: si la fila no se pudo borrar, la foto sigue ahí.
    void removeCategoryImage(c.image_url, c.id);
    setCategories((prev) => prev.filter((x) => x.id !== c.id));
    void Swal.fire({ ...toast, icon: "success", title: "Categoría eliminada" });
    return true;
  }

  if (loading) return <main className="p-4 sm:p-6"><SkeletonList rows={6} avatar={false} label="Cargando categorías…" /></main>;

  const tiles: Array<{ key: Filter; label: string; value: number; icon: React.ReactNode; color: string }> = [
    { key: "all", label: "Todas", value: stats.all, icon: <LayoutGrid size={16} />, color: "var(--t-accent)" },
    { key: "active", label: "Se ven en el catálogo", value: stats.active, icon: <Eye size={16} />, color: "var(--t-success, #22c55e)" },
    { key: "hidden", label: "Ocultas", value: stats.hidden, icon: <EyeOff size={16} />, color: "var(--t-muted)" },
    { key: "noimage", label: "Sin imagen", value: stats.noimage, icon: <ImageOff size={16} />, color: "var(--t-warning, #f59e0b)" },
  ];

  return (
    <main className="space-y-5 p-4 sm:p-6 panel-enter" style={{ color: "var(--t-text)" }}>
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Categorías</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Agrupan tus productos y ordenan el catálogo. Toca una categoría para editarla.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-soft inline-flex items-center gap-1.5 px-3 py-2 text-sm" disabled={refreshing}
            onClick={() => { setRefreshing(true); void load(); }} aria-label="Recargar">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> <span className="hidden sm:inline">Recargar</span>
          </button>
          <button type="button" className="btn-cta inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold" onClick={startNew} disabled={!storeId}>
            <Plus size={16} /> Nueva categoría
          </button>
        </div>
      </div>

      {/* Resumen: cada recuadro también filtra */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const on = filter === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setFilter(t.key)} aria-pressed={on}
              className="glass-soft flex items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
              style={{ borderColor: on ? t.color : "var(--t-card-border)", boxShadow: on ? `0 0 0 1px ${t.color}` : undefined }}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color: t.color, background: `color-mix(in oklab, ${t.color} 16%, transparent)` }}>{t.icon}</span>
              <span className="min-w-0">
                <span className="block text-xl font-black leading-none tabular-nums">{t.value}</span>
                <span className="mt-1 block truncate text-xs" style={{ color: "var(--t-muted)" }}>{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Buscar y vista */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--t-muted)" }} />
          <input
            className="w-full rounded-2xl border py-2.5 pl-10 pr-9 text-sm outline-none"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, color-mix(in oklab, var(--t-card-bg) 92%, transparent))", color: "var(--t-text)" }}
            placeholder="Buscar categoría…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full opacity-70 hover:opacity-100" aria-label="Borrar búsqueda">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="flex rounded-2xl border p-1" style={{ borderColor: "var(--t-card-border)" }} role="group" aria-label="Vista">
          {([["grid", <LayoutGrid key="g" size={15} />, "Tarjetas"], ["list", <List key="l" size={15} />, "Lista"]] as const).map(([v, icon, label]) => (
            <button key={v} type="button" onClick={() => changeView(v)} aria-pressed={view === v}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition"
              style={view === v ? { background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" } : { color: "var(--t-muted)" }}>
              {icon} {label}
            </button>
          ))}
        </div>
        {filter !== "all" || q ? (
          <p className="w-full text-xs sm:w-auto" style={{ color: "var(--t-muted)" }}>
            {plural(shown.length, "categoría", "categorías")} de {stats.all}
            {filter !== "all" ? <> · <button type="button" className="underline" onClick={() => setFilter("all")}>ver todas</button></> : null}
          </p>
        ) : null}
      </div>

      {/* Categorías */}
      {shown.length === 0 ? (
        <div className="glass grid place-items-center gap-3 p-10 text-center">
          <Package size={36} style={{ color: "var(--t-muted)" }} />
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            {stats.all === 0 ? "Todavía no tienes categorías." : "Ninguna categoría coincide con la búsqueda o el filtro."}
          </p>
          {stats.all === 0 ? (
            <button type="button" className="btn-cta inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold" onClick={startNew}><Plus size={16} /> Crear la primera</button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-6">
          {shown.map((c) => (
            <CategoryCard key={c.id} c={c} count={counts?.get(c.id) ?? null} onEdit={() => setEditing({ ...c, isNew: false })} />
          ))}
        </div>
      ) : (
        <div className="glass divide-y overflow-hidden rounded-2xl" style={{ borderColor: "var(--t-card-border)" }}>
          {shown.map((c) => (
            <CategoryRow key={c.id} c={c} count={counts?.get(c.id) ?? null} onEdit={() => setEditing({ ...c, isNew: false })} />
          ))}
        </div>
      )}

      {editing && userId ? (
        <CategoryEditor
          key={editing.id}
          draft={editing}
          userId={userId}
          count={counts?.get(editing.id) ?? null}
          others={categories.filter((c) => c.id !== editing.id)}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      ) : null}
    </main>
  );
}

function CategoryImage({ c, className }: { c: Category; className?: string }) {
  if (c.image_url) return <ThumbImg src={c.image_url} alt="" loading="lazy" decoding="async" className={`${className ?? ""} object-cover`} />;
  return (
    <span className={`${className ?? ""} grid place-items-center text-3xl font-black`}
      style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--t-accent) 30%, transparent), color-mix(in oklab, var(--t-accent) 8%, transparent))", color: "var(--t-accent)" }}>
      {(c.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400"><Eye size={11} /> Visible</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "color-mix(in oklab, var(--t-muted) 18%, transparent)", color: "var(--t-muted)" }}><EyeOff size={11} /> Oculta</span>
  );
}

function countText(count: number | null) {
  return count === null ? "…" : plural(count, "producto", "productos");
}

function CategoryCard({ c, count, onEdit }: { c: Category; count: number | null; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} title={`Editar ${c.name}`}
      className="group glass relative flex flex-col overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2"
      style={{ borderColor: "var(--t-card-border)" }}>
      <span className={`relative block aspect-square w-full overflow-hidden ${c.active ? "" : "opacity-55 grayscale"}`}>
        <CategoryImage c={c} className="h-full w-full transition duration-300 group-hover:scale-[1.04]" />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur" title="Orden en el catálogo">#{c.sort_order}</span>
        {!c.image_url ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black"><ImageOff size={11} /> Sin imagen</span>
        ) : null}
        <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-black"><Pencil size={13} /> Editar</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <span className="line-clamp-2 text-sm font-bold leading-tight">{c.name || "Sin nombre"}</span>
        <span className="mt-auto flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>{countText(count)}</span>
          <StatusChip active={c.active} />
        </span>
      </span>
    </button>
  );
}

function CategoryRow({ c, count, onEdit }: { c: Category; count: number | null; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderColor: "var(--t-card-border)" }}>
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`block h-12 w-12 shrink-0 overflow-hidden rounded-xl ${c.active ? "" : "opacity-55 grayscale"}`}>
          <CategoryImage c={c} className="h-full w-full text-lg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{c.name || "Sin nombre"}</span>
          <span className="block text-xs" style={{ color: "var(--t-muted)" }}>
            Orden {c.sort_order} · {countText(count)}{!c.image_url ? " · sin imagen" : ""}
          </span>
        </span>
      </button>
      <StatusChip active={c.active} />
      {count ? (
        <Link href={`/dashboard/products?categoria=${c.id}`} className="hidden rounded-lg border px-2.5 py-1.5 text-xs font-semibold sm:inline-flex" style={{ borderColor: "var(--t-card-border)" }}>
          Ver productos
        </Link>
      ) : null}
      <button type="button" onClick={onEdit} className="btn-soft inline-flex items-center gap-1 px-2.5 py-1.5 text-xs" aria-label={`Editar ${c.name}`}>
        <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
      </button>
    </div>
  );
}

function CategoryEditor({ draft, userId, count, others, onClose, onSave, onDelete }: {
  draft: Draft;
  userId: string;
  count: number | null;
  others: Category[];
  onClose: () => void;
  onSave: (d: Draft) => Promise<boolean>;
  onDelete: (c: Category) => Promise<boolean>;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const name = d.name.trim();
  const dirty = d.name !== draft.name || d.image_url !== draft.image_url || Number(d.sort_order) !== Number(draft.sort_order) || d.active !== draft.active;
  const duplicate = !!name && others.some((o) => norm(o.name) === norm(name));
  const canSave = !!name && !busy && (draft.isNew || dirty);
  const patch = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));

  const close = useCallback(async () => {
    if (busy) return;
    if (dirty || (draft.isNew && (name || d.image_url))) {
      const r = await Swal.fire({
        ...swalBase, icon: "question", title: "¿Salir sin guardar?", text: "Los cambios de esta categoría se pierden.",
        showCancelButton: true, confirmButtonText: "Salir sin guardar", cancelButtonText: "Seguir editando", confirmButtonColor: "#ef4444",
      });
      if (!r.isConfirmed) return;
      // Una categoría nueva que no se creó no debe dejar su foto subida.
      if (draft.isNew && d.image_url) void removeCategoryImage(d.image_url, d.id);
    }
    onClose();
  }, [busy, dirty, draft.isNew, name, d.image_url, d.id, onClose]);

  // Esc cierra; mientras está abierta, la página de atrás no se desplaza.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !Swal.isVisible()) void close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [close]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    const ok = await onSave(d);
    setBusy(false);
    if (ok) onClose();
  }

  async function del() {
    setBusy(true);
    const ok = await onDelete(d);
    setBusy(false);
    if (ok) onClose();
  }

  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, color-mix(in oklab, var(--t-card-bg) 92%, transparent))", color: "var(--t-text)" };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) void close(); }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label={draft.isNew ? "Nueva categoría" : `Editar ${draft.name}`}
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:rounded-3xl"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        {/* Título */}
        <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-xl"><CategoryImage c={d} className="h-full w-full text-base" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{draft.isNew ? "Nueva categoría" : draft.name || "Sin nombre"}</p>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>
              {draft.isNew ? "Escribe el nombre y, si quieres, súbele una imagen." : countText(count)}
            </p>
          </div>
          <button type="button" onClick={() => void close()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        {/* Contenido */}
        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">Nombre</span>
              <input autoFocus={draft.isNew} required maxLength={80} value={d.name} onChange={(e) => patch({ name: e.target.value })}
                placeholder="Ej.: Juguetería" className="mt-1 w-full rounded-2xl border px-4 py-3 text-base font-semibold outline-none" style={field} />
              {duplicate ? <span className="mt-1 block text-xs text-amber-400">⚠️ Ya hay otra categoría con ese nombre.</span> : null}
            </label>

            <div>
              <span className="text-sm font-semibold">¿Se ve en el catálogo?</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([[true, "Visible", <Eye key="v" size={15} />], [false, "Oculta", <EyeOff key="o" size={15} />]] as const).map(([value, label, icon]) => (
                  <button key={label} type="button" onClick={() => patch({ active: value })} aria-pressed={d.active === value}
                    className="inline-flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-sm font-semibold transition"
                    style={d.active === value
                      ? { borderColor: value ? "#22c55e" : "var(--t-muted)", background: value ? "rgba(34,197,94,.14)" : "color-mix(in oklab, var(--t-muted) 16%, transparent)" }
                      : { borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                    {icon} {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>
                {d.active ? "Los clientes la ven en el catálogo." : "No sale en el catálogo; sus productos siguen igual."}
              </p>
            </div>

            <div>
              <span className="text-sm font-semibold">Orden en el catálogo</span>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" onClick={() => patch({ sort_order: Math.max(0, Number(d.sort_order) - 1) })} className="grid h-11 w-11 place-items-center rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Subir en el orden">
                  <Minus size={16} />
                </button>
                <input type="number" inputMode="numeric" min={0} value={d.sort_order} onChange={(e) => patch({ sort_order: Number(e.target.value) })}
                  className="h-11 w-24 rounded-2xl border text-center text-base font-bold outline-none" style={field} aria-label="Orden" />
                <button type="button" onClick={() => patch({ sort_order: Number(d.sort_order) + 1 })} className="grid h-11 w-11 place-items-center rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Bajar en el orden">
                  <Plus size={16} />
                </button>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>El número más bajo sale primero.</p>
            </div>

            {!draft.isNew && count ? (
              dirty ? null : (
                <Link href={`/dashboard/products?categoria=${draft.id}`} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
                  <Package size={14} /> Ver sus {plural(count, "producto", "productos")}
                </Link>
              )
            ) : null}
          </div>

          <div>
            <span className="text-sm font-semibold">Imagen</span>
            <p className="mb-2 text-xs" style={{ color: "var(--t-muted)" }}>Cuadrada se ve mejor. Arrástrala, pégala con Ctrl+V o súbela.</p>
            <ImageUpload
              label="Imagen de la categoría"
              currentUrl={d.image_url}
              pathPrefix={`${userId}/categories/`}
              fileName={`${d.id}.png`}
              bucket="category-images"
              onUploaded={(url) => patch({ image_url: url })}
            />
            {d.image_url ? (
              <button type="button" onClick={() => patch({ image_url: null })} className="mt-2 text-xs underline" style={{ color: "var(--t-muted)" }}>
                Quitar la imagen
              </button>
            ) : null}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--t-card-border)" }}>
          {!draft.isNew ? (
            <button type="button" onClick={() => void del()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-60"
              style={{ borderColor: "color-mix(in oklab, #ef4444 45%, var(--t-card-border))", color: "#f87171" }}>
              <Trash2 size={15} /> Eliminar
            </button>
          ) : null}
          <span className="ml-auto text-xs" style={{ color: dirty ? "var(--t-warning, #f59e0b)" : "var(--t-muted)" }}>
            {draft.isNew ? "" : dirty ? "● Cambios sin guardar" : "Sin cambios"}
          </span>
          <button type="button" onClick={() => void close()} disabled={busy} className="btn-soft px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={!canSave} className="btn-cta px-5 py-2 text-sm font-semibold disabled:opacity-60">
            {busy ? "Guardando…" : draft.isNew ? "Crear categoría" : "Guardar"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
