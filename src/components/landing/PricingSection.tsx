"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "framer-motion";
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

type Addon = { id: string; name: string; tagline: string | null; monthly_price: number; yearly_price: number; included_docs: number; overage_price: number; highlight: boolean };

const COP = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const lim = (n: number | null) => (n === null ? "Ilimitados" : n.toLocaleString("es-CO"));

/** Número que corre hasta su valor (al aparecer y al cambiar). Con «reducir movimiento», directo. */
function Tween({ value, format = (n: number) => n.toLocaleString("es-CO"), active = true }: { value: number; format?: (n: number) => string; active?: boolean }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const still = useReducedMotion();
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const a = from.current;
    const dur = still ? 0 : 900;
    const step = (now: number) => {
      const t = dur ? Math.min(1, (now - start) / dur) : 1;
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3));
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, active, still]);
  return <>{format(Math.round(shown))}</>;
}

/** Tarjeta que se inclina un poco siguiendo el mouse (solo con mouse; quieta con «reducir movimiento»). */
function Tilt({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || still || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg) translateY(-4px)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={className} style={{ ...style, transition: "transform .25s ease-out", transformStyle: "preserve-3d" }}>{children}</div>;
}

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
  // Facturación electrónica como adicional de cualquier plan (20261241).
  const [addons, setAddons] = useState<Addon[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.rpc("saas_public_plans").then(({ data, error }) => setPlans(error ? [] : ((data ?? []) as Plan[])));
    void sb.rpc("saas_public_addons").then(({ data, error }) => setAddons(error ? [] : ((data ?? []) as Addon[])));
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
          {(["month", "year"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} className="relative rounded-full px-5 py-2 transition" style={{ color: period === k ? "#fff" : undefined }}>
              {period === k ? <motion.span layoutId="plan-period" className="absolute inset-0 rounded-full shadow-lg" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 420, damping: 32 }} /> : null}
              <span className="relative">
                {k === "month" ? "Mensual" : "Anual"}
                {k === "year" && savings ? <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} className="ml-1 inline-block rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] text-white">−{savings}%</motion.span> : null}
              </span>
            </button>
          ))}
        </div>
        {trialPlan ? <span className="text-sm" style={{ color: "var(--t-muted)" }}><motion.span className="inline-block" animate={{ rotate: [0, 18, -12, 0], scale: [1, 1.25, 1] }} transition={{ repeat: Infinity, duration: 2.4 }}>✨</motion.span> Prueba {trialPlan.name} gratis {trialPlan.trial_days} días, sin tarjeta</span> : null}
      </div>

      <div className={`grid gap-4 ${plans.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
        {plans.map((p, pi) => {
          const price = period === "year" ? p.yearly_price : p.monthly_price;
          const free = !p.monthly_price;
          const saved = period === "year" && p.monthly_price > 0 ? p.monthly_price * 12 - p.yearly_price : 0;
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 40, rotateX: 10 }} whileInView={{ opacity: 1, y: 0, rotateX: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay: pi * 0.12, ease: [0.22, 1, 0.36, 1] }} className="h-full">
            <motion.div className="h-full" animate={p.highlight ? { y: [0, -6, 0] } : undefined} transition={p.highlight ? { repeat: Infinity, duration: 4, ease: "easeInOut" } : undefined}>
            <Tilt className={`${p.highlight ? "rh-ring" : "rh-glow"} relative h-full rounded-[2rem] p-[1.5px]`} style={{ background: p.highlight ? "var(--t-cta)" : "var(--t-card-border)", boxShadow: p.highlight ? "0 20px 60px color-mix(in oklab, var(--t-accent) 30%, transparent)" : undefined }}>
              {p.highlight ? <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2"><span className="rh-sweep block rounded-full px-3 py-1 text-xs font-bold text-white shadow" style={{ background: "var(--t-cta)" }}>Más elegido</span></span> : null}
              <div className="flex h-full flex-col rounded-[calc(2rem-1.5px)] p-6" style={{ background: "var(--t-bg-base)" }}>
                <p className="text-lg font-black">{p.name}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{p.tagline}</p>
                <p className="mt-5 text-4xl font-black tabular-nums tracking-tight">{free ? "Gratis" : <Tween value={price} format={COP} />}</p>
                <p className="text-sm" style={{ color: "var(--t-muted)" }}>{free ? "para siempre" : period === "year" ? <>al año · <Tween value={price / 12} format={COP} />/mes</> : "al mes"}</p>
                <div className="h-5">
                  {saved > 0 ? <motion.p key={period} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs font-bold text-emerald-500">ahorras {COP(saved)} al año</motion.p> : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                  {([["Productos", p.max_products], ["Usuarios", p.max_users], ["Puntos", p.max_points]] as const).map(([l, v]) => (
                    <div key={l} className="rounded-xl px-1 py-2 transition hover:-translate-y-0.5" style={{ background: "var(--t-card-bg)" }}><b className="block text-sm tabular-nums">{v === null ? "∞" : <InViewTween value={v} />}</b>{l}</div>
                  ))}
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {(p.features ?? []).map((b, bi) => (
                    <motion.li key={b} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + pi * 0.12 + bi * 0.07 }} className="flex gap-2">
                      <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 + pi * 0.12 + bi * 0.07, type: "spring", stiffness: 400 }} className="mt-0.5 shrink-0"><Check size={16} className="text-emerald-500" /></motion.span> {b}
                    </motion.li>
                  ))}
                  {p.extra_point_price ? <li className="text-xs" style={{ color: "var(--t-muted)" }}>Punto o caja adicional: {COP(p.extra_point_price)}/mes</li> : null}
                </ul>
                {/* Registro en la web; el plan pagado se contrata después desde «Mi plan» (con Wompi de RemHub). */}
                <Link
                  href={`/registro?plan=${encodeURIComponent(p.id)}`}
                  onClick={() => void supabaseBrowser().rpc("saas_track", { p_kind: "plan_click", p_store: null, p_detail: { plan: p.id, period } })}
                  className={`${p.highlight ? "rh-sweep " : ""}mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5`}
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
            </Tilt>
            </motion.div>
            </motion.div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>
        Precios en pesos colombianos. Pagas el mes o el año por adelantado (transferencia, Nequi o pago en línea); no hay cobros automáticos escondidos.
        ¿Ya tienes tienda? <Link href="/dashboard/plan" className="font-bold underline">Mira y cambia tu plan</Link>.
      </p>

      {addons.length ? (
        <div className="rh-glow mt-10 rounded-[2rem] border p-6" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--t-muted)" }}>Adicional para cualquier plan</p>
            <h3 className="mt-1 text-2xl font-black"><motion.span className="inline-block" animate={{ y: [0, -4, 0], rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.6 }}>🧾</motion.span> Facturación electrónica DIAN</h3>
            <p className="mx-auto mt-1 max-w-2xl text-sm" style={{ color: "var(--t-muted)" }}>Factura electrónica y documento equivalente POS desde tu caja, con proveedor autorizado por la DIAN. Actívalo solo si lo necesitas y escoge cuántos documentos al mes.</p>
            <DianFlow />
          </div>
          <div className={`mt-5 grid gap-3 ${addons.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            {addons.map((a, ai) => {
              const price = period === "year" ? a.yearly_price : a.monthly_price;
              return (
                <motion.div key={a.id} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: ai * 0.1 }} className="h-full">
                <motion.div className="h-full" animate={a.highlight ? { y: [0, -5, 0] } : undefined} transition={a.highlight ? { repeat: Infinity, duration: 4, ease: "easeInOut" } : undefined}>
                <Tilt className={`${a.highlight ? "rh-ring" : "rh-glow"} relative h-full rounded-2xl p-[1.5px]`} style={{ background: a.highlight ? "var(--t-cta)" : "var(--t-card-border)" }}>
                <div className="relative flex h-full flex-col rounded-[calc(1rem-1.5px)] p-5" style={{ background: "var(--t-bg-base)" }}>
                  {a.highlight ? <span className="absolute -top-3 left-5 z-10"><span className="rh-sweep block rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: "var(--t-cta)" }}>Más elegido</span></span> : null}
                  <p className="font-black">{a.name}</p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{a.tagline}</p>
                  <p className="mt-3 text-3xl font-black tabular-nums">+<Tween value={price} format={COP} /></p>
                  <p className="text-xs" style={{ color: "var(--t-muted)" }}>{period === "year" ? `al año · ${COP(price / 12)}/mes` : "al mes"}</p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {[`${a.included_docs.toLocaleString("es-CO")} documentos al mes`, `Documento extra: ${COP(a.overage_price)}`, "Factura, POS, notas crédito y débito"].map((t, ti) => (
                      <motion.li key={t} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + ai * 0.1 + ti * 0.08 }} className="flex gap-2">
                        <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 + ai * 0.1 + ti * 0.08, type: "spring", stiffness: 400 }} className="mt-0.5 shrink-0"><Check size={16} className="text-emerald-500" /></motion.span> {t}
                      </motion.li>
                    ))}
                  </ul>
                  <DocsMeter included={a.included_docs} delay={ai * 0.2} />
                </div>
                </Tilt>
                </motion.div>
                </motion.div>
              );
            })}
          </div>
          <p className="mt-3 text-center text-xs" style={{ color: "var(--t-muted)" }}>Cuentan los documentos aceptados por la DIAN en el mes. Si te pasas, cada documento extra se cobra al cerrar el mes. Lo activas desde «Mi plan».</p>
        </div>
      ) : null}

      <div className="mt-6 text-center">
        <button type="button" onClick={() => setShowTable((v) => !v)} className="rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }} aria-expanded={showTable}>
          {showTable ? "Ocultar comparación" : "Comparar todos los planes"}
        </button>
      </div>
      {showTable ? (
        <div className="rh-glow mt-4 overflow-x-auto rounded-3xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
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
                      {mod === "fiscal" && addons.length ? <span className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Adicional</span> : p.modules?.includes(mod) ? <Check size={18} className="mx-auto text-emerald-500" aria-label="Incluido" /> : <Minus size={18} className="mx-auto opacity-30" aria-label="No incluido" />}
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

/** Número que corre cuando aparece en pantalla. */
function InViewTween({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  return <span ref={ref}><Tween value={value} active={inView} /></span>;
}

/** Flujo de una factura: tu caja → proveedor autorizado → DIAN, y vuelve aceptada con su CUFE. Decorativo. */
function DianFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-40px" });
  const still = useReducedMotion();
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!inView || still) return;
    const t = window.setInterval(() => setK((x) => x + 1), 900);
    return () => window.clearInterval(t);
  }, [inView, still]);
  const s = still ? 5 : k % 7; // 0-1 caja→proveedor, 2-3 proveedor→DIAN, 4+ aceptada
  const n = 1042 + Math.floor(k / 7);
  const cufe = "8f3ac91e7b20d4f6a19c3e5b".slice(0, s >= 4 ? Math.min(24, (s - 3) * 9) : 0);
  const nodes = ["🧾 Tu caja", "🔐 Proveedor autorizado", "🏛️ DIAN"];
  const at = s <= 1 ? 0 : s <= 3 ? 1 : 2;
  return (
    <div ref={ref} aria-hidden className="mx-auto mt-4 max-w-2xl rounded-2xl border p-3 font-mono text-[11px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
      <div className="relative flex items-center justify-between gap-2">
        <div className="absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ background: "var(--t-card-border)" }}>
          <motion.div animate={{ width: `${s >= 4 ? 100 : (s / 4) * 100}%` }} transition={{ duration: 0.8 }} className="h-full rounded" style={{ background: "var(--t-cta)" }} />
          {s < 4 ? <motion.span animate={{ left: `${(s / 4) * 100}%` }} transition={{ duration: 0.8 }} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" /> : null}
        </div>
        {nodes.map((t, i) => (
          <span key={t} className="relative z-10 rounded-full border px-2.5 py-1 font-sans text-[11px] font-bold transition" style={{ borderColor: i <= at ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)", boxShadow: i === at && s < 4 ? "0 0 14px color-mix(in oklab, var(--t-accent) 50%, transparent)" : "none" }}>{t}</span>
        ))}
      </div>
      <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1" style={{ color: "var(--t-muted)" }}>
        <span style={{ color: "var(--t-text)" }}>FE-{n}</span>
        {s < 4 ? <span>{s <= 1 ? "firmando…" : "validando con la DIAN…"}</span> : (
          <>
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-full bg-emerald-500 px-2 py-0.5 font-sans font-bold text-white">✓ aceptada</motion.span>
            <span>CUFE {cufe}<span className="dfx-caret ml-0.5 inline-block h-3 w-1.5 align-middle" style={{ background: "var(--t-accent)" }} /></span>
          </>
        )}
      </p>
    </div>
  );
}

/** Consumo de ejemplo del mes: la barra se llena hasta el 72 % de los documentos incluidos. */
function DocsMeter({ included, delay = 0 }: { included: number; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const used = Math.round(included * 0.72);
  return (
    <div ref={ref} className="mt-4 rounded-xl p-2.5 text-[11px]" style={{ background: "var(--t-card-bg)" }}>
      <p className="flex justify-between" style={{ color: "var(--t-muted)" }}>
        <span>Ejemplo de consumo del mes</span>
        <b className="tabular-nums" style={{ color: "var(--t-text)" }}><Tween value={used} active={inView} /> / {included.toLocaleString("es-CO")}</b>
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
        <motion.div initial={{ width: 0 }} animate={{ width: inView ? "72%" : 0 }} transition={{ duration: 1.4, delay: 0.3 + delay, ease: "easeOut" }} className="h-full rounded-full" style={{ background: "var(--t-cta)" }} />
      </div>
    </div>
  );
}
