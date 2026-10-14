"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ImageUpload } from "../../store/ImageUpload";
import ProductDetailsFields from "../ProductDetailsFields";
import {
  EMPTY_PRODUCT_DETAILS,
  type ProductDetails,
} from "@/lib/product-details";
import { CategoryPicker, saveProductCategoryIds } from "../CategoryPicker";
import { requestImageIndex } from "@/lib/image-search/indexer";
import { checkProductCode, cleanProductCode } from "../product-code";
import { PricingPanel, loadDefaultMarkup, type Markups } from "../PricingPanel";

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
export default function CreateProductPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);

  // form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  // Sin costo ni unidades: llegan con el ingreso de factura, y ahí se calculan los precios con el %.
  const [markups, setMarkups] = useState<Markups>([15, 15, 15, 15, 15]);
  const [minWholesale, setMinWholesale] = useState(1);

  const [active, setActive] = useState(true);

  // Categorías donde aparece (la primera es la principal).
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails>({ ...EMPTY_PRODUCT_DETAILS });

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
      void loadDefaultMarkup(access.store.id).then((m) => setMarkups([m, m, m, m, m])).catch(() => {});

      const { data: cats, error: catsErr } = await sb
        .from("product_categories")
        .select("id,name")
        .eq("store_id", access.store.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (catsErr) throw catsErr;
      setCategories(cats ?? []);
    } catch (e: unknown) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e instanceof Error ? e.message : "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
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

      const sku = cleanProductCode(code);
      if (storeId) await checkProductCode(storeId, sku);
      const payload = {
        store_id: storeId,
        name: n,
        // Vacío: la base le pone su número interno como código.
        ...(sku ? { sku } : {}),
        description: description?.trim() ? description.trim() : "",
        cost_price: 0,
        price_1: 0, price_2: 0, price_3: 0, price_4: 0, price_5: 0,
        price_retail: 0,
        price_wholesale: 0,
        min_wholesale: Math.max(1, Number(minWholesale || 1)),
        stock: 0,
        active: !!active,
        image_url: imageUrl,
        category_id: categoryIds[0] ?? null,
      };

      const base = { ...payload, product_details: productDetails };
      const pct = Object.fromEntries(markups.map((m, i) => [`markup_${i + 1}`, m]));
      let { data, error } = await sb.from("products").insert({ ...base, ...pct }).select("id").single();
      // Si la base aún no tiene los porcentajes (migración 20261113), se crea igual sin ellos.
      if (error && /markup_/.test(error.message)) ({ data, error } = await sb.from("products").insert(base).select("id").single());
      if (error) throw error;
      requestImageIndex();
      const categoryWarning = data?.id && categoryIds.length > 1 ? await saveProductCategoryIds(String(data.id), categoryIds) : null;

      await Swal.fire({
        icon: categoryWarning ? "warning" : "success",
        title: "Producto creado",
        text: categoryWarning ?? "Tu producto y su página de catálogo están listos.",
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
    } catch (e: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo crear",
        text: e instanceof Error ? e.message : "Error",
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
                Código del producto (opcional)
              </label>
              <input
                {...inputProps("uppercase")}
                value={code}
                maxLength={40}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Vacío = se usa el número interno (1, 2, 3…)"
                style={{ ...inputProps().style }}
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

            {storeId ? <PricingPanel isNew storeId={storeId} productId={null} cost={0} costKnown prices={[0, 0, 0, 0, 0]} markups={markups} onChange={setMarkups} /> : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} disabled={saving} />

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

        <ProductDetailsFields
          details={productDetails}
          onChange={setProductDetails}
          userId={userId}
        />

      </div>
    </main>
  );
}
