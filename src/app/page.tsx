"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";

function COP(n: number) {
  return n.toLocaleString("es-CO");
}

const BRAND = "RemHub";
const WHATSAPP = "573218846041";

// ✅ usa tu logo real (recomendado: remhub-icon-64.png)
// si no existe, cambia por "/favicon.ico"
const LOGO = "/remhub-icon-64.png";

function waLink(message: string) {
  const safe = message
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\uFFFD/g, "")
    .trim();

  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(safe)}`;
}

type CatalogMode = "detal" | "mayor";

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
      "1 tienda",
      "Catálogo Detal + Mayor (2 precios)",
      "Productos ilimitados",
      "Carrito (envía pedido por WhatsApp)",
      "Panel de pedidos (estados y control)",
      "Factura PDF lista para imprimir",
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
    bullets: [
      "Todo lo del mensual",
      "Mejor precio por mes",
      "Actualizaciones incluidas",
      "Prioridad en soporte",
      "Ideal para crecer ventas",
      "Renovación simple",
    ],
  },
  {
    id: "anual",
    name: "Anual",
    tag: "Mejor inversión",
    price: 900000,
    period: "año",
    highlight: false,
    desc: "Pagas una vez y te olvidas. Para negocios constantes.",
    bullets: [
      "Todo lo del 6 meses",
      "Pago único anual",
      "Soporte preferencial",
      "Perfecto si vendes todo el año",
      "Mejor costo/beneficio",
      "Renovación fácil",
    ],
  },
] as const;

const themes = [
  {
    id: "morado",
    name: "Morado Premium",
    ring: "ring-fuchsia-400/40",
    grad: "from-fuchsia-500 to-indigo-500",
  },
  { id: "oceano", name: "Océano", ring: "ring-cyan-400/35", grad: "from-cyan-500 to-blue-600" },
  { id: "oro", name: "Oro", ring: "ring-amber-400/35", grad: "from-amber-400 to-orange-500" },
] as const;

type ThemeId = (typeof themes)[number]["id"];

const demoProducts = [
  { id: "p1", name: "Secador Profesional 2200W", cat: "Belleza", detal: 189900, mayor: 169900 },
  { id: "p2", name: "Plancha Titanium", cat: "Belleza", detal: 149900, mayor: 129900 },
  { id: "p3", name: "Gloss Brillo Premium", cat: "Maquillaje", detal: 24900, mayor: 19900 },
  { id: "p4", name: "Polvo Suelto Matte", cat: "Maquillaje", detal: 35900, mayor: 29900 },
  { id: "p5", name: "Audífonos Bluetooth", cat: "Tecnología", detal: 79900, mayor: 68900 },
  { id: "p6", name: "Cargador 20W", cat: "Tecnología", detal: 39900, mayor: 31900 },
] as const;

export default function HomePage() {
  const [mode, setMode] = useState<CatalogMode>("detal");
  const [theme, setTheme] = useState<ThemeId>("morado");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("Todos");
  const [cart, setCart] = useState<Record<string, number>>({});

  const th = useMemo(() => themes.find((t) => t.id === theme)!, [theme]);

  const categories = useMemo(() => {
    const set = new Set<string>(demoProducts.map((p) => p.cat));
    return ["Todos", ...Array.from(set)];
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return demoProducts.filter((p) => {
      const okQ = !s || `${p.name} ${p.cat}`.toLowerCase().includes(s);
      const okC = cat === "Todos" || p.cat === cat;
      return okQ && okC;
    });
  }, [q, cat]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([id, qty]) => {
        const p = demoProducts.find((x) => x.id === id);
        if (!p) return null;
        const price = mode === "detal" ? p.detal : p.mayor;
        return { ...p, qty, price, subtotal: price * qty };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      cat: string;
      detal: number;
      mayor: number;
      qty: number;
      price: number;
      subtotal: number;
    }>;
  }, [cart, mode]);

  const total = useMemo(() => cartItems.reduce((a, b) => a + b.subtotal, 0), [cartItems]);

  function add(id: string) {
    setCart((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }
  function sub(id: string) {
    setCart((prev) => {
      const next = { ...prev };
      const v = (next[id] ?? 0) - 1;
      if (v <= 0) delete next[id];
      else next[id] = v;
      return next;
    });
  }
  function clearCart() {
    setCart({});
  }

  // ✅ Mensajes WhatsApp (marca RemHub + diferentes CTAs)
  const msgDemo = useMemo(
    () =>
      waLink(
        [
          `Hola! Vengo por ${BRAND}.`,
          "Quiero ver una DEMO completa:",
          "- Catalogo con buscador y categorias",
          "- Carrito que envia el pedido por WhatsApp",
          "- Detal y Mayor con 2 precios",
          "- Cambio de tema (diseños)",
          "",
          "Me muestras como se ve y como llegan los pedidos?",
        ].join("\n")
      ),
    []
  );

  const msgSell = useMemo(
    () =>
      waLink(
        [
          `Hola! Quiero contratar ${BRAND} para mi negocio.`,
          "Quiero vender por WhatsApp con:",
          "- Catalogo con buscador",
          "- Carrito y pedido automatico por WhatsApp",
          "- Panel para ver pedidos (estados)",
          "- Factura PDF",
          "",
          "Mi negocio es: ____",
          "Vendo: ____",
          "Necesito: Detal / Mayor (elige): ____",
          "",
          "Me dices el plan ideal y como activamos hoy?",
        ].join("\n")
      ),
    []
  );

  const msgPlan = (planName: string, price: number) =>
    waLink(
      [
        `Hola! Quiero el plan ${planName} de ${BRAND}.`,
        `Valor: $${COP(price)} COP.`,
        "",
        "Quiero activar mi tienda y empezar a vender por WhatsApp.",
        "Mi negocio es: ____",
        "Vendo: ____",
        "",
        "Me envias los pasos para activarlo hoy?",
      ].join("\n")
    );

  const msgMayorista = useMemo(
    () =>
      waLink(
        [
          `Hola! Me interesa ${BRAND} para vender a MAYORISTAS y DETAL.`,
          "Necesito dos precios y link privado para mayoristas.",
          "",
          "Me ayudas a activarlo?",
        ].join("\n")
      ),
    []
  );

  const msgTemas = useMemo(
    () =>
      waLink(
        [
          `Hola! Vi ${BRAND} y me encanto lo de cambiar TEMAS del catalogo.`,
          "Quiero que mi tienda se vea premium y lista para compartir.",
          "",
          "Me ayudas a activarlo?",
        ].join("\n")
      ),
    []
  );

  return (
    // ✅ Importante: ya NO forzamos text-white (así tema claro puede ser negro)
    <main className="relative min-h-screen overflow-hidden text-[var(--t-text)]">
      <style jsx global>{`
        /* ✅ Usa tokens (sirve en claro/oscuro) */
        .glass {
          background: var(--t-card-bg);
          border: 1px solid var(--t-card-border);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .floaty {
          animation: floaty 6s ease-in-out infinite;
        }
        @keyframes floaty {
          0% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
          100% {
            transform: translateY(0);
          }
        }

        .pulseSoft {
          animation: pulseSoft 2.6s ease-in-out infinite;
        }
        @keyframes pulseSoft {
          0% {
            transform: scale(1);
            opacity: 0.9;
          }
          50% {
            transform: scale(1.03);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 0.9;
          }
        }

        .slideIn {
          animation: slideIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes slideIn {
          from {
            transform: translateY(10px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .shine {
          position: relative;
          overflow: hidden;
        }
        .shine:after {
          content: "";
          position: absolute;
          top: -60%;
          left: -30%;
          width: 40%;
          height: 220%;
          transform: rotate(20deg);
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
          animation: shine 4.4s ease-in-out infinite;
          opacity: 0.9;
        }
        @keyframes shine {
          0% {
            left: -45%;
          }
          55% {
            left: 120%;
          }
          100% {
            left: 120%;
          }
        }
      `}</style>

      {/* Background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 starfield opacity-80" />
        {/* ✅ Overlay suave en claro, fuerte en dark */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/10 [data-theme=dark]:from-black/20 [data-theme=dark]:to-black/55" />
      </div>

      {/* Navbar */}
      <header className="relative z-10 mx-auto max-w-6xl px-5 pt-6">
        <nav className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)]">
              <Image src={LOGO} alt="RemHub" fill className="object-contain p-1.5" priority />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-extrabold tracking-tight text-[var(--t-text)]">{BRAND}</p>
              <p className="text-xs text-[var(--t-muted)]">Catálogos · Pedidos por WhatsApp · Factura PDF</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href="#demo"
              className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
            >
              Demo
            </a>
            <a
              href="#planes"
              className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
            >
              Planes
            </a>
            <a
              href={msgSell}
              target="_blank"
              rel="noreferrer"
              className={`shine rounded-xl bg-gradient-to-r ${th.grad} px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
            >
              Contratar por WhatsApp
            </a>
            <Link
              href="/login"
              className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
            >
              Entrar
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-10 pt-12">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="slideIn">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-xs font-semibold text-[var(--t-text)]">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              RemHub convierte visitas en pedidos
            </div>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight md:text-5xl text-[var(--t-text)]">
              Vende con un link y recibe{" "}
              <span className="bg-gradient-to-r from-fuchsia-500 via-purple-500 to-indigo-500 bg-clip-text text-transparent">
                pedidos por WhatsApp
              </span>
              .
            </h1>

            <p className="mt-4 text-base leading-relaxed text-[var(--t-muted)]">
              Tu cliente entra al catálogo, busca fácil, agrega al carrito y envía el pedido por WhatsApp. Tú recibes todo
              ordenado en tu panel, confirmas y si quieres generas factura PDF.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href={msgSell}
                target="_blank"
                rel="noreferrer"
                className={`pulseSoft rounded-xl bg-gradient-to-r ${th.grad} px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
              >
                Quiero mi RemHub hoy
              </a>

              <a
                href={msgDemo}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-5 py-3 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
              >
                Pide demo por WhatsApp
              </a>

              <a
                href="#demo"
                className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-5 py-3 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
              >
                Ver demo interactiva
              </a>
            </div>

            <div className="mt-7 grid gap-2 text-xs md:grid-cols-2">
              {[
                "Buscador + categorías",
                "Dos precios: Detal y Mayor",
                "Link privado para mayoristas",
                "Cambio de tema del catálogo",
                "Carrito y pedido por WhatsApp",
                "Factura PDF con un clic",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 font-semibold text-[var(--t-text)]"
                >
                  ✓ {t}
                </span>
              ))}
            </div>

            {/* Para tienda / cliente */}
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
                <p className="text-sm font-extrabold text-[var(--t-text)]">Para tu tienda</p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--t-muted)]">
                  <li>• Panel de pedidos con estados</li>
                  <li>• Productos y categorías ilimitadas</li>
                  <li>• Detal + Mayor (2 precios)</li>
                  <li>• Factura PDF con tu logo</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
                <p className="text-sm font-extrabold text-[var(--t-text)]">Para el cliente</p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--t-muted)]">
                  <li>• Entra al link y busca fácil</li>
                  <li>• Agrega al carrito con cantidades</li>
                  <li>• Envía pedido por WhatsApp</li>
                  <li>• Menos preguntas, más ventas</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={msgTemas}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
              >
                Me encantó lo de temas
              </a>
              <a
                href={msgMayorista}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
              >
                Quiero Detal + Mayoristas
              </a>
            </div>

            <div className="mt-5 rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--t-text)]">Contacto directo</p>
              <p className="mt-1 text-sm text-[var(--t-muted)]">
                Activación y soporte: <b className="text-[var(--t-text)]">+57 321 884 6041</b>
              </p>
            </div>
          </div>

          {/* Visual */}
          <div className="floaty slideIn">
            <div className="rounded-3xl p-[1px] bg-gradient-to-br from-fuchsia-500/70 via-purple-400/50 to-indigo-500/70 shadow-2xl shadow-purple-500/25">
              <div className="rounded-3xl p-6 glass">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--t-text)]">Así compra tu cliente</p>
                  <span className="rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-xs font-semibold text-[var(--t-text)]">
                    Pedido por WhatsApp
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
                    <p className="text-xs text-[var(--t-muted)]">1) Busca</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--t-text)]">Buscador + categorías</p>
                    <div className="mt-3 h-2 w-full rounded-full bg-black/10 [data-theme=dark]:bg-white/10">
                      <div className={`h-2 w-[74%] rounded-full bg-gradient-to-r ${th.grad}`} />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
                    <p className="text-xs text-[var(--t-muted)]">2) Agrega</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--t-text)]">Carrito con cantidades</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-700 [data-theme=dark]:text-emerald-200">
                        + Agregar
                      </span>
                      <span className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-800 [data-theme=dark]:text-amber-200">
                        Cantidad
                      </span>
                      <span className="rounded-xl bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-800 [data-theme=dark]:text-indigo-200">
                        Total
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
                    <p className="text-xs text-[var(--t-muted)]">3) Envía</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--t-text)]">WhatsApp listo para enviar</p>
                    <p className="mt-2 text-xs text-[var(--t-muted)]">
                      Tú lo recibes ordenado y lo gestionas desde el panel.
                    </p>
                  </div>
                </div>

                <div className={`mt-6 rounded-2xl bg-gradient-to-r ${th.grad} p-4 text-white`}>
                  <p className="text-sm font-semibold">Tip de ventas</p>
                  <p className="mt-1 text-sm opacity-95">
                    Catálogo bonito + carrito = menos preguntas y más pedidos.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-[var(--t-muted)]">
              Esto es lo que verá tu cliente cuando le pases tu link.
            </p>
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section id="demo" className="relative z-10 mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-xs font-semibold text-[var(--t-text)]">
              DEMO INTERACTIVA
            </div>
            <h2 className="mt-3 text-3xl font-extrabold text-[var(--t-text)]">Pruébalo como si fuera real</h2>
            <p className="mt-2 text-sm text-[var(--t-muted)]">
              Cambia tema, usa buscador, alterna Detal y Mayor, agrega al carrito y mira el total.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={msgDemo}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
            >
              Quiero demo guiada
            </a>
            <a
              href={msgSell}
              target="_blank"
              rel="noreferrer"
              className={`rounded-xl bg-gradient-to-r ${th.grad} px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
            >
              Contratar ahora
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          {/* Catalog */}
          <div className="rounded-3xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-5 glass">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-2 rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-1">
                  <button
                    type="button"
                    onClick={() => setMode("detal")}
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-semibold transition",
                      mode === "detal"
                        ? `bg-gradient-to-r ${th.grad} text-white`
                        : "text-[var(--t-text)] hover:bg-black/5 [data-theme=dark]:hover:bg-white/10",
                    ].join(" ")}
                  >
                    Detal (público)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("mayor")}
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-semibold transition",
                      mode === "mayor"
                        ? `bg-gradient-to-r ${th.grad} text-white`
                        : "text-[var(--t-text)] hover:bg-black/5 [data-theme=dark]:hover:bg-white/10",
                    ].join(" ")}
                  >
                    Mayor (privado)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      className={[
                        "inline-flex items-center gap-2 rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-2 text-xs font-semibold transition hover:opacity-95",
                        theme === t.id ? `ring-2 ${t.ring}` : "",
                      ].join(" ")}
                      title={`Tema: ${t.name}`}
                    >
                      <span className={`h-3 w-3 rounded-full bg-gradient-to-r ${t.grad}`} />
                      <span className="text-[var(--t-text)]">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-2 text-sm">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar: secador, gloss, cargador..."
                    className="w-full bg-transparent outline-none text-[var(--t-text)] placeholder:text-[color-mix(in_oklab,var(--t-muted)_70%,transparent)]"
                  />
                </div>

                <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-2 text-sm">
                  <select
                    value={cat}
                    onChange={(e) => setCat(e.target.value)}
                    className="w-full bg-transparent outline-none text-[var(--t-text)]"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c} className="text-black">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {filtered.map((p) => {
                const price = mode === "detal" ? p.detal : p.mayor;
                return (
                  <div
                    key={p.id}
                    className="rounded-3xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4 transition hover:opacity-95 slideIn"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-[var(--t-text)]">{p.name}</p>
                        <p className="mt-1 text-xs text-[var(--t-muted)]">{p.cat}</p>
                      </div>
                      <span className="rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--t-text)]">
                        {mode === "mayor" ? "Mayorista" : "Detal"}
                      </span>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-[var(--t-muted)]">Precio {mode}</p>
                        <p className="text-lg font-extrabold text-[var(--t-text)]">${COP(price)}</p>
                        <p className="text-[11px] text-[var(--t-muted)]">
                          {mode === "mayor" ? `Detal: $${COP(p.detal)}` : `Mayor: $${COP(p.mayor)}`}
                        </p>
                      </div>

                      <button
                        onClick={() => add(p.id)}
                        className={`rounded-2xl bg-gradient-to-r ${th.grad} px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4 text-sm text-[var(--t-muted)]">
                No hay resultados. Prueba otra búsqueda.
              </div>
            ) : null}
          </div>

          {/* Cart */}
          <div className="rounded-3xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-5 glass">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-[var(--t-text)]">Carrito (demo)</p>
              <span className="rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--t-text)]">
                Envía por WhatsApp
              </span>
            </div>

            <p className="mt-2 text-xs text-[var(--t-muted)]">
              Simula como el cliente arma el pedido y lo envía por WhatsApp.
            </p>

            <div className="mt-4 space-y-2">
              {cartItems.length === 0 ? (
                <div className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4 text-sm text-[var(--t-muted)]">
                  Agrega productos para ver el pedido.
                </div>
              ) : (
                cartItems.map((it) => (
                  <div key={it.id} className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--t-text)]">{it.name}</p>
                        <p className="text-xs text-[var(--t-muted)]">
                          {mode.toUpperCase()} · ${COP(it.price)} c/u
                        </p>
                      </div>
                      <p className="text-sm font-extrabold text-[var(--t-text)]">${COP(it.subtotal)}</p>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => sub(it.id)}
                          className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
                        >
                          -
                        </button>
                        <span className="text-sm font-semibold text-[var(--t-text)]">{it.qty}</span>
                        <button
                          onClick={() => add(it.id)}
                          className="rounded-xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-[11px] text-[var(--t-muted)]">{it.cat}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--t-text)]">Total</p>
                <p className="text-xl font-extrabold text-[var(--t-text)]">${COP(total)}</p>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <button
                  onClick={clearCart}
                  className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-sm font-semibold text-[var(--t-text)] hover:opacity-95 disabled:opacity-40"
                  disabled={cartItems.length === 0}
                >
                  Vaciar carrito
                </button>

                <a
                  href={waLink(
                    cartItems.length === 0
                      ? `Hola! Quiero informacion de ${BRAND}. Me interesa vender por WhatsApp con carrito.`
                      : [
                          `Hola! Pedido de prueba desde ${BRAND}:`,
                          `Modo: ${mode.toUpperCase()}`,
                          "",
                          ...cartItems.map((x) => `- ${x.name} x${x.qty} = $${COP(x.subtotal)}`),
                          "",
                          `TOTAL: $${COP(total)}`,
                          "",
                          "Nota: (demo) En el sistema real esto llega directo al WhatsApp de la tienda.",
                        ].join("\n")
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded-2xl bg-gradient-to-r ${th.grad} px-4 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
                >
                  Enviar pedido por WhatsApp (demo)
                </a>

                <a
                  href={msgSell}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-4 py-2 text-center text-sm font-semibold text-[var(--t-text)] hover:opacity-95"
                >
                  Quiero esto para mi negocio
                </a>
              </div>
            </div>

            <div className="mt-3 text-xs text-[var(--t-muted)]">
              * En RemHub real: panel de pedidos, estados, y factura PDF.
            </div>
          </div>
        </div>
      </section>

      {/* PLANES */}
      <section id="planes" className="relative z-10 mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] px-3 py-1 text-xs font-semibold text-[var(--t-text)]">
              PLANES
            </div>
            <h2 className="mt-3 text-3xl font-extrabold text-[var(--t-text)]">Elige tu plan y te lo activamos</h2>
            <p className="mt-2 text-sm text-[var(--t-muted)]">
              Todo pensado para vender por WhatsApp: catálogo, carrito, pedido y control en panel.
            </p>
          </div>

          <a
            href={msgSell}
            target="_blank"
            rel="noreferrer"
            className={`rounded-xl bg-gradient-to-r ${th.grad} px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95`}
          >
            Hablar para contratar
          </a>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const href = msgPlan(p.name, p.price);
            return (
              <div
                key={p.id}
                className={[
                  "relative rounded-3xl p-[1px] transition",
                  p.highlight ? `bg-gradient-to-br ${th.grad} shadow-2xl shadow-purple-500/25` : "bg-[var(--t-card-bg-soft)]",
                ].join(" ")}
              >
                <div className={["h-full rounded-3xl p-6", p.highlight ? "glass" : "border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)]"].join(" ")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-extrabold text-[var(--t-text)]">{p.name}</p>
                      <p className="mt-1 text-sm text-[var(--t-muted)]">{p.desc}</p>
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                        p.highlight ? `bg-gradient-to-r ${th.grad} text-white` : "border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] text-[var(--t-text)]",
                      ].join(" ")}
                    >
                      {p.tag}
                    </span>
                  </div>

                  <div className="mt-5 flex items-end gap-2">
                    <p className="text-4xl font-extrabold tracking-tight text-[var(--t-text)]">${COP(p.price)}</p>
                    <p className="pb-1 text-sm text-[var(--t-muted)]">/ {p.period}</p>
                  </div>

                  <div className="mt-5 space-y-2 text-sm">
                    {p.bullets.map((b) => (
                      <div key={b} className="flex gap-2">
                        <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 [data-theme=dark]:text-emerald-200">
                          ✓
                        </span>
                        <span className="text-[var(--t-text)]">{b}</span>
                      </div>
                    ))}
                  </div>

                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={[
                      "mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition",
                      p.highlight
                        ? `bg-gradient-to-r ${th.grad} text-white shadow-lg shadow-purple-500/25 hover:opacity-95`
                        : "border border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] text-[var(--t-text)] hover:opacity-95",
                    ].join(" ")}
                  >
                    Contratar {p.name}
                  </a>

                  <p className="mt-3 text-center text-xs text-[var(--t-muted)]">
                    Activación por WhatsApp · Sin contratos raros
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--t-card-border)] bg-[var(--t-card-bg-soft)] py-8">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-semibold text-[var(--t-text)]">
              © {new Date().getFullYear()} {BRAND} — hecho para vender por WhatsApp.
            </p>
            <div className="flex gap-4 text-sm">
              <a className="text-[var(--t-muted)] hover:text-[var(--t-text)]" href="#demo">
                Demo
              </a>
              <a className="text-[var(--t-muted)] hover:text-[var(--t-text)]" href="#planes">
                Planes
              </a>
              <a className="text-[var(--t-muted)] hover:text-[var(--t-text)]" href={msgSell} target="_blank" rel="noreferrer">
                Contratar
              </a>
            </div>
          </div>

          <p className="mt-3 text-xs text-[var(--t-muted)]">
            Activación y soporte: +57 321 884 6041 · {BRAND}
          </p>
        </div>
      </footer>
    </main>
  );
}
