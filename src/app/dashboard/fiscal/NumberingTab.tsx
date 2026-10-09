"use client";

import { useState } from "react";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { errorText, fiscalApi, fiscalRpc } from "@/lib/fiscal/client";
import { DOC_TYPE_INFO, FISCAL_DOC_TYPES, type RangeInfo } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, Drawer, EmptyState, EnvBadge, Field, Notice, Progress, SectionTitle, askReasonDialog, fmtDate, inputCls, inputStyle, notify } from "./ui";

type RangeDraft = {
  id?: string; fiscal_entity_id: string; document_type: string; environment: string; name: string; resolution_number: string; resolution_date: string;
  valid_from: string; valid_until: string; prefix: string; range_from: string; range_to: string; next_number: string; point_ids: string[];
  status: string; alert_percent: string; alert_days: string; technical_key: string;
};

const RANGE_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Borrador", tone: "neutral" }, active: { label: "Activa", tone: "good" }, inactive: { label: "Inactiva", tone: "neutral" },
  exhausted: { label: "Agotada", tone: "bad" }, expired: { label: "Vencida", tone: "bad" },
};

export function RangeCard({ r, points, onEdit }: { r: RangeInfo; points: Array<{ id: string; name: string }>; onEdit?: () => void }) {
  const tone = r.expired || r.remaining === 0 ? "bad" : r.near_exhaustion || r.near_expiry ? "warn" : "good";
  const status = r.expired && r.status === "active" ? RANGE_STATUS.expired : RANGE_STATUS[r.status] ?? RANGE_STATUS.draft;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-black">{DOC_TYPE_INFO[r.document_type]?.icon} {r.prefix || "Sin prefijo"} <span className="font-normal opacity-70">{r.range_from}–{r.range_to}</span></p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {DOC_TYPE_INFO[r.document_type]?.short} · {r.entity_name ?? ""}{r.resolution_number ? ` · Resolución ${r.resolution_number}` : " · Sin resolución"}{r.resolution_date ? ` del ${fmtDate(r.resolution_date)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EnvBadge env={r.environment} />
          <Badge tone={status.tone}>{status.label}</Badge>
          {onEdit ? <Button variant="ghost" icon={<Pencil size={14} />} onClick={onEdit} aria-label="Editar" /> : null}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[11px]" style={{ color: "var(--t-muted)" }}>
          <span>Siguiente número: <b style={{ color: "var(--t-text)" }}>{r.next_number}</b></span>
          <span>{r.used_pct}% usado · quedan {r.remaining}</span>
        </div>
        <Progress value={r.used_pct} tone={tone} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span style={{ color: "var(--t-muted)" }}>Vigencia:</span>
        <b>{r.valid_from ? fmtDate(r.valid_from) : "—"} → {r.valid_until ? fmtDate(r.valid_until) : "sin vencimiento"}</b>
        {r.days_left !== null ? <Badge tone={r.days_left < 0 ? "bad" : r.near_expiry ? "warn" : "neutral"}>{r.days_left < 0 ? "Vencida" : `${r.days_left} días`}</Badge> : null}
        {r.technical_key_hint ? <Badge tone="info">🔑 Clave técnica {r.technical_key_hint}</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {r.point_ids.length ? r.point_ids.map((id) => <Badge key={id}>📍 {points.find((p) => p.id === id)?.name ?? "Punto"}</Badge>) : <Badge tone="warn">Sin puntos autorizados</Badge>}
        {r.point_ids.length > 1 ? <Badge tone="warn" title="Compartir numeración entre puntos requiere validación contable">Compartida</Badge> : null}
      </div>
    </Card>
  );
}

function emptyDraft(entityId: string): RangeDraft {
  return {
    fiscal_entity_id: entityId, document_type: "invoice", environment: "sandbox", name: "", resolution_number: "", resolution_date: "", valid_from: "",
    valid_until: "", prefix: "", range_from: "1", range_to: "", next_number: "", point_ids: [], status: "draft", alert_percent: "80", alert_days: "30", technical_key: "",
  };
}

