import { createClient } from "@supabase/supabase-js";
import { StorePixel } from "@/components/StorePixel";
import type { StorePixelConfig } from "@/lib/tracking";

// Caché corta en memoria del servidor: evita consultar Supabase en cada visita.
const cache = new Map<string, { at: number; value: StorePixelConfig | null }>();
const TTL_MS = 60_000;

/** Configuración pública de medición de la tienda (Píxel de Meta). Nunca rompe la página. */
async function loadStoreTracking(slug: string): Promise<StorePixelConfig | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fetchStoreTracking(slug);
  if (cache.size > 500) cache.clear();
  cache.set(slug, { at: Date.now(), value });
  return value;
}

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
