"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileActionBar } from "@/components/ui/MobileActionBar";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ImageUpload } from "../../store/ImageUpload";
import ProductDetailsFields from "../ProductDetailsFields";
import { RichTextEditor } from "@/components/forms/RichTextEditor";
import {
  EMPTY_PRODUCT_DETAILS,
  type ProductDetails,
} from "@/lib/product-details";
import { CategoryPicker, saveProductCategoryIds } from "../CategoryPicker";
import { requestImageIndex } from "@/lib/image-search/indexer";
import { checkProductCode, cleanProductCode } from "../product-code";
import { PricingPanel, loadDefaultMarkup, type Markups } from "../PricingPanel";
import { useCan } from "@/lib/permission-runtime";
import { Skeleton } from "@/components/ui/Skeleton";
import { BadgeDollarSign, FileText, Images, ListChecks, Package, ScanBarcode } from "lucide-react";
import { Field, ProductEditorLayout, ProductPreviewCard, inputCls, inputStyle, type EditorSection } from "../ProductEditorLayout";

type Category = { id: string; name: string };

function digitsOnlyToNumber(raw: string, fallback = 0) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return fallback;
  const n = Number(digits);
  return Number.isFinite(n) ? n : fallback;
}
export default function CreateProductPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Evita crear el producto dos veces con un doble toque.
  const creatingNow = useRef(false);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);

  // form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  // Sin costo ni unidades: llegan con el ingreso de factura, y ahí se calculan los precios con el %.
  const [markups, setMarkups] = useState<Markups>([15, 15, 15, 15, 15]);
  // Sin «Cambiar precios» el producto se crea con el % predeterminado de la tienda (la base lo asegura).
  const canPrices = useCan("products_prices");
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
    if (!storeId || creatingNow.current) return;
    creatingNow.current = true;
    try {
      await createProduct();
    } finally {
      creatingNow.current = false;
    }
  }

  async function createProduct() {
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
      if (error && /markup_|permission denied/i.test(error.message)) ({ data, error } = await sb.from("products").insert(base).select("id").single());
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
    return (
      <main className="space-y-3 px-3 py-3 sm:p-6" style={{ color: "var(--t-text)" }}>
        <Skeleton className="h-24 w-full rounded-[22px]" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[230px_1fr_300px]" role="status" aria-label="Cargando…">
          <div className="hidden space-y-2 lg:block">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-2xl" />)}</div>
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)" }}>
            <Skeleton className="h-12 w-1/2" /><Skeleton className="h-11 w-full" /><Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="hidden aspect-[3/4] w-full rounded-[22px] lg:block" />
        </div>
      </main>
    );
  }

  const mainCategory = categories.find((c) => c.id === categoryIds[0])?.name ?? null;
  const sections: EditorSection[] = [
    {
      key: "basic", label: "Lo básico", icon: <Package />, color: "#8b5cf6", hint: "Solo el nombre es obligatorio. Lo demás lo puedes completar ahora o después.",
      done: Boolean(name.trim()),
      content: (
        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div>
            <p className="mb-1.5 text-sm font-bold">📸 Foto principal</p>
            <div className="mx-auto max-w-[200px] sm:max-w-none">
            {userId ? (
              <ImageUpload label="Subir foto" currentUrl={imageUrl} pathPrefix={`${userId}/products/`} fileName={`new-${Date.now()}.png`} bucket="product-images" onUploaded={(url) => setImageUrl(url)} />
            ) : <Skeleton className="aspect-square w-full rounded-2xl" />}
            </div>
            <p className="mt-1 text-center text-[11px] sm:text-left" style={{ color: "var(--t-muted)" }}>Opcional, pero ayuda a vender.</p>
          </div>
          <div className="space-y-4">
            <Field label="Nombre" icon="🏷️" help="Así lo ven tus clientes y así lo buscas en el POS.">
              <input autoFocus className={inputCls} style={inputStyle} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Ej: Reloj inteligente Ultra 10 Pro" />
            </Field>
            <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} disabled={saving} />
            <Field label="Descripción corta" icon="💬" help="Una o dos frases que salen debajo del nombre.">
              <RichTextEditor value={description} onChange={setDescription} placeholder="Ej: Resistente al agua, batería de 7 días y más de 100 modos deportivos." minHeight={90} />
            </Field>
          </div>
        </div>
      ),
    },
    {
      key: "prices", label: "Precios", icon: <BadgeDollarSign />, color: "#10b981", hint: "El % de ganancia de cada lista. El precio sale solo cuando ingreses la factura con el costo.",
      done: markups.some((m) => m !== null),
      content: (
        <>
          {storeId && canPrices ? <PricingPanel isNew part="pricing" storeId={storeId} productId={null} cost={0} costKnown prices={[0, 0, 0, 0, 0]} markups={markups} onChange={setMarkups} /> : null}
          {storeId && !canPrices ? (
            <p className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
              💲 Los precios se calculan solos con el % de ganancia de la tienda ({markups[0]} %) cuando se haga el ingreso de factura. Solo quien tiene «Cambiar precios» puede ajustarlos.
            </p>
          ) : null}
          <Field label="Desde cuántas unidades es precio mayorista" icon="📦" help="Si un cliente lleva esta cantidad o más, se le cobra el precio al por mayor.">
            <input className={`${inputCls} max-w-[10rem]`} style={inputStyle} inputMode="numeric" value={String(minWholesale)} onChange={(e) => setMinWholesale(Math.max(1, digitsOnlyToNumber(e.target.value, 1)))} />
          </Field>
        </>
      ),
    },
    {
      key: "media", label: "Fotos y videos", icon: <Images />, color: "#ec4899", hint: "Más fotos y un video ayudan a vender.", optional: true,
      done: productDetails.gallery_urls.length > 0 || Boolean(productDetails.video_url),
      content: <ProductDetailsFields bare parts={["media"]} details={productDetails} onChange={setProductDetails} userId={userId} />,
    },
    {
      key: "desc", label: "Descripción completa", icon: <FileText />, color: "#f59e0b", hint: "Para qué sirve, cómo se usa y por qué vale la pena.", optional: true,
      done: Boolean(productDetails.long_description.trim()),
      content: <ProductDetailsFields bare parts={["long"]} details={productDetails} onChange={setProductDetails} userId={userId} />,
    },
    {
      key: "features", label: "Características", icon: <ListChecks />, color: "#6366f1", hint: "Lo que lo hace especial y sus datos técnicos (color, talla, material…).", optional: true,
      done: productDetails.highlights.length > 0 || productDetails.specifications.length > 0,
      content: <ProductDetailsFields bare parts={["highlights", "specs"]} details={productDetails} onChange={setProductDetails} userId={userId} />,
    },
    {
      key: "codes", label: "Código", icon: <ScanBarcode />, color: "#64748b", hint: "Para buscarlo rápido. Si lo dejas vacío, se le pone un número (1, 2, 3…).", optional: true,
      done: Boolean(code.trim()),
      content: (
        <Field label="Código del producto" icon="🔖" help="Vacío = se usa el número interno. El código de barras se agrega después al editarlo.">
          <input className={`${inputCls} uppercase`} style={inputStyle} value={code} maxLength={40} placeholder="Ej: OLL-01"
            onChange={(e) => { const el = e.target; const at = el.selectionStart; setCode(el.value.toUpperCase()); requestAnimationFrame(() => { try { el.setSelectionRange(at, at); } catch {} }); }} />
        </Field>
      ),
    },
  ];

  return (
    <>
      <ProductEditorLayout
        mode="create"
        name={name}
        image={imageUrl}
        code={code.trim() || null}
        active={active}
        onToggleActive={() => setActive((v) => !v)}
        dirty={Boolean(name.trim())}
        saving={saving}
        onSave={() => void createNow()}
        onBack={() => router.push("/dashboard/products")}
        sections={sections}
        preview={<ProductPreviewCard name={name} image={imageUrl} price={null} active={active} highlights={productDetails.highlights} category={mainCategory} />}
      />
      <MobileActionBar show={Boolean(name.trim())}>
        <button type="button" onClick={() => void createNow()} disabled={saving || !storeId} className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: "var(--t-accent)" }}>
          {saving ? "Creando…" : "✅ Crear producto"}
        </button>
      </MobileActionBar>
    </>
  );
}
