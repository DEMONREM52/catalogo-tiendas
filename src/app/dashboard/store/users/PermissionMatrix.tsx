"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Eraser, Lock, Save, Search, ShieldAlert, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  PERMISSION_GROUPS, PERMISSION_LIST, PERMISSION_PRESETS, PERMISSION_REQUIRES, cleanPermissions, permissionLabel, togglePermission,
} from "@/lib/permissions";
import { useRunOnChange } from "../../inventario/shared";
import { RiskMeter, RiskPill, swalTheme } from "./ui";

type RoleTemplate = { id: string; name: string; icon: string; permissions: string[] };
type Filter = "all" | "on" | "off" | "sensitive" | "changed";

/**
 * Permisos por área: a la izquierda las áreas con su avance, a la derecha cada permiso con su nivel de riesgo,
 * lo que necesita y si cambia frente a lo guardado. Plantillas, roles de la tienda, copiar de otro y buscar.
 */
export function PermissionMatrix({
  value,
  onChange,
  disabled,
  storeId,
  copyFrom,
  original,
  grantable,
  initialArea,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  storeId?: string;
  copyFrom?: Array<{ label: string; permissions: string[] }>;
  /** Lo guardado antes de editar: marca qué se agrega y qué se quita. */
  original?: string[];
  /** Lo que quien edita puede dar (si no es dueño ni administrador). */
  grantable?: Set<string> | null;
  initialArea?: string;
}) {
  const set = useMemo(() => new Set(value), [value]);
  const orig = useMemo(() => (original ? new Set(original) : null), [original]);
  const [area, setArea] = useState<string>(initialArea ?? PERMISSION_GROUPS[0].key);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [roles, setRoles] = useState<RoleTemplate[]>([]);

  const loadRoles = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabaseBrowser().from("erp_role_templates").select("id,name,icon,permissions").eq("store_id", storeId).order("name");
    setRoles((data ?? []) as RoleTemplate[]);
  }, [storeId]);
  useRunOnChange(loadRoles);

  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const canGrant = (p: string) => !grantable || grantable.has(p) || set.has(p);
  const changed = (p: string) => !!orig && orig.has(p) !== set.has(p);
  const passes = (p: (typeof PERMISSION_LIST)[number]) => {
    if (q.trim() && !norm(`${p.label} ${p.description} ${p.opens ?? ""}`).includes(norm(q.trim()))) return false;
    if (filter === "on") return set.has(p.value);
    if (filter === "off") return !set.has(p.value);
    if (filter === "sensitive") return !!p.sensitive;
    if (filter === "changed") return changed(p.value);
    return true;
  };
  const searching = !!q.trim() || filter !== "all";
  const groups = searching ? PERMISSION_GROUPS.filter((g) => g.items.some(passes)) : PERMISSION_GROUPS.filter((g) => g.key === area);
  const changes = orig ? PERMISSION_LIST.filter((p) => changed(p.value)).length : 0;

  /** Una plantilla solo pone lo que quien edita puede dar. */
  function apply(perms: string[]) {
    const next = perms.filter((p) => canGrant(p));
    onChange(next.reduce((v, p) => (v.includes(p) ? v : togglePermission(v, p)), [] as string[]).filter((p) => canGrant(p)));
  }
  function toggle(p: string) {
    if (!set.has(p) && !canGrant(p)) return;
    onChange(togglePermission(value, p));
  }
  function toggleArea(perms: string[]) {
    const all = perms.filter(canGrant).every((p) => set.has(p));
    onChange(all
      ? perms.reduce((v, p) => (v.includes(p) ? togglePermission(v, p) : v), value)
      : perms.filter(canGrant).reduce((v, p) => (v.includes(p) ? v : togglePermission(v, p)), value));
  }

  async function saveRole() {
    if (!storeId || !value.length) return;
    const res = await Swal.fire({ ...swalTheme, title: "Guardar como rol de la tienda", input: "text", inputPlaceholder: "Nombre del rol (ej: Cajero sede norte)", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim() ? null : "Escribe un nombre.") });
    if (!res.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_role_template_save", { p_store: storeId, p_id: null, p_name: String(res.value).trim(), p_icon: "🧩", p_description: null, p_permissions: cleanPermissions(value) });
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || r?.ok === false) return void Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo guardar el rol", text: error?.message ?? r?.message });
    await loadRoles();
  }
  async function deleteRole(role: RoleTemplate) {
    const ok = await Swal.fire({ ...swalTheme, icon: "warning", title: `Eliminar el rol «${role.name}»`, text: "Los usuarios conservan sus permisos actuales.", showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
    if (!ok.isConfirmed) return;
    await supabaseBrowser().rpc("erp_role_template_delete", { p_id: role.id });
    await loadRoles();
  }

  const same = (perms: string[]) => perms.length === value.length && perms.every((p) => set.has(p));
  const chip = (on: boolean) => on
    ? { borderColor: "transparent", background: "var(--t-accent)", color: "#fff" }
    : { borderColor: "var(--t-card-border)", color: "var(--t-text)", background: "var(--t-card-bg)" };

  return (
    <div className="space-y-3">
      {/* Medidor y acciones */}
      <div className="grid gap-3 rounded-2xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}>
        <div>
          <p className="mb-1.5 text-sm font-black">{value.length} de {PERMISSION_LIST.length} permisos{orig && changes ? <span className="ml-2 text-xs font-bold" style={{ color: "var(--t-accent)" }}>· {changes} cambio{changes === 1 ? "" : "s"} sin guardar</span> : null}</p>
          <RiskMeter perms={value} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {copyFrom?.length ? (
            <label className="inline-flex items-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              <Copy size={12} />
              <select disabled={disabled} className="max-w-[130px] bg-transparent text-xs outline-none" value="" onChange={(e) => { const src = copyFrom[Number(e.target.value)]; if (src) apply(src.permissions); }} aria-label="Copiar permisos de otro usuario">
                <option value="">Copiar de…</option>
                {copyFrom.map((c, i) => <option key={c.label + i} value={i}>{c.label}</option>)}
              </select>
            </label>
          ) : null}
          {storeId ? (
            <button type="button" disabled={disabled || !value.length} onClick={() => void saveRole()} className="inline-flex items-center gap-1 rounded-xl border border-dashed px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>
              <Save size={12} /> Guardar como rol
            </button>
          ) : null}
          {orig && changes ? (
            <button type="button" disabled={disabled} onClick={() => onChange([...original!])} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              Deshacer cambios
            </button>
          ) : null}
          <button type="button" disabled={disabled || !value.length} onClick={() => onChange([])} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            <Eraser size={12} /> Quitar todo
          </button>
        </div>
      </div>

      {/* Plantillas */}
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Empezar desde una plantilla (luego ajustas)</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {PERMISSION_PRESETS.map((preset) => {
            const on = same(preset.permissions);
            return (
              <button key={preset.key} type="button" disabled={disabled} onClick={() => apply([...preset.permissions])} title={preset.hint}
                className="flex min-w-[132px] shrink-0 flex-col items-start rounded-2xl border px-3 py-2 text-left transition hover:-translate-y-0.5 disabled:opacity-50" style={chip(on)}>
                <span className="text-sm font-bold">{preset.icon} {preset.label}</span>
                <span className="text-[10px] leading-tight" style={{ opacity: 0.75 }}>{preset.hint}</span>
                <span className="mt-1 text-[10px] font-bold" style={{ opacity: 0.7 }}>{preset.permissions.length} permisos</span>
              </button>
            );
          })}
          {roles.map((role) => {
            const on = same(role.permissions);
            return (
              <span key={role.id} className="flex min-w-[132px] shrink-0 items-stretch overflow-hidden rounded-2xl border text-left" style={chip(on)}>
                <button type="button" disabled={disabled} onClick={() => apply(role.permissions)} className="flex flex-1 flex-col items-start px-3 py-2">
                  <span className="text-sm font-bold">{role.icon} {role.name}</span>
                  <span className="text-[10px]" style={{ opacity: 0.75 }}>Rol de tu tienda</span>
                  <span className="mt-1 text-[10px] font-bold" style={{ opacity: 0.7 }}>{role.permissions.length} permisos</span>
                </button>
                <button type="button" disabled={disabled} onClick={() => void deleteRole(role)} className="border-l px-2 opacity-60 hover:opacity-100" style={{ borderColor: "var(--t-card-border)" }} aria-label={`Eliminar rol ${role.name}`}><Trash2 size={12} /></button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Buscar y filtrar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-55" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar permiso (costos, anular, precios, catálogos…)" className="w-full rounded-full border py-2 pr-3 text-base outline-none sm:text-sm" style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)", paddingLeft: "2.1rem" }} />
        </label>
        <div className="flex flex-wrap gap-1">
          {([["all", "Todos"], ["on", "Marcados"], ["off", "Sin marcar"], ["sensitive", "Sensibles"], ...(orig ? [["changed", "Cambios"]] : [])] as Array<[Filter, string]>).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={chip(filter === k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
        {/* Áreas */}
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0" aria-label="Áreas de permisos">
          {PERMISSION_GROUPS.map((g) => {
            const perms = g.items.map((i) => i.value);
            const count = perms.filter((p) => set.has(p)).length;
            const on = !searching && area === g.key;
            return (
              <button key={g.key} type="button" onClick={() => { setArea(g.key); setQ(""); setFilter("all"); }}
                className="flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition md:w-full"
                style={on ? { borderColor: "color-mix(in oklab, var(--t-accent) 60%, transparent)", background: "var(--t-accent-soft, color-mix(in oklab, var(--t-accent) 14%, transparent))" } : { borderColor: "var(--t-card-border)" }}>
                <span className="text-base">{g.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{g.title}</span>
                  <span className="mt-1 hidden h-1 overflow-hidden rounded-full md:block" style={{ background: "color-mix(in oklab, var(--t-text) 10%, transparent)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${(count / perms.length) * 100}%`, background: "var(--t-accent)" }} />
                  </span>
                </span>
                <span className="rounded-full px-1.5 text-[10px] font-black tabular-nums" style={{ background: count ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 10%, transparent)", color: count ? "#fff" : "var(--t-muted)" }}>{count}/{perms.length}</span>
              </button>
            );
          })}
        </nav>

        {/* Permisos del área (o de la búsqueda) */}
        <div className="min-w-0 space-y-3">
          {groups.length === 0 ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>Ningún permiso coincide.</p> : null}
          {groups.map((g) => {
            const perms = g.items.map((i) => i.value);
            const count = perms.filter((p) => set.has(p)).length;
            const allOn = perms.filter(canGrant).every((p) => set.has(p));
            return (
              <section key={g.key} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
                <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black">{g.icon} {g.title} <span className="text-xs font-bold" style={{ color: "var(--t-muted)" }}>· {count}/{perms.length}</span></p>
                    <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{g.hint}</p>
                  </div>
                  <button type="button" disabled={disabled} onClick={() => toggleArea(perms)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: allOn ? "var(--t-accent)" : "var(--t-text)" }}>
                    {allOn ? "Quitar el área" : "Marcar el área"}
                  </button>
                </header>
                <div className="grid gap-1.5 xl:grid-cols-2">
                  {g.items.filter((item) => !searching || passes(item)).map((item) => {
                    const on = set.has(item.value);
                    const locked = !on && !canGrant(item.value);
                    const delta = orig ? (on && !orig.has(item.value) ? "add" : !on && orig.has(item.value) ? "remove" : null) : null;
                    const needs = PERMISSION_REQUIRES[item.value];
                    return (
                      <motion.button
                        key={item.value}
                        type="button"
                        whileTap={{ scale: 0.985 }}
                        disabled={disabled || locked}
                        onClick={() => toggle(item.value)}
                        role="switch"
                        aria-checked={on}
                        title={locked ? "No tienes este permiso, así que no lo puedes dar" : undefined}
                        className="relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed"
                        style={{
                          borderColor: delta === "add" ? "rgba(16,185,129,.6)" : delta === "remove" ? "rgba(239,68,68,.55)" : on ? "color-mix(in oklab, var(--t-accent) 55%, transparent)" : "var(--t-card-border)",
                          background: on ? "color-mix(in oklab, var(--t-accent) 11%, transparent)" : "transparent",
                          opacity: locked ? 0.5 : 1,
                        }}
                      >
                        <span className="mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition" style={{ background: on ? "var(--t-accent)" : "color-mix(in oklab, var(--t-text) 18%, transparent)" }}>
                          <span className="absolute top-0.5 grid h-4 w-4 place-items-center rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }}>
                            {on ? <Check size={10} strokeWidth={4} style={{ color: "var(--t-accent)" }} /> : locked ? <Lock size={9} className="text-gray-500" /> : null}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                            {item.label}
                            <RiskPill risk={item.risk} />
                            {delta === "add" ? <span className="rounded-full bg-emerald-500/15 px-1.5 text-[9px] font-black text-emerald-500">NUEVO</span> : null}
                            {delta === "remove" ? <span className="rounded-full bg-red-500/15 px-1.5 text-[9px] font-black text-red-500">SE QUITA</span> : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: "var(--t-muted)" }}>{item.description}</span>
                          {item.opens ? <span className="mt-0.5 block text-[10px] font-semibold" style={{ color: "var(--t-muted)" }}>📂 Abre: {item.opens}</span> : null}
                          {needs?.length ? <span className="mt-0.5 block text-[10px] font-semibold" style={{ color: "var(--t-accent)" }}>🔗 Necesita: {needs.map(permissionLabel).join(", ")}</span> : null}
                          {locked ? <span className="mt-0.5 block text-[10px] font-semibold text-amber-500">🔒 No lo tienes, no lo puedes dar</span> : null}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
        <ShieldAlert size={12} className="text-amber-500" /> Alto y crítico: dalos solo a personas de confianza. Todo cambio de permisos queda en la auditoría.
      </p>
    </div>
  );
}
