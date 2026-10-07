"use client";

import { motion } from "framer-motion";
import { Check, ShieldAlert } from "lucide-react";
import { PERMISSION_GROUPS, PERMISSION_PRESETS } from "@/lib/permissions";

/** Permisos por área con plantillas rápidas. Un clic marca o quita. */
export function PermissionPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const set = new Set(value);

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
