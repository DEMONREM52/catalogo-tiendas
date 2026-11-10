"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

type Info = { enabled: boolean; store_name?: string; slug?: string; reset_minutes?: number; logo_url?: string | null };
const every = (m: number) => (m < 60 ? `${m} minutos` : m < 1440 ? `${Math.round(m / 60)} hora${m >= 120 ? "s" : ""}` : `${Math.round(m / 1440)} día${m >= 2880 ? "s" : ""}`);
const FEATURES = [
  ["🛍️", "Catálogos", "Mira la tienda como la ven tus clientes y haz un pedido."],
  ["💳", "POS", "Vende en el punto de venta con precios por lista."],
  ["🏭", "Inventario", "Existencias por punto, traslados y conteos."],
  ["📈", "Rentabilidad", "Cuánto deja cada producto y cada punto."],
  ["🧾", "Pedidos", "Recibe, confirma y despacha pedidos por WhatsApp."],
  ["🧩", "Y mucho más", "Cupones, carritos abandonados, recompra…"],
];

/** Página pública de la demo (20261314): un botón y entras a una tienda de ejemplo. */
export function DemoEntry() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void supabaseBrowser().rpc("demo_public_info").then(({ data, error: e }) => setInfo(e ? { enabled: false } : ((data as Info) ?? { enabled: false })));
  }, []);

  async function enter() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/demo/enter", { method: "POST" });
      const r = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !r.url) throw new Error(r.error ?? "No se pudo abrir la demo.");
      window.location.href = r.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la demo.");
      setBusy(false);
    }
  }

  return (
    <main className="demo-page relative min-h-dvh overflow-hidden px-4 py-10 text-white sm:py-16" style={{ background: "linear-gradient(160deg,#0b0716 0%,#1a0b33 55%,#2b0f3f 100%)" }}>
      <div className="demo-orb demo-orb-a" aria-hidden />
      <div className="demo-orb demo-orb-b" aria-hidden />
      <div className="relative mx-auto max-w-4xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold opacity-80 hover:opacity-100">← RemHub</Link>
        <section className="mt-8 text-center">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-fuchsia-300">🧪 Demo gratis · sin registrarte</p>
          <h1 className="mt-3 text-4xl font-black leading-tight sm:text-6xl">Prueba RemHub con una tienda de verdad</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base opacity-80 sm:text-lg">Entra al panel de una tienda de ejemplo, vende, crea productos, arma catálogos y toca todo lo que quieras. No se dañan datos reales: la tienda vuelve sola a como estaba.</p>

          {info === null ? (
            <div className="mx-auto mt-8 h-14 w-64 animate-pulse rounded-2xl bg-white/10" />
          ) : info.enabled ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <button type="button" onClick={() => void enter()} disabled={busy}
                className="demo-cta inline-flex items-center gap-3 rounded-2xl px-8 py-4 text-lg font-black text-white disabled:opacity-70"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899 60%,#f97316)" }}>
                {busy ? "Abriendo la demo…" : "🚀 Entrar a la demo"}
              </button>
              <p className="flex items-center gap-2 text-sm opacity-75">
                {info.logo_url ? <img src={info.logo_url} alt="" className="h-6 w-6 rounded-lg bg-white object-contain" /> : null}
                {info.store_name} · se reinicia cada {every(info.reset_minutes ?? 60)}
              </p>
              {error ? <p className="text-sm font-bold text-amber-300">⚠️ {error}</p> : null}
            </div>
          ) : (
            <div className="mx-auto mt-8 max-w-md rounded-2xl border border-white/15 bg-white/5 p-5">
              <p className="font-bold">La demo no está abierta en este momento.</p>
              <p className="mt-1 text-sm opacity-75">Puedes crear tu tienda gratis y probar con tus propios productos.</p>
              <Link href="/registro" className="mt-4 inline-block rounded-xl bg-white px-5 py-2.5 text-sm font-black text-[#1a0b33]">Crear mi tienda</Link>
            </div>
          )}
        </section>

        <section className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, text], i) => (
            <div key={title} className="demo-card rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur" style={{ animationDelay: `${i * 70}ms` }}>
              <p className="text-2xl" aria-hidden>{icon}</p>
              <p className="mt-2 font-black">{title}</p>
              <p className="mt-1 text-sm opacity-75">{text}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 text-center text-sm opacity-75">
          <p>¿Te gustó? <Link href="/registro" className="font-black underline">Crea tu tienda</Link> y empieza a vender hoy.</p>
        </section>
      </div>
    </main>
  );
}
