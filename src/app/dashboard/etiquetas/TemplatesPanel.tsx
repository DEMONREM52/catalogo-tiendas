"use client";

import { useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Copy, Download, History, Pencil, Plus, Search, Star, Trash2, Upload } from "lucide-react";
import Swal from "@/lib/swal";
import { normalizeDesign } from "@/lib/labels/templates";
import type { LabelDesign, LabelTemplate } from "@/lib/labels/types";
import { Badge, Button, inputStyle } from "../fiscal/ui";
import { LabelSvg } from "./parts";
import type { TemplateVersion } from "./library";

const swal = { background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6" };

export function TemplatesPanel({ templates, builtins, canEdit, onOpen, onUseForPrint, onPatch, onDelete, onSetDefault, onImport, loadVersions }: {
  templates: LabelTemplate[];
  builtins: LabelTemplate[];
  canEdit: boolean;
  onOpen: (t: LabelTemplate) => void;
  onUseForPrint: (t: LabelTemplate) => void;
  onPatch: (id: string, patch: Partial<{ name: string; favorite: boolean; archived_at: string | null }>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  onImport: (t: { name: string; category: string | null; design: LabelDesign }) => Promise<void>;
  loadVersions: (id: string) => Promise<TemplateVersion[]>;
}) {
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const mine = useMemo(() => templates
    .filter((t) => Boolean(t.archived_at) === archived)
    .filter((t) => !q || fold(`${t.name} ${t.category ?? ""}`).includes(fold(q)))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "es")), [templates, archived, q]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e instanceof Error ? e.message : String(e) }); }
  };

  function exportOne(t: LabelTemplate) {
    const blob = new Blob([JSON.stringify({ kind: "remhub-label-template", v: 1, name: t.name, category: t.category, design: t.design }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `plantilla-${t.name.replace(/[^\w-]+/g, "_").slice(0, 40)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function importFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) return void Swal.fire({ ...swal, icon: "error", title: "Archivo muy grande" });
    try {
      const j = JSON.parse(await f.text()) as { kind?: string; name?: unknown; category?: unknown; design?: unknown };
      if (j.kind !== "remhub-label-template" || !j.design) throw new Error("No es una plantilla de etiquetas de RemHub.");
      const design = normalizeDesign(j.design);
      await onImport({ name: String(j.name ?? "Importada").slice(0, 80), category: typeof j.category === "string" ? j.category.slice(0, 40) : null, design });
      void Swal.fire({ ...swal, icon: "success", title: "Plantilla importada", timer: 1300, showConfirmButton: false });
    } catch (e) {
      void Swal.fire({ ...swal, icon: "error", title: "No se pudo importar", text: e instanceof Error ? e.message : "Archivo no válido." });
    }
  }
  async function rename(t: LabelTemplate) {
    const r = await Swal.fire({ ...swal, title: "Nuevo nombre", input: "text", inputValue: t.name, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", inputValidator: (v) => (String(v ?? "").trim() ? null : "Escribe un nombre") });
    if (r.isConfirmed) await run(() => onPatch(t.id, { name: String(r.value).trim().slice(0, 80) }));
  }
  async function versions(t: LabelTemplate) {
    let list: TemplateVersion[] = [];
    try { list = await loadVersions(t.id); } catch (e) { return void Swal.fire({ ...swal, icon: "error", title: "No se pudo", text: e instanceof Error ? e.message : String(e) }); }
    if (!list.length) return void Swal.fire({ ...swal, icon: "info", title: "Sin versiones anteriores", text: "Cada vez que guardes cambios, la versión anterior queda aquí (las últimas 30)." });
    const r = await Swal.fire({
      ...swal, title: "Versiones anteriores", input: "select", showCancelButton: true, confirmButtonText: "Abrir esa versión", cancelButtonText: "Cerrar",
      inputOptions: Object.fromEntries(list.map((v, i) => [String(i), `v${v.version} · ${new Date(v.saved_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} · ${v.name}`])),
      text: "Se abre en el diseñador; si te sirve, guárdala y queda como la actual (la de ahora pasa a las versiones).",
    });
    if (r.isConfirmed) { const v = list[Number(r.value)]; onOpen({ ...t, design: v.design, name: t.name }); }
  }

  const card = (t: LabelTemplate) => (
    <li key={t.id} className="flex flex-col rounded-2xl border p-2.5" style={{ borderColor: t.is_default ? "var(--t-accent)" : "var(--t-card-border)", background: "color-mix(in oklab, var(--t-card-bg) 90%, transparent)" }}>
      <button type="button" onClick={() => onOpen(t)} className="grid place-items-center rounded-xl p-2" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }} title="Abrir en el diseñador">
        <LabelSvg design={t.design} style={{ width: "100%", maxWidth: 150 }} />
      </button>
      <div className="mt-2 flex items-start gap-1">
        <p className="min-w-0 flex-1 text-sm font-bold leading-tight">{t.name}</p>
        {t.builtin ? <Badge tone="info">RemHub</Badge> : null}
        {t.is_default ? <Badge tone="good">Predeterminada</Badge> : null}
      </div>
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>{t.design.w} × {t.design.h} mm · {t.design.elements.length} elemento{t.design.elements.length === 1 ? "" : "s"}{t.category ? ` · ${t.category}` : ""}{t.updated_at ? ` · ${new Date(t.updated_at).toLocaleDateString("es-CO")}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" onClick={() => onUseForPrint(t)} className="rounded-lg px-2 py-1 text-[11px] font-black text-white" style={{ background: "var(--t-accent)" }}>Imprimir con esta</button>
        <IconAct title={t.builtin ? "Copiar y editar" : "Editar"} onClick={() => onOpen(t)}>{t.builtin ? <Copy size={13} /> : <Pencil size={13} />}</IconAct>
        {!t.builtin && canEdit ? (
          <>
            <IconAct title={t.favorite ? "Quitar de favoritas" : "Favorita"} onClick={() => void run(() => onPatch(t.id, { favorite: !t.favorite }))}><Star size={13} fill={t.favorite ? "currentColor" : "none"} /></IconAct>
            {!t.is_default && !t.archived_at ? <IconAct title="Predeterminada de la tienda" onClick={() => void run(() => onSetDefault(t.id))}>✓</IconAct> : null}
            <IconAct title="Renombrar" onClick={() => void rename(t)}>Aa</IconAct>
            <IconAct title="Versiones anteriores" onClick={() => void versions(t)}><History size={13} /></IconAct>
            <IconAct title={t.archived_at ? "Restaurar" : "Archivar"} onClick={() => void run(() => onPatch(t.id, { archived_at: t.archived_at ? null : new Date().toISOString() }))}>{t.archived_at ? <ArchiveRestore size={13} /> : <Archive size={13} />}</IconAct>
            {t.archived_at ? <IconAct title="Eliminar para siempre" onClick={async () => {
              const r = await Swal.fire({ ...swal, icon: "warning", title: `¿Eliminar «${t.name}»?`, text: "Se borra con sus versiones. No se puede deshacer.", showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar", confirmButtonColor: "#ef4444" });
              if (r.isConfirmed) await run(() => onDelete(t.id));
            }}><Trash2 size={13} className="text-red-400" /></IconAct> : null}
          </>
        ) : null}
        <IconAct title="Exportar (archivo)" onClick={() => exportOne(t)}><Download size={13} /></IconAct>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3" style={inputStyle}>
          <Search size={15} style={{ color: "var(--t-muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar plantilla o categoría…" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <Button variant="soft" onClick={() => setArchived((a) => !a)} icon={<Archive size={15} />}>{archived ? "Ver activas" : "Archivadas"}</Button>
        {canEdit ? (
          <>
            <Button variant="soft" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>Importar</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
          </>
        ) : null}
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => onOpen(builtins.find((b) => b.id === "builtin:vacia") ?? builtins[0])}>Nueva en blanco</Button>
      </div>
      <section>
        <p className="mb-2 text-xs font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Plantillas de la tienda ({mine.length})</p>
        {mine.length ? <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{mine.map(card)}</ul> : (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm" style={{ borderColor: "var(--t-card-border)", color: "var(--t-muted)" }}>
            {archived ? "No hay plantillas archivadas." : "Todavía no hay plantillas guardadas. Abre una de RemHub, cámbiala a tu gusto y guárdala."}
          </p>
        )}
      </section>
      {!archived ? (
        <section>
          <p className="mb-2 text-xs font-black uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>De RemHub (se acomodan al tamaño de tu impresora)</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{builtins.filter((t) => !q || fold(t.name).includes(fold(q))).map(card)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function IconAct({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} className="grid h-7 min-w-7 place-items-center rounded-lg border px-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>{children}</button>;
}
