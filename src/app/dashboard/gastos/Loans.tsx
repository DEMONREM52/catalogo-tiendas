"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Banknote, HandCoins, Pause, Play, Plus, Printer, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  ChoiceChips, DateField, Field, MoneyField, NumberField, PaymentSheet, Sheet, ask, cardStyle, cop, done, esc, fail, fdate, ghostBtn, inputStyle, iso, n,
  PERIOD_LABEL, primaryBg, primaryBtn, swalTheme, type Catalog, type Employee, type Period, type Point,
} from "./shared";

/**
 * Vales y préstamos a empleados (20261240): productos que se lleva (salen del inventario) o dinero prestado
 * (puede salir de la caja), en cuotas que se descuentan solas en cada nómina, con interés opcional.
 */

type Payment = { id: string; amount: number; source: "payroll" | "manual"; method: string | null; note: string | null; paid_at: string; by: string | null; voided: boolean; void_reason: string | null; run_number: number | null };
type Loan = {
  id: string; number: number; employee_id: string; employee: string; document: string | null; position: string | null; pay_frequency: Period; base_salary: number;
  point_id: string | null; point: string | null; kind: "product" | "cash"; description: string; items: Array<{ product_id: string; name: string; sku: string | null; qty: number; price: number }>;
  principal: number; interest_mode: "none" | "total" | "monthly"; interest_pct: number; interest: number; total: number; installments: number; installment: number;
  start_on: string; balance: number; status: "active" | "paid" | "void"; paused: boolean; from_cash: boolean; notes: string | null; created_by_name: string | null;
  created_at: string; void_reason: string | null; paid_count: number; payments: Payment[];
};
type Prod = { id: string; name: string; sku: string | null; price_1: number | null; price_3: number | null; image_url: string | null };

const PER_MONTH: Record<Period, number> = { weekly: 30 / 7, biweekly: 2, monthly: 1 };
const PERIOD_ONE: Record<Period, string> = { weekly: "semana", biweekly: "quincena", monthly: "mes" };

