"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, Megaphone } from "lucide-react";
import CatalogsManager from "./catalogs/CatalogsManager";
import SocialDashboard from "./SocialDashboard";

type Tab = "catalogs" | "campaigns";

const TABS: Array<{ key: Tab; label: string; hint: string; icon: React.ReactNode }> = [
  { key: "catalogs", label: "Catálogos", hint: "Precios, diseño, productos y contactos", icon: <LayoutGrid size={16} /> },
  { key: "campaigns", label: "Campañas", hint: "Carrusel y promociones por catálogo", icon: <Megaphone size={16} /> },
];

export default function SocialHub() {
  const [tab, setTab] = useState<Tab>("catalogs");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromUrl === "campaigns" || fromUrl === "catalogs") setTab(fromUrl);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="space-y-4">
      <nav className="grid gap-2 sm:grid-cols-2 lg:max-w-2xl" aria-label="RemHub Social">
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
      {tab === "catalogs" ? <CatalogsManager /> : <SocialDashboard />}
    </div>
  );
}
