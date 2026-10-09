"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Download, FileMinus, FilePlus, RefreshCw, Send } from "lucide-react";
import { errorText, fiscalApi, fiscalDownload, fiscalRpc, newIdempotencyKey } from "@/lib/fiscal/client";
import { CREDIT_NOTE_CONCEPTS, DEBIT_NOTE_CONCEPTS, docLabel, statusLabel } from "@/lib/fiscal/types";
import type { FiscalAccess } from "./useFiscal";
import { Badge, Button, Card, Drawer, EnvBadge, ErrorBox, Field, Notice, Skeleton, StatusBadge, askReasonDialog, confirmDialog, fmtDateTime, fmtMoney, inputCls, inputStyle, notify } from "./ui";

type Detail = {
  ok: true;
  document: Record<string, unknown> & {
    id: string; status: string; full_number: string | null; document_type: string; environment: string; issue_date: string;
    total: number; subtotal: number; tax_total: number; discount_total: number; prefix: string | null; number: number | null;
    issuer: Record<string, unknown>; customer: Record<string, unknown>; created_by_name: string | null; created_at: string;
    provider: string | null; provider_status: string | null; provider_message: string | null; dian_status: string | null; dian_message: string | null;
    cufe: string | null; attempts: number; last_error_message: string | null; last_error_code: string | null; source_number: string | null;
    note_reason: string | null; void_reason: string | null; metadata: Record<string, unknown>; sent_at: string | null; accepted_at: string | null; rejected_at: string | null;
  };
  point: { id: string; name: string; code: string } | null;
  lines: Array<{ line_no: number; sku: string | null; description: string; qty: number; unit_price: number; tax_rate: number; line_subtotal: number; line_tax: number; line_total: number }>;
  events: Array<{ id: number; event: string; status_from: string | null; status_to: string | null; message: string | null; actor_name: string | null; source: string; ip: string | null; created_at: string; error_code: string | null }>;
  range: { prefix: string; resolution_number: string | null; resolution_date: string | null; valid_until: string | null; range_from: number; range_to: number } | null;
  allocation: { number: number; status: string; allocated_at: string } | null;
  provider_account: { provider: string; environment: string; label: string | null; name: string } | null;
  related: Array<{ id: string; full_number: string; document_type: string; status: string; total: number; issue_date: string; note_reason: string | null }>;
  original: { id: string; full_number: string; status: string; total: number } | null;
  audit: Array<{ created_at: string; user_name: string | null; action: string; ip: string | null; reason: string | null }>;
  can: { send: boolean; notes: boolean; void: boolean; download: boolean };
};

const EVENT_LABEL: Record<string, string> = {
  created: "Creado", number_assigned: "Número asignado", send_started: "Enviado al proveedor", status_check: "Consulta de estado",
  sent: "Recibido por el proveedor", accepted: "Aceptado", rejected: "Rechazado", error: "Error de envío", voided: "Anulado sin transmitir",
  contingency: "En contingencia", requeued: "Vuelve a la cola", result_ignored: "Respuesta ignorada", provider_update: "Confirmación del proveedor",
  credit_note_created: "Nota crédito creada", debit_note_created: "Nota débito creada", cancelled_by_note: "Anulado por nota crédito",
  credited: "Acreditado parcialmente", debited: "Nota débito aceptada",
};

function QA({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
      <p className="text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>{q}</p>
      <div className="text-sm font-bold">{a ?? "—"}</div>
    </div>
  );
}

