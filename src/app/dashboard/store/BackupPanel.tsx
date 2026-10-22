"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Copia de seguridad descargable: un solo archivo de Excel con una hoja por tema
 * (productos, existencias por punto, clientes, proveedores, ventas y su detalle de los últimos 12 meses).
 * Se arma en el navegador con lo que el dueño puede ver; nunca incluye costos si la base no los entrega.
 */

type Cell = string | number | boolean | null | undefined;
type Sheet = { name: string; head: string[]; rows: Cell[][] };

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Excel abre este formato (XML 2003) con varias hojas, sin librerías extra. */
function workbook(sheets: Sheet[]) {
  const cell = (v: Cell) => (typeof v === "number" && Number.isFinite(v)
    ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
    : `<Cell><Data ss:Type="String">${esc(v === null || v === undefined ? "" : String(v))}</Data></Cell>`);
  const body = sheets.map((s) => `<Worksheet ss:Name="${esc(s.name.slice(0, 31))}"><Table>`
    + `<Row>${s.head.map((h) => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>`
    + s.rows.map((r) => `<Row>${r.map(cell).join("")}</Row>`).join("")
    + `</Table></Worksheet>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>`
    + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
    + `<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>${body}</Workbook>`;
}

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error || !Array.isArray(data)) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export function BackupPanel({ storeId, storeSlug }: { storeId: string; storeSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  async function run() {
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      setStep("Productos…");
      const [cats, wh] = await Promise.all([
        sb.from("product_categories").select("id,name").eq("store_id", storeId),
        sb.from("erp_warehouses").select("id,name").eq("store_id", storeId),
      ]);
      const catName = new Map(((cats.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
      const whName = new Map(((wh.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
      const products = await all<Record<string, Cell>>((a, b) => sb.from("products")
        .select("id,name,sku,barcode,category_id,description,price_1,price_2,price_3,price_4,price_5,stock,active,image_url,created_at")
        .eq("store_id", storeId).order("name").range(a, b));
      const pName = new Map(products.map((p) => [String(p.id), String(p.name)]));
      setStep("Existencias…");
      const levels = await all<Record<string, Cell>>((a, b) => sb.from("erp_stock_levels").select("warehouse_id,product_id,qty").eq("store_id", storeId).order("product_id").range(a, b));
      setStep("Clientes y proveedores…");
      const clients = await all<Record<string, Cell>>((a, b) => sb.from("billing_customers").select("name,document_type,document_number,email,mobile,address,city,created_at").eq("store_id", storeId).order("name").range(a, b));
      const suppliers = await all<Record<string, Cell>>((a, b) => sb.from("erp_suppliers").select("name,nit,contact_name,phone,email,payment_days").eq("store_id", storeId).order("name").range(a, b));
      setStep("Ventas de los últimos 12 meses…");
      const since = new Date(Date.now() - 365 * 86400000).toISOString();
      const orders = await all<Record<string, Cell>>((a, b) => sb.from("orders").select("id,created_at,confirmed_at,status,customer_name,customer_whatsapp,total,token").eq("store_id", storeId).gte("created_at", since).order("created_at").range(a, b));
      const metas = await all<Record<string, Cell>>((a, b) => sb.from("erp_order_meta").select("order_id,doc_number,doc_kind,point_id,seller_name").eq("store_id", storeId).gte("created_at", since).order("order_id").range(a, b));
      const meta = new Map(metas.map((m) => [String(m.order_id), m]));
      const items: Record<string, Cell>[] = [];
      const ids = orders.map((o) => String(o.id));
      for (let i = 0; i < ids.length; i += 200) {
        setStep(`Detalle de ventas ${Math.min(i + 200, ids.length)} de ${ids.length}…`);
        const { data } = await sb.from("order_items").select("order_id,product_id,quantity,price").in("order_id", ids.slice(i, i + 200));
        items.push(...((data ?? []) as Record<string, Cell>[]));
      }
      const orderDoc = new Map(orders.map((o) => [String(o.id), meta.get(String(o.id))?.doc_number ?? String(o.token ?? "").slice(0, 8)]));
      const date = (v: Cell) => (v ? new Date(String(v)).toLocaleString("es-CO") : "");

      const sheets: Sheet[] = [
        { name: "Productos", head: ["Nombre", "Referencia", "Código de barras", "Categoría", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5", "Unidades", "Activo", "Descripción", "Foto", "Creado"],
          rows: products.map((p) => [p.name, p.sku, p.barcode, catName.get(String(p.category_id)) ?? "", Number(p.price_1 ?? 0), Number(p.price_2 ?? 0), Number(p.price_3 ?? 0), Number(p.price_4 ?? 0), Number(p.price_5 ?? 0), Number(p.stock ?? 0), p.active === false ? "No" : "Sí", p.description, p.image_url, date(p.created_at)]) },
        { name: "Existencias por punto", head: ["Punto / bodega", "Producto", "Unidades"],
          rows: levels.map((l) => [whName.get(String(l.warehouse_id)) ?? "", pName.get(String(l.product_id)) ?? String(l.product_id), Number(l.qty ?? 0)]) },
        { name: "Clientes", head: ["Nombre", "Tipo doc.", "Documento", "Correo", "Celular", "Dirección", "Ciudad", "Creado"],
          rows: clients.map((c) => [c.name, c.document_type, c.document_number, c.email, c.mobile, c.address, c.city, date(c.created_at)]) },
        { name: "Proveedores", head: ["Nombre", "NIT", "Contacto", "Teléfono", "Correo", "Días de crédito"],
          rows: suppliers.map((s) => [s.name, s.nit, s.contact_name, s.phone, s.email, Number(s.payment_days ?? 0)]) },
        { name: "Ventas", head: ["Fecha", "Documento", "Tipo", "Punto", "Vendedor", "Cliente", "Celular", "Estado", "Total"],
          rows: orders.map((o) => { const m = meta.get(String(o.id)); return [date(o.confirmed_at ?? o.created_at), m?.doc_number ?? "", m?.doc_kind ?? "catálogo", whName.get(String(m?.point_id)) ?? "", m?.seller_name ?? "", o.customer_name, o.customer_whatsapp, o.status, Number(o.total ?? 0)]; }) },
        { name: "Detalle de ventas", head: ["Documento", "Producto", "Cantidad", "Precio", "Subtotal"],
          rows: items.map((i) => [orderDoc.get(String(i.order_id)) ?? "", pName.get(String(i.product_id)) ?? String(i.product_id), Number(i.quantity ?? 0), Number(i.price ?? 0), Number(i.quantity ?? 0) * Number(i.price ?? 0)]) },
      ];
      const blob = new Blob([workbook(sheets)], { type: "application/vnd.ms-excel" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `copia-${storeSlug}-${new Date().toISOString().slice(0, 10)}.xls`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStep(`✅ Listo: ${products.length} productos, ${clients.length} clientes y ${orders.length} ventas.`);
    } catch (e) {
      setStep(`⚠️ No se pudo terminar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black">💾 Copia de seguridad</h3>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Descarga un Excel con tus productos, existencias por punto, clientes, proveedores y las ventas de los últimos 12 meses. Tus datos siempre son tuyos.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void run()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: "var(--t-cta)" }}>
          {busy ? "Preparando…" : "⬇️ Descargar copia"}
        </button>
      </div>
      {step ? <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>{step}</p> : null}
    </section>
  );
}
