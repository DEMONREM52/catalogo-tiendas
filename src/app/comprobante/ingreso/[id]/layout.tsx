import type { Metadata } from "next";
import { UUID_RE, previewDb, previewImage, previewMetadata, storeAndPoints } from "@/lib/share/link-preview";

// Vista previa (WhatsApp): «Ingreso de mercancía #12 · Bodega principal», con el logo de la bodega que recibió.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Comprobante de ingreso - RemHub", robots: { index: false, follow: false } };
  const { id } = await params;
  const db = previewDb();
  if (!db || !UUID_RE.test(id)) return base;
  try {
    const { data } = await db.from("erp_purchases").select("number,store_id,warehouse_id").eq("id", id).maybeSingle();
    const p = data as { number: number; store_id: string; warehouse_id: string } | null;
    if (!p) return base;
    const { store, pointName } = await storeAndPoints(db, p.store_id, [p.warehouse_id]);
    if (!store?.slug) return base;
    const where = pointName(p.warehouse_id) ?? store.name;
    return previewMetadata({
      title: `Ingreso de mercancía #${p.number} · ${where}`,
      description: `Comprobante de la mercancía que entró a ${where} (${store.name}): productos, cantidades y costos de la factura del proveedor. Solo lo abre el equipo de la tienda.`,
      image: previewImage(store.slug, { point: p.warehouse_id, label: "ingreso" }),
      siteName: store.name,
    });
  } catch {
    return base;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
