"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  KeyRound,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Moon,
  PackagePlus,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  BillingPreview,
  CatalogsPreview,
  InventoryPreview,
  PosPreview,
  ReportsPreview,
  StructureDiagram,
  TeamPreview,
} from "@/components/landing/Previews";

const BRAND = "RemHub";
const WHATSAPP = "573218846041";
const LOGO = "/remhub-icon-64.png";

function COP(n: number) {
  return n.toLocaleString("es-CO");
}

function waLink(message: string) {
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message.trim())}`;
}

const plans = [
  {
    id: "mensual",
    name: "Mensual",
    tag: "Para empezar",
    price: 100000,
    period: "mes",
    highlight: false,
    desc: "Arrancas rápido y validas ventas reales por WhatsApp.",
    bullets: [
      "Tu tienda con sus puntos y bodegas",
      "Catálogos con 5 listas de precios",
      "Productos ilimitados",
      "Pedidos por WhatsApp y comprobante PDF",
      "POS, inventario y traslados",
      "Informes y notificaciones",
      "Soporte por WhatsApp",
    ],
  },
  {
    id: "6m",
    name: "6 Meses",
    tag: "Más vendido",
    price: 550000,
    period: "6 meses",
    highlight: true,
    desc: "La opción PRO: mejor precio por mes y tu negocio se ve serio.",
    bullets: ["Todo lo del mensual", "Mejor precio por mes", "Actualizaciones incluidas", "Prioridad en soporte", "Ideal para crecer ventas", "Renovación simple"],
  },
  {
    id: "anual",
    name: "Anual",
    tag: "Mejor inversión",
    price: 900000,
    period: "año",
    highlight: false,
    desc: "Pagas una vez y te olvidas. Para negocios constantes.",
    bullets: ["Todo lo del 6 meses", "Pago único anual", "Soporte preferencial", "Perfecto si vendes todo el año", "Mejor costo/beneficio", "Renovación fácil"],
  },
] as const;

const TOUR: Array<{ key: string; label: string; icon: LucideIcon; title: string; text: string; preview: ReactNode }> = [
  {
    key: "catalogs",
    label: "Catálogos",
    icon: LayoutGrid,
    title: "Un catálogo para cada público",
    text: "Detal con Precio 3, mayoristas con Precio 2 y clave, una sede con su propio inventario… Cada catálogo tiene su logo, portada, campañas, categorías y WhatsApp.",
    preview: <CatalogsPreview />,
  },
  {
    key: "pos",
    label: "Ventas en punto",
    icon: CreditCard,
    title: "Vende en cada punto, sin mezclar inventarios",
    text: "El POS muestra solo lo que hay en ese punto, numera remisiones y facturas con el prefijo de la sede y descuenta las existencias al confirmar.",
    preview: <PosPreview />,
  },
  {
    key: "inventory",
    label: "Inventario",
    icon: Truck,
    title: "Bodegas, puntos y traslados con firma",
    text: "Ingresa la factura del proveedor a la bodega principal y reparte con traslados. Quien empaca, envía, entrega y recibe firma desde su celular.",
    preview: <InventoryPreview />,
  },
  {
    key: "billing",
    label: "Comprobantes",
    icon: FileText,
    title: "Documentos profesionales en segundos",
    text: "Remisiones, facturas e ingresos de mercancía con la identidad de cada punto, listos en carta o tirilla.",
    preview: <BillingPreview />,
  },
  {
    key: "reports",
    label: "Informes",
    icon: BarChart3,
    title: "Tus números claros, todos los días",
    text: "Ventas, ganancia, productos estrella, mejores clientes, inventario por punto y cuentas por pagar, con avisos de lo que necesita atención.",
    preview: <ReportsPreview />,
  },
  {
    key: "team",
    label: "Equipo",
    icon: Users,
    title: "Cada persona ve solo lo que le toca",
    text: "Crea usuarios para vendedores y bodegueros, asígnales un punto y elige sus permisos. Tú, como dueño, ves todo.",
    preview: <TeamPreview />,
  },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: LayoutGrid, title: "Catálogos ilimitados", text: "Cada uno con su enlace, precio, diseño y productos." },
  { icon: Megaphone, title: "Campañas y carrusel", text: "Promociones con portada para los catálogos que elijas." },
  { icon: MessageCircle, title: "Pedidos por WhatsApp", text: "El cliente arma el carrito y te llega el pedido con su comprobante." },
  { icon: CreditCard, title: "POS por punto", text: "Remisiones y facturas con numeración y resolución propias." },
  { icon: Boxes, title: "Inventario por bodega", text: "Existencias separadas por punto, kardex y ajustes con motivo." },
  { icon: Truck, title: "Traslados con firma", text: "Enlace para que cada responsable firme su paso." },
  { icon: PackagePlus, title: "Ingreso de facturas", text: "Compras a proveedores que actualizan el costo promedio." },
  { icon: Wallet, title: "Cuentas por pagar", text: "Saldos, vencimientos y pagos a proveedores." },
  { icon: Receipt, title: "Comprobantes PDF", text: "Carta o tirilla, con logo y datos de cada sede." },
  { icon: BarChart3, title: "Informes en vivo", text: "Diarios, semanales, mensuales o anuales, por punto o en total." },
  { icon: Bell, title: "Notificaciones", text: "Agotados, cuentas vencidas, traslados demorados y pedidos nuevos." },
  { icon: KeyRound, title: "Usuarios y permisos", text: "Acceso por usuario, sin correo, limitado a su punto." },
  { icon: ShieldCheck, title: "Pagos en línea", text: "Wompi y Addi listos para tus pedidos confirmados." },
  { icon: Moon, title: "Claro u oscuro", text: "50 temas para que tu catálogo luzca como tu marca." },
];

const STEPS = [
  { icon: Store, title: "Crea tu tienda y tus puntos", text: "Registra sedes y bodegas con su logo, datos y numeración." },
  { icon: PackagePlus, title: "Sube productos con 5 precios", text: "Costo, Precio 1 al 5, fotos y ficha completa." },
  { icon: LayoutGrid, title: "Comparte tus catálogos", text: "Un enlace por catálogo para enviar por WhatsApp y redes." },
  { icon: BarChart3, title: "Vende, traslada y mide", text: "Pedidos, POS, inventario e informes en un solo panel." },
];

const FAQ = [
  { q: "¿Necesito instalar algo?", a: "No. Funciona en el navegador del computador o del celular. Tus clientes solo abren el enlace del catálogo." },
  { q: "¿Puedo tener varias sedes con inventarios separados?", a: "Sí. Cada punto y bodega tiene sus existencias. Un vendedor de una sede solo ve y vende lo de su sede, y tú ves todo desde el panel principal." },
  { q: "¿Cómo manejo precios distintos para detal, mayoristas o domicilios?", a: "Cada producto tiene Precio 1 al 5. Creas un catálogo por público y eliges qué precio muestra; también puedes poner un precio especial a un producto solo en un catálogo." },
  { q: "¿Mis clientes pagan en línea?", a: "Pueden enviarte el pedido por WhatsApp y, si activas Wompi o Addi, pagar desde su comprobante." },
  { q: "¿Mis datos están seguros?", a: "Cada tienda solo ve su información y cada usuario solo lo que le permites. Los precios y existencias de los pedidos se validan en el servidor." },
];

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", color: "var(--t-text)" }}>
      <Sparkles size={13} style={{ color: "var(--t-accent)" }} /> {children}
    </span>
  );
}

function HeroMock() {
  const [sales, setSales] = useState(0);
  useEffect(() => {
    // Con "reducir movimiento" el número aparece de una vez.
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1600;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      setSales(Math.round(18450000 * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);
  const bars = [38, 52, 44, 63, 58, 76, 70, 88];
  return (
    <div className="relative mx-auto w-full max-w-lg">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-[2rem] border p-5 shadow-2xl backdrop-blur-xl" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Ventas · este mes</p>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold">+24%</span>
        </div>
        <p className="mt-1 text-4xl font-black tracking-tight sm:text-5xl">${COP(sales)}</p>
        <div className="mt-4 flex h-28 items-end gap-2">
          {bars.map((h, i) => (
            <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.3 + i * 0.07, duration: 0.6 }} className="flex-1 rounded-t-[4px]" style={{ background: i === bars.length - 1 ? "var(--t-accent)" : "color-mix(in oklab, var(--t-accent) 35%, transparent)" }} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {[["Pedidos", "412"], ["Puntos", "3"], ["Catálogos", "4"]].map(([l, v]) => (
            <div key={l} className="rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}><p style={{ color: "var(--t-muted)" }}>{l}</p><p className="text-base font-black">{v}</p></div>
          ))}
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }} className="absolute -right-2 -top-6 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-xl sm:-right-8" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white"><ShoppingBag size={14} /></span>
        Nuevo pedido · Sede San Roque
      </motion.div>
      <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2 }} className="absolute -bottom-6 -left-2 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-xl sm:-left-8" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
        <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }}><Truck size={14} /></span>
        Traslado #18 recibido ✓
      </motion.div>
    </div>
  );
}

export default function HomePage() {
  const [tour, setTour] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const msgDemo = waLink(`Hola! Vengo por ${BRAND}. Quiero ver una demo: catálogos con varios precios, ventas por punto, inventario con traslados e informes. ¿Me muestras cómo funciona?`);
  const msgSell = waLink(`Hola! Quiero contratar ${BRAND} para mi negocio.\nMi negocio es: ____\nTengo ____ puntos de venta / bodegas.\nVendo: ____`);
  const msgPlan = (name: string, price: number) => waLink(`Hola! Quiero el plan ${name} de ${BRAND} ($${COP(price)}). ¿Cómo lo activamos?`);
  const current = TOUR[tour];

  return (
    <main className="relative min-h-screen overflow-x-hidden" style={{ color: "var(--t-text)" }}>
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0" style={{ background: "var(--t-bg-base)" }} />
        <div className="absolute inset-0" style={{ backgroundImage: "var(--t-bg)" }} />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--t-text) 60%, transparent) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
      </div>

      <header className="sticky top-0 z-50 transition" style={{ background: scrolled ? "color-mix(in oklab, var(--t-bg-base) 82%, transparent)" : "transparent", backdropFilter: scrolled ? "blur(14px)" : undefined, borderBottom: scrolled ? "1px solid var(--t-card-border)" : "1px solid transparent" }}>
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-2 font-black">
            <Image src={LOGO} alt="" width={32} height={32} className="rounded-xl" />
            {BRAND}
          </Link>
          <div className="hidden items-center gap-6 text-sm md:flex" style={{ color: "var(--t-muted)" }}>
            <a href="#producto" className="hover:text-[color:var(--t-text)]">Cómo se ve</a>
            <a href="#funciones" className="hover:text-[color:var(--t-text)]">Funciones</a>
            <a href="#planes" className="hover:text-[color:var(--t-text)]">Planes</a>
            <a href="#preguntas" className="hover:text-[color:var(--t-text)]">Preguntas</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>Iniciar sesión</Link>
            <a href={msgDemo} target="_blank" rel="noreferrer" className="hidden rounded-xl px-4 py-2 text-sm font-bold text-white shadow-lg sm:inline-block" style={{ background: "var(--t-cta)" }}>Pedir demo</a>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 lg:grid-cols-[1.05fr_.95fr] lg:pt-16">
        <div>
          <Reveal><Kicker>Catálogos · POS · Inventario · Informes</Kicker></Reveal>
          <Reveal delay={0.05}>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Tu tienda, tus sedes y tus catálogos{" "}
              <span style={{ background: "var(--t-cta)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>en un solo lugar.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-base sm:text-lg" style={{ color: "var(--t-muted)" }}>
              Vende por WhatsApp con un catálogo para cada público, factura en cada punto, controla el inventario de cada bodega y mira tus números al instante.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={msgDemo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white shadow-xl transition hover:-translate-y-0.5" style={{ background: "var(--t-cta)" }}>
                <MessageCircle size={17} /> Quiero una demo
              </a>
              <a href="#producto" className="inline-flex items-center gap-2 rounded-2xl border px-6 py-3.5 text-sm font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                Ver cómo funciona <ArrowRight size={16} />
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.2}>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Varias sedes", "5 listas de precios", "Traslados con firma", "Informes en vivo"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                  <Check size={13} className="text-emerald-500" /> {t}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
        <HeroMock />
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="grid grid-cols-2 gap-3 rounded-[2rem] border p-5 sm:grid-cols-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            {[["∞", "Catálogos"], ["5", "Listas de precios"], ["4", "Firmas por traslado"], ["24/7", "Pedidos por WhatsApp"]].map(([v, l]) => (
              <div key={l} className="text-center">
                <p className="text-3xl font-black" style={{ background: "var(--t-cta)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{v}</p>
                <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>{l}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section id="producto" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <Reveal className="text-center">
          <Kicker>Mira cómo se ve</Kicker>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-black sm:text-4xl">Todo lo que tu negocio necesita, fácil de usar</h2>
          <p className="mx-auto mt-3 max-w-2xl" style={{ color: "var(--t-muted)" }}>Toca cada sección y prueba las vistas previas.</p>
        </Reveal>
        <div className="mt-8 flex gap-2 overflow-x-auto pb-2 sm:justify-center" role="tablist" aria-label="Recorrido por RemHub">
          {TOUR.map((t, i) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tour === i}
              onClick={() => setTour(i)}
              className="relative inline-flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold"
              style={{ color: tour === i ? "#fff" : "var(--t-text)" }}
            >
              {tour === i ? <motion.span layoutId="tour-tab" className="absolute inset-0 rounded-2xl shadow-lg" style={{ background: "var(--t-cta)" }} transition={{ type: "spring", stiffness: 380, damping: 30 }} /> : null}
              <span className="relative inline-flex items-center gap-2"><t.icon size={16} /> {t.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 rounded-[2rem] border p-5 sm:p-8" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
          <AnimatePresence mode="wait">
            <motion.div key={current.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
              <div className="mb-6 max-w-2xl">
                <h3 className="text-2xl font-black">{current.title}</h3>
                <p className="mt-2" style={{ color: "var(--t-muted)" }}>{current.text}</p>
              </div>
              {current.preview}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <Reveal className="mb-8 text-center">
          <Kicker>Multi-tienda de verdad</Kicker>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-black sm:text-4xl">Una tienda madre, muchos puntos, cada uno en orden</h2>
        </Reveal>
        <Reveal><StructureDiagram /></Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <Reveal className="mb-8 text-center">
          <Kicker>Así de simple</Kicker>
          <h2 className="mt-4 text-3xl font-black sm:text-4xl">Empieza a vender en 4 pasos</h2>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <div className="relative h-full rounded-3xl border p-5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="absolute right-4 top-4 text-4xl font-black opacity-10">{i + 1}</span>
                <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: "var(--t-cta)" }}><s.icon size={20} /></span>
                <h3 className="mt-4 font-bold">{s.title}</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="funciones" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-20">
        <Reveal className="mb-8 text-center">
          <Kicker>Funciones</Kicker>
          <h2 className="mt-4 text-3xl font-black sm:text-4xl">Hecho para comercios que crecen</h2>
        </Reveal>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 0.05}>
              <motion.div whileHover={{ y: -4 }} className="h-full rounded-3xl border p-5 transition-shadow hover:shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
                <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 14%, transparent)", color: "var(--t-accent)" }}><f.icon size={19} /></span>
                <h3 className="mt-3 font-bold">{f.title}</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{f.text}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-20">
        <Reveal className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <Kicker>Planes</Kicker>
            <h2 className="mt-4 text-3xl font-black sm:text-4xl">Elige tu plan y te lo activamos</h2>
            <p className="mt-2" style={{ color: "var(--t-muted)" }}>Todas las funciones incluidas. Activación y acompañamiento por WhatsApp.</p>
          </div>
          <a href={msgSell} target="_blank" rel="noreferrer" className="rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg" style={{ background: "var(--t-cta)" }}>Hablar para contratar</a>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.08}>
              <div className="relative h-full rounded-[2rem] p-[1.5px]" style={{ background: p.highlight ? "var(--t-cta)" : "var(--t-card-border)" }}>
                <div className="flex h-full flex-col rounded-[calc(2rem-1.5px)] p-6" style={{ background: "var(--t-bg-base)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black">{p.name}</p>
                      <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>{p.desc}</p>
                    </div>
                    <span className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={p.highlight ? { background: "var(--t-cta)", color: "#fff" } : { background: "var(--t-card-bg-soft)" }}>{p.tag}</span>
                  </div>
                  <p className="mt-5 text-4xl font-black tracking-tight">${COP(p.price)}<span className="text-sm font-semibold" style={{ color: "var(--t-muted)" }}> / {p.period}</span></p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {b}</li>
                    ))}
                  </ul>
                  <a href={msgPlan(p.name, p.price)} target="_blank" rel="noreferrer" className="mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5" style={p.highlight ? { background: "var(--t-cta)", color: "#fff" } : { border: "1px solid var(--t-card-border)", background: "var(--t-card-bg)" }}>
                    Contratar {p.name}
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-20">
        <Reveal className="mb-6 text-center">
          <Kicker>Preguntas frecuentes</Kicker>
          <h2 className="mt-4 text-3xl font-black">¿Tienes dudas?</h2>
        </Reveal>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={f.q} className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <button type="button" onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between gap-3 p-4 text-left font-semibold" aria-expanded={openFaq === i}>
                {f.q}
                <motion.span animate={{ rotate: openFaq === i ? 180 : 0 }}><ChevronDown size={18} /></motion.span>
              </button>
              <AnimatePresence initial={false}>
                {openFaq === i ? (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 pb-4 text-sm" style={{ color: "var(--t-muted)" }}>
                    {f.a}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] p-8 text-center text-white shadow-2xl sm:p-12" style={{ background: "var(--t-cta)" }}>
            <div className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
            <h2 className="relative text-3xl font-black sm:text-4xl">¿Listo para ordenar y vender más?</h2>
            <p className="relative mx-auto mt-3 max-w-xl opacity-90">Te mostramos RemHub con tus propios productos y lo dejamos funcionando contigo.</p>
            <div className="relative mt-6 flex flex-wrap justify-center gap-3">
              <a href={msgDemo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-slate-900 shadow-lg transition hover:-translate-y-0.5">
                <MessageCircle size={17} /> Hablar por WhatsApp
              </a>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-2xl border border-white/50 px-6 py-3.5 text-sm font-bold transition hover:bg-white/10">
                Ya tengo cuenta <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t py-8" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 md:flex-row md:items-center md:justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Image src={LOGO} alt="" width={22} height={22} className="rounded-md" /> © {new Date().getFullYear()} {BRAND} · Catálogos, ventas e inventario
          </p>
          <div className="flex flex-wrap gap-4 text-sm" style={{ color: "var(--t-muted)" }}>
            <a href="#producto">Cómo se ve</a>
            <a href="#planes">Planes</a>
            <Link href="/login">Iniciar sesión</Link>
            <a href={msgSell} target="_blank" rel="noreferrer">Contratar</a>
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-6xl px-5 text-xs" style={{ color: "var(--t-muted)" }}>Activación y soporte: +57 321 884 6041</p>
      </footer>
    </main>
  );
}
