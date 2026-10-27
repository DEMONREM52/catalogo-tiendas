"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { errorText, fiscalApi, fiscalRpc, newIdempotencyKey } from "@/lib/fiscal/client";
import { Btn, inputClass, inputStyle, money, toast } from "./shared";
import { NO_AUTOFILL } from "@/components/forms/BankSelect";

type Prepared = {
  purchase: { id: string; number: number; invoice_ref: string | null; status: string; subtotal: number; tax: number; total: number; payment_type: string; due_date: string | null };
  supplier: { id: string; name: string; nit: string | null; address: string | null; phone: string | null; email: string | null };
  saved: Record<string, string | null>;
  third: Record<string, string | null>;
  points: Array<{ id: string; name: string; environment: string; has_range: boolean; is_purchase_point: boolean }>;
  documents: Array<{ id: string; full_number: string; status: string; document_type: string; total: number; dian_message: string | null }>;
};

const STATUS: Record<string, string> = {
  QUEUED: "⏳ En cola", PROCESSING: "🔄 Enviando", SENT: "📨 Enviado, esperando a la DIAN", ACCEPTED: "✅ Aceptado por la DIAN",
  REJECTED: "⛔ Rechazado", ERROR: "⚠️ Error de envío (se reintenta solo)", VOID: "Anulado", CANCELLED: "Anulado",
};
const DOC_TYPES: Array<[string, string]> = [["CC", "Cédula de ciudadanía"], ["NIT", "NIT"], ["CE", "Cédula de extranjería"], ["PP", "Pasaporte"], ["PEP", "PEP"], ["NIT_EXT", "NIT de otro país"]];

/**
 * Documento soporte electrónico: lo emite la tienda cuando le compra a alguien que no está obligado a facturar
 * (persona natural, no responsable de IVA). Se arma con la compra y viaja por el mismo motor fiscal.
 */
