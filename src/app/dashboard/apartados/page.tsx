"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore, hasStorePermission } from "@/lib/store-utils";

/**
 * Apartados y cotizaciones (20261228).
 *  · Apartados: abonar, entregar (abre el POS con la venta lista) o anular (devuelve las unidades).
 *  · Cotizaciones: compartir el enlace, convertir en venta o anular.
 */

type Payment = { amount: number; method: string; by: string | null; at: string; cash: boolean };
type Layaway = {
  id: string; number: number; point: string; customer_name: string; customer_phone: string | null; items: Array<{ product_id: string; name: string; qty: number; price: number }>;
  total: number; paid: number; balance: number; due_date: string; days_left: number; status: string; note: string | null; created_by_name: string | null; created_at: string; payments: Payment[]; order_token: string | null;
};
type Quote = { id: string; number: number; customer_name: string | null; customer_phone: string | null; total: number; items: Array<{ name: string; qty: number; price: number }>; valid_until: string; status: string; token: string; order_token: string | null; created_by_name: string | null; created_at: string; expired: boolean };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" };
const dmy = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
const wa = (phone: string | null, text: string) => { const d = (phone ?? "").replace(/\D/g, ""); return d.length >= 7 ? `https://wa.me/${d.length === 10 ? `57${d}` : d}?text=${encodeURIComponent(text)}` : null; };
const METHODS: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", nequi: "Nequi", tarjeta: "Tarjeta", efectivo_sin_caja: "Efectivo" };

