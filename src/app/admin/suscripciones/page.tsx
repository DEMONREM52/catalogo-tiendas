"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DateField } from "@/components/forms/Fields";
import { HELP_SCREENS } from "@/components/HelpButton";

/**
 * Centro de suscripciones de RemHub (solo el administrador de la plataforma).
 * Ingresos de RemHub únicamente: las ventas de las tiendas nunca entran aquí.
 * Necesita 20261211_saas_planes_suscripciones.sql.
 */

type Tab = "resumen" | "salud" | "clientes" | "planes" | "pagos" | "ajustes" | "videos";
type Dash = {
  ok: boolean; error?: string;
  settings: { enforce_limits: boolean; enforce_modules?: boolean; default_trial_plan: string; default_trial_days: number; grace_days: number };
  counts: Record<string, number>;
  money: { collected: number; collected_count: number; pending: number; declined: number; review: number; mrr: number };
  funnel: Record<string, number>;
  by_plan: Array<{ plan_id: string; n: number }>;
  webhook_problems: number;
};
type Customer = {
  store_id: string; name: string; slug: string; email: string | null; created_at: string; plan_id: string; subscription_plan: string | null; status: string;
  period_end: string | null; trial_ends_at: string | null; billing_period: string | null; points: number; users: number; products: number;
  discount_pct: number; extra_points: number; admin_note: string | null;
};
type Plan = {
  id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number; max_products: number | null; max_users: number | null;
  max_points: number | null; max_catalogs: number | null; extra_point_price: number | null; modules: string[]; features: string[]; trial_days: number;
  public: boolean; active: boolean; highlight: boolean; sort_order: number; subscribers: number;
};
type Payment = { reference: string; store: string | null; provider?: string; note?: string | null; plan_id: string; period: string; amount: number; status: string; provider_tx_id: string | null; environment: string; method: string | null; created_at: string; approved_at: string | null };
type Hook = { at: string; result: string | null; detail: string | null; valid: boolean; key: string };

