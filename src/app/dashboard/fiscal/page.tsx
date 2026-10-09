"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ClipboardList, FileText, Hash, Landmark, PlugZap, Search, Settings2, ShieldCheck, TriangleAlert, Webhook, Workflow } from "lucide-react";
import { useFiscalAccess, useFiscalOverview } from "./useFiscal";
import { Card, ErrorBox, Skeleton, Stat, Tabs, fmtMoney, type TabItem } from "./ui";
import { SummaryTab } from "./SummaryTab";
import { DocumentsTab } from "./DocumentsTab";
import { PendingTab } from "./PendingTab";
import { NumberingTab } from "./NumberingTab";
import { EntitiesTab } from "./EntitiesTab";
import { ProviderTab } from "./ProviderTab";
import { WebhooksTab } from "./WebhooksTab";
import { ContingencyTab } from "./ContingencyTab";
import { AuditTab } from "./AuditTab";
import { SettingsTab } from "./SettingsTab";

type Tab = "resumen" | "documentos" | "pendientes" | "numeracion" | "contribuyentes" | "proveedor" | "webhooks" | "contingencias" | "auditoria" | "configuracion";
const TABS: Tab[] = ["resumen", "documentos", "pendientes", "numeracion", "contribuyentes", "proveedor", "webhooks", "contingencias", "auditoria", "configuracion"];

function FiscalCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const access = useFiscalAccess();
  const { store, scope, canAny } = access;
  const overview = useFiscalOverview(store?.id ?? null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const wanted = params.get("tab") as Tab | null;
  const tab: Tab = wanted && TABS.includes(wanted) ? wanted : "resumen";
  const org = scope ? scope.scope === "organization" || scope.scope === "global" : false;

  const setTab = (t: Tab, extra: Record<string, string> = {}) => {
    const url = new URLSearchParams();
    if (t !== "resumen") url.set("tab", t);
    Object.entries(extra).forEach(([k, v]) => v && url.set(k, v));
    router.replace(`${pathname}${url.toString() ? `?${url}` : ""}`, { scroll: false });
  };

  const data = overview.data;
  const readyCount = data?.points.filter((p) => p.ready).length ?? 0;
  const items: TabItem<Tab>[] = useMemo(() => [
    { value: "resumen", label: "Salud fiscal", icon: <ShieldCheck size={15} /> },
    { value: "documentos", label: "Documentos", icon: <FileText size={15} />, badge: (data?.queue.rejected ?? 0) + (data?.queue.errors ?? 0) || null },
    { value: "pendientes", label: "Por facturar", icon: <ClipboardList size={15} />, badge: data?.pending_sales || null, hidden: !canAny(["fiscal", "fiscal_send", "fiscal_audit"]) },
    { value: "numeracion", label: "Numeración", icon: <Hash size={15} />, hidden: !canAny(["fiscal", "fiscal_numbering", "fiscal_config", "fiscal_audit", "fiscal_send"]) },
    { value: "contribuyentes", label: "Contribuyentes", icon: <Building2 size={15} /> },
    { value: "proveedor", label: "Proveedor", icon: <PlugZap size={15} />, hidden: !canAny(["fiscal", "fiscal_provider", "fiscal_config", "fiscal_audit"]) },
    { value: "webhooks", label: "Webhooks", icon: <Webhook size={15} />, hidden: !org || !canAny(["fiscal_provider", "fiscal_audit"]), badge: (data?.webhooks?.failed ?? 0) + (data?.webhooks?.dead ?? 0) || null },
    { value: "contingencias", label: "Contingencias", icon: <TriangleAlert size={15} />, badge: data?.contingencies.filter((c) => c.status === "open").length || null },
    { value: "auditoria", label: "Auditoría fiscal", icon: <Landmark size={15} />, hidden: !canAny(["fiscal_audit", "audit", "fiscal_download"]) },
    { value: "configuracion", label: "Configuración", icon: <Settings2 size={15} />, hidden: !org || !canAny(["fiscal_config", "store"]) },
  ], [data, canAny, org]);

  if (access.loading) return <Skeleton rows={5} />;
  if (access.error || !store || !scope) return <ErrorBox message={access.error ?? "No se pudo abrir el centro fiscal."} />;
  if (!canAny(["fiscal", "fiscal_send", "fiscal_notes", "fiscal_download", "fiscal_config", "fiscal_numbering", "fiscal_provider", "fiscal_audit"])) {
    return <ErrorBox message="El administrador de tu tienda no te dio permisos del centro fiscal." />;
  }

  const scopeLabel = scope.scope === "global" ? "Super administrador" : scope.scope === "organization" ? "Toda la tienda madre" : scope.scope === "points" ? "Varios puntos" : "Tu punto";

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>Facturación electrónica · {scopeLabel}</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Centro fiscal</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>
              Documentos electrónicos, numeración, contribuyentes y proveedor de cada punto, separados de los documentos internos.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <span className="rounded-full px-4 py-2 text-white" style={{ background: "var(--t-accent)" }}>🏛️ Vista fiscal</span>
            <Link href="/dashboard/operaciones" className="rounded-full px-4 py-2 transition hover:opacity-80" style={{ color: "var(--t-muted)" }}>
              <Workflow size={13} className="mr-1 inline" /> Vista operativa
            </Link>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Aceptado este mes" value={data ? fmtMoney(data.month.accepted_total) : "…"} tone="good" />
          <Stat label="Rechazados" value={data ? data.queue.rejected : "…"} tone={data?.queue.rejected ? "bad" : undefined} />
          <Stat label="En cola / con error" value={data ? `${data.queue.pending} / ${data.queue.errors}` : "…"} tone={data?.queue.errors ? "warn" : undefined} />
          <Stat label="Puntos listos" value={data ? `${readyCount} de ${data.points.length}` : "…"} tone={data && readyCount < data.points.length ? "warn" : "good"} />
        </div>
        <form
          className="relative mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTab("documentos", { q: q.trim() });
          }}
        >
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar factura, número, prefijo, CUFE, NIT, cliente, punto, usuario o error…"
            className="w-full rounded-2xl border py-3 pr-4 text-sm outline-none"
            style={{ paddingLeft: "2.4rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}
          />
        </form>
      </section>

      <Tabs value={tab} onChange={(t) => setTab(t)} items={items} layoutId="fiscal-tabs" />

      {overview.error ? <ErrorBox message={overview.error} onRetry={() => void overview.reload()} /> : null}
      {!data && !overview.error ? <Skeleton rows={4} /> : null}
      {data ? (
        <div key={tab}>
          {tab === "resumen" ? <SummaryTab access={access} data={data} reload={overview.reload} onOpen={(t, extra) => setTab(t as Tab, extra)} /> : null}
          {tab === "documentos" ? <DocumentsTab access={access} data={data} initialQuery={params.get("q") ?? ""} initialStatus={params.get("estado") ?? ""} onChanged={overview.reload} /> : null}
          {tab === "pendientes" ? <PendingTab access={access} data={data} onChanged={overview.reload} /> : null}
          {tab === "numeracion" ? <NumberingTab access={access} data={data} reload={overview.reload} /> : null}
          {tab === "contribuyentes" ? <EntitiesTab access={access} data={data} reload={overview.reload} /> : null}
          {tab === "proveedor" ? <ProviderTab access={access} data={data} reload={overview.reload} /> : null}
          {tab === "webhooks" ? <WebhooksTab access={access} /> : null}
          {tab === "contingencias" ? <ContingencyTab access={access} data={data} reload={overview.reload} /> : null}
          {tab === "auditoria" ? <AuditTab access={access} data={data} initialCategory={params.get("categoria") ?? ""} /> : null}
          {tab === "configuracion" ? <SettingsTab access={access} data={data} reload={overview.reload} /> : null}
        </div>
      ) : null}
      {data && tab === "resumen" && data.points.length === 0 ? (
        <Card><p className="text-sm">Aún no hay puntos de venta. <Link href="/dashboard/puntos" className="font-bold underline">Crea el primero</Link>.</p></Card>
      ) : null}
    </main>
  );
}

export default function FiscalPage() {
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <FiscalCenter />
    </Suspense>
  );
}
