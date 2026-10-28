"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileBarChart, Printer } from "lucide-react";
import { ExportGate } from "@/components/ExportGate";
import { ChoiceChips, DateField, PERIOD_LABEL, Sheet, cardStyle, cop, fail, fdate, ghostBtn, iso, periodWindow } from "./shared";
import { SOURCE, loadLoansReport, loansExcel, moves, payrollOn, people, printLoansReport, totals, type LoansReportData } from "./LoansReport";
import { upcoming, type PlanStep } from "./loanPlan";

/** Informe de vales: la nómina de una fecha, las próximas nóminas, por empleado y movimientos (con Excel e impresión). */

type View = "day" | "next" | "people" | "moves";
type Range = "month" | "prev" | "year" | "all";

function rangeOf(r: Range): [string, string] {
  if (r === "all") return ["", ""];
  if (r === "year") { const y = new Date().getFullYear(); return [`${y}-01-01`, `${y}-12-31`]; }
  return periodWindow(r === "prev" ? "prev_month" : "monthly");
}

function Badge({ step }: { step: PlanStep }) {
  const s = SOURCE[step.source];
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: s.color, background: `color-mix(in oklab, ${s.color} 14%, transparent)` }}>
      {s.label}{step.run_number ? ` · #${step.run_number}` : ""}
    </span>
  );
}

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border p-3" style={cardStyle}>
      <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
      {hint ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{hint}</p> : null}
    </div>
  );
}

