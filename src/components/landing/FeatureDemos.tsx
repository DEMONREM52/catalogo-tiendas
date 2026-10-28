"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";

/**
 * Ejemplos animados para las tarjetas de «Funciones»: cada una muestra en pequeño lo que hace.
 * Datos de ejemplo, decorativos (aria-hidden). Solo se mueven mientras la tarjeta está en pantalla
 * y quedan quietos con «reducir movimiento».
 */

const COP = (n: number) => `$${n.toLocaleString("es-CO")}`;
const soft = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" };
const muted = { color: "var(--t-muted)" };

/** Paso que avanza cada `ms` mientras el ejemplo se ve. */
function useStep(ms: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20px" });
  const still = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || still) return;
    const t = window.setInterval(() => setStep((s) => s + 1), ms);
    return () => window.clearInterval(t);
  }, [inView, still, ms]);
  return { ref, step };
}

function Frame({ children, frameRef }: { children: ReactNode; frameRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={frameRef} aria-hidden className="relative mt-4 h-24 overflow-hidden rounded-2xl border p-2.5 text-[11px]" style={soft}>
      {children}
    </div>
  );
}

const Pill = ({ children, on, color = "var(--t-accent)" }: { children: ReactNode; on?: boolean; color?: string }) => (
  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold transition-all duration-300" style={{ background: on ? color : "color-mix(in oklab, var(--t-text) 8%, transparent)", color: on ? "#fff" : "var(--t-muted)" }}>{children}</span>
);

/* ---------------------------------------------------------------- uno por función */

function LandingDemo() {
  const { ref, step } = useStep(1600);
  const orders = 12 + step;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full gap-2.5">
        <div className="relative w-14 shrink-0 rounded-lg border p-1" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
          <div className="h-6 rounded bg-gradient-to-br from-fuchsia-500/60 to-violet-500/60" />
          <div className="mt-1 h-1 w-3/4 rounded" style={{ background: "var(--t-card-border)" }} />
          <motion.div key={step} initial={{ scale: 1 }} animate={{ scale: [1, 0.85, 1.08, 1] }} transition={{ duration: 0.5 }} className="mt-1.5 rounded py-0.5 text-center text-[7px] font-black text-white" style={{ background: "var(--t-cta)" }}>COMPRAR</motion.div>
          <motion.span key={`c${step}`} initial={{ opacity: 0, x: 14, y: 10 }} animate={{ opacity: [0, 1, 1, 0], x: 18, y: 26 }} transition={{ duration: 0.9 }} className="absolute left-4 top-6 text-sm">👆</motion.span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <p style={muted}>Pedidos de la campaña</p>
          <motion.p key={orders} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-xl font-black">{orders}</motion.p>
          <p className="font-bold text-emerald-500">Ganancia {COP(orders * 41800)}</p>
        </div>
      </div>
    </Frame>
  );
}

function PixelDemo() {
  const { ref, step } = useStep(900);
  const evs = ["PageView", "ViewContent", "AddToCart", "Purchase"];
  const at = step % (evs.length + 2);
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {evs.map((e, i) => <span key={e} className="flex items-center gap-1"><Pill on={i < at} color={e === "Purchase" ? "#10b981" : undefined}>{e}{e === "Purchase" && i < at ? " ✓" : ""}</Pill>{i < evs.length - 1 ? <span style={muted}>→</span> : null}</span>)}
        </div>
        <p style={muted}>Navegador <b className="text-emerald-500">✓</b> · Servidor (CAPI) <b className={at >= evs.length ? "text-emerald-500" : ""}>{at >= evs.length ? "✓" : "…"}</b> · sin duplicados</p>
      </div>
    </Frame>
  );
}

