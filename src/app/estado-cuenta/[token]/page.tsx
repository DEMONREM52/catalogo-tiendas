"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Estado de cuenta que la tienda le comparte al cliente (20261334). Se abre sin sesión con el enlace privado
 * (vence a los 30 días). Hoja blanca pensada para imprimir o guardar en PDF.
 */

type Doc = { doc_number: string; issue_date: string | null; due_date: string | null; total: number; balance: number; days_overdue: number; order_token: string | null };
type Move = { at: string; kind: "charge" | "payment" | "credit_note" | "debit_note"; label: string; amount: number; method?: string | null; reason?: string | null };
type Data = {
  ok: boolean; expired?: boolean; generated_at: string; expires_at: string;
  store: { name: string; logo_url: string | null; whatsapp: string | null } | null;
  customer: { name: string; document_type: string | null; document_number: string | null; credit_limit: number | null; credit_days: number | null };
  totals: { open: number; overdue: number; billed: number; paid: number };
  documents: Doc[];
  movements: Move[];
};

const cop = (v: unknown) => `$${Math.round(Number(v ?? 0)).toLocaleString("es-CO")}`;
const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const dmyTime = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", nequi: "Nequi / Daviplata", tarjeta: "Tarjeta", consignacion: "Consignación" };
const MOVE: Record<Move["kind"], { label: string; sign: 1 | -1 }> = {
  charge: { label: "Compra a crédito", sign: 1 },
  payment: { label: "Abono", sign: -1 },
  credit_note: { label: "Nota crédito", sign: -1 },
  debit_note: { label: "Nota débito", sign: 1 },
};

