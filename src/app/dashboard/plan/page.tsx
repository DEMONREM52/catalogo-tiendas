"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getDashboardStore } from "@/lib/store-utils";
import { ReferralCard } from "./ReferralCard";

/**
 * «Mi plan»: plan y estado de la tienda, días de prueba, consumo frente a los límites, comparación de planes,
 * contratar con Wompi (de RemHub), historial de pagos y cancelar. Necesita 20261211_saas_planes_suscripciones.sql.
 */

type Ent = {
  ok: boolean; error?: string;
  plan: { id: string; name: string; monthly_price: number; yearly_price: number };
  status: string; subscription_plan: string | null; period_end: string | null; trial_ends_at: string | null; trial_days_left: number | null;
  cancel_at_period_end: boolean;
  limits: { products: number | null; users: number | null; points: number | null; catalogs: number | null };
  usage: { products: number; users: number; points: number; catalogs: number };
  modules: string[]; enforce: boolean; trial_available: boolean;
};
type Plan = {
  id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number;
  max_products: number | null; max_users: number | null; max_points: number | null; max_catalogs: number | null;
  extra_point_price: number | null; features: string[]; trial_days: number; highlight: boolean;
};
type Pay = { reference: string; plan_id: string; period: string; amount: number; status: string; method: string | null; created_at: string; approved_at: string | null };

// WhatsApp de RemHub para contratar mientras no hay pagos en línea (NEXT_PUBLIC_REMHUB_WHATSAPP lo cambia).
const REMHUB_WHATSAPP = process.env.NEXT_PUBLIC_REMHUB_WHATSAPP || "573218846041";
const cop = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const STATUS: Record<string, [string, string]> = {
  free: ["Plan gratis", "#94a3b8"], trialing: ["En prueba", "#8b5cf6"], active: ["Activo", "#10b981"], payment_pending: ["Pago pendiente", "#f59e0b"],
  past_due: ["Vencido · días de gracia", "#f59e0b"], canceled: ["Cancelado · no se renueva", "#f97316"], expired: ["Vencido", "#ef4444"], suspended: ["Suspendido", "#ef4444"],
};
const PAY: Record<string, string> = { created: "Sin pagar", pending: "Pendiente", approved: "Aprobado", declined: "Rechazado", voided: "Anulado", error: "Error", refunded: "Reembolsado", review: "En revisión" };
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export default function PlanPage() {
  return <Suspense fallback={<main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</main>}><PlanView /></Suspense>;
}