export function NumberingTab({ access, data, reload }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<RangeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = access.can("fiscal_numbering");
  const points = data.points.map((p) => ({ id: p.point.id, name: p.point.name }));

  function edit(r: RangeInfo) {
    setDraft({
      id: r.id, fiscal_entity_id: r.fiscal_entity_id ?? "", document_type: r.document_type, environment: r.environment, name: r.name ?? "",
      resolution_number: r.resolution_number ?? "", resolution_date: r.resolution_date ?? "", valid_from: r.valid_from ?? "", valid_until: r.valid_until ?? "",
      prefix: r.prefix, range_from: String(r.range_from), range_to: String(r.range_to), next_number: String(r.next_number), point_ids: r.point_ids,
      status: r.status, alert_percent: String(r.alert_percent), alert_days: String(r.alert_days), technical_key: "",
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.fiscal_entity_id) return void notify("Elige el contribuyente", "warning");
    if (!draft.range_from || !draft.range_to) return void notify("Completa el rango autorizado", "warning");
    let reason: string | null = null;
    if (draft.id) {
      reason = await askReasonDialog("Motivo del cambio", "Los cambios de numeración quedan en la auditoría fiscal.");
      if (!reason) return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        id: draft.id, fiscal_entity_id: draft.fiscal_entity_id, document_type: draft.document_type, environment: draft.environment, name: draft.name,
        resolution_number: draft.resolution_number || null, resolution_date: draft.resolution_date || null, valid_from: draft.valid_from || null,
        valid_until: draft.valid_until || null, prefix: draft.prefix.toUpperCase(), range_from: Number(draft.range_from), range_to: Number(draft.range_to),
        point_ids: draft.point_ids, status: draft.status, alert_percent: Number(draft.alert_percent) || 80, alert_days: Number(draft.alert_days) || 30,
      };
      if (draft.next_number) payload.next_number = Number(draft.next_number);
      const res = await fiscalRpc<{ id: string }>("fiscal_range_save", { p_store: access.store?.id, p_data: payload, p_reason: reason });
      if (draft.technical_key.trim()) await fiscalApi("/api/fiscal/numbering/key", { range_id: res.id, technical_key: draft.technical_key.trim() });
      await notify("Numeración guardada");
      setDraft(null);
      await reload();
    } catch (err) {
      await notify("No se pudo guardar la numeración", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<RangeDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const isNote = draft && ["credit_note", "debit_note", "support_adjustment"].includes(draft.document_type);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Resoluciones y numeración"
        subtitle="Cada rango pertenece a un contribuyente y se autoriza a uno o más puntos. Los números nunca se repiten."
        actions={canEdit && data.entities.length ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setDraft(emptyDraft(data.entities[0].id))}>Nueva numeración</Button> : null}
      />
      {!data.entities.length ? <Notice tone="warn">Primero registra un contribuyente en la pestaña «Contribuyentes».</Notice> : null}
      {data.ranges.length === 0 ? (
        <EmptyState icon="🔢" title="Aún no hay numeraciones" text="Carga aquí la resolución de numeración que te autorizó la DIAN (prefijo, rango y vigencia)." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.ranges.map((r) => <RangeCard key={r.id} r={r} points={points} onEdit={canEdit ? () => edit(r) : undefined} />)}
        </div>
      )}

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        kicker="Numeración"
        title={draft?.id ? `Editar ${draft.prefix || "numeración"}` : "Nueva numeración"}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Guardar</Button></>}
      >
        {draft ? (
          <div className="space-y-3">
            <Notice tone="info">No se asume que cada punto tenga su propia resolución: autoriza los puntos que tu contadora indique. Compartir un rango entre puntos <b>requiere validación contable</b>.</Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contribuyente" required>
                <select className={inputCls} style={inputStyle} value={draft.fiscal_entity_id} onChange={(e) => set({ fiscal_entity_id: e.target.value })} disabled={Boolean(draft.id)}>
                  {data.entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name} · {e.document_number ?? "sin NIT"}</option>)}
                </select>
              </Field>
              <Field label="Tipo de documento" required>
                <select className={inputCls} style={inputStyle} value={draft.document_type} onChange={(e) => set({ document_type: e.target.value })} disabled={Boolean(draft.id)}>
                  {FISCAL_DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_INFO[t].label}</option>)}
                </select>
              </Field>
              <Field label="Ambiente" required hint="Nunca se mezclan rangos de pruebas y de producción.">
                <select className={inputCls} style={inputStyle} value={draft.environment} onChange={(e) => set({ environment: e.target.value })} disabled={Boolean(draft.id)}>
                  <option value="sandbox">🧪 Pruebas (habilitación)</option>
                  <option value="production">🟢 Producción</option>
                </select>
              </Field>
              <Field label="Nombre interno (opcional)"><input className={inputCls} style={inputStyle} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej: Resolución 2026 Punto María" /></Field>
              <Field label={isNote ? "Número de resolución (si aplica)" : "Número de resolución"} required={!isNote}><input className={inputCls} style={inputStyle} value={draft.resolution_number} onChange={(e) => set({ resolution_number: e.target.value })} /></Field>
              <Field label="Fecha de la resolución"><input type="date" className={inputCls} style={inputStyle} value={draft.resolution_date} onChange={(e) => set({ resolution_date: e.target.value })} /></Field>
              <Field label="Vigente desde"><input type="date" className={inputCls} style={inputStyle} value={draft.valid_from} onChange={(e) => set({ valid_from: e.target.value })} /></Field>
              <Field label="Vigente hasta" required={!isNote}><input type="date" className={inputCls} style={inputStyle} value={draft.valid_until} onChange={(e) => set({ valid_until: e.target.value })} /></Field>
              <Field label="Prefijo" hint="Letras y números, sin espacios (la DIAN suele usar hasta 4 caracteres; valídalo).">
                <input className={`${inputCls} uppercase`} style={inputStyle} value={draft.prefix} maxLength={10} onChange={(e) => set({ prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desde" required><input inputMode="numeric" className={inputCls} style={inputStyle} value={draft.range_from} onChange={(e) => set({ range_from: e.target.value.replace(/\D/g, "") })} /></Field>
                <Field label="Hasta" required><input inputMode="numeric" className={inputCls} style={inputStyle} value={draft.range_to} onChange={(e) => set({ range_to: e.target.value.replace(/\D/g, "") })} /></Field>
              </div>
              <Field label="Siguiente número" hint="Solo si ya usaste números de este rango en otro sistema. Nunca puede bajar."><input inputMode="numeric" className={inputCls} style={inputStyle} value={draft.next_number} onChange={(e) => set({ next_number: e.target.value.replace(/\D/g, "") })} placeholder={draft.range_from} /></Field>
              <Field label="Estado">
                <select className={inputCls} style={inputStyle} value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  <option value="draft">Borrador</option><option value="active">Activa</option><option value="inactive">Inactiva</option>
                </select>
              </Field>
              <Field label="Avisar al usar (%)"><input inputMode="numeric" className={inputCls} style={inputStyle} value={draft.alert_percent} onChange={(e) => set({ alert_percent: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field label="Avisar días antes de vencer"><input inputMode="numeric" className={inputCls} style={inputStyle} value={draft.alert_days} onChange={(e) => set({ alert_days: e.target.value.replace(/\D/g, "") })} /></Field>
            </div>
            <Field label="Puntos autorizados" required>
              <div className="flex flex-wrap gap-1.5">
                {points.map((p) => {
                  const on = draft.point_ids.includes(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => set({ point_ids: on ? draft.point_ids.filter((x) => x !== p.id) : [...draft.point_ids, p.id] })} className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                      📍 {p.name}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Clave técnica (opcional)" hint="La entrega la DIAN con la resolución. Se guarda cifrada en el servidor y solo se muestra «••••1234».">
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <input type="password" autoComplete="new-password" className={inputCls} style={{ ...inputStyle, paddingLeft: "2.2rem" }} value={draft.technical_key} onChange={(e) => set({ technical_key: e.target.value })} placeholder="Pega la clave técnica" />
              </div>
            </Field>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
