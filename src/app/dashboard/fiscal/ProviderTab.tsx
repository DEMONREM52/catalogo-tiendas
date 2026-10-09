"use client";

import { useState } from "react";
import { KeyRound, Pencil, PlugZap, Plus, Power, ShieldCheck, Wifi } from "lucide-react";
import Swal from "sweetalert2";
import { errorText, fiscalApi, fiscalRpc } from "@/lib/fiscal/client";
import { PROVIDER_CREDENTIAL_FIELDS, PROVIDER_SETTINGS_HELP } from "@/lib/fiscal/provider-fields";
import type { ProviderAccount } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, CopyButton, Drawer, EmptyState, EnvBadge, Field, Notice, SectionTitle, askReasonDialog, fmtDate, fmtDateTime, inputCls, inputStyle, notify, swal } from "./ui";

type AccountDraft = { id?: string; fiscal_entity_id: string; provider: string; environment: string; label: string; external_account_id: string; settings: Record<string, string>; credentials: Record<string, string> };

const ACCOUNT_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Sin probar", tone: "warn" }, connected: { label: "Conectado", tone: "good" }, error: { label: "Con error", tone: "bad" }, disconnected: { label: "Desconectado", tone: "neutral" },
};

export function ProviderTab({ access, data, reload }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [cert, setCert] = useState<null | { id?: string; fiscal_entity_id: string; managed_by: string; subject: string; issuer: string; serial_number: string; valid_from: string; valid_until: string; status: string; notes: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = access.can("fiscal_provider");
  const canConfig = access.can("fiscal_config");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function openNew() {
    setDraft({ fiscal_entity_id: data.entities[0]?.id ?? "", provider: "sandbox", environment: "sandbox", label: "", external_account_id: "", settings: { simulate: "accept" }, credentials: {} });
  }
  function openEdit(a: ProviderAccount) {
    setDraft({
      id: a.id, fiscal_entity_id: a.fiscal_entity_id, provider: a.provider, environment: a.environment, label: a.label ?? "", external_account_id: a.external_account_id ?? "",
      settings: Object.fromEntries(Object.entries(a.settings ?? {}).map(([k, v]) => [k, String(v)])), credentials: {},
    });
  }

  async function save() {
    if (!draft || !access.store) return;
    if (!draft.fiscal_entity_id) return void notify("Elige el contribuyente", "warning");
    let reason: string | null = null;
    if (draft.id) {
      reason = await askReasonDialog("Motivo del cambio", "Los cambios del proveedor tecnológico quedan auditados.");
      if (!reason) return;
    }
    setBusy("save");
    try {
      const res = await fiscalApi<{ account_id: string; webhook_url: string }>("/api/fiscal/providers", {
        store_id: access.store.id, reason,
        account: { id: draft.id, fiscal_entity_id: draft.fiscal_entity_id, provider: draft.provider, environment: draft.environment, label: draft.label, external_account_id: draft.external_account_id, settings: draft.settings },
        credentials: draft.credentials,
      });
      await notify("Proveedor guardado", "success", "Ahora haz la prueba de conexión.");
      setDraft(null);
      await reload();
      void res;
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function test(a: ProviderAccount) {
    setBusy(`test-${a.id}`);
    try {
      const res = await fiscalApi<{ health: { ok: boolean; message: string } }>("/api/fiscal/providers/test", { account_id: a.id });
      await notify(res.health.ok ? "Conexión correcta" : "La prueba falló", res.health.ok ? "success" : "warning", res.health.message);
      await reload();
    } catch (err) {
      await notify("No se pudo probar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function secret(a: ProviderAccount) {
    setBusy(`secret-${a.id}`);
    try {
      const res = await fiscalApi<{ secret: string }>("/api/fiscal/providers", { action: "generate_webhook_secret", account_id: a.id });
      await Swal.fire({ ...swal, icon: "success", title: "Secreto del webhook", html: `Cópialo ahora: <b>no se volverá a mostrar</b>.<br/><code style="word-break:break-all;font-size:12px">${res.secret}</code>`, confirmButtonText: "Ya lo copié" });
      await reload();
    } catch (err) {
      await notify("No se pudo generar", "error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(a: ProviderAccount, status: "disconnected" | "draft") {
    const reason = await askReasonDialog(status === "disconnected" ? "Desconectar proveedor" : "Reconectar proveedor", status === "disconnected" ? "Los puntos que lo usan dejarán de transmitir hasta reconectarlo." : "Quedará pendiente de una nueva prueba de conexión.");
    if (!reason) return;
    try {
      await fiscalRpc("fiscal_provider_account_set_status", { p_account: a.id, p_status: status, p_reason: reason });
      await reload();
    } catch (err) {
      await notify("No se pudo cambiar", "error", errorText(err));
    }
  }

  async function saveCert() {
    if (!cert || !access.store) return;
    if (!cert.valid_until) return void notify("Indica hasta cuándo es válido", "warning");
    try {
      await fiscalRpc("fiscal_certificate_save", { p_store: access.store.id, p_data: cert, p_reason: null });
      setCert(null);
      await reload();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    }
  }

  const entityName = (id: string) => data.entities.find((e) => e.id === id)?.legal_name ?? "Contribuyente";
  const usedBy = (id: string) => data.points.filter((p) => p.provider?.account_id === id).map((p) => p.point.name);
  const providerInfo = draft ? data.providers.find((p) => p.code === draft.provider) : null;

  return (
    <div className="space-y-5">
      <SectionTitle title="Proveedor tecnológico" subtitle="RemHub no se acopla a un solo proveedor: cada contribuyente y ambiente tiene su propia cuenta y credenciales cifradas."
        actions={canEdit && data.entities.length ? <Button variant="primary" icon={<Plus size={15} />} onClick={openNew}>Conectar proveedor</Button> : null} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {data.providers.map((p) => (
          <div key={p.code} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-sm font-black">{p.name}</p>
            <Badge tone={p.status === "available" ? "good" : "neutral"}>{p.status === "available" ? "Disponible" : "Pendiente (TODO)"}</Badge>
            <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{p.notes}</p>
          </div>
        ))}
      </div>

      {data.accounts.length === 0 ? (
        <EmptyState icon="🔌" title="Ningún proveedor conectado" text="Para probar todo el flujo sin riesgo usa el «Simulador RemHub» en ambiente de pruebas. Cuando tengas el contrato con tu proveedor (Alegra u otro), lo conectas aquí." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.accounts.map((a) => {
            const st = ACCOUNT_STATUS[a.status] ?? ACCOUNT_STATUS.draft;
            const url = a.webhook_path ? `${origin}${a.webhook_path}` : null;
            return (
              <Card key={a.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-base font-black"><PlugZap size={16} /> {a.provider_name ?? a.provider}{a.label ? ` · ${a.label}` : ""}</p>
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>{entityName(a.fiscal_entity_id)}{usedBy(a.id).length ? ` · usado en ${usedBy(a.id).join(", ")}` : " · sin puntos"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5"><EnvBadge env={a.environment} /><Badge tone={st.tone}>{st.label}</Badge></div>
                </div>
                <div className="grid gap-1 text-xs">
                  <p><span style={{ color: "var(--t-muted)" }}>Última prueba:</span> {a.last_test_at ? `${fmtDateTime(a.last_test_at)} · ${a.last_test_ok ? "✅ OK" : "❌ falló"}` : "nunca"}</p>
                  {a.last_error ? <p className="text-red-500">{a.last_error}</p> : null}
                  <p><span style={{ color: "var(--t-muted)" }}>Webhook:</span> {a.supports_webhooks ? `${a.webhook_status === "ok" ? "🟢 funcionando" : a.webhook_status === "failing" ? "🔴 con fallas" : "⚪ sin eventos"}${a.webhook_last_event_at ? ` · último ${fmtDateTime(a.webhook_last_event_at)}` : ""}` : "no aplica"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(a.credentials_hint ?? {}).map(([k, v]) => <Badge key={k} tone="info">🔒 {k}: {v}</Badge>)}
                    {!Object.keys(a.credentials_hint ?? {}).length ? <Badge>Sin credenciales guardadas</Badge> : null}
                  </div>
                </div>
                {url ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                    <code className="min-w-0 flex-1 truncate text-[11px]">{url}</code>
                    <CopyButton text={url} label="Copiar URL" />
                  </div>
                ) : null}
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" icon={<Wifi size={14} />} busy={busy === `test-${a.id}`} onClick={() => void test(a)}>Probar conexión</Button>
                    <Button icon={<Pencil size={14} />} onClick={() => openEdit(a)}>Editar / credenciales</Button>
                    {a.supports_webhooks ? <Button icon={<KeyRound size={14} />} busy={busy === `secret-${a.id}`} onClick={() => void secret(a)}>Generar secreto</Button> : null}
                    {a.status === "disconnected"
                      ? <Button icon={<Power size={14} />} onClick={() => void setStatus(a, "draft")}>Reconectar</Button>
                      : <Button variant="danger" icon={<Power size={14} />} onClick={() => void setStatus(a, "disconnected")}>Desconectar</Button>}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <SectionTitle title="Certificados" subtitle="Solo si el proveedor exige certificado propio del contribuyente. RemHub avisa antes del vencimiento."
          icon={<ShieldCheck size={16} />} actions={canConfig && data.entities.length ? <Button icon={<Plus size={14} />} onClick={() => setCert({ fiscal_entity_id: data.entities[0].id, managed_by: "provider", subject: "", issuer: "", serial_number: "", valid_from: "", valid_until: "", status: "active", notes: "" })}>Registrar</Button> : null} />
        {data.certificates.length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin certificados registrados.</p> : (
          <div className="space-y-1.5">
            {data.certificates.map((c) => (
              <button key={c.id} type="button" disabled={!canConfig} onClick={() => setCert({ ...c, subject: c.subject ?? "", issuer: c.issuer ?? "", serial_number: c.serial_number ?? "", valid_from: c.valid_from ?? "", notes: c.notes ?? "" })} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                <span><b>{entityName(c.fiscal_entity_id)}</b> · {c.managed_by === "provider" ? "lo administra el proveedor" : "propio"}{c.subject ? ` · ${c.subject}` : ""}</span>
                <Badge tone={new Date(c.valid_until).getTime() < Date.now() + 30 * 86400000 ? "warn" : "good"}>Vence {fmtDate(c.valid_until)}</Badge>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} kicker="Proveedor tecnológico" title={draft?.id ? "Editar cuenta" : "Conectar proveedor"}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button><Button variant="primary" busy={busy === "save"} onClick={() => void save()}>Guardar</Button></>}>
        {draft ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contribuyente" required>
                <select className={inputCls} style={inputStyle} value={draft.fiscal_entity_id} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, fiscal_entity_id: e.target.value })}>
                  {data.entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
                </select>
              </Field>
              <Field label="Proveedor" required>
                <select className={inputCls} style={inputStyle} value={draft.provider} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, provider: e.target.value, environment: e.target.value === "sandbox" ? "sandbox" : draft.environment, credentials: {} })}>
                  {data.providers.map((p) => <option key={p.code} value={p.code}>{p.name}{p.status !== "available" ? " (pendiente)" : ""}</option>)}
                </select>
              </Field>
              <Field label="Ambiente" required hint="Las credenciales de pruebas y de producción nunca se mezclan: cada ambiente es una cuenta distinta.">
                <select className={inputCls} style={inputStyle} value={draft.environment} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, environment: e.target.value })}>
                  <option value="sandbox">🧪 Pruebas (sandbox)</option>
                  {providerInfo?.supports_production ? <option value="production">🟢 Producción</option> : null}
                </select>
              </Field>
              <Field label="Nombre de la cuenta"><input className={inputCls} style={inputStyle} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Ej: Habilitación María" /></Field>
              <Field label="Identificador de la empresa en el proveedor" className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={draft.external_account_id} onChange={(e) => setDraft({ ...draft, external_account_id: e.target.value })} /></Field>
            </div>
            {providerInfo?.status !== "available" ? <Notice tone="warn">{providerInfo?.name} aún no está integrado en RemHub: puedes dejar la cuenta lista, pero no transmitirá hasta completar su adaptador con la documentación oficial.</Notice> : null}
            {(PROVIDER_SETTINGS_HELP[draft.provider] ?? []).map((s) => (
              <Field key={s.key} label={s.label} hint={s.help}>
                <select className={inputCls} style={inputStyle} value={draft.settings[s.key] ?? s.options?.[0]?.[0] ?? ""} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, [s.key]: e.target.value } })}>
                  {s.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            ))}
            {(PROVIDER_CREDENTIAL_FIELDS[draft.provider] ?? []).filter((f) => f.key !== "webhook_secret").length ? (
              <Card className="space-y-3">
                <p className="text-sm font-black">🔒 Credenciales</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>Se cifran en el servidor y nunca se vuelven a mostrar completas. Deja vacío para conservar lo guardado.</p>
                {(PROVIDER_CREDENTIAL_FIELDS[draft.provider] ?? []).filter((f) => f.key !== "webhook_secret").map((f) => (
                  <Field key={f.key} label={f.label} required={f.required && !draft.id} hint={f.help}>
                    <input type={f.secret ? "password" : "text"} autoComplete="new-password" className={inputCls} style={inputStyle} value={draft.credentials[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, credentials: { ...draft.credentials, [f.key]: e.target.value } })} />
                  </Field>
                ))}
              </Card>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer open={Boolean(cert)} onClose={() => setCert(null)} kicker="Certificado" title={cert?.id ? "Editar certificado" : "Registrar certificado"}
        footer={<><Button variant="ghost" onClick={() => setCert(null)}>Cancelar</Button><Button variant="primary" onClick={() => void saveCert()}>Guardar</Button></>}>
        {cert ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contribuyente"><select className={inputCls} style={inputStyle} value={cert.fiscal_entity_id} onChange={(e) => setCert({ ...cert, fiscal_entity_id: e.target.value })}>{data.entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select></Field>
            <Field label="Quién lo administra"><select className={inputCls} style={inputStyle} value={cert.managed_by} onChange={(e) => setCert({ ...cert, managed_by: e.target.value })}><option value="provider">El proveedor tecnológico</option><option value="own">Propio del contribuyente</option></select></Field>
            <Field label="Titular"><input className={inputCls} style={inputStyle} value={cert.subject} onChange={(e) => setCert({ ...cert, subject: e.target.value })} /></Field>
            <Field label="Emisor"><input className={inputCls} style={inputStyle} value={cert.issuer} onChange={(e) => setCert({ ...cert, issuer: e.target.value })} /></Field>
            <Field label="Serial"><input className={inputCls} style={inputStyle} value={cert.serial_number} onChange={(e) => setCert({ ...cert, serial_number: e.target.value })} /></Field>
            <Field label="Estado"><select className={inputCls} style={inputStyle} value={cert.status} onChange={(e) => setCert({ ...cert, status: e.target.value })}><option value="active">Vigente</option><option value="replaced">Reemplazado</option><option value="revoked">Revocado</option><option value="expired">Vencido</option></select></Field>
            <Field label="Válido desde"><input type="date" className={inputCls} style={inputStyle} value={cert.valid_from} onChange={(e) => setCert({ ...cert, valid_from: e.target.value })} /></Field>
            <Field label="Válido hasta" required><input type="date" className={inputCls} style={inputStyle} value={cert.valid_until} onChange={(e) => setCert({ ...cert, valid_until: e.target.value })} /></Field>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
