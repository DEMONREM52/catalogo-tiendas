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

/* =========================================================
   Theme tokens (auto light/dark)
========================================================= */
function swalTheme() {
  return {
    background: "var(--ap-bg-base)",
    color: "var(--ap-text)",
    confirmButtonColor: "var(--ap-cta)",
  } as const;
}

function toastError(title: string, text?: string) {
  return Swal.fire({
    icon: "error",
    title,
    text: text ?? "Ocurrió un error",
    ...swalTheme(),
  });
}

function toastOk(title: string) {
  return Swal.fire({
    icon: "success",
    title,
    timer: 900,
    showConfirmButton: false,
    ...swalTheme(),
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
      confirmButtonColor: "var(--ap-danger)",
      background: "var(--ap-bg-base)",
      color: "var(--ap-text)",
    });

    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const { error } = await sb
        .from("product_categories")
        .delete()
        .eq("id", c.id);

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
    <div className="space-y-4 text-[color:var(--ap-text)]">
      {/* Theme tokens + small helpers (local, no rompe tu app) */}
      <style jsx global>{`
        :root {
          --ap-text: rgba(255, 255, 255, 0.92);
          --ap-muted: rgba(255, 255, 255, 0.7);
          --ap-border: rgba(255, 255, 255, 0.12);
          --ap-card: rgba(255, 255, 255, 0.06);
          --ap-card-2: rgba(255, 255, 255, 0.045);
          --ap-bg-base: #0b0b16;

          --ap-cta: #a855f7;
          --ap-danger: #ef4444;
        }

        @media (prefers-color-scheme: light) {
          :root {
            --ap-text: rgba(17, 24, 39, 0.92);
            --ap-muted: rgba(17, 24, 39, 0.65);
            --ap-border: rgba(17, 24, 39, 0.14);
            --ap-card: rgba(255, 255, 255, 0.82);
            --ap-card-2: rgba(255, 255, 255, 0.72);
            --ap-bg-base: #f7f7fb;

            --ap-cta: #7c3aed;
            --ap-danger: #dc2626;
          }
        }

        /* Fallbacks si tus clases glass ya existen, igual se verán bien */
        .ap-card {
          border: 1px solid var(--ap-border);
          background: var(--ap-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .ap-card-soft {
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .ap-input {
          width: 100%;
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          color: var(--ap-text);
          border-radius: 16px;
          outline: none;
        }
        .ap-input::placeholder {
          color: color-mix(in oklab, var(--ap-text) 35%, transparent);
        }

        .ap-btn-ghost {
          border: 1px solid var(--ap-border);
          background: var(--ap-card-2);
          color: var(--ap-text);
        }

        .ap-btn-primary {
          border: 1px solid color-mix(in oklab, var(--ap-cta) 35%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-cta) 18%, transparent);
          color: var(--ap-text);
          box-shadow: 0 0 22px color-mix(in oklab, var(--ap-cta) 16%, transparent);
        }

        .ap-btn-danger {
          border: 1px solid color-mix(in oklab, var(--ap-danger) 30%, var(--ap-border));
          background: color-mix(in oklab, var(--ap-danger) 12%, transparent);
          color: color-mix(in oklab, var(--ap-text) 70%, var(--ap-danger));
        }
      `}</style>

      {/* Header */}
      <div className="ap-card rounded-[28px] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold md:text-2xl">Categorías</h2>
            <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
              Administra categorías por tienda: nombre, imagen, orden y estado.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="ap-btn-ghost ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={() => storeId && loadCats(storeId)}
              disabled={saving || !storeId}
            >
              Recargar
            </button>

            <button
              className="ap-btn-primary ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
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
            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
              Tienda
            </label>
            <select
              className="ap-input ring-focus mt-1 p-3"
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
            <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
              Buscar
            </label>
            <input
              className="ap-input ring-focus mt-1 p-3"
              placeholder="Buscar categoría..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="ap-card rounded-[28px] p-6">
          <p style={{ color: "var(--ap-muted)" }}>Cargando...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="ap-card rounded-[28px] p-6">
          <p className="font-semibold">No hay categorías</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
            Crea una nueva categoría o cambia la tienda seleccionada.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => (
            <div key={c.id} className="ap-card rounded-[28px] p-5 md:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Left: Form */}
                <div className="space-y-3 lg:col-span-2">
                  <div>
                    <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                      Nombre
                    </label>
                    <input
                      className="ap-input ring-focus mt-1 p-3"
                      value={c.name}
                      onChange={(e) => patch(c.id, { name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label className="text-xs" style={{ color: "var(--ap-muted)" }}>
                        Orden
                      </label>
                      <input
                        type="number"
                        className="ap-input ring-focus mt-1 p-3"
                        value={c.sort_order}
                        onChange={(e) => patch(c.id, { sort_order: Number(e.target.value) })}
                      />
                    </div>

                    <div className="flex items-end md:col-span-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={c.active}
                          onChange={(e) => patch(c.id, { active: e.target.checked })}
                        />
                        <span style={{ color: "var(--ap-text)" }}>
                          Activa{" "}
                          <span style={{ color: "var(--ap-muted)" }}>(visible en el catálogo)</span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      className="ap-btn-primary ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      onClick={() => save(c)}
                      disabled={saving}
                    >
                      Guardar cambios
                    </button>

                    <button
                      className="ap-btn-danger ring-focus rounded-2xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      onClick={() => removeCat(c)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>

                  <p className="text-xs" style={{ color: "var(--ap-muted)" }}>
                    Tip: primero sube la imagen y luego presiona <b>Guardar cambios</b>.
                  </p>
                </div>

                {/* Right: Image */}
                <div className="ap-card-soft rounded-[22px] p-4">
                  <p className="font-semibold">Imagen de categoría</p>
                  <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
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

                  <div className="mt-3 text-xs" style={{ color: "var(--ap-muted)" }}>
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
