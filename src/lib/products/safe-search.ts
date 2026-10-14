import { supabaseBrowser } from "@/lib/supabase/client";

/** Columnas que cualquier usuario de la tienda puede leer (nunca el costo, que está protegido). */
export const SAFE_PRODUCT_COLUMNS =
  "id,store_id,created_at,name,description,sku,barcode,product_no,price_retail,price_wholesale,price_1,price_2,price_3,price_4,price_5,min_wholesale,stock,active,image_url,category_id";

/** El error es de permisos (costo protegido) o de una función que no existe todavía. */
export const isPermissionOrMissing = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (/permission denied|Could not find the function|schema cache|does not exist/i.test(e.message ?? "") || e.code === "42501");

/**
 * Búsqueda directa por nombre, código o código de barras, solo con columnas permitidas.
 * Respaldo para cuando el buscador avanzado falla por el costo protegido.
 */
export async function searchProductsDirect(storeId: string, q: string, opts: { limit?: number; offset?: number; status?: string; categoryId?: string | null; activeOnly?: boolean } = {}) {
  const { limit = 50, offset = 0, status = "all", categoryId = null, activeOnly = false } = opts;
  const sb = supabaseBrowser();
  const run = (cols: string) => {
    let query = sb.from("products").select(cols).eq("store_id", storeId);
    // Sin comas ni paréntesis: rompen el filtro «or» de la API.
    const words = q.replace(/[,()*%\\]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const w of words) {
      const or = [`name.ilike.*${w}*`, `sku.ilike.*${w}*`, `barcode.eq.${w}`];
      if (cols.includes("product_no") && /^\d{1,9}$/.test(w)) or.push(`product_no.eq.${w}`);
      query = query.or(or.join(","));
    }
    if (activeOnly || status === "active") query = query.eq("active", true);
    else if (status === "inactive") query = query.eq("active", false);
    if (categoryId) query = query.eq("category_id", categoryId);
    return query.order("name").range(offset, offset + limit - 1);
  };
  let res = await run(SAFE_PRODUCT_COLUMNS);
  if (res.error && /product_no|permission denied/i.test(res.error.message)) res = await run(SAFE_PRODUCT_COLUMNS.replace(",product_no", ""));
  if (res.error) throw res.error;
  return (res.data ?? []) as unknown as Array<Record<string, unknown>>;
}
