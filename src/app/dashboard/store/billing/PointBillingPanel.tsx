"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Point = {
  id: string;
  code: string;
  name: string;
  kind: "warehouse" | "point";
  active: boolean;
  is_default: boolean;
  address: string | null;
  phone: string | null;
  invoice_prefix: string;
  remision_prefix: string;
  next_invoice_number: number;
  next_remision_number: number;
  legal_name?: string | null;
  nit?: string | null;
  city?: string | null;
  email?: string | null;
  receipt_footer?: string | null;
};

type Draft = Record<string, string>;

const FIELDS: Array<{ key: string; label: string; icon: string; placeholder: string; wide?: boolean }> = [
  { key: "legal_name", label: "Razón social", icon: "🏢", placeholder: "Nombre legal del punto", wide: true },
  { key: "nit", label: "NIT / Documento", icon: "🪪", placeholder: "900.000.000-1" },
  { key: "phone", label: "Teléfono", icon: "📞", placeholder: "300 000 0000" },
  { key: "email", label: "Correo", icon: "✉️", placeholder: "punto@correo.com" },
  { key: "city", label: "Ciudad", icon: "🏙️", placeholder: "Ciudad" },
  { key: "address", label: "Dirección", icon: "📍", placeholder: "Calle 1 # 2-3", wide: true },
  { key: "receipt_footer", label: "Mensaje al pie del comprobante", icon: "💬", placeholder: "¡Gracias por su compra!", wide: true },
];

const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" } as React.CSSProperties;
const inputCls = "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2";

function preview(prefix: string, n: number) {
  const num = String(n || 1).padStart(5, "0");
  return prefix ? `${prefix}-${num}` : num;
}

