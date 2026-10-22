import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { StorePixel } from "@/components/StorePixel";
import type { StorePixelConfig } from "@/lib/tracking";

/**
 * Configuración pública de medición de la tienda (Píxel de Meta). Nunca rompe la página.
 * Caché compartida de 5 minutos entre todos los servidores (antes era en memoria de cada uno: casi siempre vacía).
 */
const loadStoreTracking = unstable_cache((slug: string) => fetchStoreTracking(slug), ["store-tracking-v1"], { revalidate: 300 });

async function fetchStoreTracking(slug: string): Promise<StorePixelConfig | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.rpc("store_public_tracking", { p_store: decodeURIComponent(slug || "") });
    if (error || !data) return null;
    const cfg = data as StorePixelConfig;
    return cfg.meta_pixel_id ? cfg : null;
  } catch {
    return null;
  }
}

/**
 * Código de verificación de Google Search Console / Bing (20261232) en todas las páginas públicas
 * de la tienda: vitrina, catálogos y productos. Así Google confirma que el dominio es de la tienda.
 */
type Verification = { google: string | null; bing: string | null };
const VERIFICATION_CODE = /^[A-Za-z0-9_-]{10,100}$/;
const loadVerification = unstable_cache(async (slug: string): Promise<Verification | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const { data, error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("store_public_verification", { p_slug: decodeURIComponent(slug || "") });
    return error ? null : ((data as Verification | null) ?? null);
  } catch {
    return null;
  }
}, ["store-public-verification-v1"], { revalidate: 600 });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const v = await loadVerification(slug);
  const google = v?.google && VERIFICATION_CODE.test(v.google) ? v.google : null;
  const bing = v?.bing && VERIFICATION_CODE.test(v.bing) ? v.bing : null;
  if (!google && !bing) return {};
  return { verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } };
}

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tracking = await loadStoreTracking(slug);
  return (
    <>
      <StorePixel config={tracking} />
      {children}
    </>
  );
}
