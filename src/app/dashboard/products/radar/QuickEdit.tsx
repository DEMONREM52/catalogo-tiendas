"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { m as motion } from "framer-motion";
import { ExternalLink, Eye, EyeOff, Loader2, Save, X, Zap } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { RichTextEditor } from "@/components/forms/RichTextEditor";
import { ImageUpload } from "../../store/ImageUpload";
import { CategoryPicker, loadProductCategoryIds, saveProductCategoryIds, type PickerCategory } from "../CategoryPicker";
import { requestImageIndex } from "@/lib/image-search/indexer";
import { Skeleton } from "@/components/ui/Skeleton";
import type { IssueDef } from "@/lib/products/radar";
import { BadgesPanel } from "../BadgesPanel";

type Form = { name: string; description: string; image_url: string | null; barcode: string; category_id: string | null };

/**
 * Editor rápido al lado del Radar: foto, nombre, descripción corta, categorías y código de barras.
 * Activar / inactivar va aparte y se hace de una vez (igual que el botón de la fila, con «Deshacer»);
 * no espera a «Guardar cambios». Para lo demás (precios, fotos extra, ficha completa) está «Completo».
 */
export function QuickEdit({ storeId, productId, categories, issues, active, canToggle, toggling, onToggleActive, onClose, onSaved, onOpenFull }: {
  /** issues: lo que le falta según el Radar. Sin issues (p. ej. desde un ingreso) no se muestra esa fila. */
  storeId: string; productId: string; categories: PickerCategory[]; issues?: IssueDef[];
  active: boolean; canToggle: boolean; toggling: boolean; onToggleActive: () => void;
  onClose: () => void; onSaved: () => void; onOpenFull: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [orig, setOrig] = useState<string>("");
  const [cats, setCats] = useState<string[]>([]);
  const [origCats, setOrigCats] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const sb = supabaseBrowser();
      const [{ data: u }, { data: p }] = await Promise.all([
        sb.auth.getUser(),
        sb.from("products").select("name,description,image_url,barcode,category_id").eq("id", productId).eq("store_id", storeId).maybeSingle(),
      ]);
      if (!alive || !p) return;
      const row = p as { name: string; description: string | null; image_url: string | null; barcode: string | null; category_id: string | null };
      const f: Form = { name: row.name ?? "", description: row.description ?? "", image_url: row.image_url, barcode: row.barcode ?? "", category_id: row.category_id };
      const ids = await loadProductCategoryIds(productId, row.category_id, categories);
      if (!alive) return;
      setUserId(u.user?.id ?? null);
      setForm(f); setOrig(JSON.stringify(f));
      setCats(ids); setOrigCats(ids.join(","));
    })();
    return () => { alive = false; };
  }, [productId, storeId, categories]);

  const dirty = form ? JSON.stringify(form) !== orig || cats.join(",") !== origCats : false;

  async function save() {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.from("products").update({
        name: form.name.trim(), description: form.description, image_url: form.image_url,
        barcode: form.barcode.trim() || null, category_id: cats[0] ?? null,
      }).eq("id", productId).eq("store_id", storeId);
      if (error) throw error;
      const warn = cats.join(",") !== origCats ? await saveProductCategoryIds(productId, cats) : null;
      requestImageIndex();
      setOrig(JSON.stringify(form)); setOrigCats(cats.join(","));
      void Swal.fire({ toast: true, position: "top", icon: warn ? "warning" : "success", title: warn ?? "✅ Guardado", timer: 2200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });
      onSaved();
    } catch (e) {
      void Swal.fire({ icon: "error", title: "No se guardó", text: e instanceof Error ? e.message : String(e), background: "var(--t-bg-base)", color: "var(--t-text)" });
    } finally { setBusy(false); }
  }

  async function close() {
    if (dirty) {
      const r = await Swal.fire({ icon: "warning", title: "Tienes cambios sin guardar", showCancelButton: true, showDenyButton: true, confirmButtonText: "Guardar", denyButtonText: "Salir sin guardar", cancelButtonText: "Seguir", background: "var(--t-bg-base)", color: "var(--t-text)" });
      if (r.isConfirmed) { await save(); onClose(); } else if (r.isDenied) onClose();
      return;
    }
    onClose();
  }

  if (typeof document === "undefined") return null;
  const style = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;
  return createPortal(
    <motion.div className="fixed inset-0 z-[300] flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ background: "rgba(8,6,20,.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) void close(); }}>
      <motion.aside role="dialog" aria-modal="true" aria-label="Editor rápido" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="flex h-full w-full max-w-lg flex-col border-l shadow-2xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <header className="flex items-center gap-2 border-b p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,#8b5cf6,#0ea5e9)" }}><Zap size={18} /></span>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Editor rápido</p><p className="truncate text-sm font-black">{form?.name || "…"}</p></div>
          <button type="button" onClick={onOpenFull} className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}><ExternalLink size={12} /> Completo</button>
          <button type="button" onClick={() => void close()} className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!issues ? null : issues.length ? (
            <div className="flex flex-wrap gap-1">{issues.map((i) => <span key={i.key} className="rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }} title={i.help}>{i.emoji} {i.label}</span>)}</div>
          ) : <p className="text-xs font-bold text-emerald-500">✓ Ficha completa</p>}
          <div className="flex items-center gap-3 rounded-2xl border p-3"
            style={{ borderColor: active ? "color-mix(in oklab, #10b981 45%, var(--t-card-border))" : "color-mix(in oklab, #e5484d 45%, var(--t-card-border))" }}>
            <span className="text-xl" aria-hidden>{active ? "🟢" : "🙈"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">{active ? "Activo" : "Inactivo"}</p>
              <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
                {active ? "Se vende y aparece en los catálogos." : "No se vende ni aparece en los catálogos."}
                {canToggle ? "" : " Para cambiarlo necesitas el permiso de Productos."}
              </p>
            </div>
            {canToggle ? (
              <button type="button" onClick={onToggleActive} disabled={toggling}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-60"
                style={active ? { borderColor: "color-mix(in oklab, #e5484d 45%, var(--t-card-border))", color: "#e5484d" } : { borderColor: "color-mix(in oklab, #10b981 45%, var(--t-card-border))", color: "#10b981" }}
                title={active ? "Deja de venderse y sale de los catálogos (se puede volver a activar)" : "Volver a vender y mostrar en los catálogos"}>
                {toggling ? <Loader2 size={14} className="animate-spin" /> : active ? <EyeOff size={14} /> : <Eye size={14} />} {active ? "Inactivar" : "Activar"}
              </button>
            ) : null}
          </div>
          {!form ? <div className="space-y-3"><Skeleton className="h-40 w-40 rounded-2xl" /><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></div> : (
            <>
              <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                <div>
                  <p className="mb-1 text-xs font-bold">📸 Foto principal</p>
                  {userId ? <ImageUpload compact label="Subir foto" currentUrl={form.image_url} pathPrefix={`${userId}/products/`} fileName={`${productId}.png`} bucket="product-images" onUploaded={(url) => setForm({ ...form, image_url: url })} /> : <Skeleton className="aspect-square w-full rounded-2xl" />}
                </div>
                <div className="space-y-3">
                  <label className="block"><span className="text-xs font-bold">🏷️ Nombre</span>
                    <input value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={style} /></label>
                  <label className="block"><span className="text-xs font-bold">📊 Código de barras</span>
                    <input value={form.barcode} maxLength={60} inputMode="numeric" onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={style} placeholder="Opcional" /></label>
                </div>
              </div>
              <CategoryPicker categories={categories} value={cats} onChange={setCats} disabled={busy} />
              <BadgesPanel storeId={storeId} productId={productId} compact />
              <div>
                <p className="mb-1 text-xs font-bold">💬 Descripción corta</p>
                <RichTextEditor value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Una o dos frases que salen debajo del nombre." minHeight={90} />
              </div>
            </>
          )}
        </div>
        <footer className="border-t p-3" style={{ borderColor: "var(--t-card-border)" }}>
          <button type="button" onClick={() => void save()} disabled={!form || !dirty || busy || !form.name.trim()} className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,var(--t-accent),#10b981)" }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {dirty ? "Guardar cambios" : "Sin cambios"}
          </button>
        </footer>
      </motion.aside>
    </motion.div>,
    document.body,
  );
}
