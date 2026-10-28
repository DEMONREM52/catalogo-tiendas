"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  Bell,
  Check,
  CircleDollarSign,
  FileText,
  Globe,
  Lock,
  MapPin,
  MessageCircle,
  MousePointerClick,
  PackageCheck,
  Radar,
  Server,
  Printer,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Signature,
  Store,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";

const money = (n: number) => `$${n.toLocaleString("es-CO")}`;

const frame = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as const;

/* -------------------------------------------------------------------------- */
/* Catálogos: el mismo producto con el precio de cada catálogo                */
/* -------------------------------------------------------------------------- */
const DEMO_CATALOGS = [
  { key: "detal", name: "La Vitrina · Detal", level: 3, hint: "Clientes finales", color: "from-fuchsia-500 to-violet-600", private: false, point: null },
  { key: "mayor", name: "La Vitrina · Por mayor", level: 2, hint: "Mayoristas con clave", color: "from-amber-500 to-orange-600", private: true, point: null },
  { key: "hueco", name: "Hueco en tu casa", level: 5, hint: "Domicilios", color: "from-cyan-500 to-blue-600", private: false, point: "Bodega Centro" },
  { key: "sanroque", name: "Sede San Roque", level: 4, hint: "Solo su inventario", color: "from-emerald-500 to-teal-600", private: false, point: "San Roque" },
] as const;

const DEMO_PRODUCTS = [
  { name: "Encendedor eléctrico", emoji: "🔥", prices: [8000, 9000, 10000, 11000, 12000] },
  { name: "Set de arte 124 piezas", emoji: "🎨", prices: [42000, 45000, 52000, 55000, 58000] },
  { name: "Lámpara LED táctil", emoji: "💡", prices: [18000, 20000, 25000, 26000, 30000] },
  { name: "Audífonos bluetooth", emoji: "🎧", prices: [52000, 55000, 69900, 72000, 79900] },
];

