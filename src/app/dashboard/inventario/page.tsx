"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AdjustmentsTab, AuditTab, KardexTab } from "./OperationsTabs";
import { TransfersTab } from "./TransfersTab";
import { ManifestsTab } from "./ManifestsUI";
import { PayablesTab, PurchasesTab, SuppliersTab } from "./PurchasesTabs";
import { OverviewTab, WarehousesTab } from "./StockTabs";
import { StockBrowser } from "./StockBrowser";
import { Empty, WAREHOUSE_COLUMNS, errorMessage, type ErpCtx, type Warehouse } from "./shared";

type TabKey = "overview" | "stock" | "warehouses" | "transfers" | "adjustments" | "kardex" | "purchases" | "suppliers" | "payables" | "manifests" | "audit";

const TABS: Array<{ key: TabKey; icon: string; label: string; permissions: string[] }> = [
  { key: "overview", icon: "📊", label: "Resumen", permissions: ["inventory", "purchases", "payables"] },
  { key: "stock", icon: "📦", label: "Existencias", permissions: ["inventory"] },
  { key: "warehouses", icon: "🏬", label: "Puntos y bodegas", permissions: ["inventory"] },
  { key: "transfers", icon: "🚚", label: "Traslados", permissions: ["transfers", "inventory"] },
  { key: "adjustments", icon: "🛠️", label: "Ajustes", permissions: ["inventory_adjust", "inventory"] },
  { key: "kardex", icon: "📒", label: "Kardex", permissions: ["inventory"] },
  { key: "purchases", icon: "🛒", label: "Ingreso de factura", permissions: ["purchases"] },
  { key: "suppliers", icon: "🏭", label: "Proveedores", permissions: ["suppliers", "purchases"] },
  { key: "payables", icon: "💸", label: "Cuentas por pagar", permissions: ["payables"] },
  { key: "manifests", icon: "📄", label: "Manifiestos", permissions: ["inventory", "purchases"] },
  { key: "audit", icon: "🛡️", label: "Auditoría", permissions: ["audit"] },
];

// Los usuarios asignados a un punto no ven datos globales ni compras.
const POINT_HIDDEN: TabKey[] = ["overview", "purchases", "suppliers", "payables", "audit"];

export default function InventarioPage() {
  const [ctx, setCtx] = useState<ErpCtx | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
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

  const visibleTabs = useMemo(() => (ctx ? TABS.filter((t) => t.permissions.some((p) => ctx.can(p)) && !(ctx.pointId && POINT_HIDDEN.includes(t.key))) : []), [ctx]);
  const current = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0];

  if (error) return <Empty text={error} />;
  if (!ctx) return <Empty text="Cargando módulo…" />;
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

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Secciones del módulo">
        {visibleTabs.map((t) => {
          const selected = t.key === current.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
              style={
                selected
                  ? { background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2))", color: "var(--t-cta-text, #fff)", borderColor: "transparent" }
                  : { background: "var(--t-card-bg)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }
              }
            >
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          );
        })}
      </nav>

      {current.key === "overview" ? <OverviewTab ctx={ctx} /> : null}
      {current.key === "stock" ? <StockBrowser ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "warehouses" ? <WarehousesTab ctx={ctx} warehouses={warehouses} onChanged={() => void loadWarehouses(ctx.storeId)} /> : null}
      {current.key === "transfers" ? <TransfersTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "adjustments" ? <AdjustmentsTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "kardex" ? <KardexTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "purchases" ? <PurchasesTab ctx={ctx} warehouses={warehouses} /> : null}
      {current.key === "suppliers" ? <SuppliersTab ctx={ctx} /> : null}
      {current.key === "payables" ? <PayablesTab ctx={ctx} /> : null}
      {current.key === "manifests" ? <ManifestsTab ctx={ctx} /> : null}
      {current.key === "audit" ? <AuditTab ctx={ctx} /> : null}
    </main>
  );
}
