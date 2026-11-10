"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";

type Config = {
  store_id: string | null; confirmed_slug: string | null; reset_minutes: number; enabled: boolean;
  snapshot_at: string | null; last_reset_at: string | null; next_reset_at: string | null;
  last_report: { ok: boolean; mode?: string; deleted?: number; restored?: number; errors?: Array<{ table: string; step: string; error: string } | string>; at?: string } | null;
  store_name: string | null; user_email: string | null; problem: string | null; snapshot_rows: number;
};

const box = { borderColor: "var(--ap-card-border, rgba(255,255,255,.12))", background: "var(--ap-card-bg, rgba(255,255,255,.04))" } as const;
const muted = { color: "var(--ap-muted)" } as const;
const field = "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--ap-card-border, rgba(255,255,255,.15))", background: "rgba(0,0,0,.18)", color: "inherit" } as const;
const swal = { background: "#120a24", color: "#fff", confirmButtonColor: "#8b5cf6" } as const;
const PRESETS = [15, 30, 60, 120, 360, 720, 1440, 4320, 10080];
const label = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} día(s)`);
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/**
 * Tienda de demostración (20261314): una tienda de prueba que cualquiera puede abrir desde /demo.
 * Los cambios se guardan, pero cada N minutos vuelve sola a la «foto» que tomes aquí.
 */
export default function AdminDemoPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [custom, setCustom] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((c: Config | null) => {
    setCfg(c);
    if (c) { setSlug(c.confirmed_slug ?? ""); setEmail(c.user_email ?? ""); setMinutes(c.reset_minutes); setEnabled(c.enabled); }
  }, []);
  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_demo_get");
    const r = data as { ok: boolean; message?: string; config: Config | null } | null;
    if (e || !r?.ok) return setError(e && /Could not find|schema cache/i.test(e.message) ? "Falta correr en Supabase la migración 20261314_arranque_y_demo.sql." : e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    apply(r.config);
  }, [apply]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function save() {
    const m = custom ? Math.round(Number(custom)) : minutes;
    if (!(m >= 15 && m <= 10080)) return void Swal.fire({ ...swal, icon: "warning", title: "El reinicio va de 15 minutos a 7 días" });
    const ask = await Swal.fire({
      ...swal, icon: "warning", title: "¿Usar esta tienda como demo?",
      html: `<p style="font-size:13px">Cada ${label(m)} se borrará lo que hagan los visitantes y la tienda volverá a la foto. <b>Nunca escojas una tienda real.</b></p><p style="font-size:13px;margin-top:8px">Escribe el enlace de la tienda para confirmar:</p>`,
      input: "text", inputPlaceholder: slug, showCancelButton: true, confirmButtonText: "Confirmar", cancelButtonText: "Cancelar",
    });
    if (!ask.isConfirmed) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_demo_save", { p_store_slug: slug, p_user_email: email, p_reset_minutes: m, p_enabled: enabled, p_confirm_slug: String(ask.value ?? "") });
    setBusy(false);
    const r = data as { ok: boolean; message?: string; config: Config | null } | null;
    if (e || !r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e?.message ?? r?.message });
    apply(r.config);
    setCustom("");
    void Swal.fire({ ...swal, icon: "success", title: "Guardado", text: r.config?.snapshot_at ? "Listo." : "Ahora toma la foto de la base." , timer: 1800, showConfirmButton: false });
  }

  async function snapshot() {
    const ask = await Swal.fire({ ...swal, icon: "question", title: "📸 ¿Tomar la foto ahora?", text: "La tienda demo volverá a quedar exactamente como está en este momento cada vez que se reinicie.", showCancelButton: true, confirmButtonText: "Tomar foto", cancelButtonText: "Cancelar" });
    if (!ask.isConfirmed) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("saas_admin_demo_snapshot");
    setBusy(false);
    const r = data as { ok: boolean; message?: string; config: Config | null; rows?: number } | null;
    if (e || !r?.ok) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e?.message ?? r?.message });
    apply(r.config);
    void Swal.fire({ ...swal, icon: "success", title: "Foto tomada", text: `${(r.rows ?? 0).toLocaleString("es-CO")} filas guardadas.`, timer: 1800, showConfirmButton: false });
  }

  async function resetNow() {
    const ask = await Swal.fire({ ...swal, icon: "warning", title: "🔄 ¿Reiniciar ya?", text: "Se borra lo que hicieron los visitantes y vuelve a la foto.", showCancelButton: true, confirmButtonText: "Reiniciar", cancelButtonText: "Cancelar" });
    if (!ask.isConfirmed) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("erp_demo_reset", { p_force: true });
    setBusy(false);
    const r = data as { ok: boolean; message?: string; deleted?: number; restored?: number; errors?: unknown[] } | null;
    if (e || !r) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e?.message });
    void load();
    void Swal.fire({ ...swal, icon: r.ok ? "success" : "warning", title: r.ok ? "Reiniciada" : "Reiniciada con avisos", text: r.message ?? `Quitó ${r.deleted ?? 0} y devolvió ${r.restored ?? 0} filas.${r.errors?.length ? ` ${r.errors.length} aviso(s): mira el último reporte.` : ""}` });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-black">🧪 Tienda de demostración</h1>
        <p className="mt-1 text-sm" style={muted}>Para mostrar RemHub sin tocar datos reales: los visitantes entran desde <Link href="/demo" className="font-bold underline" target="_blank">remhub.co/demo</Link>, pueden cambiar lo que quieran y cada cierto tiempo todo vuelve a la foto.</p>
      </header>

      {error ? <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b" }}>⚠️ {error}</p> : null}

      {cfg ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border p-4" style={box}>
            <p className="text-[11px] font-bold uppercase" style={muted}>Estado</p>
            <p className="mt-1 text-lg font-black">{cfg.problem ? "⚠️ Revisar" : cfg.enabled && cfg.snapshot_at ? "🟢 Activa" : cfg.snapshot_at ? "⏸️ Apagada" : "📸 Falta la foto"}</p>
            {cfg.problem ? <p className="text-xs" style={{ color: "#f59e0b" }}>{cfg.problem}</p> : <p className="text-xs" style={muted}>{cfg.store_name ?? "—"} · {cfg.user_email ?? "—"}</p>}
          </div>
          <div className="rounded-2xl border p-4" style={box}>
            <p className="text-[11px] font-bold uppercase" style={muted}>Foto de la base</p>
            <p className="mt-1 text-sm font-black">{dt(cfg.snapshot_at)}</p>
            <p className="text-xs" style={muted}>{cfg.snapshot_rows.toLocaleString("es-CO")} filas</p>
          </div>
          <div className="rounded-2xl border p-4" style={box}>
            <p className="text-[11px] font-bold uppercase" style={muted}>Próximo reinicio</p>
            <p className="mt-1 text-sm font-black">{dt(cfg.next_reset_at)}</p>
            <p className="text-xs" style={muted}>Último: {dt(cfg.last_reset_at)}</p>
          </div>
        </section>
      ) : null}

      <section className="space-y-4 rounded-[24px] border p-5" style={box}>
        <h2 className="text-lg font-black">⚙️ Configuración</h2>
        <ol className="space-y-1 text-xs" style={muted}>
          <li>1. Crea una tienda nueva solo para la demo (regístrala como cualquier cliente) y llénala con productos, catálogos y ventas de ejemplo.</li>
          <li>2. En esa tienda crea un usuario del equipo (no el dueño) con los permisos que quieras mostrar. Con ese usuario entran los visitantes.</li>
          <li>3. Escríbelos aquí, guarda y toma la foto.</li>
        </ol>
        <label className="block text-xs font-bold">Enlace de la tienda demo
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="demo" className={field} style={fs} />
        </label>
        <label className="block text-xs font-bold">Correo del usuario con el que entran los visitantes
          <input value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="demo@remhub.co" type="email" autoComplete="off" className={field} style={fs} />
          <span className="mt-1 block text-[11px] font-normal" style={muted}>Debe ser solo de esta tienda, no el dueño ni un administrador de RemHub.</span>
        </label>
        <div>
          <p className="text-xs font-bold">Se reinicia cada</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PRESETS.map((m) => (
              <button key={m} type="button" onClick={() => { setMinutes(m); setCustom(""); }} className="rounded-full border px-3 py-1.5 text-xs font-bold"
                style={!custom && minutes === m ? { background: "#8b5cf6", color: "#fff", borderColor: "transparent" } : fs}>{label(m)}</button>
            ))}
            <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} placeholder="Otro (min)" inputMode="numeric" className="w-28 rounded-full border px-3 py-1.5 text-xs" style={fs} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Activa (se ofrece en /demo y se reinicia sola)
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy || !slug || !email} onClick={() => void save()} className="rounded-xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}>💾 Guardar</button>
        </div>
      </section>

      {cfg?.store_id ? (
        <section className="flex flex-wrap gap-2 rounded-[24px] border p-5" style={box}>
          <button type="button" disabled={busy || Boolean(cfg.problem)} onClick={() => void snapshot()} className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50" style={fs}>📸 Tomar foto de la base ahora</button>
          <button type="button" disabled={busy || !cfg.snapshot_at || Boolean(cfg.problem)} onClick={() => void resetNow()} className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50" style={fs}>🔄 Reiniciar ahora</button>
          <Link href="/demo" target="_blank" className="rounded-xl border px-4 py-2.5 text-sm font-bold" style={fs}>👀 Ver la página /demo</Link>
        </section>
      ) : null}

      {cfg?.last_report ? (
        <section className="rounded-[24px] border p-5 text-xs" style={box}>
          <h2 className="mb-2 text-sm font-black">🧾 Último reinicio</h2>
          <p style={muted}>{dt(cfg.last_report.at ?? null)} · modo {cfg.last_report.mode ?? "—"} · quitó {cfg.last_report.deleted ?? 0} · devolvió {cfg.last_report.restored ?? 0}</p>
          {cfg.last_report.errors?.length ? (
            <ul className="mt-2 space-y-1">
              {cfg.last_report.errors.map((e, i) => <li key={i} style={{ color: "#f59e0b" }}>⚠️ {typeof e === "string" ? e : `${e.table} (${e.step}): ${e.error}`}</li>)}
            </ul>
          ) : <p className="mt-1" style={{ color: "#10b981" }}>✅ Sin avisos</p>}
        </section>
      ) : null}
    </div>
  );
}
