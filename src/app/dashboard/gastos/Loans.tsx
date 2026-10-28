"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Banknote, Copy, ExternalLink, FileBarChart, HandCoins, MessageCircle, Pause, Pencil, PenLine, Play, Plus, Printer, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { storeName } from "./PayrollReport";
import { loanDeclaration, loanSignUrl, type LoanSignature, type LoanTerms } from "@/lib/loan-sign";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  ChoiceChips, DateField, Field, MoneyField, NumberField, PaymentSheet, Sheet, ask, cardStyle, cop, done, esc, fail, fdate, ghostBtn, inputStyle, iso, n,
  PERIOD_LABEL, primaryBg, primaryBtn, swalTheme, type Catalog, type Employee, type Period, type Point,
} from "./shared";
import type { Loan, LoanPayment as Payment } from "./LoansReport";
import { LoansReportSheet } from "./LoansReportSheet";

/**
 * Vales y préstamos a empleados (20261240): productos que se lleva (salen del inventario) o dinero prestado
 * (puede salir de la caja), en cuotas que se descuentan solas en cada nómina, con interés opcional.
 */
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
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [signing, setSigning] = useState<Loan | null>(null);
  // Firmas con enlace (20261262). Sin esa migración la lista funciona igual, sin el estado de firma.
  const [signs, setSigns] = useState<Record<string, SignState>>({});

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data, error: e }, sg] = await Promise.all([
      sb.rpc("erp_employee_loans_list", { p_store: storeId }),
      sb.rpc("erp_employee_loans_signs", { p_store: storeId }),
    ]);
    if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261240_vales_empleados.sql." : e.message);
    const r = data as { ok: boolean; error?: string; loans?: Loan[] };
    if (!r.ok) return setError(r.error ?? "No se pudo cargar.");
    setError(null);
    setLoans(r.loans ?? []);
    setSigns(((sg.data as { signs?: Record<string, SignState> } | null)?.signs) ?? {});
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
  async function printVoucher(l: Loan) {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    w.document.write("<p style='font-family:system-ui;padding:24px'>Preparando el vale…</p>");
    // Firmas reales (si ya firmaron por el enlace) y el nombre de la tienda para la declaración.
    let sigs: LoanSignature[] = [];
    if (signs[l.id]?.link) {
      const link = await supabaseBrowser().rpc("erp_employee_loan_sign_link", { p_loan: l.id });
      const token = (link.data as { token?: string } | null)?.token;
      if (token) sigs = ((await supabaseBrowser().rpc("loan_sign_get", { p_token: token })).data as { signatures?: LoanSignature[] } | null)?.signatures ?? [];
    }
    const store = await storeName(storeId);
    const sigBox = (role: LoanSignature["role"], title: string, fallback: string) => {
      const s = sigs.find((x) => x.role === role);
      return s ? `<div><img src="${s.signature}" alt="" style="height:70px;max-width:100%;object-fit:contain"/><br/>${title}<br/><b>${esc(s.name)}</b>${s.doc ? ` · Doc. ${esc(s.doc)}` : ""}<br/><small>${esc(new Date(s.at).toLocaleString("es-CO"))}</small></div>`
        : `<div style="padding-top:70px">${title}<br/>${esc(fallback)}</div>`;
    };
    w.document.open();
    const dates = schedule(l.start_on, l.pay_frequency, l.installments);
    const rows = dates.map((d, i) => `<tr><td>${i + 1}</td><td>${fdate(d)}</td><td style="text-align:right">${cop(i === dates.length - 1 ? n(l.total) - n(l.installment) * (dates.length - 1) : n(l.installment))}</td></tr>`).join("");
    const items = l.kind === "product" ? `<table><tr><th>Producto</th><th>Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr>${l.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td style="text-align:right">${cop(i.price)}</td><td style="text-align:right">${cop(i.qty * i.price)}</td></tr>`).join("")}</table>` : "";
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vale #${l.number}</title><style>
      body{font-family:system-ui,Arial,sans-serif;color:#111;max-width:640px;margin:24px auto;padding:0 16px;font-size:13px}
      h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #ddd;padding:5px;text-align:left}
      .big{font-size:16px;font-weight:700}.sign{display:flex;gap:30px;margin-top:30px;align-items:flex-end}.sign>div{flex:1;border-bottom:1px solid #111;padding-bottom:6px;text-align:center}
      @media print{button{display:none}}</style></head><body>
      <h1>${l.kind === "product" ? "Vale de mercancía" : "Préstamo"} #${l.number}</h1>
      <p>${esc(fdate(l.created_at.slice(0, 10)))} · ${esc(l.point ?? "")}</p>
      <p><b>Empleado:</b> ${esc(l.employee)}${l.document ? ` · Doc. ${esc(l.document)}` : ""}${l.position ? ` · ${esc(l.position)}` : ""}</p>
      ${items}
      <p>Valor: <b>${cop(l.principal)}</b>${n(l.interest) ? ` · Interés: <b>${cop(l.interest)}</b> (${l.interest_pct} % ${l.interest_mode === "monthly" ? "mensual" : "total"})` : ""}</p>
      <p class="big">Total a descontar: ${cop(l.total)} en ${l.installments} cuota${l.installments === 1 ? "" : "s"} de ${cop(l.installment)} (${PERIOD_LABEL[l.pay_frequency].toLowerCase()})</p>
      <table><tr><th>Cuota</th><th>Fecha aprox.</th><th style="text-align:right">Valor</th></tr>${rows}</table>
      <p>${esc(loanDeclaration(loanTerms(l), store || "la empresa"))}</p>
      ${l.notes ? `<p><b>Notas:</b> ${esc(l.notes)}</p>` : ""}
      <div class="sign">${sigBox("employee", "Firma de quien recibe (empleado)", l.employee)}${sigBox("giver", "Firma de quien entrega", l.created_by_name ?? "")}</div>
      ${signs[l.id]?.changed && sigs.length < 2 ? `<p style="color:#b45309">⚠️ El vale cambió después de firmarse: falta firmar de nuevo.</p>` : ""}
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
        {loans?.length ? <button type="button" onClick={() => setReporting(true)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><FileBarChart size={13} /> Informe</button> : null}
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
                      {l.status !== "void" ? <SignBadge s={signs[l.id]} /> : null}
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
                      {l.status !== "void" ? <button type="button" onClick={() => setSigning(l)} className={ghostBtn} style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}><PenLine size={13} /> Firmas con enlace</button> : null}
                      <button type="button" onClick={() => void printVoucher(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Printer size={13} /> Imprimir vale</button>
                      {l.status === "active" && cat.can.payroll ? <button type="button" onClick={() => setEditing(l)} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Pencil size={13} /> Editar</button> : null}
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

      {reporting ? <LoansReportSheet storeId={storeId} onClose={() => setReporting(false)} /> : null}
      {creating ? <LoanForm storeId={storeId} points={points} employees={(cat.employees ?? []).filter((e) => e.active)} onClose={() => setCreating(false)} onSaved={async (l) => { setCreating(false); await after(); if (l) { setOpenId(l); const made = { id: l } as Loan; setSigning(made); } }} /> : null}
      {editing ? <LoanForm storeId={storeId} points={points} employees={cat.employees ?? []} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await after(); }} /> : null}
      {signing ? <LoanSignSheet loan={(loans ?? []).find((x) => x.id === signing.id) ?? null} state={signs[signing.id]} onClose={() => { setSigning(null); void load(); }} /> : null}
      <PaymentSheet open={!!paying} title={paying ? `Abono al vale #${paying.number}` : ""} who={paying ? <b>{paying.employee}</b> : null} pending={n(paying?.balance)} defaultMethod="cash"
        hint="Si es en efectivo, entra a la caja abierta del punto." onClose={() => setPaying(null)}
        onConfirm={async (p) => { if (!paying) return false; const r = await pay(paying, p); if (r !== false) setPaying(null); return r; }} />
    </section>
  );
}

