"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, RefreshCw, ScanEye, ShieldCheck, ShieldAlert } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ChoiceChips, DateField } from "@/components/forms/Fields";
import { AuditEventCard } from "./AuditEventCard";
import { MODULES, RESULT, actionLabel, diffRows, fmtValue, moduleInfo, useAuditAccess, type AuditEvent, type AuditFilters } from "./audit-labels";

type Overview = {
  ok: boolean; scope: string; limited?: boolean; total?: number; critical?: number; security?: number;
  by_module?: Record<string, number>; by_result?: Record<string, number>;
  last_verification?: { ok: boolean; checked: number; checked_at: string; breaks: unknown[] } | null;
  chain?: { events: number; first_seq: number | null; last_seq: number | null; legacy: number };
};
type Point = { id: string; name: string };
const card = { borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" };
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#0891b2" };

/** Centro de auditoría: resumen real, filtros combinables, paginación en el servidor, exportación y verificación. */
export function AuditCenter({ storeId, points = [], initial = {} }: { storeId: string | null; points?: Point[]; initial?: AuditFilters }) {
  const platform = storeId === null;
  const access = useAuditAccess(storeId, platform);
  const [filters, setFilters] = useState<AuditFilters>(initial);
  const [applied, setApplied] = useState<AuditFilters>(initial);
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const key = JSON.stringify(applied);

  const fetchPage = useCallback(async (next: unknown) => {
    setLoading(true);
    const f = JSON.parse(key) as AuditFilters;
    const { data, error: e } = await supabaseBrowser().rpc("erp_audit_search", { p_store: storeId, p_filters: { ...f, log: next === null }, p_limit: 40, p_cursor: next });
    setLoading(false);
    const r = data as { ok: boolean; message?: string; items?: AuditEvent[]; next_cursor?: unknown } | null;
    if (e || !r?.ok) return setError(e?.message ?? r?.message ?? "No se pudo consultar.");
    setError(null);
    setItems((cur) => (next ? [...cur, ...(r.items ?? [])] : r.items ?? []));
    setCursor(r.next_cursor ?? null);
  }, [storeId, key]);

  const loadOverview = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("erp_audit_overview", { p_store: storeId, p_days: 7 });
    setOverview((data as Overview) ?? null);
  }, [storeId]);

  useEffect(() => {
    if (!access?.scope) return;
    const t = window.setTimeout(() => { void fetchPage(null); void loadOverview(); }, 0);
    return () => window.clearTimeout(t);
  }, [access?.scope, fetchPage, loadOverview]);

  const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const apply = () => setApplied(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== undefined)) as AuditFilters);

  async function verify() {
    setBusy("verify");
    const { data, error: e } = await supabaseBrowser().rpc("erp_audit_verify", { p_store: storeId, p_limit: 20000 });
    setBusy(null);
    if (e) return void Swal.fire({ icon: "error", title: "No se pudo verificar", text: e.message, ...swal });
    const r = data as { ok: boolean; checked: number; breaks: Array<{ type: string; seq: number; missing?: number }> };
    await Swal.fire({
      icon: r.ok ? "success" : "error",
      title: r.ok ? "🔗 Cadena íntegra" : "🚨 Se encontraron alteraciones",
      html: r.ok
        ? `Se revisaron <b>${r.checked.toLocaleString("es-CO")}</b> eventos: ninguno fue modificado ni borrado.`
        : `Se revisaron ${r.checked.toLocaleString("es-CO")} eventos y hay <b>${r.breaks.length}</b> problema(s):<br/><br/>${r.breaks.slice(0, 8).map((b) => `• ${b.type === "altered" ? "Evento modificado" : b.type === "gap" ? `Faltan ${b.missing ?? "?"} evento(s)` : "Enlace roto"} (#${b.seq})`).join("<br/>")}<br/><br/><small>Quedó una alerta crítica. Revisa con soporte antes de sacar conclusiones.</small>`,
      ...swal,
    });
    void loadOverview();
  }

  async function exportCsv() {
    setBusy("export");
    const { data, error: e } = await supabaseBrowser().rpc("erp_audit_export", { p_store: storeId, p_filters: applied });
    setBusy(null);
    const r = data as { ok: boolean; message?: string; items?: AuditEvent[]; truncated?: boolean } | null;
    if (e || !r?.ok) return void Swal.fire({ icon: "error", title: "No se pudo exportar", text: e?.message ?? r?.message, ...swal });
    const cell = (v: unknown) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ["Fecha (UTC)", "Usuario", "Rol", "Tipo de actor", "Tienda", "Punto", "Módulo", "Acción", "Resultado", "Severidad", "Registro", "Cambios", "Motivo", "IP", "Evento", "Operación", "Eslabón", "Hash"];
    const lines = (r.items ?? []).map((x) => [x.created_at, x.user_name ?? "Sistema", x.actor_role, x.actor_type, x.store_name ?? "", x.point_name ?? "", moduleInfo(x.module).label, actionLabel(x), x.result, x.severity, x.entity_id ?? "",
      diffRows(x).map((d) => `${d.label}: ${fmtValue(d.before)} → ${fmtValue(d.after)}`).join(" | "), x.reason ?? "", x.ip ?? "", x.id, x.correlation_id ?? "", x.chain_seq ?? "", x.hash ?? ""].map(cell).join(";"));
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (r.truncated) void Swal.fire({ icon: "info", title: "Exportación parcial", text: "Se exportaron los 5.000 eventos más recientes. Usa filtros de fecha para el resto.", ...swal });
  }

  async function saveScope(v: "permission" | "point_users") {
    if (!storeId) return;
    const { error: e } = await supabaseBrowser().rpc("erp_audit_scope_save", { p_store: storeId, p_scope: v });
    if (e) return void Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message, ...swal });
    void Swal.fire({ icon: "success", title: "Guardado", timer: 1100, showConfirmButton: false, ...swal });
  }

  const topModules = useMemo(() => Object.entries(overview?.by_module ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6), [overview]);

  if (!access) return <p className="p-6 text-sm" style={{ color: "var(--t-muted)" }}>Cargando…</p>;
  if (!access.scope) {
    return <p className="rounded-2xl border p-4 text-sm" style={card}>🔒 Necesitas el permiso <b>Auditoría</b> para consultar este centro. Pídeselo al administrador de tu tienda.</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "linear-gradient(135deg,#0e7490,#312e81)", color: "#67e8f9" }}><ScanEye size={21} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black">Centro de auditoría</h1>
          <p className="text-sm" style={{ color: "var(--t-muted)" }}>
            {platform ? "Toda la plataforma" : access.scope === "all" ? "Toda tu tienda" : access.scope === "points" ? "Tus puntos asignados" : "Tu punto"} · solo lectura · cada evento queda encadenado y no se puede editar ni borrar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {access.can_verify ? (
            <button type="button" disabled={busy === "verify"} onClick={() => void verify()} className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-bold disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>
              <ShieldCheck size={15} /> {busy === "verify" ? "Verificando…" : "Verificar integridad"}
            </button>
          ) : null}
          <button type="button" disabled={busy === "export"} onClick={() => void exportCsv()} className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-bold disabled:opacity-60" style={{ borderColor: "var(--t-card-border)" }}>
            <Download size={15} /> {busy === "export" ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </header>

      {overview?.ok && !overview.limited ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { l: "Eventos (7 días)", v: overview.total ?? 0, e: "🗂️" },
            { l: "Críticos", v: overview.critical ?? 0, e: "🚨", bad: (overview.critical ?? 0) > 0 },
            { l: "Seguridad", v: overview.security ?? 0, e: "🛡️", bad: (overview.security ?? 0) > 0 },
            { l: "Bloqueados", v: overview.by_result?.blocked ?? 0, e: "⛔", bad: (overview.by_result?.blocked ?? 0) > 0 },
          ].map((s) => (
            <motion.div key={s.l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border p-3" style={card}>
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{s.e} {s.l}</p>
              <p className="mt-1 text-2xl font-black tabular-nums" style={s.bad ? { color: "#f87171" } : undefined}>{s.v.toLocaleString("es-CO")}</p>
            </motion.div>
          ))}
          <div className="col-span-2 rounded-2xl border p-3 sm:col-span-4" style={card}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {overview.last_verification ? (
                overview.last_verification.ok
                  ? <span className="inline-flex items-center gap-1 font-bold text-emerald-400"><ShieldCheck size={14} /> Última verificación: íntegra ({overview.last_verification.checked.toLocaleString("es-CO")} eventos, {new Date(overview.last_verification.checked_at).toLocaleString("es-CO")})</span>
                  : <span className="inline-flex items-center gap-1 font-bold text-red-400"><ShieldAlert size={14} /> Última verificación: {overview.last_verification.breaks.length} problema(s) — {new Date(overview.last_verification.checked_at).toLocaleString("es-CO")}</span>
              ) : <span style={{ color: "var(--t-muted)" }}>Aún no se ha verificado la cadena de integridad.</span>}
              {overview.chain ? <span style={{ color: "var(--t-muted)" }}>· 🔗 {Number(overview.chain.last_seq ?? 0).toLocaleString("es-CO")} eslabones · {Number(overview.chain.legacy).toLocaleString("es-CO")} eventos anteriores a la cadena</span> : null}
            </div>
            {topModules.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {topModules.map(([m, n]) => (
                  <button key={m} type="button" onClick={() => { set({ module: m }); setApplied((a) => ({ ...a, module: m })); }} className="rounded-full border px-2.5 py-1 font-bold" style={{ borderColor: "var(--t-card-border)" }}>
                    {moduleInfo(m).emoji} {moduleInfo(m).label} · {n}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border p-4" style={card}>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="block text-xs font-bold">Desde<div className="mt-1"><DateField value={filters.from ?? ""} onChange={(v) => set({ from: v })} /></div></label>
          <label className="block text-xs font-bold">Hasta<div className="mt-1"><DateField value={filters.to ?? ""} onChange={(v) => set({ to: v })} /></div></label>
          {points.length ? (
            <label className="block text-xs font-bold">Punto
              <select value={filters.point_id ?? ""} onChange={(e) => set({ point_id: e.target.value })} className="mt-1 w-full rounded-xl border px-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }}>
                <option value="">Todos</option>
                {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block text-xs font-bold">Buscar
            <input value={filters.q ?? ""} onChange={(e) => set({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} placeholder="Usuario, producto, valor, motivo…" className="mt-1 w-full rounded-xl border px-3 text-sm" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
          </label>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          <ChoiceChips value={filters.module ?? ""} onChange={(v) => set({ module: v })} options={[{ value: "", label: "Todos los módulos" }, ...MODULES.map((m) => ({ value: m.key, label: `${m.emoji} ${m.label}` }))]} />
          <ChoiceChips value={filters.result ?? ""} onChange={(v) => set({ result: v })} options={[{ value: "", label: "Cualquier resultado" }, ...Object.entries(RESULT).map(([k, r]) => ({ value: k, label: `${r.emoji} ${r.label}` }))]} />
          <ChoiceChips value={filters.severity ?? ""} onChange={(v) => set({ severity: v })} options={[{ value: "", label: "Toda severidad" }, { value: "warning", label: "⚠️ Atención" }, { value: "critical", label: "🚨 Crítico" }]} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 text-xs font-bold">Evento u operación
            <input value={filters.event_id ?? ""} onChange={(e) => set({ event_id: e.target.value.trim() })} placeholder="Identificador" className="w-full rounded-xl border px-3 font-mono text-xs" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
          </label>
          <button type="button" onClick={apply} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-black text-white" style={{ background: "linear-gradient(135deg,#0891b2,#6366f1)" }}><RefreshCw size={14} /> Aplicar filtros</button>
          <button type="button" onClick={() => { setFilters({}); setApplied({}); }} className="rounded-full border px-4 py-2 font-bold" style={{ borderColor: "var(--t-card-border)" }}>Limpiar</button>
        </div>
      </section>

      {access.can_configure ? (
        <section className="rounded-2xl border p-4 text-sm" style={card}>
          <p className="font-black">👁️ ¿Quién consulta la auditoría?</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t-muted)" }}>Nadie la puede editar ni borrar. Tú decides quién la puede ver.</p>
          <div className="mt-2 text-xs">
            <ChoiceChips value={access.audit_scope} onChange={(v) => void saveScope(v)} options={[
              { value: "permission", label: "🔐 Solo con el permiso «Auditoría»" },
              { value: "point_users", label: "📍 También cada usuario de un punto (solo su punto)" },
            ]} />
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
        {items.map((e) => <AuditEventCard key={e.id} e={e} showStore={platform} />)}
        {!loading && !items.length && !error ? <p className="rounded-2xl border p-8 text-center text-sm" style={card}>🕵️ No hay eventos con esos filtros.</p> : null}
        {loading ? <p className="py-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>Consultando…</p> : null}
        {cursor && !loading ? <button type="button" onClick={() => void fetchPage(cursor)} className="w-full rounded-2xl border py-3 text-sm font-bold" style={card}>Cargar más eventos</button> : null}
      </section>
    </div>
  );
}
