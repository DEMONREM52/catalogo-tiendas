"use client";

import { useCallback, useMemo, useState } from "react";
import { useRunOnChange } from "../inventario/shared";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Plus, Search, Users, Warehouse } from "lucide-react";
import { smartFilter } from "@/lib/search";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { POINT_STATUS_INFO, type AccessScope } from "@/lib/fiscal/types";
import { useFiscalAccess } from "../fiscal/useFiscal";
import { Badge, Button, EmptyState, EnvBadge, ErrorBox, Skeleton, Stat, fmtMoney, fmtNumber, inputCls, inputStyle } from "../fiscal/ui";
import { PointWizard } from "./PointWizard";
import type { PointRow } from "./shared";

export default function PointsPage() {
  const access = useFiscalAccess();
  const { store, scope, canAny } = access;
  const [points, setPoints] = useState<PointRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [wizard, setWizard] = useState(0);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const res = await fiscalRpc<{ points: PointRow[]; scope: AccessScope }>("erp_points_overview", { p_store: store.id });
      setPoints(res.points);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [store]);
  useRunOnChange(load);

  const org = scope?.scope === "organization" || scope?.scope === "global";
  const canCreate = org && canAny(["points", "inventory"]);
  const list = useMemo(() => smartFilter((points ?? []).filter((p) => status === "all" || p.status === status), q,
    (p) => `${p.name} ${p.code} ${p.city ?? ""} ${p.responsible_name ?? ""} ${p.fiscal?.entity ?? ""}`, { keepOrder: !q.trim() }), [points, q, status]);
  const onlyPoints = (points ?? []).filter((p) => p.kind === "point");

  if (access.loading) return <Skeleton rows={4} />;
  if (access.error || !store) return <ErrorBox message={access.error ?? "Sin tienda."} />;

  return (
    <main className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>{store.name} · tienda madre</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Puntos</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>Cada punto opera aislado: su inventario, ventas, caja, usuarios y su propia identidad fiscal.</p>
          </div>
          {canCreate ? (
            <button type="button" onClick={() => setWizard((n) => n + 1)} className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))" }}>
              <Plus size={17} /> Crear punto
            </button>
          ) : null}
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Puntos activos" value={points ? onlyPoints.filter((p) => p.status === "active").length : "…"} />
          <Stat label="Suspendidos / inactivos" value={points ? onlyPoints.filter((p) => p.status !== "active").length : "…"} />
          <Stat label="Listos para facturar" value={points ? `${onlyPoints.filter((p) => p.fiscal?.ready).length} de ${onlyPoints.length}` : "…"} tone="good" />
          <Stat label="Ventas de hoy" value={points ? fmtMoney(points.reduce((s, p) => s + Number(p.sales_today), 0)) : "…"} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar punto, código, ciudad, responsable o contribuyente…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2.4rem" }} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`} style={inputStyle}>
          <option value="all">Todos los estados</option>
          {Object.entries(POINT_STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {!points && !error ? <Skeleton rows={4} /> : null}
      {points && !list.length ? <EmptyState icon="📍" title="No hay puntos con este filtro" action={canCreate ? <Button variant="primary" onClick={() => setWizard((n) => n + 1)}>Crear punto</Button> : null} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p, i) => {
          const st = POINT_STATUS_INFO[p.status];
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Link href={`/dashboard/puntos/${p.id}`} className="block h-full rounded-[22px] border p-4 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-base font-black">{p.kind === "warehouse" ? <Warehouse size={16} /> : <MapPin size={16} />} {p.name}</p>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.code}{p.city ? ` · ${p.city}` : ""}{p.is_default ? " · Bodega principal" : ""}</p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.fiscal ? (
                    p.fiscal.configured
                      ? <Badge tone={p.fiscal.ready ? "good" : "bad"}>{p.fiscal.ready ? "🟢 Fiscal listo" : `🔴 Faltan ${p.fiscal.missing}`}</Badge>
                      : <Badge tone="neutral">Sin configuración fiscal</Badge>
                  ) : null}
                  {p.fiscal?.configured ? <EnvBadge env={p.fiscal.environment} /> : null}
                  {p.fiscal?.entity ? <Badge tone="info">{p.fiscal.entity}</Badge> : null}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><p style={{ color: "var(--t-muted)" }}>Responsable</p><p className="truncate font-bold">{p.responsible_name ?? "—"}</p></div>
                  <div><p style={{ color: "var(--t-muted)" }}><Users size={11} className="inline" /> Usuarios</p><p className="font-bold">{p.users}</p></div>
                  <div><p style={{ color: "var(--t-muted)" }}>Unidades</p><p className="font-bold">{fmtNumber(p.units)}</p></div>
                </div>
                <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Hoy {fmtMoney(p.sales_today)} · mes {fmtMoney(p.sales_month)}</p>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {wizard ? <PointWizard key={wizard} access={access} onClose={() => setWizard(0)} onCreated={() => { setWizard(0); void load(); }} /> : null}
    </main>
  );
}
