"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FolderArchive, Printer, Search } from "lucide-react";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { AUDIT_CATEGORY_INFO, DOC_TYPE_INFO, FISCAL_DOC_TYPES, statusLabel, type AuditRow, type SearchPage } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, SectionTitle, Skeleton, fmtDateTime, fmtMoney, inputCls, inputStyle, notify } from "./ui";
import { downloadText, toCsv } from "./DocumentsTab";

const d = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

function Diff({ row }: { row: AuditRow }) {
  const keys = Array.from(new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})]));
  if (!keys.length) return <pre className="overflow-x-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(row.detail, null, 2)}</pre>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead><tr style={{ color: "var(--t-muted)" }}><th className="py-1 text-left">Campo</th><th className="text-left">Antes</th><th className="text-left">Después</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t align-top" style={{ borderColor: "var(--t-card-border)" }}>
              <td className="py-1 pr-2 font-bold">{k}</td>
              <td className="pr-2 text-red-500">{JSON.stringify(row.before?.[k] ?? null)}</td>
              <td className="text-emerald-600">{JSON.stringify(row.after?.[k] ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditList({ load, initialCategory = "", showStore = false }: {
  load: (filters: Record<string, unknown>, cursor: SearchPage<AuditRow>["next_cursor"]) => Promise<SearchPage<AuditRow>>; initialCategory?: string; showStore?: boolean;
}) {
  const [filters, setFilters] = useState({ q: "", categories: initialCategory ? [initialCategory] : [] as string[], severity: "", from: d(30), to: d(0) });
  const [draftQ, setDraftQ] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<SearchPage<AuditRow>["next_cursor"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (more: boolean, after: SearchPage<AuditRow>["next_cursor"]) => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const page = await load(filters, more ? after : null);
      if (id !== seq.current) return;
      setRows((cur) => (more ? [...cur, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setError(null);
    } catch (err) {
      if (id === seq.current) setError(errorText(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [filters, load]);
  useEffect(() => {
     
    void run(false, null);
  }, [run]);
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === draftQ ? f : { ...f, q: draftQ })), 350);
    return () => clearTimeout(t);
  }, [draftQ]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Acción, usuario, IP, NIT, número…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2.4rem" }} />
        </div>
        <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={inputCls} style={inputStyle} />
        <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={inputCls} style={inputStyle} />
        <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} className={inputCls} style={inputStyle}>
          <option value="">Toda severidad</option><option value="critical">Crítica</option><option value="warning">Advertencia</option><option value="info">Informativa</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(AUDIT_CATEGORY_INFO).map(([k, v]) => {
          const on = filters.categories.includes(k);
          return (
            <button key={k} type="button" onClick={() => setFilters((f) => ({ ...f, categories: on ? f.categories.filter((x) => x !== k) : [...f.categories, k] }))} className="rounded-full border px-3 py-1 text-xs font-semibold" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
              {v.icon} {v.label}
            </button>
          );
        })}
        <Button variant="ghost" icon={<Download size={14} />} disabled={!rows.length} onClick={() => downloadText(`auditoria-${filters.from}-${filters.to}.csv`, toCsv(rows.map((r) => ({
          fecha: r.created_at, tienda: r.store_name ?? "", punto: r.point_name ?? "", usuario: r.user_name, categoria: r.category, severidad: r.severity,
          accion: r.action, entidad: r.entity, antes: r.before, despues: r.after, motivo: r.reason, ip: r.ip, navegador: r.user_agent,
        }))))}>CSV</Button>
      </div>
      {error ? <ErrorBox message={error} onRetry={() => void run(false, null)} /> : null}
      {loading && !rows.length ? <Skeleton rows={5} /> : null}
      {!loading && !rows.length && !error ? <EmptyState icon="🔎" title="Sin registros con estos filtros" /> : null}
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border" style={{ borderColor: r.severity === "critical" ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)" }}>
            <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-start justify-between gap-2 p-3 text-left">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                  {AUDIT_CATEGORY_INFO[r.category]?.icon} {r.action}
                  {r.severity !== "info" ? <Badge tone={r.severity === "critical" ? "bad" : "warn"}>{r.severity === "critical" ? "Crítica" : "Advertencia"}</Badge> : null}
                </p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                  {fmtDateTime(r.created_at)} · {r.user_name ?? "Sistema"}{showStore && r.store_name ? ` · ${r.store_name}` : ""}{r.point_name ? ` · ${r.point_name}` : ""}{r.ip ? ` · IP ${r.ip}` : ""}
                </p>
                {r.reason ? <p className="text-xs">Motivo: {r.reason}</p> : null}
              </div>
              <ChevronDown size={14} className={`mt-1 shrink-0 transition ${open === r.id ? "rotate-180" : ""}`} />
            </button>
            {open === r.id ? <div className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}><Diff row={r} />{r.user_agent ? <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>{r.user_agent}</p> : null}</div> : null}
          </div>
        ))}
      </div>
      {cursor ? <div className="flex justify-center"><Button busy={loading} onClick={() => void run(true, cursor)}>Cargar más</Button></div> : null}
    </div>
  );
}

