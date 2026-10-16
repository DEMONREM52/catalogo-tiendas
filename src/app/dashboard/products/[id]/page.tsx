"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AuditSpyButton } from "@/components/audit/AuditSpyButton";
import Swal from "sweetalert2";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../../store/ImageUpload";
import { getDashboardStore } from "@/lib/store-utils";
import ProductDetailsFields from "../ProductDetailsFields";
import ProductCatalogsPanel from "../ProductCatalogsPanel";
import {
  normalizeProductDetails,
  type ProductDetails,
} from "@/lib/product-details";
import { CategoryPicker, loadProductCategoryIds, saveProductCategoryIds } from "../CategoryPicker";
import { requestImageIndex } from "@/lib/image-search/indexer";
import { checkProductCode, cleanProductCode, loadProductCodes } from "../product-code";
import { fetchProductCosts } from "@/lib/profit/costs";
import { PricingPanel, type Markups } from "../PricingPanel";
import { useCan } from "@/lib/permission-runtime";

type Category = { id: string; name: string };

type Product = {
  id: string;
  store_id: string;
  created_at: string;
  name: string;
  description: string | null;

  cost_price: number;
  price_1: number;
  price_2: number;
  price_3: number;
  price_4: number;
  price_5: number;
  price_retail: number;
  price_wholesale: number;
  min_wholesale: number;

  active: boolean;
  image_url: string | null;
  category_id: string | null;

  stock: number | null; // null = ilimitado
  product_details: ProductDetails;
  markups?: Markups;

  // Código editable (sku), código de barras y número interno fijo.
  sku?: string | null;
  barcode?: string | null;
  product_no?: number | null;
};


// ✅ Styles con tokens (auto claro/oscuro por sistema)
function inputSoftProps(extraClassName = "") {
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
      "rounded-xl border px-4 py-2 text-sm font-semibold backdrop-blur-xl transition disabled:opacity-60",
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
      "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
    style: {
      borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)",
      background: "color-mix(in oklab, var(--t-accent) 18%, transparent)",
      color: "var(--t-text)",
      boxShadow: "0 0 22px color-mix(in oklab, var(--t-accent) 14%, transparent)",
    } as React.CSSProperties,
  };
}
function btnToggleProps(active: boolean) {
  if (active) {
    return {
      className:
        "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
      style: {
        borderColor: "color-mix(in oklab, #10b981 40%, var(--t-card-border))",
        background: "color-mix(in oklab, #10b981 14%, transparent)",
        color: "var(--t-text)",
      } as React.CSSProperties,
    };
  }
  return {
    className:
      "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
    style: {
      borderColor: "var(--t-card-border)",
      background: "color-mix(in oklab, var(--t-card-bg) 85%, transparent)",
      color: "color-mix(in oklab, var(--t-text) 80%, transparent)",
    } as React.CSSProperties,
  };
}

