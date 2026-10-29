import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { previewDb, previewImage, storeAndPoints } from "@/lib/share/link-preview";

// Vista previa del enlace (WhatsApp, Telegram…): el logo y el nombre de la tienda, y que es un vale para firmar.
type Props = { params: Promise<{ token: string }> };
type Preview = { ok?: boolean; status?: string; store?: { name: string; logo_url: string | null } | null;
  terms?: { number: number; employee: string; kind: "product" | "cash"; total: number; installments: number; installment: number } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false };
  if (!/^[a-f0-9]{40,80}$/.test(token)) return { title: { absolute: "Firmar vale" }, robots };
  let d: Preview | null = null;
  try {
    const { data } = await supabaseServer().rpc("loan_sign_get", { p_token: token });
    d = (data as Preview | null)?.ok ? (data as Preview) : null;
  } catch {
    d = null;
  }
  if (!d?.terms) return { title: { absolute: "Firmar vale" }, robots };
  const t = d.terms;
  const store = d.store?.name ?? "Tu empresa";
  const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
  const kind = t.kind === "product" ? "Vale de mercancía" : "Vale de préstamo";
  const title = `${kind} #${t.number} para firmar · ${store}`;
  const description = `${t.employee.split(/\s+/)[0]}: revisa el vale por ${money(t.total)} (${t.installments} cuota${t.installments === 1 ? "" : "s"} de ${money(t.installment)} descontadas de la nómina) y fírmalo desde tu celular.`;
  // Imagen: el logo en la tarjeta con «VALE PARA FIRMAR» (el logo suelto, si es transparente, se pierde en blanco).
  let image: string | undefined = d.store?.logo_url || undefined;
  const db = previewDb();
  if (db) {
    const { data: l } = await db.from("erp_employee_loans").select("store_id,point_id").eq("sign_token", token).maybeSingle();
    const loan = l as { store_id?: string; point_id?: string | null } | null;
    const storeId = loan?.store_id;
    const slug = storeId ? (await storeAndPoints(db, storeId)).store?.slug : null;
    if (slug) image = previewImage(slug, { point: loan?.point_id, label: "vale" });
  }
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: { type: "website", title, description, siteName: store, images: image ? [{ url: image, width: 1200, height: 1200, alt: store }] : undefined },
    twitter: { card: "summary", title, description, images: image ? [image] : undefined },
    icons: d.store?.logo_url ? { icon: d.store.logo_url, apple: d.store.logo_url } : undefined,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
