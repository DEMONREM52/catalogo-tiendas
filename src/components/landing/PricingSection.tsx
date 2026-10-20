"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Planes de la página principal, leídos de la base (saas_public_plans): un solo lugar para precios y límites.
 * Sin la migración 20261211 muestra los planes de siempre (y se contrata por WhatsApp).
 */

type Plan = {
  id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number;
  max_products: number | null; max_users: number | null; max_points: number | null; max_catalogs: number | null;
  extra_point_price: number | null; modules: string[]; features: string[]; trial_days: number; highlight: boolean;
};

const COP = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const lim = (n: number | null) => (n === null ? "Ilimitados" : n.toLocaleString("es-CO"));

// Funciones reales de RemHub y el módulo que las habilita (para la tabla comparativa).
const ROWS: Array<[string, string]> = [
  ["Catálogos con tu enlace y pedidos por WhatsApp", "catalog"],
  ["POS, caja y comprobantes", "pos"],
  ["Inventario con ingreso de facturas", "inventory"],
  ["Varios puntos y bodegas", "points"],
  ["Traslados con firma y pedidos internos", "transfers"],
  ["Rentabilidad y precios por punto", "profit"],
  ["Gastos e informes", "expenses"],
  ["Crédito bodega → puntos y liquidaciones", "internal_credit"],
  ["Nómina", "payroll"],
  ["Facturación electrónica", "fiscal"],
  ["Auditoría completa", "audit"],
  ["Dominio propio", "custom_domain"],
];

export function PricingSection({ waLink, fallback }: { waLink: (message: string) => string; fallback?: React.ReactNode }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("year");
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.rpc("saas_public_plans").then(({ data, error }) => setPlans(error ? [] : ((data ?? []) as Plan[])));
    void sb.rpc("saas_track", { p_kind: "pricing_view", p_store: null, p_detail: { from: "inicio" } });
  }, []);

  const savings = useMemo(() => {
    const p = (plans ?? []).find((x) => x.monthly_price > 0 && x.yearly_price > 0);
    return p ? Math.round((1 - p.yearly_price / (p.monthly_price * 12)) * 100) : 0;
  }, [plans]);

  if (plans === null) return <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-96 animate-pulse rounded-[2rem]" style={{ background: "var(--t-card-bg)" }} />)}</div>;
  if (!plans.length) return <>{fallback ?? null}</>;

  const trialPlan = plans.find((p) => p.trial_days > 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
        <div className="inline-flex rounded-full border p-1 text-sm font-bold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }} role="group" aria-label="Periodo de pago">
          <button type="button" onClick={() => setPeriod("month")} aria-pressed={period === "month"} className="rounded-full px-5 py-2 transition" style={period === "month" ? { background: "var(--t-cta)", color: "#fff" } : undefined}>Mensual</button>
          <button type="button" onClick={() => setPeriod("year")} aria-pressed={period === "year"} className="rounded-full px-5 py-2 transition" style={period === "year" ? { background: "var(--t-cta)", color: "#fff" } : undefined}>
            Anual {savings ? <span className="ml-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] text-white">−{savings}%</span> : null}
          </button>
        </div>
        {trialPlan ? <span className="text-sm" style={{ color: "var(--t-muted)" }}>✨ Prueba {trialPlan.name} gratis {trialPlan.trial_days} días, sin tarjeta</span> : null}
      </div>

      <div className={`grid gap-4 ${plans.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
        {plans.map((p) => {
          const price = period === "year" ? p.yearly_price : p.monthly_price;
          const free = !p.monthly_price;
          return (
            <div key={p.id} className="relative h-full rounded-[2rem] p-[1.5px] transition duration-300 hover:-translate-y-1" style={{ background: p.highlight ? "var(--t-cta)" : "var(--t-card-border)" }}>
              {p.highlight ? <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold text-white shadow" style={{ background: "var(--t-cta)" }}>Más elegido</span> : null}
              <div className="flex h-full flex-col rounded-[calc(2rem-1.5px)] p-6" style={{ background: "var(--t-bg-base)" }}>
                <p className="text-lg font-black">{p.name}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{p.tagline}</p>
                <p className="mt-5 text-4xl font-black tracking-tight">{free ? "Gratis" : COP(price)}</p>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>{free ? "para siempre" : period === "year" ? `al año · ${COP(price / 12)}/mes` : "al mes"}</p>
                <div className="mt-4 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                  {([["Productos", p.max_products], ["Usuarios", p.max_users], ["Puntos", p.max_points]] as const).map(([l, v]) => (
                    <div key={l} className="rounded-xl px-1 py-2" style={{ background: "var(--t-card-bg)" }}><b className="block text-sm">{v === null ? "∞" : v.toLocaleString("es-CO")}</b>{l}</div>
                  ))}
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {(p.features ?? []).map((b) => <li key={b} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {b}</li>)}
                </ul>
                {/* Registro en la web; el plan pagado se contrata después desde «Mi plan» (con Wompi de RemHub). */}
                <Link
                  href={`/registro?plan=${encodeURIComponent(p.id)}`}
                  onClick={() => void supabaseBrowser().rpc("saas_track", { p_kind: "plan_click", p_store: null, p_detail: { plan: p.id, period } })}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5"
                  style={p.highlight ? { background: "var(--t-cta)", color: "#fff" } : { border: "1px solid var(--t-card-border)", background: "var(--t-card-bg)" }}
                >
                  {free ? "Crear mi tienda gratis" : p.trial_days ? `Probar ${p.trial_days} días gratis` : `Empezar con ${p.name}`}
                </Link>
                <a
                  href={waLink(`Hola! Tengo una pregunta sobre el plan ${p.name} de RemHub (${free ? "gratis" : `${COP(price)} ${period === "year" ? "al año" : "al mes"}`}).`)}
                  target="_blank" rel="noreferrer" className="mt-2 text-center text-xs underline" style={{ color: "var(--t-muted)" }}
                >
                  ¿Dudas? Escríbenos por WhatsApp
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>
        Precios en pesos colombianos. Pagas el mes o el año por adelantado (transferencia, Nequi o pago en línea); no hay cobros automáticos escondidos.
        ¿Ya tienes tienda? <Link href="/dashboard/plan" className="font-bold underline">Mira y cambia tu plan</Link>.
      </p>

      <div className="mt-6 text-center">
        <button type="button" onClick={() => setShowTable((v) => !v)} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }} aria-expanded={showTable}>
          {showTable ? "Ocultar comparación" : "Comparar todos los planes"}
        </button>
      </div>
      {showTable ? (
        <div className="mt-4 overflow-x-auto rounded-3xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><th className="p-3 text-left" />{plans.map((p) => <th key={p.id} className="p-3 text-center font-black">{p.name}</th>)}</tr></thead>
            <tbody>
              {([["Productos", "max_products"], ["Usuarios", "max_users"], ["Puntos y bodegas", "max_points"], ["Catálogos", "max_catalogs"]] as const).map(([label, key]) => (
                <tr key={key} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="p-3">{label}</td>
                  {plans.map((p) => <td key={p.id} className="p-3 text-center font-semibold">{lim(p[key])}</td>)}
                </tr>
              ))}
              {ROWS.map(([label, mod]) => (
                <tr key={mod} className="border-t" style={{ borderColor: "var(--t-card-border)" }}>
                  <td className="p-3">{label}</td>
                  {plans.map((p) => (
                    <td key={p.id} className="p-3 text-center">
                      {p.modules?.includes(mod) ? <Check size={18} className="mx-auto text-emerald-500" aria-label="Incluido" /> : <Minus size={18} className="mx-auto opacity-30" aria-label="No incluido" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
