"use client";

import { Fragment, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, ddmmyyyy } from "@/components/forms/Fields";
import { PurchaseFilesButton } from "./AttachmentsUI";
import { Btn, Empty, Panel, StatusPill, dateTime, inputClass, inputStyle, money, tableWrap, td, th } from "./shared";
import { emptyFilters, filtersActive, quickRange, type PurchaseFilters, type PurchaseRow, type usePurchaseSearch } from "./purchase-search";

type Search = ReturnType<typeof usePurchaseSearch>;
type Item = { product_id: string; qty: number; unit_cost: number; line_total: number | null; products: { name: string; sku: string | null } | null };

const purchaseReceiptUrl = (id: string, choose = false) => `/comprobante/ingreso/${id}${choose ? "?elegir=1" : ""}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Historial de ingresos de factura con buscador, filtros, totales y vista rápida de los productos. */
export function PurchaseHistory({
  search, suppliers, editingId, loadingEdit, canBuy, canVoid, onEdit, onCancel,
}: {
  search: Search;
  suppliers: Array<{ id: string; name: string; nit: string | null }>;
  editingId: string | null;
  loadingEdit: string | null;
  canBuy: boolean;
  canVoid: boolean;
  onEdit: (row: PurchaseRow) => void;
  onCancel: (row: PurchaseRow) => void;
}) {
  const { filters: f, setFilter, setFilters, rows, count, sum, matches, edited, loading, error, loadMore, hasMore } = search;
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const [open, setOpen] = useState<Record<string, Item[] | "loading">>({});
  const active = filtersActive(f);

  async function toggle(id: string) {
    if (open[id]) {
      return setOpen((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
    }
    setOpen((cur) => ({ ...cur, [id]: "loading" }));
    const { data } = await supabaseBrowser().from("erp_purchase_items").select("product_id,qty,unit_cost,line_total,products(name,sku)").eq("purchase_id", id);
    setOpen((cur) => ({ ...cur, [id]: (data ?? []) as unknown as Item[] }));
  }

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["N.º", "Factura", "Fecha", "Proveedor", "Revisó", "Recibió", "Pago", "Vence", "Total", "Estado"];
    const lines = rows.map((r) => [
      r.number, r.invoice_ref, ddmmyyyy(r.invoice_date ?? r.created_at.slice(0, 10)), supplierNames.get(r.supplier_id), r.checked_by_name,
      r.received_by_name ?? r.created_by_name, r.payment_type === "credit" ? "Crédito" : "Contado", r.due_date ? ddmmyyyy(r.due_date) : "",
      Math.round(Number(r.total || 0)), r.status === "cancelled" ? "Anulada" : "Recibida",
    ].map(esc).join(";"));
    const blob = new Blob([`﻿${[head.map(esc).join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ingresos-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const range = (kind: Parameters<typeof quickRange>[0]) => setFilters((cur: PurchaseFilters) => ({ ...cur, ...quickRange(kind) }));
  const chip = "rounded-full border px-3 py-1 text-xs font-semibold transition hover:brightness-110";
  const chipStyle = { borderColor: "var(--t-card-border)", color: "var(--t-text)" };

  return (
    <Panel
      title="Historial de ingresos"
      subtitle={canBuy ? "Busca por número, factura, proveedor, NIT, producto o quien recibió. Toca ✏️ Editar para corregir un ingreso." : "Busca por número, factura, proveedor, NIT, producto o quien recibió."}
      actions={rows.length ? <Btn variant="ghost" onClick={exportCsv}>⬇️ Exportar</Btn> : undefined}
    >
      {/* Buscador y filtros */}
      <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <input
            className={inputClass}
            style={inputStyle}
            value={f.q}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder="🔍 #12, factura 14266, WALTER, NIT, cable USB, SARA…"
            aria-label="Buscar ingresos"
          />
          {f.q ? (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 px-2 text-sm" style={{ color: "var(--t-muted)" }} onClick={() => setFilter("q", "")} aria-label="Borrar búsqueda">✕</button>
          ) : null}
        </div>
        <select className={inputClass} style={inputStyle} value={f.supplier} onChange={(e) => setFilter("supplier", e.target.value)} aria-label="Proveedor">
          <option value="">Todos los proveedores</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={inputClass} style={inputStyle} value={f.pay} onChange={(e) => setFilter("pay", e.target.value as PurchaseFilters["pay"])} aria-label="Pago">
          <option value="all">Contado y crédito</option>
          <option value="cash">Solo contado</option>
          <option value="credit">Solo crédito</option>
          <option value="overdue">Crédito ya vencido</option>
        </select>
        <select className={inputClass} style={inputStyle} value={f.status} onChange={(e) => setFilter("status", e.target.value as PurchaseFilters["status"])} aria-label="Estado">
          <option value="all">Recibidas y anuladas</option>
          <option value="received">Solo recibidas</option>
          <option value="cancelled">Solo anuladas</option>
        </select>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Fecha factura:</span>
        <DateField compact value={f.from} onChange={(v) => setFilter("from", v)} max={f.to || undefined} ariaLabel="Desde" placeholder="Desde" className="w-36" />
        <span className="text-xs" style={{ color: "var(--t-muted)" }}>a</span>
        <DateField compact value={f.to} onChange={(v) => setFilter("to", v)} min={f.from || undefined} ariaLabel="Hasta" placeholder="Hasta" className="w-36" />
        <button type="button" className={chip} style={chipStyle} onClick={() => range("month")}>Este mes</button>
        <button type="button" className={chip} style={chipStyle} onClick={() => range("last_month")}>Mes pasado</button>
        <button type="button" className={chip} style={chipStyle} onClick={() => range("30d")}>Últimos 30 días</button>
        <button type="button" className={chip} style={chipStyle} onClick={() => range("year")}>Este año</button>
        {active ? (
          <button type="button" className={chip} style={{ ...chipStyle, color: "var(--t-accent)" }} onClick={() => setFilters(emptyFilters())}>✕ Limpiar filtros</button>
        ) : null}
      </div>

      {/* Resumen de lo encontrado */}
      {active ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 7%, transparent)" }}>
          <span><b>{count ?? "…"}</b> ingreso{count === 1 ? "" : "s"} encontrado{count === 1 ? "" : "s"}</span>
          {sum != null ? <span>Total comprado: <b>{money(sum)}</b> <span className="text-xs" style={{ color: "var(--t-muted)" }}>(sin anuladas)</span></span> : null}
          {loading ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>Buscando…</span> : null}
        </div>
      ) : null}
      {error ? <p className="mb-3 text-sm" style={{ color: "#ef4444" }}>No se pudo buscar: {error}</p> : null}

      {rows.length === 0 ? (
        <Empty text={loading ? "Buscando…" : active ? "Ningún ingreso coincide con la búsqueda." : "Todavía no hay ingresos de factura."} />
      ) : (
        <div className={tableWrap} style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full min-w-[820px]">
            <thead style={{ color: "var(--t-muted)" }}>
              <tr><th className={th}>N.º</th><th className={th}>Fecha</th><th className={th}>Proveedor</th><th className={th}>Revisó / Recibió</th><th className={th}>Pago</th><th className={th}>Total</th><th className={th}>Estado</th><th className={th} /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hit = matches[r.id];
                const items = open[r.id];
                const overdue = r.payment_type === "credit" && r.status === "received" && r.due_date && r.due_date < todayIso();
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-t transition-colors"
                      style={{ borderColor: "var(--t-card-border)", background: editingId === r.id ? "color-mix(in oklab, var(--t-accent) 10%, transparent)" : undefined, opacity: r.status === "cancelled" ? 0.65 : 1 }}
                    >
                      <td className={td} style={{ fontWeight: 600 }}>
                        #{r.number}
                        {r.invoice_ref ? <span className="block text-xs font-normal" style={{ color: "var(--t-muted)" }}>Fact. {r.invoice_ref}</span> : null}
                        {edited[r.id] ? <span className="mt-0.5 block text-[11px] font-normal" style={{ color: "var(--t-accent)" }} title={dateTime(edited[r.id].at)}>✏️ Editado{edited[r.id].count > 1 ? ` ${edited[r.id].count} veces` : ""}</span> : null}
                      </td>
                      <td className={td}>{ddmmyyyy(r.invoice_date ?? r.created_at.slice(0, 10))}</td>
                      <td className={td}>{supplierNames.get(r.supplier_id) ?? "—"}</td>
                      <td className={td}>{r.checked_by_name ?? "—"} / {r.received_by_name ?? r.created_by_name ?? "—"}</td>
                      <td className={td}>
                        {r.payment_type === "credit" ? `Crédito${r.due_date ? ` · vence ${ddmmyyyy(r.due_date)}` : ""}` : "Contado"}
                        {overdue ? <span className="mt-0.5 block text-[11px] font-semibold" style={{ color: "#f59e0b" }}>⚠️ Ya venció</span> : null}
                      </td>
                      <td className={td} style={{ fontWeight: 600 }}>{money(r.total)}</td>
                      <td className={td}><StatusPill status={r.status} /></td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          <Btn variant="ghost" onClick={() => void toggle(r.id)}>{items ? "▲ Ocultar" : "📦 Productos"}</Btn>
                          {canBuy && r.status === "received" ? (
                            <Btn variant={editingId === r.id ? "primary" : "ghost"} onClick={() => onEdit(r)} disabled={loadingEdit === r.id}>
                              {loadingEdit === r.id ? "Abriendo…" : editingId === r.id ? "✏️ Editando" : "✏️ Editar"}
                            </Btn>
                          ) : null}
                          <Btn variant="ghost" onClick={() => window.open(purchaseReceiptUrl(r.id, true), "_blank")}>🧾 Comprobante</Btn>
                          <PurchaseFilesButton purchaseId={r.id} />
                          {canVoid && r.status === "received" ? <Btn variant="danger" onClick={() => onCancel(r)}>Anular</Btn> : null}
                        </div>
                      </td>
                    </tr>
                    {hit && !items ? (
                      <tr style={{ borderColor: "var(--t-card-border)" }}>
                        <td colSpan={8} className="px-3 pb-2.5 pt-0 text-xs" style={{ color: "var(--t-muted)" }}>
                          🔎 Trae:{" "}
                          {hit.slice(0, 4).map((m, i) => (
                            <span key={i} className="mr-2 inline-block rounded-full border px-2 py-0.5" style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)" }}>
                              {m.name}{m.sku ? ` (${m.sku})` : ""} · {m.qty} u × {money(m.unit_cost)}
                            </span>
                          ))}
                          {hit.length > 4 ? `+${hit.length - 4} más` : null}
                        </td>
                      </tr>
                    ) : null}
                    {items ? (
                      <tr>
                        <td colSpan={8} className="px-3 pb-3 pt-0">
                          {items === "loading" ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cargando productos…</p> : items.length === 0 ? (
                            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin productos.</p>
                          ) : (
                            <ItemsTable key={f.q} items={items} term={f.q} hitIds={new Set((hit ?? []).map((m) => m.product_id))} />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasMore ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Btn variant="ghost" onClick={() => void loadMore()} disabled={loading}>{loading ? "Cargando…" : "Cargar más"}</Btn>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>Mostrando {rows.length} de {count}</span>
        </div>
      ) : null}
    </Panel>
  );
}

const foldText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Resalta en el texto las palabras buscadas (sin importar tildes ni mayúsculas). */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const folded = foldText(text);
  // Marcas por posición sobre el texto sin tildes (mismo largo que el original letra a letra).
  const on = new Array(text.length).fill(false);
  for (const w of words) {
    let at = folded.indexOf(w);
    while (at >= 0) {
      for (let k = at; k < at + w.length && k < on.length; k++) on[k] = true;
      at = folded.indexOf(w, at + w.length);
    }
  }
  const parts: Array<{ t: string; m: boolean }> = [];
  for (let k = 0; k < text.length; k++) {
    const last = parts[parts.length - 1];
    if (last && last.m === on[k]) last.t += text[k];
    else parts.push({ t: text[k], m: on[k] });
  }
  return (
    <>
      {parts.map((p, k) => (p.m ? (
        <mark key={k} className="rounded px-0.5" style={{ background: "color-mix(in oklab, #facc15 70%, transparent)", color: "#111827" }}>{p.t}</mark>
      ) : <span key={k}>{p.t}</span>))}
    </>
  );
}

/** Productos de un ingreso: lo buscado queda resaltado y arriba; se puede buscar dentro de la factura o ver solo lo que coincide. */
function ItemsTable({ items, term, hitIds }: { items: Item[]; term: string; hitIds: Set<string> }) {
  const [local, setLocal] = useState(term);
  const [onlyHits, setOnlyHits] = useState(false);
  const words = foldText(local).split(/\s+/).filter((w) => w.length >= 2);
  const matches = (it: Item) => {
    // Coincide si es el producto que trajo la búsqueda, o si su nombre/código tiene todas las palabras escritas aquí.
    if (local === term && hitIds.has(it.product_id)) return true;
    if (!words.length) return false;
    const hay = foldText(`${it.products?.name ?? ""} ${it.products?.sku ?? ""}`);
    return words.every((w) => hay.includes(w));
  };
  const rows = items.map((it, i) => ({ it, i, hit: matches(it) }));
  const hits = rows.filter((r) => r.hit).length;
  // Lo que coincide va primero (conserva el orden de la factura dentro de cada grupo).
  const ordered = [...rows].sort((a, b) => Number(b.hit) - Number(a.hit) || a.i - b.i).filter((r) => !onlyHits || r.hit);

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
        <input
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={`🔍 Buscar en esta factura (${items.length} productos)`}
          aria-label="Buscar en esta factura"
        />
        {words.length || (local === term && hitIds.size) ? (
          <span className="text-xs font-semibold" style={{ color: hits ? "#facc15" : "var(--t-muted)" }}>
            {hits ? `★ ${hits} de ${items.length} coincide${hits === 1 ? "" : "n"}` : "Ninguno coincide"}
          </span>
        ) : null}
        {hits ? (
          <button type="button" className="rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)", color: onlyHits ? "var(--t-accent)" : "var(--t-text)" }} onClick={() => setOnlyHits((v) => !v)}>
            {onlyHits ? "Ver todos" : "Ver solo coincidencias"}
          </button>
        ) : null}
      </div>
      <table className="w-full text-xs">
        <thead style={{ color: "var(--t-muted)" }}>
          <tr><th className="px-3 py-1.5 text-left">Producto</th><th className="px-3 py-1.5 text-right">Cant.</th><th className="px-3 py-1.5 text-right">Costo unit.</th><th className="px-3 py-1.5 text-right">Subtotal</th></tr>
        </thead>
        <tbody>
          {ordered.map(({ it, i, hit }) => (
            <tr
              key={i}
              className="border-t"
              style={{
                borderColor: "var(--t-card-border)",
                background: hit ? "color-mix(in oklab, #facc15 16%, transparent)" : undefined,
                boxShadow: hit ? "inset 3px 0 0 #facc15" : undefined,
                fontWeight: hit ? 700 : undefined,
              }}
            >
              <td className="px-3 py-1.5">
                {hit ? <span className="mr-1" style={{ color: "#facc15" }}>★</span> : null}
                <Marked text={it.products?.name ?? "—"} words={words} />
                {it.products?.sku ? <span style={{ color: "var(--t-muted)" }}> · <Marked text={it.products.sku} words={words} /></span> : null}
              </td>
              <td className="px-3 py-1.5 text-right">{it.qty}</td>
              <td className="px-3 py-1.5 text-right">{money(it.unit_cost)}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{money(it.line_total ?? Number(it.qty) * Number(it.unit_cost))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