export function LoansReportSheet({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [today] = useState(() => iso(new Date()));
  const [data, setData] = useState<LoansReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(today);
  const [range, setRange] = useState<Range>("month");
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLoansReport(storeId, today).then((d) => { if (alive) setData(d); }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [storeId, today]);

  const groups = useMemo(() => (data ? payrollOn(data, day) : []), [data, day]);
  const next = useMemo(() => (data ? upcoming(data.steps) : []), [data]);
  const ppl = useMemo(() => (data ? people(data) : []), [data]);
  const [from, to] = rangeOf(range);
  const mv = useMemo(() => (data ? moves(data, from, to) : []), [data, from, to]);
  const t = data ? totals(data) : null;
  const byId = useMemo(() => new Map((data?.loans ?? []).map((l) => [l.id, l])), [data]);
  const due = groups.reduce((s, g) => s + g.total, 0);
  const done = groups.reduce((s, g) => s + g.done, 0);
  const missing = groups.flatMap((g) => g.rows.filter((r) => r.step.source === "missing").map((r) => ({ g, ...r })));

  async function print() {
    if (!data) return;
    setBusy(true);
    try { await printLoansReport(storeId, data, day, from, to); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <Sheet wide title="Informe de vales y préstamos" icon={<FileBarChart size={18} />} onClose={onClose}
      subtitle={t ? `${t.active} vales activos · ${t.employees} empleados · saldo por cobrar ${cop(t.balance)}` : "Cargando…"}
      footer={<>
        <span className="flex-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Excel e impresión llevan todo: la nómina del {fdate(day)}, las próximas, por empleado, los vales y los movimientos.</span>
        <ExportGate><button type="button" disabled={!data} onClick={() => data && loansExcel(data, day, from, to)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Download size={13} /> Excel</button></ExportGate>
        <button type="button" disabled={!data || busy} onClick={() => void print()} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Printer size={13} /> Imprimir</button>
      </>}>
      {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : !data ? (
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>Calculando con las nóminas…</p>
      ) : (
        <div className="space-y-4">
          <ChoiceChips value={view} onChange={setView} options={[
            { value: "day", label: "📅 Nómina de una fecha" }, { value: "next", label: "📆 Próximas nóminas" },
            { value: "people", label: "👥 Por empleado" }, { value: "moves", label: "🧾 Movimientos" },
          ]} />

          {view === "day" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-44"><DateField value={day} onChange={(v) => v && setDay(v)} ariaLabel="Fecha de la nómina" /></div>
                {next.slice(0, 4).map((g) => (
                  <button key={g.date} type="button" onClick={() => setDay(g.date)} className={ghostBtn}
                    style={g.date === day ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                    {fdate(g.date)} · {cop(g.total)}
                  </button>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--t-muted)" }}>Se toma la nómina de cada empleado (semana, quincena o mes, según cada cuánto le pagan) que incluye ese día. Se paga el último día del periodo.</p>
              <div className="grid grid-cols-3 gap-2">
                <Box label="👥 Empleados" value={String(groups.length)} />
                <Box label="➖ Por descontar" value={cop(due)} hint="lo que falta restar en esa nómina" />
                <Box label="✅ Ya descontado" value={cop(done)} hint="en nóminas ya aprobadas" />
              </div>
              {missing.length ? (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-xs">
                  {missing.map(({ g, loan, step }) => (
                    <p key={loan.id}>⚠️ El vale <b>#{loan.number}</b> de <b>{g.name}</b> no está en la nómina <b>#{step.run_number}</b> (en borrador): se creó después de armarla y al aprobarla <b>no se descuenta</b>. Abre esa nómina, toca a {g.name.split(/\s+/)[0]} y dale «Guardar y recalcular».</p>
                  ))}
                </div>
              ) : null}
              {!groups.length ? (
                <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...cardStyle, color: "var(--t-muted)" }}>Ningún vale se descuenta en la nómina que incluye el {fdate(day)}.</p>
              ) : (
                <ul className="space-y-2">
                  {groups.map((g) => (
                    <li key={g.employee_id} className="rounded-2xl border p-3" style={cardStyle}>
                      <div className="flex items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <b className="block truncate">{g.name}</b>
                          <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{PERIOD_LABEL[g.frequency]} del {fdate(g.period[0])} al {fdate(g.period[1])} · se paga el {fdate(g.period[1])}</span>
                        </span>
                        <span className="shrink-0 text-right"><b className="block tabular-nums">{cop(g.total + g.done)}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{g.done && !g.total ? "ya descontado" : "a descontar"}</span></span>
                      </div>
                      <ul className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
                        {g.rows.map(({ loan, step }) => (
                          <li key={loan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="min-w-0 flex-1 truncate">#{loan.number} · {loan.description}</span>
                            {step.before !== null ? <span className="tabular-nums" style={{ color: "var(--t-muted)" }}>saldo {cop(step.before)} → {cop(step.after)}</span> : null}
                            <b className="tabular-nums">{cop(step.amount)}</b>
                            <Badge step={step} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Si lo que gana en esa nómina no alcanza, la nómina descuenta solo hasta lo devengado y el resto queda para la siguiente.</p>
            </div>
          ) : null}

          {view === "next" ? (
            !next.length ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...cardStyle, color: "var(--t-muted)" }}>No hay descuentos pendientes.</p> : (
              <ul className="space-y-2">
                {next.map((g) => {
                  const isOpen = openDate === g.date;
                  const who = new Set(g.steps.map((s) => s.employee_id)).size;
                  return (
                    <li key={g.date} className="rounded-2xl border p-3" style={cardStyle}>
                      <button type="button" onClick={() => setOpenDate(isOpen ? null : g.date)} className="flex w-full items-center gap-3 text-left" aria-expanded={isOpen}>
                        <span className="min-w-0 flex-1"><b>{fdate(g.date)}</b><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{who} empleado{who === 1 ? "" : "s"} · {g.steps.length} vale{g.steps.length === 1 ? "" : "s"}</span></span>
                        <b className="tabular-nums">{cop(g.total)}</b>
                        <ChevronDown size={16} className="shrink-0 transition" style={{ transform: isOpen ? "rotate(180deg)" : undefined }} />
                      </button>
                      {isOpen ? (
                        <ul className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: "var(--t-card-border)" }}>
                          {g.steps.map((s) => {
                            const l = byId.get(s.loan_id);
                            return (
                              <li key={`${s.loan_id}-${s.period_end}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                <span className="min-w-0 flex-1 truncate"><b>{l?.employee}</b> · #{l?.number} · {l?.description}</span>
                                {s.after !== null ? <span className="tabular-nums" style={{ color: "var(--t-muted)" }}>queda {cop(s.after)}</span> : null}
                                <b className="tabular-nums">{cop(s.amount)}</b>
                                {s.source !== "projected" ? <Badge step={s} /> : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}

          {view === "people" ? (
            !ppl.length ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...cardStyle, color: "var(--t-muted)" }}>Todavía no hay vales.</p> : (
              <ul className="space-y-2">
                {ppl.map((p) => (
                  <li key={p.employee_id} className="rounded-2xl border p-3" style={cardStyle}>
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <b className="block truncate">{p.name}</b>
                        <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                          {p.active} vale{p.active === 1 ? "" : "s"} activo{p.active === 1 ? "" : "s"}{p.paused ? ` (${p.paused} pausado${p.paused === 1 ? "" : "s"})` : ""} · le pagan {PERIOD_LABEL[p.frequency].toLowerCase()}
                          {p.balance > 0 ? ` · ${cop(p.perPayroll)} por nómina${p.finish ? ` · termina aprox. el ${fdate(p.finish)}` : ""}` : " · al día"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right"><b className="block tabular-nums">{cop(p.balance)}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>pagó {cop(p.paid)} de {cop(p.given)}</span></span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {view === "moves" ? (
            <div className="space-y-3">
              <ChoiceChips value={range} onChange={setRange} options={[{ value: "month", label: "Este mes" }, { value: "prev", label: "Mes pasado" }, { value: "year", label: "Este año" }, { value: "all", label: "Todo" }]} />
              {!mv.length ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...cardStyle, color: "var(--t-muted)" }}>Sin movimientos en esas fechas.</p> : (
                <ul className="divide-y rounded-2xl border" style={{ ...cardStyle }}>
                  {mv.map((m, i) => (
                    <li key={`${m.at}-${m.loan}-${i}`} className="flex items-center gap-3 px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)", opacity: m.voided ? 0.5 : 1 }}>
                      <span className="w-20 shrink-0 tabular-nums" style={{ color: "var(--t-muted)" }}>{fdate(m.at.slice(0, 10))}</span>
                      <span className="min-w-0 flex-1"><b>{m.employee}</b> · #{m.loan} · {m.kind}{m.voided ? ` · anulado (${m.voided})` : ""}</span>
                      <b className="tabular-nums" style={{ color: m.sign > 0 ? "#e66767" : "#16a34a" }}>{m.sign > 0 ? "+" : "−"}{cop(m.amount)}</b>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>+ lo que el empleado quedó debiendo (vale entregado) · − lo que pagó (descuento de nómina o abono).</p>
            </div>
          ) : null}

          {data.runsNote ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{data.runsNote}</p> : null}
        </div>
      )}
    </Sheet>
  );
}
