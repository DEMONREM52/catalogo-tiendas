"use client";

import React, { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "@/app/dashboard/store/ImageUpload";

type StoreMini = { id: string; name: string; slug: string };
type Cat = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  name: string;
  description: string | null;

  price_retail: number | null;
  price_wholesale: number | null;
  min_wholesale: number | null;

  stock: number | null; // null = ilimitado

  active: boolean; // ✅ REAL (DB)
  active_draft?: boolean; // ✅ SOLO UI (se aplica al guardar)

  image_url: string | null;
  category_id: string | null;
};

type StatusFilter = "active" | "inactive" | "out" | "all";

/* =========================
   UI helpers (classes)
========================= */
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
function badgeActive(active: boolean) {
  return active
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
    : "border-white/10 bg-white/5 text-white/70";
}

/* =========================
   Data helpers
========================= */
function safeIntOrNull(v: any) {
  const t = String(v ?? "").trim();
  if (!t) return null; // vacío => ilimitado
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function clampNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isOutOfStock(stock: number | null) {
  return stock !== null && stock <= 0;
}

function stockLabel(stock: number | null) {
  if (stock === null) return "Ilimitado";
  if (stock <= 0) return "Agotado";
  return `${stock} disponibles`;
}

/**
 * ✅ Excel-like: 1 click selecciona todo para sobreescribir (sin error)
 * - Evita el error "Cannot read properties of null (reading 'select')"
 */
function excelSelectHandlers() {
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      requestAnimationFrame(() => {
        try {
          el.select();
        } catch {}
      });
    },
    onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      if (document.activeElement !== el) {
        e.preventDefault();
        el.focus();
      }
    },
  };
}

/**
 * ✅ Para precios más fácil:
 * - type="text" + inputMode="numeric"
 * - limpia caracteres no numéricos
 * - así NO te queda "012000"
 */
function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}