type Dossier = {
  generated_at: string; generated_by: string; store: { name: string }; point: { name: string; code: string; responsible_name: string | null } | null;
  period: { from: string; to: string }; documents_count: number; truncated: boolean;
  summary: Array<{ document_type: string; status: string; count: number; subtotal: number; tax: number; total: number }>;
  ranges: Array<{ prefix: string; resolution_number: string | null; range_from: number; range_to: number; next_number: number; allocated: number; voided_unsent: number[]; first_used: number | null; last_used: number | null; valid_until: string | null }>;
  documents: Array<Record<string, unknown> & { full_number: string; document_type: string; status: string; issue_date: string; total: number; tax_total: number; cufe: string | null; customer: { name?: string; document_number?: string } }>;
};

function printDossier(x: Dossier) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  w.document.write(`<html><head><title>Expediente fiscal ${esc(x.point?.name ?? x.store.name)}</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0 18px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}h1{margin:0}small{color:#555}</style></head><body>
  <h1>Expediente fiscal</h1><small>${esc(x.store.name)}${x.point ? ` · ${esc(x.point.name)} (${esc(x.point.code)})` : ""} · ${esc(x.period.from)} a ${esc(x.period.to)} · generado ${esc(new Date(x.generated_at).toLocaleString("es-CO"))} por ${esc(x.generated_by)}</small>
  <h3>Resumen</h3><table><tr><th>Tipo</th><th>Estado</th><th>Cantidad</th><th>Base</th><th>Impuestos</th><th>Total</th></tr>
  ${x.summary.map((s) => `<tr><td>${esc(DOC_TYPE_INFO[s.document_type as keyof typeof DOC_TYPE_INFO]?.short ?? s.document_type)}</td><td>${esc(statusLabel(s.status))}</td><td>${s.count}</td><td>${esc(fmtMoney(s.subtotal))}</td><td>${esc(fmtMoney(s.tax))}</td><td>${esc(fmtMoney(s.total))}</td></tr>`).join("")}</table>
  <h3>Numeración</h3><table><tr><th>Prefijo</th><th>Resolución</th><th>Rango</th><th>Usados</th><th>Primero–último</th><th>Anulados sin transmitir</th><th>Vence</th></tr>
  ${x.ranges.map((r) => `<tr><td>${esc(r.prefix)}</td><td>${esc(r.resolution_number)}</td><td>${r.range_from}–${r.range_to}</td><td>${r.allocated}</td><td>${r.first_used ?? "—"}–${r.last_used ?? "—"}</td><td>${esc(r.voided_unsent.join(", ") || "Ninguno")}</td><td>${esc(r.valid_until)}</td></tr>`).join("")}</table>
  <h3>Documentos (${x.documents_count}${x.truncated ? ", primeros 5000" : ""})</h3><table><tr><th>Número</th><th>Tipo</th><th>Estado</th><th>Fecha</th><th>Cliente</th><th>Impuestos</th><th>Total</th><th>CUFE</th></tr>
  ${x.documents.map((doc) => `<tr><td>${esc(doc.full_number)}</td><td>${esc(DOC_TYPE_INFO[doc.document_type as keyof typeof DOC_TYPE_INFO]?.short)}</td><td>${esc(statusLabel(doc.status))}</td><td>${esc(new Date(doc.issue_date).toLocaleString("es-CO"))}</td><td>${esc(doc.customer?.name)} ${esc(doc.customer?.document_number)}</td><td>${esc(fmtMoney(doc.tax_total))}</td><td>${esc(fmtMoney(doc.total))}</td><td style="font-size:9px;word-break:break-all">${esc(doc.cufe)}</td></tr>`).join("")}</table>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

export function AuditTab({ access, data, initialCategory }: { access: FiscalAccess; data: FiscalOverview; initialCategory: string }) {
  const org = access.scope?.scope === "organization" || access.scope?.scope === "global";
  const [dos, setDos] = useState({ point: org ? "" : data.points[0]?.point.id ?? "", from: d(30), to: d(0), types: [] as string[], statuses: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Dossier | null>(null);
  const canAudit = access.canAny(["audit", "fiscal_audit"]);
  const canExport = access.canAny(["fiscal_download", "fiscal_audit"]);

  const loadAudit = useCallback((filters: Record<string, unknown>, cursor: SearchPage<AuditRow>["next_cursor"]) =>
    fiscalRpc<SearchPage<AuditRow>>("fiscal_audit_search", { p_store: access.store?.id, p_filters: filters, p_limit: 50, p_cursor: cursor }), [access.store?.id]);

  async function generate() {
    setBusy(true);
    try {
      const res = await fiscalRpc<Dossier>("fiscal_dossier", { p_store: access.store?.id, p_point: dos.point || null, p_from: dos.from, p_to: dos.to, p_types: dos.types.length ? dos.types : null, p_statuses: null });
      setResult(res);
      await notify(`Expediente listo: ${res.documents_count} documentos`);
    } catch (err) {
      await notify("No se pudo generar el expediente", "error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {canExport ? (
        <Card className="space-y-3">
          <SectionTitle icon={<FolderArchive size={16} />} title="Expediente fiscal del punto" subtitle="Paquete ordenado para revisión contable o de la DIAN: no oculta ni modifica información. La exportación queda auditada." />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Punto">
              <select className={inputCls} style={inputStyle} value={dos.point} onChange={(e) => setDos({ ...dos, point: e.target.value })}>
                {org ? <option value="">Todos los puntos</option> : null}
                {data.points.map((p) => <option key={p.point.id} value={p.point.id}>{p.point.name}</option>)}
              </select>
            </Field>
            <Field label="Desde"><input type="date" className={inputCls} style={inputStyle} value={dos.from} onChange={(e) => setDos({ ...dos, from: e.target.value })} /></Field>
            <Field label="Hasta"><input type="date" className={inputCls} style={inputStyle} value={dos.to} onChange={(e) => setDos({ ...dos, to: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="primary" className="w-full" busy={busy} onClick={() => void generate()}>Generar</Button></div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FISCAL_DOC_TYPES.map((t) => {
              const on = dos.types.includes(t);
              return <button key={t} type="button" onClick={() => setDos({ ...dos, types: on ? dos.types.filter((x) => x !== t) : [...dos.types, t] })} className="rounded-full border px-3 py-1 text-xs font-semibold" style={on ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{DOC_TYPE_INFO[t].short}</button>;
            })}
          </div>
          {result ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="flex-1 text-sm"><b>{result.documents_count}</b> documentos · {result.ranges.length} numeraciones{result.truncated ? " (se incluyen los primeros 5000)" : ""}</p>
              <Button icon={<Download size={14} />} onClick={() => downloadText(`expediente-fiscal-${dos.from}-${dos.to}.json`, JSON.stringify(result, null, 2), "application/json")}>JSON completo</Button>
              <Button icon={<Download size={14} />} onClick={() => downloadText(`expediente-documentos-${dos.from}-${dos.to}.csv`, toCsv(result.documents.map((x) => ({ numero: x.full_number, tipo: x.document_type, estado: x.status, fecha: x.issue_date, cliente: x.customer?.name, documento_cliente: x.customer?.document_number, impuestos: x.tax_total, total: x.total, cufe: x.cufe }))))}>CSV</Button>
              <Button icon={<Printer size={14} />} onClick={() => printDossier(result)}>Imprimir / PDF</Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {canAudit ? (
        <Card>
          <SectionTitle title="Auditoría" subtitle="Quién hizo qué, desde dónde, con valor anterior, nuevo y motivo. Nadie puede modificarla ni borrarla." />
          <AuditList load={loadAudit} initialCategory={initialCategory} />
        </Card>
      ) : null}
    </div>
  );
}
