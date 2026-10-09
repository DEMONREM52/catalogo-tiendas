"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Filter, Search } from "lucide-react";
import { errorText, fiscalRpc } from "@/lib/fiscal/client";
import { DOC_TYPE_INFO, FISCAL_DOC_TYPES, STATUS_INFO, FISCAL_STATUSES, docLabel, type FiscalDocumentRow, type SearchPage } from "@/lib/fiscal/types";
import type { FiscalAccess, FiscalOverview } from "./useFiscal";
import { Button, Card, EmptyState, EnvBadge, ErrorBox, Field, Skeleton, StatusBadge, fmtDateTime, fmtMoney, inputCls, inputStyle } from "./ui";
import { DocumentDrawer } from "./DocumentDrawer";

export type DocFilters = { q: string; statuses: string[]; types: string[]; point_id: string; environment: string; from: string; to: string; errors_only: boolean };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function DocumentsTab({ access, data, initialQuery, initialStatus, onChanged, admin = false }: {
  access: FiscalAccess; data?: FiscalOverview; initialQuery: string; initialStatus: string; onChanged?: () => void; admin?: boolean;
}) {
  const [filters, setFilters] = useState<DocFilters>({
    q: initialQuery, statuses: initialStatus ? [initialStatus] : [], types: [], point_id: "", environment: "", from: daysAgo(30), to: today(), errors_only: false,
  });
  const [draftQ, setDraftQ] = useState(initialQuery);
  const [items, setItems] = useState<FiscalDocumentRow[]>([]);
  const [cursor, setCursor] = useState<SearchPage<FiscalDocumentRow>["next_cursor"]>(null);
  const [totals, setTotals] = useState<SearchPage<FiscalDocumentRow>["totals"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async (more = false, after: SearchPage<FiscalDocumentRow>["next_cursor"] = null) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const payload = { ...filters, with_totals: !more };
      const page = admin
        ? await fiscalRpc<SearchPage<FiscalDocumentRow>>("admin_fiscal_documents", { p_filters: payload, p_limit: 30, p_cursor: more ? after : null })
        : await fiscalRpc<SearchPage<FiscalDocumentRow>>("fiscal_documents_search", { p_store: access.store?.id, p_filters: payload, p_limit: 30, p_cursor: more ? after : null });
      if (id !== reqId.current) return;
      setItems((cur) => (more ? [...cur, ...page.items] : page.items));
      setCursor(page.next_cursor);
      if (!more) setTotals(page.totals ?? null);
      setError(null);
    } catch (err) {
      if (id === reqId.current) setError(errorText(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [filters, access.store?.id, admin]);

  useEffect(() => {
     
    void load(false);
  }, [load]);

  // Búsqueda con pausa al escribir.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === draftQ ? f : { ...f, q: draftQ })), 350);
    return () => clearTimeout(t);
  }, [draftQ]);

  const toggle = (key: "statuses" | "types", value: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] }));

  const canExport = access.canAny(["fiscal_download", "fiscal_audit"]) || admin;

  function exportCsv() {
    downloadText(`documentos-fiscales-${filters.from}-${filters.to}.csv`, toCsv(items.map((d) => ({
      numero: d.full_number, tipo: docLabel(d.document_type), estado: STATUS_INFO[d.status]?.label ?? d.status, ambiente: d.environment,
      fecha: d.issue_date, punto: d.point_name, tienda: d.store_name ?? "", emisor: d.issuer_name, nit_emisor: d.issuer_doc,
      cliente: d.customer_name, documento_cliente: d.customer_doc, total: d.total, impuestos: d.tax_total, cufe: d.cufe,
      proveedor: d.provider, estado_dian: d.dian_status, intentos: d.attempts, error: d.last_error_message, creado_por: d.created_by_name,
    }))));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Número, CUFE, NIT, cliente, punto, usuario o error…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2.4rem" }} />
        </div>
        <Button icon={<Filter size={15} />} onClick={() => setShowFilters((v) => !v)}>Filtros</Button>
        {canExport ? <Button icon={<Download size={15} />} onClick={exportCsv} disabled={!items.length}>Exportar CSV</Button> : null}
      </div>

      {showFilters ? (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Desde"><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={inputCls} style={inputStyle} /></Field>
            <Field label="Hasta"><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={inputCls} style={inputStyle} /></Field>
            {!admin && data ? (
              <Field label="Punto">
                <select value={filters.point_id} onChange={(e) => setFilters((f) => ({ ...f, point_id: e.target.value }))} className={inputCls} style={inputStyle}>
                  <option value="">Todos mis puntos</option>
                  {data.points.map((p) => <option key={p.point.id} value={p.point.id}>{p.point.name}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Ambiente">
              <select value={filters.environment} onChange={(e) => setFilters((f) => ({ ...f, environment: e.target.value }))} className={inputCls} style={inputStyle}>
                <option value="">Todos</option>
                <option value="production">🟢 Producción</option>
                <option value="sandbox">🧪 Pruebas</option>
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-bold" style={{ color: "var(--t-muted)" }}>Estado</p>
            <div className="flex flex-wrap gap-1.5">
              {FISCAL_STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => toggle("statuses", s)} className="rounded-full border px-3 py-1 text-xs font-semibold" style={filters.statuses.includes(s) ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                  {STATUS_INFO[s].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-bold" style={{ color: "var(--t-muted)" }}>Tipo de documento</p>
            <div className="flex flex-wrap gap-1.5">
              {FISCAL_DOC_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => toggle("types", t)} className="rounded-full border px-3 py-1 text-xs font-semibold" style={filters.types.includes(t) ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>
                  {DOC_TYPE_INFO[t].icon} {DOC_TYPE_INFO[t].short}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.errors_only} onChange={(e) => setFilters((f) => ({ ...f, errors_only: e.target.checked }))} />
            Solo documentos con error o rechazo
          </label>
        </Card>
      ) : null}

      {totals ? (
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>
          {totals.count} documentos en el periodo · aceptado {fmtMoney(totals.total)} · impuestos {fmtMoney(totals.tax)}
        </p>
      ) : null}
      {error ? <ErrorBox message={error} onRetry={() => void load(false)} /> : null}
      {loading && !items.length ? <Skeleton rows={5} /> : null}
      {!loading && !error && !items.length ? (
        <EmptyState icon="🧾" title="No hay documentos con estos filtros" text="Los documentos electrónicos aparecen aquí cuando se factura desde el POS o desde «Por facturar»." />
      ) : null}

      <div className="space-y-2">
        {items.map((d) => (
          <button key={d.id} type="button" onClick={() => setOpenId(d.id)} className="block w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 sm:p-4" style={{ borderColor: d.status === "REJECTED" ? "color-mix(in oklab, #ef4444 45%, transparent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 94%, transparent)" }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-black">
                  {DOC_TYPE_INFO[d.document_type]?.icon} {d.full_number ?? "Sin número"}
                  <StatusBadge status={d.status} />
                  <EnvBadge env={d.environment} />
                </p>
                <p className="mt-0.5 truncate text-xs" style={{ color: "var(--t-muted)" }}>
                  {docLabel(d.document_type)} · {fmtDateTime(d.issue_date)} · {d.store_name ? `${d.store_name} · ` : ""}{d.point_name ?? "—"} · {d.customer_name ?? "Consumidor final"}
                </p>
                {d.last_error_message ? <p className="mt-1 text-xs text-red-500">⚠️ {d.last_error_message}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-sm font-black tabular-nums">{fmtMoney(d.total)}</p>
                <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{d.issuer_name}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {cursor ? (
        <div className="flex justify-center">
          <Button busy={loading} onClick={() => void load(true, cursor)}>Cargar más</Button>
        </div>
      ) : null}

      <DocumentDrawer id={openId} access={access} onClose={() => setOpenId(null)} onChanged={() => { void load(false); onChanged?.(); }} onOpen={setOpenId} />
    </div>
  );
}