export function CatalogsPreview() {
  const [active, setActive] = useState(0);
  const catalog = DEMO_CATALOGS[active];
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-2">
        {DEMO_CATALOGS.map((c, i) => (
          <motion.button
            key={c.key}
            type="button"
            whileHover={{ x: 4 }}
            onClick={() => setActive(i)}
            className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition"
            style={{ ...frame, borderColor: i === active ? "var(--t-accent)" : frame.borderColor, boxShadow: i === active ? "0 10px 30px color-mix(in oklab, var(--t-accent) 18%, transparent)" : "none" }}
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${c.color} text-white`}><ShoppingBag size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-bold">{c.name}{c.private ? <Lock size={13} /> : null}</span>
              <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{c.hint}{c.point ? ` · 📍 ${c.point}` : ""}</span>
            </span>
            <span className="rounded-full px-2.5 py-1 text-xs font-black" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>Precio {c.level}</span>
          </motion.button>
        ))}
        <p className="px-1 text-xs" style={{ color: "var(--t-muted)" }}>Toca un catálogo: el mismo producto cambia de precio, nombre y diseño.</p>
      </div>
      <div className="mx-auto w-full max-w-[290px] rounded-[2.2rem] border-[6px] border-black/85 bg-black p-1 shadow-2xl">
        <div className="relative h-[460px] overflow-hidden rounded-[1.8rem] bg-[#0f0a1a] text-white">
          <AnimatePresence mode="wait">
            <motion.div key={catalog.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="h-full">
              <div className={`bg-gradient-to-br ${catalog.color} px-4 pb-5 pt-8`}>
                <p className="text-[10px] uppercase tracking-widest opacity-80">Catálogo</p>
                <p className="text-lg font-black leading-tight">{catalog.name}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] opacity-90">{catalog.private ? <><Lock size={11} /> Acceso privado</> : "Abierto a todos"}{catalog.point ? <> · <MapPin size={11} /> {catalog.point}</> : null}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3">
                {DEMO_PRODUCTS.map((p, i) => (
                  <motion.div key={p.name} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1, transition: { delay: i * 0.05 } }} className="rounded-xl bg-white/10 p-2">
                    <div className="grid aspect-square place-items-center rounded-lg bg-white/10 text-3xl">{p.emoji}</div>
                    <p className="mt-1.5 line-clamp-1 text-[10px] font-bold">{p.name}</p>
                    <p className="text-sm font-black">{money(p.prices[catalog.level - 1])}</p>
                    <div className="mt-1 rounded-md bg-white/90 py-0.5 text-center text-[9px] font-bold text-black">Agregar</div>
                  </motion.div>
                ))}
              </div>
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 rounded-full bg-emerald-500 py-2 text-[11px] font-bold">
                <MessageCircle size={13} /> Enviar pedido por WhatsApp
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* POS por punto                                                               */
/* -------------------------------------------------------------------------- */
export function PosPreview() {
  const [kind, setKind] = useState<"remision" | "factura">("remision");
  const items = [
    { name: "Set de arte 124 piezas", qty: 1, price: 52000 },
    { name: "Encendedor eléctrico", qty: 3, price: 10000 },
  ];
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="rounded-3xl border p-4" style={frame}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-bold"><Store size={16} /> Punto: San Roque</p>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold">Solo su inventario</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {DEMO_PRODUCTS.map((p) => (
            <div key={p.name} className="flex items-center gap-2 rounded-xl border p-2" style={frame}>
              <span className="grid h-9 w-9 place-items-center rounded-lg text-lg" style={{ background: "var(--t-card-bg-soft)" }}>{p.emoji}</span>
              <span className="min-w-0 text-[11px]"><b className="block truncate">{p.name}</b>{money(p.prices[2])} · 4 disp.</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-3xl border p-4" style={frame}>
        <div className="flex gap-1.5 rounded-xl p-1" style={{ background: "var(--t-card-bg-soft)" }}>
          {(["remision", "factura"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className="relative flex-1 rounded-lg py-1.5 text-xs font-bold">
              {kind === k ? <motion.span layoutId="pos-kind" className="absolute inset-0 rounded-lg" style={{ background: "var(--t-cta)" }} /> : null}
              <span className="relative" style={{ color: kind === k ? "#fff" : "var(--t-text)" }}>{k === "remision" ? "Remisión" : "Factura"}</span>
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((i) => (
            <li key={i.name} className="flex justify-between gap-2"><span className="truncate">{i.qty} × {i.name}</span><b>{money(i.qty * i.price)}</b></li>
          ))}
        </ul>
        <div className="mt-3 flex items-end justify-between border-t pt-3" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="text-xs" style={{ color: "var(--t-muted)" }}>Próximo n.º<br /><AnimatePresence mode="wait"><motion.b key={kind} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm" style={{ color: "var(--t-text)" }}>{kind === "remision" ? "REMSR-00048" : "FESR-00012"}</motion.b></AnimatePresence></span>
          <span className="text-2xl font-black">{money(total)}</span>
        </div>
        <div className="mt-3 rounded-xl py-2.5 text-center text-sm font-bold text-white" style={{ background: "var(--t-cta)" }}>Crear {kind === "remision" ? "remisión" : "factura"}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inventario y traslados con firmas                                           */
/* -------------------------------------------------------------------------- */
const STEPS = [
  { label: "Empacado", who: "Laura", icon: PackageCheck },
  { label: "Enviado", who: "Andrés", icon: Truck },
  { label: "Entregado", who: "Mensajero", icon: Signature },
  { label: "Recibido", who: "Sede San Roque", icon: Check },
];

export function InventoryPreview() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setStep((s) => (s + 1) % (STEPS.length + 1)), 1400);
    return () => window.clearInterval(timer);
  }, []);
  const stock = [
    { name: "Bodega principal", qty: 120, icon: Warehouse },
    { name: "Sede San Roque", qty: 46, icon: Store },
    { name: "Sede Centro", qty: 31, icon: Store },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 rounded-3xl border p-4" style={frame}>
        <p className="font-bold">Existencias por lugar</p>
        {stock.map((s) => (
          <div key={s.name} className="rounded-xl border p-2.5" style={frame}>
            <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><s.icon size={15} /> {s.name}</span><b>{s.qty} und.</b></div>
            <div className="mt-1.5 h-2 rounded-full" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }}>
              <motion.div initial={{ width: 0 }} whileInView={{ width: `${(s.qty / 120) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} className="h-full rounded-full" style={{ background: "var(--t-accent)" }} />
            </div>
          </div>
        ))}
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Cada punto vende solo lo que tiene. La bodega principal ve todo.</p>
      </div>
      <div className="rounded-3xl border p-4" style={frame}>
        <p className="flex items-center gap-2 font-bold"><Truck size={16} /> Traslado #18 · Principal → San Roque</p>
        <p className="mt-1 text-xs" style={{ color: "var(--t-muted)" }}>Cada responsable firma desde su celular con un enlace. Sin iniciar sesión.</p>
        <ol className="mt-4 space-y-3">
          {STEPS.map((s, i) => {
            const done = i < step;
            return (
              <li key={s.label} className="flex items-center gap-3">
                <motion.span animate={{ scale: done ? 1 : 0.9, background: done ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 10%, transparent)" }} className="grid h-9 w-9 place-items-center rounded-full text-white">
                  {done ? <Check size={16} /> : <s.icon size={15} style={{ color: "var(--t-muted)" }} />}
                </motion.span>
                <span className="text-sm">
                  <b>{s.label}</b>
                  <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{done ? `Firmó ${s.who}` : "Pendiente"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Comprobantes                                                                */
/* -------------------------------------------------------------------------- */
export function BillingPreview() {
  const [format, setFormat] = useState<"carta" | "tirilla">("carta");
  return (
    <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        {[
          { icon: FileText, title: "Remisiones y facturas", text: "Numeración propia por punto, con su resolución de facturación." },
          { icon: Store, title: "Identidad de cada sede", text: "Logo, NIT, dirección y mensaje al pie del punto que vendió." },
          { icon: Printer, title: "Carta o tirilla POS", text: "Imprime en hoja carta o en impresora térmica de 80 y 58 mm." },
          { icon: Receipt, title: "Ingresos de mercancía", text: "Comprobante a costo o con cualquier lista de precios." },
        ].map((f) => (
          <div key={f.title} className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}><f.icon size={18} /></span>
            <span><b className="block text-sm">{f.title}</b><span className="text-sm" style={{ color: "var(--t-muted)" }}>{f.text}</span></span>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-3 flex justify-center gap-1.5">
          {(["carta", "tirilla"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={format === f ? { background: "var(--t-cta)", color: "#fff", borderColor: "transparent" } : frame}>
              {f === "carta" ? "Hoja carta" : "Tirilla 80 mm"}
            </button>
          ))}
        </div>
        <motion.div layout className="mx-auto rounded-xl bg-white p-4 text-[11px] text-slate-900 shadow-2xl" style={{ width: format === "carta" ? "100%" : 230, maxWidth: 420 }}>
          <div className={format === "carta" ? "flex items-start justify-between gap-3" : "text-center"}>
            <div className={format === "carta" ? "flex items-center gap-2" : ""}>
              <div className={`grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white ${format === "carta" ? "" : "mx-auto"}`}><Store size={18} /></div>
              <div>
                <p className="text-sm font-black">Sede San Roque</p>
                <p className="text-slate-500">NIT 900.123.456-7 · Cra 10 # 5-20</p>
              </div>
            </div>
            <div className={format === "carta" ? "rounded-md border-2 border-black px-2 py-1 text-right" : "mt-2"}>
              <p className="text-[9px] font-bold uppercase">Factura de venta</p>
              <p className="text-base font-black">FESR-00012</p>
            </div>
          </div>
          <div className="mt-3 border-y border-black py-1 font-bold">Cant · Descripción · Subtotal</div>
          <p className="mt-1 flex justify-between"><span>1 × Set de arte</span><b>$52.000</b></p>
          <p className="flex justify-between"><span>3 × Encendedor</span><b>$30.000</b></p>
          <p className="mt-2 flex justify-between border-t-2 border-black pt-1 text-sm font-black"><span>TOTAL</span><span>$82.000</span></p>
          <p className="mt-2 text-center text-[9px] text-slate-500">Resolución N.º 18764000000 · del FESR-1 al FESR-5000</p>
        </motion.div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Informes y notificaciones                                                   */
/* -------------------------------------------------------------------------- */
const SERIES = [32, 41, 38, 52, 47, 61, 58, 72, 66, 84, 79, 96];

export function ReportsPreview() {
  const max = Math.max(...SERIES);
  const points = SERIES.map((v, i) => `${(i / (SERIES.length - 1)) * 300},${100 - (v / max) * 88}`).join(" ");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="rounded-3xl border p-4" style={frame}>
        <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Ventas · este mes · todos los puntos</p>
        <p className="mt-1 text-4xl font-black tracking-tight">$18.450.000</p>
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold"><TrendingUp size={13} className="text-emerald-600" /> +24% vs. mes pasado</span>
        <svg viewBox="0 0 300 104" className="mt-4 h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
          <motion.polyline points={points} fill="none" stroke="var(--t-accent)" strokeWidth={2.5} strokeLinejoin="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.4 }} />
          <polygon points={`0,104 ${points} 300,104`} fill="var(--t-accent)" opacity={0.1} />
        </svg>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[["Pedidos", "412"], ["Ticket", "$44.800"], ["Ganancia", "$6,1 M"]].map(([l, v]) => (
            <div key={l} className="rounded-xl border p-2" style={frame}><p className="text-[10px]" style={{ color: "var(--t-muted)" }}>{l}</p><p className="font-black">{v}</p></div>
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-3xl border p-4" style={frame}>
        <p className="flex items-center gap-2 font-bold"><Bell size={16} /> Notificaciones</p>
        {[
          { color: "#d03b3b", tag: "Urgente", text: "2 cuentas por pagar vencidas" },
          { color: "#c98500", tag: "Atención", text: "Sede Centro: 4 productos agotados" },
          { color: "#ec835a", tag: "Importante", text: "Traslado #18 lleva 2 días en camino" },
          { color: "#0ca30c", tag: "Buenas noticias", text: "9 pedidos nuevos desde tus catálogos" },
        ].map((a, i) => (
          <motion.div key={a.text} initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }} className="rounded-xl border p-2.5" style={frame}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: a.color }}>{a.tag}</p>
            <p className="text-sm font-semibold">{a.text}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Equipo y permisos                                                           */
/* -------------------------------------------------------------------------- */
export function TeamPreview() {
  const people = [
    { name: "Administradora", role: "Ve todo y todos los puntos", perms: ["Informes", "Inventario", "Catálogos", "Usuarios"], icon: ShieldCheck },
    { name: "Vendedor San Roque", role: "Solo su punto", perms: ["POS", "Clientes"], icon: CircleDollarSign },
    { name: "Bodeguero", role: "Bodega principal", perms: ["Inventario", "Traslados", "Compras"], icon: Warehouse },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {people.map((p, i) => (
        <motion.div key={p.name} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="rounded-3xl border p-4" style={frame}>
          <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: "var(--t-cta)" }}><p.icon size={20} /></span>
          <p className="mt-3 font-bold">{p.name}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{p.role}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.perms.map((perm) => <span key={perm} className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" }}>✓ {perm}</span>)}
          </div>
        </motion.div>
      ))}
      <div className="flex items-center gap-3 rounded-3xl border p-4 md:col-span-3" style={frame}>
        <Users size={18} />
        <p className="text-sm">Un solo enlace de acceso para todo el equipo: cada trabajador entra con su usuario y contraseña, sin correo.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tienda madre → puntos → catálogos                                          */
/* -------------------------------------------------------------------------- */
export function StructureDiagram() {
  const points = ["Bodega principal", "Sede San Roque", "Sede Centro"];
  const catalogs = ["Detal · P3", "Mayor · P2", "Domicilios · P5", "San Roque · P4"];
  return (
    <div className="rh-glow relative rounded-[2rem] border p-5 sm:p-8" style={frame}>
      <div className="flex flex-col items-center gap-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} className="flex items-center gap-3 rounded-2xl px-5 py-3 text-white shadow-xl" style={{ background: "var(--t-cta)" }}>
          <Store size={20} /> <span><b className="block">Tienda madre</b><span className="text-xs opacity-85">Productos, usuarios, informes de todo</span></span>
        </motion.div>
        <div aria-hidden className="rh-pipe h-12 w-0.5 rounded"><i /><i style={{ animationDelay: ".7s" }} /></div>
        <div className="grid w-full gap-3 sm:grid-cols-3">
          {points.map((p, i) => (
            <motion.div key={p} initial={{ y: 10, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.1 * i }} className="rh-glow rounded-2xl border p-3 text-center" style={frame}>
              {i === 0 ? <Warehouse size={18} className="mx-auto" /> : <MapPin size={18} className="mx-auto" />}
              <p className="mt-1 text-sm font-bold">{p}</p>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Su inventario, su numeración y su logo</p>
              <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] text-emerald-500"><span className="dfx-live h-1.5 w-1.5 rounded-full bg-emerald-500" /> sincronizado</p>
            </motion.div>
          ))}
        </div>
        <div aria-hidden className="rh-pipe h-12 w-0.5 rounded"><i /><i style={{ animationDelay: ".7s" }} /></div>
        <div className="flex flex-wrap justify-center gap-2">
          {catalogs.map((c, i) => (
            <motion.span key={c} initial={{ scale: 0.8, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.25 + 0.08 * i }} className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={frame}>
              🛍️ {c}
            </motion.span>
          ))}
        </div>
        <p className="max-w-xl text-center text-sm" style={{ color: "var(--t-muted)" }}>
          Juntos pero no revueltos: comparten productos, pero cada punto maneja su propio inventario, documentos y clientes. Tú lo ves todo desde el panel principal.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Landing pages para pauta + píxel de Meta                                   */
/* -------------------------------------------------------------------------- */
const LP_PRICE = 89900;
const LP_BEFORE = 129900;
const LP_BUNDLES = [
  { qty: 1, pct: 0, label: "Lleva 1" },
  { qty: 2, pct: 8, label: "Lleva 2" },
  { qty: 3, pct: 15, label: "Lleva 3" },
] as const;
// Como la landing real: redondea a $100 solo cuando hay descuento.
const lpTotal = (b: (typeof LP_BUNDLES)[number]) => (b.pct ? Math.round((LP_PRICE * b.qty * (1 - b.pct / 100)) / 100) * 100 : LP_PRICE * b.qty);

// Los mismos eventos que envía la landing (src/lib/landing/client-tracking.ts).
const LP_EVENTS: Record<string, string> = {
  PageView: "Entró a la página",
  ViewContent: "Vio el producto",
  AddToCart: "Tocó «Comprar»",
  InitiateCheckout: "Empezó el pedido",
  Purchase: "Compró",
  Contact: "Escribió por WhatsApp",
};

// Ventas − costo − pauta = ganancia; ventas ÷ pauta = retorno (como en Landing pages → Resultados).
const LP_RESULTS: Array<[string, string, string]> = [
  ["Visitas", "1.240", "62 % desde Facebook"],
  ["Pedidos", "38", "conversión 3,1 %"],
  ["Pauta", "$570.000", "$15.000 por pedido"],
  ["Ventas", "$3.420.000", "ticket $90.000"],
  ["Retorno", "6,0x", "por cada peso de pauta"],
  ["Ganancia", "$1.330.000", "ya sin costo ni pauta"],
];

type LpEvent = { id: number; name: string; detail: string; server: boolean };

export function LandingAdsPreview() {
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { once: true, margin: "-80px" });
  const still = useReducedMotion();
  const [bundle, setBundle] = useState(1);
  const [step, setStep] = useState<"view" | "form" | "done">("view");
  const [events, setEvents] = useState<LpEvent[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const chosen = LP_BUNDLES[bundle];
  const total = lpTotal(chosen);

  const emit = useCallback((name: string, detail = "", server = false, delay = 0) => {
    timers.current.push(window.setTimeout(() => {
      seq.current += 1;
      const id = seq.current;
      setEvents((prev) => [{ id, name, detail, server }, ...prev].slice(0, 6));
    }, delay));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // Al llegar a la sección: la visita de siempre (vio la página y el producto).
  useEffect(() => {
    if (!inView) return;
    emit("PageView", "", false, 300);
    emit("ViewContent", money(LP_PRICE), false, 900);
  }, [inView, emit]);

  function buy() {
    setStep("form");
    emit("AddToCart", money(LP_PRICE));
    emit("InitiateCheckout", `${chosen.label} · ${money(total)}`, false, 700);
  }

  function confirm() {
    setStep("done");
    emit("Purchase", money(total), true);
  }

  function again() {
    setStep("view");
    emit("PageView");
    emit("ViewContent", money(LP_PRICE), false, 500);
  }

  return (
    <div ref={box} className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div>
        <div className="mx-auto w-full max-w-[290px] rounded-[2.2rem] border-[6px] border-black/85 bg-black p-1 shadow-2xl">
          <div className="relative h-[560px] overflow-hidden rounded-[1.8rem] bg-white text-slate-900">
            <p className="bg-rose-600 px-3 pb-1.5 pt-6 text-center text-[10px] font-bold text-white">🚚 Envío gratis a toda Colombia · Paga al recibir</p>
            <div className="relative grid h-36 place-items-center bg-gradient-to-br from-rose-500 via-orange-400 to-amber-300 text-6xl">
              👟
              <span className="absolute left-2 top-2 rounded-full bg-black px-2 py-0.5 text-[9px] font-black text-white">OFERTA</span>
              <span className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-rose-600">-31%</span>
            </div>
            <div className="space-y-2 p-3">
              <p className="text-sm font-black leading-tight">Tenis urbanos Flex</p>
              <p className="flex items-baseline gap-2">
                <span className="text-xl font-black text-rose-600">{money(LP_PRICE)}</span>
                <span className="text-[11px] text-slate-400 line-through">{money(LP_BEFORE)}</span>
              </p>
              <div className="flex flex-wrap gap-1 text-[9px] font-bold">
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">👁️ 14 personas viendo esto ahora</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">📦 Quedan 9</span>
              </div>
              <div className="space-y-1.5">
                {LP_BUNDLES.map((b, i) => (
                  <button
                    key={b.qty}
                    type="button"
                    onClick={() => setBundle(i)}
                    aria-pressed={i === bundle}
                    className="flex w-full items-center justify-between rounded-xl border-2 px-2.5 py-1.5 text-left text-[11px] transition"
                    style={{ borderColor: i === bundle ? "#e11d48" : "#e2e8f0", background: i === bundle ? "#fff1f2" : "#fff" }}
                  >
                    <span className="font-bold">
                      {b.label}
                      {b.pct ? <span className="ml-1.5 rounded bg-rose-600 px-1 py-px text-[9px] text-white">-{b.pct}%</span> : null}
                    </span>
                    <span className="font-black">{money(lpTotal(b))}</span>
                  </button>
                ))}
              </div>
              <motion.button
                type="button"
                onClick={buy}
                animate={still || step !== "view" ? { scale: 1 } : { scale: [1, 1.04, 1] }}
                transition={still || step !== "view" ? { duration: 0 } : { duration: 1.6, repeat: Infinity }}
                className="w-full rounded-xl bg-rose-600 py-2.5 text-[12px] font-black text-white shadow-lg"
              >
                ¡Comprar ahora y paga al recibir!
              </motion.button>
              <p className="text-center text-[9px] text-slate-500">⏰ Oferta del día · termina a medianoche</p>
            </div>
            <button type="button" onClick={() => emit("Contact", "botón de WhatsApp")} aria-label="Escribir por WhatsApp" className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white shadow-lg">
              <MessageCircle size={18} />
            </button>
            <AnimatePresence>
              {step === "form" ? (
                <motion.div key="form" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 26, stiffness: 260 }} className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
                  <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
                  <p className="text-sm font-black">Completa tu pedido</p>
                  <p className="text-[10px] text-slate-500">{chosen.label} · Tenis urbanos Flex</p>
                  <div className="mt-2 space-y-1.5 text-[11px]">
                    {["Laura G.", "300 123 4567", "Medellín · Laureles", "Cra 70 # 44-21"].map((v) => (
                      <p key={v} className="rounded-lg border border-slate-200 px-2.5 py-1.5">{v}</p>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] font-bold">
                    <span className="rounded-lg border-2 border-rose-600 bg-rose-50 px-2 py-1.5 text-center">💵 Al recibir</span>
                    <span className="rounded-lg border border-slate-200 px-2 py-1.5 text-center">💳 En línea</span>
                  </div>
                  <button type="button" onClick={confirm} className="mt-3 w-full rounded-xl bg-rose-600 py-2.5 text-[12px] font-black text-white">Confirmar pedido · {money(total)}</button>
                  <button type="button" onClick={() => setStep("view")} className="mt-1 w-full py-1 text-[10px] text-slate-500">Volver</button>
                </motion.div>
              ) : null}
              {step === "done" ? (
                <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-white/95 p-5 text-center">
                  <div>
                    <motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-5xl">🎉</motion.p>
                    <p className="mt-2 text-base font-black">¡Pedido recibido!</p>
                    <p className="mt-1 text-[11px] text-slate-500">Te escribimos por WhatsApp para confirmarlo y enviarte la guía.</p>
                    <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold">{chosen.label} · {money(total)} · paga al recibir</p>
                    <button type="button" onClick={again} className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-[11px] font-bold text-white">Ver otra vez</button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-[290px] text-center text-xs" style={{ color: "var(--t-muted)" }}>
          Ejemplo. En tu landing, las personas viendo, las unidades y los vendidos salen de datos reales.
        </p>
      </div>

      <div className="space-y-4">
        <div className="rounded-3xl border p-4" style={frame}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-bold"><Radar size={16} /> Píxel de Meta · eventos</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Activo
            </span>
          </div>
          <ul className="mt-3 min-h-[150px] space-y-1.5 lg:min-h-[250px]">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2" style={frame}>
                  <code className="text-xs font-black">{e.name}</code>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>{LP_EVENTS[e.name]}{e.detail ? ` · ${e.detail}` : ""}</span>
                  <span className="ml-auto flex flex-wrap gap-1 text-[10px] font-semibold">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "var(--t-card-bg-soft)" }}><Globe size={11} /> Navegador</span>
                    {e.server ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" }}><Server size={11} /> Servidor · sin contar doble</span>
                    ) : null}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
            {!events.length ? (
              <li className="grid h-[140px] place-items-center px-4 text-center text-sm lg:h-[230px]" style={{ color: "var(--t-muted)" }}>Aquí aparece cada paso de la visita, como lo ve Meta.</li>
            ) : null}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--t-muted)" }}>
            <MousePointerClick size={14} className="shrink-0" /> Toca «Comprar» en el celular y confirma el pedido: la compra llega desde el navegador y desde el servidor con el mismo ID.
          </p>
        </div>
        <div className="rounded-3xl border p-4" style={frame}>
          <p className="flex items-center gap-2 font-bold"><TrendingUp size={16} /> Resultados de la campaña</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LP_RESULTS.map(([label, value, hint]) => (
              <div key={label} className="rounded-xl border p-2.5" style={frame}>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}</p>
                <p className="text-lg font-black">{value}</p>
                <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>{hint}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
