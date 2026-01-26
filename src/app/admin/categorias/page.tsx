"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "@/app/dashboard/store/ImageUpload";

type StoreMini = { id: string; name: string; slug: string };

type Cat = {
  id: string;
  store_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
};

function toastError(title: string, text?: string) {
  return Swal.fire({
    icon: "error",
    title,
    text: text ?? "Ocurrió un error",
    background: "#0b0b16",
    color: "#fff",
    confirmButtonColor: "#a855f7",
  });
}

function toastOk(title: string) {
  return Swal.fire({
    icon: "success",
    title,
    timer: 900,
    showConfirmButton: false,
    background: "#0b0b16",
    color: "#fff",
  });
}

export default function AdminCategoriasPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState("");

  // -----------------------------
  // Filter
  // -----------------------------
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cats;
    return cats.filter((c) => (c.name ?? "").toLowerCase().includes(s));
  }, [cats, q]);

  // -----------------------------
  // Load Stores
  // -----------------------------
  async function loadStores() {
    const sb = supabaseBrowser();

    const { data, error } = await sb
      .from("stores")
      .select("id,name,slug")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const arr = (data as StoreMini[]) ?? [];
    setStores(arr);

    // auto select first store
    if (!storeId && arr[0]) setStoreId(arr[0].id);
  }

  // -----------------------------
  // Load Categories of a store
  // -----------------------------
  async function loadCats(sid: string) {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("product_categories")
        .select("id,store_id,name,image_url,sort_order,active,created_at")
        .eq("store_id", sid)
        .order("sort_order", { ascending: true });

      if (error) throw error;

      setCats((data as Cat[]) ?? []);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadStores();
      } catch (e: any) {
        await toastError("Error cargando tiendas", e?.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when store changes, load categories
  useEffect(() => {
    if (!storeId) return;
    (async () => {
      try {
        await loadCats(storeId);
      } catch (e: any) {
        await toastError("Error cargando categorías", e?.message);
      }
    })();
  }, [storeId]);

  // -----------------------------
  // Helpers
  // -----------------------------
  function patch(id: string, p: Partial<Cat>) {
    setCats((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  // -----------------------------
  // Save Category
  // -----------------------------
  async function save(c: Cat) {
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

      await toastOk("Guardado");
    } catch (e: any) {
      await toastError("No se pudo guardar", e?.message);
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------
  // Create Category
  // -----------------------------
  async function create() {
    if (!storeId) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { data, error } = await sb
        .from("product_categories")
        .insert({
          store_id: storeId,
          name: "Nueva categoría",
          sort_order: 0,
          active: true,
          image_url: null,
        })
        .select("id,store_id,name,image_url,sort_order,active,created_at")
        .single();

      if (error) throw error;

      setCats((prev) => [data as Cat, ...prev]);
      await toastOk("Categoría creada");
    } catch (e: any) {
      await toastError("No se pudo crear", e?.message);
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------
  // Remove Category
  // -----------------------------
  async function removeCat(c: Cat) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Eliminar categoría",
      text: `Se eliminará "${c.name}".`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#ef4444",
      background: "#0b0b16",
      color: "#fff",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb.from("product_categories").delete().eq("id", c.id);
      if (error) throw error;

      setCats((prev) => prev.filter((x) => x.id !== c.id));
      await toastOk("Eliminada");
    } catch (e: any) {
      await toastError("No se pudo eliminar", e?.message);
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass rounded-[28px] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold">Categorías</h2>
            <p className="text-sm opacity-80">
              Administra categorías por tienda: nombre, imagen, orden y estado.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="glass-soft ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={() => storeId && loadCats(storeId)}
              disabled={saving || !storeId}
            >
              Recargar
            </button>

            <button
              className="btn-gradient ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={create}
              disabled={saving || !storeId}
            >
              + Nueva categoría
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <label className="text-xs opacity-70">Tienda</label>
            <select
              className="ring-focus mt-1 w-full p-3"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs opacity-70">Buscar</label>
            <input
              className="ring-focus mt-1 w-full p-3"
              placeholder="Buscar categoría..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="glass rounded-[28px] p-6">
          <p className="opacity-80">Cargando...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-[28px] p-6">
          <p className="font-semibold">No hay categorías</p>
          <p className="text-sm opacity-80 mt-1">
            Crea una nueva categoría o cambia la tienda seleccionada.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => (
            <div key={c.id} className="glass rounded-[28px] p-5 md:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Left: Form */}
                <div className="lg:col-span-2 space-y-3">
                  <div>
                    <label className="text-xs opacity-70">Nombre</label>
                    <input
                      className="ring-focus mt-1 w-full p-3"
                      value={c.name}
                      onChange={(e) => patch(c.id, { name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label className="text-xs opacity-70">Orden</label>
                      <input
                        type="number"
                        className="ring-focus mt-1 w-full p-3"
                        value={c.sort_order}
                        onChange={(e) =>
                          patch(c.id, { sort_order: Number(e.target.value) })
                        }
                      />
                    </div>

                    <div className="md:col-span-2 flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={c.active}
                          onChange={(e) => patch(c.id, { active: e.target.checked })}
                        />
                        Activa (visible en el catálogo)
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      className="btn-gradient ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      onClick={() => save(c)}
                      disabled={saving}
                    >
                      Guardar cambios
                    </button>

                    <button
                      className="ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      style={{
                        background: "rgba(239, 68, 68, 0.14)",
                        border: "1px solid rgba(239, 68, 68, 0.28)",
                        color: "rgba(255,255,255,0.92)",
                      }}
                      onClick={() => removeCat(c)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>

                  <p className="text-xs opacity-70">
                    Tip: primero sube la imagen y luego presiona <b>Guardar cambios</b>.
                  </p>
                </div>

                {/* Right: Image */}
                <div className="glass-soft rounded-[22px] p-4">
                  <p className="font-semibold">Imagen de categoría</p>
                  <p className="text-sm opacity-80">
                    Esta imagen se muestra en el catálogo.
                  </p>

                  <div className="mt-3">
                    <ImageUpload
                      label="Subir imagen"
                      currentUrl={c.image_url}
                      pathPrefix={`admin/categories/${c.store_id}/`}
                      fileName={`${c.id}.png`}
                      bucket="store-assets"
                      onUploaded={(url) => patch(c.id, { image_url: url })}
                    />
                  </div>

                  <div className="mt-3 text-xs opacity-70">
                    Recomendado: imagen cuadrada (1:1) y liviana.
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
