"use client";

import { useEffect, useState } from "react";
import { Repeat, ShoppingBag } from "lucide-react";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";
import { CustomerOrders } from "./CustomerOrders";
import { StockRequestsPanel } from "./internos/StockRequestsPanel";

type Tab = "clientes" | "internos";

/** Pedidos: los de clientes (catálogos y POS) y los internos entre puntos y bodegas. */
export default function PedidosPage() {
  const [ready, setReady] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [perm, setPerm] = useState({ orders: false, internal: false, request: false });
  const [tab, setTab] = useState<Tab>("clientes");

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      if (!access?.store) return setReady(true);
      const can = (p: string) => hasStorePermission(access, p);
      const internal = can("stock_requests") || can("stock_requests_manage") || can("transfers");
      setStoreId(access.store.id);
      setPerm({ orders: can("orders"), internal, request: can("stock_requests") || can("stock_requests_manage") });
      const wanted = new URLSearchParams(window.location.search).get("tab");
      setTab(internal && (wanted === "internos" || !can("orders")) ? "internos" : "clientes");
      setReady(true);
    })();
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "internos") url.searchParams.set("tab", "internos");
    else {
      url.searchParams.delete("tab");
      url.searchParams.delete("pedido");
    }
    window.history.replaceState(null, "", url.toString());
  }

  if (!ready) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando pedidos…</main>;

  const both = perm.orders && perm.internal;
  return (
    <div className="space-y-4">
      {both || (perm.internal && !perm.orders) ? (
        <div className="px-4 pt-4 sm:px-6">
          {perm.internal && !perm.orders ? (
            <div>
              <h1 className="text-2xl font-bold">Pedidos internos</h1>
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>Pide mercancía a otros puntos o bodegas y coordina por chat hasta que llegue.</p>
            </div>
          ) : (
            <div className="flex w-full gap-1 rounded-full border p-1 text-sm font-bold sm:w-fit" style={{ borderColor: "var(--t-card-border)" }}>
              {([["clientes", <ShoppingBag key="c" size={15} />, "Pedidos de clientes"], ["internos", <Repeat key="i" size={15} />, "Pedidos internos"]] as Array<[Tab, React.ReactNode, string]>).map(([k, icon, label]) => (
                <button key={k} type="button" onClick={() => choose(k)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 transition sm:flex-none" style={tab === k ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
                  {icon} {label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "internos" && perm.internal && storeId ? (
        <div className="px-4 pb-6 sm:px-6">
          {both ? (
            <div className="mb-4">
              <h1 className="text-2xl font-bold">Pedidos internos</h1>
              <p className="text-sm" style={{ color: "var(--t-muted)" }}>Entre puntos y bodegas: quien pide ve lo disponible, quien atiende prepara y despacha, y todos coordinan por chat.</p>
            </div>
          ) : null}
          <StockRequestsPanel storeId={storeId} canRequest={perm.request} />
        </div>
      ) : perm.orders ? (
        <CustomerOrders />
      ) : (
        <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>No tienes permiso para ver pedidos.</main>
      )}
    </div>
  );
}
