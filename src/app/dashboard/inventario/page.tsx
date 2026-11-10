"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { URL_CHANGE_EVENT } from "@/lib/url-intent";
import { BadgeDollarSign, BarChart3, BookOpen, Boxes, CalendarClock, Factory, FileText, Handshake, Hourglass, PackageSearch, Receipt, ShieldCheck, Truck, Warehouse as WarehouseIcon, Wrench, ScanLine } from "lucide-react";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { OverviewTab, WarehousesTab } from "./StockTabs";
import { Empty, WAREHOUSE_COLUMNS, errorMessage, type ErpCtx, type Warehouse } from "./shared";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useFeature } from "@/lib/useFeature";
import nextDynamic from "next/dynamic";

// Cada pestaña se descarga al abrirla (antes bajaban todas juntas, ~350 KB): Inventario abre mucho más rápido.
const tabLoading = () => <SkeletonList rows={5} avatar={false} label="Cargando…" />;
const StockBrowser = nextDynamic(() => import("./StockBrowser").then((m) => m.StockBrowser), { loading: tabLoading });
const TransfersTab = nextDynamic(() => import("./TransfersTab").then((m) => m.TransfersTab), { loading: tabLoading });
const AdjustmentsTab = nextDynamic(() => import("./OperationsTabs").then((m) => m.AdjustmentsTab), { loading: tabLoading });
const KardexTab = nextDynamic(() => import("./OperationsTabs").then((m) => m.KardexTab), { loading: tabLoading });
const AuditTab = nextDynamic(() => import("./OperationsTabs").then((m) => m.AuditTab), { loading: tabLoading });
const CountsTab = nextDynamic(() => import("./CountsTab").then((m) => m.CountsTab), { loading: tabLoading });
const StaleStockTab = nextDynamic(() => import("./StaleStock").then((m) => m.StaleStockTab), { loading: tabLoading });
const ExpiryTab = nextDynamic(() => import("./InventoryExtras").then((m) => m.ExpiryTab), { loading: tabLoading });
const PurchasesTab = nextDynamic(() => import("./PurchasesTabs").then((m) => m.PurchasesTab), { loading: tabLoading });
const SuppliersTab = nextDynamic(() => import("./PurchasesTabs").then((m) => m.SuppliersTab), { loading: tabLoading });
const PayablesTab = nextDynamic(() => import("./Payables").then((m) => m.PayablesTab), { loading: tabLoading });
const InternalCreditTab = nextDynamic(() => import("./InternalCredit").then((m) => m.InternalCreditTab), { loading: tabLoading });
const ManifestsTab = nextDynamic(() => import("./ManifestsUI").then((m) => m.ManifestsTab), { loading: tabLoading });

type TabKey = "overview" | "stock" | "warehouses" | "transfers" | "adjustments" | "kardex" | "purchases" | "suppliers" | "payables" | "internal" | "manifests" | "audit" | "stale" | "expiry" | "conteos";

