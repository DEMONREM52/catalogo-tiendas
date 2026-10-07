"use client";

import { useCallback, useMemo, useState } from "react";
import { useRunOnChange } from "../inventario/shared";
import { AlertTriangle, CalendarClock, Download, HandCoins, MessageCircle, RefreshCw, Search, TrendingUp, Users, Wallet } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";
import { askPayment } from "./StatementDrawer";
import { errorText, methodLabel, money, shortDate, waLink, type ThirdParty } from "./terceros";

type Item = {
  id: string; customer_id: string; customer: string; document: string | null; mobile: string | null; doc_number: string | null;
  description: string | null; total: number; balance: number; issue_date: string; due_date: string; late: number;
  point: string | null; order_token: string | null;
};
type Overview = {
  kpis: { open: number; open_count: number; overdue: number; overdue_count: number; due_soon: number; due_soon_count: number; current: number; customers: number };
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90: number };
  collected_30d: number;
  over_limit: Array<{ customer_id: string; name: string; limit: number; used: number }>;
  items: Item[];
  recent_payments: Array<{ id: string; amount: number; method: string; paid_at: string; customer: string; customer_id: string; doc_number: string | null; created_by_name: string | null; voided: boolean }>;
};

const AGING = [
  ["current", "Al día", "#22c55e"],
  ["d1_30", "1–30 días", "#f59e0b"],
  ["d31_60", "31–60 días", "#f97316"],
  ["d61_90", "61–90 días", "#ef4444"],
  ["d90", "+90 días", "#991b1b"],
] as const;

