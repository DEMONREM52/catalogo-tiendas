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

    try {
      const sb = supabaseBrowser();

      // 1) Usuario
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        await Swal.fire({
          icon: "error",
          title: "Debes iniciar sesión",
          background: "#0b0b0b",
          color: "#ffffff",
        });
        setLoading(false);
        return;
      }

      setUserId(userData.user.id);

      // 2) Tienda por owner_id
      const { data: storeData, error: storeErr } = await sb
        .from("stores")
        .select("id")
        .eq("owner_id", userData.user.id)
        .maybeSingle();

      if (storeErr) throw storeErr;

      if (!storeData) {
        await Swal.fire({
          icon: "error",
          title: "No se encontró tu tienda",
          background: "#0b0b0b",
          color: "#ffffff",
        });
        setLoading(false);
        return;
      }

      setStoreId(storeData.id);

      // 3) Categorías
      const { data: catData, error: catErr } = await sb
        .from("product_categories")
        .select("id,store_id,name,image_url,sort_order,active")
        .eq("store_id", storeData.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (catErr) throw catErr;

      setCategories((catData as Category[]) ?? []);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error cargando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateCat(id: string, patch: Partial<Category>) {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  async function createCategory() {
    if (!storeId) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
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

      if (error) throw error;

      setCategories((prev) => [data as Category, ...prev]);

      await Swal.fire({
        icon: "success",
        title: "Categoría creada",
        timer: 1100,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error creando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory(c: Category) {
    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb
        .from("product_categories")
        .update({
          name: c.name,
          image_url: c.image_url,
          sort_order: c.sort_order,
          active: c.active,
        })
        .eq("id", c.id);

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        text: "Categoría actualizada correctamente.",
        timer: 1100,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error guardando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#ffffff",
      });
    } finally {
      setSaving(false);
    }
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
    try {
      const sb = supabaseBrowser();

      // borrar imagen (si existe)
      try {
        if (userId) {
          const path = `${userId}/categories/${c.id}.png`;
          await sb.storage.from("category-images").remove([path]);
        }
      } catch {
        // ignorar
      }

      const { error } = await sb
        .from("product_categories")
        .delete()
        .eq("id", c.id);

      if (error) throw error;

      setCategories((prev) => prev.filter((x) => x.id !== c.id));

      await Swal.fire({
        icon: "success",
        title: "Eliminada",
        timer: 1100,
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

  if (loading) return <main className="p-6">Cargando categorías...</main>;

  return (
    <main className="p-6 space-y-6 panel-enter">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorías</h1>
          <p className="text-sm opacity-80">
            Crea categorías con imagen para ordenar tus productos.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-soft px-4 py-2" onClick={load} disabled={saving}>
            Recargar
          </button>
          <button className="btn-cta px-4 py-2 font-semibold" onClick={createCategory} disabled={saving}>
            + Nueva
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="glass p-4">
        <input
          className="w-full md:max-w-md p-3"
          placeholder="Buscar categoría..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="space-y-4">
        {filtered.map((c) => (
          <div key={c.id} className="glass p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left */}
              <div className="lg:col-span-2 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <input
                    className="w-full p-3 text-lg font-semibold"
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
                      className="mt-1 w-full p-3"
                      value={c.sort_order}
                      onChange={(e) =>
                        updateCat(c.id, { sort_order: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-cta px-4 py-2 font-semibold disabled:opacity-60"
                    onClick={() => saveCategory(c)}
                    disabled={saving}
                  >
                    Guardar
                  </button>

                  <button
                    className="btn-soft px-4 py-2 font-semibold disabled:opacity-60"
                    style={{
                      borderColor: "color-mix(in oklab, red 35%, transparent)",
                      background: "color-mix(in oklab, red 10%, transparent)",
                      color: "color-mix(in oklab, white 85%, red 15%)",
                    }}
                    onClick={() => deleteCategory(c)}
                    disabled={saving}
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Right */}
              <div className="glass-soft p-4">
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

        {filtered.length === 0 && (
          <div className="glass p-4 text-sm opacity-80">
            No hay categorías con ese filtro.
          </div>
        )}
      </div>
    </main>
  );
}
