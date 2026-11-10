"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { m as motion } from "framer-motion";
import { Bold, Copy, Loader2, Plus, Save, Star, Trash2, X } from "lucide-react";
import Swal from "@/lib/swal";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EmojiPicker } from "./EmojiPicker";
import { BUILTIN_TEMPLATES, VARIABLES, renderTemplate, unknownVariables, type CatalogOption, type PublishTemplate, type TemplateVars } from "@/lib/products/publish-templates";

/**
 * Editor de plantillas de mensajes: crear, editar, duplicar, borrar y escoger la de siempre.
 * Botones para meter variables ({nombre}, {precio}…), negrilla de WhatsApp y emojis; vista previa en vivo.
 */

const EMOJIS = ["🔥", "💰", "✅", "📲", "⚡", "🎁", "🚚", "⭐", "💥", "🛍️", "👉", "😍", "🎉", "❤️"];
const toast = (title: string, icon: "success" | "error" = "success") =>
  void Swal.fire({ toast: true, position: "top", icon, title, timer: 2200, showConfirmButton: false, background: "var(--t-bg-base)", color: "var(--t-text)" });

type Draft = { id: string | null; name: string; body: string; is_default: boolean; catalog_slug: string | null };

export function TemplateEditor({ storeId, vars, templates, missing, catalogs = [], onClose, onChanged }: {
  storeId: string; vars: TemplateVars; templates: PublishTemplate[]; missing: boolean; catalogs?: CatalogOption[];
  onClose: () => void; onChanged: (selectId?: string) => void;
}) {
  const first = templates[0];
  const [draft, setDraft] = useState<Draft>(first
    ? { id: first.id, name: first.name, body: first.body, is_default: Boolean(first.is_default), catalog_slug: first.catalog_slug ?? null }
    : { id: null, name: "Mi plantilla", body: BUILTIN_TEMPLATES[0].body, is_default: true, catalog_slug: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [upper, setUpper] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => renderTemplate(draft.body, vars), [draft.body, vars]);
  const unknown = useMemo(() => unknownVariables(draft.body), [draft.body]);

  function insert(text: string, wrap = false, mark = "*") {
    const el = area.current;
    const start = el?.selectionStart ?? draft.body.length, end = el?.selectionEnd ?? draft.body.length;
    const sel = draft.body.slice(start, end);
    const piece = wrap || mark !== "*" ? `${mark}${sel || "texto"}${mark}` : text;
    const body = draft.body.slice(0, start) + piece + draft.body.slice(end);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => { el?.focus(); const at = start + piece.length; el?.setSelectionRange(at, at); });
  }

  async function save() {
    if (missing) { toast("Falta correr la migración 20261307 en Supabase.", "error"); return; }
    setBusy("save");
    const sb = supabaseBrowser();
    let { data, error } = await sb.rpc("publish_template_save", { p_store: storeId, p_id: draft.id, p_name: draft.name, p_body: draft.body, p_default: draft.is_default, p_catalog: draft.catalog_slug });
    if (error && /Could not find the function|schema cache/i.test(error.message)) {
      // Sin 20261308 todavía: se guarda sin catálogo.
      ({ data, error } = await sb.rpc("publish_template_save", { p_store: storeId, p_id: draft.id, p_name: draft.name, p_body: draft.body, p_default: draft.is_default }));
      if (!error && draft.catalog_slug) toast("Guardada. Para el catálogo de la plantilla corre la migración 20261308.", "error");
    }
    setBusy(null);
    const d = data as { ok?: boolean; id?: string; message?: string } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se guardó", "error"); return; }
    setDraft({ ...draft, id: d.id ?? draft.id });
    toast("💾 Plantilla guardada");
    onChanged(d.id);
  }

  async function remove() {
    if (!draft.id) { setDraft({ id: null, name: "", body: "", is_default: false, catalog_slug: null }); return; }
    const ok = await Swal.fire({ icon: "warning", title: `¿Borrar «${draft.name}»?`, showCancelButton: true, confirmButtonText: "Borrar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444", background: "var(--t-bg-base)", color: "var(--t-text)" });
    if (!ok.isConfirmed) return;
    setBusy("del");
    const { data, error } = await supabaseBrowser().rpc("publish_template_delete", { p_store: storeId, p_id: draft.id });
    setBusy(null);
    const d = data as { ok?: boolean; message?: string } | null;
    if (error || !d?.ok) { toast(error?.message ?? d?.message ?? "No se borró", "error"); return; }
    toast("Plantilla borrada");
    const next = templates.find((t) => t.id !== draft.id);
    setDraft(next ? { id: next.id, name: next.name, body: next.body, is_default: Boolean(next.is_default), catalog_slug: next.catalog_slug ?? null } : { id: null, name: "Mi plantilla", body: BUILTIN_TEMPLATES[0].body, is_default: true, catalog_slug: null });
    onChanged();
  }

  const pick = (t: PublishTemplate) => setDraft({ id: t.id, name: t.name, body: t.body, is_default: Boolean(t.is_default), catalog_slug: t.catalog_slug ?? null });
  const chip = "rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:-translate-y-0.5";
  const field = { borderColor: "var(--t-card-border)", background: "var(--t-input-bg, var(--t-card-bg))", color: "var(--t-text)" } as const;

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="fixed inset-0 z-[320] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ background: "rgba(8,6,20,.6)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label="Plantillas de mensajes" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative max-h-[94dvh] w-full overflow-y-auto rounded-t-[26px] border p-4 shadow-2xl sm:max-w-4xl sm:rounded-[26px] sm:p-5"
        style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Cerrar"><X size={16} /></button>
        <h2 className="pr-10 text-lg font-black">📝 Plantillas de mensajes</h2>
        <p className="text-xs" style={{ color: "var(--t-muted)" }}>Arma el mensaje una vez y úsalo con cualquier producto. Las variables se cambian solas por los datos del producto.</p>
        {missing ? <p className="mt-2 rounded-xl border p-2 text-xs" style={{ borderColor: "#f59e0b" }}>⚠️ Para guardar tus plantillas corre en Supabase <b>20261307_plantillas_publicar.sql</b>. Mientras tanto puedes usar las de RemHub.</p> : null}

        <div className="mt-3 grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]">
          {/* Lista */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Tus plantillas</p>
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => pick(t)} className="flex w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-xs font-bold"
                style={draft.id === t.id ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 14%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                {t.is_default ? <Star size={12} className="shrink-0 text-amber-500" fill="currentColor" /> : null}<span className="truncate">{t.name}</span>
              </button>
            ))}
            <button type="button" onClick={() => setDraft({ id: null, name: "Nueva plantilla", body: "🔥 *{NOMBRE}* 🔥\n💰 *{precio}*\n\n", is_default: false, catalog_slug: null })} disabled={missing}
              className="flex w-full items-center gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs font-bold disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }}>
              <Plus size={13} /> Nueva
            </button>
            <p className="pt-2 text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>De RemHub (para copiar)</p>
            {BUILTIN_TEMPLATES.map((t) => (
              <button key={t.id} type="button" disabled={missing} onClick={() => setDraft({ id: null, name: `${t.name} (mía)`, body: t.body, is_default: false, catalog_slug: null })}
                className="flex w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-xs disabled:opacity-50" style={{ borderColor: "var(--t-card-border)" }} title="Copiar para editarla">
                <Copy size={12} className="shrink-0" /><span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="space-y-2">
            <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre (ej: Instagram, Oferta del día)"
              className="w-full rounded-xl border px-3 py-2.5 text-sm font-bold" style={field} />
            <div className="flex flex-wrap items-center gap-1">
              {VARIABLES.map((v) => (
                <button key={v.key} type="button" onClick={() => insert(`{${upper ? v.key.toUpperCase() : v.key}}`)} className={chip}
                  style={{ borderColor: "color-mix(in oklab, var(--t-accent) 45%, transparent)", background: "color-mix(in oklab, var(--t-accent) 10%, transparent)" }} title={`Ej: ${v.example}`}>
                  + {v.label}
                </button>
              ))}
              <label className="ml-1 inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold" title="La variable sale en MAYÚSCULAS">
                <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> MAYÚS
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => insert("", true)} className={`${chip} inline-flex items-center gap-1`} style={{ borderColor: "var(--t-card-border)" }} title="Negrilla en WhatsApp: *texto*"><Bold size={11} /> Negrilla</button>
              {EMOJIS.map((e) => <button key={e} type="button" onClick={() => insert(e)} className="grid h-7 w-7 place-items-center rounded-lg border text-sm" style={{ borderColor: "var(--t-card-border)" }}>{e}</button>)}
              <button type="button" onClick={() => setEmojiOpen((o) => !o)} className={`${chip} inline-flex items-center gap-1`}
                style={emojiOpen ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
                😀 Más emojis
              </button>
              <button type="button" onClick={() => insert("", false, "_")} className={chip} style={{ borderColor: "var(--t-card-border)" }} title="Cursiva en WhatsApp: _texto_"><i>Cursiva</i></button>
              <button type="button" onClick={() => insert("", false, "~")} className={chip} style={{ borderColor: "var(--t-card-border)" }} title="Tachado en WhatsApp: ~texto~"><s>Tachado</s></button>
            </div>
            {emojiOpen ? <EmojiPicker onPick={(e) => insert(e)} onClose={() => setEmojiOpen(false)} /> : null}
            <textarea ref={area} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={11} maxLength={4000}
              className="w-full resize-y rounded-xl border p-3 font-mono text-xs leading-relaxed outline-none" style={field} aria-label="Texto de la plantilla" />
            {unknown.length ? <p className="text-[11px] text-amber-500">⚠️ No existe: {unknown.map((u) => `{${u}}`).join(", ")}. Se dejará tal cual.</p> : null}
            <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Si un dato está vacío (por ejemplo, sin descripción), esa línea se quita sola.</p>
            <label className="block text-xs font-bold">🛍️ El enlace lleva al catálogo
              <select value={draft.catalog_slug ?? ""} onChange={(e) => setDraft({ ...draft, catalog_slug: e.target.value || null })} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm" style={field}>
                <option value="">Catálogo principal (al detal)</option>
                {catalogs.map((c) => <option key={c.slug} value={c.slug}>{c.name}{c.access_key ? " 🔒" : ""}</option>)}
              </select>
              <span className="mt-0.5 block text-[11px] font-normal" style={{ color: "var(--t-muted)" }}>Con ese precio. Al comprar, el producto queda en el carrito de ese catálogo y pueden agregar más.</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} /> ⭐ Usar siempre esta plantilla
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => void save()} disabled={!!busy || !draft.name.trim() || !draft.body.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,var(--t-accent),#ec4899)" }}>
                {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar
              </button>
              {draft.id ? (
                <button type="button" onClick={() => void remove()} disabled={!!busy} className="grid w-12 place-items-center rounded-2xl border" style={{ borderColor: "var(--t-card-border)" }} aria-label="Borrar plantilla" title="Borrar">
                  {busy === "del" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              ) : null}
            </div>
          </div>

          {/* Vista previa */}
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>👀 Así se ve</p>
            <div className="rounded-2xl p-3" style={{ background: "#0b141a" }}>
              <div className="ml-auto max-w-[95%] rounded-xl rounded-tr-sm px-3 py-2 text-[13px] leading-snug text-white shadow" style={{ background: "#005c4b" }}>
                <WhatsAppText text={preview || "…"} />
                <p className="mt-1 text-right text-[10px] text-white/60">9:41 ✓✓</p>
              </div>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "var(--t-muted)" }}>Con los datos de {vars.nombre ? `«${vars.nombre}»` : "un producto de ejemplo"}.</p>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Muestra el texto como WhatsApp: *negrilla*, _cursiva_ y ~tachado~. */
export function WhatsAppText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, i) =>
        /^\*[^*]+\*$/.test(part) ? <b key={i}>{part.slice(1, -1)}</b>
          : /^_[^_]+_$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i>
            : /^~[^~]+~$/.test(part) ? <s key={i}>{part.slice(1, -1)}</s>
              : <span key={i}>{part}</span>)}
    </span>
  );
}
