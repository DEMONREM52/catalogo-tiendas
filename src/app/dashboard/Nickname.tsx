"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

const EVENT = "remhub-nickname-updated";

/**
 * "¿Cómo quieres que te llamemos?": nombre personal de quien usa el panel
 * (saludo, encabezados). Es distinto del nombre de la tienda y se guarda en
 * el perfil del usuario, así cada persona del equipo tiene el suyo.
 */
export async function saveNickname(name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  const { error } = await supabaseBrowser().auth.updateUser({ data: { display_name: clean } });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: clean }));
  return clean;
}

/** Escucha cuando el nombre cambia en otra parte del panel. */
export function useNicknameUpdates(onChange: (name: string) => void) {
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  });
  useEffect(() => {
    const handler = (e: Event) => ref.current(String((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
}

/** Nombre con lápiz: un clic para editar, Enter guarda, Esc cancela. */
export function EditableNickname({
  value,
  fallback,
  onSaved,
  className,
  inputClassName,
}: {
  value: string;
  /** Lo que se muestra si aún no hay nombre personalizado. */
  fallback?: string;
  onSaved?: (name: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function start() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  async function commit() {
    if (saving) return;
    const clean = draft.replace(/\s+/g, " ").trim();
    if (clean === value.trim()) return setEditing(false);
    if (clean.length < 2) return setError("Escribe al menos 2 letras");
    setSaving(true);
    try {
      const saved = await saveNickname(clean);
      onSaved?.(saved);
      setEditing(false);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex max-w-full flex-col align-middle">
        <span className="inline-flex max-w-full items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft}
            maxLength={40}
            disabled={saving}
            placeholder="¿Cómo quieres que te llamemos?"
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className={`min-w-0 rounded-xl border bg-transparent px-2.5 py-1 outline-none focus:ring-2 focus:ring-fuchsia-500/30 ${inputClassName ?? ""}`}
            style={{ borderColor: "var(--t-card-border)", color: "var(--t-text)", width: `${Math.max(10, draft.length + 2)}ch`, maxWidth: "100%" }}
            aria-label="¿Cómo quieres que te llamemos?"
          />
          <button type="button" onClick={() => void commit()} disabled={saving} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: "var(--t-accent)" }} aria-label="Guardar nombre">
            <Check size={16} />
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cancelar">
            <X size={16} />
          </button>
        </span>
        <span className="mt-1 text-xs font-normal tracking-normal" style={{ color: error ? "#ef4444" : "var(--t-muted)" }}>
          {error ?? (saving ? "Guardando…" : "Enter para guardar · Esc para cancelar")}
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className={`group inline-flex max-w-full items-center gap-2 rounded-xl text-left transition ${className ?? ""}`}
      title="Cambiar cómo te llamamos"
    >
      <span className="truncate">{value || fallback || "Tu nombre"}</span>
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border opacity-50 transition group-hover:opacity-100"
        style={{ borderColor: "var(--t-card-border)", color: done ? "#22c55e" : "var(--t-muted)" }}
        aria-hidden
      >
        {done ? <Check size={14} /> : <Pencil size={13} />}
      </span>
    </button>
  );
}