export default function PointBillingPanel({ storeId }: { storeId: string }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  function open(p: Point) {
    if (openId === p.id) return setOpenId(null);
    setOpenId(p.id);
    const d: Draft = {
      invoice_prefix: p.invoice_prefix ?? "",
      remision_prefix: p.remision_prefix ?? "",
      next_invoice_number: String(p.next_invoice_number ?? 1),
      next_remision_number: String(p.next_remision_number ?? 1),
    };
    for (const f of FIELDS) d[f.key] = String((p as Record<string, unknown>)[f.key] ?? "");
    setDraft(d);
  }

  async function save(p: Point) {
    const invoice = draft.invoice_prefix.trim().toUpperCase();
    const remision = draft.remision_prefix.trim().toUpperCase();
    if (invoice && invoice === remision) {
      await Swal.fire({ icon: "warning", title: "Los prefijos de factura y remisión deben ser distintos", background: "#0b0b0b", color: "#fff" });
      return;
    }
    const patch: Record<string, unknown> = {
      invoice_prefix: invoice,
      remision_prefix: remision,
      next_invoice_number: Math.max(1, Number(draft.next_invoice_number) || 1),
      next_remision_number: Math.max(1, Number(draft.next_remision_number) || 1),
    };
    // Los campos fiscales solo se envían si la columna existe (SQL erp_billing_points.sql ejecutado).
    for (const f of FIELDS) {
      if (f.key in p || f.key === "phone" || f.key === "address") patch[f.key] = draft[f.key]?.trim() || null;
    }
    setSaving(true);
    const { error } = await supabaseBrowser().from("erp_warehouses").update(patch).eq("id", p.id).eq("store_id", storeId);
    setSaving(false);
    if (error) {
      await Swal.fire({ icon: "error", title: "No se pudo guardar", text: error.message, background: "#0b0b0b", color: "#fff", confirmButtonColor: "#ef4444" });
      return;
    }
    await Swal.fire({ icon: "success", title: `${p.name} actualizado`, timer: 1100, showConfirmButton: false, background: "#0b0b0b", color: "#fff" });
    setOpenId(null);
    void load();
  }

  const hasFiscalColumns = points.length > 0 && "legal_name" in points[0];

  return (
    <section className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">🏬 Facturación por punto</h2>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>
            Cada punto tiene sus propios prefijos, consecutivos y datos de comprobante. Toca un punto para editarlo.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs" style={box}>{points.length} punto{points.length === 1 ? "" : "s"}</span>
      </div>

      {!hasFiscalColumns && points.length > 0 ? (
        <p className="mt-2 rounded-xl border border-dashed p-2 text-xs" style={{ borderColor: "var(--t-accent)" }}>
          💡 Ejecuta <b>supabase/erp_billing_points.sql</b> para guardar también razón social, NIT, ciudad, correo y mensaje al pie por punto.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>Cargando puntos…</p>
      ) : points.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>Aún no hay puntos. Créalos en Inventario → Puntos y bodegas.</p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {points.map((p) => {
            const isOpen = openId === p.id;
            return (
              <div key={p.id} className={`rounded-xl border transition ${isOpen ? "md:col-span-2" : ""}`} style={{ ...box, opacity: p.active ? 1 : 0.6 }}>
                <button type="button" onClick={() => open(p)} className="flex w-full items-center gap-3 p-3 text-left">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "color-mix(in oklab, var(--t-accent) 18%, transparent)" }}>
                    {p.kind === "point" ? "🛍️" : "🏭"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {p.name}
                      {p.is_default ? <span className="rounded-full border px-2 py-0.5 text-[10px]" style={box}>Principal</span> : null}
                      {!p.active ? <span className="rounded-full border px-2 py-0.5 text-[10px]" style={box}>Inactivo</span> : null}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]" style={{ color: "var(--t-muted)" }}>
                      <span>🧾 {preview(p.invoice_prefix, p.next_invoice_number)}</span>
                      <span>📄 {preview(p.remision_prefix, p.next_remision_number)}</span>
                    </span>
                  </span>
                  <span className="text-xs" style={{ color: "var(--t-muted)" }}>{isOpen ? "Cerrar ▴" : "Editar ▾"}</span>
                </button>

                {isOpen ? (
                  <div className="space-y-3 border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border p-2.5" style={box}>
                        <p className="mb-1.5 text-xs font-semibold">🧾 Factura</p>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px]">Prefijo
                            <input className={inputCls} style={box} maxLength={8} value={draft.invoice_prefix} onChange={(e) => setDraft({ ...draft, invoice_prefix: e.target.value })} />
                          </label>
                          <label className="text-[11px]">Próximo n.º
                            <input className={inputCls} style={box} type="number" min={1} value={draft.next_invoice_number} onChange={(e) => setDraft({ ...draft, next_invoice_number: e.target.value })} />
                          </label>
                        </div>
                        <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Se verá así: <b>{preview(draft.invoice_prefix.trim().toUpperCase(), Number(draft.next_invoice_number))}</b></p>
                      </div>
                      <div className="rounded-xl border p-2.5" style={box}>
                        <p className="mb-1.5 text-xs font-semibold">📄 Remisión</p>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px]">Prefijo
                            <input className={inputCls} style={box} maxLength={8} value={draft.remision_prefix} onChange={(e) => setDraft({ ...draft, remision_prefix: e.target.value })} />
                          </label>
                          <label className="text-[11px]">Próximo n.º
                            <input className={inputCls} style={box} type="number" min={1} value={draft.next_remision_number} onChange={(e) => setDraft({ ...draft, next_remision_number: e.target.value })} />
                          </label>
                        </div>
                        <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>Se verá así: <b>{preview(draft.remision_prefix.trim().toUpperCase(), Number(draft.next_remision_number))}</b></p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {FIELDS.filter((f) => hasFiscalColumns || f.key === "phone" || f.key === "address").map((f) => (
                        <label key={f.key} className={`text-[11px] ${f.wide ? "sm:col-span-2" : ""}`}>
                          {f.icon} {f.label}
                          <input className={inputCls} style={box} placeholder={f.placeholder} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                        </label>
                      ))}
                    </div>

                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setOpenId(null)} className="rounded-full border px-4 py-1.5 text-xs font-semibold" style={box}>Cancelar</button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => save(p)}
                        className="rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-60"
                        style={{ background: "var(--t-cta)", color: "var(--t-cta-text, #0b0b0b)" }}
                      >
                        {saving ? "Guardando…" : "💾 Guardar punto"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
