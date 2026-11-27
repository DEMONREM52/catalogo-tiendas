"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Lock, LockOpen, Minus, Package, PackageOpen, PackagePlus, Pencil, Plus, Printer, Search, Trash2, TriangleAlert, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Thumb } from "../../inventario/LineEditor";
import { ProductName } from "@/components/ProductName";
import { STOCK_REQUESTS_CHANGED_EVENT, srError, type SrDetail, type SrItem } from "./types";
import { BOX_COLORS, boxColor, boxTitle, boxUnits, clampSelection, distribution, distributionText, type SrBox, type SrBoxes } from "./boxes";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };
const MISSING = "Para usar cajas, ejecuta en Supabase la migración 20261348_cajas_pedidos.sql.";
/** Llave para no repetir un cambio (doble toque o reintento). randomUUID no existe fuera de https: se arma una v4. */
function newKey(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const errText = (e: { message?: string } | null | undefined) => (e && /Could not find the function|schema cache|does not exist/i.test(e.message ?? "") ? MISSING : srError(e));

/** Cajas del pedido, en vivo (el aviso único del panel avisa cuando alguien cambia algo). */
export function useRequestBoxes(requestId: string | null) {
  const [state, setState] = useState<{ id: string; data: SrBoxes | null; error: string | null } | null>(null);
  const load = useCallback(async () => {
    if (!requestId) return;
    const { data, error } = await supabaseBrowser().rpc("erp_sr_boxes", { p_request: requestId });
    setState({ id: requestId, data: error ? null : (data as SrBoxes), error: error ? errText(error) : null });
  }, [requestId]);
  useEffect(() => {
    if (!requestId) return;
    const t = window.setTimeout(() => void load(), 0);
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      if (!id || id === requestId) void load();
    };
    window.addEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange);
    return () => { window.clearTimeout(t); window.removeEventListener(STOCK_REQUESTS_CHANGED_EVENT, onChange); };
  }, [requestId, load]);
  const mine = state && state.id === requestId ? state : null;
  return { data: mine?.data ?? null, error: mine?.error ?? null, reload: load };
}

type Sheet =
  | { kind: "save" }
  | { kind: "edit"; box: SrBox }
  | { kind: "move"; box: SrBox; itemId: string }
  | { kind: "print"; boxIds: string[] };

/**
 * Vista «Cajas» del pedido: lo que falta meter en caja (con selección y cantidades), las cajas como acordeones
 * de colores y una barra flotante para guardar lo elegido en una caja nueva o en una que ya existe.
 */
