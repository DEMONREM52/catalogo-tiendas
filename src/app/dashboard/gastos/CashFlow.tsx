"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ddmmyyyy } from "@/components/forms/Fields";
import { MoneyInput } from "../MoneyInput";
import { cardStyle } from "./shared";

/**
 * Flujo de caja de los próximos 30 días (erp_cash_flow, 20261328). Solo el dueño o el administrador.
 * Entra: ventas promedio (4 semanas, por día de la semana) + cartera que vence. Sale: proveedores, gastos
 * (registrados y fijos por generar) y nómina (pendiente, borrador o estimada con el salario base).
 * La «plata disponible hoy» la escribe la persona y solo se guarda en este equipo.
 */

type Day = { day: string; in_sales: number; in_receivables: number; out_payables: number; out_expenses: number; out_payroll: number };
type Item = { name: string; due: string; amount: number; fixed?: boolean; estimated?: boolean; no_date?: boolean };
type Flow = {
  ok: boolean; message?: string; from: string; to: string;
  sales_basis: { from: string; to: string; by_weekday: Array<{ dow: number; avg: number }> };
  days: Day[];
  overdue: { receivables: number; payables: number; expenses: number; payroll: number };
  items: { payables: Item[]; expenses: Item[]; payroll: Item[]; receivables: Item[] };
};

