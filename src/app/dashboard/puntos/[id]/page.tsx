"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Boxes, ClipboardList, Landmark, MapPin, Power, ShieldCheck, Users, Wallet, Wifi } from "lucide-react";
import { errorText, fiscalApi, fiscalRpc } from "@/lib/fiscal/client";
import { permissionLabel } from "@/lib/permissions";
import { POINT_STATUS_INFO, type FiscalEntity, type FiscalEstablishment, type PointReadiness, type PointStatus, type ProviderAccount, type RangeInfo } from "@/lib/fiscal/types";
import { useFiscalAccess, type FiscalOverview } from "../../fiscal/useFiscal";
import { Badge, Button, Card, ErrorBox, Field, Notice, SectionTitle, Skeleton, Stat, Tabs, Toggle, askReasonDialog, fmtMoney, fmtNumber, inputCls, inputStyle, notify, type TabItem } from "../../fiscal/ui";
import { ReadinessCard } from "../../fiscal/SummaryTab";
import { RangeCard } from "../../fiscal/NumberingTab";
import { AuditRowsMini } from "./AuditMini";
import { loadTeam, memberName, type TeamMember } from "../shared";

type Dossier = {
  ok: true;
  point: { id: string; store_id: string; code: string; name: string; kind: string; status: PointStatus; is_default: boolean; address: string | null; phone: string | null; city: string | null; email: string | null; description: string | null;
    responsible_name: string | null; responsible_doc: string | null; responsible_phone: string | null; responsible_email: string | null; responsible_user_id: string | null; status_reason: string | null; status_changed_at: string | null };
  readiness?: PointReadiness;
  config?: { fiscal_entity_id: string | null; establishment_id: string | null; provider_account_id: string | null; environment: string; enabled: boolean; pos_document_type: string; pos_electronic_default: boolean } | null;
  entity?: FiscalEntity | null;
  establishment?: FiscalEstablishment | null;
  provider_account?: (ProviderAccount & { provider_name: string }) | null;
  ranges?: RangeInfo[];
  documents?: { month: Record<string, number>; month_total: number; recent: Array<{ id: string; full_number: string; status: string; total: number; issue_date: string; customer_name: string | null }> };
  users?: Array<{ user_id: string; name: string; username: string; role: string; active: boolean; permissions: string[]; home: boolean }>;
  inventory?: { units: number; skus: number; value: number; negative: number; low: number };
  sales?: { today: { total: number; count: number }; month: { total: number; count: number; invoices: number; remisiones: number }; by_method_today: Record<string, number> };
  audit?: Array<{ id: string; created_at: string; user_name: string | null; action: string; category: string; severity: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null }>;
};

type Tab = "general" | "fiscal" | "usuarios" | "operacion" | "auditoria" | "estado";

