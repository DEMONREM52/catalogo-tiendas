"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, LayoutDashboard, MapPin, ShieldAlert } from "lucide-react";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import type { AuditRow, PointReadiness, SearchPage } from "@/lib/fiscal/types";
import { TrendChart, BarList } from "@/app/dashboard/reports/charts";
import { Badge, Card, ErrorBox, Field, Notice, SectionTitle, Skeleton, Stat, Tabs, fmtMoney, fmtNumber, inputCls, inputStyle } from "@/app/dashboard/fiscal/ui";
import { DocumentsTab } from "@/app/dashboard/fiscal/DocumentsTab";
import { AuditList } from "@/app/dashboard/fiscal/AuditTab";
import { ReadinessCard } from "@/app/dashboard/fiscal/SummaryTab";
import type { FiscalAccess } from "@/app/dashboard/fiscal/useFiscal";

type Overview = {
  period: { from: string; to: string };
  kpis: Record<string, number>;
  by_day: Array<{ day: string; documents: number; accepted: number; rejected: number; total: number }>;
  by_store: Array<{ id: string; name: string; documents: number; total: number }>;
  by_point: Array<{ id: string; name: string; store: string; documents: number; total: number }>;
  by_entity: Array<{ id: string; name: string; nit: string | null; documents: number; total: number }>;
  by_status: Record<string, number>;
};
type Posture = { public_hardening: { orders_closed: boolean; order_items_closed: boolean; product_costs_hidden: boolean }; tables_without_rls: string[]; tables_rls_no_policies: string[]; definer_without_search_path: string[] };
type Tab = "resumen" | "documentos" | "puntos" | "seguridad";

const ADMIN_ACCESS: FiscalAccess = { loading: false, error: null, store: null, scope: null, can: () => true, canAny: () => true };
const day = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

