"use client";

import { useState } from "react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchPublicItems } from "@/lib/catalog/public-prices";
import { PRODUCTION_ORIGIN } from "@/lib/share/origin";
import { toast } from "./shared";

type CatalogOption = { slug: string; name: string; access_key: string | null };

/** Elige el catálogo (si hay varios) con el que se comparten las novedades: sus precios y su enlace. */
async function pickCatalog(storeId: string): Promise<{ store: { id: string; slug: string; name: string }; cat: CatalogOption } | null> {
  const sb = supabaseBrowser();
  const [{ data: st }, { data: cats }] = await Promise.all([
    sb.from("stores").select("id,slug,name").eq("id", storeId).maybeSingle(),
    sb.from("store_catalogs").select("slug,name,access_key,active").eq("store_id", storeId).order("sort_order"),
  ]);
  const store = st as { id: string; slug: string; name: string } | null;
  const list = ((cats ?? []) as Array<CatalogOption & { active?: boolean | null }>).filter((c) => c.active !== false && c.slug);
  if (!store?.slug) { void toast("No encontré el enlace de la tienda", "error"); return null; }
  if (!list.length) return { store, cat: { slug: "detal", name: "Catálogo", access_key: null } };
  if (list.length === 1) return { store, cat: list[0] };
  const r = await Swal.fire({
    title: "¿Con qué catálogo?", text: "Sus precios y su enlace son los que se comparten.", input: "select",
    inputOptions: Object.fromEntries(list.map((c) => [c.slug, c.name])), showCancelButton: true, confirmButtonText: "Seguir", cancelButtonText: "Cancelar",
    background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#10b981",
  });
  if (!r.isConfirmed) return null;
  return { store, cat: list.find((c) => c.slug === r.value) ?? list[0] };
}

/** «Novedades»: catálogo en PDF con solo estos productos, o texto para WhatsApp con precio y enlace de cada uno. */
export async function shareNovedades(storeId: string, productIds: string[], how: "pdf" | "whatsapp") {
  const ids = [...new Set(productIds)].slice(0, 300);
  if (!ids.length) return;
  const picked = await pickCatalog(storeId);
  if (!picked) return;
  const { store, cat } = picked;
  const keyQ = cat.access_key ? `&key=${encodeURIComponent(cat.access_key)}` : "";
  if (how === "pdf") {
    window.open(`/documento/catalogo?tienda=${encodeURIComponent(store.slug)}&catalogo=${encodeURIComponent(cat.slug)}${keyQ}&ids=${ids.join(",")}&titulo=${encodeURIComponent("Novedades")}`, "_blank");
    return;
  }
  const sb = supabaseBrowser();
  const items = new Map<string, { name: string; price: number }>();
  for (let i = 0; i < ids.length; i += 60) {
    const got = await fetchPublicItems(sb, { id: store.id, slug: store.slug }, cat.slug, cat.access_key, ids.slice(i, i + 60));
    got.forEach((v, k) => items.set(k, { name: v.name, price: v.price }));
  }
  if (!items.size) return void toast("Ninguno está disponible en ese catálogo", "warning", "Revisa que tengan precio y unidades en ese catálogo.");
  const lines = ids.filter((id) => items.has(id)).slice(0, 40).map((id) => {
    const it = items.get(id)!;
    return `• ${it.name} — $${Math.round(it.price).toLocaleString("es-CO")}\n  ${PRODUCTION_ORIGIN}/${store.slug}/producto/${id}?catalogo=${encodeURIComponent(cat.slug)}${keyQ}`;
  });
  const text = `🆕 ¡Llegó mercancía a ${store.name}!\n\n${lines.join("\n")}${items.size > 40 ? `\n\n…y ${items.size - 40} más en el catálogo: ${PRODUCTION_ORIGIN}/${store.slug}/${encodeURIComponent(cat.slug)}` : ""}`;
  try { await navigator.clipboard.writeText(text); } catch { /* sin portapapeles */ }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  void toast("Texto de novedades copiado", "success", "Se abrió WhatsApp para que elijas a quién mandarlo (también puedes pegarlo en un estado o grupo).");
}

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
        <button type="button" onClick={() => void shareNovedades(storeId, items.map((i) => i.product_id), "whatsapp")} className={chip} style={{ borderColor: "var(--t-card-border)" }}>💬 Novedades por WhatsApp</button>
        <button type="button" onClick={() => void shareNovedades(storeId, items.map((i) => i.product_id), "pdf")} className={chip} style={{ borderColor: "var(--t-card-border)" }}>📄 Novedades en PDF</button>
        <a href="/dashboard/products/radar?llegaron=1" target="_blank" rel="noreferrer" className={chip} style={{ borderColor: "var(--t-card-border)" }}>📣 Verlos en el Radar para publicar{incomplete ? " y completar" : ""}</a>
      </div>
    </div>
  );
}
