"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseDianInvoice, xmlFromZip, type DianInvoice } from "@/lib/purchases/dian-xml";
import type { Staged } from "./AttachmentsUI";
import { useProductSearch, type Line } from "./LineEditor";
import { QuickProductModal } from "./QuickProductModal";
import { Btn, errorMessage, inputClass, inputStyle, money, toast, type ProductHit } from "./shared";

type Choice = { product_id: string; name: string; sku: string | null; stock: number; tax_rate: number; how: string } | null;
type MatchLine = { idx: number; how: string | null; product_id: string | null; name: string | null; sku: string | null; tax_rate: number | null; stock: number };
type Match = { ok: boolean; message?: string; supplier: { id: string; name: string; nit: string | null; payment_days: number; active: boolean } | null; duplicate: { id: string; number: number } | null; lines: MatchLine[] };

export type XmlApply = {
  supplier: string;
  invoiceRef: string;
  invoiceDate: string;
  paymentType: "cash" | "credit";
  dueDate: string;
  lines: Line[];
  file: Staged;
};

const HOW: Record<string, string> = { learned: "✓ aprendido", barcode: "✓ código de barras", sku: "✓ SKU", name: "✓ mismo nombre", manual: "elegido", created: "creado" };
const code = (l: DianInvoice["lines"][number]) => l.sellerCode || l.standardCode;
const ddmm = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/**
 * «Cargar XML»: lee la factura electrónica del proveedor (XML o ZIP del correo) y llena el ingreso:
 * proveedor por NIT, número, fechas, crédito, productos, cantidades, costo sin IVA e IVA.
 * Lo que se empareja a mano queda aprendido para la próxima factura de ese proveedor.
 */
