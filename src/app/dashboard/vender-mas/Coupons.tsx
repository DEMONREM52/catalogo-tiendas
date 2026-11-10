"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoneyInput } from "@/app/dashboard/MoneyInput";
import { DateField } from "@/components/forms/Fields";
import { toast } from "@/app/dashboard/inventario/shared";
import { Stat } from "./CartLeads";

type Coupon = {
  id: string; code: string; kind: "pct" | "value"; amount: number; min_total: number; starts_on: string | null; ends_on: string | null;
  max_uses: number | null; uses: number; catalog_slugs: string[]; note: string | null; active: boolean; created_by_name: string | null;
  discount_total: number; sales_total: number;
};
type Draft = Omit<Coupon, "uses" | "created_by_name" | "discount_total" | "sales_total" | "id"> & { id: string | null };

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const dmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const field = "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm";
const fs = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;
const EMPTY: Draft = { id: null, code: "", kind: "pct", amount: 10, min_total: 0, starts_on: null, ends_on: null, max_uses: null, catalog_slugs: [], note: null, active: true };
const IDEAS = ["BIENVENIDO", "VUELVE10", "CUMPLE15", "AMIGOS", "FINDE"];

function status(c: Coupon, today: string) {
  if (!c.active) return { label: "Apagado", color: "#94a3b8" };
  if (c.ends_on && c.ends_on < today) return { label: "Vencido", color: "#ef4444" };
  if (c.starts_on && c.starts_on > today) return { label: `Empieza ${dmy(c.starts_on)}`, color: "#f59e0b" };
  if (c.max_uses && c.uses >= c.max_uses) return { label: "Agotado", color: "#ef4444" };
  return { label: "Activo", color: "#10b981" };
}

