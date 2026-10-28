import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";

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
  const logo = d.store?.logo_url || undefined;
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: { type: "website", title, description, siteName: store, images: logo ? [{ url: logo, width: 512, height: 512, alt: store }] : undefined },
    twitter: { card: "summary", title, description, images: logo ? [logo] : undefined },
    icons: logo ? { icon: logo, apple: logo } : undefined,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