const cop = (n: number) => `$ ${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
const DOW = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const dayName = (iso: string) => DOW[((new Date(`${iso}T12:00:00`).getDay() + 6) % 7) + 1];

export function CashFlowTab({ storeId }: { storeId: string }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `remhub:cashflow-start:${storeId}`;
  const [start, setStart] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { const v = window.localStorage.getItem(key); if (v) setStart(Number(v)); } catch { /* sin almacenamiento */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [key]);
  const [withSales, setWithSales] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("erp_cash_flow", { p_store: storeId, p_days: 30 }).then(({ data, error: e }) => {
      if (!alive) return;
      const d = data as Flow | null;
      if (e) setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta correr la migración 20261328_flujo_de_caja.sql en Supabase." : e.message);
      else if (!d?.ok) setError(d?.message ?? "No se pudo calcular.");
      else setFlow(d);
    });
    return () => { alive = false; };
  }, [storeId]);

  useEffect(() => {
    if (!loaded) return;
    try { if (start === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, String(start)); } catch { /* sin almacenamiento */ }
  }, [key, start, loaded]);

  const rows = useMemo(() => {
    if (!flow) return [];
    let bal = start ?? 0;
    return flow.days.map((d) => {
      const inn = (withSales ? Number(d.in_sales) : 0) + Number(d.in_receivables);
      const out = Number(d.out_payables) + Number(d.out_expenses) + Number(d.out_payroll);
      bal += inn - out;
      return { ...d, inn, out, bal };
    });
  }, [flow, start, withSales]);

  if (error) return <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>{error}</p>;
  if (!flow) return <p className="rounded-2xl border p-4 text-sm" style={cardStyle}>Calculando…</p>;

  const sum = (f: (d: Day) => number) => flow.days.reduce((s, d) => s + Number(f(d)), 0);
  const totalSales = sum((d) => d.in_sales), totalRecv = sum((d) => d.in_receivables);
  const totalPay = sum((d) => d.out_payables), totalExp = sum((d) => d.out_expenses), totalPayroll = sum((d) => d.out_payroll);
  const totalIn = (withSales ? totalSales : 0) + totalRecv, totalOut = totalPay + totalExp + totalPayroll;
  const od = flow.overdue;
  const overdueOut = Number(od.payables) + Number(od.expenses) + Number(od.payroll);
  const firstRed = rows.find((r) => r.bal < 0);
  const lowest = rows.reduce((m, r) => (r.bal < m.bal ? r : m), rows[0]);
  const list = (title: string, k: keyof Flow["items"], color: string) => {
    const items = flow.items[k];
    if (!items.length) return null;
    return (
      <div className="rounded-2xl border" style={cardStyle}>
        <button type="button" onClick={() => setOpen(open === k ? null : k)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-bold">
          <span>{title} <span style={{ color: "var(--t-muted)" }}>({items.length})</span></span>
          <span style={{ color }}>{cop(items.reduce((s, i) => s + Number(i.amount), 0))} {open === k ? "▲" : "▼"}</span>
        </button>
        {open === k ? (
          <ul className="border-t px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
            {items.map((i, n) => (
              <li key={n} className="flex justify-between gap-2 py-1">
                <span className="min-w-0">
                  <b>{i.name}</b>{i.fixed ? " · gasto fijo" : ""}{i.estimated ? " · estimada" : ""}{i.no_date ? " · sin fecha (cuenta para hoy)" : ""}
                  <span className="block" style={{ color: i.due < flow.from ? "#e5484d" : "var(--t-muted)" }}>{i.due < flow.from ? "Vencida el " : ""}{ddmmyyyy(i.due)}</span>
                </span>
                <span className="shrink-0 font-bold tabular-nums">{cop(i.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={cardStyle}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs font-bold">💵 Plata disponible hoy (caja + bancos)
            <MoneyInput className="mt-1 w-48 rounded-xl border px-3 py-2 text-right text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" }}
              ariaLabel="Plata disponible hoy" value={start ?? 0} onValueChange={(v) => setStart(v === null || v === undefined ? null : v)} />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={withSales} onChange={(e) => setWithSales(e.target.checked)} /> Contar las ventas estimadas
          </label>
          <p className="min-w-0 flex-1 text-[11px]" style={{ color: "var(--t-muted)" }}>
            Del {ddmmyyyy(flow.from)} al {ddmmyyyy(flow.to)}. Ventas estimadas con lo vendido del {ddmmyyyy(flow.sales_basis.from)} al {ddmmyyyy(flow.sales_basis.to)}, día por día de la semana (÷ 4). La plata disponible solo se guarda en este equipo.
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>ENTRA</p>
            <p className="text-xl font-black tabular-nums" style={{ color: "#10b981" }}>{cop(totalIn)}</p>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Ventas estimadas {cop(totalSales)}{withSales ? "" : " (sin contar)"} · Cartera {cop(totalRecv)}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>SALE</p>
            <p className="text-xl font-black tabular-nums" style={{ color: "#e5484d" }}>{cop(totalOut)}</p>
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Proveedores {cop(totalPay)} · Gastos {cop(totalExp)} · Nómina {cop(totalPayroll)}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: firstRed ? "#e5484d" : "var(--t-card-border)" }}>
            <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{start === null ? "DIFERENCIA EN 30 DÍAS" : "TE QUEDARÍA EN 30 DÍAS"}</p>
            <p className="text-xl font-black tabular-nums" style={{ color: rows[rows.length - 1]?.bal < 0 ? "#e5484d" : "var(--t-text)" }}>{cop(rows[rows.length - 1]?.bal ?? 0)}</p>
            <p className="text-[11px] font-bold" style={{ color: firstRed ? "#e5484d" : "#10b981" }}>
              {firstRed ? `⚠️ Te faltaría plata desde el ${dayName(firstRed.day)} ${ddmmyyyy(firstRed.day)} (lo más bajo: ${cop(lowest.bal)} el ${ddmmyyyy(lowest.day)})` : start === null ? "Escribe la plata disponible para ver si alcanza día a día." : "✓ Alcanza todos los días"}
            </p>
          </div>
        </div>
        {overdueOut > 0 || Number(od.receivables) > 0 ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, #f59e0b 45%, var(--t-card-border))" }}>
            ⏰ <b>Vencido (no está en los días porque no se sabe cuándo se paga):</b> te toca pagar {cop(overdueOut)} (proveedores {cop(od.payables)}, gastos {cop(od.expenses)}, nómina {cop(od.payroll)}) y te deben {cop(od.receivables)} de cartera.
          </p>
        ) : null}
      </section>

      <div className="grid gap-2 md:grid-cols-2">
        {list("🏭 Proveedores", "payables", "#e5484d")}
        {list("💸 Gastos", "expenses", "#e5484d")}
        {list("👥 Nómina", "payroll", "#e5484d")}
        {list("🤝 Cartera que vence", "receivables", "#10b981")}
      </div>

      <section className="overflow-auto rounded-2xl border" style={cardStyle}>
        <table className="rt w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--t-muted)" }}>
              <th className="px-3 py-2">Día</th><th className="px-2 text-right">Ventas est.</th><th className="px-2 text-right">Cartera</th>
              <th className="px-2 text-right">Proveedores</th><th className="px-2 text-right">Gastos</th><th className="px-2 text-right">Nómina</th><th className="px-3 text-right">{start === null ? "Acumulado" : "Saldo"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t" style={{ borderColor: "var(--t-card-border)", background: r.bal < 0 ? "color-mix(in oklab, #e5484d 8%, transparent)" : undefined }}>
                <td className="px-3 py-1.5" data-label="Día"><b className="capitalize">{dayName(r.day)}</b> {ddmmyyyy(r.day)}</td>
                <td className="px-2 text-right tabular-nums" data-label="Ventas est." style={{ color: withSales ? "#10b981" : "var(--t-muted)" }}>{Number(r.in_sales) ? cop(r.in_sales) : "—"}</td>
                <td className="px-2 text-right tabular-nums" data-label="Cartera" style={{ color: "#10b981" }}>{Number(r.in_receivables) ? cop(r.in_receivables) : "—"}</td>
                <td className="px-2 text-right tabular-nums" data-label="Proveedores" style={{ color: "#e5484d" }}>{Number(r.out_payables) ? cop(r.out_payables) : "—"}</td>
                <td className="px-2 text-right tabular-nums" data-label="Gastos" style={{ color: "#e5484d" }}>{Number(r.out_expenses) ? cop(r.out_expenses) : "—"}</td>
                <td className="px-2 text-right tabular-nums" data-label="Nómina" style={{ color: "#e5484d" }}>{Number(r.out_payroll) ? cop(r.out_payroll) : "—"}</td>
                <td className="px-3 text-right font-black tabular-nums" data-label={start === null ? "Acumulado" : "Saldo"} style={{ color: r.bal < 0 ? "#e5484d" : "var(--t-text)" }}>{cop(r.bal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
        Es una proyección: las ventas son un promedio y la nómina sin liquidar se estima con el salario base. Los gastos fijos salen en la fecha en que se pagan.
      </p>
    </div>
  );
}
