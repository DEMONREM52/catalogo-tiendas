"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRightLeft, ClipboardCheck, PackageSearch, Receipt, ShoppingBag, Truck } from "lucide-react";
import { useRunOnChange } from "../inventario/shared";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { useFiscalAccess } from "../fiscal/useFiscal";
import { ErrorBox, Notice, Skeleton, fmtMoney } from "../fiscal/ui";

type Ops = {
  orders: { pending: number; month: number } | null;
  remisiones: { month: number; total: number; without_fiscal: number } | null;
  stock_requests: { open: number; month: number } | null;
  transfers: { in_transit: number; month: number } | null;
  adjustments: { month: number } | null;
  purchases: { month: number; total: number } | null;
};

/** Centro de operaciones: documentos comerciales internos (separados de los fiscales). */
export default function OperationsPage() {
  const access = useFiscalAccess();
  const [data, setData] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!access.store) return;
    try {
      setData(await fiscalRpc<Ops>("ops_overview", { p_store: access.store.id }));
    } catch (err) {
      setError(errorText(err));
    }
  }, [access.store]);
  useRunOnChange(load);

  if (access.loading) return <Skeleton rows={4} />;
  if (access.error) return <ErrorBox message={access.error} />;
  const fiscal = access.canAny(["fiscal", "fiscal_send", "fiscal_audit", "fiscal_config"]);

  const cards: Array<{ show: boolean; href: string; icon: React.ReactNode; title: string; value: string; hint: string; warn?: boolean }> = data ? [
    { show: Boolean(data.orders), href: "/dashboard/pedidos", icon: <ShoppingBag size={18} />, title: "Pedidos de clientes", value: String(data.orders?.pending ?? 0), hint: `pendientes · ${data.orders?.month ?? 0} este mes` },
    { show: Boolean(data.remisiones), href: "/dashboard/pos", icon: <Receipt size={18} />, title: "Remisiones del mes", value: String(data.remisiones?.month ?? 0), hint: `${fmtMoney(data.remisiones?.total)}${data.remisiones?.without_fiscal ? ` · ${data.remisiones.without_fiscal} sin documento fiscal` : ""}`, warn: Boolean(data.remisiones?.without_fiscal) },
    { show: Boolean(data.stock_requests), href: "/dashboard/pedidos?tab=internos", icon: <ClipboardCheck size={18} />, title: "Pedidos internos", value: String(data.stock_requests?.open ?? 0), hint: `abiertos · ${data.stock_requests?.month ?? 0} este mes` },
    { show: Boolean(data.transfers), href: "/dashboard/inventario", icon: <Truck size={18} />, title: "Traslados / despachos", value: String(data.transfers?.in_transit ?? 0), hint: `en camino · ${data.transfers?.month ?? 0} este mes` },
    { show: Boolean(data.adjustments), href: "/dashboard/inventario", icon: <ArrowRightLeft size={18} />, title: "Ajustes de inventario", value: String(data.adjustments?.month ?? 0), hint: "este mes" },
    { show: Boolean(data.purchases), href: "/dashboard/inventario", icon: <PackageSearch size={18} />, title: "Compras recibidas", value: String(data.purchases?.month ?? 0), hint: fmtMoney(data.purchases?.total) },
  ] : [];

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>Vista operativa</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Centro de operaciones</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>Pedidos, remisiones, despachos, traslados y movimientos: documentos internos del negocio, distintos de los documentos fiscales.</p>
          </div>
          {fiscal ? (
            <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
              <Link href="/dashboard/fiscal" className="rounded-full px-4 py-2" style={{ color: "var(--t-muted)" }}>🏛️ Vista fiscal</Link>
              <span className="rounded-full px-4 py-2 text-white" style={{ background: "var(--t-accent)" }}>Vista operativa</span>
            </div>
          ) : null}
        </div>
      </section>
      <Notice tone="info" icon="ℹ️">Una remisión no reemplaza a la factura cuando la operación debe facturarse: las remisiones de puntos habilitados aparecen en el Centro fiscal → «Por facturar».</Notice>
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {!data && !error ? <Skeleton rows={3} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.filter((c) => c.show).map((c, i) => (
          <motion.div key={c.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link href={c.href} className="block rounded-[22px] border p-4 transition hover:-translate-y-0.5" style={{ borderColor: c.warn ? "color-mix(in oklab, #f59e0b 50%, transparent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
              <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--t-muted)" }}><span style={{ color: "var(--t-accent)" }}>{c.icon}</span>{c.title}</p>
              <p className="mt-1 text-3xl font-black tabular-nums">{c.value}</p>
              <p className="text-xs" style={{ color: c.warn ? "#d97706" : "var(--t-muted)" }}>{c.hint}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
