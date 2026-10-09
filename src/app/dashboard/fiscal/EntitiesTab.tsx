"use client";

import { useState } from "react";
import { Building, Pencil, Plus } from "lucide-react";
import { calcDv } from "../nit";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { ENTITY_DOC_TYPES, TAX_REGIME_OPTIONS, TAX_RESPONSIBILITY_SUGGESTIONS, type FiscalEntity, type FiscalEstablishment } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, ChipsInput, Drawer, EmptyState, Field, Notice, SectionTitle, Toggle, askReasonDialog, inputCls, inputStyle, notify } from "./ui";

export type EntityDraft = {
  id?: string; person_type: "natural" | "juridica"; legal_name: string; trade_name: string; document_type: string; document_number: string;
  tax_regime: string; tax_responsibilities: string[]; economic_activities: string[]; fiscal_address: string; city: string; department: string;
  country: string; phone: string; email: string; dian_email: string; rut_date: string; prices_include_tax: boolean; status: "draft" | "active" | "inactive"; notes: string;
};

export function emptyEntity(prefill: Partial<EntityDraft> = {}): EntityDraft {
  return {
    person_type: "juridica", legal_name: "", trade_name: "", document_type: "NIT", document_number: "", tax_regime: "", tax_responsibilities: [],
    economic_activities: [], fiscal_address: "", city: "", department: "", country: "CO", phone: "", email: "", dian_email: "", rut_date: "",
    prices_include_tax: true, status: "draft", notes: "", ...prefill,
  };
}

export function entityToDraft(e: FiscalEntity): EntityDraft {
  return {
    id: e.id, person_type: e.person_type, legal_name: e.legal_name, trade_name: e.trade_name ?? "", document_type: e.document_type, document_number: e.document_number ?? "",
    tax_regime: e.tax_regime ?? "", tax_responsibilities: e.tax_responsibilities ?? [], economic_activities: e.economic_activities ?? [],
    fiscal_address: e.fiscal_address ?? "", city: e.city ?? "", department: e.department ?? "", country: e.country ?? "CO", phone: e.phone ?? "",
    email: e.email ?? "", dian_email: e.dian_email ?? "", rut_date: e.rut_date ?? "", prices_include_tax: e.prices_include_tax, status: e.status, notes: e.notes ?? "",
  };
}

