import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { storeBase, storeUrl } from "@/lib/seo/store-public";
import { previewImage } from "@/lib/share/link-preview";
import { MadeWithRemhub } from "@/components/MadeWithRemhub";

type Point = { id: string; name: string; city: string | null; address: string | null; whatsapp: string | null };
type Catalog = { slug: string; name: string; kind: "retail" | "wholesale" | "catalog"; logo_url: string | null; headline: string | null; point?: Point | null };
type Home = { name: string; slug: string; logo_url: string | null; banner_url: string | null; whatsapp: string | null; home_target: string; catalogs: Catalog[] };

/**
 * Vitrina pública de la tienda: todos sus catálogos públicos (activos y sin clave).
 * Caché compartida de 2 minutos (es pública y casi no cambia); el título y la página usan la misma consulta.
 */
const loadHome = unstable_cache(async (slugRaw: string): Promise<Home | null | "missing"> => {
  const { data, error } = await supabaseServer().rpc("store_public_home", { p_slug: decodeURIComponent(slugRaw || "") });
  if (error) return /store_public_home|Could not find the function|schema cache/i.test(error.message) ? "missing" : null;
  return (data as Home | null) ?? null;
}, ["store-public-home-v1"], { revalidate: 120 });

const isSafe = (u: string | null | undefined): u is string => Boolean(u) && /^https:\/\//i.test(String(u));

/** Lo que ayuda a salir en Google (20261227): frase, ciudad, dirección, categorías y productos con foto. */
type Seo = { headline: string | null; city: string | null; address: string | null; categories: string[]; products: Array<{ id: string; name: string; image: string; price: number | null }>; count: number };
const loadSeo = unstable_cache(async (slugRaw: string): Promise<Seo | null> => {
  const { data, error } = await supabaseServer().rpc("store_public_seo", { p_slug: decodeURIComponent(slugRaw || "") });
  return error ? null : ((data as Seo | null) ?? null);
}, ["store-public-seo-v1"], { revalidate: 600 });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [home, seo] = await Promise.all([loadHome(slug), loadSeo(slug)]);
  if (!home || home === "missing") return { title: "Tienda no disponible · RemHub", robots: { index: false, follow: false } };
  const base = await storeBase(home.slug);
  const canonical = storeUrl(base, "/inicio");
  // Título y descripción pensados para búsquedas locales: «Tienda en Ciudad», qué vende y cómo pedir.
  const what = seo?.categories?.length ? seo.categories.slice(0, 4).join(", ") : home.catalogs.map((c) => c.name).join(", ");
  const description = [seo?.headline, `${home.name}${seo?.city ? ` en ${seo.city}` : ""}: ${what}.`, `${seo?.count ? `${seo.count} productos con ` : ""}precios al día. Pide por WhatsApp.`]
    .filter(Boolean).join(" ").slice(0, 300);
  // Portada si tiene; si no, la tarjeta con su logo (el logo suelto, si es transparente, se pierde en fondo blanco).
  const image = isSafe(home.banner_url) ? home.banner_url : previewImage(home.slug);
  return {
    title: { absolute: seo?.city ? `${home.name} en ${seo.city} · Catálogo y precios` : `${home.name} · Catálogo y precios` },
    keywords: [home.name, ...(seo?.categories ?? []), ...(seo?.city ? [seo.city, `${(seo.categories ?? [])[0] ?? "tienda"} en ${seo.city}`] : [])],
    description,
    alternates: { canonical },
    openGraph: { type: "website", title: home.name, description, url: canonical, images: image ? [image] : undefined },
    icons: isSafe(home.logo_url) ? { icon: home.logo_url } : undefined,
  };
}

