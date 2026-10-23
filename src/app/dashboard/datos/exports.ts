import { supabaseBrowser } from "@/lib/supabase/client";
import { xDate, type XCell, type XSheet } from "@/lib/data/xlsx";

/**
 * Lo que se puede exportar desde «Importar y exportar». Cada tema arma una o varias hojas de Excel con lo que
 * el usuario puede ver (la base aplica sus permisos). Los encabezados de terceros, proveedores, categorías y
 * productos son los mismos que reconoce la importación: se puede exportar, editar y volver a subir.
 * Las columnas «(solo lectura)» se ignoran al importar (unidades y costo solo cambian por ingreso o ajuste).
 */

export type Range = { from: string; to: string };
export type Ctx = { storeId: string; can: (p: string) => boolean; range: Range; step: (t: string) => void };
export type ExportDef = {
  key: string; icon: string; title: string; detail: string; perms: string[]; usesRange?: boolean;
  build: (ctx: Ctx) => Promise<XSheet[]>;
};

type Row = Record<string, unknown>;
const sb = () => supabaseBrowser();
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const s = (v: unknown): XCell => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));
const yes = (v: unknown) => (v === false ? "No" : "Sí");
/** Fin del día «hasta» (incluido), en hora de Colombia. */
const endOf = (d: string) => `${d}T23:59:59-05:00`;
const startOf = (d: string) => `${d}T00:00:00-05:00`;

/** Todas las filas (la base entrega máximo 1.000 por consulta). */
async function all(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max = 100000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Trae filas por lotes de ids (para detalles: líneas de venta, de compra…). */
async function byIds(table: string, cols: string, col: string, ids: string[], step?: (t: string) => void, label = "") {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    step?.(`${label} ${Math.min(i + 150, ids.length)} de ${ids.length}…`);
    const part = ids.slice(i, i + 150);
    out.push(...(await all((a, b) => sb().from(table).select(cols).in(col, part).range(a, b))));
  }
  return out;
}

async function lookups(storeId: string) {
  const [wh, cats] = await Promise.all([
    sb().from("erp_warehouses").select("id,name").eq("store_id", storeId),
    sb().from("product_categories").select("id,name").eq("store_id", storeId),
  ]);
  return {
    point: new Map(((wh.data ?? []) as Row[]).map((w) => [String(w.id), String(w.name)])),
    cat: new Map(((cats.data ?? []) as Row[]).map((c) => [String(c.id), String(c.name)])),
  };
}

async function productNames(storeId: string) {
  const rows = await all((a, b) => sb().from("products").select("id,name,sku").eq("store_id", storeId).order("id").range(a, b));
  return new Map(rows.map((p) => [String(p.id), { name: String(p.name ?? ""), sku: s(p.sku) }]));
}

async function partyNames(storeId: string) {
  const rows = await all((a, b) => sb().from("billing_customers").select("id,name,document_number").eq("store_id", storeId).order("id").range(a, b));
  return new Map(rows.map((c) => [String(c.id), { name: String(c.name ?? ""), doc: s(c.document_number) }]));
}

async function supplierNames(storeId: string) {
  const rows = await all((a, b) => sb().from("erp_suppliers").select("id,name,nit").eq("store_id", storeId).order("id").range(a, b));
  return new Map(rows.map((x) => [String(x.id), { name: String(x.name ?? ""), nit: s(x.nit) }]));
}

