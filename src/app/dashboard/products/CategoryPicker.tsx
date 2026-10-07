"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Plus, Search, Star, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { smartFilter } from "@/lib/search";

export type PickerCategory = { id: string; name: string };

/**
 * Elige en qué categorías aparece el producto: un toque para agregar o quitar.
 * La primera elegida es la principal (⭐); puedes cambiarla tocando la estrella.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  disabled,
}: {
  categories: PickerCategory[];
  /** Ids elegidos en orden: el primero es la categoría principal. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const selected = new Set(value);
  const primary = value[0] ?? null;
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const visible = useMemo(() => smartFilter(categories, q, (c) => c.name, { keepOrder: true }), [categories, q]);

  function toggle(id: string) {
    if (disabled) return;
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function makePrimary(id: string) {
    if (disabled) return;
    onChange([id, ...value.filter((v) => v !== id)]);
  }

  return (
    <div
      className="rounded-2xl border p-3"
      style={{ borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 70%, transparent)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--t-muted)" }}>Categorías</p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
            {value.length === 0
              ? "Toca las categorías donde quieres que aparezca"
              : `Aparece en ${value.length} categoría${value.length === 1 ? "" : "s"} · ⭐ principal: ${names.get(primary ?? "") ?? "—"}`}
          </p>
        </div>
        {value.length ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-125 disabled:opacity-50"
            style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}
          >
            <X size={12} /> Quitar todas
          </button>
        ) : null}
      </div>

      {categories.length > 8 ? (
        <div className="relative mt-2">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar categoría…"
            className="w-full rounded-xl border py-2 pr-3 text-sm outline-none"
            style={{ paddingLeft: "2.1rem", borderColor: "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 92%, transparent)", color: "var(--t-text)" }}
          />
        </div>
      ) : null}

      {categories.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--t-muted)" }}>
          Aún no tienes categorías.{" "}
          <Link href="/dashboard/categories" className="font-semibold underline" style={{ color: "var(--t-accent)" }}>Crear categorías</Link>
        </p>
      ) : (
        <motion.div layout className="mt-3 flex max-h-64 flex-wrap gap-2 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {visible.map((c) => {
              const on = selected.has(c.id);
              const isPrimary = primary === c.id;
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  className="flex items-center overflow-hidden rounded-full border text-sm font-semibold"
                  style={on
                    ? {
                        borderColor: "transparent",
                        background: "linear-gradient(135deg, var(--t-accent), var(--t-accent2, var(--t-accent)))",
                        color: "var(--t-cta-text, #fff)",
                        boxShadow: "0 6px 18px color-mix(in oklab, var(--t-accent) 30%, transparent)",
                      }
                    : { borderColor: "var(--t-card-border)", background: "transparent", color: "var(--t-text)" }}
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={disabled}
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className="inline-flex items-center gap-1.5 py-1.5 pl-3 pr-3 transition disabled:opacity-60"
                    title={on ? "Quitar de esta categoría" : "Agregar a esta categoría"}
                  >
                    {on ? <Check size={14} strokeWidth={3} /> : <Plus size={14} className="opacity-60" />}
                    {c.name}
                  </motion.button>
                  {on ? (
                    <button
                      type="button"
                      disabled={disabled || isPrimary}
                      onClick={() => makePrimary(c.id)}
                      className="grid h-full place-items-center border-l py-1.5 pl-2 pr-2.5 transition hover:bg-white/15"
                      style={{ borderColor: "rgba(255,255,255,0.25)" }}
                      title={isPrimary ? "Categoría principal" : "Hacer principal"}
                      aria-label={isPrimary ? `${c.name} es la categoría principal` : `Hacer ${c.name} la categoría principal`}
                    >
                      <Star size={13} fill={isPrimary ? "currentColor" : "none"} />
                    </button>
                  ) : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {visible.length === 0 ? <p className="text-xs" style={{ color: "var(--t-muted)" }}>Ninguna categoría coincide.</p> : null}
        </motion.div>
      )}
    </div>
  );
}

/** Categorías guardadas del producto (la principal primero). Si falta la migración, usa solo la principal. */
export async function loadProductCategoryIds(productId: string, primary: string | null, order: PickerCategory[]): Promise<string[]> {
  const { data, error } = await supabaseBrowser().from("product_category_links").select("category_id").eq("product_id", productId);
  const ids = error ? [] : (data ?? []).map((r: { category_id: string }) => r.category_id);
  const rank = new Map(order.map((c, i) => [c.id, i]));
  const others = ids.filter((id) => id !== primary).sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
  return primary ? [primary, ...others] : others;
}

/** Guarda todas las categorías. Devuelve un aviso si la base aún no tiene la migración. */
export async function saveProductCategoryIds(productId: string, ids: string[]): Promise<string | null> {
  const { error } = await supabaseBrowser().rpc("product_set_categories", {
    p_product: productId,
    p_categories: ids,
    p_primary: ids[0] ?? null,
  });
  if (!error) return null;
  if (/product_set_categories|Could not find the function|schema cache/i.test(error.message)) {
    return "Se guardó solo la categoría principal. Para usar varias categorías ejecuta en Supabase la migración 20261017_product_multi_categories.sql.";
  }
  return error.message;
}
