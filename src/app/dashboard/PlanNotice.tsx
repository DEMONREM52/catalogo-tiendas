"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Aviso del plan en el menú del panel (solo dueño y admin de la tienda): días de prueba, plan por vencer o en gracia,
 * y límites casi llenos. Lee saas_entitlements (20261211); sin la migración no muestra nada.
 */

type Ent = {
  ok: boolean; status: string; plan: { name: string }; trial_days_left: number | null; period_end: string | null; cancel_at_period_end: boolean;
  limits: Record<string, number | null>; usage: Record<string, number>; subscription_plan: string | null;
};

const daysTo = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
const LABEL: Record<string, string> = { products: "productos", users: "usuarios", points: "puntos" };

export function PlanNotice({ storeId }: { storeId: string }) {
  const [ent, setEnt] = useState<Ent | null>(null);
  useEffect(() => {
    let alive = true;
    void supabaseBrowser().rpc("saas_entitlements", { p_store: storeId }).then(({ data, error }) => {
      if (alive && !error && (data as Ent | null)?.ok) setEnt(data as Ent);
    });
    return () => { alive = false; };
  }, [storeId]);
  if (!ent || ent.subscription_plan === "fundador") return null;

  const end = daysTo(ent.period_end);
  const full = Object.keys(LABEL).find((k) => ent.limits[k] && ent.usage[k] / Number(ent.limits[k]) >= 0.9);
  let tone = "#8b5cf6";
  let text: string | null = null;
  if (ent.status === "trialing") {
    text = ent.trial_days_left && ent.trial_days_left > 1 ? `Te quedan ${ent.trial_days_left} días de prueba de ${ent.plan.name}` : "Tu prueba termina hoy";
    if ((ent.trial_days_left ?? 0) <= 2) tone = "#f59e0b";
  } else if (ent.status === "past_due") {
    text = "Tu plan venció: estás en días de gracia. Renueva para no perder funciones.";
    tone = "#ef4444";
  } else if (ent.status === "expired") {
    text = "Tu plan venció y pasaste a Gratis. Tus datos siguen guardados.";
    tone = "#ef4444";
  } else if ((ent.status === "active" || ent.status === "canceled") && end !== null && end <= 5) {
    text = ent.cancel_at_period_end ? `Tu plan termina en ${Math.max(end, 0)} día(s)` : `Tu plan vence en ${Math.max(end, 0)} día(s)`;
    tone = "#f59e0b";
  } else if (full) {
    text = `Ya casi llegas al límite de ${LABEL[full]} de tu plan`;
    tone = "#f59e0b";
  } else if (ent.status === "free") {
    text = "Plan Gratis · prueba Negocio 7 días";
  }
  if (!text) return null;

  return (
    <Link href="/dashboard/plan" prefetch={false} className="mt-3 block rounded-2xl border px-3 py-2.5 text-xs font-semibold transition hover:brightness-110"
      style={{ borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`, background: `color-mix(in oklab, ${tone} 12%, transparent)` }}>
      💎 {text} <span className="block font-bold" style={{ color: tone }}>Ver mi plan →</span>
    </Link>
  );
}
