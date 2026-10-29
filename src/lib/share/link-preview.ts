import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_ORIGIN } from "./origin";

/**
 * Vista previa de los enlaces que se comparten (WhatsApp, Telegram, Facebook…): el logo del punto o de la
 * tienda, con una etiqueta que dice qué es (pedido, remisión, factura electrónica, traslado…), y un título y
 * una descripción que explican para qué sirve. Nunca datos del cliente. Solo en el servidor.
 */

/** Etiquetas que puede llevar la imagen (lista cerrada: la URL nunca trae texto libre). */
export const PREVIEW_LABELS = {
  pedido: "PEDIDO",
  remision: "REMISIÓN",
  factura: "FACTURA DE VENTA",
  factura_electronica: "FACTURA ELECTRÓNICA",
  documento_pos: "DOCUMENTO POS",
  traslado: "TRASLADO",
  guia: "GUÍA DE TRASLADO",
  cotizacion: "COTIZACIÓN",
  pedido_interno: "PEDIDO INTERNO",
  ingreso: "INGRESO DE MERCANCÍA",
  vale: "VALE PARA FIRMAR",
  acceso: "ACCESO DEL EQUIPO",
  instalar: "INSTALA LA APP",
} as const;
export type PreviewLabel = keyof typeof PREVIEW_LABELS;
export const isPreviewLabel = (v: string | null | undefined): v is PreviewLabel => !!v && v in PREVIEW_LABELS;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cliente con la llave de servicio (solo para leer lo mínimo de la vista previa). null sin llaves. */
export function previewDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** Imagen 1200×1200 con el logo (del punto si tiene, si no de la tienda o del catálogo) y la etiqueta. */
export function previewImage(store: string, opts: { point?: string | null; catalog?: string | null; label?: PreviewLabel } = {}) {
  const q = new URLSearchParams({ store });
  if (opts.point && UUID_RE.test(opts.point)) q.set("point", opts.point);
  else if (opts.catalog) q.set("catalog", opts.catalog);
  else q.set("mode", "detal");
  if (opts.label) q.set("label", opts.label);
  q.set("v", "4");
  return `${PRODUCTION_ORIGIN}/api/og?${q.toString()}`;
}

/** Metadatos de un enlace privado o de un documento: no se indexa en Google. */
export function previewMetadata({ title, description, image, siteName }: { title: string; description: string; image: string; siteName: string }): Metadata {
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: "website", title, description, siteName, images: [{ url: image, width: 1200, height: 1200, type: "image/jpeg", alt: siteName }] },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

type Db = NonNullable<ReturnType<typeof previewDb>>;

/** Tienda (nombre y slug) y, si se pide, nombres de puntos por id. */
export async function storeAndPoints(db: Db, storeId: string, pointIds: Array<string | null | undefined> = []) {
  const ids = [...new Set(pointIds.filter((x): x is string => !!x && UUID_RE.test(x)))];
  const [{ data: s }, points] = await Promise.all([
    db.from("stores").select("slug,name").eq("id", storeId).maybeSingle(),
    ids.length ? db.from("erp_warehouses").select("id,name").in("id", ids).eq("store_id", storeId) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const store = s as { slug: string; name: string } | null;
  const names = new Map(((points.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  return { store, pointName: (id: string | null | undefined) => (id ? names.get(id) ?? null : null) };
}

export const money = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
export const ddmmyyyy = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

/** La tienda del dominio donde se abrió la página (lavitrina.remhub.co o su dominio propio), si es de una tienda. */
export async function hostStore(): Promise<{ slug: string; name: string } | null> {
  const { headers } = await import("next/headers");
  const slug = (await headers()).get("x-store-slug");
  const db = previewDb();
  if (!slug || !db || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  try {
    const { data } = await db.from("stores").select("slug,name").eq("slug", slug).maybeSingle();
    return (data as { slug: string; name: string } | null) ?? null;
  } catch {
    return null;
  }
}
