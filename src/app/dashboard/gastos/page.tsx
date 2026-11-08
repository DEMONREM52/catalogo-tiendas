"use client";

import { useCallback, useEffect, useState } from "react";
import { useUrlTab } from "@/lib/url-intent";
import { HandCoins, LayoutDashboard, PiggyBank, Receipt, Repeat, Target, Users, Wallet } from "lucide-react";
import { SectionTabs, type SectionTab } from "@/components/ui/SectionTabs";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { Overview } from "./Overview";
import { Expenses } from "./Expenses";
import { BudgetsTab, RecurringTab, ReservesTab } from "./Planning";
import { PayrollTab } from "./Payroll";
import { LoansTab } from "./Loans";
import { cardStyle, rpcError, type Catalog, type Point } from "./shared";
import { SkeletonDashboard } from "@/components/ui/Skeleton";

type Tab = "overview" | "expenses" | "recurring" | "budgets" | "payroll" | "loans" | "reserves";

/** Gastos y nómina: egresos, gastos fijos, presupuestos, nómina y reservas de la madre y sus puntos. */
export default function GastosPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useUrlTab<Tab>(["overview", "expenses", "recurring", "budgets", "payroll", "loans", "reserves"], "overview");
  const [openExpense, setOpenExpense] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const loadCatalog = useCallback(async (store: string) => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_finance_catalog", { p_store: store });
    if (e) return setError(rpcError(e));
    setError(null);
    setCat(data as Catalog);
  }, []);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const store = access?.store;
      if (!store) return setReady(true);
      setStoreId(store.id);
      const sb = supabaseBrowser();
      const [{ data: wh }, setup] = await Promise.all([
        sb.from("erp_warehouses").select("id,name").eq("store_id", store.id).eq("active", true).order("name"),
        // Crea categorías y conceptos por defecto y genera los gastos fijos que tocan (una sola vez cada uno).
        sb.rpc("erp_finance_setup", { p_store: store.id }),
      ]);
      setPoints((wh ?? []) as Point[]);
      if (setup.error) setError(rpcError(setup.error));
      await loadCatalog(store.id);
      setReady(true);
    })();
  }, [loadCatalog]);

  const changed = useCallback(() => {
    if (storeId) void loadCatalog(storeId);
    setRefresh((x) => x + 1);
  }, [storeId, loadCatalog]);

  if (!ready) return <main className="p-4 sm:p-6"><SkeletonDashboard label="Cargando…" /></main>;
  if (!storeId || !cat) {
    return (
      <main className="p-6">
        <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>{error ?? "🔒 Necesitas un permiso de Gastos y nómina. Pídeselo al administrador de tu tienda."}</p>
      </main>
    );
  }
  const can = cat.can;
  const payroll = can.payroll || can.payroll_approve || can.payroll_pay;
  const tabs: SectionTab<Tab>[] = [
    { key: "overview", label: "Resumen", hint: "Cómo vas este mes", icon: <LayoutDashboard />, color: "#8b5cf6" },
    { key: "expenses", label: "Gastos", hint: "Lo que sale y lo que falta pagar", icon: <Receipt />, color: "#f43f5e", hidden: !(can.expenses || can.pay) },
    { key: "recurring", label: "Gastos fijos", hint: "Arriendo, servicios, cada mes", icon: <Repeat />, color: "#f97316", hidden: !(can.expenses || can.budgets) },
    { key: "budgets", label: "Presupuestos", hint: "Topes por categoría", icon: <Target />, color: "#0ea5e9", hidden: !(can.budgets || can.expenses) },
    { key: "payroll", label: "Nómina", hint: "Empleados y pagos", icon: <Users />, color: "#10b981", hidden: !payroll },
    { key: "loans", label: "Vales y préstamos", hint: "Adelantos al equipo", icon: <HandCoins />, color: "#f59e0b", hidden: !payroll },
    { key: "reserves", label: "Reservas", hint: "Ahorro para lo que viene", icon: <PiggyBank />, color: "#ec4899", hidden: !can.budgets },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#d95926,#8b5cf6)" }}><Wallet size={20} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black">Gastos y nómina</h1>
          <p className="hidden sm:block text-sm" style={{ color: "var(--t-muted)" }}>Lo que sale, lo que falta pagar, presupuestos, nómina y reservas{can.madre ? " de la madre y sus puntos" : " de tu punto"}.</p>
        </div>
      </header>
      <SectionTabs items={tabs} value={tab} onChange={setTab} layoutId="gastos-tabs" label="Secciones de gastos y nómina" />
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}

      {tab === "overview" ? <Overview key={refresh} storeId={storeId} points={points} cat={cat} onOpenExpense={(id) => { setTab("expenses"); setOpenExpense(id); }} /> : null}
      {tab === "expenses" ? <Expenses storeId={storeId} points={points} cat={cat} openId={openExpense} onOpen={setOpenExpense} onChanged={changed} /> : null}
      {tab === "recurring" ? <RecurringTab storeId={storeId} points={points} cat={cat} onChanged={changed} /> : null}
      {tab === "budgets" ? <BudgetsTab key={refresh} storeId={storeId} points={points} cat={cat} onChanged={changed} /> : null}
      {tab === "payroll" ? <PayrollTab storeId={storeId} points={points} cat={cat} onChanged={changed} /> : null}
      {tab === "loans" ? <LoansTab storeId={storeId} points={points} cat={cat} onChanged={changed} /> : null}
      {tab === "reserves" ? <ReservesTab storeId={storeId} points={points} cat={cat} onChanged={changed} /> : null}
    </main>
  );
}
