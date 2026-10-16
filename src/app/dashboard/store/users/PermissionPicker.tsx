"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Save, Search, ShieldAlert, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PERMISSION_GROUPS, PERMISSION_LIST, PERMISSION_PRESETS } from "@/lib/permissions";
import { useRunOnChange } from "../../inventario/shared";

type RoleTemplate = { id: string; name: string; icon: string; permissions: string[] };
const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

/** Permisos por área con plantillas rápidas. Un clic marca o quita. */
export function PermissionPicker({
  value,
  onChange,
  disabled,
  compact,
  storeId,
  copyFrom,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Con la tienda se muestran y guardan sus roles personalizados. */
  storeId?: string;
  /** Otros usuarios para copiar sus permisos. */
  copyFrom?: Array<{ label: string; permissions: string[] }>;
}) {
  const set = new Set(value);
  const [q, setQ] = useState("");
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = (label: string, description: string) => !q.trim() || norm(`${label} ${description}`).includes(norm(q.trim()));
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const loadRoles = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabaseBrowser().from("erp_role_templates").select("id,name,icon,permissions").eq("store_id", storeId).order("name");
    setRoles((data ?? []) as RoleTemplate[]);
  }, [storeId]);
  useRunOnChange(loadRoles);

  async function saveRole() {
    if (!storeId || !value.length) return;
    const res = await Swal.fire({ ...swal, title: "Guardar como rol de la tienda", input: "text", inputPlaceholder: "Nombre del rol (ej: Cajero sede norte)", showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", inputValidator: (v) => (v.trim() ? null : "Escribe un nombre.") });
    if (!res.isConfirmed) return;
    const { data, error } = await supabaseBrowser().rpc("erp_role_template_save", { p_store: storeId, p_id: null, p_name: String(res.value).trim(), p_icon: "🧩", p_description: null, p_permissions: value });
    const r = data as { ok?: boolean; message?: string } | null;
    if (error || r?.ok === false) return void Swal.fire({ ...swal, icon: "error", title: "No se pudo guardar el rol", text: error?.message ?? r?.message });
    await loadRoles();
  }

  async function deleteRole(role: RoleTemplate) {
    const ok = await Swal.fire({ ...swal, icon: "warning", title: "Eliminar el rol «" + role.name + "»", text: "Los usuarios conservan sus permisos actuales.", showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
    if (!ok.isConfirmed) return;
    await supabaseBrowser().rpc("erp_role_template_delete", { p_id: role.id });
    await loadRoles();
  }

  function toggle(permission: string) {
    onChange(set.has(permission) ? value.filter((p) => p !== permission) : [...value, permission]);
  }

  function toggleGroup(perms: string[]) {
    const all = perms.every((p) => set.has(p));
    onChange(all ? value.filter((p) => !perms.includes(p)) : [...new Set([...value, ...perms])]);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Plantillas rápidas (luego puedes ajustar)</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PERMISSION_PRESETS.map((preset) => {
            const on = preset.permissions.length === value.length && preset.permissions.every((p) => set.has(p));
            return (
              <button
                key={preset.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange([...preset.permissions])}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:opacity-50"
                style={on
                  ? { borderColor: "transparent", background: "var(--t-cta)", color: "var(--t-cta-text, #fff)" }
                  : { borderColor: "var(--t-card-border)", color: "var(--t-text)" }}
              >
                {preset.icon} {preset.label}
              </button>
            );
          })}
          {roles.map((role) => {
            const on = role.permissions.length === value.length && role.permissions.every((p) => set.has(p));
            return (
              <span key={role.id} className="inline-flex items-center overflow-hidden rounded-full border text-xs font-semibold" style={on ? { borderColor: "transparent", background: "var(--t-cta)", color: "var(--t-cta-text, #fff)" } : { borderColor: "var(--t-card-border)" }}>
                <button type="button" disabled={disabled} onClick={() => onChange([...role.permissions])} className="px-3 py-1.5">{role.icon} {role.name}</button>
                <button type="button" disabled={disabled} onClick={() => void deleteRole(role)} className="border-l px-2 py-1.5 opacity-60 hover:opacity-100" style={{ borderColor: "var(--t-card-border)" }} aria-label={"Eliminar rol " + role.name}><Trash2 size={11} /></button>
              </span>
            );
          })}
          {storeId ? (
            <button type="button" disabled={disabled || value.length === 0} onClick={() => void saveRole()} className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", color: "var(--t-accent)" }}>
              <Save size={12} /> Guardar como rol
            </button>
          ) : null}
          {copyFrom?.length ? (
            <label className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--t-card-border)" }}>
              <Copy size={12} />
              <select disabled={disabled} className="bg-transparent text-xs outline-none" value="" onChange={(e) => { const src = copyFrom[Number(e.target.value)]; if (src) onChange([...src.permissions]); }} aria-label="Copiar permisos de otro usuario">
                <option value="">Copiar de…</option>
                {copyFrom.map((c, i) => <option key={c.label + i} value={i}>{c.label}</option>)}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            disabled={disabled || value.length === 0}
            onClick={() => onChange([])}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}
          >
            Limpiar
          </button>
        </div>
      </div>

      <label className="relative block">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-55" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar permiso (ej. costos, anular, precios…)" className="w-full rounded-full border py-2 pl-8 pr-3 text-sm outline-none" style={{ borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)", paddingLeft: "2.1rem" }} />
      </label>

      <PermissionSummary value={value} />

      <div className={`grid gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
        {PERMISSION_GROUPS.filter((group) => group.items.some((i) => match(i.label, i.description))).map((group) => {
          const perms = group.items.map((i) => i.value);
          const count = perms.filter((p) => set.has(p)).length;
          return (
            <div key={group.key} className="rounded-2xl border p-3" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{group.icon} {group.title}</p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleGroup(perms)}
                  className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{ borderColor: "var(--t-card-border)", color: count === perms.length ? "var(--t-accent)" : "var(--t-muted)" }}
                >
                  {count === perms.length ? "Quitar todo" : `Todo (${count}/${perms.length})`}
                </button>
              </div>
              <div className="space-y-1.5">
                {group.items.filter((item) => match(item.label, item.description)).map((item) => {
                  const on = set.has(item.value);
                  return (
                    <motion.button
                      key={item.value}
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      disabled={disabled}
                      onClick={() => toggle(item.value)}
                      aria-pressed={on}
                      className="flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition disabled:opacity-60"
                      style={{
                        borderColor: on ? "color-mix(in oklab, var(--t-accent) 55%, transparent)" : "var(--t-card-border)",
                        background: on ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : "transparent",
                      }}
                    >
                      <span
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition"
                        style={on ? { background: "var(--t-accent)", borderColor: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}
                      >
                        {on ? <Check size={13} strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {item.label}
                          {item.sensitive ? <ShieldAlert size={13} className="text-amber-500" aria-label="Permiso sensible" /> : null}
                        </span>
                        {!compact ? <span className="block text-xs" style={{ color: "var(--t-muted)" }}>{item.description}</span> : null}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
        <ShieldAlert size={12} className="text-amber-500" /> Permiso sensible: dalo solo a personas de confianza.
      </p>
    </div>
  );
}

/** Lo que la persona puede y no puede hacer, en palabras. */
export function PermissionSummary({ value }: { value: string[] }) {
  const has = (p: string) => value.includes(p);
  if (!value.length) return null;
  const sensitive = PERMISSION_LIST.filter((p) => p.sensitive && has(p.value)).map((p) => p.label);
  const notes: string[] = [];
  if (has("products") && !has("costs_view")) notes.push("Crea y edita productos, pero no ve costos ni % de ganancia 🔒");
  if (has("products") && !has("products_prices")) notes.push("No puede cambiar precios");
  if ((has("inventory") || has("purchases")) && !has("costs_view")) notes.push("En inventario e informes, los costos le salen ocultos");
  if (has("pos") && !has("sales_void")) notes.push("Vende, pero no anula ventas");
  if (has("pos") && !has("price_approve")) notes.push("No vende por debajo del precio permitido sin autorización");
  if (has("purchases") && !has("purchases_void")) notes.push("Ingresa facturas, pero no las anula");
  if (has("audit") && !has("reports")) notes.push("Ve la auditoría, pero no el informe de ventas");
  if (!has("exports") && value.length) notes.push("No descarga listados a Excel");
  return (
    <div className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-accent) 6%, transparent)" }}>
      <p className="font-bold">📝 En resumen: {value.length} permiso{value.length === 1 ? "" : "s"}</p>
      {sensitive.length ? <p className="mt-1"><ShieldAlert size={12} className="inline text-amber-500" /> Sensibles: {sensitive.join(", ")}</p> : null}
      {notes.length ? <ul className="mt-1 list-disc pl-4" style={{ color: "var(--t-muted)" }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </div>
  );
}
