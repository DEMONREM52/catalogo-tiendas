"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { EmojiPicker } from "@/components/products/EmojiPicker";
import { toast } from "@/app/dashboard/inventario/shared";
import { featureInfo, saveFeature, type FeatureKey, type FeatureMap, type FeatureState } from "@/lib/features";
import { ShippingBar } from "@/lib/cart/ShippingBar";

const field = "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const COLORS = ["#10b981", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899", "#f97316", "#ef4444", "#111827"];
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export const DEFAULT_TEXT = {
  carritos: "Hola {cliente} 👋, vi que te interesó {productos} en {tienda}. ¿Te ayudo a terminar tu pedido? 🛍️",
  avisame: "¡Hola {cliente}! 🎉 Ya llegó {producto} a {tienda}. Míralo aquí: {enlace}",
  avisameBtn: "🔔 Avísame cuando llegue",
  missing: "Te faltan {falta} para el envío gratis 🚚",
  done: "¡Listo! Tu pedido tiene envío gratis 🎉",
  line: "🚚 Envío gratis",
  recompra: "Hola {cliente} 👋, hace {dias} días llevaste {producto} en {tienda}. ¿Te mando lo nuevo o te separo otro? 😊",
  cumple: "¡Feliz cumpleaños, {cliente}! 🎂🎉 En {tienda} te queremos consentir hoy. Escríbenos y te tenemos un detalle.",
};

