"use client";

import { useEffect, useMemo, useState } from "react";
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
  active: boolean;
  image_url: string | null;
  category_id: string | null;
};

export default function AdminProductosPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");

  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) {
        return false;
      }

      const s = q.trim().toLowerCase();
      if (!s) return true;

      return (
        p.name.toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [products, q, categoryFilter]);

  async function loadStores() {
    const { data, error } = await supabaseBrowser
      .from("stores")
      .select("id,name,slug")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const arr = (data as StoreMini[]) ?? [];
    setStores(arr);
    if (!storeId && arr[0]) setStoreId(arr[0].id);
  }

  async function loadCats(sid: string) {
    const { data, error } = await supabaseBrowser
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
    const { data, error } = await supabaseBrowser
      .from("products")
      .select(
        "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id",
      )
      .eq("store_id", sid)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setProducts((data as Product[]) ?? []);
    setLoading(false);
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
        await Promise.all([loadCats(storeId), loadProducts(storeId)]);
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
  }, [storeId]);

  function patch(id: string, p: Partial<Product>) {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function create() {
    if (!storeId) return;
    setSaving(true);

    const { data, error } = await supabaseBrowser
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
      })
      .select(
        "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id",
      )
      .single();

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    setProducts((prev) => [data as Product, ...prev]);
  }

  async function save(p: Product) {
    setSaving(true);

    const { error } = await supabaseBrowser
      .from("products")
      .update({
        name: p.name,
        description: p.description,
        price_retail: p.price_retail,
        price_wholesale: p.price_wholesale,
        min_wholesale: p.min_wholesale,
        active: p.active,
        image_url: p.image_url,
        category_id: cats.some((c) => c.id === p.category_id)
          ? p.category_id
          : null,
      })
      .eq("id", p.id);

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    await Swal.fire({
      icon: "success",
      title: "Guardado",
      timer: 900,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
    });
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
    const { error } = await supabaseBrowser
      .from("products")
      .delete()
      .eq("id", p.id);
    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo eliminar",
        text: error.message,
        background: "#0b0b0b",
        color: "#fff",
      });
      return;
    }

    setProducts((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Productos</h2>
          <p className="text-sm opacity-80">
            CRUD por tienda + categoría e imagen.
          </p>
        </div>

        <div className="flex gap-2">
          <a
            href={`/${stores.find((s) => s.id === storeId)?.slug}/detal`}
            target="_blank"
            className="rounded-xl border border-white/10 px-4 py-2"
          >
            Ver catálogo Detal
          </a>

          <a
            href={`/${stores.find((s) => s.id === storeId)?.slug}/mayor`}
            target="_blank"
            className="rounded-xl border border-white/10 px-4 py-2"
          >
            Ver catálogo Mayor
          </a>

          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-semibold"
            onClick={create}
            disabled={saving || !storeId}
          >
            + Nuevo
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <select
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.slug})
            </option>
          ))}
        </select>

        <select
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar producto..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none text-lg font-semibold"
                      value={p.name}
                      onChange={(e) => patch(p.id, { name: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={(e) =>
                          patch(p.id, { active: e.target.checked })
                        }
                      />
                      Activo
                    </label>
                  </div>

                  <textarea
                    className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none min-h-[90px]"
                    placeholder="Descripción"
                    value={p.description ?? ""}
                    onChange={(e) =>
                      patch(p.id, { description: e.target.value })
                    }
                  />

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-sm opacity-80">Precio Detal</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                        value={p.price_retail ?? 0}
                        onChange={(e) =>
                          patch(p.id, { price_retail: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm opacity-80">Precio Mayor</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                        value={p.price_wholesale ?? 0}
                        onChange={(e) =>
                          patch(p.id, {
                            price_wholesale: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm opacity-80">Mínimo Mayor</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                        value={p.min_wholesale ?? 1}
                        onChange={(e) =>
                          patch(p.id, { min_wholesale: Number(e.target.value) })
                        }
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="text-sm opacity-80">Categoría</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                        value={p.category_id ?? ""}
                        onChange={(e) =>
                          patch(p.id, { category_id: e.target.value || null })
                        }
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

                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
                      onClick={() => save(p)}
                      disabled={saving}
                    >
                      Guardar
                    </button>

                    <button
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200 disabled:opacity-60"
                      onClick={() => remove(p)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <div className="w-full lg:w-[360px]">
                  <div className="rounded-2xl border border-white/10 p-4">
                    <p className="font-semibold">Imagen principal</p>
                    <p className="text-sm opacity-80">
                      Se verá en el catálogo.
                    </p>

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

                    <p className="mt-2 text-xs opacity-70">
                      Luego presiona <b>Guardar</b>.
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs opacity-60">ID: {p.id}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
