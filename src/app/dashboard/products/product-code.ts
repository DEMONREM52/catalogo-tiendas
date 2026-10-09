import { supabaseBrowser } from "@/lib/supabase/client";

/** Código del producto como se guarda: sin espacios a los lados y en mayúscula (vacío = usa el número interno). */
export function cleanProductCode(value: string | null | undefined) {
  const code = (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return code ? code.slice(0, 40) : null;
}

/** Código, código de barras y número interno de un producto (sin fallar si falta la migración). */
export async function loadProductCodes(productId: string): Promise<{ sku: string | null; barcode: string | null; product_no: number | null }> {
  const sb = supabaseBrowser();
  const full = await sb.from("products").select("sku,barcode,product_no").eq("id", productId).maybeSingle();
  if (!full.error) {
    const row = full.data as { sku: string | null; barcode: string | null; product_no: number | null } | null;
    return { sku: row?.sku ?? null, barcode: row?.barcode ?? null, product_no: row?.product_no ?? null };
  }
  const basic = await sb.from("products").select("sku,barcode").eq("id", productId).maybeSingle();
  const row = basic.data as { sku: string | null; barcode: string | null } | null;
  return { sku: row?.sku ?? null, barcode: row?.barcode ?? null, product_no: null };
}

/** Lanza un error claro si otro producto de la tienda ya usa ese código. */
export async function checkProductCode(storeId: string, code: string | null, exceptId?: string) {
  if (!code) return;
  let query = supabaseBrowser()
    .from("products")
    .select("id,name")
    .eq("store_id", storeId)
    .ilike("sku", code.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1);
  if (exceptId) query = query.neq("id", exceptId);
  const { data } = await query;
  const other = (data ?? [])[0] as { id: string; name: string } | undefined;
  if (other) throw new Error(`El código ${code} ya lo tiene «${other.name}». Usa otro código o déjalo vacío para usar el número interno.`);
}
