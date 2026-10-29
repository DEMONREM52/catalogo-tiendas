import type { Metadata } from "next";
import { previewDb, previewImage, previewMetadata, storeAndPoints } from "./link-preview";

/**
 * Vista previa del enlace de un traslado: el seguimiento con firmas (/traslado/<token>) o su guía para imprimir
 * (/traslado/<token>/imprimir). Muestra el logo del punto que despacha, el número y de dónde a dónde va.
 */
export async function transferPreview(token: string, kind: "traslado" | "guia"): Promise<Metadata> {
  const base: Metadata = { title: kind === "guia" ? "Guía de traslado - RemHub" : "Seguimiento de traslado - RemHub", robots: { index: false, follow: false } };
  const db = previewDb();
  if (!db || !/^[A-Za-z0-9-]{16,80}$/.test(token)) return base;
  try {
    const { data } = await db.from("erp_transfers").select("number,store_id,from_warehouse_id,to_warehouse_id").eq("track_token", token).maybeSingle();
    const t = data as { number: number; store_id: string; from_warehouse_id: string; to_warehouse_id: string } | null;
    if (!t) return base;
    const { store, pointName } = await storeAndPoints(db, t.store_id, [t.from_warehouse_id, t.to_warehouse_id]);
    if (!store?.slug) return base;
    const from = pointName(t.from_warehouse_id) ?? "Bodega";
    const to = pointName(t.to_warehouse_id) ?? "Punto";
    const title = `${kind === "guia" ? "Guía de traslado" : "Traslado"} #${t.number} · ${from} → ${to}`;
    const description = kind === "guia"
      ? `Guía del traslado de ${store.name} para imprimir y enviar con la mercancía: productos, cantidades y firmas de quien despacha, lleva y recibe.`
      : `Seguimiento del traslado de ${store.name}: mira en qué paso va y firma tu parte (empacar, enviar, entregar o recibir) desde el celular, sin iniciar sesión.`;
    return previewMetadata({ title, description, image: previewImage(store.slug, { point: t.from_warehouse_id, label: kind }), siteName: store.name });
  } catch {
    return base;
  }
}
