import type { Metadata } from "next";
import StaffLogin from "@/components/StaffLogin";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** El enlace de acceso del equipo se instala como app con este mismo enlace (Android y iPhone). */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const q = await searchParams;
  const start = new URLSearchParams();
  for (const k of ["sid", "usuario", "next"]) if (one(q[k])) start.set(k, one(q[k]));
  return {
    manifest: `/manifest.webmanifest?start=${encodeURIComponent(`/acceso/${slug}?${start.toString()}`)}`,
    appleWebApp: { capable: true, title: "RemHub", statusBarStyle: "default" },
  };
}

export default async function StoreAccessPage({ params }: Props) {
  const { slug } = await params;
  return <StaffLogin storeSlug={slug} />;
}