type SignState = { link: boolean; employee: { name: string; at: string } | null; giver: { name: string; at: string } | null; changed: boolean };

const loanTerms = (l: Loan): LoanTerms => ({
  number: l.number, employee: l.employee, document: l.document, kind: l.kind, description: l.description, items: l.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
  principal: n(l.principal), interest: n(l.interest), interest_mode: l.interest_mode, interest_pct: n(l.interest_pct), total: n(l.total), installments: l.installments,
  installment: n(l.installment), pay_frequency: l.pay_frequency, start_on: l.start_on,
});

function SignBadge({ s }: { s: SignState | undefined }) {
  const both = s?.employee && s?.giver;
  const label = both ? "✍️ Firmado" : s?.employee ? "✍️ Falta firma de quien entrega" : s?.changed ? "✍️ Cambió: firmar de nuevo" : s?.link ? "✍️ Enlace enviado, sin firmar" : "✍️ Sin firmar";
  return <span className="ml-1.5 inline-block rounded-full px-1.5 font-semibold" style={{ color: both ? "#16a34a" : "#d97706", background: both ? "#16a34a1a" : "#d977061a" }}>{label}</span>;
}

/** Firmas con enlace: el empleado firma desde su celular; quien entrega, con su sesión. */
function LoanSignSheet({ loan, state, onClose }: { loan: Loan | null; state: SignState | undefined; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; phone: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loan) return;
    let alive = true;
    void supabaseBrowser().rpc("erp_employee_loan_sign_link", { p_loan: loan.id }).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261262_firma_vales.sql." : e.message);
      const r = data as { token: string; phone: string | null };
      setLink({ url: loanSignUrl(r.token), phone: r.phone });
    });
    return () => { alive = false; };
  }, [loan]);
  if (!loan) return null;
  const phone = (link?.phone ?? "").replace(/\D/g, "").replace(/^(3\d{9})$/, "57$1");
  const first = loan.employee.split(/\s+/)[0];
  const msg = link ? `Hola ${first}, te comparto el ${loan.kind === "product" ? "vale de mercancía" : "vale de préstamo"} #${loan.number} por ${cop(loan.total)}. Ábrelo, revisa lo que recibes y las cuotas, y fírmalo desde tu celular:\n${link.url}` : "";
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); done("Enlace copiado"); } catch { window.prompt("Copia el enlace:", link.url); }
  }
  const row = (title: string, s: { name: string; at: string } | null | undefined) => (
    <div className="flex items-center gap-3 rounded-2xl border p-3 text-sm" style={cardStyle}>
      <span className="text-xl">{s ? "✅" : "⏳"}</span>
      <span className="min-w-0 flex-1"><b className="block">{title}</b><span className="text-xs" style={{ color: "var(--t-muted)" }}>{s ? `${s.name} · ${new Date(s.at).toLocaleString("es-CO")}` : "Falta firmar"}</span></span>
    </div>
  );
  return (
    <Sheet title={`Firmas del vale #${loan.number}`} subtitle={`${loan.employee} · ${cop(loan.total)}`} icon={<PenLine size={18} />} onClose={onClose}>
      <div className="space-y-3">
        {state?.changed && !(state.employee && state.giver) ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">⚠️ El vale cambió después de firmarse: las firmas anteriores quedaron guardadas y hay que firmar de nuevo.</p> : null}
        {row("Quien recibe (empleado)", state?.employee)}
        {row("Quien entrega", state?.giver)}
        {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : !link ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Preparando el enlace…</p> : (
          <>
            <p className="text-xs" style={{ color: "var(--t-muted)" }}>Mándale el enlace a {first}: verá lo que recibe, la deuda y las cuotas, acepta el descuento de nómina y firma con el dedo. Tú firmas como quien entrega abriendo el mismo enlace aquí.</p>
            <p className="break-all rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>{link.url}</p>
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className={primaryBtn} style={{ background: "#16a34a" }}><MessageCircle size={15} /> Enviar por WhatsApp{phone ? "" : " (escoges el chat)"}</a>
              <button type="button" onClick={() => void copy()} className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><Copy size={13} /> Copiar enlace</button>
              <a href={link.url} target="_blank" rel="noreferrer" className={ghostBtn} style={{ borderColor: "var(--t-card-border)" }}><ExternalLink size={13} /> Abrir y firmar como quien entrega</a>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Foto del producto; en grande se puede tocar para verla completa. */
function Thumb({ src, big }: { src: string | null; big?: boolean }) {
  const size = big ? "h-14 w-14" : "h-10 w-10";
  if (!src) return <span className={`grid ${size} shrink-0 place-items-center rounded-lg text-lg`} style={{ background: "var(--t-card-bg-soft)" }}>📦</span>;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} alt="" loading="lazy" className={`${size} shrink-0 rounded-lg object-cover`} />;
  return big ? (
    <button type="button" onClick={() => void Swal.fire({ ...swalTheme, imageUrl: src, imageAlt: "", showConfirmButton: false, showCloseButton: true, width: 520 })} className="shrink-0" aria-label="Ver la foto en grande">{img}</button>
  ) : img;
}

/** Nuevo vale, o editar uno activo (`initial`, 20261261): empleado, tipo, punto y caja no cambian. */
function LoanForm({ storeId, points, employees, initial, onClose, onSaved }: { storeId: string; points: Point[]; employees: Employee[]; initial?: Loan; onClose: () => void; onSaved: (id: string | null) => void }) {
  const editing = !!initial;
  const [employeeId, setEmployeeId] = useState(initial?.employee_id ?? "");
  const [kind, setKind] = useState<"product" | "cash">(initial?.kind ?? "product");
  const [pointId, setPointId] = useState(initial?.point_id ?? "");
  const [items, setItems] = useState<Array<{ product: Prod; qty: number; price: number }>>(() =>
    (initial?.kind === "product" ? initial.items : []).map((i) => ({ product: { id: i.product_id, name: i.name, sku: i.sku, price_1: null, price_3: null, image_url: null }, qty: i.qty, price: n(i.price) })));
  const [amount, setAmount] = useState<number | null>(initial?.kind === "cash" ? n(initial.principal) : null);
  const [fromCash, setFromCash] = useState(initial ? initial.from_cash : true);
  const [installments, setInstallments] = useState<number | null>(initial?.installments ?? 2);
  const [mode, setMode] = useState<"none" | "total" | "monthly">(initial?.interest_mode ?? "none");
  const [pct, setPct] = useState<number | null>(initial ? n(initial.interest_pct) : null);
  const [start, setStart] = useState(() => initial?.start_on ?? iso(new Date()));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [desc, setDesc] = useState(initial?.kind === "cash" ? initial.description : "");
  const paidSoFar = initial ? n(initial.total) - n(initial.balance) : 0;

  // Al editar, las fotos de los productos que ya tenía el vale.
  useEffect(() => {
    if (!initial || initial.kind !== "product" || !initial.items.length) return;
    let alive = true;
    void supabaseBrowser().from("products").select("id,image_url").in("id", initial.items.map((i) => i.product_id)).then(({ data }) => {
      if (!alive || !data) return;
      const img = new Map((data as Array<{ id: string; image_url: string | null }>).map((p) => [p.id, p.image_url]));
      setItems((cur) => cur.map((i) => ({ ...i, product: { ...i.product, image_url: i.product.image_url ?? img.get(i.product.id) ?? null } })));
    });
    return () => { alive = false; };
  }, [initial]);
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
    if (initial) {
      if (total < paidSoFar) return void Swal.fire({ ...swalTheme, icon: "warning", title: "El total queda por debajo de lo pagado", text: `Ya pagó ${cop(paidSoFar)}: el total no puede quedar en ${cop(total)}.` });
      const ok = await Swal.fire({
        ...swalTheme, icon: "question", title: `¿Guardar los cambios del vale #${initial.number}?`,
        html: `Total ${cop(initial.total)} → <b>${cop(total)}</b><br/>${count} cuota${count === 1 ? "" : "s"} de <b>${cop(cuota)}</b>${kind === "product" ? "<br/><small>En el inventario solo se mueve la diferencia.</small>" : initial.from_cash && principal !== n(initial.principal) ? "<br/><small>La diferencia sale o entra a la caja del punto.</small>" : ""}<br/><small>Si ya estaba firmado, hay que firmar de nuevo.</small>`,
        showCancelButton: true, confirmButtonText: "Sí, guardar", cancelButtonText: "Revisar",
      });
      if (!ok.isConfirmed) return;
      setSaving(true);
      const { error } = await supabaseBrowser().rpc("erp_employee_loan_update", {
        p_loan: initial.id,
        p: { items: items.map((i) => ({ product_id: i.product.id, qty: i.qty, price: i.price })), amount: principal, installments: count, interest_mode: mode, interest_pct: n(pct), start_on: start, notes, description: desc || null },
      });
      setSaving(false);
      if (error) return fail(/Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261261_editar_vales.sql." : error);
      done("Vale actualizado");
      return onSaved(initial.id);
    }
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
    done(`Vale #${(data as { number: number }).number} creado`, "Ahora mándale el enlace al empleado para que lo firme.");
    onSaved((data as { id: string }).id);
  }

  return (
    <Sheet title={initial ? `Editar vale #${initial.number}` : "Nuevo vale o préstamo"} subtitle={initial ? initial.employee : undefined} icon={initial ? <Pencil size={18} /> : <HandCoins size={18} />} onClose={onClose}
      dirty={editing ? true : !!employeeId || items.length > 0 || !!amount}
      footer={<><span className="flex-1" /><button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn} style={primaryBg}>{saving ? "Guardando…" : editing ? `Guardar cambios · ${cop(total)}` : `Dar vale · ${cop(total)}`}</button></>}>
      <div className="space-y-4">
        {editing && paidSoFar > 0 ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Ya pagó <b>{cop(paidSoFar)}</b> de este vale: el total nuevo no puede quedar por debajo.</p> : null}
        <Field label="Empleado">
          <select value={employeeId} disabled={editing} onChange={(e) => setEmployeeId(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-70" style={inputStyle}>
            <option value="">Escoge…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` · ${e.position}` : ""} · {PERIOD_LABEL[e.pay_frequency].toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="¿Qué se lleva?">
          <ChoiceChips value={kind} onChange={setKind} disabled={editing} options={[{ value: "product", label: "🛍️ Productos (salen del inventario)" }, { value: "cash", label: "💵 Dinero prestado" }]} />
        </Field>
        <Field label={kind === "product" ? "Punto de donde salen" : "Punto"} hint={kind === "cash" ? "Si el dinero sale de la caja, queda como salida de la caja abierta de este punto." : undefined}>
          <select value={pointId} disabled={editing} onChange={(e) => setPointId(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-70" style={inputStyle}>
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
              <ul className="max-h-72 space-y-0.5 overflow-auto rounded-xl border p-1" style={{ borderColor: "var(--t-card-border)" }}>
                {hits.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => add(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5" title={p.name}>
                    <Thumb src={p.image_url} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-semibold leading-snug [overflow-wrap:anywhere]">{p.name}</span>
                      {p.sku ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Código {p.sku}</span> : null}
                    </span>
                    <b className="shrink-0 text-xs tabular-nums">{cop(n(p[priceLevel]))}</b>
                  </button></li>
                ))}
              </ul>
            ) : null}
            {items.map((i) => (
              <div key={i.product.id} className="space-y-2 rounded-xl border p-2.5 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="flex items-start gap-3">
                  <Thumb src={i.product.image_url} big />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">{i.product.name}</span>
                    {i.product.sku ? <span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Código {i.product.sku}</span> : null}
                  </span>
                  <button type="button" onClick={() => setItems((cur) => cur.filter((x) => x.product.id !== i.product.id))} className="shrink-0 rounded-full p-1 opacity-60 hover:opacity-100" aria-label={`Quitar ${i.product.name}`}><X size={16} /></button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24"><NumberField value={i.qty} decimals={0} min={1} onChange={(v) => setItems((cur) => cur.map((x) => (x.product.id === i.product.id ? { ...x, qty: Math.max(1, Math.floor(n(v) || 1)) } : x)))} ariaLabel="Cantidad" /></span>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>×</span>
                  <span className="w-36"><MoneyField value={i.price} onChange={(v) => setItems((cur) => cur.map((x) => (x.product.id === i.product.id ? { ...x, price: n(v) } : x)))} ariaLabel="Precio" allowEmpty={false} /></span>
                  <span className="ml-auto text-right"><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>Subtotal</span><b className="tabular-nums">{cop(i.qty * i.price)}</b></span>
                </div>
              </div>
            ))}
            {items.length ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Puedes cambiar el precio (por ejemplo, dejárselo a costo).</p> : null}
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Valor prestado"><MoneyField value={amount} onChange={setAmount} big /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={fromCash} disabled={editing} onChange={(e) => setFromCash(e.target.checked)} className="h-5 w-5 accent-violet-500" /> 💵 Sale de la caja del punto (queda como salida de caja)</label>
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
