import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { previewImage } from "@/lib/share/link-preview";
import { OpenOrder } from "./OpenOrder";

/**
 * Enlace de un pedido para el equipo de la tienda (el que llega en el WhatsApp del cliente).
 * La vista previa muestra el logo del punto del catálogo (o el de la tienda), nunca datos del cliente.
 * Al abrirlo lleva a Pedidos con ese número: solo lo ve quien tenga sesión y permiso de pedidos.
 */
type Props = { params: Promise<{ slug: string; n: string }>; searchParams: Promise<{ c?: string }> };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug: raw, n } = await params;
  const { c } = await searchParams;
  const slug = decodeURIComponent(raw).toLowerCase();
  const receipt = /^\d{1,12}$/.test(n) ? n : "";
  const { data } = await supabaseServer().from("stores").select("name").eq("slug", slug).maybeSingle();
  const store = (data as { name?: string } | null)?.name ?? "la tienda";
  const catalog = c && SLUG.test(c) ? c.toLowerCase() : null;
  const image = previewImage(slug, { catalog, label: "pedido" });
  const title = `Pedido${receipt ? ` #${receipt}` : ""} · ${store}`;
  const description = `Pedido nuevo de ${store}: toca para abrirlo en Pedidos, confirmarlo y despacharlo. Solo lo abre el equipo de la tienda.`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: "website", title, description, images: [{ url: image, width: 1200, height: 1200, alt: store }] },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default async function OrderLinkPage({ params }: Props) {
  const { n } = await params;
  return <OpenOrder receipt={/^\d{1,12}$/.test(n) ? n : ""} />;
}
