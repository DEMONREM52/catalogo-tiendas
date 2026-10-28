"use client";

import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Sheet } from "@/components/forms/Sheet";
import { ChoiceChips } from "@/components/forms/Fields";
import { esc, swalTheme } from "../rentabilidad/shared";

/**
 * Eliminar productos que no se han vendido (20261260 y 20261263). Solo bloquean las ventas (pedidos, POS, facturas, vales);
 * el resto del historial (kardex, compras, traslados, unidades…) se borra con el producto. Lo vendido se inactiva.
 */

type Check = { ok: boolean; error?: string; name?: string; can_delete?: boolean; reasons?: Array<{ table: string; label: string }>; units?: number; will_delete?: Array<{ table: string; label: string }> };
type Unused = { id: string; name: string; sku: string | null; image_url: string | null; active: boolean; created_at: string; units?: number };

const REASONS = ["Lo creé mal", "Está duplicado", "Ya no lo vendo", "Producto de prueba"];

function dbError(e: { message?: string } | null | undefined) {
  const msg = e?.message ?? "No se pudo.";
  return /Could not find the function|schema cache/i.test(msg) ? "Falta ejecutar en Supabase la migración 20261260_eliminar_productos.sql." : msg;
}

/** Pide el motivo con opciones rápidas. Devuelve el motivo o null. */
async function askReason(title: string, html: string, confirm: string) {
  const r = await Swal.fire({
    ...swalTheme, icon: "warning", title, confirmButtonText: confirm, cancelButtonText: "Cancelar", showCancelButton: true, confirmButtonColor: "#ef4444", reverseButtons: true,
    html: `${html}<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px">${REASONS.map((t) => `<button type="button" class="swal2-styled rh-del-reason" data-r="${t}" style="margin:0;background:transparent;border:1px solid rgba(150,150,150,.4);color:inherit;font-size:12px;padding:6px 12px;border-radius:999px">${t}</button>`).join("")}</div>`,
    input: "text", inputPlaceholder: "Motivo",
    didOpen: () => document.querySelectorAll<HTMLButtonElement>(".rh-del-reason").forEach((b) => (b.onclick = () => { const i = Swal.getInput(); if (i) i.value = b.dataset.r ?? ""; })),
    inputValidator: (v) => (v.trim().length < 3 ? "Escribe o elige un motivo" : null),
  });
  return r.isConfirmed ? String(r.value).trim() : null;
}

/**
 * Eliminar un producto desde la lista. Si tiene historial, explica por qué no y ofrece inactivarlo.
 * Devuelve "deleted", "inactivate" (la persona eligió inactivarlo) o null.
 */
export async function deleteProductFlow(p: { id: string; name: string; active: boolean }): Promise<"deleted" | "inactivate" | null> {
  const sb = supabaseBrowser();
  const { data, error } = await sb.rpc("erp_product_delete_check", { p_product: p.id });
  const c = data as Check | null;
  if (error || !c?.ok) {
    await Swal.fire({ ...swalTheme, icon: "error", title: "No se pudo revisar", text: error ? dbError(error) : c?.error });
    return null;
  }
  if (!c.can_delete) {
    const r = await Swal.fire({
      ...swalTheme, icon: "info", title: `«${esc(p.name)}» no se puede eliminar`,
      html: `<p style="font-size:14px">Ya se vendió y esas ventas se necesitan para tus informes:</p>
        <ul style="text-align:left;margin:10px auto 0;max-width:320px;font-size:14px">${(c.reasons ?? []).map((x) => `<li>• ${esc(x.label)}</li>`).join("")}</ul>
        <p style="font-size:13px;opacity:.8;margin-top:12px">${p.active ? "Inactívalo: deja de salir en catálogos, POS y búsquedas, y el historial se conserva." : "Ya está inactivo: no sale en catálogos, POS ni búsquedas."}</p>`,
      showCancelButton: p.active, showConfirmButton: true, confirmButtonText: p.active ? "Inactivar" : "Entendido", cancelButtonText: "Cancelar",
    });
    return p.active && r.isConfirmed ? "inactivate" : null;
  }
  const units = Number(c.units ?? 0);
  const extra = [...(units ? [`${units.toLocaleString("es-CO")} unidad${units === 1 ? "" : "es"} en inventario`] : []), ...(c.will_delete ?? []).map((x) => x.label)];
  const reason = await askReason(`¿Eliminar «${esc(p.name)}»?`,
    `<p style="font-size:14px">No tiene ventas. Se borra para siempre junto con su lugar en catálogos y categorías${extra.length ? " y también:" : "."}</p>
     ${extra.length ? `<ul style="text-align:left;margin:8px auto 0;max-width:320px;font-size:14px;color:#dc2626">${extra.map((x) => `<li>• ${esc(x)}</li>`).join("")}</ul>` : ""}
     <p style="font-size:12px;opacity:.75;margin-top:8px">Queda registrado en la auditoría.</p>`, "Eliminar");
  if (!reason) return null;
  const { error: e } = await sb.rpc("erp_product_delete", { p_product: p.id, p_reason: reason });
  if (e) {
    await Swal.fire({ ...swalTheme, icon: "error", title: "No se eliminó", text: dbError(e) });
    return null;
  }
  void Swal.fire({ ...swalTheme, toast: true, position: "top", icon: "success", title: "Producto eliminado", timer: 1800, showConfirmButton: false });
  return "deleted";
}

