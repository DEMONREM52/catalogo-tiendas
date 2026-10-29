import type { Metadata } from "next";
import { previewDb, previewImage, previewMetadata, storeAndPoints, type PreviewLabel } from "@/lib/share/link-preview";

/**
 * Vista previa del enlace del comprobante (WhatsApp): dice qué es (pedido, remisión, factura, factura electrónica
 * o documento POS), con su número, y muestra el logo del punto que vendió (o del catálogo / de la tienda).
 * Nunca datos del cliente.
 */
type Meta = { point_id?: string | null; doc_number?: string | number | null; doc_prefix?: string | null; doc_kind?: string | null };
type Fiscal = { ok?: boolean; full_number?: string | null; document_type?: string | null; status?: string | null } | null;

type DocLabel = Extract<PreviewLabel, "factura_electronica" | "documento_pos" | "factura" | "remision" | "pedido">;

const TEXT: Record<DocLabel, (who: string) => string> = {
  factura_electronica: (who) => `Tu factura electrónica de ${who}, enviada a la DIAN. Ábrela para verla, descargarla o imprimirla.`,
  documento_pos: (who) => `Tu documento equivalente electrónico POS de ${who}. Ábrelo para verlo, descargarlo o imprimirlo.`,
  factura: (who) => `Tu factura de venta de ${who}: productos, total y forma de pago. Ábrela para verla o imprimirla.`,
  remision: (who) => `Tu remisión de ${who}: productos, cantidades y total. Ábrela para verla o imprimirla.`,
  pedido: (who) => `Comprobante de tu pedido en ${who}: productos, total y estado. Ábrelo para seguirlo.`,
};
const NAME: Record<DocLabel, string> = {
  factura_electronica: "Factura electrónica", documento_pos: "Documento POS", factura: "Factura de venta", remision: "Remisión", pedido: "Pedido",
};

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Comprobante - RemHub", robots: { index: false, follow: false } };
  const { token } = await params;
  const db = previewDb();
  if (!db || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return base;
  try {
    const { data: o } = await db.from("orders").select("id,receipt_no,store_id").eq("token", token).maybeSingle();
    const order = o as { id: string; receipt_no: number | null; store_id: string } | null;
    if (!order) return base;
    const [{ data: m }, { data: co }, fiscalRes] = await Promise.all([
      db.from("erp_order_meta").select("*").eq("order_id", order.id).maybeSingle(),
      db.from("store_catalog_orders").select("catalog_id").eq("order_id", order.id).maybeSingle(),
      db.rpc("fiscal_public_receipt", { p_token: token }),
    ]);
    const meta = (m ?? null) as Meta | null;
    const fiscal = (fiscalRes.error ? null : fiscalRes.data) as Fiscal;
    const { store, pointName } = await storeAndPoints(db, order.store_id, [meta?.point_id]);
    if (!store?.slug) return base;

    let catalog: { slug: string; name: string } | null = null;
    const catalogId = (co as { catalog_id?: string } | null)?.catalog_id;
    if (catalogId) catalog = ((await db.from("store_catalogs").select("slug,name").eq("id", catalogId).maybeSingle()).data as { slug: string; name: string } | null) ?? null;

    const label: DocLabel = fiscal?.full_number
      ? fiscal.document_type === "pos_equivalent" ? "documento_pos" : "factura_electronica"
      : meta?.doc_kind === "remision" ? "remision" : meta?.doc_kind === "factura" ? "factura" : "pedido";
    const docNumber = meta?.doc_number ? `${meta.doc_prefix ?? ""}${meta.doc_number}` : null;
    const number = fiscal?.full_number || (label === "pedido" ? (order.receipt_no ? `#${order.receipt_no}` : null) : docNumber ?? (order.receipt_no ? `#${order.receipt_no}` : null));
    const point = pointName(meta?.point_id);
    const who = point ?? catalog?.name ?? store.name;
    const title = `${NAME[label]}${number ? ` ${number}` : ""} · ${who}`;
    const image = previewImage(store.slug, { point: meta?.point_id, catalog: point ? null : catalog?.slug, label });
    return previewMetadata({ title, description: TEXT[label](who), image, siteName: store.name });
  } catch {
    return base;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
