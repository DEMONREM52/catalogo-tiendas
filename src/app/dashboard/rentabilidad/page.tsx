"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Calculator, HandCoins, ShieldCheck, Store, Tags, TrendingUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { Simulator } from "./Simulator";
import { Summary } from "./Summary";
import { PointRules, type ProfitSettings } from "./PointRules";
import { Settlements } from "./Settlements";
import { PriceLimits } from "./PriceLimits";
import { PointsBoard } from "./PointsBoard";
import { cardStyle, rpcError, type Point } from "./shared";

type Tab = "summary" | "points" | "rules" | "limits" | "settle" | "sim";

/** Centro de rentabilidad: informe, precios por punto y simulador. */
export default function RentabilidadPage() {
  const [ready, setReady] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [perm, setPerm] = useState({ view: false, rules: false, approve: false, settle: false, price: false });
  const [points, setPoints] = useState<Point[]>([]);
  const [settings, setSettings] = useState<ProfitSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const loadSettings = useCallback(async (store: string) => {
    const { data, error } = await supabaseBrowser().rpc("erp_profit_settings_get", { p_store: store });
    if (error) return setSettingsError(rpcError(error));
    setSettingsError(null);
    setSettings(data as ProfitSettings);
  }, []);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const store = access?.store;
      if (!store) return setReady(true);
      const can = (p: string) => hasStorePermission(access, p);
      setPerm({ view: can("profit_view"), rules: can("profit_rules"), approve: can("profit_approve"), settle: ["profit_beneficiaries", "profit_settle", "profit_settle_approve", "profit_pay"].some(can), price: can("price_approve") });
      setStoreId(store.id);
      const { data: wh } = await supabaseBrowser().from("erp_warehouses").select("id,name").eq("store_id", store.id).eq("active", true).order("name");
      setPoints((wh ?? []) as Point[]);
      await loadSettings(store.id);
      setReady(true);
    })();
  }, [loadSettings]);

  if (!ready) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</main>;
  const canCosts = perm.view || perm.approve;
  if (!storeId || !(perm.view || perm.rules || perm.approve || perm.settle || perm.price)) {
    return (
      <main className="p-6">
        <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>🔒 Necesitas un permiso de <b>Rentabilidad</b>. Pídeselo al administrador de tu tienda.</p>
      </main>
    );
  }

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; show: boolean }> = [
    { key: "summary", label: "Resumen", icon: <BarChart3 size={15} />, show: perm.view },
    { key: "points", label: "Puntos", icon: <Store size={15} />, show: perm.view },
    { key: "rules", label: "Precios por punto", icon: <Tags size={15} />, show: perm.view || perm.rules || perm.approve },
    { key: "limits", label: "Límites de precio", icon: <ShieldCheck size={15} />, show: perm.view || perm.rules || perm.price },
    { key: "settle", label: "Repartos y liquidaciones", icon: <HandCoins size={15} />, show: perm.settle || perm.view },
    { key: "sim", label: "Simulador", icon: <Calculator size={15} />, show: canCosts },
  ];
  const current: Tab = tab ?? (perm.view ? "summary" : perm.rules || perm.approve ? "rules" : perm.price ? "limits" : "settle");

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#3987e5,#d95926)" }}>
          <TrendingUp size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black">Rentabilidad</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Costos, ganancias y precios de cada punto, con la madre en control.</p>
        </div>
      </header>

      <nav className="flex w-full gap-1 overflow-x-auto rounded-full border p-1 text-sm font-bold [scrollbar-width:none] sm:w-fit" style={{ borderColor: "var(--t-card-border)" }}>
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className="inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 transition" style={current === t.key ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      {current === "summary" && perm.view ? <Summary storeId={storeId} points={points} myPoints={settings?.my_points ?? null} /> : null}
      {current === "points" && perm.view ? <PointsBoard storeId={storeId} /> : null}
      {current === "rules" ? (
        settings ? (
          <PointRules storeId={storeId} points={points} settings={settings} onSettings={() => void loadSettings(storeId)} />
        ) : (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{settingsError ?? "Cargando…"}</p>
        )
      ) : null}
      {current === "limits" ? <PriceLimits storeId={storeId} /> : null}
      {current === "settle" ? <Settlements storeId={storeId} points={points} myPoints={settings?.my_points ?? null} /> : null}
      {current === "sim" && canCosts ? <Simulator storeId={storeId} /> : null}
    </main>
  );
}
