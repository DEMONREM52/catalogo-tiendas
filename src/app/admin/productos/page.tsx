"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "@/app/dashboard/store/ImageUpload";

type StoreMini = { id: string; name: string; slug: string };
type Cat = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  created_at: string;

  name: string;
  description: string | null;

  price_retail: number | null;
  price_wholesale: number | null;
  min_wholesale: number | null;

  stock: number | null; // null = ilimitado

  active: boolean; // DB
  active_draft?: boolean; // UI

  image_url: string | null;
  category_id: string | null;
};

type StatusFilter = "all" | "active" | "inactive" | "out";

/* =========================
   UI helpers (classes)
========================= */
function clsWrap() {
  return "rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl";
}
function inputBase() {
  return "rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl";
}
function buttonGhost() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60";
}
function buttonPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 disabled:opacity-60";
}
function buttonDanger() {
  return "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60";
}
function clsChip() {
  return "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
}
function badgeActive(active: boolean) {
  return active
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
    : "border-white/10 bg-white/5 text-white/70";
}

/* =========================
   Data helpers
========================= */
function clampNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeIntOrNull(v: any) {
  const t = String(v ?? "").trim();
  if (!t) return null; // vacío => ilimitado
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}
function isOutOfStock(stock: number | null) {
  return stock !== null && stock <= 0;
}
function stockLabel(stock: number | null) {
  if (stock === null) return "∞ Ilimitado";
  if (stock <= 0) return "Agotado";
  return `${stock} disp.`;
}
function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}
function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

/* =========================
   Avatar (letra + color)
========================= */
function hashToIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarClass(seed: string) {
  const palette = [
    "bg-fuchsia-500/15 border-fuchsia-400/25 text-fuchsia-100",
    "bg-emerald-500/15 border-emerald-400/25 text-emerald-100",
    "bg-sky-500/15 border-sky-400/25 text-sky-100",
    "bg-amber-500/15 border-amber-400/25 text-amber-100",
    "bg-rose-500/15 border-rose-400/25 text-rose-100",
    "bg-violet-500/15 border-violet-400/25 text-violet-100",
  ];
  return palette[hashToIndex(seed, palette.length)];
}
function firstLetter(name: string) {
  const t = (name ?? "").trim();
  return (t[0] || "?").toUpperCase();
}

/* =========================
   Pagination
========================= */
const PAGE_SIZE = 20;
type Cursor = { created_at: string; id: string } | null;