export default async function StoreHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = await loadHome(slug);
  // Sin la migración 20261130: se abre el catálogo de siempre.
  if (home === "missing") redirect(`/${decodeURIComponent(slug)}/detal`);
  if (!home) notFound();
  // Con un solo catálogo no hace falta escoger.
  if (home.catalogs.length === 1) redirect(`/${home.slug}/${home.catalogs[0].slug}`);

  const base = await storeBase(home.slug);
  const seo = await loadSeo(slug);
  // En el espacio de la tienda (su subdominio o dominio propio) los enlaces van sin el nombre (sin redirección por clic).
  const h = await headers();
  const onStoreHost = Boolean(h.get("x-store-host")) && (h.get("x-store-slug") ?? "").toLowerCase() === home.slug.toLowerCase();
  const pfx = onStoreHost ? "" : `/${home.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: home.name,
    url: storeUrl(base, "/inicio"),
    logo: isSafe(home.logo_url) ? home.logo_url : undefined,
    image: isSafe(home.banner_url) ? home.banner_url : undefined,
    telephone: home.whatsapp || undefined,
    description: seo?.headline || undefined,
    address: seo?.city || seo?.address ? { "@type": "PostalAddress", streetAddress: seo?.address || undefined, addressLocality: seo?.city || undefined, addressCountry: "CO" } : undefined,
    areaServed: seo?.city || undefined,
    // Lo que vende, para que Google entienda la tienda (sin precios de costo ni existencias).
    hasOfferCatalog: seo?.products?.length ? {
      "@type": "OfferCatalog",
      name: `Productos de ${home.name}`,
      itemListElement: seo.products.slice(0, 12).map((p) => ({
        "@type": "Offer",
        priceCurrency: "COP",
        price: p.price ? Math.round(p.price) : undefined,
        itemOffered: { "@type": "Product", name: p.name, image: isSafe(p.image) ? p.image : undefined, url: storeUrl(base, `/producto/${p.id}`) },
      })),
    } : undefined,
  };
  const wa = (home.whatsapp ?? "").replace(/\D/g, "");
  const KIND: Record<Catalog["kind"], string> = { retail: "🛍️", wholesale: "📦", catalog: "✨" };
  const waLink = (n: string) => `https://wa.me/${n.length === 10 ? `57${n}` : n}`;
  // Catálogos de cada punto («Escoge tu punto») y los de la tienda.
  const byPoint = home.catalogs.filter((c) => c.point);
  const general = home.catalogs.filter((c) => !c.point);
  const card = (c: Catalog) => (
    <Link key={c.slug} href={`${pfx}/${c.slug}`} prefetch={false} className="group flex items-center gap-4 rounded-3xl border p-4 transition hover:-translate-y-0.5"
      style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      {isSafe(c.logo_url) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
      ) : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: "var(--t-cta)" }}>{KIND[c.kind]}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black">{c.name}</span>
        <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{c.headline || (c.kind === "wholesale" ? "Precios por mayor" : "Ver productos")}</span>
      </span>
      <span aria-hidden className="text-xl opacity-60 transition group-hover:translate-x-1">→</span>
    </Link>
  );

  return (
    <main className="min-h-screen" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      {/* JSON seguro dentro de <script>: se escapa «<». */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <section className="relative">
        {isSafe(home.banner_url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={home.banner_url} alt="" className="h-44 w-full object-cover sm:h-60" />
        ) : <div className="h-28 w-full sm:h-36" style={{ background: "var(--t-cta)" }} />}
        <div className="mx-auto -mt-12 flex max-w-4xl flex-col items-center px-4 text-center">
          {isSafe(home.logo_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.logo_url} alt={home.name} className="h-24 w-24 rounded-3xl border-4 object-cover shadow-xl" style={{ borderColor: "var(--t-bg-base)", background: "var(--t-bg-base)" }} />
          ) : <span className="grid h-24 w-24 place-items-center rounded-3xl border-4 text-4xl shadow-xl" style={{ borderColor: "var(--t-bg-base)", background: "var(--t-card-bg)" }}>🏪</span>}
          <h1 className="mt-3 text-2xl font-black sm:text-3xl">{home.name}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Escoge un catálogo para ver productos y precios</p>
        </div>
      </section>

      {byPoint.length > 0 ? (
        <section className="mx-auto max-w-4xl px-4 pt-8">
          <h2 className="text-lg font-black">📍 Escoge tu punto</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {byPoint.map((c) => {
              const p = c.point as Point;
              const pw = (p.whatsapp ?? "").replace(/\D/g, "");
              const place = [p.address, p.city].filter(Boolean).join(" · ");
              return (
                <div key={c.slug} className="flex flex-col rounded-3xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                  <p className="text-base font-black">{c.name}</p>
                  {place ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{place}</p> : null}
                  {c.headline ? <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{c.headline}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`${pfx}/${c.slug}`} prefetch={false} className="rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: "var(--t-accent)" }}>Ver catálogo</Link>
                    {pw ? (
                      <a href={waLink(pw)} target="_blank" rel="noreferrer" className="rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: "#22c55e" }}>
                        💬 Escribirle a este punto
                      </a>
                    ) : null}
                    {place ? (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([home.name, p.address, p.city].filter(Boolean).join(" "))}`}
                        target="_blank" rel="noreferrer" className="rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                        Cómo llegar
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {general.length > 0 ? (
        <section className="mx-auto max-w-4xl px-4 py-8">
          {byPoint.length > 0 ? <h2 className="mb-3 text-lg font-black">🛍️ Catálogos</h2> : null}
          <div className="grid gap-3 sm:grid-cols-2">{general.map(card)}</div>
        </section>
      ) : <div className="pb-8" />}

      {wa ? (
        <div className="pb-10 text-center">
          <a href={waLink(wa)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white" style={{ background: "#22c55e" }}>
            💬 Escríbenos por WhatsApp
          </a>
        </div>
      ) : null}
      <MadeWithRemhub slug={home.slug} source="vitrina" />
    </main>
  );
}
