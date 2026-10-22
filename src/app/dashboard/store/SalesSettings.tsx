"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ImageUpload } from "./ImageUpload";

/**
 * Ajustes de venta (20261229):
 *  · Cliente fiel: cada compra suma puntos; el POS los canjea como descuento.
 *  · Cobros con QR: el QR de Nequi, Daviplata, Bre-B o del banco (general o por punto) para mostrarlo en el POS.
 */

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" } as const;
const box = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
const field = "w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;

export function LoyaltyPanel({ storeId }: { storeId: string }) {
  const [cfg, setCfg] = useState<{ enabled: boolean; pesos_per_point: number; point_value: number; min_redeem: number } | null>(null);
  const [error, setError] = useState("");
  // Regla de cada punto de venta (20261230): da puntos o no, y con qué tasa (vacío = la general).
  const [rules, setRules] = useState<Array<{ point_id: string; point: string; earns: boolean; pesos_per_point: number | null }> | null>(null);
  useEffect(() => {
    void supabaseBrowser().rpc("erp_loyalty_point_rules_get", { p_store: storeId }).then(({ data, error: e }) => { if (!e && Array.isArray(data)) setRules(data as NonNullable<typeof rules>); });
  }, [storeId]);
  async function saveRule(next: NonNullable<typeof rules>[number]) {
    setRules((cur) => (cur ?? []).map((r) => (r.point_id === next.point_id ? next : r)));
    const { data, error: e } = await supabaseBrowser().rpc("erp_loyalty_point_rules_save", { p_store: storeId, p_rules: [next] });
    if (e || !(data as { ok?: boolean } | null)?.ok) void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? (data as { error?: string } | null)?.error, ...swal });
  }
  useEffect(() => {
    void supabaseBrowser().rpc("erp_loyalty_settings_get", { p_store: storeId }).then(({ data, error: e }) => {
      if (e) return setError(/Could not find the function|schema cache/i.test(e.message) ? "Falta ejecutar en Supabase la migración 20261229_equipo_y_posventa.sql." : e.message);
      setCfg(data as NonNullable<typeof cfg>);
    });
  }, [storeId]);
  async function save(next: NonNullable<typeof cfg>) {
    setCfg(next);
    const { data, error: e } = await supabaseBrowser().rpc("erp_loyalty_settings_save", { p_store: storeId, p: next });
    if (e || !(data as { ok?: boolean } | null)?.ok) void Swal.fire({ icon: "error", title: "No se guardó", text: e?.message ?? (data as { error?: string } | null)?.error, ...swal });
  }
  const pct = cfg ? Math.round((cfg.point_value / cfg.pesos_per_point) * 1000) / 10 : 0;
  return (
    <section className="rounded-3xl border p-5" style={box}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black">⭐ Cliente fiel (puntos)</h3>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>Cada compra suma puntos al cliente por su <b>cédula o NIT</b> (escríbelo en la venta). En el POS aparecen sus puntos y se canjean como descuento. Las ventas sin documento no suman.</p>
        </div>
        {cfg ? (
          <button type="button" onClick={() => void save({ ...cfg, enabled: !cfg.enabled })} className="rounded-full px-4 py-2 text-sm font-bold" style={cfg.enabled ? { background: "#10b981", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>
            {cfg.enabled ? "✅ Encendido" : "Apagado · encender"}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-amber-500">⚠️ {error}</p> : null}
      {cfg ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>1 punto por cada $
            <input className={field} style={fs} inputMode="numeric" value={cfg.pesos_per_point} onChange={(e) => setCfg({ ...cfg, pesos_per_point: Number(e.target.value.replace(/\D/g, "")) || 0 })} onBlur={() => void save(cfg)} /></label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Cada punto vale $
            <input className={field} style={fs} inputMode="numeric" value={cfg.point_value} onChange={(e) => setCfg({ ...cfg, point_value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} onBlur={() => void save(cfg)} /></label>
          <label className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Canje mínimo (puntos)
            <input className={field} style={fs} inputMode="numeric" value={cfg.min_redeem} onChange={(e) => setCfg({ ...cfg, min_redeem: Number(e.target.value.replace(/\D/g, "")) || 0 })} onBlur={() => void save(cfg)} /></label>
          <p className="text-xs sm:col-span-3" style={{ color: "var(--t-muted)" }}>Así le devuelves al cliente el <b>{pct} %</b> de lo que compra. Ejemplo: compra {money(100000)} → gana {Math.floor(100000 / Math.max(1, cfg.pesos_per_point))} puntos = {money(Math.floor(100000 / Math.max(1, cfg.pesos_per_point)) * cfg.point_value)} para su próxima compra. Los puntos cuentan desde que lo enciendes.</p>
        </div>
      ) : null}
      {cfg && rules?.length ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-bold">📍 Por punto de venta</p>
          <div className="space-y-1.5">
            {rules.map((r) => (
              <div key={r.point_id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
                <b className="min-w-0 flex-1">{r.point}</b>
                <button type="button" onClick={() => void saveRule({ ...r, earns: !r.earns })} className="rounded-full px-3 py-1 text-xs font-bold" style={r.earns ? { background: "#10b981", color: "#fff" } : { border: "1px solid var(--t-card-border)" }}>{r.earns ? "Da puntos" : "No da puntos"}</button>
                {r.earns ? (
                  <label className="flex items-center gap-1 text-xs">1 punto por cada $
                    <input className="w-24 rounded-lg border px-2 py-1 text-right" style={fs} inputMode="numeric" placeholder={String(cfg.pesos_per_point)} value={r.pesos_per_point ?? ""}
                      onChange={(e) => setRules((cur) => (cur ?? []).map((x) => (x.point_id === r.point_id ? { ...x, pesos_per_point: e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null } : x)))}
                      onBlur={() => void saveRule(rules.find((x) => x.point_id === r.point_id) ?? r)} aria-label={`Tasa de ${r.point}`} />
                  </label>
                ) : null}
                <span className="w-full text-[11px] sm:w-auto" style={{ color: "var(--t-muted)" }}>{r.earns ? `${r.pesos_per_point ? "Tasa propia" : "Usa la general"}: compra ${money(100000)} = ${Math.floor(100000 / Math.max(50, r.pesos_per_point ?? cfg.pesos_per_point))} puntos` : "Las ventas de este punto no suman puntos"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type Qr = { id: string; point_id: string | null; label: string; key_text: string | null; image_url: string | null };

export function QrPanel({ storeId }: { storeId: string }) {
  const [list, setList] = useState<Qr[]>([]);
  const [points, setPoints] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ label: "Nequi", key_text: "", image_url: "", point_id: "" });
  const [fileName, setFileName] = useState(() => `qr-${Date.now()}.png`);
  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [q, w] = await Promise.all([sb.rpc("erp_payment_qr_list", { p_store: storeId, p_point: null }), sb.from("erp_warehouses").select("id,name").eq("store_id", storeId).eq("active", true).order("name")]);
    setList((Array.isArray(q.data) ? q.data : []) as Qr[]);
    setPoints((w.data ?? []) as typeof points);
  }, [storeId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  async function save() {
    const { data, error } = await supabaseBrowser().rpc("erp_payment_qr_save", { p_store: storeId, p: { ...form, point_id: form.point_id || null } });
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return void Swal.fire({ icon: "error", title: "No se guardó", text: error && /Could not find the function|schema cache/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261229_equipo_y_posventa.sql." : error?.message ?? r?.error, ...swal });
    setForm({ label: "Nequi", key_text: "", image_url: "", point_id: "" });
    setFileName(`qr-${Date.now()}.png`);
    void load();
  }
  async function remove(q: Qr) {
    await supabaseBrowser().rpc("erp_payment_qr_save", { p_store: storeId, p: { id: q.id, delete: true } });
    void load();
  }
  return (
    <section className="rounded-3xl border p-5" style={box}>
      <h3 className="text-base font-black">📱 Cobros con QR</h3>
      <p className="text-sm" style={{ color: "var(--t-muted)" }}>Sube el QR de Nequi, Daviplata, Bre-B o de tu banco. En el POS, «📱 Cobrar con QR» lo muestra grande con el valor a pagar.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input className={field} style={fs} placeholder="Nombre (Nequi, Bancolombia…)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className={field} style={fs} placeholder="Número, llave o cuenta (opcional)" value={form.key_text} onChange={(e) => setForm({ ...form, key_text: e.target.value })} />
        <select className={field} style={fs} value={form.point_id} onChange={(e) => setForm({ ...form, point_id: e.target.value })} aria-label="Punto">
          <option value="">Para todos los puntos</option>{points.map((p) => <option key={p.id} value={p.id}>Solo {p.name}</option>)}
        </select>
        <ImageUpload label="Imagen del QR" currentUrl={form.image_url || null} pathPrefix={`${storeId}/store/`} fileName={fileName} onUploaded={(url) => setForm((f) => ({ ...f, image_url: url }))} />
        <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2.5 text-sm font-bold text-white sm:col-span-2" style={{ background: "var(--t-cta)" }}>💾 Guardar QR</button>
      </div>
      {list.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {list.map((q) => (
            <div key={q.id} className="flex items-center gap-3 rounded-xl border p-2 text-sm" style={{ borderColor: "var(--t-card-border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {q.image_url ? <img src={q.image_url} alt="" className="h-14 w-14 rounded-lg bg-white object-contain" /> : <span className="grid h-14 w-14 place-items-center rounded-lg text-2xl" style={{ background: "var(--t-card-bg)" }}>📱</span>}
              <span className="min-w-0 flex-1"><b>{q.label}</b><span className="block text-xs" style={{ color: "var(--t-muted)" }}>{q.key_text ?? ""}{q.point_id ? ` · ${points.find((p) => p.id === q.point_id)?.name ?? ""}` : " · todos los puntos"}</span></span>
              <button type="button" onClick={() => void remove(q)} className="text-xs font-semibold text-red-500">Quitar</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
