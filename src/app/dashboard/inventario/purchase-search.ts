"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Buscador del historial de ingresos de factura.
 * Una sola caja busca por: número (#12), n.º de factura del proveedor, proveedor (nombre o NIT),
 * quién revisó o recibió, notas, y productos (nombre, código o código de barras).
 * Filtros: proveedor, estado, pago y rango de fechas. Todo se filtra en la base (no solo los 50 de la pantalla).
 */

export type PurchaseRow = {
  id: string; number: number; status: string; invoice_ref: string | null; payment_type: string; due_date: string | null;
  total: number; created_at: string; supplier_id: string; invoice_date: string | null;
  created_by_name: string | null; checked_by_name: string | null; received_by_name: string | null;
};

export type PurchaseFilters = {
  q: string;
  supplier: string;
  status: "all" | "received" | "cancelled";
  pay: "all" | "cash" | "credit" | "overdue";
  from: string;
  to: string;
};

/** Línea de un ingreso que coincide con el producto buscado. */
export type MatchLine = { product_id: string; name: string; sku: string | null; qty: number; unit_cost: number };

export const emptyFilters = (): PurchaseFilters => ({ q: "", supplier: "", status: "all", pay: "all", from: "", to: "" });
export const filtersActive = (f: PurchaseFilters) =>
  Boolean(f.q.trim() || f.supplier || f.status !== "all" || f.pay !== "all" || f.from || f.to);

const PAGE = 50;
const COLUMNS = "id,number,status,invoice_ref,payment_type,due_date,total,created_at,supplier_id,invoice_date,created_by_name,checked_by_name,received_by_name";
const isoToday = () => new Date().toISOString().slice(0, 10);
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
// Caracteres que rompen el filtro de la base (comas, paréntesis, comodines).
const clean = (s: string) => s.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Supplier = { id: string; name: string; nit: string | null };

export function usePurchaseSearch(storeId: string, suppliers: Supplier[]) {
  const [filters, setFilters] = useState<PurchaseFilters>(emptyFilters);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [sum, setSum] = useState<number | null>(null);
  const [matches, setMatches] = useState<Record<string, MatchLine[]>>({});
  const [edited, setEdited] = useState<Record<string, { at: string; count: number }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);
  // Proveedores en una referencia: cuando terminan de cargar no se repite la búsqueda.
  const suppliersRef = useRef(suppliers);
  suppliersRef.current = suppliers;
  // Lo que ya se calculó para la búsqueda actual (para «Cargar más» sin repetir).
  const plan = useRef<string | null>(null);

  const setFilter = useCallback(<K extends keyof PurchaseFilters>(key: K, value: PurchaseFilters[K]) => {
    setFilters((cur) => ({ ...cur, [key]: value }));
  }, []);

  /** Consulta con los filtros (menos el texto). */
  const applyBase = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (query: any, f: PurchaseFilters): any => {
      let out = query.eq("store_id", storeId);
      if (f.supplier) out = out.eq("supplier_id", f.supplier);
      if (f.status !== "all") out = out.eq("status", f.status);
      if (f.pay === "cash") out = out.eq("payment_type", "cash");
      if (f.pay === "credit") out = out.eq("payment_type", "credit");
      if (f.pay === "overdue") out = out.eq("payment_type", "credit").eq("status", "received").lt("due_date", isoToday());
      // La fecha de la factura; si no la tiene, la de registro.
      if (f.from) out = out.or(`invoice_date.gte.${f.from},and(invoice_date.is.null,created_at.gte.${f.from})`);
      if (f.to) out = out.or(`invoice_date.lte.${f.to},and(invoice_date.is.null,created_at.lt.${nextDay(f.to)})`);
      return out;
    },
    [storeId],
  );

  const run = useCallback(async (f: PurchaseFilters, offset: number) => {
    const my = offset === 0 ? ++req.current : req.current;
    const stale = () => my !== req.current;
    const sb = supabaseBrowser();
    setLoading(true);
    setError(null);
    try {
      if (offset === 0) {
        const term = clean(f.q);
        let or: string | null = null;
        let found: Record<string, MatchLine[]> = {};
        if (term) {
          const parts = [
            `invoice_ref.ilike.*${term}*`, `checked_by_name.ilike.*${term}*`, `received_by_name.ilike.*${term}*`,
            `created_by_name.ilike.*${term}*`, `notes.ilike.*${term}*`,
          ];
          const num = term.replace(/^#/, "");
          if (/^\d{1,9}$/.test(num)) parts.push(`number.eq.${num}`);
          // Proveedores por nombre o NIT (ya están cargados).
          const ft = fold(term);
          const sups = suppliersRef.current.filter((s) => fold(s.name).includes(ft) || (s.nit ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, "") || "\u0000"));
          if (sups.length) parts.push(`supplier_id.in.(${sups.slice(0, 100).map((s) => s.id).join(",")})`);
          // Productos: ingresos que los traen.
          if (term.length >= 2) {
            const { data: prods } = await sb.from("products").select("id,name,sku")
              .eq("store_id", storeId)
              .or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`)
              .limit(200);
            const list = (prods ?? []) as Array<{ id: string; name: string; sku: string | null }>;
            if (list.length) {
              const byId = new Map(list.map((p) => [p.id, p]));
              const { data: items } = await sb.from("erp_purchase_items").select("purchase_id,product_id,qty,unit_cost")
                .in("product_id", list.map((p) => p.id))
                .limit(2000);
              ((items ?? []) as Array<{ purchase_id: string; product_id: string; qty: number; unit_cost: number }>).forEach((it) => {
                const p = byId.get(it.product_id);
                if (!p) return;
                (found[it.purchase_id] ||= []).push({ product_id: it.product_id, name: p.name, sku: p.sku, qty: Number(it.qty), unit_cost: Number(it.unit_cost) });
              });
              const ids = Object.keys(found).slice(0, 300);
              if (ids.length) parts.push(`id.in.(${ids.join(",")})`);
            }
          }
          or = parts.join(",");
        } else found = {};
        if (stale()) return;
        plan.current = or;
        setMatches(found);
      }
      const or = plan.current;
      let list = applyBase(sb.from("erp_purchases").select(COLUMNS, offset === 0 ? { count: "exact" } : undefined), f);
      if (or) list = list.or(or);
      const listRes = await list.order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
      if (stale()) return;
      if (listRes.error) throw listRes.error;
      const page = (listRes.data ?? []) as PurchaseRow[];
      setRows((cur) => (offset === 0 ? page : [...cur, ...page]));
      if (offset === 0) {
        setCount(listRes.count ?? page.length);
        // Suma de lo encontrado (sin las anuladas), solo cuando hay filtros.
        if (filtersActive(f)) {
          // Por tandas de 1.000 (lo máximo que entrega Supabase por consulta).
          let acc = 0;
          for (let at = 0; at < 50_000; at += 1000) {
            let totals = applyBase(sb.from("erp_purchases").select("id,total,status"), f);
            if (or) totals = totals.or(or);
            const { data: tot } = await totals.order("id").range(at, at + 999);
            if (stale()) return;
            const chunk = (tot ?? []) as Array<{ total: number; status: string }>;
            acc += chunk.filter((t) => t.status !== "cancelled").reduce((a, t) => a + Number(t.total || 0), 0);
            if (chunk.length < 1000) break;
          }
          setSum(acc);
        } else setSum(null);
      }
      // Marca de «editado» (columna nueva; si aún no existe simplemente no se muestra).
      if (page.length) {
        const { data: marks } = await sb.from("erp_purchases").select("id,edited_at,edit_count").in("id", page.map((r) => r.id));
        if (stale()) return;
        const next: Record<string, { at: string; count: number }> = {};
        ((marks ?? []) as Array<{ id: string; edited_at: string | null; edit_count: number | null }>).forEach((m) => {
          if (m.edited_at) next[m.id] = { at: m.edited_at, count: Number(m.edit_count ?? 1) };
        });
        setEdited((cur) => (offset === 0 ? next : { ...cur, ...next }));
      } else if (offset === 0) setEdited({});
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [applyBase, storeId]);

  // Al escribir se espera un momento; los demás filtros buscan de una vez.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  useEffect(() => {
    const t = window.setTimeout(() => void run(filters, 0), filters.q.trim() ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [filters, run]);

  const reload = useCallback(() => run(filtersRef.current, 0), [run]);
  const loadMore = useCallback(() => run(filtersRef.current, rows.length), [run, rows.length]);
  const hasMore = count != null && rows.length < count;

  return { filters, setFilter, setFilters, rows, count, sum, matches, edited, loading, error, reload, loadMore, hasMore };
}

/** Rangos rápidos (fechas ISO). */
export function quickRange(kind: "month" | "last_month" | "30d" | "year"): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (kind === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (kind === "last_month") return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (kind === "year") return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  const d = new Date(now);
  d.setDate(d.getDate() - 30);
  return { from: iso(d), to: iso(now) };
}
