"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ShippingCfg } from "./ShippingBar";

/**
 * Lo opcional del carrito de un catálogo (20261312): carritos abandonados, cupón y envío gratis.
 * Si la tienda no lo encendió (o falta la migración), nada de esto se muestra.
 */

export type PublicFeatures = { carritos: boolean; avisame: { button: string } | null; cupones: boolean; envio_gratis: ShippingCfg | null };
const OFF: PublicFeatures = { carritos: false, avisame: null, cupones: false, envio_gratis: null };
const cache = new Map<string, Promise<PublicFeatures>>();

export function fetchPublicFeatures(storeSlug: string, catalogSlug: string | null): Promise<PublicFeatures> {
  const k = `${storeSlug}:${catalogSlug ?? ""}`;
  if (!cache.has(k)) {
    cache.set(k, Promise.resolve(supabaseBrowser().rpc("store_public_features", { p_store: storeSlug, p_catalog: catalogSlug }))
      .then(({ data, error }) => (error || !data ? OFF : { ...OFF, ...(data as Partial<PublicFeatures>) }))
      .catch(() => OFF));
  }
  return cache.get(k)!;
}

export function usePublicFeatures(storeSlug: string | null | undefined, catalogSlug: string | null | undefined, enabled = true) {
  const [f, setF] = useState<PublicFeatures>(OFF);
  useEffect(() => {
    if (!enabled || !storeSlug || !catalogSlug) return;
    let alive = true;
    void fetchPublicFeatures(storeSlug, catalogSlug).then((v) => { if (alive) setF(v); });
    return () => { alive = false; };
  }, [storeSlug, catalogSlug, enabled]);
  return enabled && storeSlug && catalogSlug ? f : OFF;
}

/** Un identificador al azar por carrito (no dice nada del cliente). Se cambia al enviar el pedido. */
function newSession() {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
}
export function useCartSession(storeId: string | null | undefined, mode: string | null | undefined) {
  const key = storeId && mode ? `remhub:cart-session:${storeId}:${mode}` : null;
  const [session, setSession] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let s: string | null = null;
    try { s = window.localStorage.getItem(key); } catch { /* sin almacenamiento */ }
    if (!s || !/^[A-Za-z0-9-]{16,64}$/.test(s)) {
      s = newSession();
      try { window.localStorage.setItem(key, s); } catch { /* sin almacenamiento */ }
    }
    const t = window.setTimeout(() => setSession(s), 0);
    return () => window.clearTimeout(t);
  }, [key]);
  const renew = useCallback(() => {
    if (!key) return;
    const s = newSession();
    try { window.localStorage.setItem(key, s); } catch { /* sin almacenamiento */ }
    setSession(s);
  }, [key]);
  return { session, renew };
}

export const validPhone = (p: string) => /^\d{7,15}$/.test(p.replace(/\D/g, ""));

/** Guarda el carrito (con nombre y WhatsApp) un momento después del último cambio. */
export function useLeadAutosave(opts: {
  on: boolean; storeSlug?: string; catalog?: { slug: string; key: string | null } | null; session: string | null;
  name: string; phone: string; items: Array<{ productId: string; qty: number }>; paused: boolean;
}) {
  const { on, storeSlug, catalog, session, name, phone, items, paused } = opts;
  const sig = JSON.stringify([name.trim(), phone.replace(/\D/g, ""), items.map((i) => [i.productId, i.qty])]);
  const last = useRef("");
  useEffect(() => {
    if (!on || paused || !storeSlug || !catalog || !session) return;
    // Sin WhatsApp no se guarda nada (y si lo borró, se quita lo guardado).
    if (!validPhone(phone) && !last.current) return;
    if (sig === last.current) return;
    const t = window.setTimeout(() => {
      last.current = sig;
      void supabaseBrowser().rpc("catalog_cart_lead_save", {
        p_store: storeSlug, p_catalog: catalog.slug, p_key: catalog.key, p_session: session,
        p_name: name.trim(), p_phone: validPhone(phone) ? phone : "", p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [on, paused, storeSlug, catalog, session, sig, name, phone, items]);
}

export type AppliedCoupon = { code: string; discount: number; label: string; offerLines: number };

export function CouponBox({ storeSlug, catalog, items, applied, onApplied, disabled }: {
  storeSlug: string; catalog: { slug: string; key: string | null }; items: Array<{ productId: string; qty: number }>;
  applied: AppliedCoupon | null; onApplied: (c: AppliedCoupon | null) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(applied));
  const [code, setCode] = useState(applied?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const sig = JSON.stringify(items.map((i) => [i.productId, i.qty]));

  const check = useCallback(async (c: string, quiet = false) => {
    if (!c.trim()) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("catalog_coupon_check", {
      p_store: storeSlug, p_catalog: catalog.slug, p_key: catalog.key, p_code: c.trim(), p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    });
    setBusy(false);
    const r = data as { ok: boolean; message?: string; code?: string; discount?: number; label?: string; offer_lines?: number } | null;
    if (error || !r?.ok) {
      onApplied(null);
      setMsg(error ? "No se pudo revisar el cupón. Intenta de nuevo." : r?.message ?? "Ese cupón no sirve.");
      return;
    }
    setMsg("");
    onApplied({ code: r.code ?? c.trim().toUpperCase(), discount: Number(r.discount) || 0, label: r.label ?? "", offerLines: Number(r.offer_lines) || 0 });
    if (!quiet) try { navigator.vibrate?.(25); } catch { /* sin vibración */ }
  }, [storeSlug, catalog, items, onApplied]);

  // Si cambia el carrito, se vuelve a calcular el descuento.
  const appliedCode = applied?.code;
  useEffect(() => {
    if (!appliedCode) return;
    const t = window.setTimeout(() => void check(appliedCode, true), 500);
    return () => window.clearTimeout(t);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open && !applied) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="coupon-open mt-3 text-xs font-bold underline-offset-2 hover:underline" style={{ color: "var(--t-accent)" }}>
        🎟️ ¿Tienes un cupón?
      </button>
    );
  }
  return (
    <div className="mt-3">
      {applied ? (
        <div className="coupon-applied flex items-center justify-between gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "color-mix(in oklab, #ec4899 50%, transparent)", background: "color-mix(in oklab, #ec4899 10%, transparent)" }}>
          <p className="min-w-0 text-xs">
            <span className="font-black">🎟️ {applied.code}</span> · {applied.label}
            {applied.offerLines ? <span className="block text-[10px] opacity-75">No aplica a los productos que ya están en oferta.</span> : null}
          </p>
          <button type="button" disabled={disabled} onClick={() => { onApplied(null); setCode(""); }} className="shrink-0 rounded-lg border px-2 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar</button>
        </div>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void check(code); }}>
          <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setMsg(""); }} placeholder="Escribe tu cupón" maxLength={24} autoCapitalize="characters" disabled={disabled}
            className="ring-focus min-w-0 flex-1 rounded-xl border px-3 py-2 font-mono text-sm font-bold tracking-wider"
            style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)", color: "var(--t-text)" }} aria-label="Código del cupón" />
          <button type="submit" disabled={busy || !code.trim() || disabled} className="shrink-0 rounded-xl px-4 py-2 text-xs font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
            {busy ? "…" : "Aplicar"}
          </button>
        </form>
      )}
      {msg ? <p className="mt-1 text-[11px] font-semibold" style={{ color: "#ef4444" }}>{msg}</p> : null}
    </div>
  );
}
