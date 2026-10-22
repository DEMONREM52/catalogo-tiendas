import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { ManifestLink } from "@/components/pwa/ManifestLink";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { storeBase, storeUrl } from "@/lib/seo/store-public";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StoreMeta = {
  name: string;
  slug: string;
  logo_url: string | null;
  banner_url: string | null;
};

function getSiteUrl() {
  // ✅ pon tu dominio real aquí si quieres dejarlo fijo
  // return "https://remhub.co";

  // ✅ o usa env si lo tienes:
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_URL;

  if (!env) return "http://localhost:3000";

  // VERCEL_URL viene sin https
  if (env.startsWith("http://") || env.startsWith("https://")) return env;
  return `https://${env}`;
}

function normalizeCandidates(slugRaw: string) {
  const s = decodeURIComponent(slugRaw || "").trim();
  const noCom = s.replace(/\.com$/i, "");

  return Array.from(
    new Set([s, s.toLowerCase(), noCom, noCom.toLowerCase()].filter(Boolean))
  );
}

function supabaseServerPublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function findStoreBySlug(slugRaw: string): Promise<StoreMeta | null> {
  const sb = supabaseServerPublic();
  const candidates = normalizeCandidates(slugRaw);

  for (const c of candidates) {
    const { data, error } = await sb
      .from("stores")
      .select("name,slug,logo_url,banner_url")
      .eq("slug", c)
      .maybeSingle();

    if (!error && data?.name) return data as StoreMeta;
  }

  return null;
}

function absUrl(siteUrl: string, maybeUrl: string) {
  if (!maybeUrl) return "";
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://")) return maybeUrl;
  // por si llega "/algo.png"
  return `${siteUrl}${maybeUrl.startsWith("/") ? "" : "/"}${maybeUrl}`;
}

/** Datos del catálogo de RemHub Social para la vista previa del enlace (si existe). */
async function findCatalogMeta(slugRaw: string, catalogSlug: string) {
  try {
    const { data, error } = await supabaseServerPublic().rpc("catalog_public_meta", {
      p_store: decodeURIComponent(slugRaw || ""),
      p_catalog: decodeURIComponent(catalogSlug || ""),
    });
    if (error || !data) return null;
    return data as { name: string; store_name: string; headline: string | null; logo_url: string | null; banner_url: string | null; point_name?: string | null };
  } catch {
    return null;
  }
}

// Nombre, logo y portada para la vista previa y el título: datos públicos que casi no cambian.
// Se guardan 5 minutos en la caché compartida del servidor (no es la caché del navegador): así no se consulta
// Supabase en cada visita. Precios, existencias y productos NO pasan por aquí: se cargan siempre al día.
const META_SECONDS = 300;
const cachedStoreBySlug = unstable_cache(findStoreBySlug, ["catalog-store-meta-v1"], { revalidate: META_SECONDS });
const cachedCatalogMeta = unstable_cache(findCatalogMeta, ["catalog-meta-v1"], { revalidate: META_SECONDS });

/**
 * Lo que Google necesita para mostrar la tienda o el punto al buscarlo por nombre («la vitrina zamora»):
 * nombre del punto, dirección, ciudad y WhatsApp (de la vitrina, 20261202) y la ciudad de la tienda (20261227).
 */
type PublicPoint = { id: string; name: string; city: string | null; address: string | null; whatsapp: string | null };
type PublicPlace = {
  storeName: string;
  storeSlug: string;
  whatsapp: string | null;
  logo: string | null;
  catalogName: string | null;
  point: PublicPoint | null;
  city: string | null;
  address: string | null;
  headline: string | null;
};
async function findPublicPlace(slugRaw: string, catalogSlug: string): Promise<PublicPlace | null> {
  try {
    const sb = supabaseServerPublic();
    const slug = decodeURIComponent(slugRaw || "");
    const [home, seo] = await Promise.all([sb.rpc("store_public_home", { p_slug: slug }), sb.rpc("store_public_seo", { p_slug: slug })]);
    const h = home.error ? null : (home.data as { name: string; slug: string; whatsapp: string | null; logo_url: string | null; catalogs: Array<{ slug: string; name: string; point?: PublicPoint | null }> } | null);
    if (!h) return null;
    const s = seo.error ? null : (seo.data as { city: string | null; address: string | null; headline: string | null } | null);
    const c = h.catalogs?.find((x) => x.slug === decodeURIComponent(catalogSlug || "").toLowerCase()) ?? null;
    return {
      storeName: h.name, storeSlug: h.slug, whatsapp: h.whatsapp, logo: h.logo_url,
      catalogName: c?.name ?? null, point: c?.point ?? null,
      city: c?.point?.city || s?.city || null, address: c?.point ? c.point.address : s?.address ?? null, headline: s?.headline ?? null,
    };
  } catch {
    return null;
  }
}
const cachedPublicPlace = unstable_cache(findPublicPlace, ["catalog-public-place-v1"], { revalidate: 600 });