function panelProps(extraClassName = "") {
  return {
    className: `rounded-[22px] border backdrop-blur-xl ${extraClassName}`,
    style: {
      borderColor: "var(--t-card-border)",
      background: "var(--t-card-bg)",
      boxShadow: "var(--t-shadow)",
    } as React.CSSProperties,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Si el costo no se pudo leer (sin permiso o sin conexión) no se muestra ni se guarda: así nunca se borra.
  const [costKnown, setCostKnown] = useState(true);
  // false si no se pudo leer el % de ganancia (sin «Ver costos» o sin la migración 20261113).
  const [markupsReady, setMarkupsReady] = useState(true);
  // Cambiar precios exige «Cambiar precios» (la base también lo valida).
  const canPrices = useCan("products_prices");
  const pricesEditable = markupsReady && canPrices;

  const [userId, setUserId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  // Todas las categorías del producto (la primera es la principal).
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [savedCategoryIds, setSavedCategoryIds] = useState<string[]>([]);

  const isDirty = useMemo(() => {
    if (!product || !draft) return false;
    return JSON.stringify(product) !== JSON.stringify(draft) || categoryIds.join(",") !== savedCategoryIds.join(",");
  }, [product, draft, categoryIds, savedCategoryIds]);

  async function loadAll() {
    if (!id || !isUuid(id)) {
      await Swal.fire({
        icon: "error",
        title: "ID inválido",
        text: `No se pudo leer el ID del producto: "${String(id)}"`,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
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
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
        router.push("/login");
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
        router.push("/dashboard/products");
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

      const baseCols = "id,store_id,created_at,name,description,price_1,price_2,price_3,price_4,price_5,price_retail,price_wholesale,min_wholesale,active,image_url,category_id,stock,product_details";
      const { data: p, error: pErr } = await sb.from("products").select(baseCols).eq("id", id).eq("store_id", access.store.id).maybeSingle();
      if (pErr) throw pErr;

      // El % de ganancia se pide aparte: con él y el precio se deduce el costo, así que solo lo ve quien tiene «Ver costos».
      let markupRow: Record<string, unknown> | null = null;
      const mk = await sb.rpc("erp_product_markups", { p_store: access.store.id, p_ids: [id] });
      if (!mk.error) {
        markupRow = ((mk.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
      } else if (/Could not find the function|schema cache/i.test(mk.error.message)) {
        // Aún sin la migración 20261123: lectura anterior (si la base la permite).
        const old = await sb.from("products").select("markup_1,markup_2,markup_3,markup_4,markup_5").eq("id", id).maybeSingle();
        if (!old.error) markupRow = (old.data ?? {}) as Record<string, unknown>;
      }
      setMarkupsReady(markupRow !== null);

      if (!p) {
        await Swal.fire({
          icon: "error",
          title: "No encontrado",
          text: "Ese producto no existe o no pertenece a tu tienda.",
          background: "var(--t-bg-base)",
          color: "var(--t-text)",
        });
        router.push("/dashboard/products");
        return;
      }

      // El costo se pide aparte: solo lo ve quien tiene permiso.
      const costs = await fetchProductCosts(access.store.id, [id]).catch(() => null);
      setCostKnown(Boolean(costs?.has(id)));
      const normalized: Product = {
        ...(p as any),
        cost_price: clampNum(costs?.get(id) ?? 0, 0),
        price_1: clampNum((p as any).price_1, 0),
        price_2: clampNum((p as any).price_2, 0),
        price_3: clampNum((p as any).price_3, 0),
        price_4: clampNum((p as any).price_4, 0),
        price_5: clampNum((p as any).price_5, 0),
        price_retail: clampNum((p as any).price_retail, 0),
        price_wholesale: clampNum((p as any).price_wholesale, 0),
        min_wholesale: Math.max(1, clampNum((p as any).min_wholesale, 1)),
        stock:
          (p as any).stock === null || (p as any).stock === undefined
            ? null
            : Math.max(0, Math.floor(clampNum((p as any).stock, 0))),
        product_details: normalizeProductDetails((p as any).product_details),
        markups: [1, 2, 3, 4, 5].map((l) => { const v = markupRow?.[`markup_${l}`]; return v === null || v === undefined ? null : Number(v); }) as Markups,
      };

      Object.assign(normalized, await loadProductCodes(normalized.id));
      setProduct(normalized);
      setDraft({ ...normalized });
      const ids = await loadProductCategoryIds(normalized.id, normalized.category_id, ((cats as Category[]) ?? []));
      setCategoryIds(ids);
      setSavedCategoryIds(ids);
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message ?? "Error cargando producto",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
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
        // El costo y las unidades NO se envían: solo cambian con ingreso de factura, ajustes o traslados.
        // Los precios tampoco: los calcula la base con el % de ganancia.
        ...(pricesEditable && draft.markups ? Object.fromEntries(draft.markups.map((m, i) => [`markup_${i + 1}`, m])) : {}),
        min_wholesale: Math.max(1, clampNum(draft.min_wholesale, 1)),
        active: !!draft.active,
        image_url: draft.image_url,
        category_id: categoryIds[0] ?? null,
        product_details: draft.product_details,
        sku: cleanProductCode(draft.sku),
        barcode: (draft.barcode ?? "").trim() || null,
      };
      await checkProductCode(storeId, payload.sku, draft.id);

      const { error } = await sb.from("products").update(payload).eq("id", draft.id).eq("store_id", storeId);
      if (error) throw error;
      // Si se borró el código, la base le vuelve a poner su número interno.
      const codes = await loadProductCodes(draft.id);
      requestImageIndex();

      const categoryWarning = await saveProductCategoryIds(draft.id, categoryIds);
      const savedDraft = { ...draft, ...codes, category_id: categoryIds[0] ?? null };
      setDraft(savedDraft);
      setProduct(savedDraft);
      setSavedCategoryIds(categoryIds);
      if (categoryWarning) {
        await Swal.fire({ icon: "warning", title: "Producto guardado", text: categoryWarning, background: "var(--t-bg-base)", color: "var(--t-text)" });
        return;
      }

      await Swal.fire({
        icon: "success",
        title: "Guardado",
        timer: 900,
        showConfirmButton: false,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "Error al guardar",
        text: e?.message ?? "Error",
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
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
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
    if (res.isConfirmed) router.push("/dashboard/products");
  }

  const headerPanel = panelProps("p-4 sm:p-6");
  const loadingPanel = panelProps("p-6");
  const leftPanel = panelProps("p-4 sm:p-6 space-y-3");
  const rightPanel = panelProps("p-4 sm:p-6");

  const softBtn = btnSoftProps();
  const primaryBtn = btnPrimaryProps();
  const toggleBtn = btnToggleProps(!!draft?.active);

  return (
    <main className="px-3 py-3 sm:p-6 space-y-3 panel-enter" style={{ color: "var(--t-text)" }}>
      {/* Header */}
      <div {...headerPanel}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">
              Editar producto {draft?.name ? `· ${draft.name}` : ""}
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--t-muted)" }}>
              {isDirty ? "Tienes cambios sin guardar." : "Sin cambios."}
            </p>
          </div>

          {/* ✅ Botonera arriba a la derecha (incluye Activo/Inactivo) */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {/* Historial del producto: quién lo creó, qué cambió (precios, %, datos) y cuándo. */}
            <AuditSpyButton storeId={storeId} filters={{ entity_id: String(id) }} title="Auditoría de este producto" label="Historial" />
            <button
              className={toggleBtn.className}
              style={toggleBtn.style}
              type="button"
              disabled={saving || loading || !draft}
              onClick={() => draft && setDraft({ ...draft, active: !draft.active })}
              title="Este cambio se guarda cuando presionas Guardar"
            >
              {draft?.active ? "Activo ✅" : "Inactivo ⛔"}
            </button>

            <button className={softBtn.className} style={softBtn.style} type="button" onClick={() => void goBack()}>
              Volver
            </button>

            <button
              className={primaryBtn.className}
              style={primaryBtn.style}
              type="button"
              disabled={saving || loading || !draft}
              onClick={() => void save()}
            >
              Guardar
            </button>

          </div>
        </div>
      </div>

      {/* Body */}
      {loading || !draft ? (
        <div {...loadingPanel} className={`${loadingPanel.className} text-sm`} style={loadingPanel.style}>
          <span style={{ color: "var(--t-muted)" }}>Cargando…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3">
          <div {...leftPanel}>
            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Nombre
              </label>
              <input
                className={`mt-1 ${inputSoftProps().className}`}
                style={inputSoftProps().style}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Código del producto
                </label>
                <input
                  className={`mt-1 ${inputSoftProps("uppercase").className}`}
                  style={inputSoftProps().style}
                  value={draft.sku ?? ""}
                  maxLength={40}
                  placeholder={draft.product_no ? String(draft.product_no) : "Ej: OLL-01"}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value.toUpperCase() })}
                />
                <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {draft.product_no ? <>N.º interno <b>#{draft.product_no}</b> (no cambia). </> : null}
                  Si lo dejas vacío se usa el número interno. Se puede buscar por código en todos los buscadores.
                </p>
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                  Código de barras
                </label>
                <input
                  className={`mt-1 ${inputSoftProps().className}`}
                  style={inputSoftProps().style}
                  value={draft.barcode ?? ""}
                  maxLength={60}
                  inputMode="numeric"
                  placeholder="Opcional"
                  onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Descripción
              </label>
              <textarea
                className={`mt-1 ${inputSoftProps("min-h-[120px]").className}`}
                style={inputSoftProps().style}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            {pricesEditable ? (
              <PricingPanel
                storeId={storeId ?? ""}
                productId={draft.id}
                cost={clampNum(draft.cost_price, 0)}
                costKnown={costKnown}
                prices={[draft.price_1, draft.price_2, draft.price_3, draft.price_4, draft.price_5].map((x) => clampNum(x, 0))}
                markups={draft.markups ?? [null, null, null, null, null]}
                onChange={(m) => setDraft({ ...draft, markups: m })}
              />
            ) : (
              <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="font-semibold">💲 Precios</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[draft.price_1, draft.price_2, draft.price_3, draft.price_4, draft.price_5].map((v, i) => (
                    <div key={i} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Precio {i + 1}</p>
                      <p className="font-black tabular-nums">{`$ ${Math.round(clampNum(v, 0)).toLocaleString("es-CO")}`}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                  🔒 {canPrices
                    ? "Para cambiar precios por % necesitas también el permiso «Ver costos y márgenes»."
                    : "Puedes editar el producto, pero los precios y el % de ganancia solo los cambia quien tiene «Cambiar precios»."}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs" style={{ color: "var(--t-muted)" }}>
                Mínimo para precio mayorista (unidades)
              </label>
              <input
                className={`mt-1 ${inputSoftProps().className}`}
                style={inputSoftProps().style}
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

            <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} disabled={saving} />

            <p className="text-xs pt-2" style={{ color: "color-mix(in oklab, var(--t-text) 60%, transparent)" }}>
              ID: <span style={{ color: "color-mix(in oklab, var(--t-text) 80%, transparent)" }}>{draft.id}</span>
            </p>
          </div>

          <div {...rightPanel}>
            <p className="font-semibold">Imagen principal</p>
            <p className="text-sm mt-1" style={{ color: "var(--t-muted)" }}>
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
                <div className="text-xs" style={{ color: "color-mix(in oklab, var(--t-text) 70%, transparent)" }}>
                  Cargando usuario…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && draft ? (
        <>
          <ProductDetailsFields
            details={draft.product_details}
            onChange={(product_details) => setDraft({ ...draft, product_details })}
            userId={userId}
            productId={draft.id}
          />
          {storeId ? (
            <div className="mt-4">
              <ProductCatalogsPanel
                storeId={storeId}
                productId={draft.id}
                prices={{ price_1: draft.price_1, price_2: draft.price_2, price_3: draft.price_3, price_4: draft.price_4, price_5: draft.price_5 }}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