function CatalogsDemo() {
  const { ref, step } = useStep(1500);
  const cats = [["Detal", 60000], ["Por mayor", 45000], ["VIP", 52000]] as const;
  const on = step % cats.length;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full items-center justify-center gap-2">
        {cats.map(([n, p], i) => (
          <motion.div key={n} animate={{ y: i === on ? -6 : 0, scale: i === on ? 1.06 : 1 }} className="w-[30%] rounded-xl border p-1.5 text-center" style={{ borderColor: i === on ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <div className="mx-auto mb-1 h-5 w-5 rounded-md bg-gradient-to-br from-violet-500/50 to-pink-500/50" />
            <p className="truncate font-bold">{n}</p>
            <p className={i === on ? "font-black text-emerald-500" : ""} style={i === on ? undefined : muted}>{COP(p)}</p>
          </motion.div>
        ))}
      </div>
    </Frame>
  );
}

function CampaignsDemo() {
  const { ref, step } = useStep(1700);
  const slides = [["−20 % HOY", "from-pink-500 to-orange-400"], ["2 × 1", "from-violet-600 to-fuchsia-500"], ["Envío gratis", "from-emerald-500 to-cyan-500"]] as const;
  const i = step % slides.length;
  return (
    <Frame frameRef={ref}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={i} initial={{ x: "105%" }} animate={{ x: 0 }} exit={{ x: "-105%" }} transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className={`absolute inset-2.5 grid place-items-center rounded-xl bg-gradient-to-r ${slides[i][1]} text-lg font-black text-white`}>
          {slides[i][0]}
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-1">{slides.map((_, j) => <span key={j} className="h-1 w-3 rounded-full" style={{ background: j === i ? "#fff" : "rgba(255,255,255,.4)" }} />)}</div>
    </Frame>
  );
}

function WhatsAppDemo() {
  const { ref, step } = useStep(1300);
  const s = step % 4;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-1.5">
        <AnimatePresence>
          {s >= 1 ? <motion.div key="pedido" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-emerald-500/20 px-2 py-1">🛒 Pedido #89 · 2 productos · <b>{COP(124200)}</b></motion.div> : null}
          {s >= 2 ? <motion.div key="respuesta" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="max-w-[85%] rounded-xl rounded-bl-sm px-2 py-1" style={{ background: "var(--t-card-bg)" }}>¡Recibido! Te lo enviamos hoy 🚚 <span className="text-sky-500">✓✓</span></motion.div> : null}
        </AnimatePresence>
        {s === 0 ? <p className="text-center" style={muted}>escribiendo<span className="dh-dot">.</span><span className="dh-dot" style={{ animationDelay: ".2s" }}>.</span><span className="dh-dot" style={{ animationDelay: ".4s" }}>.</span></p> : null}
      </div>
    </Frame>
  );
}

function PosDemo() {
  const { ref, step } = useStep(2200);
  return (
    <Frame frameRef={ref}>
      <motion.div key={step} initial={{ y: "-100%" }} animate={{ y: 0 }} transition={{ duration: 1.1, ease: "easeOut" }}
        className="mx-auto w-28 rounded-b-md border border-t-0 px-2 pb-1.5 pt-1 font-mono text-[9px] leading-tight shadow" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <p className="text-center font-bold">FE-{1042 + step}</p>
        <p className="flex justify-between"><span>Audífonos</span><span>86.000</span></p>
        <p className="flex justify-between"><span>Cargador</span><span>38.200</span></p>
        <p className="mt-0.5 flex justify-between border-t border-dashed pt-0.5 font-black" style={{ borderColor: "var(--t-card-border)" }}><span>TOTAL</span><span className="text-emerald-500">124.200</span></p>
      </motion.div>
    </Frame>
  );
}

function InventoryDemo() {
  const { ref, step } = useStep(1200);
  const rows = [["Bodega", 120 - (step % 6) * 2], ["Zamora", 34 - (step % 6)], ["San Roque", 18 - ((step + 3) % 6)]] as const;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-1.5">
        {rows.map(([n, q]) => (
          <div key={n} className="flex items-center gap-2">
            <span className="w-16 truncate font-semibold">{n}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
              <motion.div animate={{ width: `${Math.min(100, (q / 120) * 100)}%` }} className="h-full rounded-full" style={{ background: "var(--t-cta)" }} />
            </div>
            <motion.b key={q} initial={{ scale: 1.4, color: "#ef4444" }} animate={{ scale: 1, color: "var(--t-text)" }} className="w-7 text-right tabular-nums">{q}</motion.b>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function TransferDemo() {
  const { ref, step } = useStep(700);
  const s = step % 9;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="relative flex items-center justify-between font-bold">
          <span>Bodega</span>
          <div className="relative mx-2 h-0.5 flex-1 rounded" style={{ background: "var(--t-card-border)" }}>
            <motion.span animate={{ left: `${Math.min(100, (s / 4) * 100)}%` }} transition={{ duration: 0.6 }} className="absolute -top-2.5 -translate-x-1/2 text-sm">🚚</motion.span>
          </div>
          <span>Zamora</span>
        </div>
        <div className="flex justify-center gap-1.5">
          {["Despacha", "Lleva", "Recibe", "Revisa"].map((t, i) => <Pill key={t} on={s >= 5 + i - 1} color="#10b981">{s >= 5 + i - 1 ? "✓ " : ""}{t}</Pill>)}
        </div>
      </div>
    </Frame>
  );
}

function PurchaseDemo() {
  const { ref, step } = useStep(1800);
  const on = step % 2 === 1;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-1.5">
        <AnimatePresence>
          {on ? <motion.p key="factura" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg px-2 py-1 font-semibold" style={{ background: "var(--t-card-bg)" }}>📦 Factura proveedor · 50 und × {COP(27600)}</motion.p> : null}
        </AnimatePresence>
        <p style={muted}>Costo promedio</p>
        <motion.p key={on ? "b" : "a"} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-lg font-black">{COP(on ? 26300 : 25000)} {on ? <span className="text-xs text-amber-500">▲ actualizado</span> : null}</motion.p>
      </div>
    </Frame>
  );
}

function PayablesDemo() {
  const { ref, step } = useStep(1000);
  const paid = [20, 45, 70, 100][step % 4];
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full flex-col justify-center gap-1.5">
        <div className="flex items-center justify-between"><b>Proveedor ACME</b><span className="animate-pulse rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-500">vence en 3 días</span></div>
        <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
          <motion.div animate={{ width: `${paid}%` }} className="h-full rounded-full bg-emerald-500" />
        </div>
        <p style={muted}>Pagado {paid} % · saldo <b style={{ color: "var(--t-text)" }}>{COP(Math.round(3200000 * (1 - paid / 100)))}</b>{paid === 100 ? <b className="text-emerald-500"> ✓ al día</b> : null}</p>
      </div>
    </Frame>
  );
}

function PdfDemo() {
  const { ref, step } = useStep(1600);
  const tirilla = step % 2 === 1;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full items-center justify-center gap-3">
        <motion.div layout className="rounded-md border bg-white p-1.5 shadow" style={{ borderColor: "var(--t-card-border)", width: tirilla ? 40 : 58, height: 66 }}>
          <div className="mx-auto mb-1 h-3 w-3 rounded-full bg-gradient-to-br from-violet-500 to-pink-500" />
          {[0, 1, 2, 3].map((l) => <div key={l} className="mb-1 h-0.5 rounded bg-slate-300" />)}
          <div className="h-1 w-1/2 rounded bg-emerald-500" />
        </motion.div>
        <div>
          <p className="font-bold">{tirilla ? "Tirilla 80 mm" : "Carta"}</p>
          <p style={muted}>con logo de la sede</p>
          <motion.p animate={{ y: [0, 3, 0] }} transition={{ repeat: Infinity, duration: 1 }} className="font-black text-violet-500">⬇ PDF</motion.p>
        </div>
      </div>
    </Frame>
  );
}

function ReportsDemo() {
  const { ref, step } = useStep(1800);
  const tabs = ["Día", "Semana", "Mes"];
  const t = step % 3;
  const lines = ["M0,30 L20,22 L40,26 L60,14 L80,18 L100,6", "M0,28 L20,24 L40,16 L60,20 L80,10 L100,8", "M0,32 L20,26 L40,20 L60,16 L80,8 L100,4"];
  return (
    <Frame frameRef={ref}>
      <div className="flex gap-1">{tabs.map((x, i) => <Pill key={x} on={i === t}>{x}</Pill>)}<span className="ml-auto font-black text-emerald-500">+{[12, 18, 24][t]} %</span></div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="mt-1 h-12 w-full overflow-visible">
        <motion.path key={t} d={lines[t]} fill="none" stroke="var(--t-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
      </svg>
    </Frame>
  );
}

function NotifyDemo() {
  const { ref, step } = useStep(1400);
  const list = ["🛒 Pedido nuevo #90", "⚠️ Agotado: Audífonos ANC", "🚚 Traslado #18 demorado", "💸 Cuenta por pagar vence hoy"];
  const shown = [list[step % 4], list[(step + 3) % 4]];
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full gap-2">
        <motion.span key={step} animate={{ rotate: [0, -18, 16, -10, 8, 0] }} transition={{ duration: 0.7 }} className="relative grid h-8 w-8 shrink-0 place-items-center text-lg" style={{ transformOrigin: "50% 10%" }}>
          🔔<span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 text-[8px] font-black leading-3 text-white">{(step % 9) + 1}</span>
        </motion.span>
        <div className="min-w-0 flex-1 space-y-1">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((n, i) => (
              <motion.p key={`${n}-${step}-${i}`} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1 - i * 0.4, y: 0 }} exit={{ opacity: 0 }} className="truncate rounded-lg px-2 py-1 font-semibold" style={{ background: "var(--t-card-bg)" }}>{n}</motion.p>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Frame>
  );
}

function UsersDemo() {
  const { ref, step } = useStep(1100);
  const perms = ["POS", "Inventario", "Informes", "Caja"];
  const on = (i: number) => ((step >> i) & 1) === 1 || i === 0;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full items-center gap-2.5">
        <div className="text-center">
          <div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-xs font-black text-white">MC</div>
          <p className="mt-0.5 font-bold">@maria</p>
          <p className="text-[9px]" style={muted}>Zamora</p>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-1">
          {perms.map((p, i) => (
            <span key={p} className="flex items-center justify-between gap-1 rounded-md px-1.5 py-0.5" style={{ background: "var(--t-card-bg)" }}>
              <span className="truncate">{p}</span>
              <span className="relative h-3 w-5 rounded-full transition-colors" style={{ background: on(i) ? "#10b981" : "var(--t-card-border)" }}>
                <motion.span animate={{ x: on(i) ? 8 : 0 }} className="absolute left-0.5 top-0.5 h-2 w-2 rounded-full bg-white" />
              </span>
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function PaymentsDemo() {
  const { ref, step } = useStep(1000);
  const s = step % 5;
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full items-center gap-3">
        <motion.div animate={{ rotateY: s >= 1 ? 0 : 20 }} className="h-12 w-20 shrink-0 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 p-1.5 text-[8px] font-bold text-white shadow">
          <div className="h-2 w-3 rounded-sm bg-amber-300" />
          <p className="mt-2 tracking-widest">•••• 4242</p>
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{COP(124200)}</p>
          {s < 3 ? (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
              <motion.div animate={{ width: `${(s + 1) * 33}%` }} className="h-full rounded-full" style={{ background: "var(--t-cta)" }} />
            </div>
          ) : (
            <motion.p initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-0.5 font-black text-emerald-500">✓ Pago aprobado</motion.p>
          )}
          <p className="mt-0.5 text-[9px]" style={muted}>Wompi · Addi · Bold</p>
        </div>
      </div>
    </Frame>
  );
}

function ThemesDemo() {
  const { ref, step } = useStep(1300);
  const themes = [["#0b0716", "#a855f7", "#fff"], ["#ffffff", "#ec4899", "#111"], ["#052e2b", "#10b981", "#fff"], ["#fff7ed", "#f97316", "#111"]] as const;
  const [bg, ac, tx] = themes[step % themes.length];
  return (
    <Frame frameRef={ref}>
      <div className="flex h-full items-center gap-2.5">
        <motion.div animate={{ backgroundColor: bg, color: tx }} transition={{ duration: 0.5 }} className="h-full w-24 shrink-0 rounded-lg border p-1.5" style={{ borderColor: "var(--t-card-border)" }}>
          <motion.div animate={{ backgroundColor: ac }} className="mb-1 h-4 rounded" />
          <div className="grid grid-cols-2 gap-1">{[0, 1].map((i) => <motion.div key={i} animate={{ backgroundColor: ac }} className="h-5 rounded opacity-40" />)}</div>
        </motion.div>
        <div className="flex flex-wrap gap-1">{themes.map(([b, a], i) => <span key={i} className="h-4 w-4 rounded-full border-2" style={{ background: a, borderColor: i === step % themes.length ? "var(--t-text)" : b }} />)}</div>
      </div>
    </Frame>
  );
}

const DEMOS: Record<string, () => ReactNode> = {
  "Landing pages": LandingDemo, "Píxel de Meta": PixelDemo, "Catálogos ilimitados": CatalogsDemo, "Campañas y carrusel": CampaignsDemo,
  "Pedidos por WhatsApp": WhatsAppDemo, "POS por punto": PosDemo, "Inventario por bodega": InventoryDemo, "Traslados con firma": TransferDemo,
  "Ingreso de facturas": PurchaseDemo, "Cuentas por pagar": PayablesDemo, "Comprobantes PDF": PdfDemo, "Informes en vivo": ReportsDemo,
  Notificaciones: NotifyDemo, "Usuarios y permisos": UsersDemo, "Pagos en línea": PaymentsDemo, "Claro u oscuro": ThemesDemo,
};

/** Ejemplo animado de una función (por su título). Nada si no hay ejemplo. */
export function FeatureDemo({ title }: { title: string }) {
  const Demo = DEMOS[title];
  return Demo ? <Demo /> : null;
}
