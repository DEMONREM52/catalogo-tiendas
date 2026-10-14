"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, PiggyBank, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Chips, Stat, cardStyle, cop, fdate, label, n, periodWindow, rpcError, type Catalog, type Point } from "./shared";

type Ov = {
  expenses: { incurred: number; paid_in_period: number; open: number; overdue: number; overdue_count: number;
    by_category: Array<{ category_id: string; name: string; emoji: string; amount: number; n: number }>;
    by_point: Array<{ point_id: string | null; name: string; amount: number }> };
  upcoming: Array<{ id: string; number: number; description: string; payee_name: string | null; pending: number; due_on: string | null; emoji: string }>;
  payroll: { cost: number; net: number; employer: number; pending: number; runs: number; drafts: number; draft_cost: number } | null;
  budgets: Array<{ id: string; point_name: string | null; category_name: string | null; emoji: string | null; period: string; amount: number; spent: number; pct: number | null; start_on: string; end_on: string }>;
  gross_profit: number | null; net_profit: number | null; net_includes_payroll: boolean;
  funds: Array<{ name: string; target: number | null; balance: number }>;
};
type P = "weekly" | "biweekly" | "monthly" | "prev_month";
const PERIOD_TEXT: Record<string, string> = { weekly: "semana", biweekly: "quincena", monthly: "mes" };

