import type { Metadata } from "next";
import { previewDb, previewImage, previewMetadata, storeAndPoints } from "./link-preview";

/**
 * Vista previa del enlace de firmas de un pedido interno (/firma-pedido/<enlace>): logo del punto que despacha,
 * número del pedido y de dónde a dónde va.
 */
export async function signRequestPreview(token: string): Promise<Metadata> {
  const base: Metadata = { title: "Firmas del pedido interno - RemHub", robots: { index: false, follow: false } };
  const db = previewDb();
  if (!db || !/^[0-9a-f]{64}$/.test(token)) return base;
  try {
    const { data: link } = await db.from("erp_sr_sign_links").select("request_id").eq("token", token).maybeSingle();
    if (!link) return base;
    const { data } = await db.from("erp_stock_requests").select("number,store_id,from_point_id,to_point_id").eq("id", (link as { request_id: string }).request_id).maybeSingle();
    const r = data as { number: number; store_id: string; from_point_id: string; to_point_id: string } | null;
    if (!r) return base;
    const { store, pointName } = await storeAndPoints(db, r.store_id, [r.from_point_id, r.to_point_id]);
    if (!store?.slug) return base;
    const from = pointName(r.to_point_id) ?? "Bodega";
    const to = pointName(r.from_point_id) ?? "Punto";
    return previewMetadata({
      title: `✍️ Firmas del pedido interno #${r.number} · ${from} → ${to}`,
      description: `Pedido interno de ${store.name}: mira los productos y firma tu paso (preparó, revisó, lleva o recibe) desde el celular, sin iniciar sesión.`,
      image: previewImage(store.slug, { point: r.to_point_id, label: "pedido_interno" }),
      siteName: store.name,
    });
  } catch {
    return base;
  }
}
