"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, Printer, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";

type Purchase = {
  id: string; store_id: string; number: number; status: string; invoice_ref: string | null; invoice_date: string | null;
  payment_type: "cash" | "credit"; due_date: string | null; subtotal: number; tax: number; total: number; notes: string | null;
  created_at: string; created_by_name: string | null; checked_by_name: string | null; received_by_name: string | null;
  supplier_id: string; warehouse_id: string | null;
};
type Product = {
  name: string; sku: string | null; barcode: string | null; image_url: string | null;
  price_1: number | null; price_2: number | null; price_3: number | null; price_4: number | null; price_5: number | null;
};
type Item = {
  id: string; qty: number; unit_cost: number; tax_rate: number; line_total: number | null; warehouse_id: string | null;
  products: Product | Product[] | null;
};
type Supplier = { name: string; nit: string | null; contact_name: string | null; phone: string | null; email: string | null; address: string | null };
type Business = { name: string; nit: string | null; address: string | null; city: string | null; phone: string | null; email: string | null; logo: string | null };
type Doc = { purchase: Purchase; items: Item[]; supplier: Supplier | null; warehouses: Map<string, string>; business: Business };

/** Con qué valor se muestran los productos en el comprobante. */
type Basis = "cost" | "p1" | "p2" | "p3" | "p4" | "p5";
const BASES: Array<{ key: Basis; label: string; column: string; hint: string }> = [
  { key: "cost", label: "Costo de entrada", column: "Costo unit.", hint: "Lo que pagaste al proveedor" },
  { key: "p1", label: "Precio 1", column: "Precio 1", hint: "Mínimo" },
  { key: "p2", label: "Precio 2", column: "Precio 2", hint: "Mayor" },
  { key: "p3", label: "Precio 3", column: "Precio 3", hint: "Detal" },
  { key: "p4", label: "Precio 4", column: "Precio 4", hint: "Lista 4" },
  { key: "p5", label: "Precio 5", column: "Precio 5", hint: "Lista 5" },
];
const isBasis = (v: string | null): v is Basis => BASES.some((b) => b.key === v);

const money = (n: number | null | undefined) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n ?? 0));
const fmtDate = (v: string | null | undefined, withTime = false) =>
  v
    ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleString("es-CO", withTime ? { dateStyle: "long", timeStyle: "short" } : { dateStyle: "long" })
    : "—";
const product = (i: Item) => (Array.isArray(i.products) ? i.products[0] : i.products) ?? null;

function unitValue(i: Item, basis: Basis) {
  if (basis === "cost") return Number(i.unit_cost);
  const prod = product(i);
  return Number(prod?.[`price_${basis.slice(1)}` as keyof Product] ?? 0);
}

