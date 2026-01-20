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

export default function AdminCategoriasPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stores, setStores] = useState<StoreMini[]>([]);
  const [storeId, setStoreId] = useState<string>("");

  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cats;
    return cats.filter((c) => (c.name ?? "").toLowerCase().includes(s));
  }, [cats, q]);

  // -----------------------------
  // Cargar tiendas
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

    // Si no hay tienda seleccionada, ponemos la primera
    if (!storeId && arr[0]) setStoreId(arr[0].id);
  }

  // -----------------------------
  // Cargar categorías de una tienda
  // -----------------------------
  async function loadCats(sid: string) {
    setLoading(true);

    const sb = supabaseBrowser();

    const { data, error } = await sb
      .from("product_categories")
      .select("id,store_id,name,image_url,sort_order,active,created_at")
      .eq("store_id", sid)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    setCats((data as Cat[]) ?? []);
    setLoading(false);
  }

  // -----------------------------
  // Inicial: cargar tiendas
  // -----------------------------
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
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // Cuando cambia la tienda: cargar categorías
  // -----------------------------
  useEffect(() => {
    if (!storeId) return;

    (async () => {
      try {
        await loadCats(storeId);
      } catch (e: any) {
        await Swal.fire({
          icon: "error",
          title: "Error",
          text: e?.message ?? "Error cargando categorías",
          background: "#0b0b0b",
          color: "#fff",
        });
        setLoading(false);
      }
    })();
  }, [storeId]);

  // -----------------------------
  // Helpers UI
  // -----------------------------
  function patch(id: string, p: Partial<Cat>) {
    setCats((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  // -----------------------------
  // Guardar categoría
  // -----------------------------
  async function save(c: Cat) {
    setSaving(true);

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

    setSaving(false);

    if (error) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
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

  // -----------------------------
  // Crear categoría
  // -----------------------------
  async function create() {
    if (!storeId) return;

    setSaving(true);

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

    setCats((prev) => [data as Cat, ...prev]);
  }

  // -----------------------------
  // Eliminar categoría
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
      background: "#0b0b0b",
      color: "#fff",
    });

    if (!res.isConfirmed) return;

    setSaving(true);

    const sb = supabaseBrowser();

    const { error } = await sb
      .from("product_categories")
      .delete()
      .eq("id", c.id);

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

    setCats((prev) => prev.filter((x) => x.id !== c.id));
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Categorías</h2>
          <p className="text-sm opacity-80">CRUD por tienda + imagen y orden.</p>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-xl border border-white/10 px-4 py-2"
            onClick={() => storeId && loadCats(storeId)}
            disabled={saving}
          >
            Recargar
          </button>

          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-semibold"
            onClick={create}
            disabled={saving || !storeId}
          >
            + Nueva
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

        <input
          className="rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
          placeholder="Buscar categoría..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="mt-4">Cargando...</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/10 p-6 text-sm opacity-80">
              No hay categorías para mostrar.
            </div>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="rounded-2xl border border-white/10 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs opacity-70">Nombre</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                      value={c.name}
                      onChange={(e) => patch(c.id, { name: e.target.value })}
                    />

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs opacity-70">Orden</label>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 outline-none"
                          value={c.sort_order}
                          onChange={(e) =>
                            patch(c.id, {
                              sort_order: Number(e.target.value),
                            })
                          }
                        />
                      </div>

                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={c.active}
                            onChange={(e) =>
                              patch(c.id, { active: e.target.checked })
                            }
                          />
                          Activa
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:opacity-60"
                        onClick={() => save(c)}
                        disabled={saving}
                      >
                        Guardar
                      </button>

                      <button
                        className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-200 disabled:opacity-60"
                        onClick={() => removeCat(c)}
                        disabled={saving}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 p-4">
                    <p className="font-semibold">Imagen de categoría</p>
                    <p className="text-sm opacity-80">Se verá en el catálogo.</p>

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

                    <p className="mt-2 text-xs opacity-70">
                      Luego presiona <b>Guardar</b>.
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
