"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { DateField, ddmmyyyy } from "@/components/forms/Fields";

/**
 * Etiquetas del producto en el catálogo (20261329): 🆕 Llegó nuevo, ⬇️ Bajó de precio (el «antes» lo escribes tú),
 * 🔥 En promoción y ⭐ Destacado, cada una con «desde» y «hasta». Se apagan solas al vencer.
 * Se guardan aparte, de una vez (no con «Guardar» del producto). No cambian lo que se cobra.
 */
type Kind = "new" | "price_drop" | "promo" | "featured";
type Saved = { kind: Kind; starts_at: string; ends_at: string | null; before_price: number | null; text: string | null; running: boolean; finished: boolean };
type Edit = { on: boolean; starts: string; ends: string; before: number | null; text: string };

const KINDS: Array<{ kind: Kind; icon: string; label: string; hint: string; color: string; defaultDays?: number }> = [
  { kind: "new", icon: "🆕", label: "Llegó nuevo", hint: "Sale la etiqueta «Nuevo» en el catálogo.", color: "#0ea5e9", defaultDays: 15 },
  { kind: "price_drop", icon: "⬇️", label: "Bajó de precio", hint: "Muestra tachado el precio de antes que escribas (solo si es mayor que el de hoy).", color: "#10b981" },
  { kind: "promo", icon: "🔥", label: "En promoción", hint: "Sale «En promoción» o tu texto corto (ej. «2x1»).", color: "#ef4444" },
  { kind: "featured", icon: "⭐", label: "Destacado", hint: "Sale primero y resaltado mientras esté activo.", color: "#f59e0b" },
];

const bogotaToday = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
// Del instante guardado al día en Colombia («hasta» se guarda como el inicio del día siguiente).
const dayOf = (iso: string, end = false) => new Date(Date.parse(iso) - 5 * 3600_000 - (end ? 1000 : 0)).toISOString().slice(0, 10);

