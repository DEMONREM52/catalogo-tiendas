import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareProductButton } from "@/components/ShareProductButton";
import { WhatsAppProductLink } from "@/components/WhatsAppProductLink";
import { ProductShowcase } from "@/components/ProductShowcase";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getYoutubeEmbedUrl,
  buildProductShareText,
  isSafeHttpUrl,
  normalizeProductDetails,
} from "@/lib/product-details";
import { ArrowLeft, Check, PackageCheck, PackageX, Sparkles } from "lucide-react";

type PageProps = {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ catalogo?: string; key?: string }>;
};

/**
 * Precio y existencias del producto dentro de un catálogo de RemHub Social.
 * null = no es un catálogo de RemHub Social (se usa el catálogo clásico).
 */
async function catalogContext(slug: string, catalogSlug: string | undefined, key: string | undefined, productId: string) {
  if (!catalogSlug || !/^[a-z0-9][a-z0-9-]{0,47}$/i.test(catalogSlug)) return null;
  const { data, error } = await supabaseServer().rpc("catalog_public_stock", {
    p_store: decodeURIComponent(slug),
    p_catalog: catalogSlug,
    p_key: key ?? null,
    p_ids: [productId],
  });
  if (error || !Array.isArray(data) || !data[0]) return null;
  const row = data[0] as { price: number | null; stock: number | null };
  const base = { slug: catalogSlug.toLowerCase(), key: key ?? null };
  if (row.price === null || Number(row.price) <= 0 || (row.stock !== null && Number(row.stock) <= 0)) {
    return { ...base, available: false as const };
  }
  return { ...base, available: true as const, price: Number(row.price), stock: row.stock === null ? null : Number(row.stock) };
}