/** Fechas aproximadas de cada cuota según cada cuánto le pagan (desde «empieza a descontar»). */
function schedule(start: string, kind: Period, count: number) {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00`);
  for (let i = 0; i < Math.min(count, 60); i++) {
    const x = new Date(d);
    if (kind === "weekly") x.setDate(d.getDate() + 7 * i);
    else if (kind === "monthly") x.setMonth(d.getMonth() + i);
    else { x.setMonth(d.getMonth() + Math.floor((i + (d.getDate() > 15 ? 1 : 0)) / 2)); x.setDate(((i + (d.getDate() > 15 ? 1 : 0)) % 2) ? 28 : 15); }
    out.push(iso(x));
  }
  return out;
}

export function LoansTab({ storeId, points, cat, onChanged }: { storeId: string; points: Point[]; cat: Catalog; onChanged: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Loan | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("erp_employee_loans_list", { p_store: storeId });
    if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261240_vales_empleados.sql." : e.message);
    const r = data as { ok: boolean; error?: string; loans?: Loan[] };
    if (!r.ok) return setError(r.error ?? "No se pudo cargar.");
    setError(null);
    setLoans(r.loans ?? []);
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  const after = async () => { await load(); onChanged(); };

  const shown = (loans ?? []).filter((l) => (filter === "all" || l.status === "active") && (!q.trim() || `${l.employee} ${l.description} #${l.number}`.toLowerCase().includes(q.trim().toLowerCase())));
  const active = (loans ?? []).filter((l) => l.status === "active");
  const owed = active.reduce((s, l) => s + n(l.balance), 0);
  const people = new Set(active.map((l) => l.employee_id)).size;

  async function togglePause(l: Loan) {
    const { error: e } = await supabaseBrowser().rpc("erp_employee_loan_pause", { p_loan: l.id, p_paused: !l.paused });
    if (e) return fail(e);
    done(l.paused ? "Se vuelve a descontar" : "Pausado: no se descuenta hasta que lo reanudes");
    await after();
  }
  async function voidLoan(l: Loan) {
    const reason = await ask(`¿Por qué anulas el vale #${l.number}?`);
    if (!reason) return;
    const { data, error: e } = await supabaseBrowser().rpc("erp_employee_loan_void", { p_loan: l.id, p_reason: reason });
    if (e) return fail(e);
    const r = data as { cash_back?: boolean; needs_cash_back?: boolean };
    await Swal.fire({ ...swalTheme, icon: "success", title: "Vale anulado", text: l.kind === "product" ? "Los productos volvieron al inventario del punto." : r.cash_back ? "El dinero volvió a la caja del punto." : r.needs_cash_back ? "La caja del punto está cerrada: registra la devolución del dinero cuando la abras." : "" });
    await after();
  }
  async function voidPayment(p: Payment) {
    const reason = await ask("¿Por qué anulas este abono?");
    if (!reason) return;
    const { error: e } = await supabaseBrowser().rpc("erp_employee_loan_payment_void", { p_payment: p.id, p_reason: reason });
    if (e) return fail(e);
    await after();
  }
  async function pay(l: Loan, p: { amount: number; method: string; ref: string; key: string }) {
    const call = (toCash: boolean) => supabaseBrowser().rpc("erp_employee_loan_pay", { p_loan: l.id, p_amount: p.amount, p_method: p.method, p_note: p.ref || null, p_to_cash: toCash, p_key: p.key });
    let { error: e } = await call(p.method === "cash");
    if (e && /caja/i.test(e.message)) {
      const r = await Swal.fire({ ...swalTheme, icon: "question", title: "La caja del punto está cerrada", text: "¿Registro el abono sin que entre a la caja?", showCancelButton: true, confirmButtonText: "Sí, registrar", cancelButtonText: "No" });
      if (!r.isConfirmed) return false;
      ({ error: e } = await call(false));
    }
    if (e) { fail(e); return false; }
    done("Abono registrado");
    await after();
  }
  function printVoucher(l: Loan) {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const dates = schedule(l.start_on, l.pay_frequency, l.installments);
    const rows = dates.map((d, i) => `<tr><td>${i + 1}</td><td>${fdate(d)}</td><td style="text-align:right">${cop(i === dates.length - 1 ? n(l.total) - n(l.installment) * (dates.length - 1) : n(l.installment))}</td></tr>`).join("");
    const items = l.kind === "product" ? `<table><tr><th>Producto</th><th>Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr>${l.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td style="text-align:right">${cop(i.price)}</td><td style="text-align:right">${cop(i.qty * i.price)}</td></tr>`).join("")}</table>` : "";
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vale #${l.number}</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px;margin:24px auto;padding:0 16px;font-size:13px}
      h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #ddd;padding:5px;text-align:left}
      .big{font-size:16px;font-weight:700}.sign{display:flex;gap:30px;margin-top:60px}.sign div{flex:1;border-top:1px solid #111;padding-top:6px;text-align:center}
      @media print{button{display:none}}</style></head><body>
      <h1>${l.kind === "product" ? "Vale de mercancía" : "Préstamo"} #${l.number}</h1>
      <p>${esc(fdate(l.created_at.slice(0, 10)))} · ${esc(l.point ?? "")}</p>
      <p><b>Empleado:</b> ${esc(l.employee)}${l.document ? ` · Doc. ${esc(l.document)}` : ""}${l.position ? ` · ${esc(l.position)}` : ""}</p>
      ${items}
      <p>Valor: <b>${cop(l.principal)}</b>${n(l.interest) ? ` · Interés: <b>${cop(l.interest)}</b> (${l.interest_pct} % ${l.interest_mode === "monthly" ? "mensual" : "total"})` : ""}</p>
      <p class="big">Total a descontar: ${cop(l.total)} en ${l.installments} cuota${l.installments === 1 ? "" : "s"} de ${cop(l.installment)} (${PERIOD_LABEL[l.pay_frequency].toLowerCase()})</p>
      <table><tr><th>Cuota</th><th>Fecha aprox.</th><th style="text-align:right">Valor</th></tr>${rows}</table>
      <p>Yo, ${esc(l.employee)}, autorizo de manera libre y voluntaria que el valor de este ${l.kind === "product" ? "vale" : "préstamo"} me sea descontado de mi salario en las cuotas indicadas. Si mi contrato termina antes de completar el pago, autorizo que el saldo pendiente se descuente de mi liquidación.</p>
      ${l.notes ? `<p><b>Notas:</b> ${esc(l.notes)}</p>` : ""}
      <div class="sign"><div>Firma del empleado<br/>${esc(l.employee)}</div><div>Firma de quien entrega<br/>${esc(l.created_by_name ?? "")}</div></div>
      <p style="margin-top:30px"><button onclick="window.print()">🖨️ Imprimir</button></p></body></html>`);
    w.document.close();
  }

  if (error) return <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p>;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["🧾 Vales activos", String(active.length)], ["👥 Empleados con vales", String(people)], ["💰 Por descontar", cop(owed)], ["📅 Cuotas por nómina", cop(active.filter((l) => !l.paused).reduce((s, l) => s + Math.min(n(l.installment), n(l.balance)), 0))]] as const).map(([l, v]) => (
          <div key={l} className="rounded-2xl border p-3" style={cardStyle}><p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{l}</p><p className="text-lg font-black tabular-nums">{v}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empleado o vale…" className="w-full rounded-full border py-2 pl-9 pr-3 text-sm outline-none" style={inputStyle} />
        </div>
        <ChoiceChips value={filter} onChange={setFilter} options={[{ value: "active", label: "Activos" }, { value: "all", label: "Todos" }]} />
        {cat.can.payroll ? <button type="button" onClick={() => setCreating(true)} className={primaryBtn} style={primaryBg}><Plus size={15} /> Nuevo vale</button> : null}
      </div>
      <p className="text-xs" style={{ color: "var(--t-muted)" }}>Las cuotas se descuentan solas en cada nómina del empleado. Al <b>aprobar</b> la nómina se cobran; si la vuelves a borrador, el saldo vuelve. En la nómina en borrador puedes cambiar o saltar la cuota de esa vez.</p>

      {loans === null ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p> : !shown.length ? (
        <p className="rounded-2xl border p-6 text-center text-sm" style={{ ...cardStyle, color: "var(--t-muted)" }}>{filter === "active" ? "No hay vales activos." : "Todavía no hay vales."}{cat.can.payroll ? " Toca «Nuevo vale» para darle productos o un préstamo a un empleado." : ""}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((l) => {
            const paid = n(l.total) - n(l.balance);
            const pct = n(l.total) ? Math.round((paid / n(l.total)) * 100) : 0;
            const isOpen = openId === l.id;
            const left = Math.ceil(n(l.balance) / Math.max(1, n(l.installment)));
            return (
              <li key={l.id} className="rounded-2xl border p-3" style={{ ...cardStyle, opacity: l.status === "void" ? 0.6 : 1 }}>
                <button type="button" onClick={() => setOpenId(isOpen ? null : l.id)} className="flex w-full items-start gap-3 text-left">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white" style={{ background: l.kind === "product" ? "linear-gradient(135deg,#8b5cf6,#ec4899)" : "linear-gradient(135deg,#22c55e,#3987e5)" }}>{l.kind === "product" ? <ShoppingBag size={17} /> : <Banknote size={17} />}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{l.employee} · #{l.number}</b>
                    <span className="block truncate text-xs" style={{ color: "var(--t-muted)" }}>{l.description}</span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: l.status === "void" ? "#94a3b8" : "#22c55e" }} /></span>
                    <span className="mt-1 block text-[11px]" style={{ color: "var(--t-muted)" }}>
                      {l.status === "void" ? `🚫 Anulado: ${l.void_reason ?? ""}` : l.status === "paid" ? "✅ Pagado" : `${l.paused ? "⏸️ Pausado · " : ""}cuota ${cop(l.installment)} por ${PERIOD_ONE[l.pay_frequency]} · faltan ~${left} · desde ${fdate(l.start_on)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right"><b className="block tabular-nums">{cop(l.balance)}</b><span className="text-[11px]" style={{ color: "var(--t-muted)" }}>de {cop(l.total)}</span></span>
                </button>
                {isOpen ? (
                  <div className="mt-3 space-y-2 border-t pt-3 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                    {l.kind === "product" ? <ul className="text-xs">{l.items.map((i) => <li key={i.product_id}>• {i.qty} × {i.name} a {cop(i.price)}</li>)}</ul> : null}
                    <p className="text-xs" style={{ color: "var(--t-muted)" }}>
                      Valor {cop(l.principal)}{n(l.interest) ? ` + interés ${cop(l.interest)} (${l.interest_pct} % ${l.interest_mode === "monthly" ? "mensual" : "total"})` : " · sin interés"} · {l.installments} cuotas · {l.point ?? "sin punto"}{l.from_cash ? " · salió de la caja" : ""} · dio {l.created_by_name ?? "—"} el {fdate(l.created_at.slice(0, 10))}
                    </p>
                    {l.notes ? <p className="text-xs">📝 {l.notes}</p> : null}
                    {l.payments.length ? (
                      <ul className="space-y-1 text-xs">
                        {l.payments.map((p) => (
                          <li key={p.id} className="flex items-center gap-2" style={{ opacity: p.voided ? 0.5 : 1 }}>
                            <span className="min-w-0 flex-1">{fdate(p.paid_at.slice(0, 10))} · {p.source === "payroll" ? `Nómina #${p.run_number ?? ""}` : `Abono ${p.method === "cash" ? "en efectivo" : p.method ?? ""}`}{p.note && p.source === "manual" ? ` · ${p.note}` : ""}{p.voided ? ` · anulado (${p.void_reason ?? ""})` : ""}</span>
                            <b className="tabular-nums">{cop(p.amount)}</b>
                            {!p.voided && p.source === "manual" && cat.can.payroll_approve ? <button type="button" onClick={() => void voidPayment(p)} className="opacity-60 hover:opacity-100" title="Anular abono"><X size={13} /></button> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs" style={{ color: "var(--t-muted)" }}>Sin descuentos todavía.</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" onClick={() => printVoucher(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Printer size={13} /> Vale para firmar</button>
                      {l.status === "active" && (cat.can.payroll || cat.can.payroll_pay) ? <button type="button" onClick={() => setPaying(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><HandCoins size={13} /> Abonar</button> : null}
                      {l.status === "active" && cat.can.payroll ? <button type="button" onClick={() => void togglePause(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}>{l.paused ? <><Play size={13} /> Reanudar</> : <><Pause size={13} /> Pausar descuentos</>}</button> : null}
                      {l.status !== "void" && cat.can.payroll_approve && !l.paid_count ? <button type="button" onClick={() => void voidLoan(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)", color: "#e66767" }}><Trash2 size={13} /> Anular</button> : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {creating ? <LoanForm storeId={storeId} points={points} employees={(cat.employees ?? []).filter((e) => e.active)} onClose={() => setCreating(false)} onSaved={async (l) => { setCreating(false); await after(); if (l) setOpenId(l); }} /> : null}
      <PaymentSheet open={!!paying} title={paying ? `Abono al vale #${paying.number}` : ""} who={paying ? <b>{paying.employee}</b> : null} pending={n(paying?.balance)} defaultMethod="cash"
        hint="Si es en efectivo, entra a la caja abierta del punto." onClose={() => setPaying(null)}
        onConfirm={async (p) => { if (!paying) return false; const r = await pay(paying, p); if (r !== false) setPaying(null); return r; }} />
    </section>
  );
}

function LoanForm({ storeId, points, employees, onClose, onSaved }: { storeId: string; points: Point[]; employees: Employee[]; onClose: () => void; onSaved: (id: string | null) => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<"product" | "cash">("product");
  const [pointId, setPointId] = useState("");
  const [items, setItems] = useState<Array<{ product: Prod; qty: number; price: number }>>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [fromCash, setFromCash] = useState(true);
  const [installments, setInstallments] = useState<number | null>(2);
  const [mode, setMode] = useState<"none" | "total" | "monthly">("none");
  const [pct, setPct] = useState<number | null>(null);
  const [start, setStart] = useState(() => iso(new Date()));
  const [notes, setNotes] = useState("");
  const [desc, setDesc] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Prod[]>([]);
  const [priceLevel, setPriceLevel] = useState<"price_1" | "price_3">("price_1");
  const [saving, setSaving] = useState(false);

  const emp = employees.find((e) => e.id === employeeId) ?? null;
  // Por defecto el punto del empleado.
  useEffect(() => { if (emp?.point_id && !pointId) { const t = window.setTimeout(() => setPointId(emp.point_id ?? ""), 0); return () => window.clearTimeout(t); } }, [emp, pointId]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => {
      const like = `%${term.replace(/[%_,()]/g, " ")}%`;
      void supabaseBrowser().from("products").select("id,name,sku,price_1,price_3,image_url").eq("store_id", storeId).eq("active", true).or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like}`).order("name").limit(12)
        .then(({ data }) => setHits((data ?? []) as Prod[]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, storeId]);

  const principal = kind === "product" ? items.reduce((s, i) => s + i.qty * i.price, 0) : n(amount);
  const count = Math.max(1, Math.min(60, Math.floor(n(installments) || 1)));
  const months = emp ? count / PER_MONTH[emp.pay_frequency] : count;
  const interest = mode === "total" ? Math.round(principal * n(pct) / 100) : mode === "monthly" ? Math.round(principal * n(pct) / 100 * months) : 0;
  const total = principal + interest;
  const cuota = Math.ceil(total / count);
  const perPeriodSalary = emp ? n(emp.base_salary) / PER_MONTH[emp.pay_frequency] : 0;
  const heavy = emp && perPeriodSalary > 0 && cuota > perPeriodSalary * 0.5;
  const dates = emp ? schedule(start, emp.pay_frequency, count) : [];

  function add(p: Prod) {
    setItems((cur) => cur.some((i) => i.product.id === p.id) ? cur.map((i) => (i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i)) : [...cur, { product: p, qty: 1, price: n(p[priceLevel]) }]);
    setQ(""); setHits([]);
  }

  async function save() {
    if (!emp) return void Swal.fire({ ...swalTheme, icon: "warning", title: "Escoge el empleado" });
    if (kind === "product" && !items.length) return void Swal.fire({ ...swalTheme, icon: "warning", title: "Agrega al menos un producto" });
    if (kind === "product" && !pointId) return void Swal.fire({ ...swalTheme, icon: "warning", title: "Escoge de qué punto salen los productos" });
    if (principal <= 0) return void Swal.fire({ ...swalTheme, icon: "warning", title: "El valor debe ser mayor que cero" });
    if (kind === "cash" && fromCash && !pointId) return void Swal.fire({ ...swalTheme, icon: "warning", title: "Escoge el punto de cuya caja sale el dinero" });
    const ok = await Swal.fire({
      ...swalTheme, icon: "question", title: `¿Dar el vale a ${esc(emp.full_name)}?`,
      html: `${kind === "product" ? `${items.map((i) => `${i.qty} × ${esc(i.product.name)}`).join("<br/>")}<br/><small>Salen del inventario de ${esc(points.find((p) => p.id === pointId)?.name ?? "")}.</small><br/>` : `Préstamo de <b>${cop(principal)}</b>${fromCash ? "<br/><small>Sale de la caja del punto.</small>" : ""}<br/>`}<br/>Total <b>${cop(total)}</b> en ${count} cuota${count === 1 ? "" : "s"} de <b>${cop(cuota)}</b>`,
      showCancelButton: true, confirmButtonText: "Sí, dar vale", cancelButtonText: "Revisar",
    });
    if (!ok.isConfirmed) return;
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("erp_employee_loan_create", {
      p_store: storeId,
      p: {
        employee_id: emp.id, kind, point_id: pointId || null, items: items.map((i) => ({ product_id: i.product.id, qty: i.qty, price: i.price })), amount: principal,
        from_cash: kind === "cash" && fromCash, installments: count, interest_mode: mode, interest_pct: n(pct), start_on: start, notes: notes || null, description: desc || null,
      },
    });
    setSaving(false);
    if (error) return fail(error);
    done(`Vale #${(data as { number: number }).number} creado`, "Imprime el vale para que el empleado lo firme.");
    onSaved((data as { id: string }).id);
  }

  return (
    <Sheet title="Nuevo vale o préstamo" icon={<HandCoins size={18} />} onClose={onClose} dirty={!!employeeId || items.length > 0 || !!amount}
      footer={<><span className="flex-1" /><button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Guardando…" : `Dar vale · ${cop(total)}`}</button></>}>
      <div className="space-y-4">
        <Field label="Empleado">
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" style={inputStyle}>
            <option value="">Escoge…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` · ${e.position}` : ""} · {PERIOD_LABEL[e.pay_frequency].toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="¿Qué se lleva?">
          <ChoiceChips value={kind} onChange={setKind} options={[{ value: "product", label: "🛍️ Productos (salen del inventario)" }, { value: "cash", label: "💵 Dinero prestado" }]} />
        </Field>
        <Field label={kind === "product" ? "Punto de donde salen" : "Punto"} hint={kind === "cash" ? "Si el dinero sale de la caja, queda como salida de la caja abierta de este punto." : undefined}>
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" style={inputStyle}>
            <option value="">{kind === "product" ? "Escoge…" : "Sin punto"}</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        {kind === "product" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca el producto por nombre o código…" className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm outline-none" style={inputStyle} />
              </div>
              <ChoiceChips value={priceLevel} onChange={setPriceLevel} options={[{ value: "price_1", label: "Precio 1" }, { value: "price_3", label: "Precio detal" }]} />
            </div>
            {hits.length ? (
              <ul className="max-h-48 overflow-auto rounded-xl border p-1" style={{ borderColor: "var(--t-card-border)" }}>
                {hits.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => add(p)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5">
                    <span className="min-w-0 flex-1 truncate">{p.name}{p.sku ? <span className="text-xs" style={{ color: "var(--t-muted)" }}> · {p.sku}</span> : null}</span>
                    <b className="text-xs tabular-nums">{cop(n(p[priceLevel]))}</b>
                  </button></li>
                ))}
              </ul>
            ) : null}
            {items.map((i) => (
              <div key={i.product.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                <span className="min-w-0 flex-1 truncate font-semibold">{i.product.name}</span>
                <span className="w-20"><NumberField value={i.qty} decimals={0} min={1} onChange={(v) => setItems((cur) => cur.map((x) => (x.product.id === i.product.id ? { ...x, qty: Math.max(1, Math.floor(n(v) || 1)) } : x)))} ariaLabel="Cantidad" /></span>
                <span className="w-32"><MoneyField value={i.price} onChange={(v) => setItems((cur) => cur.map((x) => (x.product.id === i.product.id ? { ...x, price: n(v) } : x)))} ariaLabel="Precio" allowEmpty={false} /></span>
                <button type="button" onClick={() => setItems((cur) => cur.filter((x) => x.product.id !== i.product.id))} className="opacity-60 hover:opacity-100" aria-label="Quitar"><X size={15} /></button>
              </div>
            ))}
            {items.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Puedes cambiar el precio (por ejemplo, dejárselo a costo).</p> : null}
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Valor prestado"><MoneyField value={amount} onChange={setAmount} big /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={fromCash} onChange={(e) => setFromCash(e.target.checked)} className="h-5 w-5 accent-violet-500" /> 💵 Sale de la caja del punto (queda como salida de caja)</label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Número de cuotas" hint={emp ? `Una por cada ${PERIOD_ONE[emp.pay_frequency]} (le pagan ${PERIOD_LABEL[emp.pay_frequency].toLowerCase()})` : "Una por cada nómina del empleado"}>
            <NumberField value={installments} onChange={setInstallments} decimals={0} min={1} max={60} />
          </Field>
          <Field label="Empieza a descontar desde" hint="La primera nómina que incluya esta fecha"><DateField value={start} onChange={setStart} /></Field>
        </div>
        <Field label="Interés">
          <div className="flex flex-wrap items-center gap-2">
            <ChoiceChips value={mode} onChange={setMode} options={[{ value: "none", label: "Sin interés" }, { value: "monthly", label: "% mensual" }, { value: "total", label: "% total" }]} />
            {mode !== "none" ? <span className="w-28"><NumberField value={pct} onChange={setPct} suffix="%" decimals={2} min={0} max={100} /></span> : null}
          </div>
        </Field>
        <Field label="Descripción (opcional)"><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={kind === "product" ? "Se arma sola con los productos" : "Ej. Préstamo para la matrícula"} className="w-full rounded-xl border px-3 py-2 text-sm" style={inputStyle} /></Field>
        <Field label="Notas (opcional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" style={inputStyle} /></Field>

        <div className="rounded-2xl border p-3 text-sm" style={cardStyle}>
          <p>Valor <b>{cop(principal)}</b>{interest ? <> + interés <b>{cop(interest)}</b></> : null} = <b className="text-base">{cop(total)}</b></p>
          <p className="mt-0.5">{count} cuota{count === 1 ? "" : "s"} de <b>{cop(cuota)}</b>{emp ? ` cada ${PERIOD_ONE[emp.pay_frequency]}` : ""}</p>
          {heavy ? <p className="mt-1 text-xs font-semibold text-amber-500">⚠️ La cuota pasa de la mitad de lo que gana por {PERIOD_ONE[emp!.pay_frequency]} ({cop(perPeriodSalary)}). Por ley los descuentos no deberían dejarlo con menos de la mitad del salario: considera más cuotas.</p> : null}
          {dates.length ? <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Fechas aproximadas: {dates.slice(0, 8).map(fdate).join(" · ")}{dates.length > 8 ? " …" : ""}</p> : null}
        </div>
      </div>
    </Sheet>
  );
}
