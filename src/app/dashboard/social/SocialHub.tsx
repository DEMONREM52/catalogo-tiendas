"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, LayoutGrid, Megaphone, Rocket } from "lucide-react";
import { SectionTabs, type SectionTab } from "@/components/ui/SectionTabs";
import CatalogsManager from "./catalogs/CatalogsManager";
import SocialDashboard from "./SocialDashboard";
import Link from "next/link";
import { ShareCard } from "./ShareCard";
import { BestSellersSettings } from "./BestSellersSettings";

type Tab = "catalogs" | "campaigns" | "share" | "landing";

const TABS: SectionTab<Tab>[] = [
  { key: "catalogs", label: "Catálogos", hint: "Precios, diseño, productos y contactos", icon: <LayoutGrid />, color: "#8b5cf6" },
  { key: "campaigns", label: "Campañas", hint: "Carrusel y promociones por catálogo", icon: <Megaphone />, color: "#f97316" },
  { key: "share", label: "Imagen para redes", hint: "Historia, publicación o estado con tus productos", icon: <ImageIcon />, color: "#ec4899" },
  { key: "landing", label: "Landing pages", hint: "Una página por producto para tus anuncios", icon: <Rocket />, color: "#f43f5e" },
];

export default function SocialHub() {
  const [tab, setTab] = useState<Tab>("catalogs");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromUrl === "campaigns" || fromUrl === "catalogs" || fromUrl === "share" || fromUrl === "landing") setTab(fromUrl);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="space-y-4">
      {/* Primero las pestañas; la imagen para redes va en su propia pestaña (antes ocupaba toda la parte de arriba). */}
      <SectionTabs items={TABS} value={tab} onChange={choose} layoutId="social-hub-tab" label="RemHub Social" />
      {tab === "catalogs" ? <CatalogsManager /> : tab === "campaigns" ? <><BestSellersSettings /><SocialDashboard /></> : tab === "share" ? <ShareCard /> : (
        <div className="rounded-3xl p-6 text-white" style={{ background: "linear-gradient(135deg, #e11d48, #9333ea 55%, #2563eb)" }}>
          <h2 className="text-2xl font-black">🚀 Landing pages</h2>
          <p className="mt-1 max-w-xl text-sm opacity-90">Tienen su propia administración: cada landing con sus visitas, WhatsApp, pedidos, inversión en pauta y ganancia, aparte del resto de la tienda.</p>
          <Link href="/dashboard/landing" className="mt-4 inline-flex rounded-2xl bg-white px-4 py-2.5 text-sm font-black text-slate-900">Abrir Landing pages →</Link>
        </div>
      )}
    </div>
  );
}