/** Ajustes de una función: en una ventana (o dentro de la bandeja con `inline`). */
export function FeatureSettings({ storeId, feature, state, canConfig, inline, onClose, onSaved }: {
  storeId: string; feature: FeatureKey; state: FeatureState; canConfig: boolean; inline?: boolean;
  onClose?: () => void; onSaved: (f: FeatureMap) => void;
}) {
  const info = featureInfo(feature);
  const [s, setS] = useState<Record<string, unknown>>(() => ({ ...state.settings }));
  const [busy, setBusy] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [catalogs, setCatalogs] = useState<Array<{ slug: string; name: string }>>([]);
  const set = (k: string, v: unknown) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (feature !== "envio_gratis") return;
    void supabaseBrowser().from("store_catalogs").select("slug,name,active").eq("store_id", storeId).order("sort_order")
      .then(({ data }) => setCatalogs(((data ?? []) as Array<{ slug: string | null; name: string; active?: boolean | null }>)
        .filter((c) => c.slug && c.active !== false).map((c) => ({ slug: c.slug as string, name: c.name }))));
  }, [feature, storeId]);

  async function save() {
    if (feature === "envio_gratis" && !(Number(s.min) > 0)) return void toast("Escribe desde qué valor el envío es gratis", "warning");
    setBusy(true);
    const r = await saveFeature(storeId, feature, feature === "envio_gratis" ? true : state.enabled, s);
    setBusy(false);
    if (!r.ok) return void toast("No se pudo guardar", "error", r.message);
    void toast("Guardado");
    onSaved(r.features);
  }

  const cats = Array.isArray(s.catalog_slugs) ? (s.catalog_slugs as string[]) : [];
  const body: ReactNode = (
    <div className="space-y-4">
      {feature === "envio_gratis" ? (
        <>
          <label className="block text-xs font-bold">Envío gratis desde
            <MoneyInput value={Number(s.min) > 0 ? Number(s.min) : null} allowEmpty onValueChange={(v) => set("min", v ?? 0)} className={field} style={fs} placeholder="$ 150.000" ariaLabel="Monto para envío gratis" disabled={!canConfig} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="relative">
              <p className="text-xs font-bold">Emoji</p>
              <button type="button" disabled={!canConfig} onClick={() => setEmoji((x) => !x)} className="mt-1 grid h-11 w-14 place-items-center rounded-xl border text-2xl" style={fs}>{str(s.icon, "🚚")}</button>
            </div>
            <div>
              <p className="text-xs font-bold">Color de la barra</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" disabled={!canConfig} onClick={() => set("color", c)} aria-label={`Color ${c}`}
                    className="h-8 w-8 rounded-full border-2 transition" style={{ background: c, borderColor: str(s.color, "#10b981") === c ? "var(--t-text)" : "transparent" }} />
                ))}
              </div>
            </div>
          </div>
          {emoji ? <EmojiPicker onPick={(e) => { set("icon", e); setEmoji(false); }} onClose={() => setEmoji(false)} /> : null}
          <label className="block text-xs font-bold">Mensaje cuando le falta
            <input value={str(s.missing)} placeholder={DEFAULT_TEXT.missing} maxLength={140} disabled={!canConfig} onChange={(e) => set("missing", e.target.value)} className={field} style={fs} />
            <span className="mt-1 block text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>{"{falta}"} se cambia por lo que le falta, por ejemplo $12.000.</span>
          </label>
          <label className="block text-xs font-bold">Mensaje cuando ya lo logró
            <input value={str(s.done)} placeholder={DEFAULT_TEXT.done} maxLength={140} disabled={!canConfig} onChange={(e) => set("done", e.target.value)} className={field} style={fs} />
          </label>
          <label className="block text-xs font-bold">Línea en el pedido de WhatsApp
            <input value={str(s.line)} placeholder={DEFAULT_TEXT.line} maxLength={80} disabled={!canConfig} onChange={(e) => set("line", e.target.value)} className={field} style={fs} />
          </label>
          <div>
            <p className="text-xs font-bold">¿En qué catálogos?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Chip on={!cats.length} onClick={() => set("catalog_slugs", [])}>✅ En todos</Chip>
              {catalogs.map((c) => (
                <Chip key={c.slug} on={cats.includes(c.slug)} onClick={() => set("catalog_slugs", cats.includes(c.slug) ? cats.filter((x) => x !== c.slug) : [...cats, c.slug])}>{c.name}</Chip>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)" }}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Así se ve en el carrito</p>
            <ShippingBar total={Math.round((Number(s.min) || 150000) * 0.78)} cfg={{ min: Number(s.min) || 150000, missing: str(s.missing, DEFAULT_TEXT.missing) || DEFAULT_TEXT.missing, done: str(s.done, DEFAULT_TEXT.done) || DEFAULT_TEXT.done, line: "", icon: str(s.icon, "🚚"), color: str(s.color, "#10b981") }} />
            <div className="mt-2"><ShippingBar total={(Number(s.min) || 150000) + 1} cfg={{ min: Number(s.min) || 150000, missing: "", done: str(s.done, DEFAULT_TEXT.done) || DEFAULT_TEXT.done, line: "", icon: str(s.icon, "🚚"), color: str(s.color, "#10b981") }} /></div>
          </div>
        </>
      ) : null}

      {feature === "carritos" ? (
        <TemplateField label="Mensaje para escribirle al cliente" value={str(s.message)} placeholder={DEFAULT_TEXT.carritos} onChange={(v) => set("message", v)} disabled={!canConfig}
          vars="{cliente} {productos} {total} {tienda} {enlace}" />
      ) : null}

      {feature === "avisame" ? (
        <>
          <label className="block text-xs font-bold">Texto del botón en el catálogo
            <input value={str(s.button)} placeholder={DEFAULT_TEXT.avisameBtn} maxLength={60} disabled={!canConfig} onChange={(e) => set("button", e.target.value)} className={field} style={fs} />
          </label>
          <TemplateField label="Mensaje cuando llega" value={str(s.message)} placeholder={DEFAULT_TEXT.avisame} onChange={(v) => set("message", v)} disabled={!canConfig}
            vars="{cliente} {producto} {tienda} {enlace}" />
        </>
      ) : null}

      {feature === "recompra" ? (
        <>
          <label className="block text-xs font-bold">Avisar cuando un cliente lleve sin comprar
            <select value={Number(s.days) || 0} disabled={!canConfig} onChange={(e) => set("days", Number(e.target.value))} className={field} style={fs}>
              <option value={0}>Automático (según cada cuánto compra)</option>
              {[15, 21, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} días</option>)}
            </select>
          </label>
          <TemplateField label="Mensaje de recompra" value={str(s.message)} placeholder={DEFAULT_TEXT.recompra} onChange={(v) => set("message", v)} disabled={!canConfig}
            vars="{cliente} {producto} {dias} {tienda}" />
          <TemplateField label="Mensaje de cumpleaños" value={str(s.birthday)} placeholder={DEFAULT_TEXT.cumple} onChange={(v) => set("birthday", v)} disabled={!canConfig}
            vars="{cliente} {tienda}" />
        </>
      ) : null}

      {canConfig ? (
        <div className="flex justify-end gap-2">
          {onClose && !inline ? <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button> : null}
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl px-5 py-2.5 text-sm font-black text-white" style={{ background: info.color }}>
            {busy ? "Guardando…" : feature === "envio_gratis" && !state.enabled ? "Guardar y encender" : "Guardar"}
          </button>
        </div>
      ) : null}
    </div>
  );

  if (inline) return <div><h3 className="mb-3 text-lg font-black">{info.emoji} {info.title}</h3>{body}</div>;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/50 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Ajustes de ${info.title}`}>
      <div className="vm-sheet max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border p-5 sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-black">{info.emoji} {info.title}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">✕</button>
        </div>
        {body}
      </div>
    </div>,
    document.body,
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
      style={on ? { borderColor: "#10b981", background: "color-mix(in oklab, #10b981 20%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
      {on ? "✓ " : ""}{children}
    </button>
  );
}

function TemplateField({ label, value, placeholder, onChange, disabled, vars }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; disabled: boolean; vars: string }) {
  return (
    <label className="block text-xs font-bold">{label}
      <textarea value={value} placeholder={placeholder} rows={3} maxLength={500} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={field} style={fs} />
      <span className="mt-1 block text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>Vacío = el mensaje de ejemplo. Puedes usar {vars}.</span>
    </label>
  );
}
