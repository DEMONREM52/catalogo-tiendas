"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePublicFeatures, validPhone } from "@/lib/cart/CartExtras";

const SAVED = "remhub:notify-me:contact";

/**
 * «Avísame cuando llegue» (20261312): en un producto agotado el cliente deja su nombre y WhatsApp.
 * Solo sale si la tienda lo encendió; si no, se muestra `fallback` (el «Agotado» de siempre).
 */
export function NotifyMe({ storeSlug, catalogSlug, accessKey, productId, productName, fallback, compact }: {
  storeSlug: string; catalogSlug: string | null; accessKey: string | null; productId: string; productName: string;
  fallback?: React.ReactNode; compact?: boolean;
}) {
  const f = usePublicFeatures(storeSlug, catalogSlug);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (!f.avisame || !catalogSlug) return <>{fallback ?? null}</>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`notify-me-btn inline-flex items-center justify-center gap-1.5 rounded-2xl font-extrabold ${compact ? "px-3 py-2 text-xs" : "w-full px-4 py-3 text-sm"}`}
        style={{ background: done ? "color-mix(in oklab, #10b981 18%, transparent)" : "linear-gradient(135deg,#8b5cf6,#6366f1)", color: done ? "#10b981" : "#fff", border: done ? "1px solid #10b981" : "none" }}>
        {done ? "✅ Te avisamos" : <><Bell size={compact ? 14 : 16} className="notify-bell" aria-hidden /> {f.avisame.button}</>}
      </button>
      {open ? <NotifyDialog storeSlug={storeSlug} catalogSlug={catalogSlug} accessKey={accessKey} productId={productId} productName={productName}
        onClose={() => setOpen(false)} onDone={() => { setDone(true); setOpen(false); }} /> : null}
    </>
  );
}

function NotifyDialog({ storeSlug, catalogSlug, accessKey, productId, productName, onClose, onDone }: {
  storeSlug: string; catalogSlug: string; accessKey: string | null; productId: string; productName: string; onClose: () => void; onDone: () => void;
}) {
  const saved = (() => { try { return JSON.parse(window.localStorage.getItem(SAVED) ?? "{}") as { name?: string; phone?: string }; } catch { return {}; } })();
  const [name, setName] = useState(saved.name ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function send() {
    if (!validPhone(phone)) return setMsg("Escribe tu WhatsApp (10 números).");
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("catalog_notify_me", {
      p_store: storeSlug, p_catalog: catalogSlug, p_key: accessKey, p_product: productId, p_name: name.trim(), p_phone: phone,
    });
    setBusy(false);
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || !r?.ok) return setMsg(r?.message ?? "No se pudo. Intenta de nuevo.");
    try { window.localStorage.setItem(SAVED, JSON.stringify({ name: name.trim(), phone })); } catch { /* sin almacenamiento */ }
    setOk(true);
    window.setTimeout(onDone, 1600);
  }

  const input = "ring-focus mt-1 w-full rounded-xl border px-3 py-2.5 text-sm";
  const st = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 86%, transparent)", color: "var(--t-text)" };
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Avísame cuando llegue">
      <div className="notify-sheet w-full max-w-sm rounded-t-[28px] border p-5 sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }} onClick={(e) => e.stopPropagation()}>
        {ok ? (
          <div className="py-6 text-center">
            <p className="notify-ok text-5xl" aria-hidden>🎉</p>
            <p className="mt-3 text-lg font-black">¡Listo!</p>
            <p className="mt-1 text-sm opacity-75">Te escribimos por WhatsApp apenas llegue.</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <p className="text-3xl" aria-hidden>🔔</p>
            <h3 className="mt-2 text-lg font-black leading-tight">Te avisamos cuando llegue</h3>
            <p className="mt-1 line-clamp-2 text-sm opacity-75">{productName}</p>
            <label className="mt-4 block text-xs font-bold">Tu nombre
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej: Ana" autoComplete="name" className={input} style={st} />
            </label>
            <label className="mt-3 block text-xs font-bold">Tu WhatsApp
              <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d +()-]/g, "")); setMsg(""); }} inputMode="tel" autoComplete="tel" placeholder="300 123 4567" className={input} style={st} />
            </label>
            {msg ? <p className="mt-2 text-xs font-bold" style={{ color: "#ef4444" }}>{msg}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} className="rounded-2xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
              <button type="submit" disabled={busy} className="flex-1 rounded-2xl px-4 py-3 text-sm font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}>
                {busy ? "Guardando…" : "Avísame"}
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] opacity-60">Solo lo usamos para avisarte de este producto.</p>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
