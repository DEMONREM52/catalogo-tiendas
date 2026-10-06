"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "../ImageUpload";

type Point = {
  id: string;
  code: string;
  name: string;
  kind: "warehouse" | "point";
  active: boolean;
  is_default: boolean;
  invoice_prefix: string;
  remision_prefix: string;
  next_invoice_number: number;
  next_remision_number: number;
  [key: string]: unknown;
};

type Draft = Record<string, string>;
type Field = { key: string; label: string; placeholder?: string; type?: string; wide?: boolean; upper?: boolean; max?: number };

// Cada sección agrupa lo que el punto muestra en sus remisiones y facturas.
const SECTIONS: Array<{ title: string; hint: string; fields: Field[] }> = [
  {
    title: "🏷️ Identidad",
    hint: "Nombre con el que aparece el punto en sus comprobantes.",
    fields: [
      { key: "name", label: "Nombre del punto *", placeholder: "Ej. ZAMORA", max: 80 },
      { key: "legal_name", label: "Razón social / nombre comercial", placeholder: "Ej. La Vitrina Zamora SAS", max: 120 },
      { key: "nit", label: "NIT / documento", placeholder: "900.000.000-1", max: 30 },
    ],
  },
  {
    title: "📞 Contacto",
    hint: "Se imprime en el encabezado del comprobante.",
    fields: [
      { key: "phone", label: "Celular / WhatsApp", placeholder: "300 000 0000", max: 40 },
      { key: "email", label: "Correo", placeholder: "punto@correo.com", type: "email", max: 120 },
      { key: "city", label: "Ciudad", placeholder: "Ciudad", max: 80 },
      { key: "address", label: "Dirección", placeholder: "Calle 1 # 2-3", max: 160 },
    ],
  },
  {
    title: "📜 Resolución de facturación",
    hint: "Opcional. Si la llenas, aparece en las facturas de este punto.",
    fields: [
      { key: "billing_resolution", label: "N.º de resolución", placeholder: "18760000000000", max: 40 },
      { key: "billing_resolution_date", label: "Fecha de la resolución", type: "date" },
      { key: "billing_resolution_from", label: "Numeración desde", type: "number", placeholder: "1" },
      { key: "billing_resolution_to", label: "Numeración hasta", type: "number", placeholder: "5000" },
      { key: "billing_resolution_valid_to", label: "Vigente hasta", type: "date" },
    ],
  },
  {
    title: "💬 Pie del comprobante",
    hint: "Mensaje de cierre en remisiones y facturas.",
    fields: [{ key: "receipt_footer", label: "Mensaje al pie", placeholder: "¡Gracias por su compra!", wide: true, max: 240 }],
  },
];
const NUMERIC = new Set(["billing_resolution_from", "billing_resolution_to"]);
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as React.CSSProperties;
const inputCls = "mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-[color:var(--t-accent)]";
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)" } as const;

function preview(prefix: string, n: number) {
  const num = String(n || 1).padStart(5, "0");
  return prefix ? `${prefix}-${num}` : num;
}

