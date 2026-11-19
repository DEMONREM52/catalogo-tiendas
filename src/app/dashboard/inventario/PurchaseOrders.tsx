"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField, ddmmyyyy } from "@/components/forms/Fields";
import { MoneyInput } from "../MoneyInput";
import { ProductPicker } from "./LineEditor";
import { useSuppliers } from "./PurchasesTabs";
import { Btn, Empty, Panel, errorMessage, inputClass, inputStyle, money, toast, type ErpCtx } from "./shared";

/**
 * Órdenes de compra (20261327): lo que se le pide al proveedor antes de que llegue la factura.
 * No mueven inventario ni plata. Al llegar la mercancía: «📥 Recibir con factura» lleva al ingreso con lo pendiente,
 * y al registrarlo la orden queda asociada y compara lo pedido con lo recibido.
 */

type Status = "open" | "partial" | "received" | "closed" | "cancelled";
type OrderRow = { id: string; number: number; status: Status; expected_date: string | null; notes: string | null; created_at: string; supplier_id: string; supplier: string; units: number; total: number; lines: number; units_received: number; invoices: number };
type DetailItem = { product_id: string; name: string; sku: string | null; qty: number; unit_cost: number; received: number; received_cost: number | null; pending: number; extra: number };
type Detail = {
  order: { id: string; number: number; status: Status; expected_date: string | null; notes: string | null; created_at: string; supplier_id: string; supplier: string; supplier_phone: string | null };
  items: DetailItem[];
  unordered: Array<{ product_id: string; name: string; sku: string | null; received: number; received_cost: number | null }>;
  invoices: Array<{ id: string; number: number; invoice_ref: string | null; status: string; total: number; created_at: string }>;
};
type Draft = { id: string | null; supplier: string; expected: string; notes: string; items: Array<{ product_id: string; name: string; sku: string | null; qty: number; unit_cost: number }> };

export const PO_STATUS: Record<Status, { label: string; color: string }> = {
  open: { label: "Abierta", color: "#0ea5e9" },
  partial: { label: "Llegó una parte", color: "#d97706" },
  received: { label: "Llegó todo", color: "#10b981" },
  closed: { label: "Cerrada", color: "#64748b" },
  cancelled: { label: "Anulada", color: "#e5484d" },
};

const missingMigration = (m?: string) => /Could not find the function|schema cache|erp_po_/i.test(m ?? "");

export async function loadPurchaseOrder(id: string): Promise<Detail | null> {
  const { data, error } = await supabaseBrowser().rpc("erp_po_detail", { p_order: id });
  const d = data as ({ ok?: boolean; message?: string } & Partial<Detail>) | null;
  if (error || !d?.ok) {
    void toast("No se pudo abrir la orden", "error", missingMigration(error?.message) ? "Falta correr la migración 20261327 en Supabase." : d?.message ?? (error ? errorMessage(error) : undefined));
    return null;
  }
  return d as Detail;
}