export default function AdminProductosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // ✅ Por defecto "all" para que NO desaparezcan al destildar
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const currentStore = useMemo(
    () => stores.find((s) => s.id === storeId) ?? null,
    [stores, storeId]
  );

  /* =========================
     Local state helpers
  ========================= */
  function patch(id: string, p: Partial<Product>) {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  // ✅ checkbox SOLO cambia active_draft (UI)
  function toggleActiveDraft(id: string) {
    setProducts((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const cur = x.active_draft ?? x.active;
        return { ...x, active_draft: !cur };
      })
    );
  }

  // ✅ si stock llega a 0 => draft inactivo (pero NO guarda hasta Guardar)
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

  function quickStock(p: Product, delta: number) {
    const base = p.stock ?? 0; // si era ilimitado, lo tratamos como 0
    const next = Math.max(0, base + delta);
    patch(p.id, { stock: next });
  }

  /* =========================
     Filtering (usa ACTIVE REAL, no draft)
  ========================= */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;

      const out = isOutOfStock(p.stock);

      // ✅ usa p.active REAL (DB)
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

      return (
        p.name.toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [products, q, categoryFilter, statusFilter]);

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

  async function loadProducts(sid: string) {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("products")
        .select(
          "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .eq("store_id", sid)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // ✅ normaliza e inicializa draft = active
      const rows = ((data as Product[]) ?? []).map((p) => ({
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

      setProducts(rows);
    } finally {
      setLoading(false);
    }
  }

  async function reloadStoreData() {
    if (!storeId) return;
    await Promise.all([loadCats(storeId), loadProducts(storeId)]);
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

    setSaving(true);
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
          "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,stock,active,image_url,category_id"
        )
        .single();

      if (error) throw error;

      const row = {
        ...(data as Product),
        active_draft: (data as Product).active,
      };

      setProducts((prev) => [row, ...prev]);

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
      setSaving(false);
    }
  }

  async function save(p: Product) {
    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const validCategory = cats.some((c) => c.id === p.category_id);

      const payloadStock =
        p.stock === null ? null : Math.max(0, Math.floor(clampNum(p.stock, 0)));

      // ✅ el activo que se guarda es el DRAFT (si existe), si no el real
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

      // ✅ al guardar, sincroniza active REAL con draft
      patch(p.id, {
        active: payloadActive,
        active_draft: payloadActive,
        stock: payloadStock,
      });

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 900,
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
      setSaving(false);
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

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) throw error;

      setProducts((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  /* =========================
     UI
  ========================= */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">📦 Productos</h2>
          <p className="text-sm text-white/70">
            CRUD por tienda · categoría · precios · imagen · inventario.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={buttonGhost()}
            onClick={reloadStoreData}
            disabled={saving || !storeId}
          >
            Recargar
          </button>

          <a
            href={`/${currentStore?.slug ?? ""}/detal`}
            target="_blank"
            rel="noreferrer"
            className={buttonGhost()}
          >
            Ver catálogo Detal
          </a>

          <a
            href={`/${currentStore?.slug ?? ""}/mayor`}
            target="_blank"
            rel="noreferrer"
            className={buttonGhost()}
          >
            Ver catálogo Mayor
          </a>

          <button className={buttonPrimary()} onClick={create} disabled={saving || !storeId}>
            + Nuevo
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
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
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="out">Agotados</option>
        </select>

        <input className={inputBase()} placeholder="Buscar producto..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="font-semibold">No hay productos</p>
          <p className="mt-1 text-sm text-white/70">Crea un producto o cambia los filtros.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const out = isOutOfStock(p.stock);

            // UI muestra el draft, pero filtros usan p.active real
            const uiActive = p.active_draft ?? p.active;
            const dirtyActive = uiActive !== p.active;

            return (
              <div key={p.id} className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  {/* Left */}
                  <div className="flex-1 space-y-3">
                    {/* Name + active */}
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <input
                        className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-base font-semibold outline-none backdrop-blur-xl"
                        value={p.name}
                        onChange={(e) => patch(p.id, { name: e.target.value })}
                      />

                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80"
                          style={{
                            background: out
                              ? "color-mix(in oklab, red 15%, transparent)"
                              : "color-mix(in oklab, var(--t-accent) 15%, transparent)",
                          }}
                        >
                          {stockLabel(p.stock)}
                        </span>

                        <div
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${badgeActive(
                            uiActive
                          )}`}
                          title={dirtyActive ? "Cambios sin guardar" : undefined}
                        >
                          <input type="checkbox" checked={uiActive} onChange={() => toggleActiveDraft(p.id)} />
                          {uiActive ? "Activo" : "Inactivo"}
                          {dirtyActive ? <span className="ml-1 text-[10px] text-white/60">(sin guardar)</span> : null}
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <textarea
                      className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none placeholder:text-white/40 backdrop-blur-xl"
                      placeholder="Descripción"
                      value={p.description ?? ""}
                      onChange={(e) => patch(p.id, { description: e.target.value })}
                    />

                    {/* GRID */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* ✅ PRECIOS: text + inputMode numeric + select-all */}
                      <div>
                        <label className="text-xs text-white/70">Precio Detal</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
                          value={String(p.price_retail ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) => patch(p.id, { price_retail: digitsOnlyToNumber(e.target.value, 0) })}
                        />
                      </div>

                      <div>
                        <label className="text-xs text-white/70">Precio Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
                          value={String(p.price_wholesale ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) => patch(p.id, { price_wholesale: digitsOnlyToNumber(e.target.value, 0) })}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-xs text-white/70">Mínimo Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
                          value={String(p.min_wholesale ?? 1)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            patch(p.id, { min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)) })
                          }
                        />
                      </div>

                      {/* stock */}
                      <div className="sm:col-span-2">
                        <label className="text-xs text-white/70">
                          Stock (inventario) <span className="text-white/40">(vacío = ilimitado)</span>
                        </label>

                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
                          value={p.stock ?? ""}
                          placeholder="Ej: 10 (o vacío)"
                          {...excelSelectHandlers()}
                          onChange={(e) => {
                            const v = safeIntOrNull(e.target.value);
                            setStockWithRule(p.id, v);
                          }}
                        />

                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className={buttonGhost()} onClick={() => patch(p.id, { stock: null })} disabled={saving}>
                            Ilimitado
                          </button>
                          <button type="button" className={buttonGhost()} onClick={() => setStockWithRule(p.id, 0)} disabled={saving}>
                            0
                          </button>
                          <button type="button" className={buttonGhost()} onClick={() => quickStock(p, 10)} disabled={saving}>
                            +10
                          </button>
                          <button type="button" className={buttonGhost()} onClick={() => quickStock(p, 100)} disabled={saving}>
                            +100
                          </button>
                          <button type="button" className={buttonGhost()} onClick={() => quickStock(p, 1000)} disabled={saving}>
                            +1000
                          </button>
                        </div>

                        <p className="mt-2 text-xs text-white/55">
                          Disponibles ahora: <b>{p.stock === null ? "Ilimitado" : p.stock}</b>
                        </p>

                        <p className="mt-1 text-[11px] text-white/50">
                          Si el stock llega a <b>0</b>, se marca <b>inactivo (sin guardar)</b> automáticamente.
                        </p>
                      </div>

                      {/* categoría */}
                      <div className="sm:col-span-2">
                        <label className="text-xs text-white/70">Categoría</label>
                        <select
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm outline-none backdrop-blur-xl"
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

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      <button className={buttonPrimary()} onClick={() => save(p)} disabled={saving}>
                        Guardar
                      </button>

                      <button className={buttonDanger()} onClick={() => remove(p)} disabled={saving}>
                        Eliminar
                      </button>

                      <span className="ml-auto text-xs text-white/45">ID: {p.id}</span>
                    </div>
                  </div>

                  {/* Right: image */}
                  <div className="w-full lg:w-[360px]">
                    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                      <p className="font-semibold">Imagen principal</p>
                      <p className="text-sm text-white/70">Se verá en el catálogo.</p>

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

                      <p className="mt-2 text-xs text-white/55">
                        Luego presiona <b>Guardar</b>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <p className="text-xs text-white/50">Mostrando productos de la tienda seleccionada.</p>
        </div>
      )}
    </div>
  );
}
