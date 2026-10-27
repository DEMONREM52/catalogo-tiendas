"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, Megaphone, Rocket } from "lucide-react";
import CatalogsManager from "./catalogs/CatalogsManager";
import SocialDashboard from "./SocialDashboard";
import Link from "next/link";
import { ShareCard } from "./ShareCard";

type Tab = "catalogs" | "campaigns" | "landing";

const TABS: Array<{ key: Tab; label: string; hint: string; icon: React.ReactNode }> = [
  { key: "catalogs", label: "Catálogos", hint: "Precios, diseño, productos y contactos", icon: <LayoutGrid size={16} /> },
  { key: "campaigns", label: "Campañas", hint: "Carrusel y promociones por catálogo", icon: <Megaphone size={16} /> },
  { key: "landing", label: "Landing pages", hint: "Una página por producto para tus anuncios", icon: <Rocket size={16} /> },
];

export default function SocialHub() {
  const [tab, setTab] = useState<Tab>("catalogs");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromUrl === "campaigns" || fromUrl === "catalogs" || fromUrl === "landing") setTab(fromUrl);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="space-y-4">
      <ShareCard />
      <nav className="grid gap-2 sm:grid-cols-3 lg:max-w-4xl" aria-label="RemHub Social">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => choose(t.key)}
              className="relative flex items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left transition"
              style={{ borderColor: active ? "transparent" : "var(--t-card-border)", color: active ? "#fff" : "var(--t-text)" }}
              aria-pressed={active}
            >
              {active ? <motion.span layoutId="social-hub-tab" className="absolute inset-0" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 380, damping: 32 }} /> : null}
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: active ? "rgba(255,255,255,0.18)" : "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>
                {t.icon}
              </span>
              <span className="relative min-w-0">
                <span className="block text-sm font-bold">{t.label}</span>
                <span className="block truncate text-xs" style={{ opacity: 0.8 }}>{t.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>
      {tab === "catalogs" ? <CatalogsManager /> : tab === "campaigns" ? <SocialDashboard /> : (
        <div className="rounded-3xl p-6 text-white" style={{ background: "linear-gradient(135deg, #e11d48, #9333ea 55%, #2563eb)" }}>
          <h2 className="text-2xl font-black">🚀 Landing pages</h2>
          <p className="mt-1 max-w-xl text-sm opacity-90">Tienen su propia administración: cada landing con sus visitas, WhatsApp, pedidos, inversión en pauta y ganancia, aparte del resto de la tienda.</p>
          <Link href="/dashboard/landing" className="mt-4 inline-flex rounded-2xl bg-white px-4 py-2.5 text-sm font-black text-slate-900">Abrir Landing pages →</Link>
        </div>
      )}
    </div>
  );
}
