"use client";

import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProductPicker, ProductSearchModal, Thumb, useThumbs } from "./LineEditor";
import { Btn, errorMessage, toast, type ProductHit } from "./shared";
import { friendlyStockError } from "@/lib/stock/live-stock";

/**
 * Corregir un traslado en tránsito antes de que lo revisen (20261217): cantidades, quitar y agregar productos.
 * La bodega de origen se ajusta solo por la diferencia; si estaba firmado «Preparado», esa firma se quita.
 */

type Item = { product_id: string; name: string; sku?: string | null; qty: number; original: number };

export function TransferEditor({ transferId, storeId, fromId, fromName, number, items, packedSigned, onClose, onSaved }: {
  transferId: string; storeId: string; fromId: string; fromName?: string; number: number;
  items: Array<{ product_id: string; name: string; sku?: string | null; qty: number }>;
  packedSigned: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [lines, setLines] = useState<Item[]>(() => items.map((i) => ({ ...i, original: i.qty })));
  const [extra, setExtra] = useState<Record<string, number>>({});   // disponibles en origen de productos nuevos
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [q, setQ] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const focusId = useRef<string | null>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const thumbs = useThumbs(lines.map((l) => l.product_id));

  const setQty = (id: string, qty: number) => setLines((cur) => cur.map((l) => (l.product_id === id ? { ...l, qty: Math.max(0, Math.floor(qty || 0)) } : l)));
  function add(hit: ProductHit) {
    setExtra((cur) => ({ ...cur, [hit.id]: hit.wh_qty }));
    const existing = lines.find((l) => l.product_id === hit.id);
    if (existing) {
      // Ya está: no se duplica. Si estaba quitado se vuelve a poner; el cursor va a su cantidad para escribir el total.
      if (existing.qty === 0) setQty(hit.id, existing.original || 1);
      void toast(`«${hit.name}» ya está en el traslado`, "success", existing.qty ? `Tiene ${existing.qty}. Escribe la cantidad total que debe ir.` : "Lo volvimos a poner; escribe la cantidad.");
      setQ("");
    } else {
      setLines((cur) => [{ product_id: hit.id, name: hit.name, sku: hit.sku, qty: 1, original: 0 }, ...cur]);
    }
    focusId.current = hit.id;
    setFlashId(hit.id);
    setFocusTick((n) => n + 1);
    window.setTimeout(() => setFlashId((cur) => (cur === hit.id ? null : cur)), 1800);
  }
  // El producto (nuevo o el que ya estaba) queda con el cursor en su cantidad, a la vista.
  useEffect(() => {
    if (!focusId.current) return;
    const el = qtyRefs.current.get(focusId.current);
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: "center", behavior: "smooth" }); focusId.current = null; }
  }, [lines, focusTick]);
  // F2: agregar otro producto. Ctrl + Enter: guardar la corrección.
  const saveRef = useRef<() => void>(() => {});
  const reasonRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); setModal(true); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changed = lines.some((l) => l.qty !== l.original);
  const diffs = lines.filter((l) => l.qty !== l.original);
  const added = diffs.filter((l) => l.original === 0 && l.qty > 0).length;
  const removed = diffs.filter((l) => l.original > 0 && l.qty === 0).length;
  const edited = diffs.length - added - removed;
  const addedQty = Object.fromEntries(lines.map((l) => [l.product_id, l.qty]));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const shown = q.trim() ? lines.filter((l) => fold(`${l.name} ${l.sku ?? ""}`).includes(fold(q.trim()))) : lines;

  async function save() {
    if (!changed) return onClose();
    if (!lines.some((l) => l.qty > 0)) return void toast("El traslado debe tener al menos un producto", "warning", "Para quitarlo todo, anúlalo.");
    if (reason.trim().length < 3) { reasonRef.current?.focus(); return void toast("Escribe el motivo del cambio", "warning", "Está en la barra de abajo."); }
    const diff = lines.filter((l) => l.qty !== l.original).map((l) => `${l.name}: ${l.original} → ${l.qty}`).join("<br>");
    const ok = await Swal.fire({
      icon: "question", title: `Corregir traslado #${number}`,
      html: `<div style="text-align:left;font-size:13px">${diff}</div>${packedSigned ? "<p style='margin-top:10px;font-size:12px;opacity:.8'>La firma de «Preparado» se quitará: quien prepara debe volver a firmar.</p>" : ""}`,
      showCancelButton: true, confirmButtonText: "Guardar corrección", cancelButtonText: "Volver",
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
    });
    if (!ok.isConfirmed) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("erp_transfer_update_items", {
      p_transfer: transferId, p_items: lines.filter((l) => l.qty > 0).map((l) => ({ product_id: l.product_id, qty: l.qty })), p_reason: reason.trim(),
    });
    setBusy(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) {
      const msg = error && /erp_transfer_update_items|Could not find/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261217_editar_traslado.sql." : friendlyStockError(r?.error ?? errorMessage(error)) ?? r?.error ?? errorMessage(error);
      return void toast("No se pudo corregir", "error", msg);
    }
    void toast(`Traslado #${number} corregido`, "success", packedSigned ? "Vuelve a firmar «Preparado»." : undefined);
    onSaved();
  }

  useEffect(() => { saveRef.current = () => void save(); });
  const box = { borderColor: "var(--t-card-border)" };
  return (
    <div className="mt-3 space-y-3 rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black">✏️ Corregir productos del traslado #{number}</p>
          <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Cambia cantidades con − / + o escribiéndolas, quita lo que sobra o agrega lo que faltó.</p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={box}>{lines.filter((l) => l.qty > 0).length} productos · {units} unidades</span>
      </div>

      {/* Agregar: buscador directo o ventana con fotos (F2). */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <ProductPicker storeId={storeId} warehouseId={fromId} inStockOnly inputRef={searchRef} addedQty={addedQty}
            placeholder={`➕ Escribe para agregar un producto de ${fromName ?? "la bodega de origen"}…`} onPick={add} />
        </div>
        <Btn onClick={() => setModal(true)}><span title="Atajo: F2">➕ Agregar producto (F2)</span></Btn>
      </div>
      <ProductSearchModal open={modal} onClose={() => setModal(false)} storeId={storeId} warehouseId={fromId} inStockOnly
        addedQty={addedQty} title={`Agregar al traslado #${number}`} onPick={(hit) => { setModal(false); add(hit); }} />

      {lines.length > 8 ? (
        <input className="w-full rounded-xl border bg-transparent px-3 py-2 text-xs outline-none" style={{ ...box, color: "var(--t-text)" }}
          value={q} onChange={(e) => setQ(e.target.value)} placeholder={`🔍 Buscar dentro de este traslado (${lines.length} productos)`} aria-label="Buscar en el traslado" />
      ) : null}

      <ul className="space-y-1.5">
        {shown.map((l) => {
          const isNew = l.original === 0;
          const edited = l.qty !== l.original;
          return (
            <li key={l.product_id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 sm:flex-nowrap"
              style={{ ...box, opacity: l.qty === 0 ? 0.5 : 1, transition: "background .4s, box-shadow .4s",
                background: flashId === l.product_id ? "color-mix(in oklab, #22c55e 18%, transparent)" : edited ? "color-mix(in oklab, var(--t-accent) 8%, transparent)" : undefined,
                boxShadow: flashId === l.product_id ? "0 0 0 2px #22c55e" : undefined }}>
              <Thumb src={thumbs[l.product_id]} size={44} />
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-bold" title={l.name}>{l.name}</p>
                <p className="truncate text-[11px]" style={{ color: edited ? "var(--t-accent)" : "var(--t-muted)" }}>
                  {l.sku ? `${l.sku} · ` : ""}
                  {isNew ? `Nuevo en el traslado${extra[l.product_id] !== undefined ? ` · hay ${extra[l.product_id]} en origen` : ""}`
                    : l.qty === 0 ? `Se quita (tenía ${l.original})`
                    : edited ? `Antes ${l.original} → ahora ${l.qty}` : `Enviadas ${l.original}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)} className="grid h-9 w-9 place-items-center rounded-lg border text-lg" style={box} aria-label={`Menos ${l.name}`}>−</button>
                <input
                  ref={(el) => { if (el) qtyRefs.current.set(l.product_id, el); else qtyRefs.current.delete(l.product_id); }}
                  className="h-9 rounded-lg border bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                  style={{ ...box, width: 72, color: "var(--t-text)" }}
                  inputMode="numeric" value={l.qty} onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setQty(l.product_id, Number(e.target.value.replace(/\D/g, "")))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchRef.current?.focus(); } }}
                  aria-label={`Cantidad de ${l.name}`}
                />
                <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)} className="grid h-9 w-9 place-items-center rounded-lg border text-lg" style={box} aria-label={`Más ${l.name}`}>+</button>
                {l.qty > 0 ? (
                  <button type="button" onClick={() => setQty(l.product_id, 0)} className="rounded-lg px-2 py-1 text-xs font-semibold" style={{ color: "#ef4444" }}>Quitar</button>
                ) : (
                  <button type="button" onClick={() => setQty(l.product_id, l.original || 1)} className="rounded-lg px-2 py-1 text-xs font-semibold" style={{ color: "var(--t-accent)" }}>Volver a poner</button>
                )}
              </div>
            </li>
          );
        })}
        {q && !shown.length ? <li className="text-xs" style={{ color: "var(--t-muted)" }}>Ningún producto del traslado coincide.</li> : null}
      </ul>

      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>La bodega de origen se ajusta sola por la diferencia. Cuando alguien firme «Revisado», el traslado ya no se podrá cambiar.</p>

      {/* Barra fija: motivo y guardar siempre a la vista, sin bajar hasta el final de la lista. */}
      <div className="sticky bottom-2 z-20 -mx-1 rounded-2xl border p-2.5 shadow-2xl backdrop-blur-xl sm:bottom-3"
        style={{ borderColor: changed ? "color-mix(in oklab, var(--t-accent) 55%, var(--t-card-border))" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-bg-base) 90%, transparent)" }}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <p className="shrink-0 text-xs font-semibold lg:w-56" style={{ color: changed ? "var(--t-text)" : "var(--t-muted)" }}>
            {changed ? (
              <>✏️ {[edited ? `${edited} cambiado(s)` : "", added ? `${added} nuevo(s)` : "", removed ? `${removed} quitado(s)` : ""].filter(Boolean).join(" · ")}
                <span className="block font-normal" style={{ color: "var(--t-muted)" }}>{units} unidades en total</span></>
            ) : "Sin cambios todavía"}
          </p>
          <input ref={reasonRef} className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none" style={{ ...box, color: "var(--t-text)" }}
            placeholder="Motivo del cambio * (ej: se contó mal, faltó un producto)" value={reason} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} aria-label="Motivo del cambio" />
          <div className="flex shrink-0 gap-2">
            <Btn onClick={() => void save()} disabled={busy || !changed}><span title="Atajo: Ctrl + Enter">{busy ? "Guardando…" : "💾 Guardar corrección"}</span></Btn>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