function PointDossier({ id }: { id: string }) {
  const access = useFiscalAccess();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (params.get("tab") as Tab) || "general";
  const [data, setData] = useState<Dossier | null>(null);
  const [ov, setOv] = useState<FiscalOverview | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [cfg, setCfg] = useState({ fiscal_entity_id: "", establishment_id: "", provider_account_id: "", environment: "sandbox", enabled: false, pos_document_type: "invoice", pos_electronic_default: true });

  const load = useCallback(async () => {
    try {
      const d = await fiscalRpc<Dossier>("erp_point_dossier", { p_point: id });
      setData(d);
      const p = d.point;
      setForm({ name: p.name, code: p.code, description: p.description ?? "", address: p.address ?? "", phone: p.phone ?? "", city: p.city ?? "", email: p.email ?? "",
        responsible_name: p.responsible_name ?? "", responsible_doc: p.responsible_doc ?? "", responsible_phone: p.responsible_phone ?? "", responsible_email: p.responsible_email ?? "", responsible_user_id: p.responsible_user_id ?? "" });
      if (d.config) setCfg({ fiscal_entity_id: d.config.fiscal_entity_id ?? "", establishment_id: d.config.establishment_id ?? "", provider_account_id: d.config.provider_account_id ?? "", environment: d.config.environment, enabled: d.config.enabled, pos_document_type: d.config.pos_document_type, pos_electronic_default: d.config.pos_electronic_default });
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!access.store) return;
    void (async () => {
      const [o, t] = await Promise.all([
        access.canAny(["fiscal", "fiscal_config", "fiscal_numbering", "fiscal_provider"]) ? fiscalRpc<FiscalOverview>("fiscal_overview", { p_store: access.store!.id }).catch(() => null) : Promise.resolve(null),
        access.can("users") ? loadTeam(access.store!.id) : Promise.resolve([]),
      ]);
      setOv(o);
      setTeam(t);
    })();
  }, [access]);

  const setTab = (t: Tab) => router.replace(`${pathname}${t === "general" ? "" : `?tab=${t}`}`, { scroll: false });
  const org = access.scope?.scope === "organization" || access.scope?.scope === "global";
  const canAdmin = org && access.canAny(["points", "inventory"]);

  async function saveGeneral() {
    setBusy("general");
    try {
      await fiscalRpc("erp_point_save", { p_store: data?.point.store_id, p_data: { id, ...form, responsible_user_id: form.responsible_user_id || null }, p_reason: null });
      await notify("Punto actualizado");
      await load();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveFiscal() {
    const prod = cfg.environment === "production" && data?.config?.environment !== "production";
    let reason: string | null = null;
    if (data?.config || prod) {
      reason = await askReasonDialog(prod ? "Pasar el punto a producción" : "Motivo del cambio fiscal", prod ? "Desde ahora los documentos se transmiten de verdad a la DIAN. Confírmalo solo si tu proveedor y tu contadora aprobaron la habilitación." : "Queda en la auditoría fiscal.");
      if (!reason) return;
    }
    setBusy("fiscal");
    try {
      await fiscalRpc("fiscal_point_config_save", { p_point: id, p_data: { ...cfg, fiscal_entity_id: cfg.fiscal_entity_id || null, establishment_id: cfg.establishment_id || null, provider_account_id: cfg.provider_account_id || null }, p_reason: reason, p_confirm_production: prod });
      await notify("Configuración fiscal guardada");
      await load();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function testProvider() {
    if (!cfg.provider_account_id) return;
    setBusy("test");
    try {
      const res = await fiscalApi<{ health: { ok: boolean; message: string } }>("/api/fiscal/providers/test", { account_id: cfg.provider_account_id });
      await notify(res.health.ok ? "Conexión correcta" : "La prueba falló", res.health.ok ? "success" : "warning", res.health.message);
      await load();
    } catch (err) {
      await notify("No se pudo probar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: PointStatus) {
    const reason = status === "active" ? "Activación del punto" : await askReasonDialog(`${POINT_STATUS_INFO[status].label}: ${data?.point.name}`, status === "inactive" ? "El punto deja de operar; conserva todo su historial." : "El punto deja de operar temporalmente.");
    if (!reason) return;
    try {
      await fiscalRpc("erp_point_set_status", { p_point: id, p_status: status, p_reason: reason });
      await notify("Estado actualizado");
      await load();
    } catch (err) {
      await notify("No se pudo cambiar", "error", errorText(err));
    }
  }

  async function assign(userId: string) {
    try {
      await fiscalRpc("erp_point_assign_users", { p_point: id, p_users: [{ user_id: userId }] });
      await notify("Usuario asignado al punto");
      await load();
    } catch (err) {
      await notify("No se pudo asignar", "error", errorText(err));
    }
  }

  if (access.loading || (!data && !error)) return <Skeleton rows={5} />;
  if (error || !data) return <ErrorBox message={error ?? "No se pudo abrir el punto."} onRetry={() => void load()} />;
  const p = data.point;
  const st = POINT_STATUS_INFO[p.status];
  const items: TabItem<Tab>[] = [
    { value: "general", label: "Datos y responsable", icon: <MapPin size={15} /> },
    { value: "fiscal", label: "Fiscalidad", icon: <Landmark size={15} />, hidden: !data.readiness, badge: data.readiness && !data.readiness.ready && data.readiness.enabled ? "!" : null },
    { value: "usuarios", label: "Usuarios y permisos", icon: <Users size={15} />, hidden: !data.users },
    { value: "operacion", label: "Inventario y caja", icon: <Boxes size={15} />, hidden: !data.inventory && !data.sales },
    { value: "auditoria", label: "Auditoría", icon: <ClipboardList size={15} />, hidden: !data.audit },
    { value: "estado", label: "Estado", icon: <Power size={15} />, hidden: !canAdmin },
  ];
  const entities = ov?.entities ?? (data.entity ? [data.entity] : []);
  const ests = (ov?.establishments ?? (data.establishment ? [data.establishment] : [])).filter((e) => e.fiscal_entity_id === cfg.fiscal_entity_id);
  const accounts = (ov?.accounts ?? (data.provider_account ? [data.provider_account] : [])).filter((a) => a.fiscal_entity_id === cfg.fiscal_entity_id && a.environment === cfg.environment);
  const canFiscal = access.can("fiscal_config");

  return (
    <main className="space-y-5">
      <Link href="/dashboard/puntos" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--t-muted)" }}><ArrowLeft size={15} /> Puntos</Link>
      <section className="rounded-[28px] border p-5 sm:p-6" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>Expediente del punto · {p.code}</p>
            <h1 className="mt-1 truncate text-2xl font-black sm:text-3xl">{p.name}</h1>
            <p className="text-sm" style={{ color: "var(--t-muted)" }}>{[p.address, p.city].filter(Boolean).join(" · ") || "Sin dirección"}{p.responsible_name ? ` · Responsable: ${p.responsible_name}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            {data.readiness ? <Badge tone={data.readiness.ready ? "good" : "bad"}>{data.readiness.ready ? "🟢 Habilitado fiscalmente" : "🔴 Fiscal pendiente"}</Badge> : null}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Ventas hoy" value={data.sales ? fmtMoney(data.sales.today.total) : "—"} />
          <Stat label="Ventas del mes" value={data.sales ? fmtMoney(data.sales.month.total) : "—"} />
          <Stat label="Facturado (aceptado) mes" value={data.documents ? fmtMoney(data.documents.month_total) : "—"} tone="good" />
          <Stat label="Unidades en inventario" value={data.inventory ? fmtNumber(data.inventory.units) : "—"} />
        </div>
      </section>

      <Tabs value={tab} onChange={setTab} items={items} layoutId="point-tabs" />

      {tab === "general" ? (
        <Card className="space-y-3">
          <SectionTitle title="Administración del punto" subtitle="Datos operativos y responsable (separado de la configuración fiscal)." />
          <div className="grid gap-3 sm:grid-cols-2">
            {([["name", "Nombre"], ["code", "Código"], ["address", "Dirección"], ["city", "Ciudad"], ["phone", "Teléfono"], ["email", "Correo"], ["description", "Descripción"]] as const).map(([k, l]) => (
              <Field key={k} label={l}><input disabled={!canAdmin} className={inputCls} style={inputStyle} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <p className="pt-2 text-sm font-black">Responsable</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["responsible_name", "Nombre"], ["responsible_doc", "Documento"], ["responsible_phone", "Celular"], ["responsible_email", "Correo"]] as const).map(([k, l]) => (
              <Field key={k} label={l}><input disabled={!canAdmin} className={inputCls} style={inputStyle} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
            ))}
            <Field label="Usuario responsable">
              <select disabled={!canAdmin} className={inputCls} style={inputStyle} value={form.responsible_user_id ?? ""} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })}>
                <option value="">Sin usuario</option>
                {team.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
              </select>
            </Field>
          </div>
          {canAdmin ? <div className="flex justify-end"><Button variant="primary" busy={busy === "general"} onClick={() => void saveGeneral()}>Guardar</Button></div> : null}
        </Card>
      ) : null}

      {tab === "fiscal" && data.readiness ? (
        <div className="space-y-4">
          <ReadinessCard p={data.readiness} defaultOpen />
          <Card className="space-y-3">
            <SectionTitle title="Configuración fiscal" subtitle="Con qué identidad, establecimiento, proveedor y ambiente factura este punto." icon={<ShieldCheck size={16} />} />
            {!canFiscal ? <Notice tone="info">Solo lectura: necesitas el permiso «Configuración fiscal».</Notice> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contribuyente (quién factura)">
                <select disabled={!canFiscal} className={inputCls} style={inputStyle} value={cfg.fiscal_entity_id} onChange={(e) => setCfg({ ...cfg, fiscal_entity_id: e.target.value, establishment_id: "", provider_account_id: "" })}>
                  <option value="">Sin contribuyente</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name} · {e.document_number}</option>)}
                </select>
              </Field>
              <Field label="Establecimiento">
                <select disabled={!canFiscal} className={inputCls} style={inputStyle} value={cfg.establishment_id} onChange={(e) => setCfg({ ...cfg, establishment_id: e.target.value })}>
                  <option value="">Sin establecimiento</option>
                  {ests.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.address}</option>)}
                </select>
              </Field>
              <Field label="Ambiente">
                <select disabled={!canFiscal} className={inputCls} style={inputStyle} value={cfg.environment} onChange={(e) => setCfg({ ...cfg, environment: e.target.value, provider_account_id: "" })}>
                  <option value="sandbox">🧪 Pruebas</option><option value="production">🟢 Producción</option>
                </select>
              </Field>
              <Field label="Cuenta del proveedor">
                <select disabled={!canFiscal} className={inputCls} style={inputStyle} value={cfg.provider_account_id} onChange={(e) => setCfg({ ...cfg, provider_account_id: e.target.value })}>
                  <option value="">Sin proveedor</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.provider_name ?? a.provider}{a.label ? ` · ${a.label}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Documento del POS al elegir «Factura»" hint="REQUIERE VALIDACIÓN CONTABLE.">
                <select disabled={!canFiscal} className={inputCls} style={inputStyle} value={cfg.pos_document_type} onChange={(e) => setCfg({ ...cfg, pos_document_type: e.target.value })}>
                  <option value="invoice">Factura electrónica de venta</option><option value="pos_equivalent">Documento equivalente electrónico POS</option>
                </select>
              </Field>
            </div>
            <Toggle disabled={!canFiscal} checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="Facturación electrónica activa en este punto" hint="Cuando está activa, la «factura» del POS siempre es electrónica (nunca una factura interna con otro número)." />
            {canFiscal ? (
              <div className="flex flex-wrap justify-end gap-2">
                {cfg.provider_account_id && access.can("fiscal_provider") ? <Button icon={<Wifi size={15} />} busy={busy === "test"} onClick={() => void testProvider()}>Probar conexión</Button> : null}
                <Link href="/dashboard/fiscal?tab=contribuyentes" className="rounded-xl border px-3.5 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Contribuyentes</Link>
                <Link href="/dashboard/fiscal?tab=proveedor" className="rounded-xl border px-3.5 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Proveedor</Link>
                <Button variant="primary" busy={busy === "fiscal"} onClick={() => void saveFiscal()}>Guardar configuración fiscal</Button>
              </div>
            ) : null}
          </Card>
          <SectionTitle title="Numeración del punto" subtitle="Resoluciones autorizadas para este punto." actions={<Link href="/dashboard/fiscal?tab=numeracion" className="text-sm font-bold underline">Administrar</Link>} />
          <div className="grid gap-3 lg:grid-cols-2">
            {(data.ranges ?? []).map((r) => <RangeCard key={r.id} r={r} points={[{ id: p.id, name: p.name }]} />)}
            {!data.ranges?.length ? <Notice tone="warn">Este punto no tiene numeración autorizada.</Notice> : null}
          </div>
          {data.documents?.recent.length ? (
            <Card>
              <p className="mb-2 text-sm font-black">Últimos documentos</p>
              {data.documents.recent.map((d) => (
                <Link key={d.id} href={`/dashboard/fiscal?tab=documentos&q=${encodeURIComponent(d.full_number)}`} className="flex justify-between border-b py-1.5 text-sm last:border-0" style={{ borderColor: "var(--t-card-border)" }}>
                  <span><b>{d.full_number}</b> · {d.customer_name ?? "Consumidor final"}</span><span>{fmtMoney(d.total)}</span>
                </Link>
              ))}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "usuarios" && data.users ? (
        <Card className="space-y-3">
          <SectionTitle title="Usuarios del punto" subtitle="Solo ven y operan este punto (o lo consultan si es un punto adicional)." actions={<Link href="/dashboard/store/users" className="text-sm font-bold underline">Crear o editar usuarios</Link>} />
          {data.users.map((u) => (
            <div key={u.user_id} className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">{u.name} <span className="text-xs font-normal opacity-70">@{u.username}</span> <Badge tone={u.home ? "good" : "info"}>{u.home ? "Punto principal" : "Consulta"}</Badge>{!u.active ? <Badge tone="bad">Inactivo</Badge> : null}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>{u.permissions.length ? u.permissions.map(permissionLabel).join(" · ") : "Sin permisos"}</p>
            </div>
          ))}
          {!data.users.length ? <Notice tone="warn">Aún no hay usuarios en este punto.</Notice> : null}
          {canAdmin && team.some((m) => m.role !== "store_admin" && m.point_id !== p.id) ? (
            <Field label="Asignar un usuario existente a este punto">
              <select className={inputCls} style={inputStyle} value="" onChange={(e) => e.target.value && void assign(e.target.value)}>
                <option value="">Elige un usuario…</option>
                {team.filter((m) => m.role !== "store_admin" && m.point_id !== p.id).map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}{m.point_id ? " (cambia de punto)" : " (hoy ve toda la tienda)"}</option>)}
              </select>
            </Field>
          ) : null}
        </Card>
      ) : null}

      {tab === "operacion" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.inventory ? (
            <Card>
              <SectionTitle title="Inventario del punto" icon={<Boxes size={16} />} actions={<Link href="/dashboard/inventario" className="text-sm font-bold underline">Ver existencias</Link>} />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Unidades" value={fmtNumber(data.inventory.units)} /><Stat label="Referencias" value={fmtNumber(data.inventory.skus)} />
                <Stat label="Valor al costo" value={fmtMoney(data.inventory.value)} /><Stat label="Bajas / negativas" value={`${data.inventory.low} / ${data.inventory.negative}`} tone={data.inventory.negative ? "warn" : undefined} />
              </div>
            </Card>
          ) : null}
          {data.sales ? (
            <Card>
              <SectionTitle title="Caja y ventas" icon={<Wallet size={16} />} />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Hoy" value={fmtMoney(data.sales.today.total)} hint={`${data.sales.today.count} ventas`} />
                <Stat label="Mes" value={fmtMoney(data.sales.month.total)} hint={`${data.sales.month.invoices} facturas · ${data.sales.month.remisiones} remisiones`} />
              </div>
              <p className="mt-3 text-xs font-bold" style={{ color: "var(--t-muted)" }}>Hoy por medio de pago</p>
              {Object.entries(data.sales.by_method_today).map(([m, v]) => <p key={m} className="flex justify-between text-sm"><span>{m}</span><b>{fmtMoney(v)}</b></p>)}
              {!Object.keys(data.sales.by_method_today).length ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin ventas hoy.</p> : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "auditoria" && data.audit ? <AuditRowsMini rows={data.audit} /> : null}

      {tab === "estado" && canAdmin ? (
        <Card className="space-y-3">
          <SectionTitle title="Estado del punto" subtitle="Activo operacionalmente es distinto de habilitado fiscalmente." />
          <p className="text-sm">Estado actual: <Badge tone={st.tone}>{st.label}</Badge>{p.status_reason ? ` · ${p.status_reason}` : ""}</p>
          <div className="grid gap-2 sm:grid-cols-4">
            {(Object.keys(POINT_STATUS_INFO) as PointStatus[]).map((s) => (
              <button key={s} type="button" disabled={s === p.status || (p.is_default && s !== "active")} onClick={() => void setStatus(s)} className="rounded-2xl border p-3 text-left disabled:opacity-50" style={{ borderColor: s === p.status ? "var(--t-accent)" : "var(--t-card-border)" }}>
                <p className="text-sm font-black">{POINT_STATUS_INFO[s].label}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{POINT_STATUS_INFO[s].help}</p>
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </main>
  );
}

export default function PointPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <PointDossier id={id} />
    </Suspense>
  );
}
