"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AuditSpyButton } from "@/components/audit/AuditSpyButton";
import { PublishButton } from "@/components/products/PublishButton";
import { OfferPanel } from "../OfferPanel";
import { RichTextEditor } from "@/components/forms/RichTextEditor";
import { MobileActionBar } from "@/components/ui/MobileActionBar";
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
import { Skeleton } from "@/components/ui/Skeleton";
import { BadgeDollarSign, FileText, Images, ListChecks, Package, Store, Warehouse } from "lucide-react";
import { Field, ProductEditorLayout, ProductPreviewCard, inputCls, inputStyle, type EditorSection } from "../ProductEditorLayout";

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
  const [savedFlash, setSavedFlash] = useState(false);
  // Evita guardar dos veces con un doble toque (antes de que el botón alcance a deshabilitarse).
  const savingNow = useRef(false);
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
    if (!draft || !storeId || savingNow.current) return;
    savingNow.current = true;

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

      // Confirmación sin ventana: «Guardado ✓» en la barra de arriba.
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
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
      savingNow.current = false;
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

  if (loading || !draft) {
    return (
      <main className="space-y-3 px-3 py-3 sm:p-6" style={{ color: "var(--t-text)" }}>
        <Skeleton className="h-24 w-full rounded-[22px]" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[230px_1fr_300px]" role="status" aria-label="Cargando el producto…">
          <div className="hidden space-y-2 lg:block">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-2xl" />)}</div>
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
            <Skeleton className="h-12 w-1/2" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-2/3" /><Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="hidden aspect-[3/4] w-full rounded-[22px] lg:block" />
        </div>
      </main>
    );
  }

  const d = draft;
  const prices = [d.price_1, d.price_2, d.price_3, d.price_4, d.price_5].map((x) => clampNum(x, 0));
  const det = d.product_details;
  const mainCategory = categories.find((c) => c.id === categoryIds[0])?.name ?? null;
  const sections: EditorSection[] = [
    {
      key: "basic", label: "Lo básico", icon: <Package />, color: "#8b5cf6", hint: "Foto, nombre, códigos y dónde aparece. Solo el nombre es indispensable.",
      done: Boolean(d.name.trim()),
      content: (
        <>
          <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
            <div>
              <p className="mb-1.5 text-sm font-bold">📸 Foto principal</p>
            <div className="mx-auto max-w-[200px] sm:max-w-none">
              {userId ? (
                <ImageUpload compact label="Subir foto" currentUrl={d.image_url} pathPrefix={`${userId}/products/`} fileName={`${d.id}.png`} bucket="product-images"
                  onUploaded={(url) => setDraft({ ...d, image_url: url })} />
              ) : <Skeleton className="aspect-square w-full rounded-2xl" />}
              </div>
            <p className="mt-1 text-center text-[11px] sm:text-left" style={{ color: "var(--t-muted)" }}>Más fotos en «Fotos y videos».</p>
            </div>
            <div className="space-y-4">
              <Field label="Nombre" icon="🏷️" help="Así lo ven tus clientes y así lo buscas en el POS.">
                <input className={inputCls} style={inputStyle} value={d.name} maxLength={160} placeholder="Ej: Reloj inteligente Ultra 10 Pro" onChange={(e) => setDraft({ ...d, name: e.target.value })} />
              </Field>
              <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} disabled={saving} />
              <Field label="Descripción corta" icon="💬" help="Una o dos frases que salen debajo del nombre.">
                <RichTextEditor value={d.description ?? ""} onChange={(v) => setDraft({ ...d, description: v })} placeholder="Ej: Resistente al agua, batería de 7 días y más de 100 modos deportivos." minHeight={90} />
              </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código del producto" icon="🔖" help={<>{d.product_no ? <>N.º interno <b>#{d.product_no}</b> (no cambia). </> : null}Si lo dejas vacío se usa el número interno.</>}>
                <input className={`${inputCls} uppercase`} style={inputStyle} value={d.sku ?? ""} maxLength={40} placeholder={d.product_no ? String(d.product_no) : "Ej: OLL-01"}
                  onChange={(e) => { const el = e.target; const at = el.selectionStart; setDraft({ ...d, sku: el.value.toUpperCase() }); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }} />
              </Field>
              <Field label="Código de barras" icon="📊" help="El que trae el empaque. Escanéalo o escríbelo.">
                <input className={inputCls} style={inputStyle} value={d.barcode ?? ""} maxLength={60} inputMode="numeric" placeholder="Opcional" onChange={(e) => setDraft({ ...d, barcode: e.target.value })} />
              </Field>
              <details className="sm:col-span-2 text-[11px]" style={{ color: "var(--t-muted)" }}>
                <summary className="cursor-pointer font-semibold">Datos técnicos</summary>
                <p className="mt-1">ID del producto: <span className="font-mono">{d.id}</span></p>
              </details>
            </div>

            </div>
          </div>
        </>
      ),
    },
    {
      key: "prices", label: "Precios", icon: <BadgeDollarSign />, color: "#10b981", hint: "Cuánto ganas en cada lista de precio. Escribe el % o el precio directo.",
      done: prices.some((p) => p > 0) || Boolean(d.markups?.some((m) => m !== null)),
      content: (
        <>
          {pricesEditable ? (
            <PricingPanel part="pricing" storeId={storeId ?? ""} productId={d.id} cost={clampNum(d.cost_price, 0)} costKnown={costKnown}
              prices={prices} markups={d.markups ?? [null, null, null, null, null]} onChange={(m) => setDraft({ ...d, markups: m })} />
          ) : (
            <div className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {prices.map((v, i) => (
                  <div key={i} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
                    <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Precio {i + 1}</p>
                    <p className="font-black tabular-nums">{`$ ${Math.round(v).toLocaleString("es-CO")}`}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
                🔒 {canPrices ? "Para cambiar precios por % necesitas también el permiso «Ver costos y márgenes»." : "Los precios y el % de ganancia solo los cambia quien tiene «Cambiar precios»."}
              </p>
            </div>
          )}
          {storeId ? <OfferPanel storeId={storeId} productId={d.id} normalPrice={prices[2] || prices[0]} /> : null}
          <Field label="Desde cuántas unidades es precio mayorista" icon="📦" help="Si un cliente lleva esta cantidad o más, se le cobra el precio al por mayor.">
            <input className={`${inputCls} max-w-[10rem]`} style={inputStyle} inputMode="numeric" value={String(d.min_wholesale ?? 1)}
              onChange={(e) => setDraft({ ...d, min_wholesale: Math.max(1, digitsOnlyToNumber(e.target.value, 1)) })} />
          </Field>
        </>
      ),
    },
    {
      key: "stock", label: "Inventario", icon: <Warehouse />, color: "#0ea5e9", hint: "Costo y unidades en cada punto. Solo de consulta: cambian con facturas, ajustes y traslados.",
      done: true,
      content: <PricingPanel part="stock" storeId={storeId ?? ""} productId={d.id} cost={clampNum(d.cost_price, 0)} costKnown={costKnown} prices={prices} markups={d.markups ?? [null, null, null, null, null]} onChange={() => undefined} />,
    },
    {
      key: "media", label: "Fotos y videos", icon: <Images />, color: "#ec4899", hint: "Más fotos y un video ayudan a vender.", optional: true,
      done: det.gallery_urls.length > 0 || Boolean(det.video_url),
      content: <ProductDetailsFields bare parts={["media"]} details={det} onChange={(product_details) => setDraft({ ...d, product_details })} userId={userId} productId={d.id} />,
    },
    {
      key: "desc", label: "Descripción completa", icon: <FileText />, color: "#f59e0b", hint: "Para qué sirve, cómo se usa y por qué vale la pena. Sale en la ficha del catálogo.", optional: true,
      done: Boolean(det.long_description.trim()),
      content: <ProductDetailsFields bare parts={["long"]} details={det} onChange={(product_details) => setDraft({ ...d, product_details })} userId={userId} productId={d.id} />,
    },
    {
      key: "features", label: "Características", icon: <ListChecks />, color: "#6366f1", hint: "Lo que lo hace especial y sus datos técnicos (color, talla, material…).", optional: true,
      done: det.highlights.length > 0 || det.specifications.length > 0,
      content: <ProductDetailsFields bare parts={["highlights", "specs"]} details={det} onChange={(product_details) => setDraft({ ...d, product_details })} userId={userId} productId={d.id} />,
    },
    ...(storeId ? [{
      key: "catalogs", label: "Catálogos", icon: <Store />, color: "#14b8a6", hint: "En qué catálogos aparece y con qué precio.", optional: true, done: false,
      content: <ProductCatalogsPanel storeId={storeId} productId={d.id} prices={{ price_1: d.price_1, price_2: d.price_2, price_3: d.price_3, price_4: d.price_4, price_5: d.price_5 }} />,
    }] : []),
  ];

  const actionBtn = "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition hover:-translate-y-0.5";
  return (
    <>
      <ProductEditorLayout
        mode="edit"
        name={d.name}
        image={d.image_url}
        code={d.sku || (d.product_no ? String(d.product_no) : null)}
        active={!!d.active}
        onToggleActive={() => setDraft({ ...d, active: !d.active })}
        dirty={isDirty}
        saving={saving}
        savedFlash={savedFlash}
        onSave={() => void save()}
        onBack={() => void goBack()}
        actions={<>
          <PublishButton storeId={storeId} productId={d.id} productName={d.name} />
          <AuditSpyButton storeId={storeId} filters={{ entity_id: String(id) }} title="Auditoría de este producto" label="Historial" />
          <button type="button" className={actionBtn} style={{ borderColor: "var(--t-card-border)" }} onClick={() => window.open(`/documento/etiquetas?productos=${id}`, "_blank")} title="Etiqueta con código de barras y precio">🏷️ Etiqueta</button>
        </>}
        sections={sections}
        preview={<ProductPreviewCard name={d.name} image={d.image_url} price={prices[2] || prices[0]} active={!!d.active} highlights={det.highlights} category={mainCategory} />}
      />
      <MobileActionBar show={isDirty} hint="Tienes cambios sin guardar">
        <button type="button" className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: "var(--t-accent)" }} disabled={saving} onClick={() => void save()}>
          {saving ? "Guardando…" : "💾 Guardar cambios"}
        </button>
      </MobileActionBar>
    </>
  );
}
