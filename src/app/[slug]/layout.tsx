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