export function BoxesBoard({ request, items, thumbs, boxes, onSelecting, focusBox }: {
  request: SrDetail["request"];
  items: SrItem[];
  thumbs: Record<string, string | null>;
  boxes: ReturnType<typeof useRequestBoxes>;
  /** Hay productos elegidos: la sala oculta su barra flotante para que no haya dos. */
  onSelecting?: (on: boolean) => void;
  /** Caja que se abre de una vez (llegó escaneando su QR). */
  focusBox?: string | null;
}) {
  const { data, error, reload } = boxes;
  const [sel, setSel] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusBox ? [focusBox] : []));
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => items.map((i) => ({ id: i.id, toSend: i.qty_approved ?? i.qty_requested })), [items]);
  const list = useMemo(() => data?.boxes ?? [], [data]);
  const dist = useMemo(() => distribution(lines, list), [lines, list]);
  const canEdit = Boolean(data?.can_edit);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // La selección se limpia sola: si otra persona ya empacó algo, no se puede pasar de lo que queda.
  const selection = useMemo(() => (canEdit ? clampSelection(sel, dist.unboxed) : {}), [sel, dist.unboxed, canEdit]);
  const selCount = Object.keys(selection).length;
  const selUnits = Object.values(selection).reduce((s, q) => s + q, 0);
  useEffect(() => { onSelecting?.(selCount > 0); }, [selCount, onSelecting]);
  useEffect(() => () => onSelecting?.(false), [onSelecting]);

  const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const pending = items.filter((i) => (dist.unboxed.get(i.id) ?? 0) > 0);
  const shownPending = words.length ? pending.filter((i) => { const h = fold(`${i.name} ${i.sku ?? ""}`); return words.every((w) => h.includes(w)); }) : pending;
  const allShownSelected = shownPending.length > 0 && shownPending.every((i) => selection[i.id]);

  async function call(fn: string, args: Record<string, unknown>, okText?: string) {
    // Botones bloqueados mientras guarda; si igual llega un doble toque, la llave evita repetirlo en la base.
    if (busy) return null;
    setBusy(true);
    try {
      const { data: res, error: e } = await supabaseBrowser().rpc(fn, args);
      if (e) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: errText(e) }); return null; }
      await reload();
      if (okText) void Swal.fire({ ...swal, toast: true, position: "top", timer: 1800, showConfirmButton: false, icon: "success", title: okText });
      return res as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSel((cur) => {
      const next = { ...cur };
      if (next[id]) delete next[id];
      else next[id] = dist.unboxed.get(id) ?? 1;
      return next;
    });
  }
  function selectShown() {
    setSel((cur) => {
      const next = { ...cur };
      if (allShownSelected) for (const i of shownPending) delete next[i.id];
      else for (const i of shownPending) next[i.id] = dist.unboxed.get(i.id) ?? 1;
      return next;
    });
  }
  const setQty = (id: string, q: number) => setSel((cur) => ({ ...cur, [id]: Math.max(1, Math.min(dist.unboxed.get(id) ?? 1, Math.floor(q) || 1)) }));

  async function saveTo(boxId: string | null, extra?: { name: string; color: string | null; notes: string; fragile: boolean }) {
    const payload = Object.entries(selection).map(([item_id, qty]) => ({ item_id, qty }));
    if (!payload.length) return;
    const res = await call("erp_sr_box_put", { p_request: request.id, p_box: boxId, p_items: payload, p_new: boxId ? null : extra ?? null, p_key: newKey() });
    if (!res) return;
    setSel({});
    setSheet(null);
    const id = String(res.box_id ?? "");
    if (id) setExpanded((cur) => new Set(cur).add(id));
    void Swal.fire({ ...swal, toast: true, position: "top", timer: 2200, showConfirmButton: false, icon: "success", title: `📦 Guardado en la Caja ${res.number}`, text: `${payload.length} ref. · ${selUnits} und.` });
  }

  async function takeOut(b: SrBox, itemId: string, have: number) {
    const it = itemById.get(itemId);
    let qty = have;
    if (have > 1) {
      const r = await Swal.fire({ ...swal, title: `Sacar de la ${boxTitle(b)}`, text: `${it?.name ?? "Producto"}: hay ${have}. ¿Cuántas sacas? Vuelven a «sin caja».`, input: "number", inputValue: String(have),
        inputAttributes: { min: "1", max: String(have), step: "1" }, showCancelButton: true, confirmButtonText: "Sacar", cancelButtonText: "Cancelar",
        inputValidator: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= have ? null : `Entre 1 y ${have}`) });
      if (!r.isConfirmed) return;
      qty = Number(r.value);
    }
    await call("erp_sr_box_take", { p_box: b.id, p_items: [{ item_id: itemId, qty }], p_key: newKey() }, "Volvió a «sin caja»");
  }

  async function emptyBox(b: SrBox) {
    const r = await Swal.fire({ ...swal, icon: "question", title: `¿Vaciar la ${boxTitle(b)}?`, text: `Sus ${boxUnits(b)} und. vuelven a «sin caja». No se pierde nada del pedido.`, showCancelButton: true, confirmButtonText: "Vaciar", cancelButtonText: "Cancelar" });
    if (r.isConfirmed) await call("erp_sr_box_take", { p_box: b.id, p_items: null, p_key: newKey() }, "Caja vacía");
  }
  async function deleteBox(b: SrBox) {
    const r = await Swal.fire({ ...swal, icon: "warning", title: `¿Borrar la ${boxTitle(b)}?`, text: "Está vacía. Las demás cajas conservan su número.", showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "Cancelar", confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) await call("erp_sr_box_delete", { p_box: b.id }, "Caja borrada");
  }
  async function closeBox(b: SrBox, close: boolean) {
    if (!close) {
      const r = await Swal.fire({ ...swal, icon: "question", title: `¿Abrir otra vez la ${boxTitle(b)}?`, text: "Queda en el chat quién la abrió.", showCancelButton: true, confirmButtonText: "Abrir", cancelButtonText: "Cancelar" });
      if (!r.isConfirmed) return;
    }
    await call("erp_sr_box_close", { p_box: b.id, p_close: close }, close ? `🔒 ${boxTitle(b)} cerrada` : `🔓 ${boxTitle(b)} abierta`);
  }

  if (error) return <p className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f59e0b", color: "#d97706" }}>⚠️ {error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl" style={{ background: "var(--t-card-bg)" }} />;

  const t = dist.totals;
  const pct = t.unitsToSend ? Math.round((t.unitsBoxed / t.unitsToSend) * 100) : 0;
  const allOpen = list.length > 0 && list.every((b) => expanded.has(b.id));

  return (
    <div className="space-y-3">
      {/* Resumen */}
      <div className="rounded-2xl border p-3" style={{ borderColor: t.unitsUnboxed === 0 && list.length ? "#22c55e" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <Package size={18} style={{ color: "var(--t-accent)" }} />
          <p className="min-w-0 flex-1 text-sm font-bold">
            {list.length} caja{list.length === 1 ? "" : "s"} · <span className="tabular-nums">{t.unitsBoxed}</span>/{t.unitsToSend} und. en cajas
          </p>
          {list.length ? (
            <button type="button" onClick={() => setExpanded(allOpen ? new Set() : new Set(list.map((b) => b.id)))} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>
              {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />} {allOpen ? "Contraer" : "Expandir"} todas
            </button>
          ) : null}
          <button type="button" onClick={() => setSheet({ kind: "print", boxIds: [] })} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: "var(--t-accent)" }}>
            <Printer size={13} /> Imprimir
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--t-card-border)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--t-accent), #22c55e)" }} />
        </div>
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--t-muted)" }}>
          {t.unitsUnboxed === 0
            ? list.length ? `✅ Todo está en cajas.${t.open ? ` Faltan por cerrar ${t.open} caja${t.open === 1 ? "" : "s"}.` : " Todas cerradas."}` : "Aún no hay cajas."
            : `Sin caja: ${t.refsUnboxed} ref. · ${t.unitsUnboxed} und.`}
          {" "}Las cajas no mueven inventario: sale al enviar el pedido, como siempre.
        </p>
        {dist.over.length ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-bold" style={{ background: "color-mix(in oklab, #f59e0b 14%, transparent)", color: "#d97706" }}>
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>Hay más en cajas que lo que se envía: {dist.over.map((o) => `${itemById.get(o.id)?.name ?? "Producto"} (${o.boxed} en cajas, se envían ${o.toSend})`).join(" · ")}. Saca lo que sobra o sube «Enviar».</span>
          </p>
        ) : null}
        {!canEdit ? <p className="mt-2 text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>👀 Solo ver: las cajas las arma quien despacha, antes de enviar.</p> : null}
      </div>

      {/* Cajas */}
      {list.map((b) => {
        const open = expanded.has(b.id);
        const color = boxColor(b);
        const units = boxUnits(b);
        return (
          <section key={b.id} className="overflow-hidden rounded-2xl border" style={{ borderColor: `color-mix(in oklab, ${color} 55%, var(--t-card-border))`, background: `color-mix(in oklab, ${color} 7%, var(--t-card-bg))` }}>
            <button type="button" onClick={() => setExpanded((cur) => { const n = new Set(cur); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}
              aria-expanded={open} className="flex w-full items-center gap-2.5 p-2.5 text-left">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow" style={{ background: color }}>
                <span className="text-center leading-none"><Package size={16} className="mx-auto" /><span className="block text-[11px] font-black">{b.number}</span></span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-black">{boxTitle(b).toUpperCase()}</span>
                  {b.status === "closed" ? <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-bold" style={{ background: "color-mix(in oklab, #22c55e 18%, transparent)", color: "#16a34a" }}><Lock size={10} /> Cerrada</span>
                    : <span className="rounded-full px-1.5 py-px text-[10px] font-bold" style={{ background: "color-mix(in oklab, #f59e0b 18%, transparent)", color: "#d97706" }}>Abierta</span>}
                  {b.fragile ? <span className="rounded-full px-1.5 py-px text-[10px] font-bold" style={{ background: "color-mix(in oklab, #ef4444 16%, transparent)", color: "#dc2626" }}>⚠️ Frágil</span> : null}
                </span>
                <span className="block truncate text-[11px]" style={{ color: "var(--t-muted)" }}>
                  {b.items.length} ref. · <b style={{ color: "var(--t-text)" }}>{units} und.</b>{b.seal ? ` · sello ${b.seal}` : ""}{b.weight_kg != null ? ` · ${String(b.weight_kg).replace(".", ",")} kg` : ""} · {b.status === "closed" ? `cerró ${b.closed_by_name ?? "—"}` : `armó ${b.created_by_name ?? "—"}`}
                </span>
              </span>
              <ChevronDown size={18} className="shrink-0 transition" style={{ transform: open ? "rotate(180deg)" : undefined }} />
            </button>
            {open ? (
              <div className="space-y-1.5 border-t px-2.5 pb-2.5 pt-2" style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--t-card-border))` }}>
                {b.notes ? <p className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "var(--t-card-bg)" }}>📝 {b.notes}</p> : null}
                {b.dims ? <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>📐 {b.dims}</p> : null}
                {!b.items.length ? <p className="py-2 text-center text-xs" style={{ color: "var(--t-muted)" }}>Caja vacía.</p> : null}
                {b.items.map((x) => {
                  const it = itemById.get(x.item_id);
                  if (!it) return null;
                  return (
                    <div key={x.item_id} className="flex items-center gap-2 rounded-xl border p-1.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                      <Thumb src={thumbs[it.product_id] ?? it.image_url} size={36} />
                      <span className="min-w-0 flex-1">
                        <ProductName name={it.name} className="text-[12px] font-bold leading-snug" expandable={false} />
                        <span className="block truncate text-[10px]" style={{ color: "var(--t-muted)" }}>{it.sku ?? "Sin código"} · {distributionText(dist.perItem.get(it.id) ?? [], dist.unboxed.get(it.id) ?? 0)}</span>
                      </span>
                      <span className="text-base font-black tabular-nums">{x.qty}</span>
                      {canEdit && b.status === "open" ? (
                        <span className="flex shrink-0 gap-1">
                          <IconBtn label="Mover a otra caja" onClick={() => setSheet({ kind: "move", box: b, itemId: x.item_id })} disabled={busy}><ArrowRightLeft size={14} /></IconBtn>
                          <IconBtn label="Sacar (vuelve a «sin caja»)" onClick={() => void takeOut(b, x.item_id, x.qty)} disabled={busy}><Minus size={14} /></IconBtn>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <SmallBtn onClick={() => setSheet({ kind: "print", boxIds: [b.id] })}><Printer size={13} /> Imprimir</SmallBtn>
                  {canEdit ? (
                    <>
                      <SmallBtn onClick={() => setSheet({ kind: "edit", box: b })} disabled={busy}><Pencil size={13} /> Nombre, color y datos</SmallBtn>
                      {b.status === "open"
                        ? <SmallBtn onClick={() => void closeBox(b, true)} disabled={busy || !b.items.length}><Lock size={13} /> Cerrar caja</SmallBtn>
                        : <SmallBtn onClick={() => void closeBox(b, false)} disabled={busy}><LockOpen size={13} /> Volver a abrir</SmallBtn>}
                      {b.status === "open" && b.items.length ? <SmallBtn onClick={() => void emptyBox(b)} disabled={busy}><PackageOpen size={13} /> Vaciar</SmallBtn> : null}
                      {!b.items.length ? <SmallBtn danger onClick={() => void deleteBox(b)} disabled={busy}><Trash2 size={13} /> Borrar</SmallBtn> : null}
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      {/* Sin caja */}
      <section className="rounded-2xl border p-2.5" style={{ borderColor: "var(--t-card-border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <PackagePlus size={17} style={{ color: "var(--t-muted)" }} />
          <p className="min-w-0 flex-1 text-sm font-black">SIN CAJA <span className="font-bold" style={{ color: "var(--t-muted)" }}>· {t.refsUnboxed} ref. · {t.unitsUnboxed} und.</span></p>
          {canEdit && shownPending.length ? (
            <button type="button" onClick={selectShown} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={allShownSelected ? { background: "var(--t-accent)", color: "#fff", borderColor: "var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
              {allShownSelected ? "Quitar selección" : `Elegir ${words.length ? "los que salen" : "todos"} (${shownPending.length})`}
            </button>
          ) : null}
        </div>
        {pending.length > 6 ? (
          <label className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: query ? "var(--t-accent)" : "var(--t-card-border)", background: "var(--t-card-bg)" }}>
            <Search size={14} style={{ color: "var(--t-muted)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" enterKeyHint="search" autoComplete="off" placeholder="Buscar en lo que falta (nombre o referencia)…"
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); if (e.key === "Escape") setQuery(""); }}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ padding: 0, border: 0, minHeight: 0 }} />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpiar"><X size={14} /></button> : null}
          </label>
        ) : null}
        <div className="mt-2 space-y-1.5">
          {!pending.length ? <p className="py-3 text-center text-sm" style={{ color: "var(--t-muted)" }}>{list.length ? "🎉 No queda nada sin caja." : "No hay productos para enviar."}</p> : null}
          {words.length && !shownPending.length ? <p className="py-2 text-center text-xs" style={{ color: "var(--t-muted)" }}>Nada coincide con «{query.trim()}».</p> : null}
          {shownPending.map((i) => {
            const left = dist.unboxed.get(i.id) ?? 0;
            const toSend = i.qty_approved ?? i.qty_requested;
            const q = selection[i.id];
            const parts = dist.perItem.get(i.id) ?? [];
            return (
              <div key={i.id} role={canEdit ? "button" : undefined} aria-pressed={canEdit ? Boolean(q) : undefined} onClick={canEdit ? () => toggle(i.id) : undefined}
                className={`flex items-center gap-2 rounded-xl border p-1.5 ${canEdit ? "cursor-pointer select-none" : ""}`}
                style={q ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                {canEdit ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2" aria-hidden
                    style={q ? { background: "var(--t-accent)", borderColor: "var(--t-accent)", color: "#fff" } : { borderColor: "var(--t-card-border)" }}>
                    {q ? <Check size={16} strokeWidth={3} /> : null}
                  </span>
                ) : null}
                <Thumb src={thumbs[i.product_id] ?? i.image_url} size={40} />
                <span className="min-w-0 flex-1">
                  <ProductName name={i.name} className="text-[12px] font-bold leading-snug sm:text-[13px]" expandable={false} />
                  <span className="block truncate text-[10px] sm:text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {i.sku ?? "Sin código"} · sin caja <b style={{ color: "var(--t-text)" }}>{left}</b> de {toSend}{parts.length ? ` · ${distributionText(parts, 0)}` : ""}
                  </span>
                </span>
                {q ? (
                  <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <IconBtn label="Una menos" onClick={() => setQty(i.id, q - 1)} disabled={q <= 1}><Minus size={14} /></IconBtn>
                    <input value={q} inputMode="numeric" aria-label={`Cuántas de ${i.name} van a la caja`} onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setQty(i.id, Number(e.target.value.replace(/\D/g, "")) || 1)}
                      className="h-8 w-12 rounded-lg border text-center text-sm font-black outline-none" style={{ borderColor: "var(--t-accent)", background: "var(--t-card-bg)", color: "var(--t-text)" }} />
                    <IconBtn label="Una más" onClick={() => setQty(i.id, q + 1)} disabled={q >= left}><Plus size={14} /></IconBtn>
                  </span>
                ) : <span className="shrink-0 text-sm font-black tabular-nums">{left}</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Barra flotante: solo con selección. Queda abajo aunque bajes por la lista. */}
      {selCount ? (
        <div className="sticky bottom-0 z-30 -mx-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="flex items-center gap-2 rounded-2xl border p-2 shadow-[0_14px_34px_-12px_rgba(0,0,0,.6)] backdrop-blur"
            style={{ borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-bg-base) 94%, transparent)" }}>
            <span className="min-w-0 flex-1 pl-1 text-sm font-black leading-tight">
              {selCount} producto{selCount === 1 ? "" : "s"}<span className="block text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>{selUnits} und. elegidas</span>
            </span>
            <button type="button" onClick={() => setSel({})} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Limpiar selección" title="Limpiar selección"><X size={16} /></button>
            <button type="button" onClick={() => setSheet({ kind: "save" })} disabled={busy}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), color-mix(in oklab, var(--t-accent) 70%, #000))" }}>
              <PackagePlus size={16} /> Guardar en caja
            </button>
          </div>
        </div>
      ) : null}

      {sheet?.kind === "save" ? (
        <SaveSheet boxes={list} selection={selection} itemById={itemById} busy={busy} onClose={() => setSheet(null)} onSave={(boxId, extra) => void saveTo(boxId, extra)} />
      ) : null}
      {sheet?.kind === "edit" ? (
        <EditSheet box={sheet.box} busy={busy} onClose={() => setSheet(null)}
          onSave={async (patch) => { const ok = await call("erp_sr_box_update", { p_box: sheet.box.id, p_patch: patch }, "Caja actualizada"); if (ok) setSheet(null); }} />
      ) : null}
      {sheet?.kind === "move" ? (() => {
        const have = sheet.box.items.find((x) => x.item_id === sheet.itemId)?.qty ?? 0;
        return (
          <MoveSheet from={sheet.box} item={itemById.get(sheet.itemId) ?? null} have={have} boxes={list.filter((b) => b.id !== sheet.box.id && b.status === "open")} busy={busy} onClose={() => setSheet(null)}
            onMove={async (to, qty) => { const ok = await call("erp_sr_box_move", { p_from: sheet.box.id, p_to: to, p_items: [{ item_id: sheet.itemId, qty }], p_key: newKey() }, "Movido"); if (ok) setSheet(null); }} />
        );
      })() : null}
      {sheet?.kind === "print" ? <PrintSheet request={request} boxes={list} preset={sheet.boxIds} hasUnboxed={t.unitsUnboxed > 0} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ piezas

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg)" }}>
      {children}
    </button>
  );
}
function SmallBtn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40"
      style={danger ? { borderColor: "color-mix(in oklab, #ef4444 45%, transparent)", color: "#ef4444" } : { borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
      {children}
    </button>
  );
}

const subscribeNoop = () => () => {};
/** Hoja inferior en el celular, ventana centrada en el computador. */
function SheetFrame({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-140 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <section className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[26px] border shadow-2xl sm:max-w-lg sm:rounded-[26px]"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--t-card-border)" }}>
          <h3 className="text-base font-black">{title}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer ? <footer className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" style={{ borderColor: "var(--t-card-border)" }}>{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

const fieldCls = "w-full rounded-xl border px-3 py-2 text-sm outline-none";
const fieldStyle = { borderColor: "var(--t-card-border)", background: "var(--t-card-bg)", color: "var(--t-text)" } as const;

function ColorPick({ value, onChange, auto }: { value: string | null; onChange: (c: string | null) => void; auto: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onChange(null)} className="h-8 rounded-full border px-2.5 text-[11px] font-bold" style={value === null ? { borderColor: "var(--t-accent)", boxShadow: "0 0 0 2px var(--t-accent)" } : { borderColor: "var(--t-card-border)" }}>
        <span className="mr-1 inline-block h-3 w-3 rounded-full align-middle" style={{ background: auto }} />Automático
      </button>
      {BOX_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Color ${c}`} className="h-8 w-8 rounded-full border-2" style={{ background: c, borderColor: value === c ? "var(--t-text)" : "transparent", boxShadow: value === c ? "0 0 0 2px var(--t-bg-base) inset" : undefined }} />
      ))}
      <input type="color" value={value ?? auto} onChange={(e) => onChange(e.target.value)} aria-label="Otro color" className="h-8 w-10 cursor-pointer rounded-lg border bg-transparent" style={{ borderColor: "var(--t-card-border)" }} />
    </div>
  );
}

function SaveSheet({ boxes, selection, itemById, busy, onClose, onSave }: {
  boxes: SrBox[]; selection: Record<string, number>; itemById: Map<string, SrItem>; busy: boolean; onClose: () => void;
  onSave: (boxId: string | null, extra?: { name: string; color: string | null; notes: string; fragile: boolean }) => void;
}) {
  const open = boxes.filter((b) => b.status === "open");
  const nextNumber = (boxes.reduce((m, b) => Math.max(m, b.number), 0) || 0) + 1;
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [fragile, setFragile] = useState(false);
  const entries = Object.entries(selection);
  const units = entries.reduce((s, [, q]) => s + q, 0);
  const auto = boxColor({ number: nextNumber, color: null });
  return (
    <SheetFrame title="📦 Guardar en caja" onClose={onClose}
      footer={
        <button type="button" disabled={busy || !entries.length} onClick={() => onSave(target === "new" ? null : target, target === "new" ? { name, color, notes, fragile } : undefined)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-black text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, var(--t-accent), color-mix(in oklab, var(--t-accent) 70%, #000))" }}>
          {busy ? "Guardando…" : target === "new" ? `Crear Caja ${nextNumber} · ${units} und.` : `Agregar a la ${boxTitle(open.find((b) => b.id === target) ?? { number: 0, name: null })} · ${units} und.`}
        </button>
      }>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>¿En qué caja?</p>
      <div className="mt-1.5 grid gap-1.5">
        <button type="button" onClick={() => setTarget("new")} className="flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-bold" style={target === "new" ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
          <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ background: color ?? auto }}><Plus size={16} /></span> Nueva caja (Caja {nextNumber})
        </button>
        {open.map((b) => (
          <button key={b.id} type="button" onClick={() => setTarget(b.id)} className="flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-bold" style={target === b.id ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-black text-white" style={{ background: boxColor(b) }}>{b.number}</span>
            <span className="min-w-0 flex-1 truncate">{boxTitle(b)}</span>
            <span className="text-[11px] font-semibold" style={{ color: "var(--t-muted)" }}>{b.items.length} ref. · {boxUnits(b)} und.</span>
          </button>
        ))}
      </div>
      {target === "new" ? (
        <div className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={`Nombre (opcional): ej. Frágiles, Ollas…`} className={fieldCls} style={fieldStyle} />
          <ColorPick value={color} onChange={setColor} auto={auto} />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} placeholder="Observaciones (opcional)" rows={2} className={fieldCls} style={fieldStyle} />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} /> ⚠️ Frágil</label>
        </div>
      ) : null}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Va en la caja · {entries.length} ref. · {units} und.</p>
      <ul className="mt-1 divide-y text-sm" style={{ borderColor: "var(--t-card-border)" }}>
        {entries.map(([id, q]) => <li key={id} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{itemById.get(id)?.name ?? "Producto"}</span><b className="tabular-nums">{q}</b></li>)}
      </ul>
    </SheetFrame>
  );
}

function EditSheet({ box, busy, onClose, onSave }: { box: SrBox; busy: boolean; onClose: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [name, setName] = useState(box.name ?? "");
  const [color, setColor] = useState<string | null>(box.color);
  const [notes, setNotes] = useState(box.notes ?? "");
  const [fragile, setFragile] = useState(box.fragile);
  const [weight, setWeight] = useState(box.weight_kg != null ? String(box.weight_kg) : "");
  const [dims, setDims] = useState(box.dims ?? "");
  const [seal, setSeal] = useState(box.seal ?? "");
  const weightOk = !weight.trim() || /^\d{1,5}([.,]\d{1,2})?$/.test(weight.trim());
  return (
    <SheetFrame title={`✏️ Caja ${box.number}`} onClose={onClose}
      footer={<button type="button" disabled={busy || !weightOk} onClick={() => onSave({ name, color, notes, fragile, weight_kg: weight.trim().replace(",", "."), dims, seal })}
        className="h-12 w-full rounded-2xl text-base font-black text-white disabled:opacity-60" style={{ background: "var(--t-accent)" }}>{busy ? "Guardando…" : "Guardar"}</button>}>
      <div className="space-y-2.5">
        <label className="block text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Nombre<input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Opcional" className={`${fieldCls} mt-0.5`} style={fieldStyle} /></label>
        <div className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Color<div className="mt-1"><ColorPick value={color} onChange={setColor} auto={boxColor({ number: box.number, color: null })} /></div></div>
        <label className="block text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Observaciones<textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} rows={2} className={`${fieldCls} mt-0.5`} style={fieldStyle} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-bold" style={{ color: weightOk ? "var(--t-muted)" : "#ef4444" }}>Peso (kg)<input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" placeholder="Ej. 4,5" className={`${fieldCls} mt-0.5`} style={fieldStyle} /></label>
          <label className="block text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Medidas<input value={dims} onChange={(e) => setDims(e.target.value.slice(0, 60))} placeholder="Ej. 40×30×30 cm" className={`${fieldCls} mt-0.5`} style={fieldStyle} /></label>
        </div>
        <label className="block text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Sello o precinto<input value={seal} onChange={(e) => setSeal(e.target.value.slice(0, 60))} placeholder="Opcional" className={`${fieldCls} mt-0.5`} style={fieldStyle} /></label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} /> ⚠️ Frágil</label>
      </div>
    </SheetFrame>
  );
}

function MoveSheet({ from, item, have, boxes, busy, onClose, onMove }: {
  from: SrBox; item: SrItem | null; have: number; boxes: SrBox[]; busy: boolean; onClose: () => void; onMove: (to: string | null, qty: number) => void;
}) {
  const [qty, setQty] = useState(have);
  const [to, setTo] = useState<string>(boxes[0]?.id ?? "new");
  const q = Math.max(1, Math.min(have, Math.floor(qty) || 1));
  return (
    <SheetFrame title="↔️ Mover a otra caja" onClose={onClose}
      footer={<button type="button" disabled={busy} onClick={() => onMove(to === "new" ? null : to, q)} className="h-12 w-full rounded-2xl text-base font-black text-white disabled:opacity-60" style={{ background: "var(--t-accent)" }}>{busy ? "Moviendo…" : `Mover ${q} und.`}</button>}>
      <p className="text-sm font-bold">{item?.name ?? "Producto"}</p>
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Hay {have} en la {boxTitle(from)}.</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] font-bold" style={{ color: "var(--t-muted)" }}>Cuántas</span>
        <button type="button" onClick={() => setQty(q - 1)} disabled={q <= 1} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una menos"><Minus size={14} /></button>
        <input value={q} inputMode="numeric" onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, "")) || 1)} className="h-9 w-16 rounded-lg border text-center font-black" style={fieldStyle} aria-label="Cuántas mover" />
        <button type="button" onClick={() => setQty(q + 1)} disabled={q >= have} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40" style={{ borderColor: "var(--t-card-border)" }} aria-label="Una más"><Plus size={14} /></button>
        <button type="button" onClick={() => setQty(have)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Todas</button>
      </div>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>A la caja</p>
      <div className="mt-1 grid gap-1.5">
        {boxes.map((b) => (
          <button key={b.id} type="button" onClick={() => setTo(b.id)} className="flex items-center gap-2 rounded-xl border p-2 text-left text-sm font-bold" style={to === b.id ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
            <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-black text-white" style={{ background: boxColor(b) }}>{b.number}</span> {boxTitle(b)}
          </button>
        ))}
        <button type="button" onClick={() => setTo("new")} className="flex items-center gap-2 rounded-xl border p-2 text-left text-sm font-bold" style={to === "new" ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
          <span className="grid h-7 w-7 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }}><Plus size={14} /></span> Una caja nueva
        </button>
      </div>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ imprimir

export type BoxPrintWhat = "todo" | "cajas" | "sin-caja" | "consolidado" | "etiquetas";
const PRINT_PREFS = "remhub:cajas:imprimir";
type PrintPrefs = { formato: "carta" | "pos80" | "pos58"; fotos: boolean; qr: boolean; pagina: boolean; firmas: boolean };
const DEFAULT_PREFS: PrintPrefs = { formato: "carta", fotos: true, qr: true, pagina: false, firmas: true };
function loadPrefs(): PrintPrefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(window.localStorage.getItem(PRINT_PREFS) ?? "{}") as Partial<PrintPrefs>) }; } catch { return DEFAULT_PREFS; }
}