export default function LayawaysPage() {
  const [store, setStore] = useState<{ id: string; name: string } | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"layaways" | "quotes">("layaways");
  const [status, setStatus] = useState<"open" | "delivered" | "cancelled">("open");
  const [layaways, setLayaways] = useState<Layaway[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      const s = access?.store;
      if (!s) return setAllowed(false);
      setAllowed(hasStorePermission(access, "pos") || hasStorePermission(access, "orders"));
      setStore({ id: s.id, name: s.name });
      if (new URLSearchParams(window.location.search).get("tab") === "cotizaciones") setTab("quotes");
    })();
  }, []);

  const load = useCallback(async () => {
    if (!store) return;
    const sb = supabaseBrowser();
    const [l, q] = await Promise.all([sb.rpc("erp_layaways_list", { p_store: store.id, p_status: status }), sb.rpc("erp_quotes_list", { p_store: store.id, p_status: null })]);
    if (l.error && /Could not find the function|schema cache/i.test(l.error.message)) return setError("Falta ejecutar en Supabase la migración 20261228_ventas_extra.sql.");
    setLayaways(((l.data as { items?: Layaway[] } | null)?.items ?? []));
    setQuotes((Array.isArray(q.data) ? q.data : []) as Quote[]);
  }, [store, status]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function pay(l: Layaway) {
    const r = await Swal.fire({
      title: `Abono · apartado #${l.number}`, html: `<p style="font-size:13px">Saldo: <b>${money(l.balance)}</b></p><select id="m" class="swal2-select" style="display:block;margin:8px auto"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="nequi">Nequi</option><option value="tarjeta">Tarjeta</option></select>`,
      input: "text", inputValue: String(l.balance), inputAttributes: { inputmode: "numeric" }, showCancelButton: true, confirmButtonText: "Registrar abono", cancelButtonText: "Cancelar",
      preConfirm: (v) => ({ amount: Number(String(v).replace(/\D/g, "")), method: (document.getElementById("m") as HTMLSelectElement | null)?.value ?? "efectivo" }), ...swal,
    });
    if (!r.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_layaway_pay", { p_id: l.id, p_amount: r.value.amount, p_method: r.value.method });
    const v = data as { ok: boolean; error?: string; balance?: number; cash?: boolean } | null;
    if (error || !v?.ok) return void Swal.fire({ icon: "error", title: "No se registró", text: error?.message ?? v?.error, ...swal });
    const link = wa(l.customer_phone, `Hola ${l.customer_name.split(" ")[0]}! Recibimos tu abono de ${money(r.value.amount)} al apartado #${l.number} en ${store?.name}. ${Number(v.balance) > 0 ? `Saldo: ${money(Number(v.balance))}.` : "¡Ya está pago! Puedes pasar por él."}`);
    const go = await Swal.fire({ icon: "success", title: Number(v.balance) > 0 ? `Queda ${money(Number(v.balance))}` : "¡Pagado completo!", text: r.value.method === "efectivo" && !v.cash ? "No hay caja abierta en el punto: el abono quedó registrado pero no entró a una caja." : undefined,
      showCancelButton: Boolean(link), confirmButtonText: link ? "💬 Avisarle" : "Listo", cancelButtonText: "Listo", ...swal });
    if (go.isConfirmed && link) window.open(link, "_blank", "noopener");
    void load();
  }
  async function cancel(l: Layaway) {
    const r = await Swal.fire({ title: `Anular apartado #${l.number}`, html: `<p style="font-size:13px">Las unidades vuelven al inventario. Abonado: <b>${money(l.paid)}</b>.</p><input id="ref" class="swal2-input" placeholder="Reintegro en efectivo $ (0 si no)" value="0">`,
      input: "text", inputPlaceholder: "Motivo", showCancelButton: true, confirmButtonText: "Anular", cancelButtonText: "Volver", confirmButtonColor: "#ef4444",
      preConfirm: (v) => ({ reason: String(v ?? ""), refund: Number(((document.getElementById("ref") as HTMLInputElement | null)?.value ?? "0").replace(/\D/g, "")) }), background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!r.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_layaway_cancel", { p_id: l.id, p_reason: r.value.reason, p_refund: r.value.refund });
    const v = data as { ok: boolean; error?: string } | null;
    if (error || !v?.ok) return void Swal.fire({ icon: "error", title: "No se anuló", text: error?.message ?? v?.error, ...swal });
    void load();
  }
  async function cancelQuote(q: Quote) {
    await supabaseBrowser().rpc("erp_quote_set_status", { p_id: q.id, p_status: "cancelled", p_order_token: null });
    void load();
  }

  if (allowed === false) return <main className="p-6"><p className="rounded-2xl border p-4 text-sm" style={card}>🔒 Necesitas el permiso de POS.</p></main>;
  const openQuotes = quotes.filter((q) => q.status === "open");
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">📌 Apartados y cotizaciones</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Se crean desde el POS con «📌 Apartar» o «📝 Cotizar».</p>
        </div>
        <Link href="/dashboard/pos" className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>💳 Ir al POS</Link>
      </header>
      <nav className="flex w-fit gap-1 rounded-full border p-1 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>
        <button type="button" onClick={() => setTab("layaways")} className="rounded-full px-4 py-2" style={tab === "layaways" ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>Apartados</button>
        <button type="button" onClick={() => setTab("quotes")} className="rounded-full px-4 py-2" style={tab === "quotes" ? { background: "var(--t-accent)", color: "#fff" } : { color: "var(--t-muted)" }}>Cotizaciones {openQuotes.length ? `(${openQuotes.length})` : ""}</button>
      </nav>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}

      {tab === "layaways" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-1.5 text-sm">
            {([["open", "Abiertos"], ["delivered", "Entregados"], ["cancelled", "Anulados"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setStatus(k)} className="rounded-full border px-3 py-1.5 font-semibold" style={status === k ? { background: "var(--t-accent)", color: "#fff", borderColor: "transparent" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
            ))}
          </div>
          {!layaways.length ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>{status === "open" ? "No hay apartados abiertos. En el POS arma el carrito y toca «📌 Apartar»: las unidades quedan reservadas y el cliente abona cuando quiera." : "Nada por aquí."}</p> : null}
          <div className="grid gap-3 md:grid-cols-2">
            {layaways.map((l) => {
              const late = l.status === "open" && l.days_left < 0;
              const pct = Math.min(100, Math.round((Number(l.paid) / Number(l.total)) * 100));
              return (
                <div key={l.id} className="rounded-2xl border p-4 text-sm" style={{ ...card, borderColor: late ? "color-mix(in oklab, #ef4444 50%, var(--t-card-border))" : "var(--t-card-border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><b>#{l.number} · {l.customer_name}</b><p className="text-xs" style={{ color: "var(--t-muted)" }}>{l.point} · {l.customer_phone ?? "sin celular"} · {l.created_by_name ?? ""}</p></div>
                    <span className="shrink-0 text-xs font-bold" style={{ color: late ? "#ef4444" : "var(--t-muted)" }}>{l.status === "open" ? (late ? `Venció hace ${-l.days_left} d` : `Hasta ${dmy(l.due_date)}`) : l.status === "delivered" ? "✅ Entregado" : l.status === "delivering" ? "Entregando…" : "Anulado"}</span>
                  </div>
                  <p className="mt-1 text-xs">{l.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--t-card-bg-soft)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8b5cf6,#10b981)" }} /></div>
                  <p className="mt-1 flex justify-between text-xs"><span>Abonado {money(l.paid)} de {money(l.total)}</span><b>{l.balance > 0 ? `Saldo ${money(l.balance)}` : "Pagado"}</b></p>
                  {l.payments.length ? <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>{l.payments.map((p) => `${dmy(p.at)}: ${money(p.amount)} ${METHODS[p.method] ?? p.method}`).join(" · ")}</p> : null}
                  {l.status === "open" || l.status === "delivering" ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {l.balance > 0 ? <button type="button" onClick={() => void pay(l)} className="rounded-lg px-3 py-1.5 font-bold text-white" style={{ background: "var(--t-cta)" }}>💵 Abonar</button> : null}
                      {l.balance <= 0 ? <Link href={`/dashboard/pos?apartado=${l.id}`} className="rounded-lg px-3 py-1.5 font-bold text-white" style={{ background: "#16a34a" }}>📦 Entregar</Link> : null}
                      {wa(l.customer_phone, "") ? <a href={wa(l.customer_phone, `Hola ${l.customer_name.split(" ")[0]}! Te recordamos tu apartado #${l.number} en ${store?.name}: saldo ${money(l.balance)}${l.days_left >= 0 ? `, te lo guardamos hasta el ${dmy(l.due_date)}` : ""}.`)!} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>💬 Recordar</a> : null}
                      {l.status === "open" ? <button type="button" onClick={() => void cancel(l)} className="rounded-lg px-3 py-1.5 font-semibold text-red-500">Anular</button> : null}
                    </div>
                  ) : l.order_token ? <a href={`/pedido/${l.order_token}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold underline">Ver la venta</a> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          {!quotes.length ? <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Aún no hay cotizaciones. En el POS arma el carrito y toca «📝 Cotizar»: se guarda y la compartes por WhatsApp.</p> : null}
          <div className="grid gap-3 md:grid-cols-2">
            {quotes.map((q) => {
              const url = typeof window !== "undefined" ? `${window.location.origin}/documento/cotizacion/${q.token}` : "";
              const link = wa(q.customer_phone, `Hola! Te comparto la cotización #${q.number} de ${store?.name} por ${money(q.total)}: ${url}`);
              return (
                <div key={q.id} className="rounded-2xl border p-4 text-sm" style={card}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><b>#{q.number} · {q.customer_name ?? "Sin nombre"}</b><p className="text-xs" style={{ color: "var(--t-muted)" }}>{dmy(q.created_at)} · {q.created_by_name ?? ""} · válida hasta {dmy(q.valid_until)}</p></div>
                    <span className="shrink-0 text-xs font-bold" style={{ color: q.status === "accepted" ? "#10b981" : q.status === "cancelled" || q.expired ? "#ef4444" : "var(--t-accent)" }}>{q.status === "accepted" ? "✅ Vendida" : q.status === "cancelled" ? "Anulada" : q.expired ? "Vencida" : "Abierta"}</span>
                  </div>
                  <p className="mt-1 text-xs">{q.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}</p>
                  <p className="mt-1 text-lg font-black">{money(q.total)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <a href={`/documento/cotizacion/${q.token}`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 font-semibold" style={{ borderColor: "var(--t-card-border)" }}>📄 Ver</a>
                    <a href={link ?? `https://wa.me/?text=${encodeURIComponent(`Cotización #${q.number} de ${store?.name}: ${url}`)}`} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 font-bold text-white" style={{ background: "#16a34a" }}>💬 Enviar</a>
                    {q.status === "open" ? <Link href={`/dashboard/pos?cotizacion=${q.id}`} className="rounded-lg px-3 py-1.5 font-bold text-white" style={{ background: "var(--t-cta)" }}>💳 Vender</Link> : null}
                    {q.status === "open" ? <button type="button" onClick={() => void cancelQuote(q)} className="rounded-lg px-3 py-1.5 font-semibold text-red-500">Anular</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
