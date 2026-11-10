"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgePercent, Loader2, Lock, Star, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { DateField } from "@/components/forms/Fields";
import { OfferImageButton } from "@/components/products/OfferImageButton";

/**
 * Oferta y destacado del producto: «Antes $20.000 · Ahora $15.000 (-25 %)», con fecha de fin opcional y etiqueta.
 * Se guarda aparte (no con «Guardar»): se cobra en catálogos y POS mientras dure y al vencer vuelve sola al precio
 * normal. Los precios 1-5 no cambian. Requiere «Cambiar precios» (20261309).
 */

type Offer = { offer_price: number | null; ends_at: string | null; featured: boolean; label: string | null; running: boolean };
const LABELS = ["Oferta", "Nuevo precio", "Liquidación", "Promo del día", "Últimas unidades", "Black Friday"];
const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const toast = (title: string, icon: "success" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2400, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
const bogotaDay = (iso: string) => new Date(new Date(iso).getTime() - 5 * 3600_000 - 1000).toISOString().slice(0, 10);

export function OfferPanel({ storeId, productId, normalPrice }: { storeId: string; productId: string; normalPrice: number }) {
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [canEdit, setCanEdit] = useState(false);
  const [saved, setSaved] = useState<Offer | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [ends, setEnds] = useState("");
  const [label, setLabel] = useState("Oferta");
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabaseBrowser().rpc("product_offer_get", { p_store: storeId, p_product: productId }).then(({ data, error }) => {
      if (error) { setState(/Could not find the function|schema cache|does not exist/i.test(error.message) ? "missing" : "ready"); return; }
      const d = data as { ok?: boolean; can_edit?: boolean; offer?: Offer | null } | null;
      setCanEdit(Boolean(d?.can_edit));
      const o = d?.offer ?? null;
      setSaved(o);
      setPrice(o?.offer_price ? Number(o.offer_price) : null);
      setEnds(o?.ends_at ? bogotaDay(o.ends_at) : "");
      setLabel(o?.label ?? "Oferta");
      setFeatured(Boolean(o?.featured));
      setState("ready");
    });
  }, [storeId, productId]);

  const pct = price && normalPrice > 0 && price < normalPrice ? Math.round(100 * (1 - price / normalPrice)) : 0;
  const tooHigh = Boolean(price && normalPrice > 0 && price >= normalPrice);

  async function save(clear = false) {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("product_offer_save", {
      p_store: storeId, p_product: productId,
      p_offer_price: clear ? null : price, p_ends_on: clear || !price ? null : ends || null,
      p_featured: clear ? featured : featured, p_label: clear ? null : (price || featured ? label : null),
    });
    setBusy(false);
    const d = data as { ok?: boolean; message?: string; offer?: Offer | null } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se guardó", "error"); return; }
    setSaved(d.offer ?? null);
    if (clear) { setPrice(null); setEnds(""); }
    toast(clear ? "Oferta quitada: vuelve el precio normal" : price ? `🏷️ ¡Oferta activa! ${money(price)}${pct ? ` (-${pct} %)` : ""}` : "⭐ Guardado");
  }

  if (state === "missing") return <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "#f59e0b" }}>🏷️ Para poner ofertas y destacados corre en Supabase la migración <b>20261309_ofertas_destacados.sql</b>.</p>;
  if (state === "loading") return <p className="text-xs" style={{ color: "var(--t-muted)" }}><Loader2 size={12} className="mr-1 inline animate-spin" /> Cargando oferta…</p>;

  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return (
    <section className="overflow-hidden rounded-2xl border" style={{ borderColor: saved?.running ? "#ef4444" : "color-mix(in oklab, #ef4444 35%, var(--t-card-border))", background: "linear-gradient(135deg, color-mix(in oklab, #ef4444 9%, var(--t-card-bg)), var(--t-card-bg))" }}>
      <div className="flex items-center gap-3 p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow" style={{ background: "linear-gradient(135deg,#ef4444,#f59e0b)" }}><BadgePercent size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">Oferta y destacado</p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>«Antes y ahora» en catálogos, página del producto y POS. Al vencer vuelve solo al precio normal.</p>
        </div>
        {saved?.running ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">ACTIVA</span> : null}
      </div>
      {saved?.running ? <div className="px-3 pb-2"><OfferImageButton storeId={storeId} productId={productId} /></div> : null}
      {!canEdit ? <p className="flex items-center gap-1.5 px-3 pb-3 text-xs" style={{ color: "var(--t-muted)" }}><Lock size={12} /> Solo quien tiene «Cambiar precios» pone ofertas.</p> : null}
      <fieldset disabled={!canEdit || busy} className="space-y-3 px-3 pb-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">💲 Precio de oferta
            <MoneyInput value={price} allowEmpty onValueChange={setPrice} placeholder={normalPrice ? `Menos de ${money(normalPrice)}` : "Ej: 15.000"} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base font-black" style={field} ariaLabel="Precio de oferta" />
          </label>
          <label className="block text-xs font-bold">📅 Hasta (opcional)
            <DateField value={ends} onChange={setEnds} min={new Date().toISOString().slice(0, 10)} className="mt-1" ariaLabel="Fecha de fin de la oferta" />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LABELS.map((l) => (
            <button key={l} type="button" onClick={() => setLabel(l)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
              style={label === l ? { borderColor: "#ef4444", background: "#ef4444", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>{l}</button>
          ))}
          <input value={LABELS.includes(label) ? "" : label} maxLength={30} onChange={(e) => setLabel(e.target.value)} placeholder="Otra etiqueta…" className="w-32 rounded-full border px-2.5 py-1 text-[11px]" style={field} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> <Star size={13} className="text-amber-500" fill="currentColor" /> Destacado (sale primero y en «Destacados» de todos los catálogos)
        </label>

        {/* Vista previa como en el catálogo */}
        <AnimatePresence>
          {price && !tooHigh ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-xl border p-2.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
              <span className="offer-pct-badge rounded-xl px-2 py-1 text-sm font-black text-white">-{pct}%</span>
              <div>
                <p className="text-[11px] line-through" style={{ color: "var(--t-muted)" }}>Antes {money(normalPrice)}</p>
                <p className="text-lg font-black text-red-500">{money(price)}</p>
              </div>
              <span className="ml-auto rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-black text-red-500">{label}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {tooHigh ? <p className="text-[11px] text-amber-500">⚠️ El precio de oferta debe ser menor que el normal ({money(normalPrice)}); si no, no se aplica.</p> : null}

        <div className="flex gap-2">
          <button type="button" onClick={() => void save()} disabled={!canEdit || busy || tooHigh || (!price && !featured && !saved)} className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#ef4444,#f59e0b)" }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <BadgePercent size={15} />} {price ? "Activar oferta" : "Guardar"}
          </button>
          {saved?.offer_price ? (
            <button type="button" onClick={() => void save(true)} disabled={!canEdit || busy} className="inline-flex items-center gap-1 rounded-xl border px-3 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}><Trash2 size={13} /> Quitar oferta</button>
          ) : null}
        </div>
        <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>Se guarda al tocar el botón (no con «Guardar» del producto). Se compara con el precio que ves en el catálogo; en catálogos con otra lista de precio solo baja si la oferta es menor.</p>
      </fieldset>
    </section>
  );
}