export function DocumentDrawer({ id, onClose, onChanged, onOpen }: { id: string | null; access?: FiscalAccess; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const [loaded, setLoaded] = useState<{ id: string; data: Detail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<null | { kind: "credit_note" | "debit_note"; concept: string; reason: string; qty: Record<number, number>; debit: Array<{ description: string; qty: number; unit_price: number; tax_rate: number }> }>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await fiscalRpc<Detail>("fiscal_document_detail", { p_document: id });
      setLoaded({ id, data: d });
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);
  useEffect(() => {
     
    void load();
  }, [load]);
  const data = loaded && loaded.id === id ? loaded.data : null;
  const doc = data?.document;

  async function send() {
    if (!doc) return;
    setBusy("send");
    try {
      const res = await fiscalApi<{ result: { ok: boolean; status: string | null; message: string } }>("/api/fiscal/documents/send", { document_id: doc.id });
      await notify(res.result.message, res.result.ok ? "success" : "warning");
    } catch (err) {
      await notify("No se pudo enviar", "error", errorText(err));
    } finally {
      setBusy(null);
      await load();
      onChanged();
    }
  }

  async function voidDoc() {
    if (!doc) return;
    const reason = await askReasonDialog(`Anular ${doc.full_number}`, "Solo para documentos que nunca se transmitieron. El número queda registrado como «anulado sin transmitir» (valídalo con tu contadora).");
    if (!reason) return;
    setBusy("void");
    try {
      await fiscalRpc("fiscal_void_unsent", { p_document: doc.id, p_reason: reason });
      await notify("Documento anulado");
    } catch (err) {
      await notify("No se pudo anular", "error", errorText(err));
    } finally {
      setBusy(null);
      await load();
      onChanged();
    }
  }

  async function createNote() {
    if (!doc || !note) return;
    if (note.reason.trim().length < 5) return void notify("Escribe el motivo de la nota", "warning");
    const lines = note.kind === "credit_note"
      ? Object.entries(note.qty).filter(([, q]) => q > 0).map(([line_no, qty]) => ({ line_no: Number(line_no), qty }))
      : note.debit.filter((l) => l.description.trim() && l.unit_price > 0);
    if (note.kind === "debit_note" && !lines.length) return void notify("Agrega al menos una línea con valor", "warning");
    const ok = await confirmDialog(note.kind === "credit_note" ? "Crear nota crédito" : "Crear nota débito", `Se numerará con la resolución de notas del punto y se enviará al proveedor.`, "Crear y enviar");
    if (!ok) return;
    setBusy("note");
    try {
      const res = await fiscalRpc<{ document_id: string; full_number: string }>("fiscal_create_note", {
        p_document: doc.id, p_kind: note.kind, p_concept: note.concept, p_reason: note.reason.trim(),
        p_lines: lines.length ? lines : null, p_idempotency_key: newIdempotencyKey("nota"),
      });
      const sent = await fiscalApi<{ result: { ok: boolean; message: string } }>("/api/fiscal/documents/send", { document_id: res.document_id }).catch((e) => ({ result: { ok: false, message: errorText(e) } }));
      await notify(`Nota ${res.full_number} creada`, sent.result.ok ? "success" : "warning", sent.result.message);
      setNote(null);
      onOpen(res.document_id);
    } catch (err) {
      await notify("No se pudo crear la nota", "error", errorText(err));
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const issuer = (doc?.issuer ?? {}) as Record<string, string | null>;
  const customer = (doc?.customer ?? {}) as Record<string, string | boolean | null>;
  const lastSend = data?.events.filter((e) => e.event === "send_started").at(-1);

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      kicker={doc ? docLabel(doc.document_type) : "Documento fiscal"}
      title={doc?.full_number ?? "Documento"}
      subtitle={doc ? <span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={doc.status} /><EnvBadge env={doc.environment} /><span>{fmtDateTime(doc.issue_date)}</span></span> : null}
      width="max-w-3xl"
      footer={data ? (
        <>
          {data.can.download ? (
            <>
              <Button icon={<Download size={15} />} onClick={() => void fiscalDownload(`/api/fiscal/documents/download?id=${doc?.id}&kind=xml`, `${doc?.full_number}.xml`).catch((e) => notify("No se pudo descargar", "error", errorText(e)))}>XML</Button>
              <Button icon={<Download size={15} />} onClick={() => void fiscalDownload(`/api/fiscal/documents/download?id=${doc?.id}&kind=pdf`, `${doc?.full_number}.pdf`).catch((e) => notify("No se pudo descargar", "error", errorText(e)))}>PDF</Button>
            </>
          ) : null}
          {data.can.void ? <Button variant="danger" icon={<Ban size={15} />} busy={busy === "void"} onClick={() => void voidDoc()}>Anular sin transmitir</Button> : null}
          {data.can.notes ? (
            <>
              <Button icon={<FileMinus size={15} />} onClick={() => setNote({ kind: "credit_note", concept: "1", reason: "", qty: {}, debit: [] })}>Nota crédito</Button>
              <Button icon={<FilePlus size={15} />} onClick={() => setNote({ kind: "debit_note", concept: "4", reason: "", qty: {}, debit: [{ description: "", qty: 1, unit_price: 0, tax_rate: 0 }] })}>Nota débito</Button>
            </>
          ) : null}
          {data.can.send ? (
            <Button variant="primary" icon={doc?.status === "SENT" ? <RefreshCw size={15} /> : <Send size={15} />} busy={busy === "send"} onClick={() => void send()}>
              {doc?.status === "SENT" ? "Consultar estado" : doc?.attempts ? "Reenviar" : "Enviar"}
            </Button>
          ) : null}
        </>
      ) : null}
    >
      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
      {!data && !error ? <Skeleton rows={4} /> : null}
      {data && doc ? (
        <>
          {doc.environment === "sandbox" ? <Notice tone="warn" icon="🧪">Documento de <b>pruebas</b>: no tiene validez fiscal.</Notice> : null}
          {doc.status === "REJECTED" || doc.status === "ERROR" ? (
            <Notice tone={doc.status === "REJECTED" ? "bad" : "warn"} icon="⚠️">
              <b>{doc.status === "REJECTED" ? "El proveedor tecnológico rechazó el documento" : "No se pudo transmitir"}:</b> {doc.last_error_message ?? "sin detalle"}
              {doc.last_error_code ? <span className="opacity-70"> ({doc.last_error_code})</span> : null}
              <span className="mt-1 block text-xs">{doc.status === "REJECTED" ? "Corrige el dato (por ejemplo el cliente) y reenvíalo, o anúlalo sin transmitir." : "Se reintenta automáticamente con espera creciente."}</span>
            </Notice>
          ) : null}

          <Card>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--t-accent)" }}>Auditoría fiscal del documento</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <QA q="¿Quién lo creó?" a={doc.created_by_name ?? "Sistema"} />
              <QA q="¿Desde qué punto?" a={data.point ? `${data.point.name} (${data.point.code})` : "—"} />
              <QA q="¿Para qué contribuyente? ¿Con qué NIT?" a={<>{issuer.legal_name}<br /><span className="font-mono text-xs">{issuer.document_type} {issuer.document_number}{issuer.verification_digit ? `-${issuer.verification_digit}` : ""}</span></>} />
              <QA q="¿Qué resolución? ¿Prefijo y consecutivo?" a={data.range ? <>{data.range.resolution_number ?? "Sin resolución"} · prefijo {data.range.prefix || "—"} · n.º {doc.number}<br /><span className="text-xs font-normal">Rango {data.range.range_from}–{data.range.range_to}{data.range.valid_until ? ` · vence ${data.range.valid_until}` : ""}</span></> : "—"} />
              <QA q="¿Qué proveedor?" a={data.provider_account ? `${data.provider_account.name}${data.provider_account.label ? ` · ${data.provider_account.label}` : ""}` : "—"} />
              <QA q="¿Qué fecha?" a={fmtDateTime(doc.issue_date)} />
              <QA q="¿Qué respondió el proveedor?" a={doc.provider_status ? `${doc.provider_status}${doc.provider_message ? ` · ${doc.provider_message}` : ""}` : "Sin respuesta aún"} />
              <QA q="¿Qué respondió la DIAN?" a={doc.dian_status ? `${doc.dian_status}${doc.dian_message ? ` · ${doc.dian_message}` : ""}` : "Sin respuesta aún"} />
              <QA q="¿Fue aceptada o rechazada? ¿Por qué?" a={<>{statusLabel(doc.status)}{doc.last_error_message ? ` · ${doc.last_error_message}` : ""}</>} />
              <QA q="¿Se reintentó? ¿Quién?" a={doc.attempts > 1 ? `${doc.attempts} intentos · último por ${lastSend?.actor_name ?? "Sistema"}` : doc.attempts === 1 ? "Un intento" : "Aún no se envía"} />
              <QA q="CUFE / CUDE" a={doc.cufe ? <span className="break-all font-mono text-[11px]">{doc.cufe}</span> : "—"} />
              <QA q="Origen (pedido / remisión)" a={doc.source_number ?? "Manual"} />
            </div>
          </Card>

          {data.original ? (
            <Notice tone="info">Nota sobre <button type="button" className="font-bold underline" onClick={() => onOpen(data.original!.id)}>{data.original.full_number}</button> · motivo: {doc.note_reason}</Notice>
          ) : null}

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black">Cliente</p>
              {customer.final_consumer ? <Badge>Consumidor final</Badge> : null}
            </div>
            <p className="text-sm">{String(customer.name ?? "—")} · {String(customer.document_type ?? "")} {String(customer.document_number ?? "")}</p>
            {customer.email ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>{String(customer.email)}</p> : null}
          </Card>

          <Card>
            <p className="mb-2 text-sm font-black">Productos</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase" style={{ color: "var(--t-muted)" }}><th className="py-1">#</th><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">IVA</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.line_no} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="py-1.5">{l.line_no}</td><td>{l.description}{l.sku ? <span className="text-xs opacity-60"> · {l.sku}</span> : null}</td>
                      <td className="text-right tabular-nums">{l.qty}</td><td className="text-right tabular-nums">{fmtMoney(l.unit_price)}</td>
                      <td className="text-right tabular-nums">{l.tax_rate}%</td><td className="text-right font-bold tabular-nums">{fmtMoney(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-right text-xs">
              <p>Base <b>{fmtMoney(doc.subtotal)}</b></p><p>Impuestos <b>{fmtMoney(doc.tax_total)}</b></p><p className="text-sm">Total <b>{fmtMoney(doc.total)}</b></p>
            </div>
          </Card>

          {note ? (
            <Card className="space-y-3" style={{ borderColor: "var(--t-accent)" }}>
              <p className="text-sm font-black">{note.kind === "credit_note" ? "Nueva nota crédito" : "Nueva nota débito"}</p>
              <Notice tone="info">Los conceptos son configurables y deben validarse con el proveedor tecnológico y la contadora.</Notice>
              <Field label="Concepto">
                <select className={inputCls} style={inputStyle} value={note.concept} onChange={(e) => setNote({ ...note, concept: e.target.value })}>
                  {(note.kind === "credit_note" ? CREDIT_NOTE_CONCEPTS : DEBIT_NOTE_CONCEPTS).map(([v, l]) => <option key={v} value={v}>{v} · {l}</option>)}
                </select>
              </Field>
              <Field label="Motivo" required><input className={inputCls} style={inputStyle} value={note.reason} onChange={(e) => setNote({ ...note, reason: e.target.value })} placeholder="Ej: el cliente devolvió una unidad" /></Field>
              {note.kind === "credit_note" ? (
                <div className="space-y-1.5">
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>Deja todo en 0 para acreditar el saldo pendiente completo.</p>
                  {data.lines.map((l) => (
                    <div key={l.line_no} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{l.description} <span className="opacity-60">(máx. {l.qty})</span></span>
                      <input type="number" min={0} max={l.qty} value={note.qty[l.line_no] ?? 0} onChange={(e) => setNote({ ...note, qty: { ...note.qty, [l.line_no]: Math.max(0, Math.min(l.qty, Number(e.target.value) || 0)) } })} className="w-20 rounded-lg border px-2 py-1 text-right" style={inputStyle} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {note.debit.map((l, i) => (
                    <div key={i} className="grid grid-cols-[1fr_70px_110px_70px] gap-2">
                      <input placeholder="Descripción" value={l.description} onChange={(e) => setNote({ ...note, debit: note.debit.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} className={inputCls} style={inputStyle} />
                      <input type="number" min={1} value={l.qty} onChange={(e) => setNote({ ...note, debit: note.debit.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)) })} className={inputCls} style={inputStyle} />
                      <input type="number" min={0} placeholder="Valor" value={l.unit_price || ""} onChange={(e) => setNote({ ...note, debit: note.debit.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) || 0 } : x)) })} className={inputCls} style={inputStyle} />
                      <input type="number" min={0} max={100} placeholder="IVA %" value={l.tax_rate} onChange={(e) => setNote({ ...note, debit: note.debit.map((x, j) => (j === i ? { ...x, tax_rate: Number(e.target.value) || 0 } : x)) })} className={inputCls} style={inputStyle} />
                    </div>
                  ))}
                  <Button onClick={() => setNote({ ...note, debit: [...note.debit, { description: "", qty: 1, unit_price: 0, tax_rate: 0 }] })}>+ Línea</Button>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setNote(null)}>Cancelar</Button>
                <Button variant="primary" busy={busy === "note"} onClick={() => void createNote()}>Crear nota</Button>
              </div>
            </Card>
          ) : null}

          {data.related.length ? (
            <Card>
              <p className="mb-2 text-sm font-black">Notas relacionadas</p>
              <div className="space-y-1.5">
                {data.related.map((n) => (
                  <button key={n.id} type="button" onClick={() => onOpen(n.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    <span>{docLabel(n.document_type)} <b>{n.full_number}</b> · {n.note_reason}</span>
                    <span className="flex items-center gap-2"><StatusBadge status={n.status} /><b>{fmtMoney(n.total)}</b></span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <p className="mb-3 text-sm font-black">Línea de tiempo</p>
            <ol className="relative space-y-3 border-l pl-4" style={{ borderColor: "var(--t-card-border)" }}>
              {data.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full" style={{ background: e.event === "rejected" || e.event === "error" ? "#ef4444" : e.event === "accepted" ? "#16a34a" : "var(--t-accent)" }} />
                  <p className="text-sm font-bold">{EVENT_LABEL[e.event] ?? e.event}{e.status_to && e.status_from !== e.status_to ? <span className="font-normal opacity-70"> · {statusLabel(e.status_to)}</span> : null}</p>
                  {e.message ? <p className="text-xs">{e.message}</p> : null}
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{fmtDateTime(e.created_at)} · {e.actor_name ?? "Sistema"}{e.ip ? ` · IP ${e.ip}` : ""}</p>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : null}
    </Drawer>
  );
}
