import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareProductButton } from "@/components/ShareProductButton";
import { BuyBox } from "@/components/catalog/BuyBox";
import { RelatedProducts } from "@/components/catalog/RelatedProducts";
import { endsInText, fetchPublicDeals, fetchPublicItems, type PublicDeal, type PublicItem } from "@/lib/catalog/public-prices";
import { ProductShowcase } from "@/components/ProductShowcase";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getYoutubeEmbedUrl,
  buildProductShareText,
  isSafeHttpUrl,
  normalizeProductDetails,
} from "@/lib/product-details";
import { ArrowLeft, Camera, Check, PackageCheck, PackageX, ScanSearch, Sparkles } from "lucide-react";
import { CatalogFinderButton } from "@/components/product-finder/CatalogFinder";
import { ManifestLink } from "@/components/pwa/ManifestLink";
import { RichText } from "@/components/RichText";
import { richToPlain } from "@/lib/rich-text";
import { TrackProductView } from "@/components/StorePixel";
import { storeBase, storeUrl } from "@/lib/seo/store-public";

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

// Código de producto válido (si no, «no encontrado» en vez de un error).
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function catalogHref(storeSlug: string, catalog: { slug: string; key: string | null }) {
  return `/${storeSlug}/${catalog.slug}${catalog.key ? `?key=${encodeURIComponent(catalog.key)}` : ""}`;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug, id } = await params;
  const { catalogo } = await searchParams;
  // Instalar desde «Ver más» instala el catálogo del que viene (no la app de RemHub).
  const catalogPath = catalogo && /^[a-z0-9][a-z0-9-]{0,47}$/i.test(catalogo) ? catalogo.toLowerCase() : "detal";
  const appMeta = {
    manifest: `/${slug}/${catalogPath}/app.webmanifest`,
    icons: { apple: [{ url: `/api/pwa-icon?${new URLSearchParams({ store: decodeURIComponent(slug), mode: catalogPath, size: "180" }).toString()}`, sizes: "180x180", type: "image/png" }] },
    appleWebApp: { capable: true, statusBarStyle: "default" as const },
  };
  if (!PRODUCT_ID.test(id)) return { title: "Producto no disponible · RemHub", robots: { index: false, follow: false }, ...appMeta };
  const sb = supabaseServer();
  const { data: store, error: storeError } = await sb
    .from("stores")
    .select("id,name")
    .eq("slug", decodeURIComponent(slug))
    .eq("active", true)
    .eq("catalog_retail", true)
    .maybeSingle();
  if (storeError) throw new Error(`No se pudo cargar la tienda: ${storeError.message}`);
  if (!store) return { title: "Producto no disponible · RemHub", ...appMeta };

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
    return { title: "Producto no disponible · RemHub", robots: { index: false, follow: false }, ...appMeta };
  }

  const details = normalizeProductDetails(product.product_details);
  const description = richToPlain(details.long_description || product.description || `Conoce todos los detalles de ${product.name}.`)
    .replace(/\s+/g, " ")
    .slice(0, 300);
  const photos = [product.image_url, ...details.gallery_urls].filter(
    (url): url is string => Boolean(url) && isSafeHttpUrl(url),
  );
  // Sin fotos: la tarjeta con el logo de la tienda.
  const images = photos.length ? photos : [`/api/og?store=${encodeURIComponent(decodeURIComponent(slug))}`];

  const canonical = storeUrl(await storeBase(slug), `/producto/${id}`);
  // «Producto · Tienda»: así sale al buscar el producto con el nombre de la tienda (ej. «zapatero la vitrina»).
  const storeName = (store as { name?: string | null }).name?.trim();
  const title = storeName ? `${product.name} · ${storeName}` : product.name;
  return {
    ...appMeta,
    title: { absolute: title },
    description,
    // Una sola dirección por producto: la del catálogo clásico (los catálogos de campaña apuntan aquí).
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      images: images.map((url) => ({ url, alt: title })),
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

function money(value: number) {
  return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

export default async function PublicProductPage({ params, searchParams }: PageProps) {
  const { slug, id } = await params;
  const { catalogo, key } = await searchParams;
  if (!PRODUCT_ID.test(id)) notFound();
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
  // Catálogo clásico «Por mayor» (?catalogo=mayor) cuando no responde como catálogo: precio al por mayor y el carrito va allá.
  const classic = !inCatalog && (catalogo ?? "").toLowerCase() === "mayor" ? { slug: "mayor", key: key ?? null } : null;
  const via = inCatalog ?? classic;
  let storeQuery = sb
    .from("stores")
    .select("id,slug,name,active,catalog_retail,whatsapp")
    .eq("slug", decodeURIComponent(slug))
    .eq("active", true);
  if (!via) storeQuery = storeQuery.eq("catalog_retail", true);
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
  const price = inCatalog ? inCatalog.price : classic ? Number(product.price_wholesale) : Number(product.price_retail);
  const stock = inCatalog ? inCatalog.stock : product.stock;
  const backHref = via ? catalogHref(store.slug, via) : `/${store.slug}/detal`;
  const finderCtx = { storeId: store.id, storeSlug: store.slug, catalogSlug: inCatalog?.slug ?? null, accessKey: inCatalog?.key ?? null };
  // El código se pide aparte: si el público aún no tiene permiso de verlo, la página carga igual.
  const { data: codeRow } = await sb.from("products").select("sku").eq("id", product.id).maybeSingle();
  const rawCode = (codeRow as { sku?: unknown } | null)?.sku;
  const code = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim() : null;
  const shareText = buildProductShareText({
    name: product.name,
    price,
    description: product.description,
    category: categoryName,
    stock,
    imageUrl: product.image_url,
    details,
  });

  // Comprar: el catálogo de donde viene (o el clásico) recibe el producto en el carrito.
  const catalogSlug = via?.slug ?? "detal";
  const catalogPath = `/${store.slug}/${catalogSlug}`;
  const keyQ = via?.key ? `key=${encodeURIComponent(via.key)}&` : "";
  const productHref = (pid: string) => via ? `/${store.slug}/producto/${pid}?catalogo=${encodeURIComponent(via.slug)}${via.key ? `&key=${encodeURIComponent(via.key)}` : ""}` : `/${store.slug}/producto/${pid}`;
  const addHref = (pid: string) => `${catalogPath}?${keyQ}agregar=${pid}&cant=1`;

  // Lo más vendido y productos de la misma categoría (con el precio de este catálogo). Si algo falla, no se muestra.
  let bestItems: PublicItem[] = [];
  let relatedItems: PublicItem[] = [];
  let bestRank: number | null = null;
  let bestTitle = "Lo más vendido";
  // Oferta de este producto en este catálogo (20261309): el precio de ahora ya viene con la oferta.
  let deals = new Map<string, PublicDeal>();
  try { deals = await fetchPublicDeals(sb, store.slug, catalogSlug, via?.key ?? null); } catch { /* sin ofertas */ }
  const deal = deals.get(product.id) ?? null;
  const shownPrice = deal?.now && deal.now > 0 ? deal.now : Number(price);
  const endsText = deal?.before ? endsInText(deal.ends_at, Date.now()) : null;
  try {
    const [bestRes, sameCat] = await Promise.all([
      sb.rpc("store_public_best_sellers", { p_store: store.slug, p_limit: 10, p_catalog: catalogSlug })
        .then((r) => (r.error && /Could not find the function|schema cache/i.test(r.error.message) ? sb.rpc("store_public_best_sellers", { p_store: store.slug, p_limit: 10 }) : r)),
      product.category_id
        ? sb.from("products").select("id").eq("store_id", store.id).eq("category_id", product.category_id).eq("active", true).neq("id", product.id).or("stock.is.null,stock.gt.0").limit(12)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
    ]);
    const bd = bestRes.error || !bestRes.data ? null : (Array.isArray(bestRes.data) ? { ids: bestRes.data } : bestRes.data) as { ids?: unknown[]; title?: string | null; badges?: boolean };
    const bestIds = (bd?.ids ?? []).map(String);
    if (bd?.title?.trim()) bestTitle = bd.title.trim();
    const pos = bestIds.indexOf(product.id);
    if (pos >= 0 && bd?.badges !== false) bestRank = pos + 1;
    const relIds = ((sameCat.data ?? []) as Array<{ id: string }>).map((r) => r.id).filter((x) => !bestIds.includes(x));
    const items = await fetchPublicItems(sb, { id: store.id, slug: store.slug }, catalogSlug, via?.key ?? null, [...bestIds, ...relIds]);
    const withDeal = (x: PublicItem) => ({ ...x, price: deals.get(x.id)?.now || x.price });
    bestItems = bestIds.filter((x) => x !== product.id).map((x) => items.get(x)).filter((x): x is PublicItem => Boolean(x)).map(withDeal);
    relatedItems = relIds.map((x) => items.get(x)).filter((x): x is PublicItem => Boolean(x)).map(withDeal).slice(0, 10);
    if (bestItems.length < 3) bestItems = [];
  } catch { /* sin recomendaciones */ }

  // Ficha para Google (schema.org/Product): nombre, fotos, precio en pesos y disponibilidad.
  const canonical = storeUrl(await storeBase(store.slug), `/producto/${product.id}`);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: richToPlain(description).replace(/\s+/g, " ").slice(0, 500) || undefined,
    image: gallery.length ? gallery : undefined,
    sku: code ?? undefined,
    brand: { "@type": "Brand", name: (store as { name?: string }).name ?? store.slug },
    category: categoryName ?? undefined,
    url: canonical,
    offers: Number(price) > 0 ? {
      "@type": "Offer",
      priceCurrency: "COP",
      price: shownPrice,
      availability: stock === null || Number(stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: canonical,
      seller: { "@type": "Organization", name: (store as { name?: string }).name ?? store.slug },
    } : undefined,
  };

  return (
    <main className="product-landing-page min-h-screen px-2 py-4 sm:px-4 sm:py-8 lg:px-6">
      {/* JSON seguro dentro de <script>: se escapa «<» para que ningún texto cierre la etiqueta. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <TrackProductView item={{ id: product.id, name: product.name, price: Number(price) || 0, category: categoryName }} store={store.slug} />
      <ManifestLink base={`/${store.slug}/${inCatalog?.slug ?? "detal"}/app.webmanifest`} param="key" />
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="product-landing-topbar mb-6 flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 sm:px-5">
          <Link href={backHref} className="inline-flex min-w-0 items-center gap-2 text-sm font-bold opacity-80 transition hover:opacity-100">
            <ArrowLeft size={17} className="shrink-0" /> <span className="truncate">Volver a explorar</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="product-landing-kicker hidden items-center gap-2 text-xs font-extrabold tracking-[0.16em] lg:inline-flex">
              <Sparkles size={15} /> DESCUBRE CADA DETALLE
            </span>
            <CatalogFinderButton
              ctx={finderCtx}
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition hover:-translate-y-0.5 sm:text-sm"
              style={{ borderColor: "var(--t-card-border)" }}
              title="Buscar otro producto por nombre, código o foto"
            >
              <ScanSearch size={16} /> <span className="sm:hidden">Buscar</span><span className="hidden sm:inline">Buscar otro producto</span>
            </CatalogFinderButton>
            <CatalogFinderButton
              ctx={finderCtx}
              mode="photo"
              className="grid h-9 w-9 place-items-center rounded-full border transition hover:-translate-y-0.5"
              style={{ borderColor: "var(--t-card-border)" }}
              ariaLabel="Buscar otro producto con una foto"
              title="Buscar con una foto"
            >
              <Camera size={16} />
            </CatalogFinderButton>
          </div>
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
                {code ? <span className="product-landing-category rounded-full px-3 py-1.5 text-xs font-bold">Código {code}</span> : null}
              </div>
              {bestRank ? (
                <p className="catalog-best-badge mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black text-white shadow-lg">
                  {bestRank === 1 ? "👑 El más vendido de la tienda" : `🔥 Top ${bestRank} en ventas`}
                </p>
              ) : null}
              <h1 className="mt-4 text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">{product.name}</h1>
              {deal?.before ? (
                <div className="mt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    {deal.pct ? <span className="offer-pct-badge rounded-xl px-3 py-1.5 text-lg font-black text-white">-{deal.pct}%</span> : null}
                    {deal.label ? <span className="offer-ribbon rounded-full px-3 py-1 text-xs font-black uppercase text-white">{deal.label}</span> : null}
                  </div>
                  <p className="mt-3 text-lg font-bold opacity-60">Antes <span className="line-through">{money(deal.before)}</span></p>
                  <p className="offer-price text-5xl font-black sm:text-6xl">{money(shownPrice)}</p>
                  <p className="mt-1 text-sm font-black" style={{ color: "#10b981" }}>Ahorras {money(deal.before - shownPrice)}</p>
                  {endsText ? <p className="mt-1 text-sm font-bold" style={{ color: "#f59e0b" }}>⏳ {endsText}</p> : null}
                </div>
              ) : (
                <p className="product-landing-price mt-6 text-4xl font-black sm:text-5xl">{money(shownPrice)}</p>
              )}
              {deal?.featured ? <p className="featured-badge mt-3 inline-flex w-fit rounded-full px-3 py-1 text-xs font-black">⭐ Producto destacado</p> : null}
              <div className="product-landing-stock mt-3 flex items-center gap-2 text-sm font-semibold">
                <span className="product-landing-stock-dot h-2 w-2 rounded-full" />
                {stock === null ? "Listo para ti" : Number(stock) <= 5 ? <b>🔥 ¡Solo quedan {stock}!</b> : `${stock} unidades disponibles`}
              </div>
              {description ? <RichText text={description} className="mt-7 space-y-1 break-words text-base leading-7 opacity-80" /> : null}

              <div className="mt-auto pt-8">
                <BuyBox productId={product.id} name={product.name} price={shownPrice || 0} stock={stock === null ? null : Number(stock)}
                  catalogPath={catalogPath} accessKey={via?.key ?? null} storeSlug={store.slug} explicit={Boolean(via)} whatsapp={store.whatsapp || null} shareText={shareText} />
                <ul className="mt-5 grid grid-cols-2 gap-2 text-xs font-bold">
                  {[
                    ["⚡", "Pides en un minuto"],
                    ["💬", "Te atendemos por WhatsApp"],
                    ["✅", "Te confirmamos disponibilidad"],
                    ["🛍️", "Suma más productos al pedido"],
                  ].map(([icon, text], i) => (
                    <li key={text} className="trust-chip flex items-center gap-2 rounded-2xl border px-3 py-2.5" style={{ borderColor: "var(--t-card-border)", animationDelay: `${i * 80}ms` }}>
                      <span className="text-base" aria-hidden>{icon}</span>{text}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center gap-2 opacity-80">
                  <ShareProductButton title={product.name} text={shareText} compact />
                  <span className="text-xs">Compártelo con alguien a quien le pueda gustar</span>
                </div>
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

        <RelatedProducts kind="best" title={bestTitle} items={bestItems} productHref={productHref} addHref={addHref} />
        <RelatedProducts kind="related" title="También te puede gustar" items={relatedItems} productHref={productHref} addHref={addHref} />

        <div className="mt-7 text-center">
          <Link href={backHref} className="inline-flex items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-black transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
            🛍️ Ver todo el catálogo
          </Link>
        </div>

        <footer className="product-landing-footer mt-8 pb-28 text-center text-xs">
          Información del producto · {new Date().getFullYear()}
        </footer>
      </div>
    </main>
  );
}
