import type { Metadata } from "next";
import StaffLogin from "@/components/StaffLogin";
import { previewDb, previewImage, previewMetadata } from "@/lib/share/link-preview";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * El enlace de acceso del equipo se instala como app con este mismo enlace (Android y iPhone).
 * Vista previa (WhatsApp): «Acceso del equipo · La Vitrina», con el logo de la tienda.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const q = await searchParams;
  const start = new URLSearchParams();
  for (const k of ["sid", "usuario", "next"]) if (one(q[k])) start.set(k, one(q[k]));
  const app = {
    manifest: `/manifest.webmanifest?start=${encodeURIComponent(`/acceso/${slug}?${start.toString()}`)}`,
    appleWebApp: { capable: true, title: "RemHub", statusBarStyle: "default" as const },
  };
  const db = previewDb();
  const clean = decodeURIComponent(slug).toLowerCase();
  if (!db || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(clean)) return app;
  try {
    const { data } = await db.from("stores").select("slug,name").eq("slug", clean).maybeSingle();
    const store = data as { slug: string; name: string } | null;
    if (!store) return app;
    return {
      ...previewMetadata({
        title: `Acceso del equipo · ${store.name}`,
        description: `Enlace para que el equipo de ${store.name} entre con su usuario y contraseña: ventas, inventario y pedidos según los permisos de cada uno. Se puede instalar como app.`,
        image: previewImage(store.slug, { label: "acceso" }),
        siteName: store.name,
      }),
      ...app,
    };
  } catch {
    return app;
  }
}

export default async function StoreAccessPage({ params }: Props) {
  const { slug } = await params;
  return <StaffLogin storeSlug={slug} />;
}