/** Resumen corto de cómo llegó la orden frente a lo pedido. */
export function poSummary(d: Detail) {
  const missing = d.items.filter((i) => i.pending > 0);
  const extra = d.items.filter((i) => i.extra > 0);
  const priced = d.items.filter((i) => i.received > 0 && i.received_cost !== null && i.unit_cost > 0 && Math.abs(Number(i.received_cost) - i.unit_cost) >= 1);
  const parts = [
    missing.length ? `faltan ${missing.reduce((s, i) => s + i.pending, 0)} und. de ${missing.length} producto(s)` : "no falta nada",
    extra.length ? `sobran ${extra.reduce((s, i) => s + i.extra, 0)} und.` : "",
    priced.length ? `${priced.length} con otro costo` : "",
    d.unordered.length ? `${d.unordered.length} que no se pidió` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function PurchaseOrdersTab({ ctx }: { ctx: ErpCtx }) {
  const { suppliers } = useSuppliers(ctx.storeId);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("erp_po_list", { p_store: ctx.storeId, p_status: filter === "pending" ? "pending" : null });
    const d = data as { ok?: boolean; items?: OrderRow[] } | null;
    if (error && missingMigration(error.message)) { setMissing(true); setRows([]); return; }
    setRows(d?.ok ? d.items ?? [] : []);
  }, [ctx.storeId, filter]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function open(id: string) {
    const d = await loadPurchaseOrder(id);
    if (d) { setDetail(d); setDraft(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
  }

  async function save() {
    if (!draft) return;
    if (!draft.supplier) return void toast("Elige el proveedor", "warning");
    if (!draft.items.length) return void toast("Agrega al menos un producto", "warning");
    if (draft.items.some((i) => !(i.qty > 0) || !Number.isInteger(i.qty))) return void toast("Cada producto necesita una cantidad entera mayor que 0", "warning");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_po_save", {
      p_store: ctx.storeId, p_order: draft.id, p_supplier: draft.supplier, p_expected: draft.expected || null, p_notes: draft.notes,
      p_items: draft.items.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.unit_cost })),
    });
    setBusy(false);
    const d = data as { ok?: boolean; id?: string; number?: number; message?: string } | null;
    if (error || !d?.ok) return void toast("No se guardó la orden", "error", missingMigration(error?.message) ? "Falta correr la migración 20261327 en Supabase." : d?.message ?? (error ? errorMessage(error) : undefined));
    void toast(`Orden de compra N.º ${d.number} guardada`, "success", "No mueve inventario: cuando llegue la mercancía, «Recibir con factura».");
    setDraft(null);
    void load();
    if (d.id) void open(d.id);
  }

  async function setStatus(status: "closed" | "cancelled" | "open") {
    if (!detail) return;
    const text = status === "closed" ? "Queda cerrada aunque falte algo (ya no llegará). Se puede reabrir." : status === "cancelled" ? "Se anula la orden. No se puede deshacer." : "Vuelve a quedar pendiente lo que falte.";
    const ok = await Swal.fire({ icon: "question", title: status === "closed" ? "¿Cerrar la orden?" : status === "cancelled" ? "¿Anular la orden?" : "¿Reabrir la orden?", text,
      showCancelButton: true, confirmButtonText: "Sí", cancelButtonText: "No", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!ok.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_po_status", { p_order: detail.order.id, p_status: status });
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) return void toast("No se pudo", "error", d?.message ?? (error ? errorMessage(error) : undefined));
    void open(detail.order.id);
    void load();
  }

  function orderText(d: Detail) {
    const lines = d.items.map((i) => `• ${i.qty} × ${i.name}${i.sku ? ` (${i.sku})` : ""}`).join("\n");
    return `Hola, ${d.order.supplier}. Orden de compra N.º ${d.order.number}${d.order.expected_date ? `, para el ${ddmmyyyy(d.order.expected_date)}` : ""}:\n${lines}${d.order.notes ? `\n\nNota: ${d.order.notes}` : ""}`;
  }

  function editDetail(d: Detail) {
    setDraft({ id: d.order.id, supplier: d.order.supplier_id, expected: d.order.expected_date ?? "", notes: d.order.notes ?? "",
      items: d.items.map((i) => ({ product_id: i.product_id, name: i.name, sku: i.sku, qty: i.qty, unit_cost: Number(i.unit_cost) })) });
    setDetail(null);
  }

  if (missing) return <Empty icon="📋" title="Órdenes de compra" text="Falta correr la migración 20261327_ordenes_de_compra.sql en Supabase." />;
  const canBuy = ctx.can("purchases");
  const draftTotal = draft ? draft.items.reduce((s, i) => s + i.qty * i.unit_cost, 0) : 0;

  return (
    <div className="space-y-5">
      {draft ? (
        <Panel title={draft.id ? "✏️ Editar orden de compra" : "📋 Nueva orden de compra"} subtitle="Lo que le pides al proveedor. No mueve inventario ni crea deuda: eso pasa cuando registras la factura.">
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={inputClass} style={inputStyle} value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} aria-label="Proveedor">
              <option value="">— Proveedor —</option>
              {suppliers.filter((s) => s.active || s.id === draft.supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <DateField value={draft.expected} onChange={(v) => setDraft({ ...draft, expected: v })} ariaLabel="Fecha en que debe llegar" />
            <input className={inputClass} style={inputStyle} value={draft.notes} maxLength={500} placeholder="Nota para el proveedor (opcional)" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="mt-3">
            <ProductPicker storeId={ctx.storeId} includeInactive keepOpen placeholder="🔎 Agrega productos a la orden (nombre, código o código del proveedor)…"
              addedQty={Object.fromEntries(draft.items.map((i) => [i.product_id, i.qty]))}
              onPick={(h) => setDraft((cur) => cur && (cur.items.some((i) => i.product_id === h.id) ? cur
                : { ...cur, items: [...cur.items, { product_id: h.id, name: h.name, sku: h.sku, qty: 1, unit_cost: Number(h.cost_price ?? 0) }] }))} />
          </div>
          {draft.items.length ? (
            <div className="mt-3 space-y-2">
              {draft.items.map((i, k) => (
                <div key={i.product_id} className="grid grid-cols-[minmax(0,1fr)_90px_140px_32px] items-center gap-2 rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
                  <span className="min-w-0"><b className="block truncate text-sm">{i.name}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{i.sku ?? ""}</span></span>
                  <input className={`${inputClass} text-right`} style={inputStyle} inputMode="numeric" value={String(i.qty)} aria-label={`Cantidad de ${i.name}`}
                    onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === k ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)) } : x)) })} />
                  <MoneyInput className={`${inputClass} text-right`} style={inputStyle} ariaLabel={`Costo esperado de ${i.name}`} value={i.unit_cost}
                    onValueChange={(v) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === k ? { ...x, unit_cost: v ?? 0 } : x)) })} />
                  <button type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== k) })} aria-label={`Quitar ${i.name}`} style={{ color: "#e5484d" }}>✕</button>
                </div>
              ))}
              <p className="text-right text-sm" style={{ color: "var(--t-muted)" }}>{draft.items.length} producto(s) · {draft.items.reduce((s, i) => s + i.qty, 0)} und. · Costo esperado <b style={{ color: "var(--t-text)" }}>{money(draftTotal)}</b></p>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "💾 Guardar orden"}</Btn>
            <Btn variant="ghost" onClick={() => setDraft(null)}>Cancelar</Btn>
          </div>
        </Panel>
      ) : null}

      {detail ? (
        <Panel title={`📋 Orden de compra N.º ${detail.order.number} · ${detail.order.supplier}`}
          subtitle={`${PO_STATUS[detail.order.status].label}${detail.order.expected_date ? ` · debe llegar el ${ddmmyyyy(detail.order.expected_date)}` : ""} · creada el ${ddmmyyyy(detail.order.created_at.slice(0, 10))}${detail.invoices.length ? ` · ${poSummary(detail)}` : ""}`}
          actions={<Btn variant="ghost" onClick={() => setDetail(null)}>Cerrar</Btn>}>
          {detail.order.notes ? <p className="mb-2 text-sm">📝 {detail.order.notes}</p> : null}
          <div className="overflow-auto">
            <table className="rt w-full text-sm">
              <thead><tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
                <th className="py-1 pr-2">Producto</th><th className="px-2 text-right">Pedido</th><th className="px-2 text-right">Llegó</th><th className="px-2 text-right">Diferencia</th><th className="px-2 text-right">Costo pedido</th><th className="pl-2 text-right">Costo real</th>
              </tr></thead>
              <tbody>
                {detail.items.map((i) => {
                  const cost = i.received_cost === null ? null : Number(i.received_cost);
                  const dc = cost !== null && i.unit_cost > 0 ? ((cost - i.unit_cost) / i.unit_cost) * 100 : null;
                  return (
                    <tr key={i.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="py-2 pr-2"><b>{i.name}</b>{i.sku ? <span className="text-xs" style={{ color: "var(--t-muted)" }}> · {i.sku}</span> : null}</td>
                      <td className="px-2 text-right">{i.qty}</td>
                      <td className="px-2 text-right">{i.received}</td>
                      <td className="px-2 text-right font-bold" style={{ color: i.pending ? "#d97706" : i.extra ? "#0ea5e9" : "#10b981" }}>
                        {i.pending ? `faltan ${i.pending}` : i.extra ? `sobran ${i.extra}` : "✓"}
                      </td>
                      <td className="px-2 text-right">{money(i.unit_cost)}</td>
                      <td className="pl-2 text-right">
                        {cost === null ? "—" : money(cost)}
                        {dc !== null && Math.abs(dc) >= 0.5 ? <span className="block text-[10px] font-bold" style={{ color: dc > 0 ? "#e5484d" : "#10b981" }}>{dc > 0 ? "▲" : "▼"} {Math.abs(dc).toFixed(1).replace(".", ",")} %</span> : null}
                      </td>
                    </tr>
                  );
                })}
                {detail.unordered.map((u) => (
                  <tr key={u.product_id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className="py-2 pr-2"><b>{u.name}</b> <span className="text-xs font-bold" style={{ color: "#0ea5e9" }}>· no se pidió</span></td>
                    <td className="px-2 text-right">0</td><td className="px-2 text-right">{u.received}</td><td className="px-2 text-right" style={{ color: "#0ea5e9" }}>+{u.received}</td>
                    <td className="px-2 text-right">—</td><td className="pl-2 text-right">{u.received_cost === null ? "—" : money(Number(u.received_cost))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.invoices.length ? (
            <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>
              Facturas asociadas: {detail.invoices.map((f) => (
                <a key={f.id} href={`/comprobante/ingreso/${f.id}?elegir=1`} target="_blank" rel="noreferrer" className="mr-2 font-bold underline" style={{ color: f.status === "cancelled" ? "#e5484d" : "var(--t-text)" }}>
                  Ingreso #{f.number}{f.invoice_ref ? ` (fact. ${f.invoice_ref})` : ""}{f.status === "cancelled" ? " · anulado" : ""}
                </a>
              ))}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {canBuy && (detail.order.status === "open" || detail.order.status === "partial") ? (
              <Btn onClick={() => { window.location.href = `${window.location.origin}/dashboard/inventario?tab=purchases&oc=${detail.order.id}`; }}>📥 Recibir con factura</Btn>
            ) : null}
            {detail.order.status === "open" && !detail.invoices.length ? <Btn variant="ghost" onClick={() => editDetail(detail)}>✏️ Editar</Btn> : null}
            <Btn variant="ghost" onClick={() => { void navigator.clipboard?.writeText(orderText(detail)).then(() => toast("Orden copiada")); }}>📋 Copiar</Btn>
            <Btn variant="ghost" onClick={() => {
              const phone = (detail.order.supplier_phone ?? "").replace(/\D/g, "");
              window.open(`https://wa.me/${phone ? (phone.length === 10 ? `57${phone}` : phone) : ""}?text=${encodeURIComponent(orderText(detail))}`, "_blank");
            }}>📲 Enviar por WhatsApp</Btn>
            {detail.order.status === "open" || detail.order.status === "partial" ? <Btn variant="ghost" onClick={() => void setStatus("closed")}>Cerrar (ya no llega más)</Btn> : null}
            {detail.order.status === "closed" ? <Btn variant="ghost" onClick={() => void setStatus("open")}>Reabrir</Btn> : null}
            {!detail.invoices.length && detail.order.status !== "cancelled" ? <Btn variant="ghost" onClick={() => void setStatus("cancelled")}>Anular</Btn> : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="Órdenes de compra" subtitle="Pide al proveedor y, cuando llegue la factura, compara lo pedido con lo que llegó."
        actions={canBuy && !draft ? <Btn onClick={() => { setDetail(null); setDraft({ id: null, supplier: "", expected: "", notes: "", items: [] }); }}>＋ Nueva orden</Btn> : undefined}>
        <div className="mb-3 flex gap-2">
          {(["pending", "all"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className="rounded-full border px-3 py-1 text-xs font-bold"
              style={{ borderColor: "var(--t-card-border)", background: filter === f ? "color-mix(in oklab, var(--t-accent) 18%, transparent)" : "transparent" }}>
              {f === "pending" ? "Pendientes" : "Todas"}
            </button>
          ))}
        </div>
        {rows === null ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : rows.length === 0 ? (
          <Empty icon="📋" text={filter === "pending" ? "No hay órdenes pendientes." : "Todavía no hay órdenes de compra."} />
        ) : (
          <div className="space-y-2">
            {rows.map((o) => (
              <button key={o.id} type="button" onClick={() => void open(o.id)} className="flex w-full flex-wrap items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                style={{ borderColor: "var(--t-card-border)" }}>
                <span className="min-w-0 flex-1">
                  <b className="block">N.º {o.number} · {o.supplier}</b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>
                    {ddmmyyyy(o.created_at.slice(0, 10))}{o.expected_date ? ` · llega el ${ddmmyyyy(o.expected_date)}` : ""} · {o.lines} producto(s) · {Number(o.units_received)} de {Number(o.units)} und.{o.invoices ? ` · ${o.invoices} factura(s)` : ""}
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums">{money(Number(o.total))}</span>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `color-mix(in oklab, ${PO_STATUS[o.status].color} 16%, transparent)`, color: PO_STATUS[o.status].color }}>
                  {PO_STATUS[o.status].label}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
