import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Vista previa del enlace del pedido (WhatsApp): el logo del punto del catálogo donde se hizo
 * el pedido, o el de la tienda. Nunca datos del cliente.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Pedido - RemHub", robots: { index: false, follow: false } };
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return base;
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data: o } = await admin.from("orders").select("id,receipt_no,store_id").eq("token", token).maybeSingle();
    const order = o as { id: string; receipt_no: number | null; store_id: string } | null;
    if (!order) return base;
    const [{ data: s }, { data: co }] = await Promise.all([
      admin.from("stores").select("slug,name").eq("id", order.store_id).maybeSingle(),
      admin.from("store_catalog_orders").select("catalog_id").eq("order_id", order.id).maybeSingle(),
    ]);
    const store = s as { slug: string; name: string } | null;
    if (!store?.slug) return base;
    let catalog: string | null = null;
    const catalogId = (co as { catalog_id?: string } | null)?.catalog_id;
    if (catalogId) catalog = ((await admin.from("store_catalogs").select("slug").eq("id", catalogId).maybeSingle()).data as { slug?: string } | null)?.slug ?? null;
    const image = `${PRODUCTION_ORIGIN}/api/og?${new URLSearchParams({ store: store.slug, ...(catalog ? { catalog } : { mode: "detal" }) }).toString()}`;
    const title = `Pedido${order.receipt_no ? ` #${order.receipt_no}` : ""} · ${store.name}`;
    const description = "Comprobante del pedido";
    return {
      ...base,
      title: { absolute: title },
      description,
      openGraph: { type: "website", title, description, images: [{ url: image, width: 1200, height: 1200, alt: store.name }] },
      twitter: { card: "summary", title, description, images: [image] },
    };
  } catch {
    return base;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