/** Resumen: gastos, por pagar, nómina, presupuestos, reservas y ganancia neta estimada. */
export function Overview({ storeId, points, cat, onOpenExpense }: { storeId: string; points: Point[]; cat: Catalog; onOpenExpense: (id: string) => void }) {
  const [period, setPeriod] = useState<P>("monthly");
  const [pointId, setPointId] = useState("");
  const [ov, setOv] = useState<Ov | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, to] = periodWindow(period);
  const visible = cat.my_points ? points.filter((p) => cat.my_points!.includes(p.id)) : points;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabaseBrowser().rpc("erp_finance_overview", { p_store: storeId, p_point: pointId || null, p_from: from, p_to: to });
    setLoading(false);
    if (e) return setError(rpcError(e));
    setError(null);
    setOv(data as Ov);
  }, [storeId, pointId, from, to]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const ex = ov?.expenses;
  const maxCat = Math.max(1, ...(ex?.by_category ?? []).map((c) => n(c.amount)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chips value={period} onChange={setPeriod} options={[["weekly", "Esta semana"], ["biweekly", "Esta quincena"], ["monthly", "Este mes"], ["prev_month", "Mes anterior"]]} />
        {visible.length > 1 || cat.can.madre ? (
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className="rounded-full border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} aria-label="Punto">
            <option value="">{cat.can.madre ? "Toda la tienda" : "Mis puntos"}</option>
            {visible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>{fdate(from)} – {fdate(to)}</span>
        <button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Actualizar"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{error}</p> : null}

      {ov && ex ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Gastos del periodo" value={cop(ex.incurred)} sub={`${ex.by_category.reduce((s, c) => s + n(c.n), 0)} gastos`} info="Gastos causados (por su fecha), pagados o no. Sin anulados." />
            <Stat label="Pagado en el periodo" value={cop(ex.paid_in_period)} sub="salidas de dinero registradas" info="Pagos de gastos hechos en estas fechas (aunque el gasto sea de antes)." />
            <Stat label="Por pagar" value={cop(ex.open)} bad={n(ex.overdue) > 0} sub={n(ex.overdue) > 0 ? `${ex.overdue_count} vencido${ex.overdue_count === 1 ? "" : "s"} · ${cop(ex.overdue)}` : "nada vencido"} info="Saldo pendiente de todos los gastos abiertos." />
            {ov.payroll ? (
              <Stat label="Nómina del periodo" value={cop(ov.payroll.cost)} sub={ov.payroll.drafts ? `${ov.payroll.drafts} en borrador (${cop(ov.payroll.draft_cost)}) sin aprobar` : n(ov.payroll.pending) > 0 ? `por pagar ${cop(ov.payroll.pending)}` : "al día"} info="Costo de nóminas aprobadas (devengado + aportes del empleador) que terminan en estas fechas." />
            ) : (
              <Stat label="Reservas" value={cop(ov.funds.reduce((s, f) => s + n(f.balance), 0))} sub={`${ov.funds.length} fondo${ov.funds.length === 1 ? "" : "s"}`} info="Dinero apartado en reservas." />
            )}
          </div>

          {ov.net_profit !== null ? (
            <section className="rounded-2xl border p-4" style={{ ...cardStyle, borderColor: n(ov.net_profit) < 0 ? "rgba(230,103,103,.5)" : "var(--t-card-border)" }}>
              <p className={label} style={{ color: "var(--t-muted)" }}>Ganancia neta estimada</p>
              <p className="mt-1 text-3xl font-black tabular-nums" style={n(ov.net_profit) < 0 ? { color: "#e66767" } : undefined}>{cop(ov.net_profit)}</p>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                Ganancia de ventas {cop(ov.gross_profit)} − gastos {cop(ex.incurred)}{ov.payroll ? ` − nómina ${cop(ov.payroll.cost)}` : ""}. Solo ventas con costo guardado (desde que se activó Rentabilidad). No incluye impuestos de renta.
              </p>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border p-4" style={cardStyle}>
              <p className={`${label} mb-2 flex items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><CalendarClock size={13} /> Próximos pagos (30 días)</p>
              {ov.upcoming.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>🎉 Nada pendiente.</p>
              ) : (
                <ul className="space-y-1.5">
                  {ov.upcoming.map((u) => {
                    const late = u.due_on && u.due_on < new Date().toISOString().slice(0, 10);
                    return (
                      <li key={u.id}>
                        <button type="button" onClick={() => onOpenExpense(u.id)} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm" style={{ borderColor: late ? "rgba(230,103,103,.5)" : "var(--t-card-border)" }}>
                          <span className="text-lg">{u.emoji}</span>
                          <span className="min-w-0 flex-1">
                            <b className="block truncate">{u.description}</b>
                            <span className="text-[11px]" style={{ color: late ? "#e66767" : "var(--t-muted)" }}>{late ? "Vencido · " : "Vence "}{fdate(u.due_on)}{u.payee_name ? ` · ${u.payee_name}` : ""}</span>
                          </span>
                          <b className="tabular-nums">{cop(u.pending)}</b>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border p-4" style={cardStyle}>
              <p className={`${label} mb-2`} style={{ color: "var(--t-muted)" }}>Presupuestos (periodo actual)</p>
              {ov.budgets.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>Aún no hay presupuestos. Créalos en la pestaña Presupuestos.</p>
              ) : (
                <ul className="space-y-3">
                  {ov.budgets.map((b) => {
                    const pct = n(b.pct);
                    const color = pct >= 100 ? "#e66767" : pct >= 80 ? "#eda100" : "#22c55e";
                    return (
                      <li key={b.id}>
                        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <b className="min-w-0 flex-1 truncate">{b.emoji ?? "📊"} {b.category_name ?? "Total"} {b.point_name ? <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>· {b.point_name}</span> : null}</b>
                          <span className="tabular-nums text-xs">{cop(b.spent)} / {cop(b.amount)}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }} role="img" aria-label={`${pct} % usado`}>
                          <div className="h-full rounded-[4px]" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                        </div>
                        <p className="mt-0.5 text-[11px]" style={{ color: pct >= 80 ? color : "var(--t-muted)" }}>
                          {pct >= 100 ? <><AlertTriangle size={11} className="inline" /> Superado · </> : pct >= 80 ? "Casi al límite · " : ""}{pct.toLocaleString("es-CO")} % de la {PERIOD_TEXT[b.period]} ({fdate(b.start_on)} – {fdate(b.end_on)})
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border p-4" style={cardStyle}>
              <p className={`${label} mb-2`} style={{ color: "var(--t-muted)" }}>¿En qué se va la plata?</p>
              {ex.by_category.length === 0 ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sin gastos en el periodo.</p> : (
                <ul className="space-y-2">
                  {ex.by_category.map((c) => (
                    <li key={c.category_id}>
                      <div className="flex items-baseline gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{c.emoji} {c.name}</span><b className="tabular-nums">{cop(c.amount)}</b></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
                        <div className="h-full rounded-[4px]" style={{ width: `${Math.max(2, (n(c.amount) / maxCat) * 100)}%`, background: "#d95926" }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border p-4" style={cardStyle}>
              <p className={`${label} mb-2 flex items-center gap-1.5`} style={{ color: "var(--t-muted)" }}><PiggyBank size={13} /> Reservas y gastos por punto</p>
              {ov.funds.length ? (
                <ul className="mb-3 space-y-2">
                  {ov.funds.map((f) => (
                    <li key={f.name} className="text-sm">
                      <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate">🐷 {f.name}</span><b className="tabular-nums">{cop(f.balance)}</b>{f.target ? <span className="text-xs" style={{ color: "var(--t-muted)" }}>/ {cop(f.target)}</span> : null}</div>
                      {f.target ? <div className="mt-1 h-1.5 overflow-hidden rounded-[4px]" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}><div className="h-full rounded-[4px]" style={{ width: `${Math.min(100, (n(f.balance) / n(f.target)) * 100)}%`, background: "#3987e5" }} /></div> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-1 text-sm">
                {ex.by_point.map((p) => <li key={p.point_id ?? "madre"} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{p.point_id ? "📍" : "🏬"} {p.name}</span><b className="tabular-nums">{cop(p.amount)}</b></li>)}
              </ul>
            </section>
          </div>
        </>
      ) : loading ? <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} />)}</div> : null}
    </div>
  );
}
