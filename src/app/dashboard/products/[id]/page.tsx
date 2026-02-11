"use client";

import React, { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../../store/ImageUpload";

type Category = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  created_at: string;
  name: string;
  description: string | null;

  price_retail: number;
  price_wholesale: number;
  min_wholesale: number;

  active: boolean;
  image_url: string | null;
  category_id: string | null;

  stock: number | null; // null = ilimitado
};

function clsInputSoft() {
  return "w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm outline-none placeholder:text-white/40";
}
function clsBtnSoft() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60";
}
function clsBtnPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 disabled:opacity-60";
}
function clsBtnDanger() {
  return "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60";
}
function clsBtnToggle(active: boolean) {
  return active
    ? "rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-60"
    : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-60";
}

function clampNum(raw: any, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}
function clampIntOrNull(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();

  const raw = (params?.id ?? "") as string | string[];
  const id = Array.isArray(raw) ? raw[0] : raw;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);

  const isDirty = useMemo(() => {
    if (!product || !draft) return false;
    return JSON.stringify(product) !== JSON.stringify(draft);
  }, [product, draft]);

  async function loadAll() {
    if (!id || !isUuid(id)) {
      await Swal.fire({
        icon: "error",
        title: "ID inválido",
        text: `No se pudo leer el ID del producto: "${String(id)}"`,
        background: "#0b0b0b",
        color: "#fff",
      });
      router.push("/dashboard/products");
      return;
    }

    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        await Swal.fire({
          icon: "error",
          title: "Debes iniciar sesión",
          background: "#0b0b0b",
          color: "#fff",
        });
        router.push("/login");
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
        await Swal.fire({
          icon: "error",
          title: "No se encontró tu tienda",
          background: "#0b0b0b",
          color: "#fff",
        });
        router.push("/dashboard/products");
        return;
      }
      setStoreId(storeData.id);

      const { data: cats, error: catsErr } = await sb
        .from("product_categories")
        .select("id,name")
        .eq("store_id", storeData.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (catsErr) throw catsErr;
      setCategories((cats as any[]) ?? []);

      const { data: p, error: pErr } = await sb
        .from("products")
        .select(
          "id,store_id,created_at,name,description,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock"
        )
        .eq("id", id)
        .eq("store_id", storeData.id)
        .maybeSingle();

      if (pErr) throw pErr;

      if (!p) {
        await Swal.fire({
          icon: "error",
          title: "No encontrado",
          text: "Ese producto no existe o no pertenece a tu tienda.",
          background: "#0b0b0b",
          color: "#fff",
        });
        router.push("/dashboard/products");
        return;
      }

      const normalized: Product = {
        ...(p as any),
        price_retail: clampNum((p as any).price_retail, 0),
        price_wholesale: clampNum((p as any).price_wholesale, 0),
        min_wholesale: Math.max(1, clampNum((p as any).min_wholesale, 1)),
        stock:
          (p as any).stock === null || (p as any).stock === undefined
            ? null
            : Math.max(0, Math.floor(clampNum((p as any).stock, 0))),
      };

      setProduct(normalized);
      setDraft({ ...normalized });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message ?? "Error cargando producto",
        background: "#0b0b0b",
        color: "#fff",
      });
      router.push("/dashboard/products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!draft || !storeId) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const payload = {
        name: draft.name,
        description: draft.description,
        price_retail: clampNum(draft.price_retail, 0),
        price_wholesale: clampNum(draft.price_wholesale, 0),
        min_wholesale: Math.max(1, clampNum(draft.min_wholesale, 1)),
        stock: draft.stock === null ? null : Math.max(0, Math.floor(clampNum(draft.stock, 0))),
        active: !!draft.active,
        image_url: draft.image_url,
        category_id: draft.category_id || null,
      };

      const { error } = await sb
        .from("products")
        .update(payload)
        .eq("id", draft.id)
        .eq("store_id", storeId);

      if (error) throw error;

      setProduct({ ...draft });

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
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || !storeId) return;

    const res = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar producto?",
      text: `Se eliminará "${draft.name}"`,
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonText: "Cancelar",
      confirmButtonText: "Sí, eliminar",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (!res.isConfirmed) return;

    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb
        .from("products")
        .delete()
        .eq("id", draft.id)
        .eq("store_id", storeId);

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Eliminado",
        timer: 850,
        showConfirmButton: false,
        background: "#0b0b0b",
        color: "#fff",
      });

      router.push("/dashboard/products");
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error eliminando",
        text: e?.message ?? "Error",
        background: "#0b0b0b",
        color: "#fff",
      });
    } finally {
      setSaving(false);
    }
  }

  async function goBack() {
    if (!isDirty) {
      router.push("/dashboard/products");
      return;
    }
    const res = await Swal.fire({
      icon: "warning",
      title: "Tienes cambios sin guardar",
      text: "¿Quieres salir sin guardar?",
      showCancelButton: true,
      confirmButtonText: "Salir",
      cancelButtonText: "Seguir editando",
      confirmButtonColor: "#ef4444",
      background: "#0b0b0b",
      color: "#fff",
    });
    if (res.isConfirmed) router.push("/dashboard/products");
  }

  return (
    <main className="px-3 py-3 sm:p-6 space-y-3 panel-enter">
      {/* Header */}
      <div className="rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">
              Editar producto {draft?.name ? `· ${draft.name}` : ""}
            </h1>
            <p className="text-sm text-white/70 mt-1">
              {isDirty ? "Tienes cambios sin guardar." : "Sin cambios."}
            </p>
          </div>

          {/* ✅ Botonera arriba a la derecha (incluye Activo/Inactivo) */}
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              className={clsBtnToggle(!!draft?.active)}
              type="button"
              disabled={saving || loading || !draft}
              onClick={() => draft && setDraft({ ...draft, active: !draft.active })}
              title="Este cambio se guarda cuando presionas Guardar"
            >
              {draft?.active ? "Activo ✅" : "Inactivo ⛔"}
            </button>

            <button className={clsBtnSoft()} type="button" onClick={() => void goBack()}>
              Volver
            </button>

            <button
              className={clsBtnPrimary()}
              type="button"
              disabled={saving || loading || !draft}
              onClick={() => void save()}
            >
              Guardar
            </button>

            <button
              className={clsBtnDanger()}
              type="button"
              disabled={saving || loading || !draft}
              onClick={() => void remove()}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {loading || !draft ? (
        <div className="rounded-[22px] border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          Cargando…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3">
          <div className="rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl p-4 sm:p-6 space-y-3">
            <div>
              <label className="text-xs text-white/70">Nombre</label>
              <input
                className={`mt-1 ${clsInputSoft()}`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs text-white/70">Descripción</label>
              <textarea
                className="mt-1 w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm outline-none min-h-[120px]"
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-white/70">Precio Detal</label>
                <input
                  className={`mt-1 ${clsInputSoft()}`}
                  type="text"
                  inputMode="numeric"
                  value={String(draft.price_retail ?? 0)}
                  onChange={(e) =>
                    setDraft({ ...draft, price_retail: digitsOnlyToNumber(e.target.value, 0) })
                  }
                />
              </div>

              <div>
                <label className="text-xs text-white/70">Precio Mayor</label>
                <input
                  className={`mt-1 ${clsInputSoft()}`}
                  type="text"
                  inputMode="numeric"
                  value={String(draft.price_wholesale ?? 0)}
                  onChange={(e) =>
                    setDraft({ ...draft, price_wholesale: digitsOnlyToNumber(e.target.value, 0) })
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-white/70">Mínimo Mayor</label>
                <input
                  className={`mt-1 ${clsInputSoft()}`}
                  type="text"
                  inputMode="numeric"
                  value={String(draft.min_wholesale ?? 1)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)),
                    })
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-white/70">Stock (vacío = ilimitado)</label>
                <input
                  className={`mt-1 ${clsInputSoft()}`}
                  type="text"
                  inputMode="numeric"
                  value={draft.stock ?? ""}
                  placeholder="Vacío = ilimitado"
                  onChange={(e) => setDraft({ ...draft, stock: clampIntOrNull(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className={clsBtnSoft()}
                type="button"
                onClick={() => setDraft({ ...draft, stock: null })}
              >
                Stock ilimitado
              </button>

              <button
                className={clsBtnSoft()}
                type="button"
                onClick={() => setDraft({ ...draft, stock: 0 })}
              >
                Agotado (0)
              </button>
            </div>

            <div>
              <label className="text-xs text-white/70">Categoría</label>
              <select
                className={`mt-1 ${clsInputSoft()}`}
                value={draft.category_id ?? ""}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-white/50 pt-2">
              ID: <span className="text-white/70">{draft.id}</span>
            </p>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/5 backdrop-blur-xl p-4 sm:p-6">
            <p className="font-semibold">Imagen principal</p>
            <p className="text-sm text-white/70 mt-1">
              Se guarda cuando presionas Guardar.
            </p>

            <div className="mt-3">
              {userId ? (
                <ImageUpload
                  label="Subir imagen"
                  currentUrl={draft.image_url}
                  pathPrefix={`${userId}/products/`}
                  fileName={`${draft.id}.png`}
                  bucket="product-images"
                  onUploaded={(url) => setDraft({ ...draft, image_url: url })}
                />
              ) : (
                <div className="text-xs text-white/60">Cargando usuario…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