export default function StatementPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_statement_public", { p_token: token }).then(({ data: d }) => {
      if (!alive) return;
      setData((d as Data | null) ?? null);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [token]);

  // «Ver, imprimir o PDF» desde el panel abre con ?imprimir=1: sale el diálogo de impresión solo.
  useEffect(() => {
    if (!data?.ok || new URLSearchParams(window.location.search).get("imprimir") !== "1") return;
    const t = window.setTimeout(() => window.print(), 700);
    return () => window.clearTimeout(t);
  }, [data]);

  if (loading) return <Sheet><p className="py-16 text-center text-slate-500">Cargando el estado de cuenta…</p></Sheet>;
  if (!data?.ok) {
    return (
      <Sheet>
        <div className="py-16 text-center">
          <p className="text-4xl">🔒</p>
          <p className="mt-2 text-lg font-bold">{data?.expired ? "Este enlace ya venció" : "No se pudo abrir el estado de cuenta"}</p>
          <p className="mt-1 text-sm text-slate-500">Pídele a la tienda que te envíe uno nuevo.</p>
        </div>
      </Sheet>
    );
  }

  const c = data.customer;
  const overdueDocs = data.documents.filter((d) => d.days_overdue > 0).length;
  return (
    <Sheet>
      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">🖨️ Imprimir o guardar PDF</button>
      </div>

      {/* Encabezado */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.store?.logo_url ? <img src={data.store.logo_url} alt="" className="h-16 w-16 shrink-0 object-contain" /> : null}
          <div className="min-w-0">
            <p className="text-xl font-black leading-tight">{data.store?.name ?? "Tienda"}</p>
            {data.store?.whatsapp ? <p className="text-sm text-slate-600">WhatsApp {data.store.whatsapp}</p> : null}
          </div>
        </div>
        <div className="rounded-xl border-2 border-slate-900 px-4 py-2 text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.15em]">Estado de cuenta</p>
          <p className="text-sm text-slate-600">Corte: {dmyTime(data.generated_at)}</p>
        </div>
      </header>

      <section className="mt-5 rounded-xl border border-slate-300 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Cliente</p>
        <p className="text-base font-black">{c.name}</p>
        {c.document_number ? <p className="text-sm">{c.document_type ?? "Doc."} {c.document_number}</p> : null}
        {Number(c.credit_limit) > 0 ? (
          <p className="text-sm text-slate-600">Cupo de crédito {cop(c.credit_limit)}{c.credit_days ? ` · plazo ${c.credit_days} días` : ""}</p>
        ) : null}
      </section>

      {/* Resumen */}
      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Saldo pendiente", data.totals.open, data.totals.open > 0 ? "text-slate-900" : "text-emerald-600"],
          ["Vencido", data.totals.overdue, data.totals.overdue > 0 ? "text-red-600" : "text-slate-900"],
          ["Compras a crédito", data.totals.billed, "text-slate-900"],
          ["Abonado", data.totals.paid, "text-emerald-600"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-slate-300 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label as string}</p>
            <p className={`mt-0.5 text-lg font-black tabular-nums ${color as string}`}>{cop(value)}</p>
          </div>
        ))}
      </section>
      {data.totals.open <= 0 ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-center text-sm font-bold text-emerald-700">🎉 Estás al día. ¡Gracias!</p> : null}
      {overdueDocs > 0 ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-center text-sm font-bold text-red-700">
          Tienes {overdueDocs} documento{overdueDocs === 1 ? "" : "s"} vencido{overdueDocs === 1 ? "" : "s"} por {cop(data.totals.overdue)}.
        </p>
      ) : null}

      {/* Documentos pendientes */}
      {data.documents.length ? (
        <section className="mt-5">
          <h2 className="text-sm font-black uppercase tracking-wide">Documentos pendientes</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y-2 border-slate-900 text-left text-[11px] uppercase tracking-wide">
                <th className="py-1.5 pr-2">Documento</th><th className="py-1.5 pr-2">Fecha</th><th className="py-1.5 pr-2">Vence</th>
                <th className="py-1.5 pr-2 text-right">Valor</th><th className="py-1.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.map((d, i) => (
                <tr key={`${d.doc_number}-${i}`} className="border-b border-slate-300 align-top" style={{ breakInside: "avoid" }}>
                  <td className="py-1.5 pr-2 font-semibold">
                    {d.order_token ? <a className="underline" href={`/pedido/${d.order_token}`} target="_blank" rel="noreferrer">{d.doc_number}</a> : d.doc_number}
                    {d.days_overdue > 0 ? <span className="block text-[11px] font-bold text-red-600">Vencido hace {d.days_overdue} día{d.days_overdue === 1 ? "" : "s"}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">{dmy(d.issue_date)}</td>
                  <td className="py-1.5 pr-2">{dmy(d.due_date)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{cop(d.total)}</td>
                  <td className="py-1.5 text-right font-black tabular-nums">{cop(d.balance)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="py-2 text-right font-black">TOTAL PENDIENTE</td>
                <td className="py-2 text-right text-base font-black tabular-nums">{cop(data.totals.open)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}

      {/* Movimientos */}
      {data.movements.length ? (
        <section className="mt-5">
          <h2 className="text-sm font-black uppercase tracking-wide">Movimientos</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y-2 border-slate-900 text-left text-[11px] uppercase tracking-wide">
                <th className="py-1.5 pr-2">Fecha</th><th className="py-1.5 pr-2">Concepto</th>
                <th className="py-1.5 pr-2 text-right">Cargo</th><th className="py-1.5 text-right">Abono</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m, i) => {
                const k = MOVE[m.kind] ?? MOVE.charge;
                return (
                  <tr key={i} className="border-b border-slate-200 align-top" style={{ breakInside: "avoid" }}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{dmy(m.at)}</td>
                    <td className="py-1.5 pr-2">
                      <b>{k.label}</b> · {m.label}
                      {m.method ? <span className="text-slate-500"> · {METHOD[m.method] ?? m.method}</span> : null}
                      {m.reason ? <span className="block text-[11px] text-slate-500">{m.reason}</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{k.sign > 0 ? cop(m.amount) : ""}</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-700">{k.sign < 0 ? cop(m.amount) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer className="mt-6 border-t border-slate-300 pt-3 text-center text-[11px] text-slate-500">
        Estado de cuenta generado por {data.store?.name ?? "la tienda"} el {dmyTime(data.generated_at)}. Si ya pagaste, no tengas en cuenta este mensaje.
        <span className="no-print"> · Enlace válido hasta el {dmy(data.expires_at)}.</span>
      </footer>
    </Sheet>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-900 sm:py-8">
      <style>{"@media print{@page{size:letter portrait;margin:12mm}.no-print{display:none!important}main{background:#fff!important;padding:0!important}.sheet{box-shadow:none!important;border:0!important;padding:0!important;max-width:none!important}}"}</style>
      <div className="sheet mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}
