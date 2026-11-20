import type { Metadata } from "next";
import { previewDb, previewImage, storeAndPoints } from "@/lib/share/link-preview";

// Vista previa del enlace (WhatsApp…): logo y nombre de la tienda con «ESTADO DE CUENTA». Nunca el saldo ni el nombre del cliente.
type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false };
  let storeName = "";
  let image: string | undefined;
  const db = /^[a-f0-9]{64}$/.test(token) ? previewDb() : null;
  if (db) {
    const { data: l } = await db.from("erp_statement_links").select("store_id").eq("token", token).maybeSingle();
    const storeId = (l as { store_id?: string } | null)?.store_id;
    if (storeId) {
      const { store } = await storeAndPoints(db, storeId);
      storeName = store?.name ?? "";
      if (store?.slug) image = previewImage(store.slug, { label: "estado_cuenta" });
    }
  }
  const title = storeName ? `Tu estado de cuenta · ${storeName}` : "Estado de cuenta";
  const description = "Mira lo que tienes pendiente, los vencimientos y tus abonos. Puedes imprimirlo o guardarlo en PDF.";
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: { type: "website", title, description, siteName: storeName || "RemHub", images: image ? [{ url: image, width: 1200, height: 1200, alt: storeName }] : undefined },
    twitter: { card: "summary", title, description, images: image ? [image] : undefined },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
