"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ImageUpload } from "../../store/ImageUpload";

type Category = { id: string; name: string };

// ✅ Helpers de estilo (tokens CSS → auto claro/oscuro por sistema)
function wrapProps() {
  return {
    className: "rounded-[24px] border backdrop-blur-xl",
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      boxShadow: "var(--t-shadow)",
    } as React.CSSProperties,
  };
}

function inputProps(extraClassName = "") {
  return {
    className: `w-full rounded-2xl border p-3 text-sm outline-none ${extraClassName}`,
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)",
      color: "var(--t-text)",
    } as React.CSSProperties,
  };
}

function btnSoftProps() {
  return {
    className:
      "rounded-2xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition disabled:opacity-60",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 90%, transparent)",
    } as React.CSSProperties,
  };
}

function btnPrimaryProps() {
  return {
    className:
      "rounded-2xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
    style: {
      borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)",
      background: "color-mix(in oklab, var(--t-accent) 18%, transparent)",
      color: "var(--t-text)",
      boxShadow: "0 0 22px color-mix(in oklab, var(--t-accent) 14%, transparent)",
    } as React.CSSProperties,
  };
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

  const [price1, setPrice1] = useState(0);
  const [price2, setPrice2] = useState(0);
  const [price3, setPrice3] = useState(0);
  const [price4, setPrice4] = useState(0);
  const [price5, setPrice5] = useState(0);
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
        await Swal.fire({
          icon: "error",
          title: "Debes iniciar sesión",
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
        return;
      }
      setUserId(userData.user.id);

      const access = await getDashboardStore();
      if (!access.store) {
        await Swal.fire({
          icon: "error",
          title: "No se encontró tu tienda",
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
        return;
      }
      setStoreId(access.store.id);

      const { data: cats, error: catsErr } = await sb
        .from("product_categories")
        .select("id,name")
        .eq("store_id", access.store.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (catsErr) throw catsErr;
      setCategories((cats as any[]) ?? []);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message ?? "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
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
      await Swal.fire({
        icon: "warning",
        title: "Falta el nombre",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }

    setSaving(true);
    try {
      const sb = supabaseBrowser();

      const payload = {
        store_id: storeId,
        name: n,
        description: description?.trim() ? description.trim() : "",
        price_1: Math.max(0, Number(price1 || 0)),
        price_2: Math.max(0, Number(price2 || 0)),
        price_3: Math.max(0, Number(price3 || 0)),
        price_4: Math.max(0, Number(price4 || 0)),
        price_5: Math.max(0, Number(price5 || 0)),
        price_retail: Math.max(0, Number(price3 || 0)),
        price_wholesale: Math.max(0, Number(price2 || 0)),
        min_wholesale: Math.max(1, Number(minWholesale || 1)),
        stock: computedStock, // null si vacío
        active: !!active,
        image_url: imageUrl,
        category_id: categoryId || null,
      };

      const { data, error } = await sb.from("products").insert(payload).select("id").single();
      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Producto creado",
        text: "Ahora puedes editarlo o volver a la lista.",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
        confirmButtonText: "Ir a editar",
        showCancelButton: true,
        cancelButtonText: "Volver a lista",
        confirmButtonColor: "var(--t-accent)",
      }).then((r) => {
        if (r.isConfirmed && data?.id) {
          window.location.href = `/dashboard/products/${data.id}`;
        } else {
          window.location.href = `/dashboard/products`;
        }
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e?.message ?? "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    const w = wrapProps();
    return (
      <main className="p-4 sm:p-6" style={{ color: "var(--t-text)" }}>
        <div {...w} className={`${w.className} p-6 text-sm`} style={w.style}>
          <span style={{ color: "var(--t-muted)" }}>Cargando…</span>
        </div>
      </main>
    );
  }

  const wMain = wrapProps();
  const wRight = wrapProps();
  const wCard = wrapProps();

  const soft = btnSoftProps();
  const primary = btnPrimaryProps();

  return (
    <main className="p-4 sm:p-6 space-y-4" style={{ color: "var(--t-text)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Crear producto</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            Fácil, rápido y bonito 🙂
          </p>
        </div>

        <Link {...soft} href="/dashboard/products" className={soft.className} style={soft.style}>
          ← Volver
        </Link>
      </div>

      <div {...wMain} className={`${wMain.className} p-4 sm:p-6 space-y-4`} style={wMain.style}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* Left */}
          <div className="space-y-4">
            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Nombre
              </label>
              <input
                {...inputProps()}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Reloj inteligente Ultra 10 Pro"
                style={{
                  ...inputProps().style,
                }}
              />
            </div>

            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Descripción
              </label>
              <textarea
                {...inputProps("min-h-[110px]")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción corta para vender mejor..."
                style={{
                  ...inputProps().style,
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Precio 1 (mínimo)
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(price1)}
                  onChange={(e) => setPrice1(digitsOnlyToNumber(e.target.value, 0))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Precio 2 (mayor predeterminado)
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(price2)}
                  onChange={(e) => setPrice2(digitsOnlyToNumber(e.target.value, 0))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Precio 3 (detal predeterminado)
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(price3)}
                  onChange={(e) => setPrice3(digitsOnlyToNumber(e.target.value, 0))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Precio 4
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(price4)}
                  onChange={(e) => setPrice4(digitsOnlyToNumber(e.target.value, 0))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Precio 5
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(price5)}
                  onChange={(e) => setPrice5(digitsOnlyToNumber(e.target.value, 0))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Mínimo mayor
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={String(minWholesale)}
                  onChange={(e) => setMinWholesale(Math.max(1, digitsOnlyToNumber(e.target.value, 1)))}
                  style={{
                    ...inputProps().style,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Stock (vacío = ilimitado)
                </label>
                <input
                  {...inputProps()}
                  inputMode="numeric"
                  value={stockRaw}
                  onChange={(e) => setStockRaw(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Ej: 10"
                  style={{
                    ...inputProps().style,
                  }}
                />
                <p className="mt-1 text-[11px]" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
                  Actual: <b>{computedStock === null ? "Ilimitado" : computedStock}</b>
                </p>
              </div>

              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Categoría
                </label>
                <select
                  {...inputProps()}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  style={{
                    ...inputProps().style,
                  }}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <label
                  className="mt-3 flex items-center gap-2 rounded-2xl border p-3 text-sm"
                  style={{
                    borderColor: "var(--t-card-border)",
                    background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
                    color: "var(--t-text)",
                  }}
                >
                  <input type="checkbox" checked={active} onChange={() => setActive((v) => !v)} />
                  Producto activo
                </label>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <button
                {...primary}
                onClick={() => void createNow()}
                disabled={saving || !storeId}
                className={primary.className}
                style={primary.style}
              >
                Crear producto
              </button>
              <Link {...soft} href="/dashboard/products" className={soft.className} style={soft.style}>
                Cancelar
              </Link>
            </div>
          </div>

          {/* Right */}
          <div {...wRight} className={`${wRight.className} p-4`} style={wRight.style}>
            <p className="font-semibold">Imagen</p>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>
              Opcional, pero ayuda a vender.
            </p>

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
                <div className="text-sm" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
                  Cargando usuario…
                </div>
              )}
            </div>

            <p className="mt-2 text-xs" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
              La imagen se guarda cuando presionas <b>Crear producto</b>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
