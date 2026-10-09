"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { DOC_TYPE_INFO, type PointReadiness } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "../fiscal/useFiscal";
import { Badge, Button, Card, Drawer, Field, Notice, Toggle, inputCls, inputStyle, notify } from "../fiscal/ui";
import { EntityFields, EstablishmentFields, emptyEntity, entityPayload, type EntityDraft, type EstDraft } from "../fiscal/EntitiesTab";
import { loadTeam, memberName, type TeamMember } from "./shared";

const STEPS = ["General", "Responsable", "Información fiscal", "Establecimiento", "Facturación electrónica", "Numeración", "Usuarios", "Revisión"];

type Mode = "skip" | "existing" | "new";

export function PointWizard({ access, onClose, onCreated }: { access: FiscalAccess; onClose: () => void; onCreated: () => void }) {
  const store = access.store!;
  const fiscalOk = access.can("fiscal_config");
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [ov, setOv] = useState<FiscalOverview | null>(null);
  const [point, setPoint] = useState({ name: "", code: "", description: "", address: "", phone: "", city: "", email: "", kind: "point" as "point" | "warehouse" });
  const [resp, setResp] = useState({ responsible_name: "", responsible_doc: "", responsible_phone: "", responsible_email: "", responsible_user_id: "" });
  const [entMode, setEntMode] = useState<Mode>("skip");
  const [entityId, setEntityId] = useState("");
  const [entity, setEntity] = useState<EntityDraft>(emptyEntity());
  const [estMode, setEstMode] = useState<Mode>("skip");
  const [est, setEst] = useState<EstDraft>({ fiscal_entity_id: "", point_id: "", name: "", code: "", address: "", city: "", department: "", phone: "", email: "", status: "active" });
  const [provMode, setProvMode] = useState<Mode>("skip");
  const [prov, setProv] = useState({ account_id: "", provider: "sandbox", environment: "sandbox", label: "", pos_document_type: "invoice", confirm_production: false });
  const [numMode, setNumMode] = useState<Mode>("skip");
  const [num, setNum] = useState({ range_id: "", document_type: "invoice", resolution_number: "", resolution_date: "", valid_from: "", valid_until: "", prefix: "", range_from: "1", range_to: "", status: "draft" });
  const [users, setUsers] = useState<string[]>([]);
  const [activate, setActivate] = useState(true);
  const [result, setResult] = useState<PointReadiness | null>(null);

  useEffect(() => {
    void (async () => {
      const [t, o] = await Promise.all([
        access.can("users") ? loadTeam(store.id) : Promise.resolve([]),
        access.canAny(["fiscal", "fiscal_config"]) ? fiscalRpc<FiscalOverview>("fiscal_overview", { p_store: store.id }).catch(() => null) : Promise.resolve(null),
      ]);
      setTeam(t);
      setOv(o);
    })();
  }, [access, store.id]);

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };

  function next() {
    if (step === 0 && point.name.trim().length < 2) return void notify("Escribe el nombre del punto", "warning");
    if (step === 2 && entMode === "existing" && !entityId) return void notify("Elige el contribuyente", "warning");
    if (step === 2 && entMode === "new" && (!entity.legal_name.trim() || !entity.document_number.trim())) return void notify("Completa nombre y documento del contribuyente", "warning");
    if (step === 3 && estMode === "new" && (!est.name.trim() || !est.address.trim())) return void notify("Completa nombre y dirección del establecimiento", "warning");
    if (step === 4 && prov.environment === "production" && !prov.confirm_production) return void notify("Confirma el uso de producción o elige pruebas", "warning");
    if (step === 5 && numMode === "new" && (!num.range_from || !num.range_to)) return void notify("Completa el rango de numeración", "warning");
    if (step === 1 && !est.address && point.address) setEst((e) => ({ ...e, name: e.name || point.name, address: point.address, city: point.city }));
    if (step === 2 && entMode === "new" && !est.address) setEst((e) => ({ ...e, name: e.name || point.name, address: point.address || entity.fiscal_address, city: point.city || entity.city, department: entity.department }));
    go(Math.min(step + 1, STEPS.length - 1));
  }

  const hasEntity = entMode !== "skip";
  const entityName = entMode === "existing" ? ov?.entities.find((e) => e.id === entityId)?.legal_name : entity.legal_name;

  async function submit() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        point: { ...point, ...resp, responsible_user_id: resp.responsible_user_id || null },
        entity: entMode === "existing" ? { mode: "existing", id: entityId } : entMode === "new" ? { mode: "new", ...entityPayload(entity) } : { mode: "skip" },
        establishment: hasEntity && estMode === "new" ? { mode: "new", ...est } : { mode: "skip" },
        provider: hasEntity && provMode !== "skip" ? { mode: provMode, ...prov } : { mode: "skip", environment: prov.environment, pos_document_type: prov.pos_document_type },
        numbering: hasEntity && numMode === "new" ? { mode: "new", ...num, range_from: Number(num.range_from), range_to: Number(num.range_to), resolution_date: num.resolution_date || null, valid_from: num.valid_from || null, valid_until: num.valid_until || null }
          : hasEntity && numMode === "existing" ? { mode: "existing", range_id: num.range_id } : { mode: "skip" },
        users: users.map((user_id) => ({ user_id })),
        activate,
      };
      const res = await fiscalRpc<{ point_id: string; readiness: PointReadiness }>("erp_point_wizard_create", { p_store: store.id, p_payload: payload });
      setResult(res.readiness);
      await notify("Punto creado");
    } catch (err) {
      await notify("No se pudo crear el punto", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const modeButtons = (value: Mode, set: (m: Mode) => void, options: Array<[Mode, string]>) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([m, l]) => (
        <button key={m} type="button" onClick={() => set(m)} className="rounded-full border px-3.5 py-1.5 text-xs font-bold" style={value === m ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
      ))}
    </div>
  );

  const review: Array<[string, string]> = [
    ["Punto", `${point.name.toUpperCase()}${point.code ? ` (${point.code.toUpperCase()})` : ""} · ${point.kind === "point" ? "Punto de venta" : "Bodega"}`],
    ["Dirección", [point.address, point.city].filter(Boolean).join(" · ") || "—"],
    ["Responsable", resp.responsible_name || "—"],
    ["Contribuyente", hasEntity ? `${entityName ?? ""}${entMode === "new" ? ` · ${entity.document_type} ${entity.document_number}` : ""}` : "Se configura después"],
    ["Establecimiento", hasEntity && estMode === "new" ? `${est.name} · ${est.address}` : "—"],
    ["Proveedor", hasEntity && provMode !== "skip" ? `${provMode === "existing" ? ov?.accounts.find((a) => a.id === prov.account_id)?.provider_name ?? "Cuenta existente" : prov.provider} · ${prov.environment === "production" ? "🟢 Producción" : "🧪 Pruebas"}` : "Se configura después"],
    ["Numeración", hasEntity && numMode === "new" ? `${num.prefix || "Sin prefijo"} ${num.range_from}–${num.range_to}` : hasEntity && numMode === "existing" ? "Comparte una existente" : "Se configura después"],
    ["Usuarios", users.length ? users.map((id) => memberName(team.find((m) => m.user_id === id)!)).join(", ") : "Ninguno"],
    ["Al terminar", activate ? "Activo para operar (la facturación se activa después de probar la conexión)" : "En borrador"],
  ];

  return (
    <Drawer open onClose={onClose} kicker={`Paso ${step + 1} de ${STEPS.length}`} title={result ? "¡Punto creado!" : STEPS[step]} width="max-w-3xl"
      subtitle={
        <div className="mt-1 flex gap-1">
          {STEPS.map((s, i) => (
            <button key={s} type="button" title={s} disabled={Boolean(result) || i > step} onClick={() => go(i)} className="h-1.5 flex-1 rounded-full transition" style={{ background: i <= step ? "var(--t-accent)" : "var(--t-card-border)" }} />
          ))}
        </div>
      }
      footer={result ? <Button variant="primary" onClick={onCreated}>Listo</Button> : (
        <>
          <Button variant="ghost" icon={<ArrowLeft size={15} />} disabled={step === 0} onClick={() => go(step - 1)}>Atrás</Button>
          {step < STEPS.length - 1 ? <Button variant="primary" onClick={next}>Siguiente <ArrowRight size={15} /></Button> : <Button variant="good" icon={<Check size={15} />} busy={busy} onClick={() => void submit()}>Crear punto</Button>}
        </>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone={result.ready ? "good" : "warn"} icon={result.ready ? "🟢" : "🔴"}>{result.ready ? "Listo para facturar." : "No listo para facturar todavía. Esto es lo que falta:"}</Notice>
          <ul className="space-y-1.5">
            {result.checks.map((c) => <li key={c.key} className="text-sm">{c.na ? "➖" : c.ok ? "✅" : "🔴"} <b>{c.label}</b>{c.detail ? <span className="text-xs" style={{ color: "var(--t-muted)" }}> · {c.detail}</span> : null}</li>)}
          </ul>
        </div>
      ) : (
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.2 }} className="space-y-3">
            {step === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre del punto" required className="sm:col-span-2"><input autoFocus className={`${inputCls} uppercase`} style={inputStyle} value={point.name} onChange={(e) => setPoint({ ...point, name: e.target.value })} placeholder="Ej: PUNTO MARÍA" /></Field>
                <Field label="Código" hint="Si lo dejas vacío se genera uno."><input className={`${inputCls} uppercase`} style={inputStyle} value={point.code} onChange={(e) => setPoint({ ...point, code: e.target.value })} /></Field>
                <Field label="Tipo">
                  <select className={inputCls} style={inputStyle} value={point.kind} onChange={(e) => setPoint({ ...point, kind: e.target.value as "point" | "warehouse" })}>
                    <option value="point">📍 Punto de venta</option><option value="warehouse">🏬 Bodega</option>
                  </select>
                </Field>
                <Field label="Dirección" className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={point.address} onChange={(e) => setPoint({ ...point, address: e.target.value })} /></Field>
                <Field label="Ciudad"><input className={`${inputCls} uppercase`} style={inputStyle} value={point.city} onChange={(e) => setPoint({ ...point, city: e.target.value })} /></Field>
                <Field label="Teléfono"><input className={inputCls} style={inputStyle} value={point.phone} onChange={(e) => setPoint({ ...point, phone: e.target.value })} /></Field>
                <Field label="Descripción" className="sm:col-span-2"><input className={inputCls} style={inputStyle} value={point.description} onChange={(e) => setPoint({ ...point, description: e.target.value })} /></Field>
              </div>
            ) : null}
            {step === 1 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Notice tone="info">El responsable administra el punto. Que la tienda madre lo vea no la vuelve responsable fiscal de sus ventas.</Notice>
                <div />
                <Field label="Nombre del responsable" className="sm:col-span-2"><input className={`${inputCls} uppercase`} style={inputStyle} value={resp.responsible_name} onChange={(e) => setResp({ ...resp, responsible_name: e.target.value })} /></Field>
                <Field label="Documento"><input className={inputCls} style={inputStyle} value={resp.responsible_doc} onChange={(e) => setResp({ ...resp, responsible_doc: e.target.value })} /></Field>
                <Field label="Celular"><input className={inputCls} style={inputStyle} value={resp.responsible_phone} onChange={(e) => setResp({ ...resp, responsible_phone: e.target.value })} /></Field>
                <Field label="Correo"><input className={inputCls} style={inputStyle} value={resp.responsible_email} onChange={(e) => setResp({ ...resp, responsible_email: e.target.value })} /></Field>
                <Field label="Usuario del sistema (opcional)">
                  <select className={inputCls} style={inputStyle} value={resp.responsible_user_id} onChange={(e) => setResp({ ...resp, responsible_user_id: e.target.value })}>
                    <option value="">Sin usuario</option>
                    {team.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
                  </select>
                </Field>
              </div>
            ) : null}
            {step === 2 ? (
              fiscalOk ? (
                <>
                  <p className="text-sm" style={{ color: "var(--t-muted)" }}>¿Quién es el contribuyente (NIT o cédula) que factura las ventas de este punto?</p>
                  {modeButtons(entMode, setEntMode, [["skip", "Configurar después"], ...(ov?.entities.length ? [["existing", "Uno existente"] as [Mode, string]] : []), ["new", "Nuevo contribuyente"]])}
                  {entMode === "existing" ? (
                    <Field label="Contribuyente">
                      <select className={inputCls} style={inputStyle} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                        <option value="">Elige…</option>
                        {ov?.entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name} · {e.document_number}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  {entMode === "new" ? <EntityFields value={entity} onChange={setEntity} /> : null}
                </>
              ) : <Notice tone="warn">No tienes el permiso «Configuración fiscal»: este paso lo completa quien lo tenga desde la ficha del punto.</Notice>
            ) : null}
            {step === 3 ? (
              hasEntity ? (
                <>
                  {modeButtons(estMode, setEstMode, [["skip", "Después"], ["new", "Registrar establecimiento"]])}
                  {estMode === "new" ? <EstablishmentFields value={est} onChange={setEst} /> : null}
                </>
              ) : <Notice tone="info">Sin contribuyente no hay establecimiento que registrar. Puedes seguir.</Notice>
            ) : null}
            {step === 4 ? (
              hasEntity ? (
                <>
                  {modeButtons(provMode, setProvMode, [["skip", "Después"], ...((ov?.accounts.length && entMode === "existing") ? [["existing", "Cuenta existente"] as [Mode, string]] : []), ["new", "Nueva cuenta"]])}
                  {provMode === "existing" ? (
                    <Field label="Cuenta del proveedor">
                      <select className={inputCls} style={inputStyle} value={prov.account_id} onChange={(e) => setProv({ ...prov, account_id: e.target.value })}>
                        <option value="">Elige…</option>
                        {ov?.accounts.filter((a) => a.fiscal_entity_id === entityId).map((a) => <option key={a.id} value={a.id}>{a.provider_name} · {a.environment === "production" ? "Producción" : "Pruebas"}{a.label ? ` · ${a.label}` : ""}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  {provMode === "new" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Proveedor">
                        <select className={inputCls} style={inputStyle} value={prov.provider} onChange={(e) => setProv({ ...prov, provider: e.target.value, environment: e.target.value === "sandbox" ? "sandbox" : prov.environment })}>
                          {(ov?.providers ?? [{ code: "sandbox", name: "Simulador RemHub (pruebas)", status: "available" }]).map((p) => <option key={p.code} value={p.code}>{p.name}{p.status !== "available" ? " (pendiente)" : ""}</option>)}
                        </select>
                      </Field>
                      <Field label="Nombre de la cuenta"><input className={inputCls} style={inputStyle} value={prov.label} onChange={(e) => setProv({ ...prov, label: e.target.value })} /></Field>
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Ambiente" hint="Empieza en pruebas. Producción transmite documentos reales.">
                      <select className={inputCls} style={inputStyle} value={prov.environment} disabled={prov.provider === "sandbox" && provMode === "new"} onChange={(e) => setProv({ ...prov, environment: e.target.value })}>
                        <option value="sandbox">🧪 Pruebas</option><option value="production">🟢 Producción</option>
                      </select>
                    </Field>
                    <Field label="Documento del POS al elegir «Factura»" hint="REQUIERE VALIDACIÓN CONTABLE.">
                      <select className={inputCls} style={inputStyle} value={prov.pos_document_type} onChange={(e) => setProv({ ...prov, pos_document_type: e.target.value })}>
                        <option value="invoice">Factura electrónica de venta</option><option value="pos_equivalent">Documento equivalente electrónico POS</option>
                      </select>
                    </Field>
                  </div>
                  {prov.environment === "production" ? <Toggle checked={prov.confirm_production} onChange={(v) => setProv({ ...prov, confirm_production: v })} label="Confirmo que este punto está habilitado en producción" hint="La habilitación ante la DIAN la confirma el proveedor y la contadora." /> : null}
                  <Notice tone="info">Las credenciales se guardan después, cifradas, desde Centro fiscal → Proveedor (y ahí haces la prueba de conexión).</Notice>
                </>
              ) : <Notice tone="info">Sin contribuyente no hay proveedor que configurar.</Notice>
            ) : null}
            {step === 5 ? (
              hasEntity ? (
                <>
                  {modeButtons(numMode, setNumMode, [["skip", "Después"], ...(ov?.ranges.some((r) => r.fiscal_entity_id === entityId) ? [["existing", "Compartir una existente"] as [Mode, string]] : []), ["new", "Nueva resolución"]])}
                  {numMode === "existing" ? (
                    <>
                      <Notice tone="warn">Compartir una numeración entre puntos <b>requiere validación contable</b>.</Notice>
                      <select className={inputCls} style={inputStyle} value={num.range_id} onChange={(e) => setNum({ ...num, range_id: e.target.value })}>
                        <option value="">Elige…</option>
                        {ov?.ranges.filter((r) => r.fiscal_entity_id === entityId).map((r) => <option key={r.id} value={r.id}>{r.prefix || "Sin prefijo"} {r.range_from}–{r.range_to} · {DOC_TYPE_INFO[r.document_type].short}</option>)}
                      </select>
                    </>
                  ) : null}
                  {numMode === "new" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Tipo de documento">
                        <select className={inputCls} style={inputStyle} value={num.document_type} onChange={(e) => setNum({ ...num, document_type: e.target.value })}>
                          <option value="invoice">Factura electrónica</option><option value="pos_equivalent">Documento equivalente POS</option><option value="credit_note">Nota crédito</option><option value="debit_note">Nota débito</option>
                        </select>
                      </Field>
                      <Field label="Número de resolución"><input className={inputCls} style={inputStyle} value={num.resolution_number} onChange={(e) => setNum({ ...num, resolution_number: e.target.value })} /></Field>
                      <Field label="Fecha de la resolución"><input type="date" className={inputCls} style={inputStyle} value={num.resolution_date} onChange={(e) => setNum({ ...num, resolution_date: e.target.value })} /></Field>
                      <Field label="Prefijo"><input className={`${inputCls} uppercase`} style={inputStyle} value={num.prefix} maxLength={10} onChange={(e) => setNum({ ...num, prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></Field>
                      <Field label="Vigente desde"><input type="date" className={inputCls} style={inputStyle} value={num.valid_from} onChange={(e) => setNum({ ...num, valid_from: e.target.value })} /></Field>
                      <Field label="Vigente hasta"><input type="date" className={inputCls} style={inputStyle} value={num.valid_until} onChange={(e) => setNum({ ...num, valid_until: e.target.value })} /></Field>
                      <Field label="Desde"><input inputMode="numeric" className={inputCls} style={inputStyle} value={num.range_from} onChange={(e) => setNum({ ...num, range_from: e.target.value.replace(/\D/g, "") })} /></Field>
                      <Field label="Hasta"><input inputMode="numeric" className={inputCls} style={inputStyle} value={num.range_to} onChange={(e) => setNum({ ...num, range_to: e.target.value.replace(/\D/g, "") })} /></Field>
                      <Toggle checked={num.status === "active"} onChange={(v) => setNum({ ...num, status: v ? "active" : "draft" })} label="Activar la numeración" hint="Requiere número, fecha y vigencia de la resolución." />
                    </div>
                  ) : null}
                </>
              ) : <Notice tone="info">Sin contribuyente no hay numeración que cargar.</Notice>
            ) : null}
            {step === 6 ? (
              team.length ? (
                <>
                  <p className="text-sm" style={{ color: "var(--t-muted)" }}>Elige los usuarios que trabajarán en este punto (solo verán y operarán este punto).</p>
                  <div className="space-y-1.5">
                    {team.filter((m) => m.role !== "store_admin").map((m) => {
                      const on = users.includes(m.user_id);
                      return (
                        <button key={m.user_id} type="button" onClick={() => setUsers(on ? users.filter((x) => x !== m.user_id) : [...users, m.user_id])} className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm" style={on ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                          <span><b>{memberName(m)}</b> <span className="text-xs" style={{ color: "var(--t-muted)" }}>@{m.username}</span></span>
                          {on ? <Badge tone="good">Asignado</Badge> : m.point_id ? <Badge>Tiene otro punto</Badge> : <Badge>Sin punto</Badge>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>Para crear usuarios nuevos ve a Ajustes → Usuarios y asígnales este punto.</p>
                </>
              ) : <Notice tone="info">No hay usuarios para asignar (o no tienes el permiso de Usuarios). Puedes hacerlo después.</Notice>
            ) : null}
            {step === 7 ? (
              <>
                <Card className="space-y-2">
                  {review.map(([k, v]) => (
                    <div key={k} className="flex flex-wrap justify-between gap-2 border-b pb-1.5 text-sm last:border-0" style={{ borderColor: "var(--t-card-border)" }}>
                      <span style={{ color: "var(--t-muted)" }}>{k}</span><b className="text-right">{v}</b>
                    </div>
                  ))}
                </Card>
                <Toggle checked={activate} onChange={setActivate} label="Activar el punto al crearlo" hint="Activo operacionalmente no significa habilitado fiscalmente: la facturación se activa cuando todo esté verificado." />
                <Notice tone="info">Todo se crea en una sola operación: si algo falla, no queda nada a medias.</Notice>
              </>
            ) : null}
          </motion.div>
        </AnimatePresence>
      )}
    </Drawer>
  );
}
