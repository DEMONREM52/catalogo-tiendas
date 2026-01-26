import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StoreMeta = { name: string; logo_url: string | null };

function candidatesFromSlug(slugRaw: string) {
  const s = decodeURIComponent(slugRaw || "").trim();
  const noCom = s.replace(/\.com$/i, "");
  return Array.from(new Set([s, s.toLowerCase(), noCom, noCom.toLowerCase()])).filter(Boolean);
}

async function findStore(slugRaw: string): Promise<StoreMeta | null> {
  const sb = supabaseServer();
  const candidates = candidatesFromSlug(slugRaw);

  for (const c of candidates) {
    const { data, error } = await sb
      .from("stores")
      .select("name,logo_url")
      .eq("slug", c)
      .maybeSingle();

    if (!error && data?.name) return data as StoreMeta;
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string; mode: string };
}): Promise<Metadata> {
  const store = await findStore(params.slug);

  const siteTitle = store?.name
    ? `${store.name} - Catálogos online`
    : "Catálogo - Catálogos online";

  const iconUrl = store?.logo_url ? `${store.logo_url}?v=3` : "/favicon.ico";

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
    title: siteTitle,
    description: store?.name ? `Catálogo online de ${store.name}.` : "Catálogo online.",
    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
    },
    openGraph: {
      title: siteTitle,
      description: store?.name ? `Catálogo online de ${store.name}.` : "Catálogo online.",
      type: "website",
      images: store?.logo_url ? [{ url: iconUrl, alt: store.name }] : [],
    },
    twitter: {
      card: "summary",
      title: siteTitle,
      description: store?.name ? `Catálogo online de ${store.name}.` : "Catálogo online.",
      images: store?.logo_url ? [iconUrl] : [],
    },
  };
}

export default function StoreCatalogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