const box = { borderColor: "var(--ap-card-border, rgba(255,255,255,.12))", background: "var(--ap-card-bg, rgba(255,255,255,.04))" } as const;
const muted = { color: "var(--ap-muted, #94a3b8)" } as const;
const field = "w-full rounded-xl border px-3 py-2 text-sm outline-none";
const fieldStyle = { borderColor: "var(--ap-card-border, rgba(255,255,255,.15))", background: "transparent", color: "inherit" } as const;
const swal = { background: "var(--t-bg-base, #0b0b14)", color: "var(--t-text, #fff)", confirmButtonColor: "#8b5cf6" };
const cop = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString("es-CO")}`;
const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const STATUS: Record<string, [string, string]> = {
  free: ["Gratis", "#94a3b8"], trialing: ["En prueba", "#8b5cf6"], active: ["Activa", "#10b981"], payment_pending: ["Pago pendiente", "#f59e0b"],
  past_due: ["En gracia", "#f59e0b"], canceled: ["Cancelada", "#f97316"], expired: ["Vencida", "#ef4444"], suspended: ["Suspendida", "#ef4444"],
};
const PAY: Record<string, string> = { created: "Sin pagar", pending: "Pendiente", approved: "Aprobado", declined: "Rechazado", voided: "Anulado", error: "Error", refunded: "Reembolsado", review: "En revisión" };
const MODULES = ["catalog", "orders", "pos", "inventory", "customers", "cash", "social", "points", "transfers", "stock_requests", "profit", "expenses", "reports", "exports", "internal_credit", "settlements", "payroll", "fiscal", "audit", "custom_domain"];
const missing = (m?: string) => /saas_|Could not find the function|schema cache/i.test(m ?? "");

function Pill({ status }: { status: string }) {
  const [l, c] = STATUS[status] ?? [status, "#94a3b8"];
  return <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: `color-mix(in oklab, ${c} 18%, transparent)`, color: c }}>{l}</span>;
}

function Kpi({ label, value, sub, tone, help }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn"; help: string }) {
  const color = tone === "good" ? "#10b981" : tone === "bad" ? "#ef4444" : tone === "warn" ? "#f59e0b" : undefined;
  return (
    <div className="rounded-2xl border p-4" style={box} title={help}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={muted}>{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums" style={{ color }}>{value}</p>
      {sub ? <p className="text-xs" style={muted}>{sub}</p> : null}
    </div>
  );
}

export default function AdminSubscriptionsPage() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(() => { const t = new Date(); return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) }; });
  const [dash, setDash] = useState<Dash | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const loadDash = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_dashboard", { p_from: range.from, p_to: range.to });
    if (e) return setError(missing(e.message) ? "Falta ejecutar en Supabase la migración 20261211_saas_planes_suscripciones.sql." : e.message);
    const d = data as Dash;
    if (!d?.ok) return setError(d?.error ?? "No se pudo cargar.");
    setError(null);
    setDash(d);
  }, [range]);
  const loadPlans = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("saas_admin_plans");
    setPlans((data ?? []) as Plan[]);
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => { void loadDash(); void loadPlans(); }, 0);
    return () => window.clearTimeout(t);
  }, [loadDash, loadPlans]);

  const quick = (k: "month" | "last" | "quarter" | "year") => {
    const t = new Date();
    if (k === "month") setRange({ from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) });
    if (k === "last") setRange({ from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) });
    if (k === "quarter") setRange({ from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: iso(t) });
    if (k === "year") setRange({ from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) });
  };

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">💎 Suscripciones de RemHub</h1>
          <p className="text-sm" style={muted}>Planes, clientes, cobros y conversión. Solo ingresos de RemHub: las ventas de las tiendas no se mezclan aquí.</p>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-2xl border p-1 text-sm font-bold" style={box}>
          {([["resumen", "Resumen"], ["salud", "❤️ Salud"], ["clientes", "Clientes"], ["planes", "Planes"], ["pagos", "Pagos"], ["ajustes", "Ajustes"], ["videos", "🎬 Videos"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="rounded-xl px-3 py-1.5 transition" style={tab === k ? { background: "#8b5cf6", color: "#fff" } : undefined}>{l}</button>
          ))}
        </nav>
      </header>

      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ ...box, color: "#ef4444" }}>{error}</p> : null}

      {tab === "resumen" && dash ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <DateField compact value={range.from} onChange={(v) => v && setRange((r) => ({ ...r, from: v }))} ariaLabel="Desde" className="w-36" />
            <span style={muted}>a</span>
            <DateField compact value={range.to} onChange={(v) => v && setRange((r) => ({ ...r, to: v }))} ariaLabel="Hasta" className="w-36" />
            {([["month", "Este mes"], ["last", "Mes pasado"], ["quarter", "3 meses"], ["year", "Este año"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => quick(k)} className="rounded-full border px-3 py-1 font-semibold" style={box}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Cobrado en el rango" value={cop(dash.money.collected)} sub={`${dash.money.collected_count} pago(s) aprobados`} tone="good" help="Pagos de suscripción APROBADOS por Wompi dentro de las fechas. Es dinero que entró (antes de la comisión de Wompi)." />
            <Kpi label="MRR estimado" value={cop(dash.money.mrr)} sub={`ARR estimado ${cop(dash.money.mrr * 12)}`} help="Ingreso recurrente mensual ESTIMADO: suscripciones pagadas vigentes llevadas a un mes (anual ÷ 12) con su precio pactado. No incluye Fundadores ni pruebas. No es utilidad." />
            <Kpi label="Clientes de pago" value={String(dash.counts.active + dash.counts.past_due + dash.counts.canceled)} sub={`${dash.counts.past_due} en gracia · ${dash.counts.canceled} no renuevan`} help="Suscripciones pagadas vigentes (activas, en días de gracia o canceladas que aún no vencen)." />
            <Kpi label="Pruebas activas" value={String(dash.counts.trialing)} sub={`${dash.counts.trial_ending} vencen en 3 días`} tone={dash.counts.trial_ending ? "warn" : undefined} help="Tiendas probando un plan superior ahora mismo." />
            <Kpi label="Tiendas" value={String(dash.counts.stores)} sub={`${dash.counts.new_stores} nuevas en el rango`} help="Todas las tiendas creadas." />
            <Kpi label="Gratis" value={String(dash.counts.free)} sub={`${dash.counts.founders} Fundadores · ${dash.counts.expired} vencidas`} help="Tiendas en el plan gratis (incluye las que vencieron)." />
            <Kpi label="Conversión de prueba" value={dash.funnel.trials ? `${Math.round((dash.funnel.trials_converted / dash.funnel.trials) * 100)} %` : "—"} sub={`${dash.funnel.trials_converted} de ${dash.funnel.trials} pruebas del rango pagaron`} help="Pruebas iniciadas en el rango que terminaron en un pago aprobado." />
            <Kpi label="Pagos con problema" value={String(dash.money.declined + dash.money.review)} sub={`${dash.money.review} en revisión · ${dash.webhook_problems} avisos con error (30 d)`} tone={dash.money.review || dash.webhook_problems ? "bad" : undefined} help="Rechazados en el rango, pagos en revisión (monto o entorno no coinciden) y avisos de Wompi inválidos." />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-2xl border p-4" style={box}>
              <p className="mb-3 text-sm font-black">Embudo de venta (rango)</p>
              {([["pricing_views", "Vieron precios"], ["plan_clicks", "Tocaron un plan"], ["checkouts", "Fueron a pagar"], ["collected_count", "Pagaron"]] as const).map(([k, l], i, all) => {
                const v = k === "collected_count" ? dash.money.collected_count : dash.funnel[k] ?? 0;
                const top = Math.max(1, dash.funnel.pricing_views ?? 0, ...all.map(([kk]) => (kk === "collected_count" ? dash.money.collected_count : dash.funnel[kk] ?? 0)));
                return (
                  <div key={k} className="mb-2">
                    <div className="flex justify-between text-xs"><span>{l}</span><b>{v}</b></div>
                    <div className="mt-1 h-2 rounded-full" style={{ background: "rgba(148,163,184,.18)" }}><div className="h-full rounded-full" style={{ width: `${(v / top) * 100}%`, background: `hsl(${265 - i * 30} 80% 62%)` }} /></div>
                  </div>
                );
              })}
              <p className="mt-2 text-xs" style={muted}>Topes de plan alcanzados: <b>{dash.funnel.limit_hits}</b> · Cancelaciones: <b>{dash.funnel.cancellations}</b></p>
            </section>
            <section className="rounded-2xl border p-4" style={box}>
              <p className="mb-3 text-sm font-black">Tiendas por plan (hoy)</p>
              {dash.by_plan.map((b) => {
                const total = Math.max(1, dash.counts.stores);
                return (
                  <div key={b.plan_id} className="mb-2">
                    <div className="flex justify-between text-xs"><span>{plans.find((p) => p.id === b.plan_id)?.name ?? b.plan_id}</span><b>{b.n} · {Math.round((b.n / total) * 100)}%</b></div>
                    <div className="mt-1 h-2 rounded-full" style={{ background: "rgba(148,163,184,.18)" }}><div className="h-full rounded-full" style={{ width: `${(b.n / total) * 100}%`, background: "linear-gradient(90deg,#8b5cf6,#3987e5)" }} /></div>
                  </div>
                );
              })}
              <p className="mt-2 text-xs" style={muted}>Los costos de infraestructura y la utilidad no se muestran: todavía no hay una fuente real de costos conectada.</p>
            </section>
          </div>
        </>
      ) : null}

      {tab === "resumen" && dash ? <Referrals /> : null}
      {tab === "salud" ? <Health /> : null}
      {tab === "videos" ? <HelpVideos /> : null}
      {tab === "clientes" ? <Customers plans={plans} onChanged={() => void loadDash()} /> : null}
      {tab === "planes" ? <Plans plans={plans} onSaved={() => { void loadPlans(); void loadDash(); }} /> : null}
      {tab === "pagos" ? <Payments /> : null}
      {tab === "ajustes" && dash ? <Settings dash={dash} plans={plans} onSaved={() => void loadDash()} /> : null}
    </main>
  );
}

function Customers({ plans, onChanged }: { plans: Plan[]; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Customer[] } | null>(null);
  const [edit, setEdit] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    const { data: d } = await supabaseBrowser().rpc("saas_admin_customers", { p_q: q, p_status: status, p_plan: plan, p_limit: 50, p_offset: page * 50 });
    const v = d as { ok: boolean; total: number; rows: Customer[] } | null;
    if (v?.ok) setData({ total: v.total, rows: v.rows });
  }, [q, status, plan, page]);
  useEffect(() => { const t = window.setTimeout(() => void load(), q ? 300 : 0); return () => window.clearTimeout(t); }, [load, q]);

  return (
    <section className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr]">
        <input className={field} style={fieldStyle} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="🔍 Tienda, enlace, correo del dueño o ID" />
        <select className={field} style={fieldStyle} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={field} style={fieldStyle} value={plan} onChange={(e) => { setPlan(e.target.value); setPage(0); }}>
          <option value="">Todos los planes</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-2xl border" style={box}>
        <table className="w-full min-w-[900px] text-sm">
          <thead style={muted}><tr>{["Tienda", "Dueño", "Plan", "Estado", "Vence", "Uso", "Creada", ""].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.rows ?? []).map((c) => (
              <tr key={c.store_id} className="border-t" style={{ borderColor: "rgba(148,163,184,.15)" }}>
                <td className="px-3 py-2"><b>{c.name}</b><span className="block text-xs" style={muted}>{c.slug}</span></td>
                <td className="px-3 py-2 text-xs">{c.email ?? "—"}</td>
                <td className="px-3 py-2">{plans.find((p) => p.id === c.plan_id)?.name ?? c.plan_id}{c.subscription_plan && c.subscription_plan !== c.plan_id ? <span className="block text-[11px]" style={muted}>contrató {plans.find((p) => p.id === c.subscription_plan)?.name ?? c.subscription_plan}</span> : null}</td>
                <td className="px-3 py-2"><Pill status={c.status} />{c.discount_pct > 0 ? <span className="block text-[11px]" style={muted}>−{c.discount_pct}%</span> : null}</td>
                <td className="px-3 py-2 text-xs">{c.status === "trialing" ? `prueba ${day(c.trial_ends_at)}` : day(c.period_end)}</td>
                <td className="px-3 py-2 text-xs">{c.products} prod · {c.users} us · {c.points} pts</td>
                <td className="px-3 py-2 text-xs">{day(c.created_at)}</td>
                <td className="px-3 py-2"><button type="button" onClick={() => setEdit(c)} className="rounded-xl border px-3 py-1 text-xs font-bold" style={box}>Gestionar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length ? <p className="p-6 text-center text-sm" style={muted}>Ninguna tienda coincide.</p> : null}
      </div>
      {data && data.total > 50 ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-xl border px-3 py-1 disabled:opacity-40" style={box}>← Anterior</button>
          <span style={muted}>Página {page + 1} de {Math.ceil(data.total / 50)}</span>
          <button type="button" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded-xl border px-3 py-1 disabled:opacity-40" style={box}>Siguiente →</button>
        </div>
      ) : null}
      {edit ? <EditCustomer c={edit} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); onChanged(); }} /> : null}
    </section>
  );
}

function EditCustomer({ c, plans, onClose, onSaved }: { c: Customer; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(c.subscription_plan ?? c.plan_id);
  const [status, setStatus] = useState(c.status);
  const [end, setEnd] = useState(c.period_end ? String(c.period_end).slice(0, 10) : "");
  const [extra, setExtra] = useState(String(c.extra_points ?? 0));
  const [disc, setDisc] = useState(String(c.discount_pct ?? 0));
  const [note, setNote] = useState(c.admin_note ?? "");
  const [reason, setReason] = useState("");
  const [hist, setHist] = useState<Array<{ kind: string; reason: string | null; at: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabaseBrowser().rpc("saas_admin_store_history", { p_store: c.store_id }).then(({ data }) => setHist(((data as { events?: typeof hist } | null)?.events ?? []).slice(0, 12)));
  }, [c.store_id]);

  async function save() {
    if (reason.trim().length < 3) return void Swal.fire({ ...swal, icon: "warning", title: "Escribe el motivo", text: "Todo cambio queda en el historial con su motivo." });
    const changes: Record<string, unknown> = { plan_id: plan, status, extra_points: Number(extra) || 0, discount_pct: Number(disc) || 0, admin_note: note.trim() || null };
    if (end) changes.current_period_end = new Date(`${end}T23:59:59-05:00`).toISOString();
    const ok = await Swal.fire({ ...swal, icon: "question", title: `Aplicar cambios a ${c.name}`, text: "Cambia lo que la tienda puede usar desde ya.", showCancelButton: true, confirmButtonText: "Aplicar", cancelButtonText: "Volver" });
    if (!ok.isConfirmed) return;
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("saas_admin_set_subscription", { p_store: c.store_id, p_changes: changes, p_reason: reason.trim() });
    setBusy(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (!r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se aplicó", text: r?.error });
    onSaved();
  }

  async function quickAll(days: number | null) {
    const r = await Swal.fire({
      ...swal, icon: "question", title: `Todo incluido para ${c.name}`, input: "text", inputPlaceholder: "Motivo (ej: cliente especial, pagó por transferencia)",
      html: days ? `Plan Fundador (sin límites, todos los módulos) por <b>${days} días</b>. Al vencer pasa a Gratis sin borrar nada.` : "Plan Fundador (sin límites, todos los módulos) <b>sin vencimiento</b>.",
      showCancelButton: true, confirmButtonText: "Habilitar", cancelButtonText: "Volver",
      inputValidator: (v) => (String(v ?? "").trim().length < 3 ? "Escribe el motivo" : undefined),
    });
    if (!r.isConfirmed) return;
    setBusy(true);
    const until = days ? daysFromNow(days) : null;
    const { data } = await supabaseBrowser().rpc("saas_admin_set_subscription", {
      p_store: c.store_id, p_changes: { plan_id: "fundador", status: "active", current_period_end: until, cancel_at_period_end: false }, p_reason: String(r.value).trim(),
    });
    setBusy(false);
    const v = data as { ok: boolean; error?: string } | null;
    if (!v?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se aplicó", text: v?.error });
    await Swal.fire({ ...swal, icon: "success", title: "Habilitada", text: until ? `Todo incluido hasta el ${day(until)}.` : "Todo incluido sin vencimiento." });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="max-h-[92vh] w-[min(720px,100%)] overflow-y-auto rounded-3xl border p-5 text-sm shadow-2xl" style={{ ...box, background: "var(--t-bg-base, #0b0b14)" }}>
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-black">{c.name}</h3><p className="text-xs" style={muted}>{c.email} · {c.slug}</p></div>
          <button type="button" onClick={onClose} className="rounded-full border px-3 py-1" style={box}>✕</button>
        </div>
        {/* Atajos: habilitar todo sin cobro (cortesía, clientes especiales, mientras no hay pasarela). */}
        <div className="mt-4 rounded-2xl border p-3" style={box}>
          <p className="text-xs font-bold uppercase" style={muted}>🎁 Habilitar todo incluido (sin límites, todos los módulos)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([[30, "30 días"], [90, "3 meses"], [365, "1 año"], [null, "Sin vencimiento"]] as const).map(([days, label]) => (
              <button key={label} type="button" disabled={busy} onClick={() => void quickAll(days)} className="rounded-xl border px-3 py-1.5 text-xs font-bold disabled:opacity-50" style={box}>{label}</button>
            ))}
          </div>
        </div>
        <ManualPayment c={c} plans={plans} onDone={onSaved} />
        <Growth storeId={c.store_id} />
        <p className="mt-4 text-xs font-bold uppercase" style={muted}>Ajuste detallado</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label>Plan<select className={field} style={fieldStyle} value={plan} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Estado<select className={field} style={fieldStyle} value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div><span>Vence (fin del período)</span><DateField value={end} onChange={setEnd} ariaLabel="Fin del período" /></div>
          <label>Puntos adicionales<input className={field} style={fieldStyle} inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/\D/g, ""))} /></label>
          <label>Descuento %<input className={field} style={fieldStyle} inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label>Nota interna<input className={field} style={fieldStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Solo la ve RemHub" /></label>
        </div>
        <label className="mt-3 block">Motivo del cambio *<input className={field} style={fieldStyle} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: cortesía 15 días por falla, pagó por transferencia…" /></label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 font-semibold" style={box}>Cerrar</button>
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl px-4 py-2 font-bold text-white disabled:opacity-50" style={{ background: "#8b5cf6" }}>{busy ? "Aplicando…" : "Aplicar cambios"}</button>
        </div>
        {hist.length ? (
          <div className="mt-5 border-t pt-3" style={{ borderColor: "rgba(148,163,184,.2)" }}>
            <p className="mb-2 text-xs font-bold uppercase" style={muted}>Historial</p>
            <ul className="space-y-1 text-xs">{hist.map((h, i) => <li key={i}><b>{day(h.at)}</b> · {h.kind}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Quién trae clientes (programa «Invita y gana») y premio en días de «todo incluido». Necesita 20261215. */
function Referrals() {
  const [rows, setRows] = useState<Array<{ store_id: string; name: string; slug: string; signups: number; paid: number; last_at: string | null; rewards_days: number; referred: Array<{ name: string; slug: string; at: string }> }> | null>(null);
  const load = useCallback(() => {
    void supabaseBrowser().rpc("saas_admin_referrals").then(({ data, error }) => setRows(error ? [] : ((data ?? []) as NonNullable<typeof rows>)));
  }, []);
  useEffect(() => { const t = window.setTimeout(load, 0); return () => window.clearTimeout(t); }, [load]);

  async function reward(r: NonNullable<typeof rows>[number]) {
    const res = await Swal.fire({
      ...swal, icon: "question", title: `Premiar a ${r.name}`, input: "number", inputValue: "30", inputLabel: "Días de todo incluido",
      html: `Trajo <b>${r.signups}</b> tienda(s); <b>${r.paid}</b> ya pagaron. Ya lleva ${r.rewards_days} días de premio.`,
      showCancelButton: true, confirmButtonText: "Premiar", cancelButtonText: "Volver",
      inputValidator: (v) => (Number(v) >= 1 && Number(v) <= 366 ? undefined : "Entre 1 y 366 días"),
    });
    if (!res.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("saas_admin_referral_reward", { p_store: r.store_id, p_days: Number(res.value), p_note: `Premio por referidos (${r.signups} invitadas, ${r.paid} pagaron)` });
    const v = data as { ok: boolean; error?: string; until?: string | null } | null;
    if (!v?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se aplicó", text: v?.error });
    await Swal.fire({ ...swal, icon: "success", title: "Premio aplicado", text: v.until ? `Todo incluido hasta el ${day(v.until)}.` : "Ya tenía todo incluido sin vencimiento." });
    load();
  }

  if (!rows) return null;
  return (
    <section className="rounded-2xl border p-4" style={box}>
      <p className="text-sm font-black">🎁 Invita y gana: quién te trae clientes</p>
      <p className="mb-3 text-xs" style={muted}>Tiendas que llegaron por el enlace o el sello «Hecho con RemHub» de otra. El premio lo decides tú (días de todo incluido).</p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead style={muted}><tr>{["Tienda que invitó", "Invitadas", "Pagaron", "Última", "Premio dado", ""].map((h) => <th key={h} className="px-2 py-1.5 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.store_id} className="border-t" style={{ borderColor: "rgba(148,163,184,.15)" }}>
                  <td className="px-2 py-1.5"><b>{r.name}</b><span className="block text-[11px]" style={muted} title={r.referred.map((x) => x.name).join(", ")}>{r.referred.slice(0, 3).map((x) => x.name).join(", ")}{r.referred.length > 3 ? "…" : ""}</span></td>
                  <td className="px-2 py-1.5">{r.signups}</td>
                  <td className="px-2 py-1.5" style={{ color: r.paid ? "#10b981" : undefined }}>{r.paid}</td>
                  <td className="px-2 py-1.5 text-xs">{day(r.last_at)}</td>
                  <td className="px-2 py-1.5 text-xs">{r.rewards_days} días</td>
                  <td className="px-2 py-1.5"><button type="button" onClick={() => void reward(r)} className="rounded-xl border px-3 py-1 text-xs font-bold" style={box}>🎁 Premiar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-xs" style={muted}>Todavía nadie ha llegado por invitación.</p>}
    </section>
  );
}

/** Vitrina de clientes en la página principal y quién refirió a la tienda. */
function Growth({ storeId }: { storeId: string }) {
  const [g, setG] = useState<{ showcase: boolean; referred_by: { name: string } | null; referrals: number } | null>(null);
  useEffect(() => {
    void supabaseBrowser().rpc("saas_admin_store_growth", { p_store: storeId }).then(({ data }) => { const v = data as ({ ok: boolean } & NonNullable<typeof g>) | null; if (v?.ok) setG(v); });
  }, [storeId]);
  if (!g) return null;
  async function toggle() {
    const { data } = await supabaseBrowser().rpc("saas_admin_store_growth", { p_store: storeId, p_showcase: !g!.showcase });
    const v = data as ({ ok: boolean } & NonNullable<typeof g>) | null;
    if (v?.ok) setG(v);
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border p-3 text-xs" style={box}>
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={g.showcase} onChange={() => void toggle()} /> Mostrar en «Tiendas que ya venden con RemHub» (página principal)</label>
      <span style={muted}>{g.referred_by ? `Llegó invitada por ${g.referred_by.name}` : "Llegó por su cuenta"} · invitó a {g.referrals}</span>
    </div>
  );
}

/** Pago recibido por fuera de la pasarela (transferencia, Nequi, efectivo…): activa el plan y cuenta en «Cobrado». */
function ManualPayment({ c, plans, onDone }: { c: Customer; plans: Plan[]; onDone: () => void }) {
  const paid = plans.filter((p) => p.monthly_price > 0);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(paid.find((p) => p.id === c.subscription_plan)?.id ?? paid[0]?.id ?? "");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const pl = paid.find((p) => p.id === plan);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const suggested = pl ? (period === "year" ? pl.yearly_price : pl.monthly_price) : 0;

  async function save() {
    const value = Number(amount.replace(/\D/g, "")) || suggested;
    const ok = await Swal.fire({ ...swal, icon: "question", title: "Registrar pago", html: `${cop(value)} · ${pl?.name ?? plan} ${period === "year" ? "anual" : "mensual"} · ${method}<br><span style="opacity:.7;font-size:12px">Activa el plan desde ya y queda en el historial de pagos.</span>`, showCancelButton: true, confirmButtonText: "Registrar", cancelButtonText: "Volver" });
    if (!ok.isConfirmed) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("saas_admin_manual_payment", { p_store: c.store_id, p_plan: plan, p_period: period, p_amount: value, p_method: method, p_reference: ref, p_note: note });
    setBusy(false);
    const r = data as { ok: boolean; error?: string; reference?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se registró", text: r?.error ?? (/saas_admin_manual_payment|Could not find/i.test(error?.message ?? "") ? "Falta la migración 20261214_pagos_manuales.sql." : error?.message) });
    await Swal.fire({ ...swal, icon: "success", title: "Pago registrado", text: `Referencia ${r.reference}. El plan ya está activo.` });
    onDone();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-2xl border border-dashed px-3 py-2 text-xs font-bold" style={box}>
        💵 Registrar un pago recibido (transferencia, Nequi, efectivo…)
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-2xl border p-3" style={box}>
      <p className="text-xs font-bold uppercase" style={muted}>💵 Pago recibido por fuera de Wompi</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label>Plan<select className={field} style={fieldStyle} value={plan} onChange={(e) => setPlan(e.target.value)}>{paid.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Periodo<select className={field} style={fieldStyle} value={period} onChange={(e) => setPeriod(e.target.value as "month" | "year")}><option value="month">Mensual</option><option value="year">Anual</option></select></label>
        <label>Valor recibido<input className={field} style={fieldStyle} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder={suggested ? cop(suggested) : "COP"} /></label>
        <label>Cómo pagó<select className={field} style={fieldStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
          {[["transferencia", "Transferencia"], ["nequi", "Nequi"], ["daviplata", "Daviplata"], ["efectivo", "Efectivo"], ["tarjeta", "Tarjeta (datáfono)"], ["otro", "Otro"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
        <label className="sm:col-span-2">Nº de comprobante (opcional)<input className={field} style={fieldStyle} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ej: M123456" /></label>
      </div>
      <label className="mt-2 block">Nota *<input className={field} style={fieldStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quién pagó y a qué cuenta" /></label>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold" style={box}>Cancelar</button>
        <button type="button" disabled={busy || note.trim().length < 3 || !plan} onClick={() => void save()} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: "#10b981" }}>{busy ? "Registrando…" : "Registrar y activar"}</button>
      </div>
    </div>
  );
}

function Plans({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<Plan | null>(null);
  return (
    <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-2xl border p-4" style={{ ...box, opacity: p.active ? 1 : 0.6 }}>
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-black">{p.name} {p.highlight ? "⭐" : ""}</p><p className="text-xs" style={muted}>{p.id} · {p.public ? "visible" : "oculto"} · {p.active ? "se vende" : "no se vende"}</p></div>
              <span className="rounded-full border px-2 py-0.5 text-xs" style={box}>{p.subscribers} cliente(s)</span>
            </div>
            <p className="mt-2 text-xl font-black">{cop(p.monthly_price)}<span className="text-xs font-normal" style={muted}> /mes · {cop(p.yearly_price)} /año</span></p>
            <p className="mt-1 text-xs" style={muted}>{p.max_products ?? "∞"} productos · {p.max_users ?? "∞"} usuarios · {p.max_points ?? "∞"} puntos · prueba {p.trial_days} d</p>
            <button type="button" onClick={() => setEdit(p)} className="mt-3 rounded-xl border px-3 py-1.5 text-xs font-bold" style={box}>Editar</button>
          </div>
        ))}
      </div>
      <p className="text-xs" style={muted}>Cambiar un precio no afecta a quien ya pagó: renueva con su precio pactado hasta que cambie de plan.</p>
      {edit ? <EditPlan p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} /> : null}
    </section>
  );
}

function EditPlan({ p, onClose, onSaved }: { p: Plan; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState({ ...p, featuresText: (p.features ?? []).join("\n") });
  const [reason, setReason] = useState("");
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\D/g, "")));
  const set = (k: keyof typeof d, v: unknown) => setD((cur) => ({ ...cur, [k]: v }));

  async function save() {
    if (reason.trim().length < 3) return void Swal.fire({ ...swal, icon: "warning", title: "Escribe el motivo del cambio" });
    const payload = { ...d, features: d.featuresText.split("\n").map((s) => s.trim()).filter(Boolean) };
    const ok = await Swal.fire({ ...swal, icon: "question", title: `Guardar ${d.name}`, text: p.subscribers ? `${p.subscribers} cliente(s) usan este plan. Los límites y módulos les cambian desde ya; el precio pactado no.` : "Se guarda el plan.", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Volver" });
    if (!ok.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("saas_admin_save_plan", { p_plan: payload, p_reason: reason.trim() });
    const r = data as { ok: boolean; error?: string } | null;
    if (!r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se guardó", text: r?.error });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92vh] w-[min(760px,100%)] overflow-y-auto rounded-3xl border p-5 text-sm shadow-2xl" style={{ ...box, background: "var(--t-bg-base, #0b0b14)" }}>
        <h3 className="text-lg font-black">Plan {p.name}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label>Nombre<input className={field} style={fieldStyle} value={d.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="sm:col-span-2">Frase<input className={field} style={fieldStyle} value={d.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} /></label>
          <label>Precio mes (COP)<input className={field} style={fieldStyle} inputMode="numeric" value={String(d.monthly_price)} onChange={(e) => set("monthly_price", num(e.target.value) ?? 0)} /></label>
          <label>Precio año (COP)<input className={field} style={fieldStyle} inputMode="numeric" value={String(d.yearly_price)} onChange={(e) => set("yearly_price", num(e.target.value) ?? 0)} /></label>
          <label>Punto adicional /mes<input className={field} style={fieldStyle} inputMode="numeric" value={d.extra_point_price ?? ""} onChange={(e) => set("extra_point_price", num(e.target.value))} placeholder="no se vende" /></label>
          {([["max_products", "Productos"], ["max_users", "Usuarios"], ["max_points", "Puntos"], ["max_catalogs", "Catálogos"]] as const).map(([k, l]) => (
            <label key={k}>{l}<input className={field} style={fieldStyle} inputMode="numeric" value={d[k] ?? ""} onChange={(e) => set(k, num(e.target.value))} placeholder="∞ ilimitado" /></label>
          ))}
          <label>Días de prueba<input className={field} style={fieldStyle} inputMode="numeric" value={String(d.trial_days)} onChange={(e) => set("trial_days", num(e.target.value) ?? 0)} /></label>
          <label>Orden<input className={field} style={fieldStyle} inputMode="numeric" value={String(d.sort_order)} onChange={(e) => set("sort_order", num(e.target.value) ?? 50)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {([["public", "Visible en precios"], ["active", "Se puede contratar"], ["highlight", "Destacado"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(d[k])} onChange={(e) => set(k, e.target.checked)} /> {l}</label>
          ))}
        </div>
        <p className="mt-3 font-semibold">Módulos incluidos</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MODULES.map((m) => {
            const on = d.modules.includes(m);
            return <button key={m} type="button" onClick={() => set("modules", on ? d.modules.filter((x) => x !== m) : [...d.modules, m])} className="rounded-full border px-2.5 py-1 text-xs font-semibold" style={on ? { background: "#8b5cf6", color: "#fff", borderColor: "transparent" } : box}>{m}</button>;
          })}
        </div>
        <label className="mt-3 block">Textos de la tarjeta (uno por línea)<textarea className={`${field} min-h-24`} style={fieldStyle} value={d.featuresText} onChange={(e) => set("featuresText", e.target.value)} /></label>
        <label className="mt-3 block">Motivo del cambio *<input className={field} style={fieldStyle} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 font-semibold" style={box}>Cerrar</button>
          <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 font-bold text-white" style={{ background: "#8b5cf6" }}>Guardar plan</button>
        </div>
      </div>
    </div>
  );
}

function Payments() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ payments: Payment[]; webhooks: Hook[] } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      void supabaseBrowser().rpc("saas_admin_payments", { p_q: q, p_limit: 200 }).then(({ data: d }) => {
        const v = d as { ok: boolean; payments: Payment[]; webhooks: Hook[] } | null;
        if (v?.ok) setData({ payments: v.payments, webhooks: v.webhooks });
      });
    }, q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [q]);
  const total = useMemo(() => (data?.payments ?? []).filter((p) => p.status === "approved").reduce((a, p) => a + Number(p.amount), 0), [data]);

  function exportCsv() {
    const rows = (data?.payments ?? []).map((p) => [p.created_at, p.reference, p.store ?? "", p.plan_id, p.period, p.amount, PAY[p.status] ?? p.status, p.provider_tx_id ?? "", p.environment]);
    const csv = ["Fecha;Referencia;Tienda;Plan;Periodo;Valor;Estado;Transacción Wompi;Entorno", ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    a.download = "pagos-remhub.csv";
    a.click();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${field} max-w-md`} style={fieldStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Referencia, tienda o transacción de Wompi" />
        <button type="button" onClick={exportCsv} className="rounded-xl border px-3 py-2 text-sm font-bold" style={box}>⬇️ Exportar</button>
        <span className="ml-auto self-center text-sm" style={muted}>Aprobado en la lista: <b style={{ color: "#10b981" }}>{cop(total)}</b></span>
      </div>
      <div className="overflow-x-auto rounded-2xl border" style={box}>
        <table className="w-full min-w-[900px] text-sm">
          <thead style={muted}><tr>{["Fecha", "Tienda", "Plan", "Valor", "Estado", "Referencia", "Transacción / comprobante", "Origen"].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.payments ?? []).map((p) => (
              <tr key={p.reference} className="border-t" style={{ borderColor: "rgba(148,163,184,.15)" }}>
                <td className="px-3 py-2 text-xs">{day(p.created_at)}</td>
                <td className="px-3 py-2">{p.store ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{p.plan_id} · {p.period === "year" ? "anual" : "mensual"}</td>
                <td className="px-3 py-2 font-semibold">{cop(p.amount)}</td>
                <td className="px-3 py-2" style={{ color: p.status === "approved" ? "#10b981" : ["declined", "error", "review"].includes(p.status) ? "#ef4444" : undefined }}>{PAY[p.status] ?? p.status}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.reference}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.provider_tx_id ?? "—"}</td>
                <td className="px-3 py-2 text-xs" title={p.note ?? undefined}>{p.provider === "manual" ? `Manual · ${p.method ?? ""}` : p.environment === "production" ? "Wompi" : "Wompi (pruebas)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.payments.length ? <p className="p-6 text-center text-sm" style={muted}>Todavía no hay pagos.</p> : null}
      </div>
      <div className="rounded-2xl border p-4" style={box}>
        <p className="mb-2 text-sm font-black">Últimos avisos de Wompi (RemHub)</p>
        <ul className="space-y-1 text-xs">
          {(data?.webhooks ?? []).map((w, i) => (
            <li key={i}><b>{day(w.at)}</b> · <span style={{ color: w.result === "applied" ? "#10b981" : w.result === "duplicate" || w.result === "ignored" ? undefined : "#ef4444" }}>{w.result ?? "—"}</span>{w.detail ? ` — ${w.detail}` : ""}{w.valid ? "" : " · firma no válida"}</li>
          ))}
          {data && !data.webhooks.length ? <li style={muted}>Sin avisos todavía.</li> : null}
        </ul>
      </div>
    </section>
  );
}

function Settings({ dash, plans, onSaved }: { dash: Dash; plans: Plan[]; onSaved: () => void }) {
  const [s, setS] = useState(dash.settings);
  async function save() {
    const r = await Swal.fire({
      ...swal, icon: (s.enforce_limits && !dash.settings.enforce_limits) || (s.enforce_modules && !dash.settings.enforce_modules) ? "warning" : "question", title: "Guardar ajustes", input: "text", inputPlaceholder: "Motivo",
      html: [s.enforce_limits && !dash.settings.enforce_limits ? "Vas a <b>encender el bloqueo de límites</b>: las tiendas que superen su plan ya no podrán crear más productos, usuarios o puntos." : "", s.enforce_modules && !dash.settings.enforce_modules ? "Vas a <b>bloquear los módulos que cada plan no incluye</b> (POS, traslados, nómina…)." : ""].filter(Boolean).join("<br><br>"),
      showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Volver",
    });
    if (!r.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("saas_admin_settings_save", { p_cfg: s, p_reason: String(r.value ?? "").trim() || "Ajustes" });
    if ((data as { ok?: boolean } | null)?.ok) onSaved();
  }
  return (
    <section className="max-w-2xl space-y-3 rounded-2xl border p-5 text-sm" style={box}>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={s.enforce_limits} onChange={(e) => setS({ ...s, enforce_limits: e.target.checked })} />
        <span><b>Bloquear al superar los límites del plan</b><br /><span style={muted}>Apagado = solo se anota cuando alguien supera su plan (para que veas el impacto antes de bloquear). Los Fundadores nunca tienen límites.</span></span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={Boolean(s.enforce_modules)} onChange={(e) => setS({ ...s, enforce_modules: e.target.checked })} />
        <span><b>Bloquear los módulos que el plan no incluye</b><br /><span style={muted}>Ej.: en Gratis no se abre el POS; en Emprendedor no hay traslados. Lo frena la base de datos, no solo la pantalla. Necesita la migración 20261213. Fundadores: todo incluido.</span></span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>Plan de la prueba<select className={field} style={fieldStyle} value={s.default_trial_plan} onChange={(e) => setS({ ...s, default_trial_plan: e.target.value })}>{plans.filter((p) => p.monthly_price > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Días de prueba<input className={field} style={fieldStyle} inputMode="numeric" value={String(s.default_trial_days)} onChange={(e) => setS({ ...s, default_trial_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
        <label>Días de gracia al vencer<input className={field} style={fieldStyle} inputMode="numeric" value={String(s.grace_days)} onChange={(e) => setS({ ...s, grace_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
      </div>
      <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 font-bold text-white" style={{ background: "#8b5cf6" }}>Guardar ajustes</button>
      <div className="border-t pt-3 text-xs" style={{ borderColor: "rgba(148,163,184,.2)", ...muted }}>
        <p className="font-bold">Cobros con Wompi de RemHub</p>
        <p>Se configuran en Vercel (nunca aquí): WOMPI_REMHUB_ENV, WOMPI_REMHUB_PUBLIC_KEY, WOMPI_REMHUB_PRIVATE_KEY, WOMPI_REMHUB_INTEGRITY_SECRET, WOMPI_REMHUB_EVENTS_SECRET. URL de eventos en Wompi: https://remhub.co/api/saas/wompi/webhook</p>
      </div>
    </section>
  );
}

/* ----------------------------- salud de las tiendas (20261224) ----------------------------- */

type HealthRow = {
  store_id: string; name: string; slug: string; whatsapp: string | null; created_at: string; plan_id: string | null; status: string | null;
  trial_ends_at: string | null; owner_email: string | null; owner_seen: string | null; last_sale: string | null; sales_7: number; total_30: number;
  products: number; users: number; health: "risk" | "start" | "ok"; reason: string;
};
const HEALTH = { risk: ["🔴", "En riesgo", "#ef4444"], start: ["🟡", "Sin arrancar", "#f59e0b"], ok: ["🟢", "Saludable", "#10b981"] } as const;

function Health() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [err, setErr] = useState("");
  const [only, setOnly] = useState<"all" | HealthRow["health"]>("all");
  useEffect(() => {
    void supabaseBrowser().rpc("saas_admin_store_health").then(({ data, error }) => {
      const r = data as { ok: boolean; error?: string; stores?: HealthRow[] } | null;
      if (error || !r?.ok) { setErr(error && /saas_admin_store_health|Could not find/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261224_salud_y_ejemplos.sql." : r?.error ?? error?.message ?? "No se pudo cargar."); setRows([]); }
      else setRows(r.stores ?? []);
    });
  }, []);
  const ago = (v: string | null) => {
    if (!v) return "nunca";
    const d = Math.floor((Date.parse(new Date().toISOString()) - Date.parse(v)) / 86400000);
    return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} d`;
  };
  const wa = (r: HealthRow) => {
    const d = (r.whatsapp ?? "").replace(/D/g, "");
    const n = d.length === 10 ? `57${d}` : d;
    if (n.length < 11) return null;
    const text = r.health === "start"
      ? `Hola! Soy de RemHub 👋 Vi que estás empezando con ${r.name}. ¿Te ayudo a subir tus productos y dejar tu catálogo listo para vender? Te tomo 10 minutos.`
      : `Hola! Soy de RemHub 👋 ¿Cómo te ha ido con ${r.name}? Si algo no te funciona o necesitas ayuda con el inventario, el POS o los traslados, cuéntame y lo resolvemos.`;
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  };
  const list = (rows ?? []).filter((r) => only === "all" || r.health === only);
  const count = (h: HealthRow["health"]) => (rows ?? []).filter((r) => r.health === h).length;
  return (
    <section className="space-y-3">
      <p className="text-sm opacity-80">Las tiendas que conviene llamar primero: las que no entran, no venden o se les acaba la prueba. Escríbeles antes de que se vayan.</p>
      <div className="flex flex-wrap gap-2 text-sm font-semibold">
        {([["all", `Todas (${rows?.length ?? 0})`], ["risk", `🔴 En riesgo (${count("risk")})`], ["start", `🟡 Sin arrancar (${count("start")})`], ["ok", `🟢 Saludables (${count("ok")})`]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setOnly(k)} className="rounded-xl border px-3 py-1.5" style={only === k ? { background: "#8b5cf6", color: "#fff", borderColor: "transparent" } : { borderColor: "rgba(148,163,184,.35)" }}>{l}</button>
        ))}
      </div>
      {err ? <p className="rounded-xl border border-amber-400/40 p-3 text-sm">⚠️ {err}</p> : null}
      {rows === null ? <p className="text-sm opacity-70">Cargando…</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((r) => {
          const [icon, label, color] = HEALTH[r.health];
          const link = wa(r);
          return (
            <div key={r.store_id} className="rounded-2xl border p-3" style={{ borderColor: `color-mix(in oklab, ${color} 40%, rgba(148,163,184,.3))` }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{r.name} <span className="text-xs font-normal opacity-70">/{r.slug}</span></p>
                  <p className="text-xs opacity-75">{r.owner_email ?? "—"} · {r.plan_id ?? "sin plan"} ({r.status ?? "—"})</p>
                </div>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>{icon} {label}</span>
              </div>
              <p className="mt-1 text-xs font-semibold" style={{ color }}>{r.reason}</p>
              <p className="mt-1 text-xs opacity-80">Entró {ago(r.owner_seen)} · última venta {ago(r.last_sale)} · {r.sales_7} ventas en 7 días · {cop(r.total_30)} en 30 días · {r.products} productos · {r.users} usuarios</p>
              {link ? <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: "#16a34a" }}>💬 Escribirle</a> : <p className="mt-2 text-[11px] opacity-60">Sin WhatsApp en la tienda.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ----------------------------- videos de ayuda (20261227) ----------------------------- */

function HelpVideos() {
  const [rows, setRows] = useState<Record<string, { title: string; url: string }>>({});
  const [err, setErr] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  useEffect(() => {
    void supabaseBrowser().from("saas_help_videos").select("screen,title,url").then(({ data, error }) => {
      if (error) return setErr(/saas_help_videos|does not exist|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261227_crecer.sql." : error.message);
      setRows(Object.fromEntries(((data ?? []) as Array<{ screen: string; title: string; url: string }>).map((r) => [r.screen, { title: r.title, url: r.url }])));
    });
  }, []);
  async function save(key: string) {
    const r = rows[key] ?? { title: "", url: "" };
    const { data, error } = await supabaseBrowser().rpc("saas_admin_help_video_save", { p_screen: key, p_title: r.title, p_url: r.url });
    const v = data as { ok: boolean; error?: string } | null;
    if (error || !v?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: v?.error ?? error?.message });
    setSavedKey(key);
    window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
  }
  return (
    <section className="space-y-3">
      <p className="text-sm opacity-80">Un video corto (30 segundos) por pantalla. Aparece en el botón «?» de esa pantalla para todas las tiendas. Sirve un enlace de YouTube (puede ser «no listado»), Vimeo o un .mp4. Deja el enlace vacío para quitarlo.</p>
      {err ? <p className="rounded-xl border border-amber-400/40 p-3 text-sm">⚠️ {err}</p> : null}
      <div className="space-y-2">
        {HELP_SCREENS.map((sc) => {
          const r = rows[sc.key] ?? { title: "", url: "" };
          return (
            <div key={sc.key} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[160px_1fr_1.4fr_auto] sm:items-center" style={{ borderColor: "rgba(148,163,184,.3)" }}>
              <b className="text-sm">{sc.title}</b>
              <input className="rounded-xl border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "rgba(148,163,184,.35)" }} placeholder="Título (ej: Cómo vender en el POS)"
                value={r.title} onChange={(e) => setRows((c) => ({ ...c, [sc.key]: { ...r, title: e.target.value } }))} />
              <input className="rounded-xl border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "rgba(148,163,184,.35)" }} placeholder="https://youtu.be/…"
                value={r.url} onChange={(e) => setRows((c) => ({ ...c, [sc.key]: { ...r, url: e.target.value.trim() } }))} />
              <button type="button" onClick={() => void save(sc.key)} className="rounded-xl px-3 py-2 text-sm font-bold text-white" style={{ background: "#8b5cf6" }}>{savedKey === sc.key ? "✅" : "Guardar"}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