/** Campos del contribuyente (los usa el centro fiscal y el asistente de puntos). */
export function EntityFields({ value, onChange, locked = false }: { value: EntityDraft; onChange: (v: EntityDraft) => void; locked?: boolean }) {
  const set = (patch: Partial<EntityDraft>) => onChange({ ...value, ...patch });
  const dv = value.document_type === "NIT" ? calcDv(value.document_number) : null;
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
        {([["juridica", "🏢 Empresa (jurídica)"], ["natural", "🧑 Persona natural"]] as const).map(([v, l]) => (
          <button key={v} type="button" disabled={locked} onClick={() => set({ person_type: v, document_type: v === "juridica" ? "NIT" : value.document_type })} className="flex-1 rounded-full px-3 py-2 transition" style={value.person_type === v ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={value.person_type === "juridica" ? "Razón social" : "Nombre completo"} required className="sm:col-span-2">
          <input className={`${inputCls} uppercase`} style={inputStyle} value={value.legal_name} onChange={(e) => set({ legal_name: e.target.value })} />
        </Field>
        <Field label="Nombre comercial"><input className={`${inputCls} uppercase`} style={inputStyle} value={value.trade_name} onChange={(e) => set({ trade_name: e.target.value })} /></Field>
        <Field label="Tipo de documento" required>
          <select className={inputCls} style={inputStyle} value={value.document_type} disabled={locked} onChange={(e) => set({ document_type: e.target.value })}>
            {ENTITY_DOC_TYPES.filter(([v]) => value.person_type === "natural" || v === "NIT" || v === "NIT_EXT").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Número (sin DV)" required hint={locked ? "Este contribuyente ya facturó: su NIT no se cambia." : value.document_type === "NIT" ? "El dígito de verificación se calcula solo." : undefined}>
          <div className="flex gap-2">
            <input inputMode="numeric" className={inputCls} style={inputStyle} disabled={locked} value={value.document_number} onChange={(e) => set({ document_number: e.target.value.replace(/[^0-9A-Za-z]/g, "") })} />
            {value.document_type === "NIT" ? <span className="grid w-16 shrink-0 place-items-center rounded-xl border text-lg font-black" style={inputStyle} title="Dígito de verificación">{dv ?? "–"}</span> : null}
          </div>
        </Field>
        <Field label="Régimen / responsabilidad de IVA" required>
          <select className={inputCls} style={inputStyle} value={value.tax_regime} onChange={(e) => set({ tax_regime: e.target.value })}>
            <option value="">Elige…</option>
            {TAX_REGIME_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Fecha del RUT"><input type="date" className={inputCls} style={inputStyle} value={value.rut_date} onChange={(e) => set({ rut_date: e.target.value })} /></Field>
        <Field label="Responsabilidades tributarias (RUT, casilla 53)" required className="sm:col-span-2" hint="Copia las del RUT. Las sugerencias no reemplazan la validación de tu contadora.">
          <ChipsInput values={value.tax_responsibilities} onChange={(v) => set({ tax_responsibilities: v })} suggestions={TAX_RESPONSIBILITY_SUGGESTIONS} placeholder="Ej: O-13" />
        </Field>
        <Field label="Actividades económicas (CIIU)" className="sm:col-span-2">
          <ChipsInput values={value.economic_activities} onChange={(v) => set({ economic_activities: v })} placeholder="Código de 4 dígitos, ej: 4755" normalize={(v) => v.replace(/\D/g, "")} validate={(v) => (/^\d{4}$/.test(v) ? null : "El código CIIU tiene 4 dígitos.")} />
        </Field>
        <Field label="Dirección fiscal" required className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={value.fiscal_address} onChange={(e) => set({ fiscal_address: e.target.value })} /></Field>
        <Field label="Ciudad / municipio" required><input className={`${inputCls} uppercase`} style={inputStyle} value={value.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Departamento" required><input className={`${inputCls} uppercase`} style={inputStyle} value={value.department} onChange={(e) => set({ department: e.target.value })} /></Field>
        <Field label="Correo" required><input type="email" className={inputCls} style={inputStyle} value={value.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Correo registrado en la DIAN (RUT)"><input type="email" className={inputCls} style={inputStyle} value={value.dian_email} onChange={(e) => set({ dian_email: e.target.value })} /></Field>
        <Field label="Teléfono"><input className={inputCls} style={inputStyle} value={value.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Estado">
          <select className={inputCls} style={inputStyle} value={value.status} onChange={(e) => set({ status: e.target.value as EntityDraft["status"] })}>
            <option value="draft">Borrador (aún no factura)</option><option value="active">Activo</option><option value="inactive">Inactivo</option>
          </select>
        </Field>
      </div>
      <Toggle checked={value.prices_include_tax} onChange={(v) => set({ prices_include_tax: v })} label="Los precios del POS ya incluyen IVA" hint="El sistema separa base e impuesto de cada línea. REQUIERE VALIDACIÓN CONTABLE." />
    </div>
  );
}

export function entityPayload(d: EntityDraft) {
  return { ...d, legal_name: d.legal_name.trim(), document_number: d.document_number.trim(), rut_date: d.rut_date || null, trade_name: d.trade_name || null };
}

export type EstDraft = { id?: string; fiscal_entity_id: string; point_id: string; name: string; code: string; address: string; city: string; department: string; phone: string; email: string; status: "active" | "inactive" };

export function EstablishmentFields({ value, onChange, points, entities }: { value: EstDraft; onChange: (v: EstDraft) => void; points?: Array<{ id: string; name: string }>; entities?: FiscalEntity[] }) {
  const set = (patch: Partial<EstDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entities ? (
        <Field label="Contribuyente" required>
          <select className={inputCls} style={inputStyle} value={value.fiscal_entity_id} onChange={(e) => set({ fiscal_entity_id: e.target.value })}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
          </select>
        </Field>
      ) : null}
      {points ? (
        <Field label="Punto">
          <select className={inputCls} style={inputStyle} value={value.point_id} onChange={(e) => set({ point_id: e.target.value })}>
            <option value="">Sin punto</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Nombre del establecimiento" required><input className={`${inputCls} uppercase`} style={inputStyle} value={value.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Código" hint="Como figure en el RUT o lo indique el proveedor."><input className={`${inputCls} uppercase`} style={inputStyle} value={value.code} onChange={(e) => set({ code: e.target.value })} /></Field>
      <Field label="Dirección" required className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={value.address} onChange={(e) => set({ address: e.target.value })} /></Field>
      <Field label="Ciudad" required><input className={`${inputCls} uppercase`} style={inputStyle} value={value.city} onChange={(e) => set({ city: e.target.value })} /></Field>
      <Field label="Departamento"><input className={`${inputCls} uppercase`} style={inputStyle} value={value.department} onChange={(e) => set({ department: e.target.value })} /></Field>
      <Field label="Teléfono"><input className={inputCls} style={inputStyle} value={value.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      <Field label="Correo"><input type="email" className={inputCls} style={inputStyle} value={value.email} onChange={(e) => set({ email: e.target.value })} /></Field>
    </div>
  );
}

export async function saveEntity(storeId: string, draft: EntityDraft, original?: FiscalEntity | null) {
  let reason: string | null = null;
  const sensitive = original && (original.document_number !== draft.document_number || original.legal_name !== draft.legal_name.trim().toUpperCase()
    || original.document_type !== draft.document_type || original.person_type !== draft.person_type);
  if (sensitive) {
    reason = await askReasonDialog("Cambio de datos fiscales", "Cambiar NIT, razón social o tipo de persona queda en la auditoría fiscal con el valor anterior y el nuevo.");
    if (!reason) return null;
  }
  return fiscalRpc<{ id: string; missing: string[] }>("fiscal_entity_save", { p_store: storeId, p_data: entityPayload(draft), p_reason: reason });
}

export function EntitiesTab({ access, data, reload }: { access: FiscalAccess; data: FiscalOverview; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<EntityDraft | null>(null);
  const [est, setEst] = useState<EstDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = access.can("fiscal_config");
  const org = access.scope?.scope === "organization" || access.scope?.scope === "global";
  const points = data.points.map((p) => ({ id: p.point.id, name: p.point.name }));
  const original = draft?.id ? data.entities.find((e) => e.id === draft.id) ?? null : null;
  const locked = Boolean(original && data.ranges.some((r) => r.fiscal_entity_id === original.id && r.next_number > r.range_from));

  async function save() {
    if (!draft || !access.store) return;
    setBusy(true);
    try {
      const res = await saveEntity(access.store.id, draft, original);
      if (!res) return;
      await notify(res.missing.length ? "Guardado. Aún falta: " + res.missing.join(", ") : "Contribuyente guardado", res.missing.length ? "info" : "success");
      setDraft(null);
      await reload();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEst() {
    if (!est || !access.store) return;
    setBusy(true);
    try {
      await fiscalRpc("fiscal_establishment_save", { p_store: access.store.id, p_data: { ...est, point_id: est.point_id || null }, p_reason: null });
      await notify("Establecimiento guardado");
      setEst(null);
      await reload();
    } catch (err) {
      await notify("No se pudo guardar", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Contribuyentes (entidades fiscales)"
        subtitle="Cada punto factura con la identidad fiscal de su responsable. Ver un punto no te hace responsable de sus ventas."
        actions={canEdit && org ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setDraft(emptyEntity())}>Nuevo contribuyente</Button> : null}
      />
      {data.entities.length === 0 ? (
        <EmptyState icon="🏛️" title="Aún no hay contribuyentes" text="Registra el NIT o la cédula de quien factura en cada punto. La información la completa el administrador; RemHub no inventa datos fiscales." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.entities.map((e) => (
            <Card key={e.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-black">{e.legal_name}</p>
                  <p className="font-mono text-xs">{e.document_type} {e.document_number ?? "—"}{e.verification_digit ? `-${e.verification_digit}` : ""}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{[e.fiscal_address, e.city, e.department].filter(Boolean).join(" · ") || "Sin dirección"}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={e.status === "active" ? "good" : e.status === "draft" ? "warn" : "neutral"}>{e.status === "active" ? "Activo" : e.status === "draft" ? "Borrador" : "Inactivo"}</Badge>
                  {canEdit ? <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => setDraft(entityToDraft(e))} aria-label="Editar" /> : null}
                </div>
              </div>
              {e.missing?.length ? <Notice tone="warn">Falta: {e.missing.join(", ")}</Notice> : null}
              <div className="flex flex-wrap gap-1.5">
                {(e.tax_responsibilities ?? []).map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                {(e.points ?? []).map((p) => <Badge key={p.id}>📍 {p.name}</Badge>)}
              </div>
              <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
                <p className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>Establecimientos</p>
                {data.establishments.filter((s) => s.fiscal_entity_id === e.id).map((s: FiscalEstablishment) => (
                  <button key={s.id} type="button" disabled={!canEdit} onClick={() => setEst({ id: s.id, fiscal_entity_id: s.fiscal_entity_id, point_id: s.point_id ?? "", name: s.name, code: s.code ?? "", address: s.address ?? "", city: s.city ?? "", department: s.department ?? "", phone: s.phone ?? "", email: s.email ?? "", status: s.status })} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    <Building size={14} /> <b>{s.name}</b> <span className="truncate text-xs" style={{ color: "var(--t-muted)" }}>{s.address} · {s.city}{s.point_id ? ` · ${points.find((p) => p.id === s.point_id)?.name ?? ""}` : ""}</span>
                  </button>
                ))}
                {canEdit ? <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setEst({ fiscal_entity_id: e.id, point_id: "", name: "", code: "", address: e.fiscal_address ?? "", city: e.city ?? "", department: e.department ?? "", phone: "", email: "", status: "active" })}>Agregar establecimiento</Button> : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} kicker="Contribuyente" title={draft?.id ? draft.legal_name || "Editar" : "Nuevo contribuyente"} width="max-w-3xl"
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Guardar</Button></>}>
        {draft ? (
          <>
            <Notice tone="info">Completa los datos tal como aparecen en el RUT. Para activarlo deben estar completos; cada cambio queda auditado.</Notice>
            <EntityFields value={draft} onChange={setDraft} locked={locked} />
          </>
        ) : null}
      </Drawer>

      <Drawer open={Boolean(est)} onClose={() => setEst(null)} kicker="Establecimiento" title={est?.id ? est.name : "Nuevo establecimiento"}
        footer={<><Button variant="ghost" onClick={() => setEst(null)}>Cancelar</Button><Button variant="primary" busy={busy} onClick={() => void saveEst()}>Guardar</Button></>}>
        {est ? <EstablishmentFields value={est} onChange={setEst} points={points} /> : null}
      </Drawer>
    </div>
  );
}
