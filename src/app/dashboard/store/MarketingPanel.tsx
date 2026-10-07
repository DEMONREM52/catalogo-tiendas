"use client";

import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, ExternalLink, Info, Save } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Tracking = {
  meta_pixel_id: string;
  meta_enabled: boolean;
  order_event: "Purchase" | "Lead" | "none";
  track_view_content: boolean;
  track_add_to_cart: boolean;
  track_checkout: boolean;
  track_search: boolean;
  track_contact: boolean;
};

const EMPTY: Tracking = {
  meta_pixel_id: "",
  meta_enabled: true,
  order_event: "Purchase",
  track_view_content: true,
  track_add_to_cart: true,
  track_checkout: true,
  track_search: true,
  track_contact: true,
};

const EVENTS: Array<[keyof Tracking, string, string]> = [
  ["track_view_content", "Ver producto", "ViewContent · cuando abren la ficha de un producto"],
  ["track_add_to_cart", "Agregar al carrito", "AddToCart · cada vez que agregan un producto"],
  ["track_checkout", "Iniciar pedido", "InitiateCheckout · cuando envían el carrito"],
  ["track_search", "Búsquedas", "Search · lo que buscan en tu catálogo"],
  ["track_contact", "Contacto por WhatsApp", "Contact · cuando tocan un asesor"],
];

const COLUMNS = "meta_pixel_id,meta_enabled,order_event,track_view_content,track_add_to_cart,track_checkout,track_search,track_contact";

function isMissingTable(message: string) {
  return /store_tracking|does not exist|schema cache|PGRST205|42P01/i.test(message);
}