/** Limpiar: lista de productos que se pueden eliminar (sin historial ni unidades) para borrar varios de una vez. */
export function CleanupProductsSheet({ storeId, onClose, onChanged }: { storeId: string; onClose: () => void; onChanged: () => void }) {
  const [scope, setScope] = useState<"inactive" | "all">("inactive");
  const [rows, setRows] = useState<Unused[] | null>(null);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error: e } = await supabaseBrowser().rpc("erp_products_unused", { p_store: storeId, p_only_inactive: scope === "inactive" });
    const r = data as { ok: boolean; error?: string; products?: Unused[]; checked?: number } | null;
    if (e || !r?.ok) { setError(e ? dbError(e) : r?.error ?? "No se pudo cargar."); setRows([]); return; }
    setError(null);
    setChecked(r.checked ?? 0);
    setRows(r.products ?? []);
    setPicked(new Set());
  }, [storeId, scope]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const all = !!rows?.length && picked.size === rows.length;

  async function removePicked() {
    const list = (rows ?? []).filter((r) => picked.has(r.id));
    if (!list.length) return;
    const reason = await askReason(`¿Eliminar ${list.length} producto${list.length === 1 ? "" : "s"}?`,
      `<p style="font-size:14px">Ninguno tiene ventas. Se borran para siempre con su historial (kardex, compras, traslados) y sus unidades${list.some((r) => Number(r.units ?? 0)) ? `: <b>${list.reduce((s, r) => s + Number(r.units ?? 0), 0).toLocaleString("es-CO")} unidades</b> salen del inventario` : ""}. Cada uno queda en la auditoría.</p>`, `Eliminar ${list.length}`);
    if (!reason) return;
    const failed: string[] = [];
    for (const [i, p] of list.entries()) {
      setProgress(`Eliminando ${i + 1} de ${list.length}…`);
      const { error: e } = await supabaseBrowser().rpc("erp_product_delete", { p_product: p.id, p_reason: reason });
      if (e) failed.push(`${p.name}: ${dbError(e)}`);
    }
    setProgress(null);
    const okCount = list.length - failed.length;
    await Swal.fire({
      ...swalTheme, icon: failed.length ? "warning" : "success", title: `${okCount} eliminado${okCount === 1 ? "" : "s"}`,
      html: failed.length ? `<p style="font-size:13px">No se eliminaron ${failed.length}:</p><ul style="text-align:left;font-size:12px;max-height:200px;overflow:auto">${failed.map((f) => `<li>• ${esc(f)}</li>`).join("")}</ul>` : undefined,
    });
    onChanged();
    await load();
  }

  return (
    <Sheet title="Limpiar productos sin ventas" icon={<Trash2 size={18} />} onClose={onClose}
      subtitle="Solo salen los que nunca se vendieron en ningún punto ni catálogo. Se borran con su historial y sus unidades."
      footer={<>
        <span className="flex-1 text-xs" style={{ color: "var(--t-muted)" }}>{progress ?? (picked.size ? `${picked.size} seleccionado${picked.size === 1 ? "" : "s"}` : "Escoge los que quieres eliminar")}</span>
        <button type="button" disabled={!picked.size || !!progress} onClick={() => void removePicked()}
          className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-40">
          <Trash2 size={15} /> Eliminar {picked.size || ""}
        </button>
      </>}>
      <div className="space-y-3">
        <ChoiceChips value={scope} onChange={setScope} disabled={!!progress} options={[{ value: "inactive", label: "Solo inactivos" }, { value: "all", label: "También activos" }]} />
        {error ? <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{error}</p> : null}
        {rows === null ? <p className="text-sm" style={{ color: "var(--t-muted)" }}>Revisando el historial de cada producto…</p> : !rows.length ? (
          !error ? <p className="rounded-2xl border p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            {checked ? `Revisé ${checked} producto${checked === 1 ? "" : "s"}${scope === "inactive" ? " inactivos" : ""}: todos tienen ventas, así que no se pueden eliminar.` : scope === "inactive" ? "No hay productos inactivos." : "No hay productos."}
          </p> : null
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} className="h-5 w-5 accent-red-600" style={{ minHeight: 0, padding: 0 }} />
              Seleccionar los {rows.length}
            </label>
            <ul className="max-h-[50dvh] space-y-1.5 overflow-auto pr-1">
              {rows.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-2 text-sm" style={{ borderColor: picked.has(r.id) ? "#dc2626" : "var(--t-card-border)" }}>
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5 shrink-0 accent-red-600" style={{ minHeight: 0, padding: 0 }} />
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                    ) : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: "var(--t-card-bg-soft)" }}>📦</span>}
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{r.name}</b>
                      <span className="text-[11px]" style={{ color: "var(--t-muted)" }}>{r.sku ? `${r.sku} · ` : ""}{r.active ? "Activo" : "Inactivo"} · creado {new Date(r.created_at).toLocaleDateString("es-CO")}</span>
                      {Number(r.units ?? 0) ? <span className="block text-[11px] font-semibold text-red-500">{Number(r.units).toLocaleString("es-CO")} unidades en inventario (se pierden)</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
