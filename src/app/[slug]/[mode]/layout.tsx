import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

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

export async function generateMetadata({
  params,
}: {
  params: { slug: string; mode: string };
}): Promise<Metadata> {
  const siteUrl = getSiteUrl();
  const store = await findStoreBySlug(params.slug);

  const storeName = store?.name || "Catálogo";
  const title = `${storeName} - Catálogos online`;
  const description = store?.name
    ? `Catálogo online de ${storeName}. Mira productos, precios y realiza pedidos por WhatsApp.`
    : "Catálogo online. Mira productos, precios y realiza pedidos por WhatsApp.";

  // URL canonical
  const canonical = `${siteUrl}/${params.slug}/${params.mode}`;

  // ✅ imagen OG (banner si hay, si no logo, si no default)
  const ogImage =
    (store?.banner_url && absUrl(siteUrl, store.banner_url)) ||
    (store?.logo_url && absUrl(siteUrl, store.logo_url)) ||
    `${siteUrl}/og-default.png`;

  // ✅ icon (favicon) desde logo si existe
  const iconUrl = store?.logo_url
    ? absUrl(siteUrl, store.logo_url)
    : `${siteUrl}/favicon.ico`;

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: { canonical },

    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
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

export default function StoreCatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
