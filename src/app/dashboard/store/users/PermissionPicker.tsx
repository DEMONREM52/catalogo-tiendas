"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Check, Save, ShieldAlert, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PERMISSION_GROUPS, PERMISSION_PRESETS } from "@/lib/permissions";
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
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Con la tienda se muestran y guardan sus roles personalizados. */
  storeId?: string;
}) {
  const set = new Set(value);
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

      <div className={`grid gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
        {PERMISSION_GROUPS.map((group) => {
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
                {group.items.map((item) => {
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
