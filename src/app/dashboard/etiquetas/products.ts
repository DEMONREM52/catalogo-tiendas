"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { mapLimit } from "@/lib/net/map-limit";
import type { ProductForLabel } from "@/lib/labels/data";

export type LabelProduct = ProductForLabel & { active: boolean; image_url: string | null };
export type LabelLine = { product_id: string; qty: number };

/** Los productos para las etiquetas (solo columnas públicas: nunca el costo). */
export async function loadLabelProducts(ids: string[]): Promise<Map<string, LabelProduct>> {
  const sb = supabaseBrowser();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const settled = await mapLimit(chunks, 4, async (chunk) => {
    const { data, error } = await sb.from("products")
      .select("id,name,sku,barcode,product_no,description,category_id,image_url,active,price_1,price_2,price_3,price_4,price_5")
      .in("id", chunk);
    if (error) throw error;
    return data ?? [];
  });
  const bad = settled.find((s) => !s.ok);
  if (bad && !bad.ok) throw bad.error instanceof Error ? bad.error : new Error("No se pudieron cargar los productos.");
  const rows = settled.flatMap((s) => (s.ok ? s.value : [])) as Array<{ id: string; name: string; sku: string | null; barcode: string | null; product_no: number | null; description: string | null; category_id: string | null; image_url: string | null; active: boolean | null; price_1: number; price_2: number; price_3: number; price_4: number; price_5: number }>;
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))] as string[];
  const cats = new Map<string, string>();
  if (catIds.length) {
    const { data } = await sb.from("product_categories").select("id,name").in("id", catIds.slice(0, 500));
    for (const c of (data ?? []) as Array<{ id: string; name: string }>) cats.set(c.id, c.name);
  }
  return new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, sku: r.sku, barcode: r.barcode, product_no: r.product_no, description: r.description,
    category: r.category_id ? cats.get(r.category_id) ?? null : null, image_url: r.image_url, active: r.active !== false,
    prices: [r.price_1, r.price_2, r.price_3, r.price_4, r.price_5].map((v) => Number(v ?? 0)),
  }]));
}

/** Precios del punto (sus reglas, como en su POS). PostgREST corta en 1.000: se pagina. */
export async function loadPointPrices(storeId: string, pointId: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabaseBrowser().rpc("erp_point_prices", { p_store: storeId, p_point: pointId }).range(from, from + 999);
    if (error || !Array.isArray(data)) break;
    for (const r of data as Array<{ product_id: string; price_1: number; price_2: number; price_3: number; price_4: number; price_5: number }>) {
      out.set(r.product_id, [r.price_1, r.price_2, r.price_3, r.price_4, r.price_5].map((v) => Number(v ?? 0)));
    }
    if (data.length < 1000) break;
  }
  return out;
}

/** Productos y unidades de una factura de compra o de un traslado (para etiquetar lo que llegó). */
export async function loadSourceLines(kind: "ingreso" | "traslado", id: string): Promise<{ lines: LabelLine[]; point: string | null; label: string }> {
  const sb = supabaseBrowser();
  if (kind === "traslado") {
    const { data, error } = await sb.from("erp_transfers").select("number,to_warehouse_id,erp_transfer_items(product_id,qty)").eq("id", id).maybeSingle();
    if (error || !data) throw new Error("No se pudo abrir el traslado.");
    const t = data as { number: number; to_warehouse_id: string; erp_transfer_items: LabelLine[] };
    return { lines: merge(t.erp_transfer_items), point: t.to_warehouse_id, label: `Traslado #${t.number}` };
  }
  const { data, error } = await sb.from("erp_purchases").select("number,invoice_ref,erp_purchase_items(product_id,qty)").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("No se pudo abrir la factura de compra.");
  const p = data as { number: number; invoice_ref: string | null; erp_purchase_items: LabelLine[] };
  return { lines: merge(p.erp_purchase_items), point: null, label: `Ingreso #${p.number}${p.invoice_ref ? ` · ${p.invoice_ref}` : ""}` };
}

/** El mismo producto en varias líneas se suma. */
function merge(lines: LabelLine[]): LabelLine[] {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.product_id, (m.get(l.product_id) ?? 0) + Math.max(0, Math.round(Number(l.qty) || 0)));
  return [...m.entries()].filter(([, q]) => q > 0).map(([product_id, qty]) => ({ product_id, qty }));
}
