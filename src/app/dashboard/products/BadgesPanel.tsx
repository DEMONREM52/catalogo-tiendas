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

/** Fin del mes de una fecha (AAAA-MM-DD). */
const endOfMonth = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10); };
const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
/** Cuánto dura cada etiqueta (se suma al «desde»). */
const DURATIONS: Array<{ label: string; days?: number; month?: boolean; none?: boolean }> = [
  { label: "3 días", days: 3 }, { label: "7 días", days: 7 }, { label: "15 días", days: 15 }, { label: "30 días", days: 30 },
  { label: "Fin de mes", month: true }, { label: "Sin fecha de fin", none: true },
];
const PROMO_TEXTS = ["2x1", "Lleva 3, paga 2", "10 % menos", "20 % menos", "Precio especial", "Últimas unidades", "Solo hoy", "Envío gratis"];
/** «Antes» redondeado hacia arriba (a cien si el precio es bajo, a mil si no) para que hoy se vea con este descuento. */
const beforeFor = (now: number, pct: number) => { const step = now < 20000 ? 100 : 1000; return Math.ceil(now / (1 - pct / 100) / step) * step; };
const discountOf = (now: number, before: number) => Math.round(100 * (1 - now / before));

const toast = (title: string, icon: "success" | "error" = "success", text?: string) =>
  void Swal.fire({ toast: true, position: "top", icon, title, text, timer: 2600, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

export function BadgesPanel({ storeId, productId, compact }: { storeId: string; productId: string; compact?: boolean }) {
  const [state, setState] = useState<"loading" | "missing" | "denied" | "ready">("loading");
  const [canEdit, setCanEdit] = useState(false);
  const [canPrice, setCanPrice] = useState(false);
  const [saved, setSaved] = useState<Partial<Record<Kind, Saved>>>({});
  const [edit, setEdit] = useState<Partial<Record<Kind, Edit>>>({});
  const [busy, setBusy] = useState<Kind | null>(null);
  // Precio de hoy en el catálogo principal: para sugerir el «antes» y avisar si no se verá.
  const [nowPrice, setNowPrice] = useState<{ price: number; catalog: string } | null>(null);
  // Precios que de verdad tuvo (historial 20261333) y a cómo se vendió en ese catálogo.
  const [past, setPast] = useState<{ history: Array<{ price: number; until: string }>; sold: Array<{ price: number; at: string }>; since: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const [{ data: p }, { data: cats }] = await Promise.all([
        sb.from("products").select("price_1,price_2,price_3,price_4,price_5").eq("id", productId).maybeSingle(),
        sb.from("store_catalogs").select("slug,name,price_level,active").eq("store_id", storeId).order("sort_order"),
      ]);
      if (!alive || !p) return;
      const list = ((cats ?? []) as Array<{ slug: string; name: string; price_level: number | null; active: boolean | null }>).filter((c) => c.active !== false);
      const main = list.find((c) => c.slug === "detal") ?? list[0];
      const raw = Number(main?.price_level ?? 3);
      const level = raw >= 1 && raw <= 5 ? raw : 3;
      const row = p as Record<string, number | null>;
      const price = Number(row[`price_${level}`] ?? 0);
      if (price > 0) setNowPrice({ price, catalog: main?.name ?? "Detal" });
      const { data } = await sb.rpc("product_price_before", { p_store: storeId, p_product: productId, p_level: level, p_catalog: main?.slug ?? null });
      const d = data as { ok?: boolean; history?: Array<{ price: number; until: string }>; sold?: Array<{ price: number; at: string }>; tracking_since?: string | null } | null;
      if (alive && d?.ok) setPast({ history: d.history ?? [], sold: d.sold ?? [], since: d.tracking_since ?? null });
    })();
    return () => { alive = false; };
  }, [storeId, productId]);

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
                  <div className="flex flex-wrap gap-1" aria-label="Sugerencias de duración">
                    <span className="self-center text-[10px] font-bold" style={{ color: "var(--t-muted)" }}>Dura:</span>
                    {DURATIONS.map((d) => {
                      const from = e.starts || today;
                      const target = d.none ? "" : d.month ? endOfMonth(from) : addDays(from, d.days!);
                      const on = e.ends === target;
                      return (
                        <button key={d.label} type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, ends: target } }))}
                          className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                          style={{ borderColor: on ? k.color : "var(--t-card-border)", background: on ? `color-mix(in oklab, ${k.color} 14%, transparent)` : undefined }}
                          title={target ? `Hasta el ${ddmmyyyy(target)}` : "Queda puesta hasta que la quites"}>
                          {d.label}
                        </button>
                      );
                    })}
                    {e.starts !== today ? (
                      <button type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, starts: today } }))} className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Empezar hoy</button>
                    ) : (
                      <button type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, starts: addDays(today, 1), ends: e.ends && e.ends <= addDays(today, 1) ? "" : e.ends } }))} className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: "var(--t-card-border)" }}>Empezar mañana</button>
                    )}
                  </div>
                  {k.kind === "price_drop" ? (
                    <label className="block text-[11px] font-bold">Precio de antes (se muestra tachado)
                      <MoneyInput value={e.before} allowEmpty onValueChange={(v) => setEdit((c) => ({ ...c, [k.kind]: { ...e, before: v ?? null } }))} placeholder="Ej: 45.000"
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold" style={field} ariaLabel="Precio de antes" />
                    </label>
                  ) : null}
                  {k.kind === "price_drop" && nowPrice ? (
                    <div className="space-y-1">
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Hoy en «{nowPrice.catalog}» se vende a <b style={{ color: "var(--t-text)" }}>{cop(nowPrice.price)}</b>.</p>
                      {past && (past.history.length || past.sold.length) ? (
                        <>
                          <p className="text-[11px] font-bold">✅ Precios que de verdad tuvo:</p>
                          <div className="flex flex-wrap gap-1" aria-label="Precios que tuvo">
                            {[
                              ...past.history.map((h) => ({ key: `h${h.price}`, price: Number(h.price), note: `hasta el ${ddmmyyyy(dayOf(h.until))}` })),
                              ...past.sold.filter((s) => !past.history.some((h) => Number(h.price) === Number(s.price)))
                                .map((s) => ({ key: `s${s.price}`, price: Number(s.price), note: `vendido el ${ddmmyyyy(dayOf(s.at))}` })),
                            ].filter((o) => o.price > nowPrice.price).map((o) => {
                              const on = Number(e.before) === o.price;
                              return (
                                <button key={o.key} type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, before: o.price } }))}
                                  className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                  style={{ borderColor: on ? k.color : `color-mix(in oklab, ${k.color} 45%, var(--t-card-border))`, background: on ? `color-mix(in oklab, ${k.color} 14%, transparent)` : undefined }}>
                                  <s>{cop(o.price)}</s> · {o.note} · −{discountOf(nowPrice.price, o.price)} %
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : past ? (
                        <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>Aún no hay un precio anterior guardado. Desde {past.since ? `el ${ddmmyyyy(dayOf(past.since))}` : "ahora"} RemHub guarda cada cambio de precio: la próxima vez que lo bajes, aquí saldrá el que tenía.</p>
                      ) : null}
                      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>O calcula uno con el descuento que quieres mostrar:</p>
                      <div className="flex flex-wrap gap-1" aria-label="Sugerencias del precio de antes">
                        {[...new Set([10, 15, 20, 30].map((pct) => beforeFor(nowPrice.price, pct)))].map((b) => {
                          const on = Number(e.before) === b;
                          return (
                            <button key={b} type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, before: b } }))}
                              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                              style={{ borderColor: on ? k.color : "var(--t-card-border)", background: on ? `color-mix(in oklab, ${k.color} 14%, transparent)` : undefined }}>
                              <s>{cop(b)}</s> · −{discountOf(nowPrice.price, b)} %
                            </button>
                          );
                        })}
                      </div>
                      {Number(e.before) > 0 ? (
                        Number(e.before) > nowPrice.price
                          ? <p className="text-[11px] font-semibold" style={{ color: k.color }}>Se verá: <s>{cop(Number(e.before))}</s> → {cop(nowPrice.price)} (−{discountOf(nowPrice.price, Number(e.before))} %)</p>
                          : <p className="text-[11px] font-semibold" style={{ color: "#e5484d" }}>⚠️ Debe ser mayor que {cop(nowPrice.price)}; si no, no se muestra.</p>
                      ) : null}
                      <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>Usa un precio que de verdad hayas tenido: un «antes» inventado puede traer reclamos ante la SIC.</p>
                    </div>
                  ) : null}
                  {k.kind === "promo" ? (
                    <input value={e.text} maxLength={30} onChange={(ev) => setEdit((c) => ({ ...c, [k.kind]: { ...e, text: ev.target.value } }))}
                      placeholder="Texto corto (opcional): 2x1, Lleva 3…" className="w-full rounded-xl border px-3 py-2 text-xs" style={field} aria-label="Texto de la promoción" />
                  ) : null}
                  {k.kind === "promo" ? (
                    <div className="flex flex-wrap gap-1" aria-label="Sugerencias de texto">
                      {PROMO_TEXTS.map((t) => {
                        const on = e.text === t;
                        return (
                          <button key={t} type="button" onClick={() => setEdit((c) => ({ ...c, [k.kind]: { ...e, text: on ? "" : t } }))}
                            className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                            style={{ borderColor: on ? k.color : "var(--t-card-border)", background: on ? `color-mix(in oklab, ${k.color} 14%, transparent)` : undefined }}>
                            {t}
                          </button>
                        );
                      })}
                    </div>
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
