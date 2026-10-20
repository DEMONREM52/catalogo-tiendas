"use client";

import { useState } from "react";
import Swal from "sweetalert2";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ProductPicker } from "./LineEditor";
import { Btn, errorMessage, inputClass, inputStyle, toast, type ProductHit } from "./shared";

/**
 * Corregir un traslado en tránsito antes de que lo revisen (20261217): cantidades, quitar y agregar productos.
 * La bodega de origen se ajusta solo por la diferencia; si estaba firmado «Preparado», esa firma se quita.
 */

type Item = { product_id: string; name: string; qty: number; original: number };

export function TransferEditor({ transferId, storeId, fromId, number, items, packedSigned, onClose, onSaved }: {
  transferId: string; storeId: string; fromId: string; number: number;
  items: Array<{ product_id: string; name: string; qty: number }>;
  packedSigned: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [lines, setLines] = useState<Item[]>(() => items.map((i) => ({ ...i, original: i.qty })));
  const [extra, setExtra] = useState<Record<string, number>>({});   // disponibles en origen de productos nuevos
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const setQty = (id: string, qty: number) => setLines((cur) => cur.map((l) => (l.product_id === id ? { ...l, qty: Math.max(0, Math.floor(qty || 0)) } : l)));
  function add(hit: ProductHit) {
    setExtra((cur) => ({ ...cur, [hit.id]: hit.wh_qty }));
    setLines((cur) => (cur.some((l) => l.product_id === hit.id) ? cur : [...cur, { product_id: hit.id, name: hit.name, qty: 1, original: 0 }]));
  }
  const changed = lines.some((l) => l.qty !== l.original);
  const units = lines.reduce((s, l) => s + l.qty, 0);

  async function save() {
    if (!changed) return onClose();
    if (!lines.some((l) => l.qty > 0)) return void toast("El traslado debe tener al menos un producto", "warning", "Para quitarlo todo, anúlalo.");
    if (reason.trim().length < 3) return void toast("Escribe el motivo del cambio", "warning");
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
      const msg = error && /erp_transfer_update_items|Could not find/i.test(error.message) ? "Falta ejecutar en Supabase la migración 20261217_editar_traslado.sql." : r?.error ?? errorMessage(error);
      return void toast("No se pudo corregir", "error", msg);
    }
    void toast(`Traslado #${number} corregido`, "success", packedSigned ? "Vuelve a firmar «Preparado»." : undefined);
    onSaved();
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, var(--t-card-border))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">✏️ Corregir productos del traslado</p>
        <span className="text-xs" style={{ color: "var(--t-muted)" }}>{lines.filter((l) => l.qty > 0).length} productos · {units} unidades</span>
      </div>
      <ProductPicker storeId={storeId} warehouseId={fromId} inStockOnly excludeIds={lines.map((l) => l.product_id)} placeholder="➕ Agregar otro producto de la bodega de origen…" onPick={add} />
      <ul className="space-y-1.5">
        {lines.map((l) => (
          <li key={l.product_id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--t-card-border)", opacity: l.qty === 0 ? 0.55 : 1 }}>
            <span className="min-w-0 flex-1 truncate">
              <b>{l.name}</b>
              <span className="ml-2 text-[11px]" style={{ color: l.qty !== l.original ? "var(--t-accent)" : "var(--t-muted)" }}>
                {l.original === 0 ? `nuevo${extra[l.product_id] !== undefined ? ` · hay ${extra[l.product_id]}` : ""}` : l.qty === l.original ? `enviadas ${l.original}` : `antes ${l.original}`}
                {l.qty === 0 ? " · se quita" : ""}
              </span>
            </span>
            <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Menos">−</button>
            <input className={`${inputClass} w-16 text-center`} style={inputStyle} inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.product_id, Number(e.target.value.replace(/\D/g, "")))} aria-label={`Cantidad de ${l.name}`} />
            <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Más">+</button>
            <button type="button" onClick={() => setQty(l.product_id, 0)} className="rounded-lg px-2 py-1 text-xs" style={{ color: "#ef4444" }} aria-label={`Quitar ${l.name}`}>Quitar</button>
          </li>
        ))}
      </ul>
      <input className={inputClass} style={inputStyle} placeholder="Motivo del cambio * (ej: se contó mal, faltó un producto)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>La bodega de origen se ajusta sola por la diferencia. Cuando alguien firme «Revisado», el traslado ya no se podrá cambiar.</p>
      <div className="flex gap-2">
        <Btn onClick={() => void save()} disabled={busy || !changed}>{busy ? "Guardando…" : "💾 Guardar corrección"}</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
      </div>
    </div>
  );
}
