"use client";

import { useState } from "react";
import Link from "next/link";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import type { OrgSettings } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, Field, Notice, SectionTitle, Toggle, askReasonDialog, confirmDialog, inputCls, inputStyle, notify } from "./ui";

export function SettingsTab({ access, data, reload }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void> }) {
  const s = data.settings;
  const [days, setDays] = useState(String(s?.remission_max_days ?? 5));
  const [fcDoc, setFcDoc] = useState(s?.final_consumer_doc ?? "222222222222");
  const [fcName, setFcName] = useState(s?.final_consumer_name ?? "CONSUMIDOR FINAL");
  const canFiscal = access.can("fiscal_config");
  const canStore = access.canAny(["store", "users"]);

  async function save(patch: Partial<OrgSettings>, title: string, warning?: string) {
    if (warning && !(await confirmDialog(title, warning, "Sí, cambiar", true))) return;
    const reason = await askReasonDialog(title);
    if (!reason) return;
    try {
      await fiscalRpc("erp_org_settings_save", { p_store: access.store?.id, p_patch: patch, p_reason: reason });
      await notify("Configuración guardada");
      await reload();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    }
  }

  if (!s) return <Notice tone="warn">No se encontró la configuración de la tienda.</Notice>;
  return (
    <div className="space-y-4">
      <SectionTitle title="Configuración de la tienda madre" subtitle="Reglas que aplican a todos los puntos. Cada cambio pide motivo y queda auditado." />
      <Card className="space-y-3">
        <Toggle checked={s.fiscal_enabled} disabled={!canFiscal} label="Facturación electrónica de la tienda"
          hint="Interruptor general. Si lo apagas, ningún punto transmite (útil ante una falla grave). Cada punto se activa por separado en su ficha."
          onChange={(v) => void save({ fiscal_enabled: v }, v ? "Activar facturación electrónica" : "Apagar facturación electrónica", v ? undefined : "Ningún punto podrá transmitir documentos hasta volver a activarla.")} />
        <Toggle checked={s.shared_customers} disabled={!canStore} label="Clientes compartidos entre puntos"
          hint="Activo: todos los puntos ven los mismos terceros y su cartera. Apagado: cada punto ve los suyos y los creados por la tienda madre."
          onChange={(v) => void save({ shared_customers: v }, v ? "Compartir clientes" : "Separar clientes por punto")} />
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-black">Remisiones de venta en puntos habilitados</p>
        <Notice tone="warn" icon="⚖️">Qué operaciones deben facturarse electrónicamente y en qué plazo <b>lo define la normativa y tu contadora</b>. RemHub solo aplica la regla que configures; nunca oculta ventas.</Notice>
        <div className="grid gap-2 sm:grid-cols-3">
          {([["allow", "Sin control", "Las remisiones no generan avisos."], ["warn", "Avisar", "Alerta cuando una remisión supera el plazo sin factura."], ["block", "Bloquear", "En puntos habilitados no se crean remisiones de venta: se factura."]] as const).map(([v, l, h]) => (
            <button key={v} type="button" disabled={!canFiscal} onClick={() => v !== s.remission_policy && void save({ remission_policy: v }, `Regla de remisiones: ${l}`)} className="rounded-2xl border p-3 text-left" style={s.remission_policy === v ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
              <p className="text-sm font-black">{l} {s.remission_policy === v ? <Badge tone="good">Actual</Badge> : null}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>{h}</p>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Plazo para facturar una remisión (días)"><input inputMode="numeric" className={inputCls} style={inputStyle} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button disabled={!canFiscal || Number(days) === s.remission_max_days} onClick={() => void save({ remission_max_days: Number(days) || 0 }, "Cambiar plazo de remisiones")}>Guardar plazo</Button>
        </div>
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-black">Consumidor final</p>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Identificación usada cuando la venta no tiene cliente registrado. REQUIERE VALIDACIÓN CONTABLE.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Documento"><input inputMode="numeric" className={inputCls} style={inputStyle} value={fcDoc} onChange={(e) => setFcDoc(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Nombre"><input className={`${inputCls} uppercase`} style={inputStyle} value={fcName} onChange={(e) => setFcName(e.target.value)} /></Field>
          <Button disabled={!canFiscal} onClick={() => void save({ final_consumer_doc: fcDoc, final_consumer_name: fcName }, "Cambiar consumidor final")}>Guardar</Button>
        </div>
      </Card>
      <Card>
        <p className="mb-2 text-sm font-black">Configuración fiscal por punto</p>
        <div className="flex flex-wrap gap-2">
          {data.points.map((p) => (
            <Link key={p.point.id} href={`/dashboard/puntos/${p.point.id}?tab=fiscal`} className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              {p.ready ? "🟢" : "🔴"} {p.point.name}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