/** Marketing y medición: Píxel de Meta (Facebook / Instagram) de cada tienda. */
export function MarketingPanel({ storeId, storeSlug, canEdit, siteOrigin }: { storeId: string; storeSlug: string; canEdit: boolean; siteOrigin: string }) {
  const [form, setForm] = useState<Tracking>(EMPTY);
  const [saved, setSaved] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabaseBrowser().from("store_tracking").select(COLUMNS).eq("store_id", storeId).maybeSingle();
      if (!alive) return;
      setLoading(false);
      if (error) {
        if (isMissingTable(error.message)) setMissing(true);
        return;
      }
      if (data) {
        const next = { ...EMPTY, ...(data as Partial<Tracking>), meta_pixel_id: String((data as Partial<Tracking>).meta_pixel_id ?? "") };
        setForm(next);
        setSaved(next);
      }
    })();
    return () => { alive = false; };
  }, [storeId]);

  const pixel = form.meta_pixel_id.replace(/\D/g, "");
  const pixelValid = pixel === "" || /^\d{6,20}$/.test(pixel);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved ?? EMPTY);
  const live = Boolean(saved?.meta_enabled && saved.meta_pixel_id);

  async function save() {
    if (!canEdit || saving) return;
    if (!pixelValid) {
      await Swal.fire({ icon: "warning", title: "Revisa el ID del píxel", text: "El identificador del Píxel de Meta tiene solo números (normalmente 15 o 16 dígitos).", background: "var(--t-bg-base)", color: "var(--t-text)" });
      return;
    }
    setSaving(true);
    const payload = { store_id: storeId, ...form, meta_pixel_id: pixel || null };
    const { error } = await supabaseBrowser().from("store_tracking").upsert(payload, { onConflict: "store_id" });
    setSaving(false);
    if (error) {
      if (isMissingTable(error.message)) setMissing(true);
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: isMissingTable(error.message) ? "Ejecuta en Supabase la migración 20261016_smart_search_purchase_edit_tracking.sql y vuelve a intentarlo." : error.message,
        background: "var(--t-bg-base)",
        color: "var(--t-text)",
      });
      return;
    }
    const next = { ...form, meta_pixel_id: pixel };
    setForm(next);
    setSaved(next);
    await Swal.fire({
      icon: "success",
      title: pixel && form.meta_enabled ? "Píxel activado" : "Medición guardada",
      text: pixel && form.meta_enabled ? "Tus catálogos ya envían eventos a Meta. Pueden tardar unos minutos en verse en el Administrador de eventos." : "Los cambios quedaron guardados.",
      timer: 2200,
      showConfirmButton: false,
      background: "var(--t-bg-base)",
      color: "var(--t-text)",
    });
  }

  const inputStyle = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" };
  const testUrl = `${siteOrigin}/${storeSlug}/detal`;

  return (
    <section className="glass-soft overflow-hidden rounded-3xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--t-card-border)" }}>
        <div>
          <h2 className="inline-flex items-center gap-2 font-bold"><BarChart3 size={18} /> Marketing y medición</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
            Conecta tu Píxel de Meta (Facebook e Instagram) para medir visitas, carritos y pedidos de tus catálogos y crear públicos para tus anuncios.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
          style={live
            ? { borderColor: "color-mix(in oklab, #22c55e 45%, transparent)", color: "#22c55e", background: "color-mix(in oklab, #22c55e 10%, transparent)" }
            : { borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}
        >
          {live ? <><CheckCircle2 size={14} /> Píxel activo</> : "Píxel sin configurar"}
        </span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        {missing ? (
          <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-100">
            Para usar el píxel ejecuta una vez en Supabase → SQL Editor el archivo <b className="font-mono">supabase/migrations/20261016_smart_search_purchase_edit_tracking.sql</b> y recarga esta página.
          </p>
        ) : null}

        <fieldset disabled={!canEdit || loading || saving} className="space-y-5 disabled:opacity-80">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block min-w-0 text-sm font-semibold">
              ID del Píxel de Meta
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2.5 font-mono text-sm tracking-wider outline-none transition focus:ring-2 focus:ring-fuchsia-500/25"
                style={{ ...inputStyle, borderColor: pixelValid ? inputStyle.borderColor : "#ef4444" }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ej: 123456789012345"
                value={form.meta_pixel_id}
                onChange={(e) => setForm({ ...form, meta_pixel_id: e.target.value.replace(/[^\d]/g, "").slice(0, 20) })}
              />
              <span className="mt-1 block text-xs font-normal" style={{ color: pixelValid ? "var(--t-muted)" : "#ef4444" }}>
                {pixelValid
                  ? "Lo encuentras en Meta Business → Administrador de eventos → Orígenes de datos → tu píxel (número debajo del nombre)."
                  : "Solo números, entre 6 y 20 dígitos."}
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
              <input type="checkbox" className="h-4 w-4 accent-fuchsia-600" checked={form.meta_enabled} onChange={(e) => setForm({ ...form, meta_enabled: e.target.checked })} />
              <span className="text-sm font-semibold">Píxel encendido</span>
            </label>
          </div>

          <div>
            <p className="text-sm font-semibold">¿Qué quieres medir?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-start gap-3 rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)", opacity: 0.85 }}>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-fuchsia-600" checked readOnly disabled />
                <span><b className="block text-sm">Visitas</b><span className="block text-xs" style={{ color: "var(--t-muted)" }}>PageView · siempre activo</span></span>
              </div>
              {EVENTS.map(([key, label, hint]) => (
                <label key={key} className="flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition hover:border-fuchsia-400/40" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-fuchsia-600" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                  <span><b className="block text-sm">{label}</b><span className="block text-xs" style={{ color: "var(--t-muted)" }}>{hint}</span></span>
                </label>
              ))}
            </div>
          </div>

          <label className="block max-w-xl text-sm font-semibold">
            Cuando un cliente envía un pedido, contarlo como…
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={inputStyle}
              value={form.order_event}
              onChange={(e) => setForm({ ...form, order_event: e.target.value as Tracking["order_event"] })}
            >
              <option value="Purchase">Compra (Purchase) · recomendado para optimizar ventas</option>
              <option value="Lead">Cliente potencial (Lead) · si cobras después por WhatsApp</option>
              <option value="none">No enviar este evento</option>
            </select>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          <p className="flex max-w-2xl items-start gap-2">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              Para probarlo abre tu catálogo con la extensión <b>Meta Pixel Helper</b> o en Administrador de eventos → <b>Probar eventos</b>.
              El píxel se carga en todos tus catálogos y fichas de producto; nunca en tu panel ni en los comprobantes.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={testUrl} target="_blank" rel="noreferrer" className="btn-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold">
              <ExternalLink size={14} /> Abrir catálogo
            </a>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canEdit || saving || loading || !dirty}
              className="btn-cta inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50"
            >
              <Save size={14} /> {saving ? "Guardando…" : dirty ? "Guardar medición" : "Guardado"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
