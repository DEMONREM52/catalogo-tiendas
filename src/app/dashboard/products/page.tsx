"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../store/ImageUpload";
import Swal from "sweetalert2";

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

export default function ProductsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");

  const [categories, setCategories] = useState<
    Array<{ id: string; name: string }>
  >([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => p.name.toLowerCase().includes(s));
  }, [products, q]);

  async function load() {
    setMsg(null);
    setLoading(true);

    const { data: userData } = await supabaseBrowser.auth.getUser();
    if (!userData.user) {
      setMsg("❌ Debes iniciar sesión.");
      setLoading(false);
      return;
    }
    setUserId(userData.user.id);

    const { data: storeData, error: storeErr } = await supabaseBrowser
      .from("stores")
      .select("id")
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (storeErr || !storeData) {
      setMsg("❌ No se encontró tu tienda.");
      setLoading(false);
      return;
    }
    setStoreId(storeData.id);

    const { data: prodData, error: prodErr } = await supabaseBrowser
      .from("products")
      .select(
        "id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id",
      )
      .eq("store_id", storeData.id)
      .order("name", { ascending: true });

    if (prodErr) {
      setMsg("❌ Error cargando productos: " + prodErr.message);
      setLoading(false);
      return;
    }

    setProducts((prodData as Product[]) ?? []);
    setLoading(false);
    const { data: cats } = await supabaseBrowser
      .from("product_categories")
      .select("id,name")
      .eq("store_id", storeData.id) // ✅ importante
      .eq("active", true)
      .order("sort_order", { ascending: true });
    setCategories(cats ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function updateProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  async function saveProduct(p: Product) {
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
        category_id: categories.some((c) => c.id === p.category_id)
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
        color: "#ffffff",
        confirmButtonColor: "#ef4444",
      });
      return;
    }

    await Swal.fire({
      icon: "success",
      title: "Producto actualizado",
      text: "Los cambios se guardaron correctamente.",
      timer: 1500,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#ffffff",
    });
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

    // borrar imagen del storage (si existe)
    try {
      const { data: userData } = await supabaseBrowser.auth.getUser();
      const userId = userData.user?.id;

      if (userId) {
        const path = `${userId}/products/${p.id}.png`;
        await supabaseBrowser.storage.from("product-images").remove([path]);
      }
    } catch {
      // no bloqueamos el borrado si falla la imagen
    }

    const { error } = await supabaseBrowser
      .from("products")
      .delete()
      .eq("id", p.id);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: error.message,
        background: "#0b0b0b",
        color: "#ffffff",
      });
      setSaving(false);
      return;
    }

    setProducts((prev) => prev.filter((x) => x.id !== p.id));

    await Swal.fire({
      icon: "success",
      title: "Eliminado",
      text: "El producto fue eliminado correctamente.",
      timer: 1600,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#ffffff",
    });

    setSaving(false);
  }

  async function createProduct() {
    if (!storeId) return;

    setSaving(true);
    setMsg(null);

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
      .select("id,store_id,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id")
      .single();

    if (error) {
      setMsg("❌ Error creando producto: " + error.message);
      setSaving(false);
      return;
    }

    setProducts((prev) => [data as Product, ...prev]);
    setMsg("✅ Producto creado");
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="p-6">
        <p>Cargando productos...</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm opacity-80">
            Sube imagen principal y edita precios detal/mayor.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-xl border border-white/10 px-4 py-2"
            onClick={load}
            disabled={saving}
          >
            Recargar
          </button>
          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
            onClick={createProduct}
            disabled={saving}
          >
            + Nuevo
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <input
          className="w-full md:max-w-md rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar producto..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {msg && <p className="text-sm">{msg}</p>}
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/10 p-4">
            <p className="font-semibold">No hay productos</p>
            <p className="text-sm opacity-80 mt-1">Crea uno con “+ Nuevo”.</p>
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none text-lg font-semibold"
                      value={p.name}
                      onChange={(e) =>
                        updateProduct(p.id, { name: e.target.value })
                      }
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={(e) =>
                          updateProduct(p.id, { active: e.target.checked })
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
                      updateProduct(p.id, { description: e.target.value })
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
                          updateProduct(p.id, {
                            price_retail: Number(e.target.value),
                          })
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
                          updateProduct(p.id, {
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
                          updateProduct(p.id, {
                            min_wholesale: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="mt-3">
                      <label className="text-sm opacity-80">Categoría</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                        value={p.category_id ?? ""}
                        onChange={(e) =>
                          updateProduct(p.id, {
                            category_id: e.target.value || null,
                          })
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

                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
                      onClick={() => saveProduct(p)}
                      disabled={saving}
                    >
                      Guardar
                    </button>

                    <button
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200 disabled:opacity-60"
                      onClick={() => deleteProduct(p)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                {/* Imagen */}
                <div className="w-full lg:w-[360px]">
                  {!userId ? (
                    <div className="rounded-2xl border border-white/10 p-4">
                      <p className="text-sm">Cargando usuario...</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 p-4">
                      <p className="font-semibold">Imagen principal</p>
                      <p className="text-sm opacity-80">
                        Se verá en el catálogo.
                      </p>

                      <div className="mt-3">
                        <ImageUpload
                          label="Subir imagen"
                          currentUrl={p.image_url}
                          pathPrefix={`${userId}/products/`}
                          fileName={`${p.id}.png`}
                          bucket="product-images"
                          onUploaded={(url) =>
                            updateProduct(p.id, { image_url: url })
                          }
                        />
                      </div>

                      <p className="mt-2 text-xs opacity-70">
                        Luego presiona <b>Guardar</b> para que quede en la base.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