export function SupportDocumentButton({ storeId, purchaseId, purchaseNumber }: { storeId: string; purchaseId: string; purchaseNumber: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}><span title="Para compras a quien no factura (persona natural, no responsable de IVA)">📄 Doc. soporte</span></Btn>
      {open ? <SupportDialog storeId={storeId} purchaseId={purchaseId} purchaseNumber={purchaseNumber} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SupportDialog({ storeId, purchaseId, purchaseNumber, onClose }: { storeId: string; purchaseId: string; purchaseNumber: number; onClose: () => void }) {
  const [data, setData] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState("");
  const [note, setNote] = useState("");
  const [f, setF] = useState({ name: "", document_type: "CC", document_number: "", person_type: "natural", address: "", city_code: "", city_name: "", postal_code: "", phone: "", email: "", origin: "10" });

  async function load() {
    try {
      const d = await fiscalRpc<Prepared>("fiscal_support_prepare", { p_store: storeId, p_purchase: purchaseId });
      setData(d);
      const s = d.saved ?? {};
      const t = d.third ?? {};
      setF({
        name: s.name ?? d.supplier.name ?? "",
        document_type: s.document_type ?? t.document_type ?? "CC",
        document_number: s.document_number ?? d.supplier.nit ?? "",
        person_type: s.person_type ?? t.person_type ?? "natural",
        address: s.address ?? t.address ?? d.supplier.address ?? "",
        city_code: s.city ?? "",
        city_name: s.city_name ?? t.city ?? "",
        postal_code: s.postal_code ?? "",
        phone: s.phone ?? t.phone ?? d.supplier.phone ?? "",
        email: s.email ?? t.email ?? d.supplier.email ?? "",
        origin: s.origin ?? "10",
      });
      setPoint((cur) => cur || d.points.find((p) => p.has_range)?.id || d.points[0]?.id || "");
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, purchaseId]);

  const active = data?.documents.find((d) => d.document_type === "support_document" && !["VOID", "CANCELLED"].includes(d.status));
  const chosen = data?.points.find((p) => p.id === point);
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  async function emit() {
    if (!data || !point) return;
    setBusy(true);
    try {
      const res = await fiscalRpc<{ document_id: string; full_number: string; status: string }>("fiscal_issue_support_document", {
        p_store: storeId, p_purchase: purchaseId, p_point: point, p_supplier: f, p_note: note, p_idempotency_key: newIdempotencyKey("ds"),
      });
      const sent = await fiscalApi<{ result: { ok: boolean; message: string } }>("/api/fiscal/documents/send", { document_id: res.document_id })
        .catch((e) => ({ result: { ok: false, message: errorText(e) } }));
      void toast(`Documento soporte ${res.full_number} creado`, sent.result.ok ? "success" : "warning", sent.result.message);
      await load();
    } catch (e) {
      void toast("No se pudo emitir el documento soporte", "error", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, k: keyof typeof f, extra: { placeholder?: string; inputMode?: "numeric"; hint?: string } = {}) => (
    <label className="text-xs font-bold">{label}
      <input className={`${inputClass} mt-1`} style={inputStyle} name={`proveedor-${k}`} {...NO_AUTOFILL} value={f[k]} placeholder={extra.placeholder} inputMode={extra.inputMode} onChange={(e) => set(k, e.target.value)} />
      {extra.hint ? <span className="mt-0.5 block font-normal" style={{ color: "var(--t-muted)" }}>{extra.hint}</span> : null}
    </label>
  );

  const body = (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border" style={{ background: "var(--t-bg-base)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <b className="block text-base">📄 Documento soporte · Compra #{purchaseNumber}</b>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>Para compras a quien no está obligado a facturar (persona natural, no responsable de IVA). Lo exige la DIAN para poder deducir la compra.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4 text-sm">
          {error ? <p className="rounded-xl border p-3" style={{ borderColor: "#ef4444" }}>🔒 {error}</p> : !data ? <p>Cargando…</p> : (
            <>
              {data.documents.length ? (
                <div className="space-y-1 rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                  {data.documents.map((d) => (
                    <p key={d.id}><b>{d.document_type === "support_adjustment" ? "Nota de ajuste" : "Documento"} {d.full_number}</b> · {STATUS[d.status] ?? d.status} · {money(d.total)}{d.dian_message && d.status === "REJECTED" ? <span className="block text-xs" style={{ color: "#ef4444" }}>{d.dian_message}</span> : null}</p>
                  ))}
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>El XML, el PDF y las notas de ajuste están en Factura electrónica → Documentos.</p>
                </div>
              ) : null}
              {data.purchase.status !== "received" ? <p style={{ color: "#ef4444" }}>Esta compra está anulada.</p> : active ? null : !data.points.length ? (
                <p className="rounded-xl border p-3" style={{ borderColor: "#f59e0b" }}>Ningún punto tiene la facturación electrónica configurada. Configúrala en Factura electrónica → Puntos.</p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-bold">Lo emite el punto
                      <select className={`${inputClass} mt-1`} style={inputStyle} value={point} onChange={(e) => setPoint(e.target.value)}>
                        {data.points.map((p) => <option key={p.id} value={p.id}>{p.name}{p.environment === "sandbox" ? " (pruebas)" : ""}{p.has_range ? "" : " · sin numeración"}</option>)}
                      </select>
                    </label>
                    <div className="text-xs">
                      <b className="block">Valor de la compra</b>
                      <span>{money(data.purchase.subtotal)} + IVA {money(data.purchase.tax)} = <b>{money(data.purchase.total)}</b> · {data.purchase.payment_type === "credit" ? "a crédito" : "de contado"}</span>
                    </div>
                  </div>
                  {chosen && !chosen.has_range ? (
                    <p className="rounded-xl border p-3 text-xs" style={{ borderColor: "#f59e0b" }}>
                      Ese punto no tiene numeración de <b>Documento soporte</b>. Pide la resolución en la DIAN (es distinta a la de facturas) y regístrala en Factura electrónica → Numeración.
                    </p>
                  ) : null}
                  <p className="font-black">Datos del proveedor</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {field("Nombre completo o razón social", "name")}
                    <div className="grid grid-cols-[1fr_1.2fr] gap-2">
                      <label className="text-xs font-bold">Tipo
                        <select className={`${inputClass} mt-1`} style={inputStyle} value={f.document_type} onChange={(e) => set("document_type", e.target.value)}>
                          {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      {field("Número", "document_number", { inputMode: "numeric" })}
                    </div>
                    <label className="text-xs font-bold">Persona
                      <select className={`${inputClass} mt-1`} style={inputStyle} value={f.person_type} onChange={(e) => set("person_type", e.target.value)}>
                        <option value="natural">Natural</option><option value="juridica">Jurídica</option>
                      </select>
                    </label>
                    <label className="text-xs font-bold">Residencia fiscal
                      <select className={`${inputClass} mt-1`} style={inputStyle} value={f.origin} onChange={(e) => set("origin", e.target.value)}>
                        <option value="10">Residente en Colombia</option><option value="11">No residente</option>
                      </select>
                    </label>
                    {field("Dirección", "address")}
                    {field("Municipio (nombre)", "city_name", { placeholder: "Ej. Medellín" })}
                    {field("Código DANE del municipio", "city_code", { inputMode: "numeric", placeholder: "Ej. 05001", hint: "5 dígitos. Medellín 05001 · Bogotá 11001 · Cali 76001." })}
                    {field("Código postal", "postal_code", { inputMode: "numeric", placeholder: "Ej. 050021", hint: "6 dígitos (búscalo en codigopostal.gov.co)." })}
                    {field("Celular", "phone", { inputMode: "numeric" })}
                    {field("Correo (opcional)", "email")}
                  </div>
                  <label className="block text-xs font-bold">Nota (opcional)
                    <input className={`${inputClass} mt-1`} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Compra de cosecha de octubre" />
                  </label>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>Los datos del proveedor se recuerdan para la próxima vez. La cédula de una persona natural se envía como NIT con su dígito de verificación, como lo pide la DIAN.</p>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
          {data && !active && data.purchase.status === "received" && data.points.length ? (
            <Btn disabled={busy || !chosen?.has_range} onClick={() => void emit()}>{busy ? "Emitiendo…" : "Emitir y enviar a la DIAN"}</Btn>
          ) : null}
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
