"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDashboardStore, hasStorePermission, type DashboardAccess } from "@/lib/store-utils";
import { FEATURES, FEATURE_GROUPS, loadFeatures, saveFeature, type FeatureKey, type FeatureMap } from "@/lib/features";
import { toast } from "@/app/dashboard/inventario/shared";
import { CartLeads } from "./CartLeads";
import { Waitlist } from "./Waitlist";
import { Coupons } from "./Coupons";
import { FeatureSettings } from "./FeatureSettings";

/**
 * Funciones opcionales (20261312): un interruptor por función. Apagada, nada cambia en el catálogo ni en el panel.
 * Encendida, su bandeja aparece aquí (carritos, avísame, cupones) o en su pantalla (clientes, inventario).
 */
export default function OptionalFeaturesPage() {
  const [access, setAccess] = useState<DashboardAccess | null>(null);
  const [features, setFeatures] = useState<FeatureMap | null>(null);
  const [canConfig, setCanConfig] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<FeatureKey | null>(null);
  // La bandeja que viene en el enlace (?ver=carritos); la de la campana, por ejemplo.
  const [tab, setTab] = useState<FeatureKey | null>(() => {
    if (typeof window === "undefined") return null;
    const t = new URLSearchParams(window.location.search).get("ver") as FeatureKey | null;
    return t && FEATURES.some((f) => f.key === t) ? t : null;
  });
  const [settingsOf, setSettingsOf] = useState<FeatureKey | null>(null);

  const storeId = access?.store?.id ?? null;
  const reload = useCallback(async (id: string) => {
    const r = await loadFeatures(id);
    if (!r.ok) return setError(r.missing ? "Falta correr en Supabase la migración 20261312_vender_mas_opcional.sql." : r.message);
    setError("");
    setFeatures(r.features);
    setCanConfig(r.canConfig);
  }, []);

  useEffect(() => {
    void getDashboardStore().then((a) => {
      setAccess(a);
      if (a.store) void reload(a.store.id);
    }).catch(() => setError("No se pudo abrir tu tienda."));
  }, [reload]);

  const can = useCallback((perms: string[]) => Boolean(access && perms.some((p) => hasStorePermission(access, p))), [access]);
  const trays = useMemo(() => FEATURES.filter((f) => f.tray && features?.[f.key]?.enabled && (can(f.perms) || canConfig)), [features, can, canConfig]);
  const current = tab && trays.some((t) => t.key === tab) ? tab : trays[0]?.key ?? null;
  const onCount = FEATURES.filter((f) => features?.[f.key]?.enabled).length;

  async function toggle(k: FeatureKey, on: boolean) {
    if (!storeId) return;
    // Envío gratis necesita el monto: se abren sus ajustes.
    if (k === "envio_gratis" && on && !(Number(features?.envio_gratis?.settings?.min) > 0)) return setSettingsOf(k);
    setBusy(k);
    const r = await saveFeature(storeId, k, on, null);
    setBusy(null);
    if (!r.ok) return void toast("No se pudo", "error", r.message);
    setFeatures(r.features);
    if (on) {
      void toast(`${FEATURES.find((f) => f.key === k)?.emoji} Encendida`, "success");
      if (FEATURES.find((f) => f.key === k)?.tray) setTab(k);
    }
  }

  function pick(k: FeatureKey) {
    setTab(k);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ver", k);
      window.history.replaceState(null, "", url.toString());
    } catch { /* sin URL */ }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <header className="vm-hero relative overflow-hidden rounded-[28px] border p-5 sm:p-7" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="relative z-[1] flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--t-accent)" }}>🧩 Funciones opcionales</p>
            <h1 className="mt-1 text-2xl font-black sm:text-3xl">Enciende solo lo que te sirva</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-muted)" }}>
              Cada función es un interruptor. Apagada, tu catálogo y tu panel se ven igual que siempre. Puedes encenderla, probarla y apagarla cuando quieras.
            </p>
          </div>
          <div className="rounded-2xl border px-4 py-3 text-center" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 80%, transparent)" }}>
            <p className="text-2xl font-black">{features ? onCount : "—"}<span className="text-sm font-bold opacity-60"> / {FEATURES.length}</span></p>
            <p className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>encendidas</p>
          </div>
        </div>
      </header>

      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b", background: "color-mix(in oklab, #f59e0b 10%, transparent)" }}>⚠️ {error}</p> : null}
      {features && !canConfig ? (
        <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          🔒 Solo el dueño o quien tiene «Mi tienda» enciende o apaga funciones. Tú ves las bandejas de las que ya están encendidas.
        </p>
      ) : null}

      {trays.length ? (
        <section className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {trays.map((t) => (
              <button key={t.key} type="button" onClick={() => pick(t.key)}
                className="shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition"
                style={current === t.key ? { background: t.color, color: "#fff", borderColor: "transparent", boxShadow: `0 8px 22px -10px ${t.color}` } : { borderColor: "var(--t-card-border)" }}>
                {t.emoji} {t.title}
              </button>
            ))}
          </div>
          {storeId && access?.store ? (
            <div className="vm-tray rounded-[24px] border p-4 sm:p-5" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)" }}>
              {current === "carritos" ? <CartLeads storeId={storeId} storeName={access.store.name} canEdit={can(["orders"])} onSettings={canConfig ? () => setSettingsOf("carritos") : undefined} /> : null}
              {current === "avisame" ? <Waitlist storeId={storeId} storeSlug={access.store.slug} storeName={access.store.name} onSettings={canConfig ? () => setSettingsOf("avisame") : undefined} /> : null}
              {current === "cupones" ? <Coupons storeId={storeId} /> : null}
              {current === "envio_gratis" && features ? (
                <FeatureSettings storeId={storeId} feature="envio_gratis" state={features.envio_gratis} canConfig={canConfig} inline onSaved={setFeatures} />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {FEATURE_GROUPS.map((g) => (
        <section key={g.key} className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-[0.14em]" style={{ color: "var(--t-muted)" }}>{g.emoji} {g.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {FEATURES.filter((f) => f.group === g.key).map((f) => {
              const on = Boolean(features?.[f.key]?.enabled);
              return (
                <article key={f.key} className={`vm-card relative overflow-hidden rounded-[22px] border p-4 transition ${on ? "vm-card-on" : ""}`}
                  style={{ borderColor: on ? `color-mix(in oklab, ${f.color} 55%, var(--t-card-border))` : "var(--t-card-border)", ["--vm" as string]: f.color }}>
                  <div className="flex items-start gap-3">
                    <span className="vm-emoji grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in oklab, ${f.color} 16%, transparent)` }} aria-hidden>{f.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-extrabold leading-tight">{f.title}</h3>
                        <Switch on={on} busy={busy === f.key} disabled={!canConfig || !features} color={f.color} label={f.title} onChange={(v) => void toggle(f.key, v)} />
                      </div>
                      <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--t-muted)" }}>{f.pitch}</p>
                      <p className="mt-2 text-[11px] font-semibold" style={{ color: on ? f.color : "var(--t-muted)" }}>{on ? "✅ " : "💡 "}{f.where}</p>
                      {on ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {f.tray ? <button type="button" onClick={() => pick(f.key)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: f.color }}>Abrir</button> : null}
                          {f.href ? <Link href={f.href} prefetch={false} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: f.color }}>Ir ahí →</Link> : null}
                          {canConfig && (f.key === "carritos" || f.key === "avisame" || f.key === "envio_gratis" || f.key === "recompra") ? (
                            <button type="button" onClick={() => setSettingsOf(f.key)} className="rounded-xl border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>⚙️ Ajustes</button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {settingsOf && storeId && features ? (
        <FeatureSettings storeId={storeId} feature={settingsOf} state={features[settingsOf]} canConfig={canConfig}
          onClose={() => setSettingsOf(null)} onSaved={(f) => { setFeatures(f); setSettingsOf(null); }} />
      ) : null}
    </div>
  );
}

function Switch({ on, busy, disabled, color, label, onChange }: { on: boolean; busy: boolean; disabled: boolean; color: string; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "Apagar" : "Encender"} ${label}`} disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: on ? color : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}>
      <span className="absolute top-0.5 grid h-6 w-6 place-items-center rounded-full bg-white text-[10px] shadow transition-all" style={{ left: on ? 22 : 2 }}>
        {busy ? "…" : on ? "✓" : ""}
      </span>
    </button>
  );
}