/** «La Vitrina Zamora»: el punto con el nombre de la tienda delante (sin repetirlo si ya lo trae). */
function placeName(p: PublicPlace) {
  if (!p.point || !p.catalogName) return p.storeName;
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return norm(p.catalogName).includes(norm(p.storeName)) ? p.catalogName : `${p.storeName} ${p.catalogName}`;
}
/** Frase con punto final, para que la descripción se lea bien en Google. */
const sentence = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? (/[.!?…]$/.test(t) ? t : `${t}.`) : null;
};
const waNumber = (v: string | null) => {
  const n = (v ?? "").replace(/\D/g, "");
  return n ? (n.length === 10 ? `+57${n}` : `+${n}`) : undefined;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; mode: string }>;
}): Promise<Metadata> {
  const { slug, mode } = await params;
  const siteUrl = getSiteUrl();
  const [store, catalogMeta, place] = await Promise.all([cachedStoreBySlug(slug), cachedCatalogMeta(slug, mode), cachedPublicPlace(slug, mode)]);

  const storeName = catalogMeta?.store_name || store?.name || "Catálogo";
  // Catálogo de un punto: «La Vitrina Zamora · Catálogo y precios en Bucaramanga», con su dirección.
  const pointTitle = place?.point ? placeName(place) : null;
  const where = place?.city && !(pointTitle ?? storeName).toLowerCase().includes(place.city.toLowerCase()) ? ` en ${place.city}` : "";
  const title = pointTitle
    ? `${pointTitle} · Catálogo y precios${where}`
    : catalogMeta ? `${catalogMeta.name} · ${storeName}` : `${storeName} · Catálogo y precios${where}`;
  const placeLine = [place?.address, place?.city].filter(Boolean).join(", ");
  const description = pointTitle
    ? [`${pointTitle}${placeLine ? `: ${placeLine}` : ""}.`, sentence(catalogMeta?.headline), "Mira productos y precios al día y pide por WhatsApp."].filter(Boolean).join(" ")
    : catalogMeta?.headline
    || (storeName !== "Catálogo"
      ? [place?.headline, `Catálogo online de ${storeName}${where}. Mira productos, precios y realiza pedidos por WhatsApp.`].filter(Boolean).join(" ")
      : "Catálogo online. Mira productos, precios y realiza pedidos por WhatsApp.");

  // Dirección única para Google: el dominio de la tienda si tiene uno (o remhub.co/tienda).
  const base = await storeBase(slug);
  const canonical = storeUrl(base, `/${decodeURIComponent(mode)}`);

  // Tarjeta de vista previa con el logo: del punto (catálogo de un punto), del catálogo o de la tienda.
  const ogParams = new URLSearchParams({ store: store?.slug || decodeURIComponent(slug) });
  if (catalogMeta) ogParams.set("catalog", decodeURIComponent(mode));
  else ogParams.set("mode", mode);
  const ogImage = `${siteUrl}/api/og?${ogParams.toString()}`;

  // ✅ icon (favicon) desde logo si existe
  const logo = catalogMeta?.logo_url || store?.logo_url;
  const iconUrl = logo ? absUrl(siteUrl, logo) : `${siteUrl}/favicon.ico`;
  // Icono para instalar el catálogo (generado desde su logo real; sin logo, uno neutral).
  // Se pide en el mismo dominio de la página: en un dominio propio sale el logo de la tienda; en remhub.co, el de RemHub.
  const storeHost = (await headers()).get("x-store-host");
  const iconBase = storeHost && /^[a-z0-9.-]{3,253}$/.test(storeHost) ? `https://${storeHost}` : "";
  const pwaIcon = (size: number) =>
    `${iconBase}/api/pwa-icon?${new URLSearchParams({ store: store?.slug || decodeURIComponent(slug), mode: decodeURIComponent(mode), size: String(size) }).toString()}`;
  const appName = catalogMeta?.point_name || catalogMeta?.store_name || store?.name || "Catálogo";

  return {
    metadataBase: new URL(siteUrl),
    // Sin «— RemHub» al final: en Google sale completo el nombre de la tienda o del punto.
    title: { absolute: title },
    description,
    alternates: { canonical },

    // App instalable del catálogo: su propio nombre, icono y dirección de inicio.
    manifest: `/${slug}/${mode}/app.webmanifest`,
    appleWebApp: { capable: true, title: appName.length > 14 ? appName.slice(0, 14) : appName, statusBarStyle: "default" },

    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: [{ url: pwaIcon(180), sizes: "180x180", type: "image/png" }],
    },

    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "RemHub",
      type: "website",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 1200,
          type: "image/jpeg",
          alt: title,
        },
      ],
    },

    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function StoreCatalogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; mode: string }>;
}) {
  const { slug, mode } = await params;
  // Ficha de negocio para Google (schema.org/Store): el punto con su dirección o la tienda.
  const place = await cachedPublicPlace(slug, mode);
  let jsonLd: Record<string, unknown> | null = null;
  if (place) {
    const base = await storeBase(place.storeSlug);
    const url = storeUrl(base, `/${decodeURIComponent(mode)}`);
    const name = placeName(place);
    const point = place.point;
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "Store",
      name,
      url,
      image: place.logo && /^https:\/\//i.test(place.logo) ? place.logo : undefined,
      telephone: waNumber(point?.whatsapp || place.whatsapp),
      description: place.headline || undefined,
      address: place.address || place.city ? { "@type": "PostalAddress", streetAddress: place.address || undefined, addressLocality: place.city || undefined, addressCountry: "CO" } : undefined,
      hasMap: place.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.storeName, place.address, place.city].filter(Boolean).join(" "))}` : undefined,
      parentOrganization: point ? { "@type": "Organization", name: place.storeName, url: storeUrl(base, "/inicio") } : undefined,
    };
  }
  return (
    <>
      {/* JSON seguro dentro de <script>: se escapa «<». */}
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} /> : null}
      <ManifestLink base={`/${slug}/${mode}/app.webmanifest`} param="key" />
      {children}
    </>
  );
}