export const EXPORTS: ExportDef[] = [
  {
    key: "productos", icon: "📦", title: "Productos", detail: "Código, nombre, categoría, los 5 precios, unidades, foto y descripción.",
    perms: ["products", "products_view"],
    async build({ storeId, can, step }) {
      step("Productos…");
      const { cat } = await lookups(storeId);
      const base = "id,name,sku,barcode,category_id,description,price_1,price_2,price_3,price_4,price_5,stock,active,image_url,created_at";
      let rows: Row[];
      let withCost = can("costs_view");
      try {
        rows = await all((a, b) => sb().from("products").select(withCost ? `${base},cost_price` : base).eq("store_id", storeId).order("name").range(a, b));
      } catch {
        withCost = false;
        rows = await all((a, b) => sb().from("products").select(base).eq("store_id", storeId).order("name").range(a, b));
      }
      return [{
        name: "Productos",
        head: ["Referencia", "Código de barras", "Nombre", "Categoría", "Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5",
          "Unidades (solo lectura)", ...(withCost ? ["Costo (solo lectura)"] : []), "Activo", "Descripción", "Foto", "Creado"],
        rows: rows.map((p) => [s(p.sku), s(p.barcode), s(p.name), cat.get(String(p.category_id)) ?? "", n(p.price_1), n(p.price_2), n(p.price_3), n(p.price_4), n(p.price_5),
          n(p.stock), ...(withCost ? [n(p.cost_price)] : []), yes(p.active), s(p.description), s(p.image_url), xDate(p.created_at)]),
      }];
    },
  },
  {
    key: "existencias", icon: "🏭", title: "Existencias por punto", detail: "Cuántas unidades hay de cada producto en cada punto y bodega.",
    perms: ["inventory", "products_view", "transfers"],
    async build({ storeId, step }) {
      step("Existencias…");
      const [{ point }, prods] = await Promise.all([lookups(storeId), productNames(storeId)]);
      const rows = await all((a, b) => sb().from("erp_stock_levels").select("warehouse_id,product_id,qty").eq("store_id", storeId).order("product_id").range(a, b));
      return [{
        name: "Existencias por punto", head: ["Punto / bodega", "Referencia", "Producto", "Unidades"],
        rows: rows.map((l) => [point.get(String(l.warehouse_id)) ?? "", prods.get(String(l.product_id))?.sku ?? "", prods.get(String(l.product_id))?.name ?? String(l.product_id), n(l.qty)])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[2]).localeCompare(String(y[2]))),
      }];
    },
  },
  {
    key: "categorias", icon: "🗂️", title: "Categorías", detail: "Las categorías de productos con su orden.",
    perms: ["categories", "products"],
    async build({ storeId }) {
      const rows = await all((a, b) => sb().from("product_categories").select("name,sort_order,active,image_url").eq("store_id", storeId).order("sort_order").range(a, b));
      return [{ name: "Categorías", head: ["Nombre", "Orden", "Activa", "Foto"], rows: rows.map((c) => [s(c.name), n(c.sort_order), yes(c.active), s(c.image_url)]) }];
    },
  },
  {
    key: "terceros", icon: "👥", title: "Terceros", detail: "Clientes, proveedores, trabajadores y demás, con documento, contacto, lista de precios y crédito.",
    perms: ["clients", "receivables", "credit"],
    async build({ storeId, step }) {
      step("Terceros…");
      const cols = "name,trade_name,kinds,person_type,document_type,document_number,email,mobile,phone,contact_name,address,city,department,country,birthday,tax_regime,price_list,supplier_payment_days,tags,notes,active,credit_enabled,credit_limit,credit_days,credit_blocked,created_at";
      const rows = await all((a, b) => sb().from("billing_customers").select(cols).eq("store_id", storeId).order("name").range(a, b));
      const KIND: Record<string, string> = { customer: "cliente", supplier: "proveedor", employee: "trabajador", seller: "vendedor", partner: "asociado", carrier: "transportador", other: "otro" };
      return [{
        name: "Terceros",
        head: ["Tipo", "Nombre", "Nombre comercial", "Persona", "Tipo de documento", "Documento", "Correo", "Celular", "Teléfono", "Contacto", "Dirección", "Ciudad",
          "Departamento", "País", "Cumpleaños", "Régimen", "Lista de precios", "Días de pago a proveedor", "Etiquetas", "Notas", "Activo", "Crédito", "Cupo", "Días de crédito", "Crédito bloqueado", "Creado"],
        rows: rows.map((c) => [((c.kinds as string[] | null) ?? ["customer"]).map((k) => KIND[k] ?? k).join(", "), s(c.name), s(c.trade_name), c.person_type === "juridica" ? "jurídica" : "natural",
          s(c.document_type), s(c.document_number), s(c.email), s(c.mobile), s(c.phone), s(c.contact_name), s(c.address), s(c.city), s(c.department), s(c.country), xDate(c.birthday),
          s(c.tax_regime), n(c.price_list), n(c.supplier_payment_days), s(c.tags), s(c.notes), yes(c.active), c.credit_enabled ? "Sí" : "No", n(c.credit_limit), n(c.credit_days),
          c.credit_blocked ? "Sí" : "No", xDate(c.created_at)]),
      }];
    },
  },
  {
    key: "proveedores", icon: "🚚", title: "Proveedores de compras", detail: "Los proveedores que usas en los ingresos de factura.",
    perms: ["suppliers", "purchases"],
    async build({ storeId }) {
      const rows = await all((a, b) => sb().from("erp_suppliers").select("name,nit,contact_name,phone,email,address,payment_days,notes,active").eq("store_id", storeId).order("name").range(a, b));
      return [{ name: "Proveedores", head: ["Nombre", "NIT", "Contacto", "Teléfono", "Correo", "Dirección", "Días de pago", "Notas", "Activo"],
        rows: rows.map((x) => [s(x.name), s(x.nit), s(x.contact_name), s(x.phone), s(x.email), s(x.address), n(x.payment_days), s(x.notes), yes(x.active)]) }];
    },
  },
  {
    key: "cartera", icon: "📒", title: "Cartera (cuentas por cobrar)", detail: "Lo que te deben: cada documento con su saldo y vencimiento, los abonos y un resumen por cliente.",
    perms: ["receivables", "credit"],
    async build({ storeId, step }) {
      step("Cartera…");
      const [{ point }, parties] = await Promise.all([lookups(storeId), partyNames(storeId)]);
      const recs = await all((a, b) => sb().from("erp_receivables").select("id,customer_id,point_id,kind,doc_number,description,total,balance,issue_date,due_date,status,created_by_name,created_at")
        .eq("store_id", storeId).order("issue_date").range(a, b));
      step("Abonos…");
      const pays = await all((a, b) => sb().from("erp_receivable_payments").select("receivable_id,customer_id,amount,method,reference,notes,paid_at,created_by_name,voided")
        .eq("store_id", storeId).order("paid_at").range(a, b));
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      const late = (due: unknown, st: unknown) => (st === "open" && due && String(due) < today ? Math.round((Date.parse(today) - Date.parse(String(due))) / 86400000) : 0);
      const doc = new Map(recs.map((r) => [String(r.id), s(r.doc_number)]));
      const summary = new Map<string, { name: string; doc: XCell; open: number; overdue: number; docs: number }>();
      for (const r of recs) {
        if (r.status !== "open") continue;
        const p = parties.get(String(r.customer_id));
        const k = String(r.customer_id);
        const cur = summary.get(k) ?? { name: p?.name ?? "", doc: p?.doc ?? "", open: 0, overdue: 0, docs: 0 };
        cur.open += Number(r.balance ?? 0); cur.docs += 1;
        if (late(r.due_date, r.status) > 0) cur.overdue += Number(r.balance ?? 0);
        summary.set(k, cur);
      }
      const KIND: Record<string, string> = { sale: "venta", manual: "manual", opening: "saldo inicial" };
      return [
        { name: "Cartera por documento", head: ["Cliente", "Documento del cliente", "Tipo", "Número", "Descripción", "Punto", "Fecha", "Vence", "Total", "Saldo", "Estado", "Días vencido", "Creado por"],
          rows: recs.map((r) => { const p = parties.get(String(r.customer_id)); return [p?.name ?? "", p?.doc ?? "", KIND[String(r.kind)] ?? s(r.kind), s(r.doc_number), s(r.description),
            point.get(String(r.point_id)) ?? "", xDate(r.issue_date), xDate(r.due_date), n(r.total), n(r.balance), r.status === "open" ? "abierta" : r.status === "paid" ? "pagada" : "anulada",
            late(r.due_date, r.status) || null, s(r.created_by_name)]; }) },
        { name: "Abonos", head: ["Fecha", "Cliente", "Documento del cliente", "Número abonado", "Valor", "Medio", "Referencia", "Notas", "Recibió", "Anulado"],
          rows: pays.map((p) => { const c = parties.get(String(p.customer_id)); return [xDate(p.paid_at, true), c?.name ?? "", c?.doc ?? "", doc.get(String(p.receivable_id)) ?? "", n(p.amount),
            s(p.method), s(p.reference), s(p.notes), s(p.created_by_name), p.voided ? "Sí" : "No"]; }) },
        { name: "Resumen por cliente", head: ["Cliente", "Documento", "Documentos abiertos", "Saldo", "Vencido"],
          rows: [...summary.values()].sort((a, b) => b.open - a.open).map((x) => [x.name, x.doc, x.docs, x.open, x.overdue]) },
      ];
    },
  },
  {
    key: "pagar", icon: "🧾", title: "Cuentas por pagar", detail: "Lo que les debes a los proveedores, con vencimientos y pagos.",
    perms: ["payables", "purchases"],
    async build({ storeId, step }) {
      step("Cuentas por pagar…");
      const sups = await supplierNames(storeId);
      const pays = await all((a, b) => sb().from("erp_payables").select("id,supplier_id,purchase_id,total,balance,due_date,status,created_at").eq("store_id", storeId).order("created_at").range(a, b));
      const purchaseIds = [...new Set(pays.map((p) => p.purchase_id).filter(Boolean).map(String))];
      const purchases = purchaseIds.length ? await byIds("erp_purchases", "id,number,invoice_ref", "id", purchaseIds) : [];
      const pur = new Map(purchases.map((p) => [String(p.id), p]));
      const payments = await all((a, b) => sb().from("erp_payable_payments").select("payable_id,amount,method,reference,created_at").eq("store_id", storeId).order("created_at").range(a, b));
      const pRef = new Map(pays.map((p) => [String(p.id), p]));
      return [
        { name: "Cuentas por pagar", head: ["Proveedor", "NIT", "Compra", "Factura del proveedor", "Total", "Saldo", "Vence", "Estado", "Creada"],
          rows: pays.map((p) => { const x = sups.get(String(p.supplier_id)); const c = pur.get(String(p.purchase_id)); return [x?.name ?? "", x?.nit ?? "", c ? `#${s(c.number)}` : "saldo inicial",
            s(c?.invoice_ref), n(p.total), n(p.balance), xDate(p.due_date), p.status === "open" ? "abierta" : p.status === "paid" ? "pagada" : s(p.status), xDate(p.created_at)]; }) },
        { name: "Pagos a proveedores", head: ["Fecha", "Proveedor", "Valor", "Medio", "Referencia"],
          rows: payments.map((p) => [xDate(p.created_at, true), sups.get(String(pRef.get(String(p.payable_id))?.supplier_id))?.name ?? "", n(p.amount), s(p.method), s(p.reference)]) },
      ];
    },
  },
  {
    key: "ventas", icon: "💳", title: "Ventas", detail: "Cada venta con documento, punto, vendedor y cliente, y el detalle producto por producto.",
    perms: ["reports", "orders", "pos"], usesRange: true,
    async build({ storeId, range, step }) {
      step("Ventas…");
      const [{ point }, prods] = await Promise.all([lookups(storeId), productNames(storeId)]);
      const orders = await all((a, b) => sb().from("orders").select("id,created_at,confirmed_at,status,customer_name,customer_whatsapp,total,token")
        .eq("store_id", storeId).gte("created_at", startOf(range.from)).lte("created_at", endOf(range.to)).order("created_at").range(a, b));
      const ids = orders.map((o) => String(o.id));
      const metas = await byIds("erp_order_meta", "order_id,doc_number,doc_kind,point_id,seller_name,customer_doc,payment", "order_id", ids, step, "Documentos");
      const meta = new Map(metas.map((m) => [String(m.order_id), m]));
      const items = await byIds("order_items", "order_id,product_id,quantity,price", "order_id", ids, step, "Detalle de ventas");
      const docOf = (id: string) => s(meta.get(id)?.doc_number) || String(orders.find((o) => String(o.id) === id)?.token ?? "").slice(0, 8);
      const STATUS: Record<string, string> = { confirmed: "confirmada", completed: "entregada", pending: "pendiente", cancelled: "anulada", draft: "borrador" };
      return [
        { name: "Ventas", head: ["Fecha", "Documento", "Tipo", "Punto", "Vendedor", "Cliente", "Documento del cliente", "Celular", "Pago", "Estado", "Total"],
          rows: orders.map((o) => { const m = meta.get(String(o.id)); return [xDate(o.confirmed_at ?? o.created_at, true), s(m?.doc_number), s(m?.doc_kind) || "catálogo",
            point.get(String(m?.point_id)) ?? "", s(m?.seller_name), s(o.customer_name), s(m?.customer_doc), s(o.customer_whatsapp), s(m?.payment), STATUS[String(o.status)] ?? s(o.status), n(o.total)]; }) },
        { name: "Detalle de ventas", head: ["Documento", "Referencia", "Producto", "Cantidad", "Precio", "Subtotal"],
          rows: items.map((i) => { const p = prods.get(String(i.product_id)); return [docOf(String(i.order_id)), p?.sku ?? "", p?.name ?? String(i.product_id), n(i.quantity), n(i.price),
            Number(i.quantity ?? 0) * Number(i.price ?? 0)]; }) },
      ];
    },
  },
  {
    key: "compras", icon: "📥", title: "Compras (ingresos de factura)", detail: "Cada ingreso con proveedor, factura y bodega, y sus productos con costo.",
    perms: ["purchases"], usesRange: true,
    async build({ storeId, range, step }) {
      step("Compras…");
      const [{ point }, prods, sups] = await Promise.all([lookups(storeId), productNames(storeId), supplierNames(storeId)]);
      const rows = await all((a, b) => sb().from("erp_purchases").select("id,number,supplier_id,warehouse_id,status,invoice_ref,invoice_date,payment_type,due_date,subtotal,tax,total,notes,created_by_name,created_at,cancelled_at")
        .eq("store_id", storeId).gte("created_at", startOf(range.from)).lte("created_at", endOf(range.to)).order("created_at").range(a, b));
      const items = await byIds("erp_purchase_items", "purchase_id,product_id,qty,unit_cost,tax_rate,line_total,note", "purchase_id", rows.map((r) => String(r.id)), step, "Detalle de compras");
      const num = new Map(rows.map((r) => [String(r.id), r.number]));
      return [
        { name: "Compras", head: ["Fecha", "Número", "Proveedor", "NIT", "Factura", "Fecha factura", "Bodega", "Pago", "Vence", "Subtotal", "IVA", "Total", "Estado", "Notas", "Registró"],
          rows: rows.map((r) => { const x = sups.get(String(r.supplier_id)); return [xDate(r.created_at, true), n(r.number), x?.name ?? "", x?.nit ?? "", s(r.invoice_ref), xDate(r.invoice_date),
            point.get(String(r.warehouse_id)) ?? "", r.payment_type === "credit" ? "crédito" : "contado", xDate(r.due_date), n(r.subtotal), n(r.tax), n(r.total),
            r.cancelled_at ? "anulada" : s(r.status), s(r.notes), s(r.created_by_name)]; }) },
        { name: "Detalle de compras", head: ["Compra", "Referencia", "Producto", "Cantidad", "Costo unitario", "IVA %", "Total línea", "Nota"],
          rows: items.map((i) => { const p = prods.get(String(i.product_id)); return [n(num.get(String(i.purchase_id))), p?.sku ?? "", p?.name ?? "", n(i.qty), n(i.unit_cost), n(i.tax_rate), n(i.line_total), s(i.note)]; }) },
      ];
    },
  },
  {
    key: "traslados", icon: "🚛", title: "Traslados", detail: "Traslados entre bodega y puntos con lo enviado y lo recibido.",
    perms: ["transfers"], usesRange: true,
    async build({ storeId, range, step }) {
      step("Traslados…");
      const [{ point }, prods] = await Promise.all([lookups(storeId), productNames(storeId)]);
      const rows = await all((a, b) => sb().from("erp_transfers").select("id,number,from_warehouse_id,to_warehouse_id,status,notes,created_by_name,created_at,received_at,received_by_name,carrier_name")
        .eq("store_id", storeId).gte("created_at", startOf(range.from)).lte("created_at", endOf(range.to)).order("created_at").range(a, b));
      const items = await byIds("erp_transfer_items", "transfer_id,product_id,qty,received_qty,internal_price", "transfer_id", rows.map((r) => String(r.id)), step, "Detalle de traslados");
      const num = new Map(rows.map((r) => [String(r.id), r.number]));
      return [
        { name: "Traslados", head: ["Fecha", "Número", "Sale de", "Llega a", "Estado", "Transportador", "Envió", "Recibido", "Recibió", "Notas"],
          rows: rows.map((r) => [xDate(r.created_at, true), n(r.number), point.get(String(r.from_warehouse_id)) ?? "", point.get(String(r.to_warehouse_id)) ?? "", s(r.status), s(r.carrier_name),
            s(r.created_by_name), xDate(r.received_at, true), s(r.received_by_name), s(r.notes)]) },
        { name: "Detalle de traslados", head: ["Traslado", "Referencia", "Producto", "Enviado", "Recibido", "Precio del punto"],
          rows: items.map((i) => { const p = prods.get(String(i.product_id)); return [n(num.get(String(i.transfer_id))), p?.sku ?? "", p?.name ?? "", n(i.qty), n(i.received_qty), n(i.internal_price)]; }) },
      ];
    },
  },
  {
    key: "gastos", icon: "💸", title: "Gastos", detail: "Cada gasto con categoría, punto, a quién se le pagó y si está pagado.",
    perms: ["expenses"], usesRange: true,
    async build({ storeId, range, step }) {
      step("Gastos…");
      const { point } = await lookups(storeId);
      const cats = await all((a, b) => sb().from("erp_expense_categories").select("id,name").eq("store_id", storeId).range(a, b));
      const cat = new Map(cats.map((c) => [String(c.id), String(c.name)]));
      const rows = await all((a, b) => sb().from("erp_expenses").select("number,category_id,point_id,description,payee_name,reference,amount,paid,incurred_on,due_on,status,notes,created_by_name")
        .eq("store_id", storeId).gte("incurred_on", range.from).lte("incurred_on", range.to).order("incurred_on").range(a, b));
      return [{ name: "Gastos", head: ["Fecha", "Número", "Categoría", "Punto", "Descripción", "Pagado a", "Referencia", "Valor", "Pagado", "Vence", "Estado", "Notas", "Registró"],
        rows: rows.map((r) => [xDate(r.incurred_on), n(r.number), cat.get(String(r.category_id)) ?? "", point.get(String(r.point_id)) ?? "General", s(r.description), s(r.payee_name), s(r.reference),
          n(r.amount), n(r.paid), xDate(r.due_on), s(r.status), s(r.notes), s(r.created_by_name)]) }];
    },
  },
  {
    key: "caja", icon: "💵", title: "Caja", detail: "Aperturas y cierres de caja por punto, con lo esperado, lo contado y la diferencia, y sus movimientos.",
    perms: ["cash", "cash_manage"], usesRange: true,
    async build({ storeId, range, step }) {
      step("Caja…");
      const { point } = await lookups(storeId);
      const rows = await all((a, b) => sb().from("erp_cash_sessions").select("id,point_id,number,status,opening_amount,opened_by_name,opened_at,expected_amount,counted_amount,difference,closed_by_name,closed_at,closing_note")
        .eq("store_id", storeId).gte("opened_at", startOf(range.from)).lte("opened_at", endOf(range.to)).order("opened_at").range(a, b));
      const moves = await byIds("erp_cash_moves", "session_id,kind,amount,reason,created_by_name,created_at", "session_id", rows.map((r) => String(r.id)), step, "Movimientos de caja");
      const ses = new Map(rows.map((r) => [String(r.id), r]));
      return [
        { name: "Cajas", head: ["Punto", "Número", "Abrió", "Apertura", "Base", "Esperado", "Contado", "Diferencia", "Cerró", "Cierre", "Estado", "Nota"],
          rows: rows.map((r) => [point.get(String(r.point_id)) ?? "", n(r.number), s(r.opened_by_name), xDate(r.opened_at, true), n(r.opening_amount), n(r.expected_amount), n(r.counted_amount),
            n(r.difference), s(r.closed_by_name), xDate(r.closed_at, true), r.status === "open" ? "abierta" : "cerrada", s(r.closing_note)]) },
        { name: "Movimientos de caja", head: ["Fecha", "Punto", "Caja", "Tipo", "Valor", "Motivo", "Registró"],
          rows: moves.map((m) => { const c = ses.get(String(m.session_id)); return [xDate(m.created_at, true), point.get(String(c?.point_id)) ?? "", n(c?.number), s(m.kind), n(m.amount), s(m.reason), s(m.created_by_name)]; }) },
      ];
    },
  },
  {
    key: "vales", icon: "🧾", title: "Vales y préstamos a empleados", detail: "Cada vale con productos o dinero, cuotas, interés, saldo y lo descontado en nómina o abonado.",
    perms: ["payroll", "payroll_approve", "payroll_pay"],
    async build({ storeId }) {
      const { data, error } = await sb().rpc("erp_employee_loans_list", { p_store: storeId });
      if (error) throw new Error(error.message);
      const loans = ((data as { loans?: Row[] } | null)?.loans ?? []) as Row[];
      const ST: Record<string, string> = { active: "activo", paid: "pagado", void: "anulado" };
      return [
        { name: "Vales", head: ["Número", "Empleado", "Documento", "Tipo", "Descripción", "Punto", "Valor", "Interés", "Total", "Cuotas", "Cuota", "Desde", "Saldo", "Estado", "Pausado", "Dio", "Fecha"],
          rows: loans.map((l) => [n(l.number), s(l.employee), s(l.document), l.kind === "product" ? "productos" : "dinero", s(l.description), s(l.point), n(l.principal), n(l.interest), n(l.total),
            n(l.installments), n(l.installment), xDate(l.start_on), n(l.balance), ST[String(l.status)] ?? s(l.status), l.paused ? "Sí" : "No", s(l.created_by_name), xDate(l.created_at)]) },
        { name: "Descuentos y abonos", head: ["Vale", "Empleado", "Fecha", "Origen", "Valor", "Nota", "Anulado"],
          rows: loans.flatMap((l) => ((l.payments as Row[] | null) ?? []).map((p) => [n(l.number), s(l.employee), xDate(p.paid_at), p.source === "payroll" ? `nómina #${s(p.run_number)}` : "abono",
            n(p.amount), s(p.note), p.voided ? "Sí" : "No"])) },
      ];
    },
  },
  {
    key: "trabajadores", icon: "🧑‍🔧", title: "Trabajadores", detail: "Los empleados de nómina con cargo, salario y datos de pago.",
    perms: ["payroll"],
    async build({ storeId }) {
      const { point } = await lookups(storeId);
      const rows = await all((a, b) => sb().from("erp_employees").select("full_name,document_type,document,position,contract_type,base_salary,pay_frequency,transport_aid,hired_on,terminated_on,active,phone,email,bank_name,bank_account,point_id")
        .eq("store_id", storeId).is("deleted_at", null).order("full_name").range(a, b));
      return [{ name: "Trabajadores", head: ["Nombre", "Tipo doc.", "Documento", "Cargo", "Punto", "Contrato", "Salario base", "Pago", "Auxilio de transporte", "Ingreso", "Retiro", "Activo", "Celular", "Correo", "Banco", "Cuenta"],
        rows: rows.map((e) => [s(e.full_name), s(e.document_type), s(e.document), s(e.position), point.get(String(e.point_id)) ?? "", s(e.contract_type), n(e.base_salary), s(e.pay_frequency),
          e.transport_aid ? "Sí" : "No", xDate(e.hired_on), xDate(e.terminated_on), yes(e.active), s(e.phone), s(e.email), s(e.bank_name), s(e.bank_account)]) }];
    },
  },
];