export default function PointBillingPanel({ storeId, onChanged }: { storeId: string; onChanged?: () => void }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("erp_warehouses")
      .select("*")
      .eq("store_id", storeId)
      .order("is_default", { ascending: false })
      .order("name");
    setPoints((data as Point[]) ?? []);
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Solo se muestran/guardan los campos cuya columna existe (según los SQL aplicados).
  const has = (key: string) => points.length > 0 && key in points[0];
  const missingResolution = points.length > 0 && !has("billing_resolution");

  function open(p: Point) {
    if (openId === p.id) return setOpenId(null);
    const d: Draft = {
      invoice_prefix: p.invoice_prefix ?? "",
      remision_prefix: p.remision_prefix ?? "",
      next_invoice_number: String(p.next_invoice_number ?? 1),
      next_remision_number: String(p.next_remision_number ?? 1),
      logo_url: String(p.logo_url ?? ""),
    };
    for (const f of ALL_FIELDS) d[f.key] = p[f.key] === null || p[f.key] === undefined ? "" : String(p[f.key]);
    setDraft(d);
    setOpenId(p.id);
  }

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(p: Point) {
    if (!draft.name?.trim()) return void Swal.fire({ ...swal, icon: "warning", title: "El nombre del punto es obligatorio" });
    const invoice = draft.invoice_prefix.trim().toUpperCase();
    const remision = draft.remision_prefix.trim().toUpperCase();
    const prefixOk = /^[A-Z0-9-]{0,12}$/;
    if (!prefixOk.test(invoice) || !prefixOk.test(remision)) {
      return void Swal.fire({ ...swal, icon: "warning", title: "Prefijo inválido", text: "Usa solo letras, números o guion (máx. 12)." });
    }
    if (invoice && invoice === remision) {
      return void Swal.fire({ ...swal, icon: "warning", title: "Los prefijos de factura y remisión deben ser distintos" });
    }
    const patch: Record<string, unknown> = {
      invoice_prefix: invoice,
      remision_prefix: remision,
      next_invoice_number: Math.max(1, Number(draft.next_invoice_number) || 1),
      next_remision_number: Math.max(1, Number(draft.next_remision_number) || 1),
      updated_at: new Date().toISOString(),
    };
    for (const f of ALL_FIELDS) {
      if (!has(f.key)) continue;
      const v = draft[f.key]?.trim() ?? "";
      patch[f.key] = f.key === "name" ? v : NUMERIC.has(f.key) ? (v ? Math.max(0, Math.floor(Number(v))) : null) : v || null;
    }
    if (has("logo_url")) patch.logo_url = draft.logo_url?.trim() || null;

    setSaving(true);
    const { error } = await supabaseBrowser().from("erp_warehouses").update(patch).eq("id", p.id).eq("store_id", storeId);
    setSaving(false);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar", text: error.message });
    void Swal.fire({ ...swal, icon: "success", title: `${draft.name.trim()} actualizado`, timer: 1100, showConfirmButton: false });
    setOpenId(null);
    void load();
    onChanged?.();
  }

  async function toggleActive(p: Point) {
    if (p.is_default) return void Swal.fire({ ...swal, icon: "info", title: "La bodega principal no se puede desactivar" });
    const { error } = await supabaseBrowser().from("erp_warehouses").update({ active: !p.active, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo actualizar", text: error.message });
    void load();
    onChanged?.();
  }

  return (
    <section className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">🏬 Puntos de venta y bodegas</h2>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            Cada punto tiene su logo, datos, numeración, resolución e inventario propios, y sigue siendo parte de tu tienda. Toca uno para editarlo.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs" style={box}>{points.length} en total</span>
      </div>

      {missingResolution ? (
        <p className="mt-2 rounded-xl border border-dashed p-2 text-xs" style={{ borderColor: "var(--t-accent)" }}>
          💡 Ejecuta <b>supabase/migrations/20261012_point_resolution.sql</b> en Supabase para habilitar logo, razón social y resolución por punto.
        </p>
      ) : null}

      {loading ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: "var(--t-card-bg-soft)" }} />)}
        </div>
      ) : points.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>Aún no hay puntos. Créalos arriba.</p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {points.map((p) => {
            const isOpen = openId === p.id;
            const logo = isOpen ? draft.logo_url : String(p.logo_url ?? "");
            return (
              <motion.div
                layout
                key={p.id}
                className={`overflow-hidden rounded-2xl border ${isOpen ? "md:col-span-2" : ""}`}
                style={{ ...box, borderColor: isOpen ? "var(--t-accent)" : box.borderColor, opacity: p.active ? 1 : 0.6 }}
              >
                <button type="button" onClick={() => open(p)} className="flex w-full items-center gap-3 p-3 text-left">
                  {logo ? (
                    <img src={logo} alt="" className="h-11 w-11 shrink-0 rounded-xl border bg-white object-contain" style={{ borderColor: "var(--t-card-border)" }} />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }}>
                      {p.kind === "point" ? "🛍️" : "🏭"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {p.name}
                      <span className="rounded-full border px-2 py-0.5 text-[10px] font-normal" style={box}>{p.kind === "point" ? "Punto" : "Bodega"}</span>
                      {p.is_default ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)", color: "var(--t-accent)" }}>Principal</span> : null}
                      {!p.active ? <span className="rounded-full border px-2 py-0.5 text-[10px]" style={box}>Inactivo</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                      {[p.legal_name, p.nit ? `NIT ${p.nit}` : null, p.phone].filter(Boolean).join(" · ") || p.code}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]" style={{ color: "var(--t-muted)" }}>
                      <span>🧾 {preview(p.invoice_prefix, p.next_invoice_number)}</span>
                      <span>📄 {preview(p.remision_prefix, p.next_remision_number)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold" style={box}>{isOpen ? "Cerrar" : "Editar"}</span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <div className="grid gap-4 border-t p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_340px]" style={{ borderColor: "var(--t-card-border)" }}>
                        <div className="min-w-0 space-y-4">
                          {has("logo_url") ? (
                            <ImageUpload
                              label={`Logo de ${draft.name || p.name}`}
                              currentUrl={draft.logo_url || null}
                              pathPrefix={`${storeId}/points/${p.id}/`}
                              fileName="logo.png"
                              onUploaded={(url) => set("logo_url", url)}
                            />
                          ) : null}

                          {SECTIONS.map((section) => {
                            const fields = section.fields.filter((f) => has(f.key));
                            if (!fields.length) return null;
                            return (
                              <fieldset key={section.title} className="rounded-2xl border p-3" style={box}>
                                <legend className="px-1 text-sm font-semibold">{section.title}</legend>
                                <p className="-mt-1 mb-2 text-[11px]" style={{ color: "var(--t-muted)" }}>{section.hint}</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {fields.map((f) => (
                                    <label key={f.key} className={`text-[11px] font-semibold ${f.wide ? "sm:col-span-2" : ""}`} style={{ color: "var(--t-muted)" }}>
                                      {f.label}
                                      <input
                                        className={inputCls}
                                        style={box}
                                        type={f.type ?? "text"}
                                        maxLength={f.max}
                                        min={f.type === "number" ? 0 : undefined}
                                        placeholder={f.placeholder}
                                        value={draft[f.key] ?? ""}
                                        onChange={(e) => set(f.key, e.target.value)}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            );
                          })}

                          <fieldset className="rounded-2xl border p-3" style={box}>
                            <legend className="px-1 text-sm font-semibold">🔢 Numeración</legend>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {([
                                ["Factura", "invoice_prefix", "next_invoice_number"],
                                ["Remisión", "remision_prefix", "next_remision_number"],
                              ] as const).map(([label, prefixKey, nextKey]) => (
                                <div key={label} className="rounded-xl border p-2.5" style={box}>
                                  <p className="mb-1 text-xs font-semibold">{label}</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className="text-[11px]" style={{ color: "var(--t-muted)" }}>Prefijo
                                      <input className={inputCls} style={box} maxLength={12} value={draft[prefixKey]} onChange={(e) => set(prefixKey, e.target.value)} />
                                    </label>
                                    <label className="text-[11px]" style={{ color: "var(--t-muted)" }}>Próximo n.º
                                      <input className={inputCls} style={box} type="number" min={1} value={draft[nextKey]} onChange={(e) => set(nextKey, e.target.value)} />
                                    </label>
                                  </div>
                                  <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
                                    Siguiente: <b style={{ color: "var(--t-text)" }}>{preview(draft[prefixKey].trim().toUpperCase(), Number(draft[nextKey]))}</b>
                                  </p>
                                </div>
                              ))}
                            </div>
                          </fieldset>
                        </div>

                        {/* Vista previa del encabezado del comprobante */}
                        <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
                          <div className="rounded-2xl border p-3" style={box}>
                            <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Vista previa del comprobante</p>
                            <div className="mt-2 rounded-xl bg-white p-3 text-[11px] leading-snug text-slate-900 shadow">
                              <div className="flex items-start gap-2.5">
                                {draft.logo_url ? (
                                  <img src={draft.logo_url} alt="" className="h-12 w-12 shrink-0 object-contain" />
                                ) : (
                                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-[9px] text-slate-400">Logo</span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-extrabold">{draft.legal_name?.trim() || draft.name?.trim() || p.name}</p>
                                  {draft.legal_name?.trim() && draft.name?.trim() ? <p className="truncate text-slate-500">{draft.name}</p> : null}
                                  {draft.nit?.trim() ? <p>NIT: {draft.nit}</p> : null}
                                  {[draft.address, draft.city].some((v) => v?.trim()) ? <p className="truncate">{[draft.address, draft.city].filter((v) => v?.trim()).join(" · ")}</p> : null}
                                  {[draft.phone, draft.email].some((v) => v?.trim()) ? <p className="truncate">{[draft.phone, draft.email].filter((v) => v?.trim()).join(" · ")}</p> : null}
                                </div>
                              </div>
                              <div className="mt-2 flex justify-end">
                                <span className="rounded-md border border-slate-900 px-2 py-1 text-right">
                                  <span className="block text-[8px] font-bold uppercase">Factura de venta</span>
                                  <span className="block text-xs font-black">{preview(draft.invoice_prefix.trim().toUpperCase(), Number(draft.next_invoice_number))}</span>
                                </span>
                              </div>
                              {draft.billing_resolution?.trim() ? (
                                <p className="mt-2 border-t border-slate-200 pt-1.5 text-[9px] text-slate-600">
                                  Resolución {draft.billing_resolution}
                                  {draft.billing_resolution_from || draft.billing_resolution_to
                                    ? ` · del ${draft.billing_resolution_from || "—"} al ${draft.billing_resolution_to || "—"}`
                                    : ""}
                                  {draft.billing_resolution_valid_to ? ` · vigente hasta ${draft.billing_resolution_valid_to}` : ""}
                                </p>
                              ) : null}
                              {draft.receipt_footer?.trim() ? <p className="mt-1.5 text-center text-[9px] text-slate-600">{draft.receipt_footer}</p> : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap justify-end gap-2">
                            {!p.is_default ? (
                              <button type="button" onClick={() => void toggleActive(p)} className="rounded-full border px-4 py-2 text-xs font-semibold" style={box}>
                                {p.active ? "Desactivar" : "Activar"}
                              </button>
                            ) : null}
                            <button type="button" onClick={() => setOpenId(null)} className="rounded-full border px-4 py-2 text-xs font-semibold" style={box}>Cancelar</button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void save(p)}
                              className="rounded-full px-5 py-2 text-xs font-bold text-white disabled:opacity-60"
                              style={{ background: "var(--t-cta)" }}
                            >
                              {saving ? "Guardando…" : "💾 Guardar punto"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}