function PrintSheet({ request, boxes, preset, hasUnboxed, onClose }: { request: SrDetail["request"]; boxes: SrBox[]; preset: string[]; hasUnboxed: boolean; onClose: () => void }) {
  const [what, setWhat] = useState<BoxPrintWhat>(preset.length ? "cajas" : boxes.length ? "todo" : "sin-caja");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(preset.length ? preset : boxes.map((b) => b.id)));
  const [prefs, setPrefs] = useState<PrintPrefs>(loadPrefs);
  const set = (p: Partial<PrintPrefs>) => setPrefs((cur) => { const n = { ...cur, ...p }; try { window.localStorage.setItem(PRINT_PREFS, JSON.stringify(n)); } catch { /* sin almacenamiento */ } return n; });
  const needsBoxes = what === "cajas" || what === "etiquetas";
  const options: Array<{ id: BoxPrintWhat; label: string; hint: string; off?: boolean }> = [
    { id: "todo", label: "Cajas y lo que falta", hint: "Cada caja con su contenido y, al final, lo que va sin caja.", off: !boxes.length && !hasUnboxed },
    { id: "cajas", label: "Solo cajas", hint: "Todas o las que elijas.", off: !boxes.length },
    { id: "sin-caja", label: "Lo que va sin caja", hint: "Lo que falta por empacar.", off: !hasUnboxed },
    { id: "consolidado", label: "Consolidado", hint: "Total por producto, sin importar la caja." },
    { id: "etiquetas", label: "Etiquetas de caja (QR)", hint: "Para pegar afuera: número, pedido, origen, destino y QR.", off: !boxes.length },
  ];
  function go() {
    const u = new URLSearchParams({ que: what, formato: prefs.formato, fotos: prefs.fotos ? "1" : "0", qr: prefs.qr ? "1" : "0", pagina: prefs.pagina ? "1" : "0", firmas: prefs.firmas ? "1" : "0", auto: "1" });
    if (needsBoxes && chosen.size !== boxes.length) u.set("cajas", boxes.filter((b) => chosen.has(b.id)).map((b) => b.number).join(","));
    window.open(`/documento/pedido-interno/${request.id}/cajas?${u.toString()}`, "_blank", "noopener");
    onClose();
  }
  const seg = (on: boolean) => (on ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" } : { borderColor: "var(--t-card-border)" });
  return (
    <SheetFrame title={`🖨️ Imprimir · Pedido #${request.number}`} onClose={onClose}
      footer={<button type="button" onClick={go} disabled={needsBoxes && !chosen.size} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-black text-white disabled:opacity-60" style={{ background: "var(--t-accent)" }}><Printer size={18} /> Abrir para imprimir</button>}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>¿Qué imprimes?</p>
      <div className="mt-1 grid gap-1.5">
        {options.map((o) => (
          <button key={o.id} type="button" disabled={o.off} onClick={() => setWhat(o.id)} className="rounded-xl border p-2.5 text-left disabled:opacity-40" style={seg(what === o.id)}>
            <span className="block text-sm font-bold">{o.label}</span><span className="block text-[11px]" style={{ color: "var(--t-muted)" }}>{o.hint}</span>
          </button>
        ))}
      </div>
      {needsBoxes && boxes.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {boxes.map((b) => {
            const on = chosen.has(b.id);
            return (
              <button key={b.id} type="button" onClick={() => setChosen((cur) => { const n = new Set(cur); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold" style={seg(on)}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: boxColor(b) }} /> Caja {b.number}{on ? " ✓" : ""}
              </button>
            );
          })}
          <button type="button" onClick={() => setChosen(chosen.size === boxes.length ? new Set() : new Set(boxes.map((b) => b.id)))} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>
            {chosen.size === boxes.length ? "Ninguna" : "Todas"}
          </button>
        </div>
      ) : null}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Papel</p>
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {([["carta", "Carta"], ["pos80", "Tirilla 80 mm"], ["pos58", "Tirilla 58 mm"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => set({ formato: k })} className="rounded-xl border px-2 py-2 text-xs font-bold" style={seg(prefs.formato === k)}>{l}</button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs font-semibold">
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.qr} onChange={(e) => set({ qr: e.target.checked })} /> QR de cada caja</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.fotos} onChange={(e) => set({ fotos: e.target.checked })} disabled={prefs.formato !== "carta"} /> Fotos (carta)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.pagina} onChange={(e) => set({ pagina: e.target.checked })} /> Una página por caja</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.firmas} onChange={(e) => set({ firmas: e.target.checked })} /> Espacio para firmas</label>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: "var(--t-muted)" }}>Se recuerda en este equipo. Sin costos ni precios: es un documento para mover mercancía.</p>
    </SheetFrame>
  );
}