export default function AdminProductosPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);

  const currentStore = useMemo(
    () => stores.find((s) => s.id === storeId) ?? null,
    [stores, storeId]
  );

  function patch(id: string, p: Partial<Product>) {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  function toggleActiveDraft(id: string) {
    setProducts((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const cur = x.active_draft ?? x.active;
        return { ...x, active_draft: !cur };
      })
    );
  }

  function setStockWithRule(id: string, newStock: number | null) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next: Product = { ...p, stock: newStock };
        if (newStock !== null && newStock <= 0) next.active_draft = false;
        return next;
      })
    );
  }

  function normalizeRows(rows: any[]): Product[] {
    return (rows ?? []).map((p: any) => ({
      ...p,
      price_retail: p.price_retail == null ? 0 : clampNum(p.price_retail, 0),
      price_wholesale: p.price_wholesale == null ? 0 : clampNum(p.price_wholesale, 0),
      min_wholesale: p.min_wholesale == null ? 1 : Math.max(1, clampNum(p.min_wholesale, 1)),
      stock:
        p.stock === null || p.stock === undefined
          ? null
          : Math.max(0, Math.floor(clampNum(p.stock, 0))),
      active_draft: p.active,
    }));
  }

  function computeCursor(list: Product[]): Cursor {
    if (!list.length) return null;
    const last = list[list.length - 1];
    return { created_at: String(last.created_at), id: String(last.id) };
  }

  /* =========================
     Loaders
  ========================= */
  async function loadStores() {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("stores")
      .select("id,name,slug")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const arr = (data as StoreMini[]) ?? [];
    setStores(arr);
    if (!storeId && arr[0]) setStoreId(arr[0].id);
  }

  async function loadCats(sid: string) {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("product_categories")
      .select("id,name")
      .eq("store_id", sid)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    setCats((data as Cat[]) ?? []);
  }

  async function loadFirstPage(sid: string) {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .eq("store_id", sid)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const normalized = normalizeRows((data as any[]) ?? []);
      setProducts(normalized);
      setCursor(computeCursor(normalized));
      setHasMore(normalized.length === PAGE_SIZE);
      setOpenId(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!storeId || !hasMore || loadingMore) return;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const sb = supabaseBrowser();
      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .eq("store_id", storeId)
        .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const next = normalizeRows((data as any[]) ?? []);
      setProducts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...next.filter((x) => !seen.has(x.id))];
      });

      setHasMore(next.length === PAGE_SIZE);
      if (next.length > 0) setCursor(computeCursor(next));
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando más",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function reloadStoreData() {
    if (!storeId) return;
    setProducts([]);
    setCursor(null);
    setHasMore(true);
    setOpenId(null);
    await Promise.all([loadCats(storeId), loadFirstPage(storeId)]);
  }

  useEffect(() => {
    (async () => {
      try {
        await loadStores();
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message ?? "Error cargando tiendas",
          background: "#0b0b0b",
          color: "#fff",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      try {
        await reloadStoreData();
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message ?? "Error cargando productos",
          background: "#0b0b0b",
          color: "#fff",
        });
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  /* =========================
     CRUD
  ========================= */
  async function create() {
    if (!storeId) return;

    setSavingId("create");
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("products")
        .insert({
          store_id: storeId,
          name: "Nuevo producto",
          description: "",
          price_retail: 0,
          price_wholesale: 0,
          min_wholesale: 1,
          stock: null,
          active: true,
          image_url: null,
          category_id: null,
        })
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .single();

      if (error) throw error;

      const row = normalizeRows([data])[0];
      setProducts((prev) => [row, ...prev]);
      setOpenId(row.id);

      await Swal.fire({
        icon: "success",
        title: "Producto creado",
        timer: 900,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function save(p: Product) {
    setSavingId(p.id);
    try {
      const sb = supabaseBrowser();
      const validCategory = cats.some((c) => c.id === p.category_id);

      const payloadStock = p.stock === null ? null : Math.max(0, Math.floor(clampNum(p.stock, 0)));
      const payloadActive = !!(p.active_draft ?? p.active);

      const { error } = await sb
        .from("products")
        .update({
          name: p.name,
          description: p.description,
          price_retail: clampNum(p.price_retail, 0),
          price_wholesale: clampNum(p.price_wholesale, 0),
          min_wholesale: Math.max(1, clampNum(p.min_wholesale, 1)),
          stock: payloadStock,
          active: payloadActive,
          image_url: p.image_url,
          category_id: validCategory ? p.category_id : null,
        })
        .eq("id", p.id);

      if (error) throw error;

      patch(p.id, {
        active: payloadActive,
        active_draft: payloadActive,
        stock: payloadStock,
      });

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 800,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function remove(p: Product) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar producto",
      text: `Se eliminará "${p.name}".`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (!res.isConfirmed) return;

    setDeletingId(p.id);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) throw error;

      setProducts((prev) => prev.filter((x) => x.id !== p.id));
      if (openId === p.id) setOpenId(null);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      await Swal.fire({
        icon: "success",
        title: "ID copiado",
        timer: 650,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });
    } catch {
      await Swal.fire({
        icon: "error",
        title: "No se pudo copiar",
        text: "Copia manualmente el ID.",
        background: "#0b0b0b",
        color: "#fff",
      });
    }
  }

  /* =========================
     Filtering (usa ACTIVE REAL, no draft)
  ========================= */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;

      const out = isOutOfStock(p.stock);

      if (statusFilter === "active") {
        if (!p.active) return false;
        if (out) return false;
      }
      if (statusFilter === "inactive") {
        if (p.active) return false;
      }
      if (statusFilter === "out") {
        if (!out) return false;
      }

      if (!s) return true;

      return p.name.toLowerCase().includes(s) || (p.description ?? "").toLowerCase().includes(s);
    });
  }, [products, q, categoryFilter, statusFilter]);

  /* =========================
     UI (header fijo)
  ========================= */
  const HEADER_H = 210;

  return (
    <main className="px-3 py-3 sm:p-6">
      {/* HEADER FIJO */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#0b0b0b]/92 backdrop-blur-2xl px-3 py-3 sm:px-6 sm:py-6">
          <div className={`${clsWrap()} p-3 sm:p-5`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold leading-tight">Admin · Productos</h2>
                <p className="text-[11px] sm:text-sm text-white/70">
                  Tienda:{" "}
                  <b className="text-white/90">{currentStore ? `${currentStore.name} (${currentStore.slug})` : "—"}</b>{" "}
                  · Cargados: <b className="text-white/90">{products.length}</b> · Mostrando:{" "}
                  <b className="text-white/90">{filtered.length}</b>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button className={buttonGhost()} onClick={reloadStoreData} disabled={!storeId || loading || loadingMore}>
                  Recargar
                </button>

                <a
                  href={`/${currentStore?.slug ?? ""}/detal`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonGhost()}
                >
                  Ver Detal
                </a>

                <a
                  href={`/${currentStore?.slug ?? ""}/mayor`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonGhost()}
                >
                  Ver Mayor
                </a>

                <button className={buttonPrimary()} onClick={create} disabled={!storeId || savingId === "create"}>
                  {savingId === "create" ? "Creando…" : "+ Crear"}
                </button>
              </div>
            </div>

            {/* filtros */}
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select className={inputBase()} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.slug})
                  </option>
                ))}
              </select>

              <select className={inputBase()} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">Todas las categorías</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select className={inputBase()} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">Estado: Todos</option>
                <option value="active">Estado: Activos</option>
                <option value="inactive">Estado: Inactivos</option>
                <option value="out">Stock: Agotados</option>
              </select>

              <input className={inputBase()} placeholder="Buscar (nombre o descripción)..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <p className="mt-2 text-[11px] sm:text-xs text-white/60">
              Cargando en bloques de {PAGE_SIZE}. Usa “Cargar más” al final.
            </p>
          </div>
        </div>
      </div>

      {/* espacio para no tapar */}
      <div style={{ height: HEADER_H }} />

      {/* BODY */}
      {loading ? (
        <div className={`${clsWrap()} p-6 text-sm text-white/70`}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className={`${clsWrap()} p-6`}>
          <p className="font-semibold">No hay productos</p>
          <p className="mt-1 text-sm text-white/70">Crea un producto o cambia los filtros.</p>
        </div>
      ) : (
        <div className={`${clsWrap()} overflow-hidden`}>
          {filtered.map((p) => {
            const out = isOutOfStock(p.stock);
            const uiActive = p.active_draft ?? p.active;
            const dirtyActive = uiActive !== p.active;

            const isOpen = openId === p.id;
            const letter = firstLetter(p.name);

            return (
              <div key={p.id} className="border-b border-white/10">
                {/* ROW compacta */}
                <div className="px-3 py-3 flex items-center gap-3">
                  <div className={`h-12 w-12 rounded-2xl border flex items-center justify-center shrink-0 ${avatarClass(p.id)}`}>
                    <span className="text-base font-extrabold">{letter}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{p.name}</p>

                      {!p.active ? (
                        <span className={`${clsChip()} border-white/10 bg-white/10 text-white/70`}>Inactivo</span>
                      ) : null}

                      <span
                        className={`${clsChip()} ${
                          out
                            ? "border-red-400/30 bg-red-500/10 text-red-100"
                            : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                        }`}
                      >
                        {stockLabel(p.stock)}
                      </span>

                      {dirtyActive ? <span className="text-[11px] text-white/50">(cambios sin guardar)</span> : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                      <span>
                        Mayorista: <b className="text-white/90">{money(Number(p.price_wholesale ?? 0))}</b>
                      </span>
                      <span className="text-white/30">·</span>
                      <span>
                        Detal: <b className="text-white/90">{money(Number(p.price_retail ?? 0))}</b>
                      </span>
                      <span className="text-white/30">·</span>
                      <span className="text-white/60">{formatDate(p.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* ✅ link con [id] */}
                    <Link className={buttonGhost()} href={`/admin/productos/${p.id}`}>
                      Abrir →
                    </Link>

                    <button className={buttonGhost()} type="button" onClick={() => setOpenId(isOpen ? null : p.id)}>
                      {isOpen ? "Cerrar" : "Editar"}
                    </button>
                  </div>
                </div>

                {/* PANEL DE EDICIÓN */}
                {isOpen ? (
                  <div className="px-3 pb-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
                      {/* Left */}
                      <div className="rounded-[22px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="text-xs text-white/70">Nombre</label>
                            <input
                              className={`mt-1 w-full ${inputBase()}`}
                              value={p.name}
                              onChange={(e) => patch(p.id, { name: e.target.value })}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs text-white/70">Descripción</label>
                            <textarea
                              className="mt-1 min-h-[90px] w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl"
                              value={p.description ?? ""}
                              onChange={(e) => patch(p.id, { description: e.target.value })}
                            />
                          </div>

                          <div>
                            <label className="text-xs text-white/70">Precio Detal</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 w-full ${inputBase()}`}
                              value={String(p.price_retail ?? 0)}
                              onChange={(e) => patch(p.id, { price_retail: digitsOnlyToNumber(e.target.value, 0) })}
                            />
                          </div>

                          <div>
                            <label className="text-xs text-white/70">Precio Mayor</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 w-full ${inputBase()}`}
                              value={String(p.price_wholesale ?? 0)}
                              onChange={(e) => patch(p.id, { price_wholesale: digitsOnlyToNumber(e.target.value, 0) })}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs text-white/70">Mínimo Mayor</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 w-full ${inputBase()}`}
                              value={String(p.min_wholesale ?? 1)}
                              onChange={(e) => patch(p.id, { min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)) })}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs text-white/70">
                              Stock <span className="text-white/40">(vacío = ilimitado)</span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className={`mt-1 w-full ${inputBase()}`}
                              value={p.stock ?? ""}
                              placeholder="Ej: 10 o vacío"
                              onChange={(e) => setStockWithRule(p.id, safeIntOrNull(e.target.value))}
                            />
                            <p className="mt-2 text-[11px] text-white/50">
                              Si el stock llega a <b>0</b>, se marca <b>inactivo (sin guardar)</b>.
                            </p>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-xs text-white/70">Categoría</label>
                            <select
                              className={`mt-1 w-full ${inputBase()}`}
                              value={p.category_id ?? ""}
                              onChange={(e) => patch(p.id, { category_id: e.target.value || null })}
                            >
                              <option value="">Sin categoría</option>
                              {cats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Active draft */}
                        <div className="flex items-center gap-2">
                          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${badgeActive(uiActive)}`}>
                            <input type="checkbox" checked={uiActive} onChange={() => toggleActiveDraft(p.id)} />
                            {uiActive ? "Activo" : "Inactivo"}
                          </div>
                          <span className="text-xs text-white/50">
                            (Se aplica al guardar)
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button className={buttonPrimary()} onClick={() => save(p)} disabled={savingId === p.id}>
                            {savingId === p.id ? "Guardando…" : "Guardar"}
                          </button>

                          <button className={buttonDanger()} onClick={() => remove(p)} disabled={deletingId === p.id}>
                            {deletingId === p.id ? "Eliminando…" : "Eliminar"}
                          </button>

                          <button className={buttonGhost()} type="button" onClick={() => copyId(p.id)}>
                            Copiar ID
                          </button>

                          <span className="ml-auto text-xs text-white/45">
                            ID: <span className="text-white/70">{p.id}</span>
                          </span>
                        </div>
                      </div>

                      {/* Right image */}
                      <div className="rounded-[22px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                        <p className="font-semibold">Imagen principal</p>
                        <p className="text-sm text-white/70">Sube la imagen y luego presiona Guardar.</p>

                        <div className="mt-3">
                          <ImageUpload
                            label="Subir imagen"
                            currentUrl={p.image_url}
                            pathPrefix={`admin/products/${p.store_id}/`}
                            fileName={`${p.id}.png`}
                            bucket="product-images"
                            onUploaded={(url) => patch(p.id, { image_url: url })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* footer: cargar más */}
          <div className="p-3 flex items-center justify-center">
            {hasMore ? (
              <button className={buttonPrimary()} type="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando…" : "Cargar más"}
              </button>
            ) : (
              <div className="text-xs text-white/50">No hay más productos por cargar.</div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