const toast = (title: string, icon: "success" | "error" = "success", text?: string) =>
  void Swal.fire({ toast: true, position: "top", icon, title, text, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function BadgesPanel({ storeId, productId, compact }: { storeId: string; productId: string; compact?: boolean }) {
  const [state, setState] = useState<"loading" | "missing" | "denied" | "ready">("loading");
  const [canEdit, setCanEdit] = useState(false);
  const [canPrice, setCanPrice] = useState(false);
  const [saved, setSaved] = useState<Partial<Record<Kind, Saved>>>({});
  const [edit, setEdit] = useState<Partial<Record<Kind, Edit>>>({});
  const [busy, setBusy] = useState<Kind | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("product_badges_get", { p_store: storeId, p_product: productId });
    if (error) { setState(/Could not find the function|schema cache|does not exist/i.test(error.message) ? "missing" : "denied"); return; }
    const d = data as { ok?: boolean; can_edit?: boolean; can_price?: boolean; items?: Saved[] } | null;
    if (!d?.ok) { setState("denied"); return; }
    setCanEdit(Boolean(d.can_edit)); setCanPrice(Boolean(d.can_price));
    setSaved(Object.fromEntries((d.items ?? []).map((i) => [i.kind, i])));
    setEdit({});
    setState("ready");
  }, [storeId, productId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  function start(kind: Kind) {
    const s = saved[kind];
    const def = KINDS.find((k) => k.kind === kind)!;
    const today = bogotaToday();
    setEdit((cur) => ({ ...cur, [kind]: s
      ? { on: true, starts: s.running || s.finished ? today : dayOf(s.starts_at), ends: s.ends_at && !s.finished ? dayOf(s.ends_at, true) : "", before: s.before_price ? Number(s.before_price) : null, text: s.text ?? "" }
      : { on: true, starts: today, ends: def.defaultDays ? addDays(today, def.defaultDays) : "", before: null, text: "" } }));
  }

  async function save(kind: Kind, on: boolean) {
    const e = edit[kind];
    setBusy(kind);
    const { data, error } = await supabaseBrowser().rpc("product_badge_save", {
      p_store: storeId, p_product: productId, p_kind: kind, p_on: on,
      p_starts: on ? e?.starts || null : null, p_ends: on ? e?.ends || null : null,
      p_before: on && kind === "price_drop" ? e?.before ?? null : null, p_text: on && kind === "promo" ? e?.text || null : null,
    });
    setBusy(null);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) return toast("No se guardó", "error", d?.message ?? error?.message);
    const label = KINDS.find((k) => k.kind === kind)!.label;
    toast(on ? `${label}: listo` : `${label}: quitado`);
    void load();
  }

  if (state === "missing") return <p className="rounded-2xl border p-3 text-xs" style={{ borderColor: "#f59e0b" }}>🏷️ Para poner etiquetas en el catálogo corre en Supabase la migración <b>20261329_etiquetas_catalogo.sql</b>.</p>;
  if (state === "denied") return null;
  if (state === "loading") return <p className="text-xs" style={{ color: "var(--t-muted)" }}><Loader2 size={12} className="mr-1 inline animate-spin" /> Cargando etiquetas…</p>;

  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  const today = bogotaToday();
  return (
    <section className="rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }}>
      <div className="p-3">
        <p className="text-sm font-black">🏷️ Etiquetas en el catálogo</p>
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Elige cuáles se ven y desde/hasta cuándo. Se apagan solas al vencer y no cambian lo que se cobra. Se guardan aparte, de una vez.</p>
        {!canEdit ? <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: "var(--t-muted)" }}><Lock size={12} /> Solo quien tiene el permiso de Productos pone etiquetas.</p> : null}
      </div>
      <div className={`grid gap-2 px-3 pb-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        {KINDS.map((k) => {
          const s = saved[k.kind];
          const e = edit[k.kind];
          const locked = !canEdit || (k.kind === "price_drop" && !canPrice);
          const status = s ? s.running ? `Activa${s.ends_at ? ` hasta el ${ddmmyyyy(dayOf(s.ends_at, true))}` : " sin fecha de fin"}`
            : s.finished ? `Terminó el ${ddmmyyyy(dayOf(s.ends_at!, true))}` : `Programada desde el ${ddmmyyyy(dayOf(s.starts_at))}` : null;
          return (
            <div key={k.kind} className="rounded-xl border p-2.5" style={{ borderColor: s?.running ? k.color : "var(--t-card-border)", background: s?.running ? `color-mix(in oklab, ${k.color} 8%, transparent)` : undefined }}>
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>{k.icon}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm">{k.label}</b>
                  <span className="block text-[11px]" style={{ color: status ? (s?.running ? k.color : "var(--t-muted)") : "var(--t-muted)" }}>
                    {status ?? k.hint}{s?.kind === "price_drop" && s.before_price ? ` · antes $${Math.round(Number(s.before_price)).toLocaleString("es-CO")}` : ""}{s?.kind === "promo" && s.text ? ` · «${s.text}»` : ""}
                  </span>
                </span>
                {locked ? (k.kind === "price_drop" && canEdit ? <span title="Requiere «Cambiar precios»"><Lock size={13} /></span> : null) : e ? null : s ? (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => start(k.kind)} className="rounded-lg border px-2 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cambiar</button>
                    <button type="button" disabled={busy === k.kind} onClick={() => void save(k.kind, false)} className="rounded-lg border px-2 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)", color: "#e5484d" }}>Quitar</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => start(k.kind)} className="rounded-lg px-2.5 py-1 text-[11px] font-black text-white" style={{ background: k.color }}>Poner</button>
                )}
              </div>
              {e ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-bold">Desde
                      <DateField value={e.starts} min={today} onChange={(v) => setEdit((c) => ({ ...c, [k.kind]: { ...e, starts: v } }))} className="mt-1" ariaLabel={`${k.label}: desde`} />
                    </label>
                    <label className="block text-[11px] font-bold">Hasta (opcional)
                      <DateField value={e.ends} min={e.starts || today} onChange={(v) => setEdit((c) => ({ ...c, [k.kind]: { ...e, ends: v } }))} className="mt-1" ariaLabel={`${k.label}: hasta`} />
                    </label>
                  </div>
                  {k.kind === "price_drop" ? (
                    <label className="block text-[11px] font-bold">Precio de antes (se muestra tachado)
                      <MoneyInput value={e.before} allowEmpty onValueChange={(v) => setEdit((c) => ({ ...c, [k.kind]: { ...e, before: v ?? null } }))} placeholder="Ej: 45.000"
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold" style={field} ariaLabel="Precio de antes" />
                    </label>
                  ) : null}
                  {k.kind === "promo" ? (
                    <input value={e.text} maxLength={30} onChange={(ev) => setEdit((c) => ({ ...c, [k.kind]: { ...e, text: ev.target.value } }))}
                      placeholder="Texto corto (opcional): 2x1, Lleva 3…" className="w-full rounded-xl border px-3 py-2 text-xs" style={field} aria-label="Texto de la promoción" />
                  ) : null}
                  <div className="flex gap-2">
                    <button type="button" disabled={busy === k.kind || (k.kind === "price_drop" && !(Number(e.before) > 0))} onClick={() => void save(k.kind, true)}
                      className="flex-1 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-50" style={{ background: k.color }}>
                      {busy === k.kind ? "Guardando…" : "Guardar"}
                    </button>
                    <button type="button" onClick={() => setEdit((c) => { const n = { ...c }; delete n[k.kind]; return n; })} className="rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
