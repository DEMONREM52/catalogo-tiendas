import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";

// Vista previa del enlace (WhatsApp…): la tienda y que es una liquidación para firmar. Nunca se indexa.
type Props = { params: Promise<{ token: string }> };
type Preview = { ok?: boolean; store?: { name: string; logo_url: string | null } | null; terms?: { number: number; point: string | null } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false };
  if (!/^[a-f0-9]{40,80}$/.test(token)) return { title: { absolute: "Firmar liquidación" }, robots };
  let d: Preview | null = null;
  try {
    const { data } = await supabaseServer().rpc("settlement_sign_get", { p_token: token });
    d = (data as Preview | null)?.ok ? (data as Preview) : null;
  } catch {
    d = null;
  }
  if (!d?.terms) return { title: { absolute: "Firmar liquidación" }, robots };
  const store = d.store?.name ?? "Tu empresa";
  const title = `Liquidación #${d.terms.number}${d.terms.point ? ` · ${d.terms.point}` : ""} para firmar · ${store}`;
  const description = "Revisa lo que le corresponde a cada beneficiario y firma desde tu celular.";
  const image = d.store?.logo_url || undefined;
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: { type: "website", title, description, siteName: store, images: image ? [{ url: image, alt: store }] : undefined },
    icons: image ? { icon: image, apple: image } : undefined,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
