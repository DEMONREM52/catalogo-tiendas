import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";

type Paused = { name: string; slug: string; logo_url: string | null; whatsapp: string | null };

export const metadata: Metadata = { title: "Tienda en pausa · RemHub", robots: { index: false, follow: false } };

const isSafe = (u: string | null | undefined): u is string => Boolean(u) && /^https:\/\//i.test(String(u));

/** Lo que ve un cliente cuando la tienda está pausada (en vez de un error). */
export default async function PausedStorePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  let store: Paused | null = null;
  if (s) {
    const { data } = await supabaseServer().rpc("store_public_paused", { p_slug: s });
    store = (data as Paused | null) ?? null;
  }
  const wa = (store?.whatsapp ?? "").replace(/\D/g, "");
  return (
    <main className="grid min-h-screen place-items-center px-4" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      <div className="w-full max-w-md rounded-3xl border p-8 text-center" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        {isSafe(store?.logo_url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logo_url} alt={store.name} className="mx-auto h-24 w-24 rounded-3xl object-cover shadow-xl" />
        ) : <span className="mx-auto grid h-24 w-24 place-items-center rounded-3xl text-4xl" style={{ background: "var(--t-card-bg-soft)" }}>🏪</span>}
        <h1 className="mt-4 text-2xl font-black">{store?.name ?? "Tienda en pausa"}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
          Por ahora este catálogo no está disponible. Vuelve pronto{wa ? " o escríbenos" : ""}.
        </p>
        {wa ? (
          <a href={`https://wa.me/${wa.length === 10 ? `57${wa}` : wa}`} target="_blank" rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white" style={{ background: "#22c55e" }}>
            💬 Escríbenos por WhatsApp
          </a>
        ) : null}
        <p className="mt-8 text-[11px]" style={{ color: "var(--t-muted)" }}>Hecho con RemHub</p>
      </div>
    </main>
  );
}
