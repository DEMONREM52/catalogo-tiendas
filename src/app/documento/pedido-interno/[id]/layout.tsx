import type { Metadata } from "next";
import { UUID_RE, previewDb, previewImage, previewMetadata, storeAndPoints } from "@/lib/share/link-preview";

// Vista previa (WhatsApp): «Pedido interno #5 · Sede Zamora le pide a Bodega principal», con el logo del punto que pide.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Pedido interno - RemHub", robots: { index: false, follow: false } };
  const { id } = await params;
  const db = previewDb();
  if (!db || !UUID_RE.test(id)) return base;
  try {
    const { data } = await db.from("erp_stock_requests").select("number,store_id,from_point_id,to_point_id").eq("id", id).maybeSingle();
    const r = data as { number: number; store_id: string; from_point_id: string | null; to_point_id: string | null } | null;
    if (!r) return base;
    const { store, pointName } = await storeAndPoints(db, r.store_id, [r.from_point_id, r.to_point_id]);
    if (!store?.slug) return base;
    const from = pointName(r.from_point_id);
    const to = pointName(r.to_point_id);
    return previewMetadata({
      title: `Pedido interno #${r.number}${from && to ? ` · ${from} le pide a ${to}` : ` · ${store.name}`}`,
      description: `${from && to ? `${from} le pide mercancía a ${to}` : "Pedido de mercancía entre puntos"} (${store.name}). Ábrelo para revisarlo, despacharlo o recibirlo. Solo lo abre el equipo de la tienda.`,
      image: previewImage(store.slug, { point: r.from_point_id, label: "pedido_interno" }),
      siteName: store.name,
    });
  } catch {
    return base;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