const TABS: Array<{ key: TabKey; icon: ReactNode; color: string; label: string; permissions: string[] }> = [
  { key: "overview", icon: <BarChart3 />, color: "#8b5cf6", label: "Resumen", permissions: ["inventory", "purchases", "payables"] },
  { key: "stock", icon: <Boxes />, color: "#0ea5e9", label: "Existencias", permissions: ["inventory"] },
  { key: "warehouses", icon: <WarehouseIcon />, color: "#6366f1", label: "Puntos y bodegas", permissions: ["inventory"] },
  { key: "transfers", icon: <Truck />, color: "#f97316", label: "Traslados", permissions: ["transfers", "inventory"] },
  { key: "adjustments", icon: <Wrench />, color: "#f59e0b", label: "Ajustes", permissions: ["inventory_adjust", "inventory"] },
  { key: "conteos", icon: <ScanLine />, color: "#14b8a6", label: "Conteos", permissions: ["inventory", "inventory_adjust"] },
  { key: "kardex", icon: <BookOpen />, color: "#14b8a6", label: "Kardex", permissions: ["inventory"] },
  { key: "stale", icon: <Hourglass />, color: "#64748b", label: "Sin movimiento", permissions: ["inventory", "reports"] },
  { key: "expiry", icon: <CalendarClock />, color: "#f43f5e", label: "Vencimientos", permissions: ["inventory", "purchases", "products"] },
  { key: "purchases", icon: <Receipt />, color: "#10b981", label: "Ingreso de factura", permissions: ["purchases"] },
  { key: "suppliers", icon: <Factory />, color: "#0ea5e9", label: "Proveedores", permissions: ["suppliers", "purchases"] },
  { key: "payables", icon: <BadgeDollarSign />, color: "#f43f5e", label: "Cuentas por pagar", permissions: ["payables"] },
  { key: "internal", icon: <Handshake />, color: "#8b5cf6", label: "Cuenta con puntos", permissions: ["internal_credit", "internal_credit_manage"] },
  { key: "manifests", icon: <FileText />, color: "#6366f1", label: "Manifiestos", permissions: ["inventory", "purchases"] },
  { key: "audit", icon: <ShieldCheck />, color: "#14b8a6", label: "Auditoría", permissions: ["audit"] },
];

// Las pestañas se agrupan en secciones: primero se elige la sección y debajo salen solo sus pestañas.
type GroupKey = "stock" | "buy" | "control";
const GROUPS: Array<{ key: GroupKey; icon: ReactNode; color: string; label: string; hint: string; tabs: TabKey[] }> = [
  { key: "stock", icon: <Boxes />, color: "#0ea5e9", label: "Inventario", hint: "Existencias, bodegas, traslados y ajustes", tabs: ["overview", "stock", "warehouses", "transfers", "adjustments", "conteos", "kardex"] },
  { key: "buy", icon: <Receipt />, color: "#10b981", label: "Compras y pagos", hint: "Facturas de compra, proveedores y lo que se debe", tabs: ["purchases", "suppliers", "payables", "internal"] },
  { key: "control", icon: <PackageSearch />, color: "#f59e0b", label: "Control", hint: "Lo quieto, lo que vence, manifiestos y auditoría", tabs: ["stale", "expiry", "manifests", "audit"] },
];
const groupOf = (k: TabKey) => GROUPS.find((g) => g.tabs.includes(k))?.key ?? "stock";

// Un usuario de punto ve las pestañas que su permiso le da, con alcance a SU punto (lo valida la base:
// compras 20261118, cuentas por pagar 20261120, auditoría por RLS). Proveedores son de toda la tienda.
// El «Resumen» muestra totales de toda la tienda: queda solo para la madre.
const POINT_HIDDEN: TabKey[] = ["overview"];

