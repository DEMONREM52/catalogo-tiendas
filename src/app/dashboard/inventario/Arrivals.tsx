"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toast } from "./shared";

/**
 * «¡Volvió!» (20261330): después de registrar un ingreso, lo que pasó de 0 unidades a tener otra vez (o llegó por
 * primera vez). Ofrece avisar a quienes lo esperaban en «Avísame», ponerle «🆕 Nuevo» en el catálogo y verlo en el Radar.
 */
export type Arrival = {
  product_id: string; name: string; sku: string | null; image_url: string | null; kind: "new" | "back"; at: string;
  stock: number; active: boolean; waiting: number; no_photo: boolean; no_category: boolean; published: boolean;
};

/** Lo que llegó hoy entre estos productos (null si falta la migración o el permiso). */
export async function loadArrivals(storeId: string, productIds: string[]): Promise<Arrival[] | null> {
  const { data, error } = await supabaseBrowser().rpc("erp_product_arrivals_list", { p_store: storeId, p_since: null, p_days: 1 });
  const d = data as { ok?: boolean; items?: Arrival[] } | null;
  if (error || !d?.ok) return null;
  const ids = new Set(productIds);
  return (d.items ?? []).filter((a) => ids.has(a.product_id));
}

export function ArrivalsBanner({ storeId, title, items, canBadge, onClose }: {
  storeId: string; title: string; items: Arrival[]; canBadge: boolean; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [badged, setBadged] = useState(false);
  const back = items.filter((i) => i.kind === "back");
  const fresh = items.filter((i) => i.kind === "new");
  const waiting = items.reduce((s, i) => s + Number(i.waiting || 0), 0);
  const incomplete = items.filter((i) => i.no_photo || i.no_category).length;

  async function badgeNew() {
    setBusy(true);
    const ends = new Date(Date.now() - 5 * 3600_000 + 15 * 86400_000).toISOString().slice(0, 10);
    let ok = 0, failed = 0, message = "";
    for (const i of items) {
      const { data, error } = await supabaseBrowser().rpc("product_badge_save", { p_store: storeId, p_product: i.product_id, p_kind: "new", p_on: true, p_starts: null, p_ends: ends, p_before: null, p_text: null });
      const d = data as { ok?: boolean; message?: string } | null;
      if (error || !d?.ok) { failed++; message = d?.message ?? (error && /Could not find the function|schema cache/i.test(error.message) ? "Falta correr la migración 20261329 en Supabase." : error?.message ?? ""); }
      else ok++;
    }
    setBusy(false);
    if (ok) setBadged(true);
    void toast(failed ? `«Nuevo» en ${ok} de ${items.length}` : `🆕 «Nuevo» en ${ok} producto(s) por 15 días`, failed ? "warning" : "success", failed ? message : "Se ve en el catálogo y se apaga sola.");
  }

  const chip = "rounded-full border px-3 py-1.5 text-xs font-bold";
  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, #10b981 45%, var(--t-card-border))", background: "color-mix(in oklab, #10b981 7%, transparent)" }}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-2xl" aria-hidden>📦</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{title}</p>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            {back.length ? `🔁 ${back.length} volvieron a tener unidades` : ""}{back.length && fresh.length ? " · " : ""}{fresh.length ? `🆕 ${fresh.length} llegaron por primera vez` : ""}
            {waiting ? ` · 🔔 ${waiting} cliente${waiting === 1 ? "" : "s"} los esperaba${waiting === 1 ? "" : "n"}` : ""}
            {incomplete ? ` · ⚠️ ${incomplete} sin foto o sin categoría` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="px-1 text-sm">✕</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.slice(0, 12).map((i) => (
          <span key={i.product_id} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--t-card-border)" }} title={i.kind === "back" ? "¡Volvió!" : "Llegó por primera vez"}>
            {i.kind === "back" ? "🔁" : "🆕"} {i.name}{i.waiting ? ` · 🔔${i.waiting}` : ""}{i.no_photo ? " · 📷" : ""}
          </span>
        ))}
        {items.length > 12 ? <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>y {items.length - 12} más</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {waiting ? <a href="/dashboard/vender-mas?ver=avisame" target="_blank" rel="noreferrer" className={chip} style={{ borderColor: "var(--t-card-border)" }}>🔔 Avisar a los {waiting} que esperaban</a> : null}
        {canBadge && !badged ? (
          <button type="button" disabled={busy} onClick={() => void badgeNew()} className={chip} style={{ borderColor: "var(--t-card-border)" }}>{busy ? "Poniendo…" : "🆕 Ponerles «Nuevo» 15 días"}</button>
        ) : null}
        <a href="/dashboard/products/radar?llegaron=1" target="_blank" rel="noreferrer" className={chip} style={{ borderColor: "var(--t-card-border)" }}>📣 Verlos en el Radar para publicar{incomplete ? " y completar" : ""}</a>
      </div>
    </div>
  );
}
