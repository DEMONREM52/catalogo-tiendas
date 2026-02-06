"use client";

import React, { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../store/ImageUpload";

type Product = {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  price_retail: number | null;
  price_wholesale: number | null;
  min_wholesale: number | null;

  active: boolean; // REAL DB
  active_draft?: boolean; // SOLO UI (se aplica al guardar)

  image_url: string | null;
  category_id: string | null;

  stock: number | null; // null = ilimitado
};

type Filter = "active" | "inactive" | "out" | "all";

function clampIntOrNull(v: any): number | null {
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

function isOut(stock: number | null) {
  return stock !== null && stock <= 0;
}

function stockLabel(stock: number | null) {
  if (stock === null) return "Ilimitado";
  if (stock <= 0) return "Agotado";
  return `${stock} disponibles`;
}

/**
 * ✅ Excel-like: 1 click selecciona todo para sobreescribir (sin error)
 * - onFocus: selecciona el texto (usando requestAnimationFrame)
 * - onMouseDown: primer click no mueve cursor (para que luego seleccione)
 */
function excelSelectHandlers() {
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      const el = e.currentTarget; // ✅ guardamos el elemento (no el evento)
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
 * ✅ Mejor UX “tipo Excel” para precios:
 * - usamos text + inputMode numeric para que al escribir reemplaces fácil
 * - guardamos en estado como number
 */
function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}

export default function ProductsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");

  // ✅ Default "all" para que no desaparezca nada al editar
  const [filter, setFilter] = useState<Filter>("all");

  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>(
    []
  );

  // ✅ filtro basado en active REAL (DB), NO en draft
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return products.filter((p) => {
      if (filter === "active" && (!p.active || isOut(p.stock))) return false;
      if (filter === "inactive" && p.active) return false;
      if (filter === "out" && !isOut(p.stock)) return false;

      if (!s) return true;

      return (
        p.name.toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [products, q, filter]);

  async function load() {
    setMsg(null);
    setLoading(true);

    try {
      const sb = supabaseBrowser();

      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        setMsg("❌ Debes iniciar sesión.");
        setLoading(false);
        return;
      }

      setUserId(userData.user.id);

      const { data: storeData, error: storeErr } = await sb
        .from("stores")
        .select("id")
        .eq("owner_id", userData.user.id)
        .maybeSingle();

      if (storeErr) throw storeErr;

      if (!storeData) {
        setMsg("❌ No se encontró tu tienda.");
        setLoading(false);
        return;
      }

      setStoreId(storeData.id);

      const { data: prodData, error: prodErr } = await sb
        .from("products")
        .select(
          "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .eq("store_id", storeData.id)
        .order("created_at", { ascending: false });

      if (prodErr) throw prodErr;

      // ✅ normaliza + inicia draft = estado real
      const rows = ((prodData as Product[]) ?? []).map((p) => ({
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

      const { data: cats, error: catsErr } = await sb
        .from("product_categories")
        .select("id,name")
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (catsErr) throw catsErr;

      setCategories((cats as any[]) ?? []);
    } catch (e: any) {
      setMsg("❌ Error cargando: " + (e?.message ?? "Error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  // ✅ checkbox SOLO toca active_draft
  function toggleActiveDraft(id: string) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const cur = p.active_draft ?? p.active;
        return { ...p, active_draft: !cur };
      })
    );
  }

  // ✅ regla: si stock llega a 0 => draft inactivo automáticamente (sin guardar)
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

  async function saveProduct(p: Product) {
    setSaving(true);

    try {
      const sb = supabaseBrowser();
      const validCat = categories.some((c) => c.id === p.category_id);

      const payloadActive = !!(p.active_draft ?? p.active);
      const payloadStock =
        p.stock === null ? null : Math.max(0, Math.floor(clampNum(p.stock, 0)));

      const { error } = await sb
        .from("products")
        .update({
          name: p.name,
          description: p.description,
          price_retail: clampNum(p.price_retail, 0),
          price_wholesale: clampNum(p.price_wholesale, 0),
          min_wholesale: Math.max(1, clampNum(p.min_wholesale, 1)),
          active: payloadActive,
          image_url: p.image_url,
          category_id: validCat ? p.category_id : null,
          stock: payloadStock,
        })
        .eq("id", p.id);

      if (error) throw error;

      // ✅ sincroniza real con draft
      updateProduct(p.id, {
        active: payloadActive,
        active_draft: payloadActive,
        stock: payloadStock,
      });

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Producto actualizado correctamente.",
        timer: 900,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#ffffff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    const res = await Swal.fire({
      title: "¿Eliminar producto?",
      text: `El producto "${p.name}" será eliminado permanentemente.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#374151",
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#ffffff",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    setMsg(null);

    try {
      const sb = supabaseBrowser();

      // borrar imagen (si existe) - NO bloquea si falla
      try {
        const { data: userData } = await sb.auth.getUser();
        const uid = userData.user?.id;
        if (uid) {
          const path = `${uid}/products/${p.id}.png`;
          await sb.storage.from("product-images").remove([path]);
        }
      } catch {}

      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) throw error;

      setProducts((prev) => prev.filter((x) => x.id !== p.id));

      await Swal.fire({
        icon: "success",
        title: "Eliminado",
        timer: 900,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error eliminando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createProduct() {
    if (!storeId) return;

    setSaving(true);
    setMsg(null);

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
          active: true,
          image_url: null,
          category_id: null,
          stock: null, // ilimitado por defecto
        })
        .select(
          "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .single();

      if (error) throw error;

      setProducts((prev) => [{ ...(data as Product), active_draft: true }, ...prev]);

      await Swal.fire({
        icon: "success",
        title: "Producto creado",
        timer: 850,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } catch (e: any) {
      setMsg("❌ Error creando producto: " + (e?.message ?? "Error"));
    } finally {
      setSaving(false);
    }
  }

  // ✅ acciones rápidas: ponen draft activo
  function quickStock(p: Product, delta: number) {
    const base = p.stock ?? 0;
    const next = Math.max(0, base + delta);
    updateProduct(p.id, { stock: next, active_draft: true });
  }

  function setUnlimited(p: Product) {
    updateProduct(p.id, { stock: null, active_draft: true });
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando productos...</p>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-6 space-y-5 panel-enter">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm opacity-80">
            Administra precios, imagen, categoría e <b>inventario</b>.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button className="btn-soft px-4 py-2" onClick={load} disabled={saving}>
            Recargar
          </button>
          <button
            className="btn-cta px-4 py-2 font-semibold disabled:opacity-60"
            onClick={createProduct}
            disabled={saving}
          >
            + Nuevo
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <select
              className="w-full sm:w-[220px] p-3"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="out">Agotados (stock 0)</option>
            </select>

            <input
              className="w-full sm:w-[360px] p-3"
              placeholder="Buscar producto..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {msg ? <div className="glass-soft px-3 py-2 text-sm">{msg}</div> : null}
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="glass p-5">
            <p className="font-semibold">No hay productos</p>
            <p className="text-sm opacity-80 mt-1">
              Crea uno con “+ Nuevo” o cambia filtros.
            </p>
          </div>
        ) : (
          filtered.map((p) => {
            const out = isOut(p.stock);

            const uiActive = p.active_draft ?? p.active;
            const dirtyActive = uiActive !== p.active;

            const chipBg = out
              ? "color-mix(in oklab, red 18%, transparent)"
              : "color-mix(in oklab, var(--t-accent) 18%, transparent)";

            return (
              <div key={p.id} className="glass p-4 sm:p-5">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 lg:gap-6">
                  {/* LEFT */}
                  <div className="min-w-0">
                    {/* Name + chips */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <input
                        className="w-full p-3 text-lg font-semibold"
                        value={p.name}
                        onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      />

                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-full border px-3 py-1 text-xs font-semibold"
                          style={{
                            borderColor: "var(--t-card-border)",
                            background: chipBg,
                          }}
                        >
                          {stockLabel(p.stock)}
                        </span>

                        <label
                          className="flex items-center gap-2 text-sm whitespace-nowrap"
                          title={dirtyActive ? "Cambios sin guardar" : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={uiActive}
                            onChange={() => toggleActiveDraft(p.id)}
                          />
                          Activo
                          {dirtyActive ? (
                            <span className="text-xs opacity-70">(sin guardar)</span>
                          ) : null}
                        </label>
                      </div>
                    </div>

                    <textarea
                      className="mt-3 w-full p-3 min-h-[92px] resize-none"
                      placeholder="Descripción"
                      value={p.description ?? ""}
                      onChange={(e) => updateProduct(p.id, { description: e.target.value })}
                    />

                    {/* GRID */}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* ✅ PRECIOS: text + inputMode numeric (mejor que number para “excel”) */}
                      <div className="glass-soft p-3">
                        <label className="text-sm opacity-80">Precio Detal</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full p-3"
                          value={String(p.price_retail ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            updateProduct(p.id, {
                              price_retail: digitsOnlyToNumber(e.target.value, 0),
                            })
                          }
                        />
                      </div>

                      <div className="glass-soft p-3">
                        <label className="text-sm opacity-80">Precio Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full p-3"
                          value={String(p.price_wholesale ?? 0)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            updateProduct(p.id, {
                              price_wholesale: digitsOnlyToNumber(e.target.value, 0),
                            })
                          }
                        />
                      </div>

                      <div className="glass-soft p-3 sm:col-span-2">
                        <label className="text-sm opacity-80">Mínimo Mayor</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-1 w-full p-3"
                          value={String(p.min_wholesale ?? 1)}
                          {...excelSelectHandlers()}
                          onChange={(e) =>
                            updateProduct(p.id, {
                              min_wholesale: Math.max(
                                1,
                                digitsOnlyToNumber(e.target.value, 1)
                              ),
                            })
                          }
                        />
                      </div>

                      <div className="glass-soft p-3 sm:col-span-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-sm opacity-80">Stock (inventario)</label>

                          <div className="flex flex-wrap gap-2 justify-end">
                            <button
                              className="btn-soft px-3 py-1 text-xs"
                              onClick={() => quickStock(p, 10)}
                              disabled={saving}
                              type="button"
                            >
                              +10
                            </button>
                            <button
                              className="btn-soft px-3 py-1 text-xs"
                              onClick={() => quickStock(p, 100)}
                              disabled={saving}
                              type="button"
                            >
                              +100
                            </button>
                            <button
                              className="btn-soft px-3 py-1 text-xs"
                              onClick={() => quickStock(p, 1000)}
                              disabled={saving}
                              type="button"
                            >
                              +1000
                            </button>
                            <button
                              className="btn-soft px-3 py-1 text-xs"
                              onClick={() => setUnlimited(p)}
                              disabled={saving}
                              type="button"
                            >
                              Ilimitado
                            </button>
                          </div>
                        </div>

                        <input
                          type="text"
                          inputMode="numeric"
                          className="mt-2 w-full p-3"
                          placeholder="Vacío = ilimitado"
                          value={p.stock ?? ""}
                          {...excelSelectHandlers()}
                          onChange={(e) => {
                            const v = clampIntOrNull(e.target.value);
                            setStockWithRule(p.id, v);
                          }}
                        />

                        <p className="mt-2 text-xs opacity-70">
                          Si el stock llega a <b>0</b>, el producto se marca{" "}
                          <b>inactivo (sin guardar)</b> automáticamente.
                        </p>

                        {!p.active && !out ? (
                          <p className="mt-1 text-xs opacity-80">
                            Tienes stock pero está inactivo en BD: puedes activarlo con “Activo”
                            y luego <b>Guardar</b>.
                          </p>
                        ) : null}
                      </div>

                      <div className="glass-soft p-3 sm:col-span-2">
                        <label className="text-sm opacity-80">Categoría</label>
                        <select
                          className="mt-1 w-full p-3"
                          value={p.category_id ?? ""}
                          onChange={(e) =>
                            updateProduct(p.id, { category_id: e.target.value || null })
                          }
                        >
                          <option value="">Sin categoría</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                      <button
                        className="btn-cta px-4 py-2 font-semibold disabled:opacity-60"
                        onClick={() => saveProduct(p)}
                        disabled={saving}
                      >
                        Guardar
                      </button>

                      <button
                        className="btn-soft px-4 py-2 font-semibold disabled:opacity-60"
                        style={{
                          borderColor: "color-mix(in oklab, red 30%, var(--t-card-border))",
                          background: "color-mix(in oklab, red 10%, transparent)",
                          color: "color-mix(in oklab, white 85%, red 15%)",
                        }}
                        onClick={() => deleteProduct(p)}
                        disabled={saving}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  {/* RIGHT IMAGE */}
                  <div className="w-full">
                    {!userId ? (
                      <div className="glass-soft p-4">
                        <p className="text-sm">Cargando usuario...</p>
                      </div>
                    ) : (
                      <div className="glass-soft p-4">
                        <p className="font-semibold">Imagen principal</p>
                        <p className="text-sm opacity-80">Se verá en el catálogo.</p>

                        <div className="mt-3">
                          <ImageUpload
                            label="Subir imagen"
                            currentUrl={p.image_url}
                            pathPrefix={`${userId}/products/`}
                            fileName={`${p.id}.png`}
                            bucket="product-images"
                            onUploaded={(url) => updateProduct(p.id, { image_url: url })}
                          />
                        </div>

                        <p className="mt-2 text-xs opacity-70">
                          Luego presiona <b>Guardar</b>.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