function PlanView() {
  const params = useSearchParams();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [ent, setEnt] = useState<Ent | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("year");
  const [busy, setBusy] = useState<string | null>(null);
  const ref = params.get("ref");

  const load = useCallback(async (store: string) => {
    const sb = supabaseBrowser();
    const [e, p, h] = await Promise.all([
      sb.rpc("saas_entitlements", { p_store: store }),
      sb.rpc("saas_public_plans"),
      sb.rpc("saas_my_payments", { p_store: store }),
    ]);
    if (e.error) return setError(/saas_entitlements|Could not find/i.test(e.error.message) ? "Falta ejecutar en Supabase la migración 20261211_saas_planes_suscripciones.sql." : e.error.message);
    const v = e.data as Ent;
    if (!v?.ok) return setError(v?.error ?? "No se pudo cargar tu plan.");
    setError(null);
    setEnt(v);
    setPlans((p.data ?? []) as Plan[]);
    setPays((h.data ?? []) as Pay[]);
  }, []);

  useEffect(() => {
    void (async () => {
      const access = await getDashboardStore().catch(() => null);
      if (!access?.store) return setError("No encontramos tu tienda.");
      setStoreId(access.store.id);
      setOwner(Boolean(access.isOwner));
      await load(access.store.id);
      void supabaseBrowser().rpc("saas_track", { p_kind: "pricing_view", p_store: access.store.id, p_detail: { from: "mi_plan" } });
    })();
  }, [load]);

  // Volvió de Wompi: se revisa unos segundos hasta que llegue la confirmación (el aviso de Wompi activa el plan).
  useEffect(() => {
    if (!ref || !storeId) return;
    let tries = 0;
    const t = window.setInterval(async () => {
      tries++;
      await load(storeId);
      const done = pays.find((p) => p.reference === ref && ["approved", "declined", "voided", "error"].includes(p.status));
      if (done || tries > 12) window.clearInterval(t);
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, storeId]);

  const refPay = ref ? pays.find((p) => p.reference === ref) : null;

  async function startTrial() {
    if (!storeId) return;
    setBusy("trial");
    const { data, error: e } = await supabaseBrowser().rpc("saas_trial_start", { p_store: storeId });
    setBusy(null);
    const r = data as { ok: boolean; error?: string; ends_at?: string } | null;
    if (e || !r?.ok) return void Swal.fire({ ...swal, icon: "warning", title: "No se pudo empezar la prueba", text: r?.error ?? e?.message });
    await Swal.fire({ ...swal, icon: "success", title: "¡Tu prueba empezó!", text: `Tienes el plan Negocio completo hasta el ${date(r.ends_at ?? null)}. No te cobramos nada.` });
    void load(storeId);
  }

  async function buy(plan: Plan) {
    if (!storeId) return;
    const price = period === "year" ? plan.yearly_price : plan.monthly_price;
    const ok = await Swal.fire({
      ...swal, icon: "question", title: `Contratar ${plan.name}`, showCancelButton: true, confirmButtonText: "Continuar", cancelButtonText: "Volver",
      html: `<p>${cop(price)} ${period === "year" ? "por un año" : "por un mes"}.</p><p style="font-size:12px;opacity:.75;margin-top:8px">Pagas por adelantado de forma segura. Tu plan se activa apenas se confirme el pago. No es un cobro automático: te avisamos antes de que venza para renovar.</p>`,
    });
    if (!ok.isConfirmed) return;
    setBusy(plan.id);
    void supabaseBrowser().rpc("saas_track", { p_kind: "plan_click", p_store: storeId, p_detail: { plan: plan.id, period } });
    const { data: s } = await supabaseBrowser().auth.getSession();
    const res = await fetch("/api/saas/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
      body: JSON.stringify({ storeId, plan: plan.id, period }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !j?.url) {
      // Sin pagos en línea todavía (o falló): se contrata por WhatsApp y RemHub lo activa a mano (Admin → Suscripciones).
      const text = `Hola! Quiero contratar el plan ${plan.name} de RemHub (${period === "year" ? "anual" : "mensual"}, ${cop(price)}) para mi tienda. ¿Cómo pago?`;
      const r = await Swal.fire({
        ...swal, icon: "info", title: "Contrátalo por WhatsApp",
        html: "Por ahora activamos los planes por WhatsApp: te enviamos los datos para pagar (transferencia o Nequi) y lo dejamos activo apenas recibamos el pago.",
        showCancelButton: true, confirmButtonText: "💬 Escribir por WhatsApp", cancelButtonText: "Ahora no", confirmButtonColor: "#22c55e",
      });
      if (r.isConfirmed) window.open(`https://wa.me/${REMHUB_WHATSAPP}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      return;
    }
    window.location.href = j.url;
  }

  async function cancel() {
    if (!storeId || !ent) return;
    const r = await Swal.fire({
      ...swal, icon: "warning", title: "¿Cancelar la renovación?", input: "text", inputPlaceholder: "¿Por qué te vas? (opcional)",
      html: `Sigues con <b>${ent.plan.name}</b> hasta el <b>${date(ent.period_end)}</b>. Después pasas al plan Gratis: <b>no se borra nada</b> y puedes volver cuando quieras.`,
      showCancelButton: true, confirmButtonText: "Sí, cancelar", cancelButtonText: "Seguir con mi plan", confirmButtonColor: "#ef4444",
    });
    if (!r.isConfirmed) return;
    const { data } = await supabaseBrowser().rpc("saas_cancel", { p_store: storeId, p_reason: String(r.value ?? "") });
    const v = data as { ok: boolean; error?: string } | null;
    if (!v?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo cancelar", text: v?.error });
    void load(storeId);
  }

  const st = ent ? STATUS[ent.status] ?? [ent.status, "#94a3b8"] : null;
  const savings = useMemo(() => {
    const p = plans.find((x) => x.monthly_price > 0);
    return p && p.yearly_price ? Math.round((1 - p.yearly_price / (p.monthly_price * 12)) * 100) : 0;
  }, [plans]);

  if (error) return <main className="mx-auto max-w-5xl p-6"><p className="rounded-2xl border p-4 text-sm" style={card}>{error}</p></main>;
  if (!ent) return <main className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando tu plan…</main>;

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
      {/* Resultado del pago al volver de Wompi */}
      {ref ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ ...card, borderColor: refPay?.status === "approved" ? "#10b981" : refPay?.status === "declined" ? "#ef4444" : "var(--t-card-border)" }}>
          {refPay?.status === "approved" ? <>✅ <b>¡Pago aprobado!</b> Tu plan ya está activo. Gracias por confiar en RemHub.</>
            : refPay?.status === "declined" || refPay?.status === "error" || refPay?.status === "voided" ? <>❌ <b>El pago no se aprobó</b> ({PAY[refPay.status]}). No se cobró nada; puedes intentarlo de nuevo.</>
            : <>⏳ <b>Estamos confirmando tu pago con Wompi…</b> Esto tarda unos segundos. Puedes quedarte aquí o volver más tarde.</>}
        </div>
      ) : null}

      {/* Plan actual */}
      <section className="rounded-3xl border p-5" style={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Tu plan</p>
            <h1 className="mt-1 text-3xl font-black">{ent.plan.name}</h1>
            <span className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold" style={{ background: `color-mix(in oklab, ${st![1]} 18%, transparent)`, color: st![1] }}>{st![0]}</span>
          </div>
          <div className="text-right text-sm">
            {ent.status === "trialing" ? (
              <><p className="text-4xl font-black" style={{ color: "#8b5cf6" }}>{ent.trial_days_left}</p><p style={{ color: "var(--t-muted)" }}>día(s) de prueba · hasta {date(ent.trial_ends_at)}</p></>
            ) : ent.period_end ? (
              <p style={{ color: "var(--t-muted)" }}>{ent.cancel_at_period_end ? "Termina el" : "Renueva el"} <b style={{ color: "var(--t-text)" }}>{date(ent.period_end)}</b></p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([["products", "Productos"], ["users", "Usuarios"], ["points", "Puntos y bodegas"], ["catalogs", "Catálogos"]] as const).map(([k, label]) => {
            const max = ent.limits[k];
            const used = Number(ent.usage[k] ?? 0);
            const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
            return (
              <div key={k} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                <div className="flex justify-between text-xs"><span style={{ color: "var(--t-muted)" }}>{label}</span><b>{used.toLocaleString("es-CO")} / {max === null ? "∞" : max.toLocaleString("es-CO")}</b></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: max === null ? "100%" : `${pct}%`, background: max === null ? "linear-gradient(90deg,#10b981,#3987e5)" : pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "linear-gradient(90deg,#8b5cf6,#3987e5)", opacity: max === null ? 0.35 : 1 }} />
                </div>
                {max !== null && pct >= 80 ? <p className="mt-1 text-[11px]" style={{ color: pct >= 100 ? "#ef4444" : "#f59e0b" }}>{pct >= 100 ? "Llegaste al límite de tu plan" : "Ya casi llegas al límite"}</p> : null}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {ent.trial_available && owner && ent.status === "free" ? (
            <button type="button" disabled={busy === "trial"} onClick={() => void startTrial()} className="rounded-2xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60" style={{ background: "linear-gradient(135deg,#8b5cf6,#3987e5)" }}>
              {busy === "trial" ? "Activando…" : "✨ Probar el plan Negocio 7 días gratis"}
            </button>
          ) : null}
          {owner && (ent.status === "active" || ent.status === "past_due") && !ent.cancel_at_period_end ? (
            <button type="button" onClick={() => void cancel()} className="rounded-2xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Cancelar renovación</button>
          ) : null}
        </div>
        {!owner ? <p className="mt-3 text-xs" style={{ color: "var(--t-muted)" }}>Solo el dueño de la tienda puede contratar o cambiar el plan.</p> : null}
      </section>

      {storeId ? <ReferralCard storeId={storeId} /> : null}

      {/* Planes */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-black">Planes</h2>
          <div className="inline-flex rounded-full border p-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            <button type="button" onClick={() => setPeriod("month")} className="rounded-full px-4 py-1.5 transition" style={period === "month" ? { background: "var(--t-accent)", color: "#fff" } : undefined}>Mensual</button>
            <button type="button" onClick={() => setPeriod("year")} className="rounded-full px-4 py-1.5 transition" style={period === "year" ? { background: "var(--t-accent)", color: "#fff" } : undefined}>Anual {savings ? `· ahorra ${savings}%` : ""}</button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((p) => {
            const current = ent.plan.id === p.id && ent.status !== "trialing";
            const price = period === "year" ? p.yearly_price : p.monthly_price;
            return (
              <div key={p.id} className="relative flex flex-col rounded-3xl border p-5 transition hover:-translate-y-1" style={{ ...card, borderColor: p.highlight ? "color-mix(in oklab, var(--t-accent) 60%, transparent)" : card.borderColor, boxShadow: p.highlight ? "0 18px 50px -24px var(--t-accent)" : undefined }}>
                {p.highlight ? <span className="absolute -top-3 left-5 rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: "var(--t-accent)" }}>Recomendado</span> : null}
                <p className="text-lg font-black">{p.name}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.tagline}</p>
                <p className="mt-3 text-3xl font-black">{price ? cop(price) : "Gratis"}</p>
                <p className="text-xs" style={{ color: "var(--t-muted)" }}>{price ? (period === "year" ? `al año · equivale a ${cop(price / 12)}/mes` : "al mes") : "para siempre"}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {(p.features ?? []).map((f) => <li key={f}>✓ {f}</li>)}
                  {p.extra_point_price ? <li className="text-xs" style={{ color: "var(--t-muted)" }}>Punto adicional: {cop(p.extra_point_price)}/mes</li> : null}
                </ul>
                {current ? (
                  <span className="mt-4 rounded-2xl border px-4 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Tu plan actual</span>
                ) : price && owner ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void buy(p)} className="mt-4 rounded-2xl px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60" style={{ background: p.highlight ? "linear-gradient(135deg,#8b5cf6,#d946ef)" : "var(--t-accent)" }}>
                    {busy === p.id ? "Abriendo pago…" : ent.plan.id === p.id ? "Renovar" : "Elegir este plan"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--t-muted)" }}>Precios en pesos colombianos. Pagas por adelantado el mes o el año; no hay cobros automáticos escondidos. Si cancelas, conservas tus datos.</p>
      </section>

      {/* Historial */}
      {pays.length ? (
        <section className="rounded-3xl border p-5" style={card}>
          <h2 className="mb-3 text-lg font-black">Pagos</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead style={{ color: "var(--t-muted)" }}><tr>{["Fecha", "Plan", "Periodo", "Valor", "Estado", "Referencia"].map((h) => <th key={h} className="px-2 py-1.5 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.reference} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                    <td className="px-2 py-1.5">{date(p.created_at)}</td>
                    <td className="px-2 py-1.5">{plans.find((x) => x.id === p.plan_id)?.name ?? p.plan_id}</td>
                    <td className="px-2 py-1.5">{p.period === "year" ? "Anual" : "Mensual"}</td>
                    <td className="px-2 py-1.5 font-semibold">{cop(p.amount)}</td>
                    <td className="px-2 py-1.5" style={{ color: p.status === "approved" ? "#10b981" : p.status === "declined" ? "#ef4444" : undefined }}>{PAY[p.status] ?? p.status}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{p.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
