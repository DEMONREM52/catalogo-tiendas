"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";

/** «Invita y gana»: el enlace de la tienda para invitar a otros negocios, y cuántos llegaron. Necesita 20261215. */
type Ref = { ok: boolean; slug: string; signups: number; paid: number; rewards_days: number };

export function ReferralCard({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Ref | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void supabaseBrowser().rpc("saas_my_referrals", { p_store: storeId }).then(({ data: d, error }) => {
      if (!error && (d as Ref | null)?.ok) setData(d as Ref);
    });
  }, [storeId]);
  if (!data) return null;

  const link = `${PRODUCTION_ORIGIN}/registro?ref=${encodeURIComponent(data.slug)}`;
  const text = `Te recomiendo RemHub: catálogo con tu enlace, pedidos por WhatsApp, POS e inventario. Créala gratis aquí: ${link}`;
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copia tu enlace:", link); }
  }

  return (
    <section className="rounded-3xl border p-5" style={{ borderColor: "color-mix(in oklab, #10b981 40%, var(--t-card-border))", background: "color-mix(in oklab, #10b981 7%, var(--t-card-bg))" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-lg font-black">🎁 Invita y gana</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Comparte tu enlace con otros negocios. Por cada negocio que se una y contrate un plan, <b style={{ color: "var(--t-text)" }}>te regalamos días de RemHub con todo incluido</b>.
          </p>
        </div>
        <div className="flex gap-4 text-center">
          <div><p className="text-2xl font-black">{data.signups}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>se unieron</p></div>
          <div><p className="text-2xl font-black">{data.paid}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>contrataron</p></div>
          <div><p className="text-2xl font-black" style={{ color: "#10b981" }}>{data.rewards_days}</p><p className="text-[11px]" style={{ color: "var(--t-muted)" }}>días ganados</p></div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>{link}</code>
        <button type="button" onClick={() => void copy()} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>{copied ? "✅ Copiado" : "🔗 Copiar"}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "#22c55e" }}>💬 Compartir por WhatsApp</a>
      </div>
      <p className="mt-2 text-[11px]" style={{ color: "var(--t-muted)" }}>Tu catálogo también invita solo: al pie dice «Hecho con RemHub» y lleva este mismo enlace.</p>
    </section>
  );
}
