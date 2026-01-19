"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../store/ImageUpload";

type Category = {
  id: string;
  store_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  active: boolean;
};

export default function CategoriesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(s));
  }, [categories, q]);

  async function load() {
    setLoading(true);

    const { data: userData } = await supabaseBrowser.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      await Swal.fire({ icon: "error", title: "Debes iniciar sesión" });
      return;
    }
    setUserId(userData.user.id);

    const { data: storeData, error: storeErr } = await supabaseBrowser
      .from("stores")
      .select("id")
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (storeErr || !storeData) {
      setLoading(false);
      await Swal.fire({ icon: "error", title: "No se encontró tu tienda" });
      return;
    }
    setStoreId(storeData.id);

    const { data: catData, error: catErr } = await supabaseBrowser
      .from("product_categories")
      .select("id,store_id,name,image_url,sort_order,active")
      .eq("store_id", storeData.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (catErr) {
      setLoading(false);
      await Swal.fire({ icon: "error", title: "Error cargando", text: catErr.message });
      return;
    }

    setCategories((catData as Category[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function updateCat(id: string, patch: Partial<Category>) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function createCategory() {
    if (!storeId) return;
    setSaving(true);

    const { data, error } = await supabaseBrowser
      .from("product_categories")
      .insert({
        store_id: storeId,
        name: "Nueva categoría",
        image_url: null,
        sort_order: categories.length + 1,
        active: true,
      })
      .select("id,store_id,name,image_url,sort_order,active")
      .single();

    setSaving(false);

    if (error) {
      await Swal.fire({ icon: "error", title: "Error creando", text: error.message });
      return;
    }

    setCategories((prev) => [data as Category, ...prev]);
    await Swal.fire({
      icon: "success",
      title: "Categoría creada",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#ffffff",
    });
  }

  async function saveCategory(c: Category) {
    setSaving(true);

    const { error } = await supabaseBrowser
      .from("product_categories")
      .update({
        name: c.name,
        image_url: c.image_url,
        sort_order: c.sort_order,
        active: c.active,
      })
      .eq("id", c.id);

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "Error guardando",
        text: error.message,
        background: "#0b0b0b",
        color: "#ffffff",
      });
      return;
    }

    await Swal.fire({
      icon: "success",
      title: "Guardado",
      text: "Categoría actualizada correctamente.",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#ffffff",
    });
  }

  async function deleteCategory(c: Category) {
    const res = await Swal.fire({
      title: "¿Eliminar categoría?",
      text: `Se eliminará "${c.name}". Los productos quedarán sin categoría.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonText: "Cancelar",
      confirmButtonText: "Sí, eliminar",
      background: "#0b0b0b",
      color: "#ffffff",
    });

    if (!res.isConfirmed) return;

    setSaving(true);

    // borrar imagen (si existe)
    try {
      if (userId) {
        const path = `${userId}/categories/${c.id}.png`;
        await supabaseBrowser.storage.from("category-images").remove([path]);
      }
    } catch {}

    const { error } = await supabaseBrowser.from("product_categories").delete().eq("id", c.id);

    setSaving(false);

    if (error) {
      await Swal.fire({ icon: "error", title: "Error eliminando", text: error.message });
      return;
    }

    setCategories((prev) => prev.filter((x) => x.id !== c.id));
    await Swal.fire({
      icon: "success",
      title: "Eliminada",
      timer: 1200,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#ffffff",
    });
  }

  if (loading) return <main className="p-6">Cargando categorías...</main>;

  return (
    <main className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorías</h1>
          <p className="text-sm opacity-80">Crea categorías con imagen para ordenar tus productos.</p>
        </div>
        <div className="flex gap-2">
          <button className="rounded-xl border border-white/10 px-4 py-2" onClick={load} disabled={saving}>
            Recargar
          </button>
          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
            onClick={createCategory}
            disabled={saving}
          >
            + Nueva
          </button>
        </div>
      </div>

      <input
        className="w-full md:max-w-md rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
        placeholder="Buscar categoría..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="space-y-4">
        {filtered.map((c) => (
          <div key={c.id} className="rounded-2xl border border-white/10 p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <input
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none text-lg font-semibold"
                    value={c.name}
                    onChange={(e) => updateCat(c.id, { name: e.target.value })}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={(e) => updateCat(c.id, { active: e.target.checked })}
                    />
                    Activa
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm opacity-80">Orden</label>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                      value={c.sort_order}
                      onChange={(e) => updateCat(c.id, { sort_order: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
                    onClick={() => saveCategory(c)}
                    disabled={saving}
                  >
                    Guardar
                  </button>
                  <button
                    className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200 disabled:opacity-60"
                    onClick={() => deleteCategory(c)}
                    disabled={saving}
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 p-4">
                <p className="font-semibold">Imagen de categoría</p>
                <p className="text-sm opacity-80">Se verá en el catálogo.</p>

                {userId ? (
                  <div className="mt-3">
                    <ImageUpload
                      label="Subir imagen"
                      currentUrl={c.image_url}
                      pathPrefix={`${userId}/categories/`}
                      fileName={`${c.id}.png`}
                      bucket="category-images"
                      onUploaded={(url) => updateCat(c.id, { image_url: url })}
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm">Cargando usuario...</p>
                )}

                <p className="mt-2 text-xs opacity-70">
                  Luego presiona <b>Guardar</b>.
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