export default function AdminFiscalPage() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [range, setRange] = useState({ from: day(29), to: day(0) });
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<Array<{ store_name: string; store_active: boolean; readiness: PointReadiness }> | null>(null);
  const [pq, setPq] = useState("");
  const [posture, setPosture] = useState<Posture | null>(null);

  const load = useCallback(async () => {
    try {
      setOv(await fiscalRpc<Overview>("admin_fiscal_overview", { p_from: range.from, p_to: range.to }));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [range]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al cambiar el periodo.
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "puntos") return;
    const t = setTimeout(() => {
      void fiscalRpc<{ items: Array<{ store_name: string; store_active: boolean; readiness: PointReadiness }> }>("admin_fiscal_points", { p_q: pq, p_limit: 120, p_offset: 0 })
        .then((r) => setPoints(r.items)).catch((e) => setError(errorText(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [tab, pq]);

  useEffect(() => {
    if (tab !== "seguridad" || posture) return;
    void fiscalRpc<Posture>("admin_security_posture").then(setPosture).catch((e) => setError(errorText(e)));
  }, [tab, posture]);

  const loadSecurity = useCallback((filters: Record<string, unknown>, cursor: SearchPage<AuditRow>["next_cursor"]) =>
    fiscalRpc<SearchPage<AuditRow>>("admin_security_events", { p_filters: filters, p_limit: 50, p_cursor: cursor }), []);

  const series = useMemo(() => (ov?.by_day ?? []).map((d) => ({ t: d.day, sales: Number(d.total), prev: 0 })), [ov]);
  const k = ov?.kpis ?? {};

  return (
    <main className="space-y-5">
      <section className="rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>Super administrador · todas las tiendas madre</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">Fiscal y seguridad</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>Contribuyentes, numeraciones, documentos, errores, webhooks e intentos sospechosos de toda la plataforma.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-end">
          <Field label="Desde"><input type="date" className={inputCls} style={inputStyle} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Hasta"><input type="date" className={inputCls} style={inputStyle} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      </section>

      <Tabs value={tab} onChange={setTab} layoutId="admin-fiscal-tabs" items={[
        { value: "resumen", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
        { value: "documentos", label: "Documentos", icon: <FileText size={15} /> },
        { value: "puntos", label: "Puntos y contribuyentes", icon: <MapPin size={15} /> },
        { value: "seguridad", label: "Seguridad", icon: <ShieldAlert size={15} />, badge: k.security_critical || null },
      ]} />
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      {tab === "resumen" ? (
        !ov ? <Skeleton rows={4} /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Tiendas madre activas" value={`${k.stores_active} / ${k.stores_total}`} />
              <Stat label="Puntos activos" value={k.points_active} />
              <Stat label="Suspendidos" value={k.points_suspended} tone={k.points_suspended ? "warn" : undefined} />
              <Stat label="Habilitados fiscal" value={k.points_fiscal_enabled} tone="good" />
              <Stat label="Usuarios activos" value={k.users_active} />
              <Stat label="Contribuyentes" value={k.entities} />
              <Stat label="Facturas emitidas" value={fmtNumber(k.documents)} />
              <Stat label="Aceptadas" value={fmtNumber(k.accepted)} tone="good" />
              <Stat label="Rechazadas" value={fmtNumber(k.rejected)} tone={k.rejected ? "bad" : undefined} />
              <Stat label="Pendientes" value={k.pending} tone={k.pending ? "info" : undefined} />
              <Stat label="Con error" value={k.errors} tone={k.errors ? "warn" : undefined} />
              <Stat label="Notas crédito / débito" value={`${k.credit_notes} / ${k.debit_notes}`} />
              <Stat label="Rangos por vencer" value={k.ranges_expiring} tone={k.ranges_expiring ? "warn" : undefined} />
              <Stat label="Rangos por agotarse" value={k.ranges_exhausting} tone={k.ranges_exhausting ? "warn" : undefined} />
              <Stat label="Proveedores caídos" value={k.providers_down} tone={k.providers_down ? "bad" : undefined} />
              <Stat label="Webhooks fallidos" value={k.webhooks_failed} tone={k.webhooks_failed ? "warn" : undefined} hint={`${k.webhooks_rejected} con firma inválida`} />
              <Stat label="Contingencias" value={k.contingencies_open} tone={k.contingencies_open ? "warn" : undefined} />
              <Stat label="Alertas de seguridad (7d)" value={k.security_critical} tone={k.security_critical ? "bad" : undefined} />
            </div>
            <Card>
              <SectionTitle title="Facturación aceptada por día" subtitle={`Total del periodo: ${fmtMoney(k.accepted_total)}`} />
              {series.length ? <TrendChart series={series} bucket="day" /> : <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin documentos en el periodo.</p>}
            </Card>
            <Card>
              <SectionTitle title="Aceptados vs rechazados" />
              <div className="flex h-32 items-end gap-1 overflow-x-auto">
                {(ov.by_day ?? []).map((d) => {
                  const max = Math.max(1, ...ov.by_day.map((x) => x.documents));
                  return (
                    <div key={d.day} className="flex min-w-3 flex-1 flex-col justify-end" title={`${d.day}: ${d.accepted} aceptados, ${d.rejected} rechazados`}>
                      <div style={{ height: `${(d.rejected / max) * 100}%`, background: "#ef4444" }} className="rounded-t" />
                      <div style={{ height: `${(d.accepted / max) * 100}%`, background: "#16a34a" }} />
                    </div>
                  );
                })}
              </div>
            </Card>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><SectionTitle title="Por tienda madre" /><BarList rows={ov.by_store.map((s) => ({ key: s.id, label: s.name, value: Number(s.total), sub: `${s.documents} documentos` }))} /></Card>
              <Card><SectionTitle title="Por punto" /><BarList rows={ov.by_point.map((s) => ({ key: s.id, label: s.name, value: Number(s.total), sub: `${s.store} · ${s.documents} documentos` }))} /></Card>
              <Card><SectionTitle title="Por contribuyente" /><BarList rows={ov.by_entity.map((s) => ({ key: s.id, label: s.name, value: Number(s.total), sub: `NIT ${s.nit ?? "—"} · ${s.documents} documentos` }))} /></Card>
            </div>
          </div>
        )
      ) : null}

      {tab === "documentos" ? <DocumentsTab access={ADMIN_ACCESS} initialQuery="" initialStatus="" admin /> : null}

      {tab === "puntos" ? (
        <div className="space-y-3">
          <input className={inputCls} style={inputStyle} value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Buscar tienda, punto, código, contribuyente o NIT…" />
          {!points ? <Skeleton rows={4} /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              {points.map((p) => (
                <div key={p.readiness.point.id} className="space-y-1">
                  <p className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--t-muted)" }}>🏪 {p.store_name} {!p.store_active ? <Badge tone="bad">Tienda inactiva</Badge> : null}</p>
                  <ReadinessCard p={p.readiness} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "seguridad" ? (
        <div className="space-y-4">
          {posture ? (
            <Card className="space-y-2">
              <SectionTitle title="Postura de seguridad de la base" subtitle="Revisión automática de RLS y funciones privilegiadas." />
              {!posture.public_hardening.orders_closed || !posture.public_hardening.order_items_closed || !posture.public_hardening.product_costs_hidden ? (
                <Notice tone="bad" icon="⛔">Lectura pública abierta: {[!posture.public_hardening.orders_closed && "ventas", !posture.public_hardening.order_items_closed && "líneas de venta", !posture.public_hardening.product_costs_hidden && "costos de productos"].filter(Boolean).join(", ")}. La migración no la cerró porque alguna función pública la usa con permisos del visitante (ver los avisos al ejecutar el SQL).</Notice>
              ) : <Notice tone="good" icon="✅">Ventas, líneas y costos protegidos de visitantes anónimos.</Notice>}
              {posture.tables_without_rls.length ? <Notice tone="bad" icon="⛔">Tablas sin RLS (cualquiera con la llave pública podría leerlas o escribirlas): <b>{posture.tables_without_rls.join(", ")}</b></Notice> : <Notice tone="good" icon="✅">Todas las tablas públicas tienen RLS.</Notice>}
              {posture.tables_rls_no_policies.length ? <Notice tone="info">Con RLS y sin políticas (solo el servidor accede): {posture.tables_rls_no_policies.join(", ")}</Notice> : null}
              {posture.definer_without_search_path.length ? <Notice tone="warn">Funciones privilegiadas sin search_path fijo: {posture.definer_without_search_path.join(", ")}</Notice> : null}
            </Card>
          ) : <Skeleton rows={2} />}
          <Card>
            <SectionTitle title="Intentos sospechosos" subtitle="Accesos a otro punto, NIT o numeración ajena, webhooks mal firmados, permisos negados…" />
            <AuditList load={loadSecurity} initialCategory="security" showStore />
          </Card>
        </div>
      ) : null}
    </main>
  );
}
