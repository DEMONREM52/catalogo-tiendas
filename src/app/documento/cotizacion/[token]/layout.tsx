import type { Metadata } from "next";
import { ddmmyyyy, money, previewDb, previewImage, previewMetadata, storeAndPoints } from "@/lib/share/link-preview";

// Vista previa (WhatsApp): «Cotización #7 · Sede San Roque», con el total, la vigencia y el logo del punto.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Cotización - RemHub", robots: { index: false, follow: false } };
  const { token } = await params;
  const db = previewDb();
  if (!db || !/^[A-Za-z0-9_-]{8,80}$/.test(token)) return base;
  try {
    const { data } = await db.from("erp_quotes").select("number,store_id,point_id,total,valid_until").eq("token", token).maybeSingle();
    const q = data as { number: number; store_id: string; point_id: string | null; total: number; valid_until: string | null } | null;
    if (!q) return base;
    const { store, pointName } = await storeAndPoints(db, q.store_id, [q.point_id]);
    if (!store?.slug) return base;
    const who = pointName(q.point_id) ?? store.name;
    const until = ddmmyyyy(q.valid_until);
    return previewMetadata({
      title: `Cotización #${q.number} · ${who}`,
      description: `Cotización de ${who} por ${money(q.total)}${until ? `, válida hasta el ${until}` : ""}. Ábrela para ver los productos, las cantidades y los precios.`,
      image: previewImage(store.slug, { point: q.point_id, label: "cotizacion" }),
      siteName: store.name,
    });
  } catch {
    return base;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
