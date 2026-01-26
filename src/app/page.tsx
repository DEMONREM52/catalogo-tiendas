"use client";

import Link from "next/link";

function COP(n: number) {
  return n.toLocaleString("es-CO");
}

const plans = [
  {
    name: "Mensual",
    tag: "Empieza hoy",
    price: 59000,
    period: "/ mes",
    highlight: false,
    desc: "Ideal para arrancar y probar el sistema con tu catálogo.",
    bullets: [
      "1 tienda",
      "Catálogo Detal + Mayor",
      "Productos ilimitados",
      "Carrito + comprobante",
      "Factura PDF lista para imprimir",
      "Soporte por WhatsApp",
    ],
    cta: "Empezar mensual",
    href: "/login",
  },
  {
    name: "6 Meses",
    tag: "Más popular",
    price: 299000,
    period: "/ 6 meses",
    highlight: true,
    desc: "Tu mejor opción: ahorras y te ves PRO frente a tus clientes.",
    bullets: [
      "Todo lo del plan Mensual",
      "Ahorro vs pagar mes a mes",
      "Actualizaciones incluidas",
      "Prioridad en soporte",
      "Perfecto para crecer y medir ventas",
      "Renovación simple",
    ],
    cta: "Elegir 6 meses",
    href: "/login",
  },
  {
    name: "Anual",
    tag: "Mejor precio",
    price: 499000,
    period: "/ año",
    highlight: false,
    desc: "Para negocios constantes: pagas una vez y te olvidas.",
    bullets: [
      "Todo lo del plan 6 Meses",
      "Pago único anual",
      "Soporte preferencial",
      "Ideal si vendes todo el año",
      "Mejor costo/beneficio",
      "Renovación fácil",
    ],
    cta: "Elegir anual",
    href: "/login",
  },
];

const features = [
  {
    title: "Catálogo que enamora",
    desc: "Fotos, categorías y precios claros. Un link listo para compartir en WhatsApp e Instagram.",
    icon: "✨",
  },
  {
    title: "Pedidos en orden",
    desc: "El cliente arma su pedido solo. Tú confirmas, completas y controlas todo desde el panel.",
    icon: "🧾",
  },
  {
    title: "Factura PDF con un clic",
    desc: "Logo, dirección, WhatsApp, número de factura, detalle y total. Lista para imprimir y enviar.",
    icon: "🧡",
  },
];