export function XmlImportButton({ storeId, warehouseId, canCreateProducts, onApply, onSuppliersChanged }: {
  storeId: string;
  warehouseId: string;
  canCreateProducts: boolean;
  onApply: (data: XmlApply) => void;
  onSuppliersChanged: () => Promise<void> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ inv: DianInvoice; match: Match; file: File; xml: string } | null>(null);
  const [reading, setReading] = useState(false);

  async function read(file: File) {
    setReading(true);
    try {
      const xml = /\.zip$/i.test(file.name) || file.type.includes("zip") ? await xmlFromZip(await file.arrayBuffer()) : await file.text();
      const inv = parseDianInvoice(xml);
      if (!inv.lines.length) throw new Error("La factura no trae productos.");
      const { data, error } = await supabaseBrowser().rpc("erp_purchase_xml_match", {
        p_store: storeId, p_nit: inv.supplier.nit, p_invoice_ref: inv.number,
        p_lines: inv.lines.map((l) => ({ seller_code: l.sellerCode, standard_code: l.standardCode, description: l.description })),
      });
      if (error) throw new Error(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar la migración 20261246 en Supabase." : errorMessage(error));
      const match = data as Match;
      if (!match?.ok) throw new Error(match?.message ?? "No se pudo revisar la factura.");
      setState({ inv, match, file, xml });
    } catch (err) {
      void toast("No se pudo leer el XML", "error", err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <Btn variant="ghost" disabled={reading} onClick={() => input.current?.click()}>{reading ? "Leyendo…" : "📄 Cargar XML de la factura"}</Btn>
      <input ref={input} type="file" accept=".xml,.zip,text/xml,application/xml,application/zip" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void read(f);
        }} />
      {state ? (
        <XmlReview storeId={storeId} warehouseId={warehouseId} canCreateProducts={canCreateProducts} {...state}
          onClose={() => setState(null)} onSuppliersChanged={onSuppliersChanged}
          onApply={(d) => { setState(null); onApply(d); }} />
      ) : null}
    </>
  );
}

function XmlReview({ storeId, warehouseId, canCreateProducts, inv, match, file, xml, onClose, onApply, onSuppliersChanged }: {
  storeId: string; warehouseId: string; canCreateProducts: boolean; inv: DianInvoice; match: Match; file: File; xml: string;
  onClose: () => void; onApply: (d: XmlApply) => void; onSuppliersChanged: () => Promise<void> | void;
}) {
  const [picks, setPicks] = useState<Choice[]>(() => inv.lines.map((_, i) => {
    const m = match.lines.find((x) => x.idx === i);
    return m?.product_id ? { product_id: m.product_id, name: m.name ?? "", sku: m.sku, stock: Number(m.stock ?? 0), tax_rate: Number(m.tax_rate ?? 0), how: m.how ?? "manual" } : null;
  }));
  const [skip, setSkip] = useState<boolean[]>(() => inv.lines.map(() => false));
  const [choosing, setChoosing] = useState<number | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const missing = inv.lines.filter((_, i) => !skip[i] && !picks[i]).length;
  const setPick = (i: number, p: Choice) => setPicks((cur) => cur.map((x, j) => (j === i ? p : x)));
  const fromHit = (h: ProductHit, how: string): Choice => ({ product_id: h.id, name: h.name, sku: h.sku, stock: Number(h.stock ?? 0), tax_rate: Number(h.tax_rate ?? 0), how });

  async function apply() {
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      let supplier = match.supplier?.id ?? "";
      if (!supplier) {
        const { data, error } = await sb.rpc("erp_purchase_xml_supplier", {
          p_store: storeId, p_nit: inv.supplier.nit, p_name: inv.supplier.name, p_email: inv.supplier.email, p_phone: inv.supplier.phone, p_address: inv.supplier.address,
        });
        const r = data as { ok: boolean; id?: string; message?: string } | null;
        if (error || !r?.ok || !r.id) throw new Error(error ? errorMessage(error) : r?.message ?? "No se pudo crear el proveedor.");
        supplier = r.id;
        await onSuppliersChanged();
      }
      // Se aprende lo que se emparejó a mano o con otra pista: la próxima factura llega sola.
      const learn = inv.lines.flatMap((l, i) => {
        const p = picks[i];
        const c = code(l);
        return !skip[i] && p && c && p.how !== "learned" ? [{ code: c, product_id: p.product_id, description: l.description }] : [];
      });
      if (learn.length) await sb.rpc("erp_supplier_item_map_save", { p_store: storeId, p_supplier: supplier, p_items: learn });

      // Si el mismo producto viene en varias líneas, se suman.
      const lines: Line[] = [];
      inv.lines.forEach((l, i) => {
        const p = picks[i];
        if (skip[i] || !p) return;
        const cur = lines.find((x) => x.product_id === p.product_id);
        if (cur) {
          const qty = cur.qty + l.qty;
          cur.unit_cost = Math.round(((cur.unit_cost * cur.qty + l.unitCost * l.qty) / qty) * 100) / 100;
          cur.qty = qty;
          return;
        }
        lines.push({ product_id: p.product_id, name: p.name, sku: p.sku, current: p.stock, qty: l.qty, unit_cost: l.unitCost, tax_rate: l.taxRate, warehouse_id: warehouseId });
      });
      const blob = new Blob([xml], { type: "application/xml" });
      onApply({
        supplier,
        invoiceRef: inv.number,
        invoiceDate: inv.issueDate,
        paymentType: inv.credit ? "credit" : "cash",
        dueDate: inv.credit && inv.dueDate ? inv.dueDate : "",
        lines,
        file: { id: Math.random().toString(36).slice(2, 10), kind: "invoice", name: `${inv.number || file.name.replace(/\.[^.]+$/, "")}.xml`, blob, mime: "application/xml", preview: URL.createObjectURL(blob), original: file.size },
      });
      void toast(`Factura ${inv.number} cargada: ${lines.length} producto(s)`, "success", "Revisa cantidades, costos y bodega, y registra como siempre.");
    } catch (err) {
      void toast("No se pudo cargar la factura", "error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border" style={{ background: "var(--t-bg-base)", color: "var(--t-text)", borderColor: "var(--t-card-border)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start gap-3 border-b p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="min-w-0 flex-1">
            <b className="block text-base">📄 Factura {inv.number || "sin número"} · {inv.supplier.name}</b>
            <span className="text-xs" style={{ color: "var(--t-muted)" }}>
              NIT {inv.supplier.nit}{inv.supplier.dv ? `-${inv.supplier.dv}` : ""} · Fecha {ddmm(inv.issueDate)} · {inv.credit ? `Crédito, vence ${ddmm(inv.dueDate)}` : "Contado"} · {inv.lines.length} línea(s) · Total {money(inv.total)} (IVA {money(inv.tax)})
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="space-y-2 px-4 pt-3 text-sm">
          {match.supplier ? (
            <p>✅ Proveedor: <b>{match.supplier.name}</b>{match.supplier.active ? "" : " (inactivo)"}</p>
          ) : (
            <p className="rounded-xl border px-3 py-2" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, transparent)" }}>
              🆕 Este proveedor no está creado: al cargar se crea con el NIT, nombre, correo y teléfono del XML.
            </p>
          )}
          {match.duplicate ? (
            <p className="rounded-xl border px-3 py-2 font-semibold" style={{ borderColor: "#ef4444", color: "#ef4444" }}>
              ⚠️ Esta factura ya se ingresó (ingreso N.º {match.duplicate.number}). Si la cargas de nuevo, la mercancía se suma dos veces.
            </p>
          ) : null}
        </div>

        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
                <th className="py-1 pr-2">En la factura</th><th className="px-2 text-right">Cant.</th><th className="px-2 text-right">Costo sin IVA</th><th className="px-2 text-right">IVA</th><th className="pl-2">Producto en RemHub</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => {
                const p = picks[i];
                return (
                  <tr key={i} className="border-t align-top" style={{ borderColor: "var(--t-card-border)", opacity: skip[i] ? 0.45 : 1 }}>
                    <td className="py-2 pr-2">
                      <span className="block font-semibold">{l.description}</span>
                      <span className="text-xs" style={{ color: "var(--t-muted)" }}>{[l.sellerCode && `Cód. ${l.sellerCode}`, l.standardCode && l.standardCode !== l.sellerCode && `EAN ${l.standardCode}`].filter(Boolean).join(" · ") || "Sin código"}</span>
                    </td>
                    <td className="px-2 py-2 text-right">{l.qty}</td>
                    <td className="px-2 py-2 text-right">{money(l.unitCost)}</td>
                    <td className="px-2 py-2 text-right">{l.taxRate}%</td>
                    <td className="py-2 pl-2">
                      {skip[i] ? (
                        <button type="button" className="text-xs underline" onClick={() => setSkip((s) => s.map((x, j) => (j === i ? false : x)))}>No se ingresa · deshacer</button>
                      ) : choosing === i ? (
                        <ProductChooser storeId={storeId} initial={l.description} onPick={(h) => { setPick(i, fromHit(h, "manual")); setChoosing(null); }} onCancel={() => setChoosing(null)} />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {p ? (
                            <span className="min-w-0">
                              <b className="block">{p.name}</b>
                              <span className="text-xs" style={{ color: p.how === "name" ? "#f59e0b" : "#22c55e" }}>{HOW[p.how] ?? p.how}{p.how === "name" ? " · revisa que sea el mismo" : ""}{p.tax_rate !== l.taxRate ? ` · en RemHub tiene IVA ${p.tax_rate}%` : ""}</span>
                            </span>
                          ) : <span className="text-xs font-bold" style={{ color: "#f59e0b" }}>Sin emparejar</span>}
                          <button type="button" className="text-xs font-bold underline" onClick={() => setChoosing(i)}>{p ? "Cambiar" : "Elegir"}</button>
                          {!p && canCreateProducts ? <button type="button" className="text-xs font-bold underline" onClick={() => setCreating(i)}>Crear</button> : null}
                          <button type="button" className="text-xs underline" style={{ color: "var(--t-muted)" }} onClick={() => setSkip((s) => s.map((x, j) => (j === i ? true : x)))}>No ingresar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="text-xs" style={{ color: missing ? "#f59e0b" : "var(--t-muted)" }}>
            {missing ? `Faltan ${missing} producto(s) por emparejar (o márcalos «No ingresar»).` : "Lo que emparejes queda aprendido para la próxima factura de este proveedor."}
          </span>
          <span className="flex gap-2">
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn disabled={busy || missing > 0 || skip.every(Boolean)} onClick={() => void apply()}>{busy ? "Cargando…" : "Cargar al ingreso"}</Btn>
          </span>
        </div>
      </div>
      {creating !== null ? (
        <div onClick={(e) => e.stopPropagation()}>
          <QuickProductModal storeId={storeId} initialName={inv.lines[creating].description} withMarkup={false}
            onClose={() => setCreating(null)}
            onCreated={(hit) => { setPick(creating, fromHit(hit, "created")); setCreating(null); }} />
        </div>
      ) : null}
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function ProductChooser({ storeId, initial, onPick, onCancel }: { storeId: string; initial: string; onPick: (h: ProductHit) => void; onCancel: () => void }) {
  // Se empieza buscando con la primera palabra de la descripción (lo demás suele ser presentación).
  const [q, setQ] = useState(initial.split(" ")[0] ?? "");
  const { hits, loading } = useProductSearch({ storeId, query: q, enabled: true, limit: 8 });
  return (
    <div className="w-full min-w-[220px] space-y-1">
      <div className="flex gap-1">
        <input autoFocus className={inputClass} style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, SKU o código"
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && hits[0]) onPick(hits[0]); }} />
        <button type="button" className="px-2 text-xs" onClick={onCancel}>✕</button>
      </div>
      {loading ? <p className="text-xs">Buscando…</p> : null}
      <ul className="max-h-48 overflow-auto rounded-xl border" style={{ borderColor: "var(--t-card-border)" }}>
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" className="block w-full px-2 py-1.5 text-left text-xs hover:opacity-80" onClick={() => onPick(h)}>
              <b>{h.name}</b> <span style={{ color: "var(--t-muted)" }}>{[h.sku, h.barcode].filter(Boolean).join(" · ")} · Stock {h.stock}</span>
            </button>
          </li>
        ))}
        {!loading && !hits.length ? <li className="px-2 py-1.5 text-xs" style={{ color: "var(--t-muted)" }}>Sin resultados</li> : null}
      </ul>
    </div>
  );
}
