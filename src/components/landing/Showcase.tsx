"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeSpaceOrigin } from "@/lib/share/store-host";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * «Tiendas que ya venden con RemHub»: logos reales de las tiendas que el admin marcó (saas_public_showcase).
 * Sin tiendas marcadas (o sin la migración 20261215) no se muestra nada: nunca se inventan clientes.
 */
type Shop = { name: string; slug: string; logo_url: string | null };

export function Showcase() {
  const [shops, setShops] = useState<Shop[]>([]);
  useEffect(() => {
    void supabaseBrowser().rpc("saas_public_showcase").then(({ data, error }) => { if (!error) setShops((data ?? []) as Shop[]); });
  }, []);
  if (!shops.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-5 pb-16">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>Tiendas que ya venden con RemHub</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {shops.map((s) => (
          <a key={s.slug} href={`${storeSpaceOrigin(s.slug) ?? `${PRODUCTION_ORIGIN}/${s.slug}`}/`} target="_blank" rel="noopener"
            className="group flex items-center gap-2.5 rounded-2xl border px-3 py-2 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            {s.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logo_url} alt="" loading="lazy" className="h-9 w-9 rounded-xl object-cover" />
            ) : <span className="grid h-9 w-9 place-items-center rounded-xl text-lg" style={{ background: "var(--t-card-bg-soft)" }}>🏪</span>}
            <span className="text-sm font-bold">{s.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