const faqs = [
  {
    q: "¿Necesito saber programar?",
    a: "No. Creas tu tienda, subes productos y compartes tu link. Todo lo manejas desde tu panel.",
  },
  {
    q: "¿Puedo vender detal y mayoristas?",
    a: "Sí. Puedes tener catálogo Detal y Mayor, con precios separados y control de pedidos.",
  },
  {
    q: "¿Se puede imprimir factura?",
    a: "Sí. La factura sale limpia y lista para imprimir en PDF desde el botón de “Generar factura”.",
  },
  {
    q: "¿Hay contrato?",
    a: "No. Puedes cancelar cuando quieras (según tu plan).",
  },
];

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden text-white">
      {/* Background (lo controla globals.css, pero dejamos un extra sutil si quieres) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 starfield opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/45" />
      </div>

      {/* Navbar */}
      <header className="relative z-10 mx-auto max-w-6xl px-5 pt-6">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 shadow-lg shadow-purple-500/20" />
            <div className="leading-tight">
              <p className="text-sm font-semibold">Tu Catálogo</p>
              <p className="text-xs opacity-70">Ventas por WhatsApp · Pedidos · Facturas</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/15"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95"
            >
              Empezar ahora
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-10 pt-12">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Catálogo listo en minutos · look premium morado
            </div>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight md:text-5xl">
              Haz que tu negocio{" "}
              <span className="bg-gradient-to-r from-fuchsia-400 via-purple-300 to-indigo-300 bg-clip-text text-transparent">
                se vea gigante
              </span>
              .
            </h1>

            <p className="mt-4 text-base leading-relaxed opacity-85">
              Crea tu tienda, sube productos con fotos, organiza categorías, recibe pedidos por carrito
              y genera factura PDF sencilla. Ideal para vender por WhatsApp y verte más profesional.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95"
              >
                Crear mi catálogo ✨
              </Link>

              <a
                href="#planes"
                className="rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/15"
              >
                Ver planes
              </a>

              <Link
                href="/login"
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/10"
              >
                Ya soy socio → entrar
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap gap-2 text-xs">
              {["Link para compartir", "Pedidos organizados", "Factura PDF", "Detal + Mayor"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/10 bg-white/10 px-3 py-1 font-semibold"
                >
                  ✓ {t}
                </span>
              ))}
            </div>
          </div>

          {/* Hero visual */}
          <div className="floaty">
            <div className="rounded-3xl p-[1px] bg-gradient-to-br from-fuchsia-500/70 via-purple-400/50 to-indigo-500/70 shadow-2xl shadow-purple-500/25">
              <div className="rounded-3xl p-6 glass">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold opacity-90">Vista previa</p>
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold">
                    Premium
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <p className="text-xs opacity-75">Catálogo</p>
                    <p className="mt-1 text-sm font-semibold">Productos con fotos y precios claros</p>
                    <div className="mt-3 h-2 w-full rounded-full bg-white/10">
                      <div className="h-2 w-[72%] rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <p className="text-xs opacity-75">Pedidos</p>
                    <p className="mt-1 text-sm font-semibold">Estados: Enviado → Confirmado</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200">
                        En orden
                      </div>
                      <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200">
                        Enviado
                      </div>
                      <div className="rounded-xl bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-200">
                        Confirmado
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <p className="text-xs opacity-75">Factura PDF</p>
                    <p className="mt-1 text-sm font-semibold">Logo + datos + total listo para imprimir</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs opacity-75">#Factura 000123</span>
                      <span className="text-sm font-extrabold">${COP(189900)}</span>
                    </div>
                    <div className="mt-3 h-[1px] w-full bg-white/10" />
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 p-4 text-white">
                  <p className="text-sm font-semibold">Tip rápido para vender más</p>
                  <p className="mt-1 text-sm opacity-95">
                    Comparte tu link del catálogo y deja que el cliente arme su pedido solo.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-3 text-center text-xs opacity-70">
              Diseño pensado para cautivar (perfecto para mostrar a inversionistas).
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 py-10">
        <div className="mb-6">
          <h2 className="text-2xl font-extrabold">Hecho para vender fácil</h2>
          <p className="mt-2 text-sm opacity-80">
            Todo lo que necesitas para vender por WhatsApp, sin enredos — con estilo morado premium.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-sm transition hover:bg-white/15"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-white shadow-lg shadow-purple-500/20">
                  <span className="text-base">{f.icon}</span>
                </div>
                <div>
                  <p className="text-base font-bold">{f.title}</p>
                  <p className="mt-2 text-sm opacity-80">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="planes" className="relative z-10 mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold">
              PRICING
            </div>
            <h2 className="mt-3 text-3xl font-extrabold">Planes simples, resultado enorme</h2>
            <p className="mt-2 text-sm opacity-80">
              3 opciones claras: mensual, 6 meses (popular) y anual (mejor precio).
            </p>
            <p className="mt-1 text-xs opacity-70">
              Precios sugeridos en COP (Colombia). Puedes ajustarlos luego.
            </p>
          </div>

          <div className="mt-4 md:mt-0">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95"
            >
              Empezar ahora
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={[
                "relative rounded-3xl p-[1px] transition",
                p.highlight
                  ? "bg-gradient-to-br from-fuchsia-500 via-purple-400 to-indigo-500 shadow-2xl shadow-purple-500/25"
                  : "bg-white/10",
              ].join(" ")}
            >
              <div className={["h-full rounded-3xl p-6", p.highlight ? "glass" : "border border-white/10 bg-white/5"].join(" ")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-extrabold">{p.name}</p>
                    <p className="mt-1 text-sm opacity-80">{p.desc}</p>
                  </div>

                  <span
                    className={[
                      "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                      p.highlight ? "bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white" : "border border-white/10 bg-white/10",
                    ].join(" ")}
                  >
                    {p.tag}
                  </span>
                </div>

                <div className="mt-5 flex items-end gap-2">
                  <p className="text-4xl font-extrabold tracking-tight">${COP(p.price)}</p>
                  <p className="pb-1 text-sm opacity-70">{p.period}</p>
                </div>

                <div className="mt-5 space-y-2 text-sm">
                  {p.bullets.map((b) => (
                    <div key={b} className="flex gap-2">
                      <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-200">
                        ✓
                      </span>
                      <span className="opacity-90">{b}</span>
                    </div>
                  ))}
                </div>

                <Link
                  href={p.href}
                  className={[
                    "mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    p.highlight
                      ? "bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white shadow-lg shadow-purple-500/25 hover:opacity-95"
                      : "border border-white/10 bg-white/10 hover:bg-white/15",
                  ].join(" ")}
                >
                  {p.cta}
                </Link>

                <p className="mt-3 text-center text-xs opacity-70">Sin contrato. Cancela cuando quieras.</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-12">
        <div className="rounded-3xl border border-white/10 bg-white/10 p-6">
          <h3 className="text-xl font-extrabold">Preguntas rápidas</h3>
          <p className="mt-2 text-sm opacity-80">Resolvemos lo típico para que presentes esto con seguridad.</p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {faqs.map((f) => (
              <div key={f.q} className="rounded-2xl border border-white/10 bg-white/10 p-5">
                <p className="font-bold">{f.q}</p>
                <p className="mt-2 text-sm opacity-80">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 hover:opacity-95"
            >
              Probar ahora ✨
            </Link>

            <a
              href="#planes"
              className="rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/15"
            >
              Ver planes
            </a>

            <Link
              href="/login"
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/10"
            >
              Ya soy socio → entrar
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 bg-white/5 py-8">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-semibold">
              © {new Date().getFullYear()} Tu Catálogo — morado, premium y hecho para vender.
            </p>
            <div className="flex gap-4 text-sm">
              <Link className="opacity-80 hover:opacity-100" href="/login">
                Iniciar sesión
              </Link>
              <a className="opacity-80 hover:opacity-100" href="#planes">
                Planes
              </a>
            </div>
          </div>

          <p className="mt-3 text-xs opacity-70">
            * Precios en COP (Colombia). Ajustables según tu estrategia comercial.
          </p>
        </div>
      </footer>
    </main>
  );
}
