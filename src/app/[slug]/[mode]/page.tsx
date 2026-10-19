import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import StoreCatalogPage from "./CatalogClient";
import { PAGE_SIZE, loadThemeConfig, type CatalogInitial, type CatalogPayload, type ProductRow } from "./catalog-data";

/**
 * Catálogo público. El servidor trae el catálogo, su tema y los primeros productos y manda la página ya armada:
 * el cliente ve los productos sin esperar a que el navegador haga esas consultas una por una.
 * Precios y existencias se consultan en cada visita (no se guardan en caché).
 * Si la base tarda o falla, la página se arma en el navegador como antes.
 */

const SERVER_WAIT_MS = 2500;

async function loadInitial(slug: string, mode: string, key: string | null): Promise<CatalogInitial | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/i.test(mode) || !slug) return null;
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("catalog_public", { p_store: slug, p_catalog: mode, p_key: key });
  const payload = error ? null : (data as CatalogPayload | null);
  if (payload?.status !== "ok") return null;
  // La tienda cambió de nombre: el navegador corrige la dirección.
  if (payload.store.slug !== slug) return null;
  const [theme, first] = await Promise.all([
    loadThemeConfig(sb, payload.catalog.theme).catch(() => undefined),
    sb.rpc("catalog_public_products", {
      p_store: payload.store.slug, p_catalog: payload.catalog.slug, p_key: key,
      p_category: null, p_q: null, p_limit: PAGE_SIZE, p_offset: 0,
    }),
  ]);
  const products = first.error || !first.data ? null : (first.data as { total: number; items: ProductRow[] });
  return { slug, mode, key, payload, theme: theme ?? null, products };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; mode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug: rawSlug, mode: rawMode }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const slug = decodeURIComponent(rawSlug || "");
  const mode = decodeURIComponent(rawMode || "");
  const key = typeof sp.key === "string" && sp.key ? sp.key : null;
  // En el subdominio o dominio propio de esta tienda los enlaces van sin el nombre.
  const storeHost = Boolean(h.get("x-store-host")) && (h.get("x-store-slug") ?? "").toLowerCase() === slug.toLowerCase();
  const initial = await withTimeout(loadInitial(slug, mode, key), SERVER_WAIT_MS);
  // La clave hace que al cambiar de catálogo la página empiece de cero con sus datos.
  return <StoreCatalogPage key={`${slug}/${mode}/${key ?? ""}`} initial={initial} storeHost={storeHost} />;
}
