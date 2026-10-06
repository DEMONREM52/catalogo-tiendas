"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newLocalId } from "@/lib/catalogs";
import type { BaseCategory, CatalogCategoryRow } from "./types";
import { Switch, errorText, inputCls, inputStyle, softBox } from "./ui";

export function categoryDisplayName(row: CatalogCategoryRow, base: Map<string, BaseCategory>) {
  return row.name?.trim() || (row.category_id ? base.get(row.category_id)?.name : "") || "Sin nombre";
}

export function categoryDisplayImage(row: CatalogCategoryRow, base: Map<string, BaseCategory>) {
  return row.image_url || (row.category_id ? base.get(row.category_id)?.image_url ?? null : null);
}

export function CategoriesTab({
  storeId,
  catalogId,
  rows,
  setRows,
  baseCategories,
}: {
  storeId: string;
  catalogId: string;
  rows: CatalogCategoryRow[];
  setRows: (rows: CatalogCategoryRow[]) => void;
  baseCategories: BaseCategory[];
}) {
  const base = new Map(baseCategories.map((c) => [c.id, c]));
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);

  function patch(id: string, change: Partial<CatalogCategoryRow>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  function move(id: string, dir: -1 | 1) {
    const index = sorted.findIndex((r) => r.id === id);
    const other = sorted[index + dir];
    if (!other) return;
    const ordered = sorted.map((r, i) => ({ ...r, sort_order: i }));
    const a = ordered[index];
    const b = ordered[index + dir];
    [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
    setRows(ordered);
  }

  function addCustom() {
    const next = sorted.length ? Math.max(...sorted.map((r) => r.sort_order)) + 1 : 0;
    setRows([...rows, { id: newLocalId("cat"), category_id: null, name: "Nueva categoría", image_url: null, sort_order: next, visible: true, isNew: true }]);
  }

  async function upload(file: File) {
    const id = targetRef.current;
    if (!id) return;
    if (!file.type.startsWith("image/")) return setError("Elige una imagen (PNG o JPG).");
    if (file.size > 2 * 1024 * 1024) return setError("La imagen debe pesar máximo 2 MB.");
    setUploadingId(id);
    setError("");
    try {
      const sb = supabaseBrowser();
      const path = `${storeId}/catalogs/${catalogId}/categories/${id}-${Date.now()}.${file.type.includes("png") ? "png" : "jpg"}`;
      const { error: upError } = await sb.storage.from("store-assets").upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upError) throw upError;
      const { data } = sb.storage.from("store-assets").getPublicUrl(path);
      patch(id, { image_url: data.publicUrl });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: "var(--t-muted)" }}>
          Cambia el nombre y la imagen de cada categoría solo para este catálogo, ocúltalas u ordénalas. Las categorías sin productos disponibles no se muestran a tus clientes.
        </p>
        <button type="button" onClick={addCustom} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "var(--t-cta)" }}>
          <Plus size={14} /> Categoría propia
        </button>
      </div>
      {error ? <p className="rounded-xl border p-2.5 text-sm" style={{ borderColor: "#ef4444" }}>{error}</p> : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {sorted.map((row, index) => {
            const image = categoryDisplayImage(row, base);
            const baseCat = row.category_id ? base.get(row.category_id) : null;
            return (
              <motion.div
                key={row.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: row.visible ? 1 : 0.55, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center gap-3 rounded-2xl border p-3"
                style={softBox}
              >
                <div className="flex flex-col">
                  <button type="button" disabled={index === 0} onClick={() => move(row.id, -1)} className="grid h-6 w-6 place-items-center rounded-md disabled:opacity-25" aria-label="Subir"><ArrowUp size={14} /></button>
                  <button type="button" disabled={index === sorted.length - 1} onClick={() => move(row.id, 1)} className="grid h-6 w-6 place-items-center rounded-md disabled:opacity-25" aria-label="Bajar"><ArrowDown size={14} /></button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    targetRef.current = row.id;
                    fileRef.current?.click();
                  }}
                  className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border"
                  style={{ borderColor: "var(--t-card-border)", background: "var(--t-card-bg-soft)" }}
                  title="Cambiar imagen"
                >
                  {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
                  <span className="absolute inset-0 grid place-items-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
                    {uploadingId === row.id ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                  </span>
                  {!image && uploadingId !== row.id ? <span className="absolute inset-0 grid place-items-center" style={{ color: "var(--t-muted)" }}><ImagePlus size={16} /></span> : null}
                </button>
                <div className="min-w-[180px] flex-1">
                  <input
                    className={inputCls}
                    style={inputStyle}
                    value={row.name ?? ""}
                    maxLength={60}
                    placeholder={baseCat?.name ?? "Nombre de la categoría"}
                    onChange={(e) => patch(row.id, { name: e.target.value || null })}
                  />
                  <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>
                    {baseCat ? `Categoría de la tienda: ${baseCat.name}` : "Categoría propia de este catálogo: asígnale productos en la pestaña Productos."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs sm:inline" style={{ color: "var(--t-muted)" }}>{row.visible ? <Eye size={14} /> : <EyeOff size={14} />}</span>
                  <Switch checked={row.visible} onChange={(next) => patch(row.id, { visible: next })} label={`Mostrar ${categoryDisplayName(row, base)}`} />
                  {baseCat ? (
                    <button type="button" onClick={() => patch(row.id, { name: null, image_url: null })} className="grid h-8 w-8 place-items-center rounded-lg border" style={softBox} title="Usar nombre e imagen de la tienda">
                      <RotateCcw size={14} />
                    </button>
                  ) : (
                    <button type="button" onClick={() => setRows(rows.filter((r) => r.id !== row.id))} className="grid h-8 w-8 place-items-center rounded-lg border text-rose-500" style={softBox} title="Eliminar categoría propia">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            Aún no hay categorías. Crea categorías en Productos → Categorías o agrega una propia.
          </p>
        ) : null}
      </div>
    </div>
  );
}
