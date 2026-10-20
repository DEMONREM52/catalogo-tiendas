"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { storeSpaceOrigin } from "@/lib/share/store-host";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/**
 * Primeros pasos de una tienda nueva (solo el dueño o el admin de la tienda): lo que falta para vender.
 * Se oculta sola al completar todo o si la persona la cierra. Necesita 20261215 (sin ella no se muestra).
 */

type Step = { key: string; done: boolean };
const LABELS: Record<string, [string, string, string]> = {
  logo: ["Sube el logo de tu negocio", "Tus clientes te reconocen al abrir el catálogo.", "/dashboard/store"],
  product: ["Crea tu primer producto", "Nombre, foto y precio: en un minuto.", "/dashboard/products/crear"],
  products5: ["Sube al menos 5 productos con foto", "Con fotos se vende mucho más.", "/dashboard/products"],
  catalog: ["Arma tu catálogo", "Elige qué productos y qué precios ve cada público.", "/dashboard/social"],
  share: ["Comparte tu enlace y recibe tu primer pedido", "Mándalo por WhatsApp a tus clientes y súbelo a tus estados.", ""],
  team: ["Invita a alguien de tu equipo", "Cada persona con su usuario y sus permisos.", "/dashboard/store/users"],
};

export function OnboardingCard({ storeId, slug }: { storeId: string; slug: string }) {
  const key = `remhub:onboarding-hidden:${storeId}`;
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(() => { try { return window.localStorage.getItem(key) === "1"; } catch { return false; } });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    void supabaseBrowser().rpc("saas_onboarding", { p_store: storeId }).then(({ data, error }) => {
      const v = data as { ok?: boolean; steps?: Step[] } | null;
      if (alive && !error && v?.ok) setSteps(v.steps ?? []);
    });
    return () => { alive = false; };
  }, [storeId, hidden]);

  if (hidden || !steps || steps.every((s) => s.done)) return null;
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  const shareUrl = `${storeSpaceOrigin(slug) ?? `${PRODUCTION_ORIGIN}/${slug}`}/`;

  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copia tu enlace:", shareUrl); }
  }
  function hide() {
    try { window.localStorage.setItem(key, "1"); } catch { /* sin almacenamiento */ }
    setHidden(true);
  }

  return (
    <section className="rounded-[28px] border p-5" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 40%, var(--t-card-border))", background: "color-mix(in oklab, var(--t-accent) 7%, var(--t-card-bg))" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">🚀 Primeros pasos para vender</h2>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>{done} de {steps.length} listos</p>
        </div>
        <button type="button" onClick={hide} className="text-xs underline" style={{ color: "var(--t-muted)" }}>Ocultar</button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in oklab, var(--t-card-border) 60%, transparent)" }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8b5cf6,#10b981)" }} />
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {steps.map((s) => {
          const [title, hint, href] = LABELS[s.key] ?? [s.key, "", ""];
          const body = (
            <>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black" style={s.done ? { background: "#10b981", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{s.done ? "✓" : "·"}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold" style={{ textDecoration: s.done ? "line-through" : undefined, opacity: s.done ? 0.6 : 1 }}>{title}</span>
                {!s.done ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{hint}</span> : null}
              </span>
            </>
          );
          if (s.key === "share" && !s.done) {
            return (
              <li key={s.key} className="flex items-start gap-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
                {body}
                <span className="ml-auto flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => void copy()} className="rounded-xl border px-2.5 py-1 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>{copied ? "✅" : "🔗 Copiar"}</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`¡Mira nuestro catálogo y haz tu pedido por aquí! ${shareUrl}`)}`} target="_blank" rel="noopener" className="rounded-xl px-2.5 py-1 text-xs font-bold text-white" style={{ background: "#22c55e" }}>💬</a>
                </span>
              </li>
            );
          }
          return (
            <li key={s.key}>
              {s.done || !href ? (
                <div className="flex items-start gap-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>{body}</div>
              ) : (
                <Link href={href} prefetch={false} className="flex items-start gap-3 rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>{body}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