type Filter = "all" | "overdue" | "soon" | "current";

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${tone ?? "var(--t-accent)"} 16%, transparent)`, color: tone ?? "var(--t-accent)" }}>{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-xl font-black tabular-nums sm:text-2xl" style={{ color: tone && tone !== "#22c55e" ? tone : "var(--t-text)" }}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>{sub}</p> : null}
    </div>
  );
}

export function ReceivablesTab({
  storeId,
  storeName,
  canPay,
  parties,
  onOpenStatement,
  refreshKey,
}: {
  storeId: string;
  storeName: string;
  canPay: boolean;
  parties: ThirdParty[];
  onOpenStatement: (party: ThirdParty) => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabaseBrowser().rpc("erp_receivables_overview", { p_store: storeId });
    setLoading(false);
    if (err) return setError(errorText(err));
    setError(null);
    setData(res as Overview);
    // refreshKey: se vuelve a cargar cuando cambia la cartera en otra parte de la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, refreshKey]);

  useRunOnChange(load);

  const items = useMemo(() => {
    const list = (data?.items ?? []).filter((i) =>
      filter === "overdue" ? i.late > 0 : filter === "soon" ? i.late <= 0 && i.late >= -7 : filter === "current" ? i.late <= 0 : true);
    return smartFilter(list, q, (i) => `${i.customer} ${i.document ?? ""} ${i.doc_number ?? ""} ${i.point ?? ""}`, { keepOrder: true });
  }, [data, filter, q]);

  async function pay(item: Item) {
    const v = await askPayment(`Abono a ${item.doc_number ?? "documento"} · ${item.customer}`, item.balance, item.balance);
    if (!v) return;
    const { error: err } = await supabaseBrowser().rpc("erp_receivable_pay", { p_receivable: item.id, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_notes: null });
    if (err) return void Swal.fire({ icon: "error", title: "No se pudo registrar", text: errorText(err), background: "var(--t-bg-base)", color: "var(--t-text)" });
    void Swal.fire({ icon: "success", title: "Abono registrado", timer: 1200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
    void load();
  }

  function exportCsv() {
    const rows = [
      ["Cliente", "Documento cliente", "Documento", "Punto", "Emisión", "Vence", "Días de mora", "Total", "Saldo"],
      ...items.map((i) => [i.customer, i.document ?? "", i.doc_number ?? "", i.point ?? "", i.issue_date, i.due_date, String(Math.max(i.late, 0)), String(i.total), String(i.balance)]),
    ];
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cartera-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p>;
  }
  if (!data) return <div className="h-64 animate-pulse rounded-3xl" style={{ background: "var(--t-card-bg)" }} />;

  const totalAging = AGING.reduce((s, [k]) => s + Number(data.aging[k]), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Wallet size={15} />} label="Cartera total" value={money(data.kpis.open)} sub={`${data.kpis.open_count} documentos`} />
        <Kpi icon={<AlertTriangle size={15} />} label="Vencida" value={money(data.kpis.overdue)} sub={`${data.kpis.overdue_count} documentos`} tone="#ef4444" />
        <Kpi icon={<CalendarClock size={15} />} label="Vence en 7 días" value={money(data.kpis.due_soon)} sub={`${data.kpis.due_soon_count} documentos`} tone="#f59e0b" />
        <Kpi icon={<Wallet size={15} />} label="Al día" value={money(data.kpis.current)} tone="#22c55e" />
        <Kpi icon={<TrendingUp size={15} />} label="Recaudado 30 días" value={money(data.collected_30d)} tone="#0ea5e9" />
        <Kpi icon={<Users size={15} />} label="Clientes con deuda" value={String(data.kpis.customers)} />
      </div>

      <section className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Edades de la cartera</h3>
          <button type="button" onClick={() => { setLoading(true); void load(); }} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
        <div className="mt-3 flex h-4 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
          {totalAging > 0 ? AGING.map(([k, , color]) => (
            <div key={k} className="h-full transition-[width] duration-700" style={{ width: `${(Number(data.aging[k]) / totalAging) * 100}%`, background: color }} title={money(data.aging[k])} />
          )) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AGING.map(([k, label, color]) => (
            <div key={k} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
              </p>
              <p className="text-sm font-black tabular-nums">{money(data.aging[k])}</p>
            </div>
          ))}
        </div>
      </section>

      {data.over_limit.length ? (
        <section className="rounded-3xl border p-4" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)", background: "color-mix(in oklab, #ef4444 7%, transparent)" }}>
          <h3 className="flex items-center gap-2 text-sm font-bold text-red-400"><AlertTriangle size={15} /> Clientes sobre su cupo</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.over_limit.map((o) => (
              <button key={o.customer_id} type="button" onClick={() => { const p = byId.get(o.customer_id); if (p) onOpenStatement(p); }} className="rounded-xl border px-3 py-1.5 text-left text-xs" style={{ borderColor: "color-mix(in oklab, #ef4444 40%, transparent)" }}>
                <b>{o.name}</b> · debe {money(o.used)} de {money(o.limit)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["all", `Todas (${data.items.length})`],
              ["overdue", `🔴 Vencidas (${data.items.filter((i) => i.late > 0).length})`],
              ["soon", `🟠 Vencen en 7 días (${data.items.filter((i) => i.late <= 0 && i.late >= -7).length})`],
              ["current", `🟢 Al día (${data.items.filter((i) => i.late <= 0).length})`],
            ] as Array<[Filter, string]>).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-3 py-1.5 text-xs font-semibold transition" style={filter === k ? { background: "var(--t-accent)", borderColor: "transparent", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
              <input className="w-full rounded-xl border py-2 pr-3 text-sm outline-none" style={{ paddingLeft: "2.1rem", borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o documento…" />
            </div>
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              <Download size={14} /> Excel
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            {data.items.length ? "Nada coincide con el filtro." : "🎉 No hay cartera pendiente."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
            <table className="w-full min-w-[760px] text-sm">
              <thead style={{ color: "var(--t-muted)" }}>
                <tr className="text-left text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Documento</th><th className="px-3 py-2">Vence</th>
                  <th className="px-3 py-2">Estado</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const party = byId.get(i.customer_id);
                  const wa = waLink(i.mobile, `Hola ${i.customer.split(" ")[0]}, te recordamos el saldo de ${money(i.balance)} del documento ${i.doc_number ?? ""} con ${storeName}${i.late > 0 ? `, vencido desde el ${shortDate(i.due_date)}` : `, que vence el ${shortDate(i.due_date)}`}. ¡Gracias!`);
                  return (
                    <tr key={i.id} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                      <td className="px-3 py-2.5">
                        <button type="button" className="text-left font-semibold hover:underline" onClick={() => party && onOpenStatement(party)}>{i.customer}</button>
                        {i.document ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{i.document}</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {i.order_token ? <a className="font-semibold hover:underline" href={`/pedido/${i.order_token}`} target="_blank" rel="noreferrer">{i.doc_number ?? "—"}</a> : (i.doc_number ?? i.description ?? "Saldo")}
                        <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{shortDate(i.issue_date)}{i.point ? ` · ${i.point}` : ""}</span>
                      </td>
                      <td className="px-3 py-2.5">{shortDate(i.due_date)}</td>
                      <td className="px-3 py-2.5">
                        {i.late > 0 ? (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">{i.late} día{i.late === 1 ? "" : "s"} de mora</span>
                        ) : i.late >= -7 ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{i.late === 0 ? "Vence hoy" : `Vence en ${-i.late} día${i.late === -1 ? "" : "s"}`}</span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">Al día</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <b className="tabular-nums">{money(i.balance)}</b>
                        {i.balance !== i.total ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>de {money(i.total)}</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {canPay ? (
                            <button type="button" onClick={() => void pay(i)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "color-mix(in oklab, #22c55e 45%, transparent)", color: "#22c55e" }}>
                              <HandCoins size={13} /> Abonar
                            </button>
                          ) : null}
                          {wa ? (
                            <a href={wa} target="_blank" rel="noreferrer" className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} title="Recordar por WhatsApp" aria-label="Recordar por WhatsApp">
                              <MessageCircle size={13} />
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.recent_payments.length ? (
        <section className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
          <h3 className="font-bold">Abonos recientes</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.recent_payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", opacity: p.voided ? 0.5 : 1 }}>
                <span className="min-w-0">
                  <b className="block truncate">{p.customer}</b>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>{new Date(p.paid_at).toLocaleDateString("es-CO")} · {methodLabel(p.method)}{p.doc_number ? ` · ${p.doc_number}` : ""}</span>
                </span>
                <b className="shrink-0 tabular-nums" style={{ color: p.voided ? "var(--t-muted)" : "#22c55e", textDecoration: p.voided ? "line-through" : undefined }}>{money(p.amount)}</b>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
