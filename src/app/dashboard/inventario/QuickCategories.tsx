"use client";

import { useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage, inputStyle, toast } from "./shared";

type Cat = { id: string; name: string };
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * Varias categorías como etiquetas: se escriben para buscar, Enter agrega la primera que coincide,
 * y si no existe se crea ahí mismo. La primera (⭐) es la principal; tocar la estrella de otra la vuelve principal.
 */
export function QuickCategories({ storeId, categories, onCategories, value, onChange }: {
  storeId: string;
  categories: Cat[];
  onCategories: (next: Cat[]) => void;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const term = fold(q);
  const options = useMemo(
    () => categories.filter((c) => !value.includes(c.id) && (!term || fold(c.name).includes(term))).slice(0, 8),
    [categories, value, term],
  );
  const exact = categories.find((c) => fold(c.name) === term);

  const add = (id: string) => { onChange([...value, id]); setQ(""); inputRef.current?.focus(); };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));
  const makePrimary = (id: string) => onChange([id, ...value.filter((v) => v !== id)]);

  async function create() {
    const name = q.trim().toUpperCase();
    if (!name || creating) return;
    setCreating(true);
    const { data, error } = await supabaseBrowser().from("product_categories").insert({ store_id: storeId, name, active: true }).select("id,name").single();
    setCreating(false);
    if (error || !data) return void toast("No se pudo crear la categoría", "error", errorMessage(error));
    const cat = data as Cat;
    onCategories([...categories, cat].sort((a, b) => a.name.localeCompare(b.name)));
    add(cat.id);
    void toast(`Categoría «${cat.name}» creada`);
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5"
        style={{ ...inputStyle }}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((id, i) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold"
            style={i === 0 ? { background: "color-mix(in oklab, var(--t-accent) 18%, transparent)", borderColor: "color-mix(in oklab, var(--t-accent) 50%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <button type="button" title={i === 0 ? "Categoría principal" : "Volver principal"} onClick={(e) => { e.stopPropagation(); makePrimary(id); }} style={{ opacity: i === 0 ? 1 : 0.4 }}>⭐</button>
            {names.get(id) ?? "Categoría"}
            <button type="button" aria-label={`Quitar ${names.get(id) ?? ""}`} onClick={(e) => { e.stopPropagation(); remove(id); }} className="ml-0.5" style={{ color: "#ef4444" }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 text-sm outline-none"
          style={{ color: "var(--t-text)" }}
          value={q}
          placeholder={value.length ? "Agregar otra…" : "Escribe para buscar o crear…"}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            // Enter aquí elige la categoría (no crea el producto).
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (exact && !value.includes(exact.id)) add(exact.id);
              else if (options[0] && term) add(options[0].id);
              else if (term && !exact) void create();
            } else if (e.key === "Backspace" && !q && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          aria-label="Categorías"
        />
      </div>
      {open && (options.length || (term && !exact)) ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
          {options.map((c) => (
            <button key={c.id} type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:brightness-125" style={{ background: "transparent" }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => add(c.id)}>
              {c.name}
            </button>
          ))}
          {term && !exact ? (
            <button type="button" disabled={creating} className="block w-full rounded-lg px-3 py-1.5 text-left text-sm font-bold" style={{ color: "var(--t-accent)" }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => void create()}>
              {creating ? "Creando…" : `＋ Crear categoría «${q.trim().toUpperCase()}»`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
