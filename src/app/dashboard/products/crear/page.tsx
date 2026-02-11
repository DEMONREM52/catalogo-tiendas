"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../../store/ImageUpload";

type Category = { id: string; name: string };

function clsWrap() {
  return "rounded-[24px] border border-white/10 bg-white/5 backdrop-blur-xl";
}
function clsInput() {
  return "w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm outline-none placeholder:text-white/40";
}
function clsBtnSoft() {
  return "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/10 disabled:opacity-60";
}
function clsBtnPrimary() {
  return "rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.15)] transition hover:bg-fuchsia-500/25 disabled:opacity-60";
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

export default function CreateProductPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);

  // form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [priceRetail, setPriceRetail] = useState(0);
  const [priceWholesale, setPriceWholesale] = useState(0);
  const [minWholesale, setMinWholesale] = useState(1);

  const [stockRaw, setStockRaw] = useState<string>(""); // "" => ilimitado
  const [active, setActive] = useState(true);

  const [categoryId, setCategoryId] = useState<string>("");

  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const computedStock = useMemo(() => clampIntOrNull(stockRaw), [stockRaw]);

  async function loadBase() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();

      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr) throw userErr;
      if (!userData.user) {
        await Swal.fire({ icon: "error", title: "Debes iniciar sesión", background: "#0b0b0b", color: "#fff" });
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
        await Swal.fire({ icon: "error", title: "No se encontró tu tienda", background: "#0b0b0b", color: "#fff" });
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
    } catch (e: any) {
      await Swal.fire({ icon: "error", title: "Error", text: e?.message ?? "Error", background: "#0b0b0b", color: "#fff" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createNow() {
    if (!storeId) return;

    const n = name.trim();
    if (!n) {
      await Swal.fire({ icon: "warning", title: "Falta el nombre", background: "#0b0b0b", color: "#fff" });
      return;
    }

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const payload = {
        store_id: storeId,
        name: n,
        description: description?.trim() ? description.trim() : "",
        price_retail: Math.max(0, Number(priceRetail || 0)),
        price_wholesale: Math.max(0, Number(priceWholesale || 0)),
        min_wholesale: Math.max(1, Number(minWholesale || 1)),
        stock: computedStock, // null si vacío
        active: !!active,
        image_url: imageUrl,
        category_id: categoryId || null,
      };

      const { data, error } = await sb
        .from("products")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Producto creado",
        text: "Ahora puedes editarlo o volver a la lista.",
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonText: "Ir a editar",
        showCancelButton: true,
        cancelButtonText: "Volver a lista",
      }).then((r) => {
        if (r.isConfirmed && data?.id) {
          window.location.href = `/dashboard/products/${data.id}`;
        } else {
          window.location.href = `/dashboard/products`;
        }
      });
    } catch (e: any) {
      await Swal.fire({ icon: "error", title: "No se pudo crear", text: e?.message ?? "Error", background: "#0b0b0b", color: "#fff" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="p-4 sm:p-6">
        <div className={`${clsWrap()} p-6 text-sm text-white/70`}>Cargando…</div>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Crear producto</h1>
          <p className="text-sm text-white/70">Fácil, rápido y bonito 🙂</p>
        </div>

        <Link className={clsBtnSoft()} href="/dashboard/products">
          ← Volver
        </Link>
      </div>

      <div className={`${clsWrap()} p-4 sm:p-6 space-y-4`}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* Left */}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-white/70">Nombre</label>
              <input className={clsInput()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Reloj inteligente Ultra 10 Pro" />
            </div>

            <div>
              <label className="text-xs text-white/70">Descripción</label>
              <textarea className={`${clsInput()} min-h-[110px]`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción corta para vender mejor..." />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/70">Precio detal</label>
                <input
                  className={clsInput()}
                  inputMode="numeric"
                  value={String(priceRetail)}
                  onChange={(e) => setPriceRetail(digitsOnlyToNumber(e.target.value, 0))}
                />
              </div>
              <div>
                <label className="text-xs text-white/70">Precio mayor</label>
                <input
                  className={clsInput()}
                  inputMode="numeric"
                  value={String(priceWholesale)}
                  onChange={(e) => setPriceWholesale(digitsOnlyToNumber(e.target.value, 0))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-white/70">Mínimo mayor</label>
                <input
                  className={clsInput()}
                  inputMode="numeric"
                  value={String(minWholesale)}
                  onChange={(e) => setMinWholesale(Math.max(1, digitsOnlyToNumber(e.target.value, 1)))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/70">Stock (vacío = ilimitado)</label>
                <input className={clsInput()} inputMode="numeric" value={stockRaw} onChange={(e) => setStockRaw(e.target.value.replace(/[^\d]/g, ""))} placeholder="Ej: 10" />
                <p className="mt-1 text-[11px] text-white/55">Actual: <b>{computedStock === null ? "Ilimitado" : computedStock}</b></p>
              </div>

              <div>
                <label className="text-xs text-white/70">Categoría</label>
                <select className={clsInput()} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <label className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                  <input type="checkbox" checked={active} onChange={() => setActive((v) => !v)} />
                  Producto activo
                </label>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <button className={clsBtnPrimary()} onClick={() => void createNow()} disabled={saving || !storeId}>
                Crear producto
              </button>
              <Link className={clsBtnSoft()} href="/dashboard/products">
                Cancelar
              </Link>
            </div>
          </div>

          {/* Right */}
          <div className={`${clsWrap()} p-4`}>
            <p className="font-semibold">Imagen</p>
            <p className="text-sm text-white/70">Opcional, pero ayuda a vender.</p>

            <div className="mt-3">
              {userId ? (
                <ImageUpload
                  label="Subir imagen"
                  currentUrl={imageUrl}
                  pathPrefix={`${userId}/products/`}
                  fileName={`new-${Date.now()}.png`}
                  bucket="product-images"
                  onUploaded={(url) => setImageUrl(url)}
                />
              ) : (
                <div className="text-sm text-white/60">Cargando usuario…</div>
              )}
            </div>

            <p className="mt-2 text-xs text-white/55">
              La imagen se guarda cuando presionas <b>Crear producto</b>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
