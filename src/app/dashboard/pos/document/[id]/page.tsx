"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

function money(n: number) {
  return `$${Number(n || 0).toLocaleString("es-CO")}`;
}

type DocumentRow = {
  id: string;
  store_id: string;
  doc_type: string;
  status: string;
  prefix: string | null;
  number: number | null;
  full_number: string | null;
  customer_name: string | null;
  customer_doc: string | null;
  issued_at: string | null;
  due_at: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  notes: string | null;
  electronic_provider: string | null;
  siigo_number: string | null;
  siigo_status: string | null;
  balance: number;
  currency_code: string | null;
};

type DocumentLine = {
  id: string;
  document_id: string;
  description: string;
  qty: number;
  price: number;
  line_total: number;
  line_subtotal: number;
  line_tax: number;
  sku: string | null;
};

type StoreInfo = {
  name: string;
  whatsapp: string;
  logo_url: string | null;
};

export default function BillingDocumentPage() {
  const params = useParams() as { id?: string } | null;
  const id = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<DocumentRow | null>(null);
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const { data: docData, error: docError } = await sb
        .from("billing_documents")
        .select(
          "id,store_id,doc_type,status,prefix,number,full_number,customer_name,customer_doc,issued_at,due_at,subtotal,tax_total,total,notes,electronic_provider,siigo_number,siigo_status,balance,currency_code"
        )
        .eq("id", id)
        .maybeSingle();

      if (docError) throw docError;
      if (!docData) {
        throw new Error("Documento no encontrado.");
      }

      setDocument(docData as DocumentRow);

      const { data: linesData, error: linesError } = await sb
        .from("billing_document_lines")
        .select("id,document_id,description,qty,price,line_total,line_subtotal,line_tax,sku")
        .eq("document_id", id)
        .order("line_no", { ascending: true });

      if (linesError) throw linesError;
      setLines((linesData as DocumentLine[]) ?? []);

      const { data: storeData, error: storeError } = await sb
        .from("stores")
        .select("name,whatsapp,logo_url")
        .eq("id", docData.store_id)
        .maybeSingle();

      if (storeError) throw storeError;
      setStoreInfo((storeData as StoreInfo) ?? null);
    } catch (err: unknown) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo cargar el documento",
        text: String((err as Error)?.message ?? String(err)),
        background: "#0b0b0b",
        color: "#fff",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!printMode) return;
    const prevTitle = window.document.title;
    window.document.title = `Documento-${document?.full_number ?? id}`;

    const timeout = window.setTimeout(() => {
      try {
        window.print();
      } finally {
        setPrintMode(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      window.document.title = prevTitle;
    };
  }, [printMode, document, id]);

  const docName = document?.full_number || `${document?.prefix ?? ""}${document?.number ?? ""}`;
  const docTitle = document?.doc_type === "factura" ? "Factura" : "Remisión";

  const statusLabel = (status: string) => {
    if (status === "DRAFT") return "Borrador";
    if (status === "FINAL") return "Finalizada";
    return status;
  };

  const totalLabel = useMemo(() => money(document?.total ?? 0), [document]);

  if (loading) {
    return (
      <main className="p-6">
        <p style={{ color: "var(--t-text)" }}>Cargando documento...</p>
      </main>
    );
  }

  if (!document) {
    return (
      <main className="p-6">
        <p style={{ color: "var(--t-text)" }}>Documento no disponible.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 text-[color:var(--t-text)] print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-slate-400">{storeInfo?.name ?? "Tienda"}</p>
            <h1 className="text-3xl font-semibold">{docTitle}</h1>
            <p className="mt-2 text-sm text-slate-500">{docName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPrintMode(true)}
              className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-slate-900"
              style={{ borderColor: "var(--t-card-border)" }}
            >
              Imprimir
            </button>
          </div>
        </div>

        <div className="rounded-[28px] border bg-white/5 p-6" style={{ borderColor: "var(--t-card-border)" }}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Cliente</p>
              <p className="mt-2 font-semibold">{document.customer_name || "Consumidor final"}</p>
              <p className="text-sm text-slate-500">Doc: {document.customer_doc || "CF"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Datos</p>
              <p className="mt-2 text-sm text-slate-500">Fecha emisión: {document.issued_at ? new Date(document.issued_at).toLocaleString("es-CO") : "—"}</p>
              <p className="text-sm text-slate-500">Vence: {document.due_at ? new Date(document.due_at).toLocaleDateString("es-CO") : "—"}</p>
              <p className="text-sm text-slate-500">Estado: {statusLabel(document.status)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border bg-white/5 p-6" style={{ borderColor: "var(--t-card-border)" }}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="pb-3 font-semibold">Producto</th>
                <th className="pb-3 font-semibold">Cant.</th>
                <th className="pb-3 font-semibold">Precio</th>
                <th className="pb-3 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/10">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-3 align-top">
                    <div className="font-semibold">{line.description}</div>
                    {line.sku ? <div className="text-xs text-slate-500">SKU: {line.sku}</div> : null}
                  </td>
                  <td className="py-3 align-top">{line.qty}</td>
                  <td className="py-3 align-top">{money(line.price)}</td>
                  <td className="py-3 align-top">{money(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-[28px] border bg-white/5 p-6" style={{ borderColor: "var(--t-card-border)" }}>
            <h2 className="text-lg font-semibold">Notas</h2>
            <p className="mt-3 text-sm text-slate-500">{document.notes || "No hay notas adicionales."}</p>
            {document.electronic_provider ? (
              <div className="mt-4 text-sm text-slate-500">
                <p>Proveedor electrónico: {document.electronic_provider}</p>
                <p>Id Siigo: {document.siigo_number || "—"}</p>
                <p>Estado Siigo: {document.siigo_status || "—"}</p>
              </div>
            ) : null}
          </div>
          <div className="rounded-[28px] border bg-white/5 p-6" style={{ borderColor: "var(--t-card-border)" }}>
            <div className="space-y-3 text-sm text-slate-500">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{money(document.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Impuestos</span>
                <span>{money(document.tax_total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Saldo pendiente</span>
                <span>{money(document.balance)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Total</span>
                <span>{totalLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
