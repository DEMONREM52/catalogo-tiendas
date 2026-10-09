import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { ManifestLink } from "@/components/pwa/ManifestLink";

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
  // return "https://remhub.store";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; mode: string }>;
}): Promise<Metadata> {
  const { slug, mode } = await params;
  const siteUrl = getSiteUrl();
  const [store, catalogMeta] = await Promise.all([findStoreBySlug(slug), findCatalogMeta(slug, mode)]);

  const storeName = catalogMeta?.store_name || store?.name || "Catálogo";
  const title = catalogMeta ? `${catalogMeta.name} · ${storeName}` : `${storeName} - Catálogos online`;
  const description = catalogMeta?.headline
    || (storeName !== "Catálogo"
      ? `Catálogo online de ${storeName}. Mira productos, precios y realiza pedidos por WhatsApp.`
      : "Catálogo online. Mira productos, precios y realiza pedidos por WhatsApp.");

  // URL canonical
  const canonical = `${siteUrl}/${slug}/${mode}`;

  // Tarjeta de vista previa con el logo: del punto (catálogo de un punto), del catálogo o de la tienda.
  const ogParams = new URLSearchParams({ store: store?.slug || decodeURIComponent(slug) });
  if (catalogMeta) ogParams.set("catalog", decodeURIComponent(mode));
  else ogParams.set("mode", mode);
  const ogImage = `${siteUrl}/api/og?${ogParams.toString()}`;

  // ✅ icon (favicon) desde logo si existe
  const logo = catalogMeta?.logo_url || store?.logo_url;
  const iconUrl = logo ? absUrl(siteUrl, logo) : `${siteUrl}/favicon.ico`;
  // Icono para instalar el catálogo (generado desde su logo real; sin logo, uno neutral).
  const pwaIcon = (size: number) =>
    `/api/pwa-icon?${new URLSearchParams({ store: store?.slug || decodeURIComponent(slug), mode: decodeURIComponent(mode), size: String(size) }).toString()}`;
  const appName = catalogMeta?.point_name || catalogMeta?.store_name || store?.name || "Catálogo";

  return {
    metadataBase: new URL(siteUrl),
    title,
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
          height: 630,
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
  return (
    <>
      <ManifestLink base={`/${slug}/${mode}/app.webmanifest`} param="key" />
      {children}
    </>
  );
}