export default function InventarioPage() {
  const [ctx, setCtx] = useState<ErpCtx | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  useEffect(() => {
    const read = () => {
      const wanted = new URLSearchParams(window.location.search).get("tab") as TabKey | null;
      if (wanted && TABS.some((t) => t.key === wanted)) setTab(wanted);
    };
    window.addEventListener(URL_CHANGE_EVENT, read);
    return () => window.removeEventListener(URL_CHANGE_EVENT, read);
  }, []);
  const [error, setError] = useState<string | null>(null);

  const loadWarehouses = useCallback(async (storeId: string) => {
    const { data, error: err } = await supabaseBrowser()
      .from("erp_warehouses")
      .select(WAREHOUSE_COLUMNS)
      .eq("store_id", storeId)
      .order("is_default", { ascending: false })
      .order("name");
    if (err) setError(errorMessage(err));
    else setWarehouses((data ?? []) as Warehouse[]);
  }, []);

  useEffect(() => {
    let alive = true;
    getDashboardStore()
      .then((access) => {
        if (!alive) return;
        if (!access.store) return setError("No se encontró una tienda para tu usuario.");
        const isPlatformAdmin = access.profileRole === "admin";
        const storeId = access.store.id;
        void loadWarehouses(storeId);
        return supabaseBrowser()
          .rpc("erp_my_point", { p_store: storeId })
          .then(({ data }) => {
            if (!alive) return;
            // Abrir una pestaña desde un enlace (ej.: ?tab=purchases desde una alerta).
            const wanted = new URLSearchParams(window.location.search).get("tab") as TabKey | null;
            if (wanted && TABS.some((t) => t.key === wanted)) setTab(wanted);
            setCtx({
              storeId,
              pointId: isPlatformAdmin ? null : ((data as string | null) ?? null),
              can: (permission) => isPlatformAdmin || hasStorePermission(access, permission),
            });
          });
      })
      .catch((err: unknown) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [loadWarehouses]);

  // Conteo por zonas (opcional, 20261313): la pestaña solo sale si la tienda lo encendió.
  const countsOn = useFeature(ctx?.storeId, "conteo_zonas");
  const visibleTabs = useMemo(() => (ctx ? TABS.filter((t) => t.permissions.some((p) => ctx.can(p)) && !(ctx.pointId && POINT_HIDDEN.includes(t.key)) && (t.key !== "conteos" || countsOn)) : []), [ctx, countsOn]);
  const current = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0];
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, visible: visibleTabs.filter((t) => g.tabs.includes(t.key)) })).filter((g) => g.visible.length), [visibleTabs]);

  function open(key: TabKey) {
    setTab(key);
    // La pestaña queda en la dirección (enlace directo, ayuda y recorrido guiado de esa pestaña).
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
    window.dispatchEvent(new Event("remhub-tab-change"));
  }

  if (error) return <Empty text={error} />;
  if (!ctx) return <SkeletonList rows={5} avatar={false} label="Cargando módulo…" />;
  if (!current) return <Empty text="Tu usuario no tiene permisos para este módulo." />;

  return (
    <main className="space-y-5">
      <section className="glass rounded-[28px] p-5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>Inventario · Compras · Cartera</p>
        <h2 className="mt-2 text-2xl font-semibold">Inventario y compras</h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
          Bodegas, traslados, ajustes, kardex, proveedores, compras y cuentas por pagar conectados entre sí y con auditoría.
        </p>
      </section>

      {/* 1. Sección (Inventario · Compras y pagos · Control) y 2. sus pestañas */}
      <SectionTabs layoutId="inventario-grupos" label="Secciones del módulo" value={groupOf(current.key)}
        items={groups.map((g) => ({ key: g.key, label: g.label, hint: g.hint, icon: g.icon, color: g.color, badge: g.visible.length }))}
        onChange={(k) => { const g = groups.find((x) => x.key === k); if (g && groupOf(current.key) !== k) open(g.visible[0].key); }} />
      <SectionTabs variant="pills" layoutId="inventario-pestanas" label="Pestañas de la sección" value={current.key} onChange={open}
        items={(groups.find((g) => g.key === groupOf(current.key))?.visible ?? []).map((t) => ({ key: t.key, label: t.label, icon: t.icon, color: t.color }))} />

      {current.key === "overview" ? <OverviewTab ctx={ctx} /> : null}
      {current.key === "stock" ? <StockBrowser ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "warehouses" ? <WarehousesTab ctx={ctx} warehouses={warehouses} onChanged={() => void loadWarehouses(ctx.storeId)} /> : null}
      {current.key === "transfers" ? <TransfersTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "adjustments" ? <AdjustmentsTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "conteos" ? <CountsTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "kardex" ? <KardexTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "stale" ? <StaleStockTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "expiry" ? <ExpiryTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "purchases" ? <PurchasesTab ctx={ctx} warehouses={ctx.pointId ? warehouses.filter((w) => w.id === ctx.pointId) : warehouses} /> : null}
      {current.key === "suppliers" ? <SuppliersTab ctx={ctx} /> : null}
      {current.key === "payables" ? <PayablesTab ctx={ctx} /> : null}
      {current.key === "internal" ? <InternalCreditTab ctx={ctx} /> : null}
      {current.key === "manifests" ? <ManifestsTab ctx={ctx} /> : null}
      {current.key === "audit" ? <AuditTab ctx={ctx} /> : null}
    </main>
  );
}