/** Cupones (20261312): por % o por valor; no se suman a las ofertas. Crear o cambiar: «Cambiar precios». */
export function Coupons({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [today, setToday] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalogs, setCatalogs] = useState<Array<{ slug: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabaseBrowser().rpc("coupons_list", { p_store: storeId });
    const r = data as { ok: boolean; message?: string; items?: Coupon[]; can_edit?: boolean; today?: string } | null;
    if (e || !r?.ok) return setError(e?.message ?? r?.message ?? "No se pudo leer.");
    setError("");
    setRows(r.items ?? []);
    setCanEdit(Boolean(r.can_edit));
    setToday(r.today ?? "");
  }, [storeId]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    void supabaseBrowser().from("store_catalogs").select("slug,name,active").eq("store_id", storeId).order("sort_order")
      .then(({ data }) => setCatalogs(((data ?? []) as Array<{ slug: string | null; name: string; active?: boolean | null }>).filter((c) => c.slug && c.active !== false).map((c) => ({ slug: c.slug as string, name: c.name }))));
    return () => window.clearTimeout(t);
  }, [load, storeId]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    const { data, error: e } = await supabaseBrowser().rpc("coupon_save", {
      p_store: storeId, p_id: draft.id, p_code: draft.code, p_kind: draft.kind, p_amount: draft.amount, p_min_total: draft.min_total,
      p_starts_on: draft.starts_on, p_ends_on: draft.ends_on, p_max_uses: draft.max_uses, p_catalog_slugs: draft.catalog_slugs, p_note: draft.note, p_active: draft.active,
    });
    setBusy(false);
    const r = data as { ok: boolean; message?: string; items?: Coupon[] } | null;
    if (e || !r?.ok) return void toast("No se pudo guardar", "error", e?.message ?? r?.message);
    setRows(r.items ?? []);
    setDraft(null);
    void toast("🎟️ Cupón guardado");
  }

  async function remove(c: Coupon) {
    const ask = await Swal.fire({
      title: `¿Quitar ${c.code}?`, text: c.uses ? "Ya se usó: queda en el historial pero apagado." : "Se borra del todo.",
      icon: "warning", showCancelButton: true, confirmButtonText: "Sí, quitar", cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#ef4444",
    });
    if (!ask.isConfirmed) return;
    const { data, error: e } = await supabaseBrowser().rpc("coupon_delete", { p_store: storeId, p_id: c.id });
    const r = data as { ok: boolean; message?: string; items?: Coupon[] } | null;
    if (e || !r?.ok) return void toast("No se pudo", "error", e?.message ?? r?.message);
    setRows(r.items ?? []);
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); void toast(`Copiado: ${code}`); } catch { window.prompt("Copia el código:", code); }
  }

  const active = (rows ?? []).filter((c) => status(c, today).label === "Activo");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">🎟️ Cupones de descuento</h3>
          <p className="text-xs" style={{ color: "var(--t-muted)" }}>El cliente lo escribe en el carrito. Solo descuenta productos <b>sin oferta</b> y el pedido queda con el precio ya descontado.</p>
        </div>
        {canEdit ? (
          <button type="button" onClick={() => setDraft({ ...EMPTY })} className="rounded-xl px-4 py-2.5 text-sm font-black text-white" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>＋ Nuevo cupón</button>
        ) : <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>🔒 Crear o cambiar cupones pide «Cambiar precios».</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Activos" value={String(active.length)} color="#10b981" />
        <Stat label="Usos" value={String((rows ?? []).reduce((a, c) => a + c.uses, 0))} hint="pedidos con cupón" color="#ec4899" />
        <Stat label="Descontado" value={money((rows ?? []).reduce((a, c) => a + Number(c.discount_total), 0))} hint={`ventas ${money((rows ?? []).reduce((a, c) => a + Number(c.sales_total), 0))}`} color="#8b5cf6" />
      </div>

      {error ? <p className="text-sm" style={{ color: "#ef4444" }}>⚠️ {error}</p> : null}
      {rows && !rows.length ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
          Aún no tienes cupones. Crea uno como <b>BIENVENIDO</b> con 10 % para clientes nuevos y compártelo en tus estados.
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {(rows ?? []).map((c) => {
          const st = status(c, today);
          return (
            <li key={c.id} className="coupon-ticket relative overflow-hidden rounded-2xl border" style={{ borderColor: `color-mix(in oklab, ${st.color} 40%, var(--t-card-border))`, opacity: st.label === "Activo" ? 1 : 0.75 }}>
              <div className="flex">
                <div className="grid w-24 shrink-0 place-items-center p-3 text-center text-white" style={{ background: c.active ? "linear-gradient(160deg,#ec4899,#8b5cf6)" : "#94a3b8" }}>
                  <p className="text-2xl font-black leading-none">{c.kind === "pct" ? `${c.amount}%` : money(c.amount)}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase opacity-90">descuento</p>
                </div>
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => void copy(c.code)} className="font-mono text-lg font-black tracking-wider" title="Copiar código">{c.code} <span className="text-xs opacity-60">📋</span></button>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: st.color }}>{st.label}</span>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {c.min_total > 0 ? `Compra mínima ${money(c.min_total)} · ` : ""}
                    {c.max_uses ? `${c.uses} de ${c.max_uses} usos` : `${c.uses} uso(s)`}
                    {c.ends_on ? ` · hasta ${dmy(c.ends_on)}` : ""}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {c.catalog_slugs.length ? `Solo en: ${c.catalog_slugs.map((s) => catalogs.find((k) => k.slug === s)?.name ?? s).join(", ")}` : "En todos los catálogos"}
                    {c.note ? ` · ${c.note}` : ""}
                  </p>
                  {canEdit ? (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setDraft({ ...c })} className="rounded-lg border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>✏️ Editar</button>
                      <button type="button" onClick={() => void remove(c)} className="rounded-lg border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>🗑️</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {draft && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={() => setDraft(null)} role="dialog" aria-modal="true" aria-label="Cupón">
          <div className="vm-sheet max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border p-5 sm:rounded-[28px]" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black">🎟️ {draft.id ? "Editar cupón" : "Nuevo cupón"}</h3>
              <button type="button" onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar">✕</button>
            </div>
            <div className="space-y-4">
              <label className="block text-xs font-bold">Código
                <input value={draft.code} maxLength={24} placeholder="ZAMORA10" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} className={`${field} font-mono text-lg font-black tracking-wider`} style={fs} />
                <span className="mt-1 flex flex-wrap gap-1">
                  {IDEAS.map((i) => <button key={i} type="button" onClick={() => setDraft({ ...draft, code: i })} className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>{i}</button>)}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["pct", "value"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setDraft({ ...draft, kind: k, amount: k === "pct" ? 10 : 10000, min_total: k === "value" && draft.min_total <= 10000 ? 50000 : draft.min_total })}
                    className="rounded-2xl border p-3 text-left text-sm font-bold" style={draft.kind === k ? { borderColor: "#ec4899", background: "color-mix(in oklab, #ec4899 12%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                    {k === "pct" ? "％ Porcentaje" : "💵 Valor fijo"}
                    <span className="block text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>{k === "pct" ? "Ej. 10 % en cada producto" : "Ej. $10.000, repartido en el pedido"}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold">{draft.kind === "pct" ? "Porcentaje (1 a 90)" : "Valor del descuento"}
                  {draft.kind === "pct" ? (
                    <input type="number" inputMode="numeric" min={1} max={90} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} className={field} style={fs} />
                  ) : <MoneyInput value={draft.amount || null} allowEmpty onValueChange={(v) => setDraft({ ...draft, amount: v ?? 0 })} className={field} style={fs} ariaLabel="Valor del descuento" />}
                </label>
                <label className="block text-xs font-bold">Compra mínima {draft.kind === "value" ? "(obligatoria)" : "(opcional)"}
                  <MoneyInput value={draft.min_total || null} allowEmpty onValueChange={(v) => setDraft({ ...draft, min_total: v ?? 0 })} className={field} style={fs} placeholder="$ 0" ariaLabel="Compra mínima" />
                </label>
              </div>
              {draft.kind === "value" && draft.min_total <= draft.amount ? <p className="text-[11px] font-bold" style={{ color: "#ef4444" }}>La compra mínima debe ser mayor que el descuento.</p> : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-xs font-bold">Desde (opcional)<DateField value={draft.starts_on ?? ""} onChange={(v) => setDraft({ ...draft, starts_on: v || null })} className="mt-1" /></div>
                <div className="text-xs font-bold">Hasta (opcional)<DateField value={draft.ends_on ?? ""} onChange={(v) => setDraft({ ...draft, ends_on: v || null })} className="mt-1" /></div>
              </div>
              <label className="block text-xs font-bold">Límite de usos (vacío = sin límite)
                <input type="number" inputMode="numeric" min={1} value={draft.max_uses ?? ""} onChange={(e) => setDraft({ ...draft, max_uses: e.target.value ? Math.max(1, Number(e.target.value)) : null })} className={field} style={fs} placeholder="Sin límite" />
              </label>
              <div>
                <p className="text-xs font-bold">¿En qué catálogos sirve?</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setDraft({ ...draft, catalog_slugs: [] })} className="rounded-full border px-3 py-1.5 text-[11px] font-bold" style={!draft.catalog_slugs.length ? { borderColor: "#ec4899", background: "#ec4899", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>✅ En todos</button>
                  {catalogs.map((c) => {
                    const on = draft.catalog_slugs.includes(c.slug);
                    return <button key={c.slug} type="button" onClick={() => setDraft({ ...draft, catalog_slugs: on ? draft.catalog_slugs.filter((x) => x !== c.slug) : [...draft.catalog_slugs, c.slug] })} className="rounded-full border px-3 py-1.5 text-[11px] font-bold" style={on ? { borderColor: "#ec4899", background: "color-mix(in oklab, #ec4899 18%, transparent)" } : { borderColor: "var(--t-card-border)" }}>{on ? "✓ " : ""}{c.name}</button>;
                  })}
                </div>
              </div>
              <label className="block text-xs font-bold">Nota interna (opcional)
                <input value={draft.note ?? ""} maxLength={200} placeholder="Para la campaña de diciembre" onChange={(e) => setDraft({ ...draft, note: e.target.value || null })} className={field} style={fs} />
              </label>
              <label className="flex items-center gap-2 text-xs font-bold">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Activo
              </label>
              <div className="rounded-2xl border p-3 text-xs" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
                💡 Los productos que ya están en oferta no reciben el cupón (no se suman). {draft.kind === "value" ? "El valor se reparte entre los productos según lo que vale cada uno." : ""}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold" style={{ borderColor: "var(--t-card-border)" }}>Cancelar</button>
                <button type="button" disabled={busy || draft.code.length < 4} onClick={() => void save()} className="rounded-xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>{busy ? "Guardando…" : "Guardar cupón"}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