function catalogHref(storeSlug: string, catalog: { slug: string; key: string | null }) {
  return `/${storeSlug}/${catalog.slug}${catalog.key ? `?key=${encodeURIComponent(catalog.key)}` : ""}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const sb = supabaseServer();
  const { data: store, error: storeError } = await sb
    .from("stores")
    .select("id")
    .eq("slug", decodeURIComponent(slug))
    .eq("active", true)
    .eq("catalog_retail", true)
    .maybeSingle();
  if (storeError) throw new Error(`No se pudo cargar la tienda: ${storeError.message}`);
  if (!store) return { title: "Producto no disponible · RemHub" };

  const { data: product, error: productError } = await sb
    .from("products")
    .select("name,description,image_url,stock,active,product_details")
    .eq("id", id)
    .eq("store_id", store.id)
    .eq("active", true)
    .or("stock.is.null,stock.gt.0")
    .maybeSingle();
  if (productError) throw new Error(`No se pudo cargar el producto: ${productError.message}`);
  if (!product) {
    return { title: "Producto no disponible · RemHub", robots: { index: false, follow: false } };
  }

  const details = normalizeProductDetails(product.product_details);
  const description = (details.long_description || product.description || `Conoce todos los detalles de ${product.name}.`)
    .replace(/\s+/g, " ")
    .slice(0, 300);
  const images = [product.image_url, ...details.gallery_urls].filter(
    (url): url is string => Boolean(url) && isSafeHttpUrl(url),
  );

  return {
    title: product.name,
    description,
    openGraph: {
      type: "website",
      title: product.name,
      description,
      images,
    },
    twitter: { card: "summary_large_image", title: product.name, description, images },
  };
}

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

export default async function PublicProductPage({ params, searchParams }: PageProps) {
  const { slug, id } = await params;
  const { catalogo, key } = await searchParams;
  const sb = supabaseServer();
  const context = await catalogContext(slug, catalogo, key, id);
  if (context && !context.available) {
    return (
      <main className="product-landing-page grid min-h-screen place-items-center px-4 py-10">
        <section className="product-landing-card w-full max-w-md rounded-[28px] border p-8 text-center shadow-2xl backdrop-blur-xl">
          <PackageX size={42} className="mx-auto opacity-80" />
          <h1 className="mt-4 text-2xl font-black">Este producto no está disponible</h1>
          <p className="mt-2 text-sm leading-6 opacity-75">Se agotó o ya no hace parte de este catálogo. Mira los demás productos disponibles.</p>
          <Link href={catalogHref(decodeURIComponent(slug), context)} className="mt-6 inline-flex items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <ArrowLeft size={16} /> Ver el catálogo
          </Link>
        </section>
      </main>
    );
  }
  const inCatalog = context?.available ? context : null;
  let storeQuery = sb
    .from("stores")
    .select("id,slug,active,catalog_retail,whatsapp")
    .eq("slug", decodeURIComponent(slug))
    .eq("active", true);
  if (!inCatalog) storeQuery = storeQuery.eq("catalog_retail", true);
  const { data: store, error: storeError } = await storeQuery.maybeSingle();
  if (storeError) throw new Error(`No se pudo cargar la tienda: ${storeError.message}`);
  if (!store) notFound();

  const { data: product, error: productError } = await sb
    .from("products")
    .select("id,name,description,price_retail,price_wholesale,min_wholesale,image_url,stock,active,product_details,category_id")
    .eq("id", id)
    .eq("store_id", store.id)
    .eq("active", true)
    .or("stock.is.null,stock.gt.0")
    .maybeSingle();
  if (productError) throw new Error(`No se pudo cargar el producto: ${productError.message}`);
  if (!product) notFound();

  let categoryName: string | null = null;
  if (product.category_id) {
    const { data: category, error: categoryError } = await sb
      .from("product_categories")
      .select("name")
      .eq("id", product.category_id)
      .eq("store_id", store.id)
      .eq("active", true)
      .maybeSingle();
    if (categoryError) throw new Error(`No se pudo cargar la categoría: ${categoryError.message}`);
    categoryName = category?.name ?? null;
  }

  const details = normalizeProductDetails(product.product_details);
  const gallery = [...new Set([product.image_url, ...details.gallery_urls].filter(
    (url): url is string => Boolean(url) && isSafeHttpUrl(url),
  ))];
  const safeVideoUrl = isSafeHttpUrl(details.video_url) ? details.video_url : "";
  const embedUrl = isSafeHttpUrl(details.video_url)
    ? getYoutubeEmbedUrl(details.video_url)
    : null;
  const description = details.long_description.trim() || product.description?.trim() || "";
  const price = inCatalog ? inCatalog.price : Number(product.price_retail);
  const stock = inCatalog ? inCatalog.stock : product.stock;
  const backHref = inCatalog ? catalogHref(store.slug, inCatalog) : `/${store.slug}/detal`;
  const shareText = buildProductShareText({
    name: product.name,
    price,
    description: product.description,
    category: categoryName,
    stock,
    imageUrl: product.image_url,
    details,
  });

  return (
    <main className="product-landing-page min-h-screen px-2 py-4 sm:px-4 sm:py-8 lg:px-6">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="product-landing-topbar mb-6 flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 sm:px-5">
          <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold opacity-80 transition hover:opacity-100">
            <ArrowLeft size={17} /> Volver a explorar
          </Link>
          <span className="product-landing-kicker hidden items-center gap-2 text-xs font-extrabold tracking-[0.16em] sm:inline-flex">
            <Sparkles size={15} /> DESCUBRE CADA DETALLE
          </span>
        </header>

        <article className="product-landing-card product-landing-hero overflow-hidden rounded-[34px] border shadow-2xl backdrop-blur-xl">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,.96fr)]">
            <ProductShowcase
              images={gallery}
              productName={product.name}
              videoUrl={safeVideoUrl}
              videoEmbedUrl={embedUrl}
              tutorialUrl={isSafeHttpUrl(details.tutorial_url) ? details.tutorial_url : ""}
            />
            <div className="product-landing-info flex flex-col p-6 sm:p-9 lg:p-11">
              <div className="flex flex-wrap items-center gap-2">
                <span className="product-landing-pill inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold">
                  <PackageCheck size={14} /> Disponible
                </span>
                {categoryName ? <span className="product-landing-category rounded-full px-3 py-1.5 text-xs font-bold">{categoryName}</span> : null}
              </div>
              <h1 className="mt-5 text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">{product.name}</h1>
              <p className="product-landing-price mt-6 text-4xl font-black sm:text-5xl">{money(price)}</p>
              <div className="product-landing-stock mt-3 flex items-center gap-2 text-sm font-semibold">
                <span className="product-landing-stock-dot h-2 w-2 rounded-full" />
                {stock === null ? "Listo para ti" : `${stock} unidades disponibles`}
              </div>
              {description ? <p className="mt-7 whitespace-pre-line text-base leading-7 opacity-80">{description}</p> : null}

              <div className="mt-auto pt-8">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <ShareProductButton title={product.name} text={shareText} />
                  {store.whatsapp ? (
                    <WhatsAppProductLink phone={store.whatsapp} productText={shareText} />
                  ) : null}
                </div>
                <p className="product-landing-share-note mt-3 text-xs leading-5">
                  Cada foto se incluye como enlace separado. No se comparte el nombre de la tienda ni el enlace a su página.
                </p>
              </div>
            </div>
          </div>
        </article>

        {details.highlights.length ? (
          <section className="product-landing-section mt-7 rounded-[30px] border p-6 shadow-xl sm:p-9">
            <div className="product-landing-section-heading mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="product-landing-kicker text-xs font-extrabold uppercase tracking-[0.18em]">LO MEJOR DEL PRODUCTO</p>
                <h2 className="mt-2 text-2xl font-black sm:text-3xl">Detalles que importan</h2>
              </div>
              <Sparkles className="product-landing-accent hidden sm:block" size={28} />
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {details.highlights.map((highlight, index) => (
                <li key={`${highlight}-${index}`} className="product-landing-highlight flex gap-3 rounded-2xl p-4 leading-6">
                  <span className="product-landing-highlight-icon grid h-7 w-7 shrink-0 place-items-center rounded-full"><Check size={15} /></span>
                  {highlight}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {details.specifications.length ? (
          <section className="product-landing-section mt-7 rounded-[30px] border p-6 shadow-xl sm:p-9">
            <p className="product-landing-kicker text-xs font-extrabold uppercase tracking-[0.18em]">FICHA TÉCNICA</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">Especificaciones</h2>
            <dl className="product-landing-specifications mt-5 grid gap-3 sm:grid-cols-2">
              {details.specifications.map((spec, index) => (
                <div key={`${spec.name}-${index}`} className="product-landing-spec rounded-2xl border p-4">
                  <dt className="text-xs font-bold uppercase tracking-wider opacity-60">{spec.name}</dt>
                  <dd className="mt-1 font-bold">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <footer className="product-landing-footer mt-8 text-center text-xs">
          Información del producto · {new Date().getFullYear()}
        </footer>
      </div>
    </main>
  );
}