async function loadDoc(id: string): Promise<Doc> {
  const sb = supabaseBrowser();
  const access = await getDashboardStore();
  if (!access.store) throw new Error("Inicia sesión con un usuario de la tienda para ver este comprobante.");

  const { data: purchase, error } = await sb
    .from("erp_purchases")
    .select("id,store_id,number,status,invoice_ref,invoice_date,payment_type,due_date,subtotal,tax,total,notes,created_at,created_by_name,checked_by_name,received_by_name,supplier_id,warehouse_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!purchase) throw new Error("No encontramos este ingreso o no tienes permiso de Compras para verlo.");

  const [{ data: items }, { data: supplier }, { data: whs }, { data: billing }] = await Promise.all([
    sb
      .from("erp_purchase_items")
      .select("id,qty,unit_cost,tax_rate,line_total,warehouse_id,products(name,sku,barcode,image_url,price_1,price_2,price_3,price_4,price_5)")
      .eq("purchase_id", id),
    sb.from("erp_suppliers").select("name,nit,contact_name,phone,email,address").eq("id", purchase.supplier_id).maybeSingle(),
    sb.from("erp_warehouses").select("id,name").eq("store_id", purchase.store_id),
    sb.from("billing_settings").select("business_name,nit,address,city,phone,email,logo_url").eq("store_id", purchase.store_id).maybeSingle(),
  ]);

  return {
    purchase: purchase as Purchase,
    items: ((items ?? []) as unknown as Item[]).sort((a, b) => (product(a)?.name ?? "").localeCompare(product(b)?.name ?? "")),
    supplier: (supplier as Supplier) ?? null,
    warehouses: new Map(((whs ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name])),
    business: {
      name: billing?.business_name || access.store.name,
      nit: billing?.nit ?? null,
      address: billing?.address ?? null,
      city: billing?.city ?? null,
      phone: billing?.phone ?? access.store.whatsapp ?? null,
      email: billing?.email ?? null,
      logo: billing?.logo_url || access.store.logo_url || null,
    },
  };
}

export default function PurchaseReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");
  const [basis, setBasis] = useState<Basis>("cost");
  const [chooser, setChooser] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDoc(id)
      .then((d) => {
        if (!alive) return;
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("valor");
        setDoc(d);
        if (isBasis(fromUrl)) setBasis(fromUrl);
        // ?elegir=1 (al registrar el ingreso o desde el historial): primero se elige con qué valores imprimir.
        if (params.get("elegir") === "1") setChooser(true);
        else if (params.get("print") === "1") window.setTimeout(() => window.print(), 450);
        document.title = `Ingreso-${d.purchase.number}${d.purchase.invoice_ref ? `-Factura-${d.purchase.invoice_ref}` : ""}`;
      })
      .catch((e: unknown) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const totals = useMemo(() => {
    const out = {} as Record<Basis, number>;
    for (const b of BASES) out[b.key] = (doc?.items ?? []).reduce((s, i) => s + Number(i.qty) * unitValue(i, b.key), 0);
    return out;
  }, [doc]);

  function chooseBasis(next: Basis, print: boolean) {
    setBasis(next);
    const url = new URL(window.location.href);
    url.searchParams.set("valor", next);
    url.searchParams.delete("elegir");
    url.searchParams.delete("print");
    window.history.replaceState(null, "", url.toString());
    if (print) {
      setChooser(false);
      window.setTimeout(() => window.print(), 350);
    }
  }

  if (error || !doc) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-slate-100 p-6 text-slate-800">
        {error ? (
          <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow">
            <p className="text-lg font-bold">No se pudo abrir el comprobante</p>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
            <Link href="/dashboard/inventario" className="mt-4 inline-block text-sm font-semibold text-violet-700 underline">Ir a Inventario</Link>
          </div>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        )}
      </main>
    );
  }

  const { purchase: p, items, supplier, warehouses, business } = doc;
  const current = BASES.find((b) => b.key === basis) ?? BASES[0];
  const atCost = basis === "cost";
  const units = items.reduce((s, i) => s + Number(i.qty), 0);
  const destinations = [...new Set(items.map((i) => warehouses.get(i.warehouse_id ?? p.warehouse_id ?? "") ?? "—"))];
  const costSubtotal = Number(p.subtotal ?? totals.cost);
  const costTax = Number(p.tax ?? 0);
  const costTotal = Number(p.total ?? costSubtotal + costTax);
  const priceTotal = totals[basis];
  const cancelled = p.status === "cancelled";
  const cell = "border-b border-slate-400 px-2 py-2 align-middle";

  return (
    <main className="min-h-[100dvh] bg-slate-200 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: letter portrait; margin: 0; } html, body { background: #fff !important; } .no-print { display: none !important; } .receipt-doc, .receipt-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .receipt-doc .text-slate-400, .receipt-doc .text-slate-500, .receipt-doc .text-slate-600 { color: #1e293b !important; } }`}</style>

      {/* Barra de acciones */}
      <div className="no-print mx-auto mb-4 max-w-[216mm] space-y-3 px-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/dashboard/inventario" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow">
            <ArrowLeft className="h-4 w-4" /> Volver a inventario
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-500 to-violet-600 px-5 py-2 text-sm font-bold text-white shadow-lg"
          >
            <Printer className="h-4 w-4" /> Imprimir / Guardar PDF
          </button>
        </div>
        <div className="rounded-2xl bg-white p-2 shadow">
          <p className="px-2 pb-1.5 pt-1 text-xs font-semibold text-slate-500">Valores del comprobante</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {BASES.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => chooseBasis(b.key, false)}
                className={`relative rounded-xl px-2 py-2 text-center text-xs font-semibold transition ${basis === b.key ? "text-white" : "text-slate-700 hover:bg-slate-100"}`}
              >
                {basis === b.key ? (
                  <motion.span layoutId="basis-pill" className="absolute inset-0 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600" transition={{ type: "spring", stiffness: 380, damping: 30 }} />
                ) : null}
                <span className="relative block">{b.label}</span>
                <span className={`relative block text-[10px] font-normal ${basis === b.key ? "text-white/80" : "text-slate-400"}`}>{money(totals[b.key])}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <article className="receipt-doc relative mx-auto w-full max-w-[216mm] bg-white p-6 text-[12px] text-black shadow-xl sm:p-10 print:max-w-none print:px-[14mm] print:py-[12mm] print:shadow-none">
        {cancelled ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[90px] font-black tracking-widest text-red-500/15 [transform:rotate(-24deg)]">
            ANULADA
          </span>
        ) : null}

        {/* Encabezado */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
          <div className="flex items-start gap-3">
            {business.logo ? <img src={business.logo} alt="" className="h-16 w-16 object-contain" /> : null}
            <div>
              <p className="text-lg font-extrabold leading-tight">{business.name}</p>
              {business.nit ? <p>NIT: {business.nit}</p> : null}
              {[business.address, business.city].filter(Boolean).length ? <p>{[business.address, business.city].filter(Boolean).join(" · ")}</p> : null}
              {[business.phone, business.email].filter(Boolean).length ? <p>{[business.phone, business.email].filter(Boolean).join(" · ")}</p> : null}
            </div>
          </div>
          <div className="rounded-lg border-2 border-black px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider">Comprobante de ingreso</p>
            <p className="text-2xl font-black">N.º {p.number}</p>
            <p className="text-[11px]">Registrado: {fmtDate(p.created_at, true)}</p>
            <p className="text-[11px] font-semibold">Valorizado a: {current.label}{atCost ? "" : ` (${current.hint.toLowerCase()})`}</p>
            {cancelled ? <p className="text-[11px] font-bold text-red-600">ANULADO</p> : null}
          </div>
        </header>

        {/* Datos */}
        <section className="mt-5 grid gap-3 sm:grid-cols-3 print:grid-cols-3">
          <div className="rounded-lg border border-slate-500 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-700">Proveedor</p>
            <p className="font-bold">{supplier?.name ?? "—"}</p>
            {supplier?.nit ? <p>NIT: {supplier.nit}</p> : null}
            {supplier?.contact_name ? <p>Contacto: {supplier.contact_name}</p> : null}
            {[supplier?.phone, supplier?.email].filter(Boolean).length ? <p>{[supplier?.phone, supplier?.email].filter(Boolean).join(" · ")}</p> : null}
            {supplier?.address ? <p>{supplier.address}</p> : null}
          </div>
          <div className="rounded-lg border border-slate-500 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-700">Factura del proveedor</p>
            <p>N.º factura: <b>{p.invoice_ref ?? "—"}</b></p>
            <p>Fecha factura: {fmtDate(p.invoice_date)}</p>
            <p>Forma de pago: <b>{p.payment_type === "credit" ? "Crédito" : "Contado"}</b></p>
            {p.payment_type === "credit" ? <p>Vence: {fmtDate(p.due_date)}</p> : null}
          </div>
          <div className="rounded-lg border border-slate-500 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-700">Recepción</p>
            <p>Bodega: <b>{destinations.join(", ")}</b></p>
            <p>Revisó: {p.checked_by_name ?? "—"}</p>
            <p>Registró: {p.received_by_name ?? p.created_by_name ?? "—"}</p>
          </div>
        </section>

        {/* Productos */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse print:min-w-0">
            <thead>
              <tr className="border-y-2 border-black text-left text-[10px] font-bold uppercase tracking-wider text-black">
                <th className="px-2 py-2 text-center">#</th>
                <th className="px-2 py-2">Código</th>
                <th className="px-2 py-2">Descripción</th>
                <th className="px-2 py-2 text-center">Cant.</th>
                <th className="px-2 py-2 text-right">{current.column}</th>
                {atCost ? <th className="px-2 py-2 text-center">IVA</th> : null}
                <th className="px-2 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, index) => {
                const prod = product(i);
                const value = unitValue(i, basis);
                return (
                  <tr key={i.id} className="break-inside-avoid">
                    <td className={`${cell} text-center text-slate-500`}>{index + 1}</td>
                    <td className={`${cell} whitespace-nowrap text-slate-600`}>{prod?.sku || prod?.barcode || "—"}</td>
                    <td className={cell}>
                      <span className="flex items-center gap-2">
                        {prod?.image_url ? (
                          <img src={prod.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md border border-slate-200 object-cover" />
                        ) : (
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-dashed border-slate-300 text-[9px] text-slate-400">Sin foto</span>
                        )}
                        <span>
                          <span className="font-semibold">{prod?.name ?? "Producto"}</span>
                          {destinations.length > 1 ? (
                            <span className="block text-[10px] text-slate-500">→ {warehouses.get(i.warehouse_id ?? "") ?? "—"}</span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className={`${cell} text-center font-semibold`}>{i.qty}</td>
                    <td className={`${cell} whitespace-nowrap text-right`}>{value ? money(value) : <span className="text-amber-600">Sin precio</span>}</td>
                    {atCost ? <td className={`${cell} text-center`}>{Number(i.tax_rate) ? `${Number(i.tax_rate)}%` : "—"}</td> : null}
                    <td className={`${cell} whitespace-nowrap text-right font-semibold`}>{money(Number(i.qty) * value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totales */}
        <section className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
          <div className="text-[11px] text-slate-600 sm:max-w-[55%]">
            <p>{items.length} producto{items.length === 1 ? "" : "s"} · {units} unidades</p>
            {p.notes ? <p className="mt-1"><b>Notas:</b> {p.notes}</p> : null}
          </div>
          {atCost ? (
            <div className="w-full rounded-lg border-2 border-black sm:w-72 print:w-72">
              <div className="flex justify-between px-3 py-1.5"><span>Subtotal</span><span>{money(costSubtotal)}</span></div>
              <div className="flex justify-between border-t border-slate-200 px-3 py-1.5"><span>IVA</span><span>{money(costTax)}</span></div>
              <div className="flex justify-between border-t-2 border-black bg-slate-100 px-3 py-2 text-base font-black text-black">
                <span>TOTAL</span><span>{money(costTotal)}</span>
              </div>
            </div>
          ) : (
            // Solo el valor elegido: sin costo ni ganancia.
            <div className="w-full rounded-lg border-2 border-black sm:w-80 print:w-80">
              <div className="flex justify-between px-3 py-1.5"><span>Subtotal</span><span>{money(priceTotal)}</span></div>
              <div className="flex justify-between border-t-2 border-black bg-slate-100 px-3 py-2 text-base font-black text-black">
                <span>TOTAL {current.label.toUpperCase()}</span><span>{money(priceTotal)}</span>
              </div>
            </div>
          )}
        </section>

        {/* Firmas */}
        <section className="mt-14 grid grid-cols-2 gap-10 text-center text-[11px] print:mt-16">
          <div>
            <div className="border-t border-slate-900 pt-1 font-semibold">{p.checked_by_name ?? " "}</div>
            <p className="text-slate-500">Revisó la mercancía</p>
          </div>
          <div>
            <div className="border-t border-slate-900 pt-1 font-semibold">{p.received_by_name ?? p.created_by_name ?? " "}</div>
            <p className="text-slate-500">Recibió / registró</p>
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-200 pt-2 text-center text-[10px] text-slate-500">
          Documento interno de recepción de mercancía · Soporte de la factura {p.invoice_ref ?? "—"} de {supplier?.name ?? "el proveedor"}
          {atCost ? "" : ` · Precios de venta vigentes al ${fmtDate(new Date().toISOString())}`}
        </footer>
      </article>

      {/* Elección de valores antes de imprimir */}
      <AnimatePresence>
        {chooser ? (
          <motion.div
            className="no-print fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setChooser(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: 30, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-3xl bg-white p-5 text-slate-900 shadow-2xl sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold">¿Con qué valores quieres el comprobante?</h2>
                  <p className="text-sm text-slate-500">Ingreso N.º {p.number} · {units} unidades</p>
                </div>
                <button type="button" onClick={() => setChooser(false)} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full border border-slate-200">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {BASES.map((b) => (
                  <motion.button
                    key={b.key}
                    type="button"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => chooseBasis(b.key, true)}
                    className={`rounded-2xl border-2 p-3 text-left transition ${basis === b.key ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-violet-300"}`}
                  >
                    <span className="block text-sm font-bold">{b.label}</span>
                    <span className="block text-[11px] text-slate-500">{b.hint}</span>
                    <span className="mt-1.5 block text-base font-black">{money(totals[b.key])}</span>
                  </motion.button>
                ))}
              </div>
              <p className="mt-3 text-center text-[11px] text-slate-500">Toca una opción para imprimir. Puedes cambiarla luego en la barra superior.</p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
