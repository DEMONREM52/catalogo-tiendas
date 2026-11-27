"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDown, ArrowUp,
  Barcode, ChevronsDown, ChevronsUp, Circle, Copy, Eye, EyeOff, Grid3x3, Image as ImageIcon, Lock, Minus, QrCode, Redo2, Save, Square,
  Trash2, Type, Undo2, Unlock, X, ZoomIn, ZoomOut,
} from "lucide-react";
import Swal from "@/lib/swal";
import { BARCODE_FORMATS, layoutBarcode, layoutQr } from "@/lib/labels/codes";
import { VARIABLES, resolveTokens, type LabelData } from "@/lib/labels/data";
import { canvasMeasure } from "@/lib/labels/measure-browser";
import { MONO_DEFS, elementLabel, renderLabel, safeImageUrl } from "@/lib/labels/render";
import { FONT_LABEL, fitText } from "@/lib/labels/text-fit";
import { newBarcode, newEllipse, newId, newImage, newLine, newQr, newRect, newText, normalizeDesign, resizeDesign } from "@/lib/labels/templates";
import type { BarcodeElement, Ecc, FontKey, ImageElement, LabelDesign, LabelElement, LabelTemplate, PrinterProfile, QrElement, TextElement } from "@/lib/labels/types";
import { Button, inputCls, inputStyle } from "../fiscal/ui";
import { IssueList, MmField, segBtn } from "./parts";

type Props = {
  storeId: string;
  template: LabelTemplate;
  profile: PrinterProfile;
  canSave: boolean;
  sample: { data: LabelData; images: { logo?: string | null; foto?: string | null }; label: string };
  onPickSample: () => void;
  onSave: (t: { id: string | null; name: string; category: string | null; design: LabelDesign }, asNew: boolean) => Promise<string | null>;
  onUse: (design: LabelDesign, name: string) => void;
  onClose: () => void;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const GRID = 0.5;
const draftKey = (storeId: string, id: string) => `remhub:labels:draft:${storeId}:${id}`;
const sameDesign = (a: LabelDesign, b: LabelDesign) => JSON.stringify(a) === JSON.stringify(b);
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);

type Drag =
  | { mode: "move"; id: string; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; before: LabelDesign }
  | { mode: "resize"; id: string; handle: string; sx: number; sy: number; orig: LabelElement; before: LabelDesign };
type Guide = { axis: "x" | "y"; at: number };

/** Diseñador de etiquetas: todo en mm (el zoom solo cambia cómo se ve). */
export default function Designer({ storeId, template, profile, canSave, sample, onPickSample, onSave, onUse, onClose }: Props) {
  const baseId = template.builtin ? `copia-${template.id}` : template.id;
  // Historial en un solo estado (funciones puras: React puede llamarlas dos veces sin duplicar pasos).
  const [hist, setHist] = useState<{ past: LabelDesign[]; present: LabelDesign; future: LabelDesign[] }>(() => ({ past: [], present: normalizeDesign(template.design), future: [] }));
  const design = hist.present;
  /** Cambio en vivo (arrastrando), sin paso de historial. */
  const setDesign = useCallback((d: LabelDesign) => setHist((s) => ({ ...s, present: d })), []);
  const [name, setName] = useState(template.builtin ? `${template.name} (mía)` : template.name);
  const [category, setCategory] = useState(template.category ?? "");
  const [savedId, setSavedId] = useState<string | null>(template.builtin ? null : template.id);
  const [saved, setSaved] = useState<LabelDesign>(() => normalizeDesign(template.design));
  const [sel, setSel] = useState<string[]>([]);
  const past = hist.past, future = hist.future;
  const [zoom, setZoom] = useState(12);
  const [grid, setGrid] = useState(true);
  const [printView, setPrintView] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const clip = useRef<LabelElement[]>([]);
  const drag = useRef<Drag | null>(null);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const dirty = !sameDesign(design, saved) || name !== (template.builtin ? `${template.name} (mía)` : template.name);

  // ------------------------------------------------------------ historial (deshacer / rehacer)
  const commit = useCallback((next: LabelDesign, coalesce?: string) => {
    const now = Date.now();
    const same = coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < 900;
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
    setHist((s) => (same ? { ...s, present: next } : { past: [...s.past.slice(-99), s.present], present: next, future: [] }));
  }, []);
  const undo = useCallback(() => {
    lastCoalesce.current = null;
    setHist((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future].slice(0, 100) } : s));
  }, []);
  const redo = useCallback(() => {
    lastCoalesce.current = null;
    setHist((s) => (s.future.length ? { past: [...s.past, s.present].slice(-100), present: s.future[0], future: s.future.slice(1) } : s));
  }, []);
  const patch = useCallback((id: string, p: Partial<LabelElement>, coalesce?: string) => {
    commit({ ...design, elements: design.elements.map((e) => (e.id === id ? ({ ...e, ...p } as LabelElement) : e)) }, coalesce ? `${id}:${coalesce}` : undefined);
  }, [design, commit]);

  // ------------------------------------------------------------ borrador automático y aviso al salir
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(draftKey(storeId, baseId));
      if (!raw) return;
      const d = JSON.parse(raw) as { design: unknown; name: string; category: string; at: number };
      const dd = normalizeDesign(d.design);
      if (sameDesign(dd, normalizeDesign(template.design))) return;
      void Swal.fire({
        background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6", icon: "question",
        title: "Hay cambios sin guardar", text: `Quedó un borrador de «${d.name}» del ${new Date(d.at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}. ¿Lo recupero?`,
        showDenyButton: true, confirmButtonText: "Recuperar", denyButtonText: "Descartar",
      }).then((r) => {
        if (r.isConfirmed) { commit(dd); setName(d.name); setCategory(d.category ?? ""); }
        else if (r.isDenied) window.localStorage.removeItem(draftKey(storeId, baseId));
      });
    } catch { /* sin almacenamiento */ }
  }, [storeId, baseId, template.design, commit]);
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      try { window.localStorage.setItem(draftKey(storeId, savedId ?? baseId), JSON.stringify({ design, name, category, at: Date.now() })); } catch { /* lleno */ }
    }, 600);
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { window.clearTimeout(t); window.removeEventListener("beforeunload", warn); };
  }, [dirty, design, name, category, storeId, savedId, baseId]);

  // ------------------------------------------------------------ zoom para que quepa
  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - 60) / design.w, (el.clientHeight - 60) / design.h);
    setZoom(Math.max(3, Math.min(40, Math.floor(z * 2) / 2)));
  }, [design.w, design.h]);
  useEffect(() => { const t = window.setTimeout(fit, 0); return () => window.clearTimeout(t); }, [fit]);

  // ------------------------------------------------------------ elementos
  const selected = design.elements.filter((e) => sel.includes(e.id));
  const one = selected.length === 1 ? selected[0] : null;
  const rendered = useMemo(() => renderLabel({ design, data: sample.data, dpi: profile.dpi, measure: canvasMeasure, images: sample.images }), [design, sample, profile.dpi]);
  const badIds = new Set(rendered.issues.filter((i) => i.level === "error").map((i) => i.elementId));

  function addElement(el: LabelElement) {
    const w = Math.min(el.w, design.w - 2), h = el.type === "line" ? 0 : Math.min(el.h, design.h - 2);
    const placed = { ...el, w, h, x: r2((design.w - w) / 2), y: r2((design.h - (h || 0)) / 2) } as LabelElement;
    commit({ ...design, elements: [...design.elements, placed] });
    setSel([placed.id]);
  }
  function removeSel() {
    if (!sel.length) return;
    commit({ ...design, elements: design.elements.filter((e) => !sel.includes(e.id) || e.locked) });
    setSel([]);
  }
  function duplicateSel() {
    const copies = selected.map((e) => ({ ...e, id: newId(), x: r2(e.x + 1), y: r2(e.y + 1), locked: false }));
    if (!copies.length) return;
    commit({ ...design, elements: [...design.elements, ...copies] });
    setSel(copies.map((c) => c.id));
  }
  function paste() {
    if (!clip.current.length) return;
    const copies = clip.current.map((e) => ({ ...e, id: newId(), x: r2(e.x + 1), y: r2(e.y + 1) }));
    clip.current = copies;
    commit({ ...design, elements: [...design.elements, ...copies] });
    setSel(copies.map((c) => c.id));
  }
  function order(kind: "up" | "down" | "front" | "back") {
    const list = [...design.elements];
    const ids = new Set(sel);
    const picked = list.filter((e) => ids.has(e.id));
    const rest = list.filter((e) => !ids.has(e.id));
    let next: LabelElement[];
    if (kind === "front") next = [...rest, ...picked];
    else if (kind === "back") next = [...picked, ...rest];
    else {
      next = [...list];
      const idxs = next.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (kind === "up") for (const i of idxs.reverse()) { if (i < next.length - 1 && !ids.has(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]; }
      else for (const i of idxs) { if (i > 0 && !ids.has(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]; }
    }
    commit({ ...design, elements: next });
  }
  /** Alinear a la etiqueta (uno) o entre ellos (varios); repartir parejo con 3 o más. */
  function align(kind: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdist" | "vdist") {
    const items = selected.filter((e) => !e.locked);
    if (!items.length) return;
    const multi = items.length > 1;
    const minX = multi ? Math.min(...items.map((e) => e.x)) : 0, maxX = multi ? Math.max(...items.map((e) => e.x + e.w)) : design.w;
    const minY = multi ? Math.min(...items.map((e) => e.y)) : 0, maxY = multi ? Math.max(...items.map((e) => e.y + e.h)) : design.h;
    const pos = new Map<string, { x?: number; y?: number }>();
    if (kind === "hdist" || kind === "vdist") {
      if (items.length < 3) return;
      const horiz = kind === "hdist";
      const sorted = [...items].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
      const span = horiz ? maxX - minX : maxY - minY;
      const sizes = sorted.reduce((s, e) => s + (horiz ? e.w : e.h), 0);
      const gap = (span - sizes) / (sorted.length - 1);
      let at = horiz ? minX : minY;
      for (const e of sorted) { pos.set(e.id, horiz ? { x: r2(at) } : { y: r2(at) }); at += (horiz ? e.w : e.h) + gap; }
    } else {
      for (const e of items) {
        if (kind === "left") pos.set(e.id, { x: r2(minX) });
        if (kind === "right") pos.set(e.id, { x: r2(maxX - e.w) });
        if (kind === "hcenter") pos.set(e.id, { x: r2((minX + maxX) / 2 - e.w / 2) });
        if (kind === "top") pos.set(e.id, { y: r2(minY) });
        if (kind === "bottom") pos.set(e.id, { y: r2(maxY - e.h) });
        if (kind === "vcenter") pos.set(e.id, { y: r2((minY + maxY) / 2 - e.h / 2) });
      }
    }
    commit({ ...design, elements: design.elements.map((e) => (pos.has(e.id) ? ({ ...e, ...pos.get(e.id) } as LabelElement) : e)) });
  }
  function nudge(dx: number, dy: number) {
    if (!sel.length) return;
    commit({ ...design, elements: design.elements.map((e) => (sel.includes(e.id) && !e.locked ? ({ ...e, x: r2(e.x + dx), y: r2(e.y + dy) } as LabelElement) : e)) }, `nudge:${sel.join(",")}`);
  }

  // ------------------------------------------------------------ teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && k === "d") { e.preventDefault(); duplicateSel(); }
      else if (mod && k === "c") { clip.current = selected.map((x) => ({ ...x })); }
      else if (mod && k === "x") { clip.current = selected.map((x) => ({ ...x })); removeSel(); }
      else if (mod && k === "v") { e.preventDefault(); paste(); }
      else if (mod && k === "a") { e.preventDefault(); setSel(design.elements.filter((x) => !x.hidden).map((x) => x.id)); }
      else if (mod && k === "s") { e.preventDefault(); void save(false); }
      else if (k === "delete" || k === "backspace") { if (sel.length) { e.preventDefault(); removeSel(); } }
      else if (k === "escape") { setSel([]); setMenu(null); }
      else if (k.startsWith("arrow")) {
        if (!sel.length) return;
        e.preventDefault();
        const s = e.shiftKey ? 1 : 0.1;
        nudge(k === "arrowleft" ? -s : k === "arrowright" ? s : 0, k === "arrowup" ? -s : k === "arrowdown" ? s : 0);
      } else if (k === "+" || k === "=") setZoom((z) => Math.min(40, z + 1));
      else if (k === "-") setZoom((z) => Math.max(3, z - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------ arrastrar y cambiar tamaño (con guías magnéticas)
  const snapTargets = useCallback((skip: Set<string>) => {
    const xs = [0, design.w / 2, design.w], ys = [0, design.h / 2, design.h];
    for (const e of design.elements) {
      if (skip.has(e.id) || e.hidden) continue;
      xs.push(e.x, e.x + e.w / 2, e.x + e.w);
      ys.push(e.y, e.y + e.h / 2, e.y + e.h);
    }
    return { xs, ys };
  }, [design]);

  function onDown(e: RPointerEvent, el: LabelElement, handle?: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    if (!handle) {
      if (e.shiftKey) { setSel((s) => (s.includes(el.id) ? s.filter((x) => x !== el.id) : [...s, el.id])); return; }
      if (!sel.includes(el.id)) setSel([el.id]);
    }
    if (el.locked) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const ids = !handle && sel.includes(el.id) ? sel : [el.id];
    drag.current = handle
      ? { mode: "resize", id: el.id, handle, sx: e.clientX, sy: e.clientY, orig: { ...el }, before: design }
      : { mode: "move", id: el.id, sx: e.clientX, sy: e.clientY, orig: new Map(design.elements.filter((x) => ids.includes(x.id) && !x.locked).map((x) => [x.id, { x: x.x, y: x.y }])), before: design };
  }
  function onMove(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    const thr = 6 / zoom;
    const snap = (v: number) => (grid && !e.altKey ? Math.round(v / GRID) * GRID : v);
    if (d.mode === "move") {
      const main = d.before.elements.find((x) => x.id === d.id)!;
      const o = d.orig.get(d.id) ?? { x: main.x, y: main.y };
      let nx = o.x + dx, ny = o.y + dy;
      const { xs, ys } = snapTargets(new Set(d.orig.keys()));
      const gs: Guide[] = [];
      let bestX: { d: number; at: number; off: number } | null = null;
      for (const off of [0, main.w / 2, main.w]) for (const t of xs) { const dd = Math.abs(nx + off - t); if (dd < thr && (!bestX || dd < bestX.d)) bestX = { d: dd, at: t, off }; }
      let bestY: { d: number; at: number; off: number } | null = null;
      for (const off of [0, main.h / 2, main.h]) for (const t of ys) { const dd = Math.abs(ny + off - t); if (dd < thr && (!bestY || dd < bestY.d)) bestY = { d: dd, at: t, off }; }
      if (bestX && !e.altKey) { nx = bestX.at - bestX.off; gs.push({ axis: "x", at: bestX.at }); } else nx = snap(nx);
      if (bestY && !e.altKey) { ny = bestY.at - bestY.off; gs.push({ axis: "y", at: bestY.at }); } else ny = snap(ny);
      setGuides(gs);
      const ddx = nx - o.x, ddy = ny - o.y;
      setDesign({ ...d.before, elements: d.before.elements.map((x) => { const p = d.orig.get(x.id); return p ? ({ ...x, x: r2(p.x + ddx), y: r2(p.y + ddy) } as LabelElement) : x; }) });
    } else {
      const o = d.orig;
      let { x, y, w, h } = o;
      const hd = d.handle;
      if (hd.includes("e")) w = snap(o.x + o.w + dx) - o.x;
      if (hd.includes("s")) h = snap(o.y + o.h + dy) - o.y;
      if (hd.includes("w")) { x = snap(o.x + dx); w = o.x + o.w - x; }
      if (hd.includes("n")) { y = snap(o.y + dy); h = o.y + o.h - y; }
      if (o.type === "qr") {
        // El QR es cuadrado: la caja cambia pareja.
        const s = Math.max(w, h);
        if (hd.includes("w")) x = o.x + o.w - s;
        if (hd.includes("n")) y = o.y + o.h - s;
        w = s; h = s;
      }
      if (o.type !== "line") { w = Math.max(0.5, w); h = Math.max(0.5, h); }
      setDesign({ ...d.before, elements: d.before.elements.map((x0) => (x0.id === d.id ? ({ ...x0, x: r2(x), y: r2(y), w: r2(w), h: r2(h) } as LabelElement) : x0)) });
    }
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    if (!d) return;
    // Un solo paso de historial por arrastre (el diseño de antes de empezar).
    setHist((s) => (sameDesign(s.present, d.before) ? s : { past: [...s.past.slice(-99), d.before], present: s.present, future: [] }));
  }

  // ------------------------------------------------------------ guardar
  async function save(asNew: boolean) {
    if (saving) return;
    if (!canSave) return void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "info", title: "Sin permiso para guardar", text: "Para guardar plantillas necesitas el permiso «Editar productos». Puedes usarla para imprimir sin guardarla." });
    let finalName = name.trim() || "Mi etiqueta";
    if (asNew) {
      const r = await Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6", title: "Guardar como plantilla nueva", input: "text", inputValue: `${finalName} (copia)`, showCancelButton: true, confirmButtonText: "Guardar", cancelButtonText: "Cancelar", inputValidator: (v) => (String(v ?? "").trim() ? null : "Escribe un nombre") });
      if (!r.isConfirmed) return;
      finalName = String(r.value).trim().slice(0, 80);
    }
    setSaving(true);
    const id = await onSave({ id: asNew ? null : savedId, name: finalName, category: category.trim() || null, design }, asNew);
    setSaving(false);
    if (!id) return;
    try { window.localStorage.removeItem(draftKey(storeId, savedId ?? baseId)); window.localStorage.removeItem(draftKey(storeId, baseId)); } catch { /* nada */ }
    setSavedId(id);
    setName(finalName);
    setSaved(design);
    void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "success", title: "Plantilla guardada", timer: 1300, showConfirmButton: false });
  }
  async function close() {
    if (dirty) {
      const r = await Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6", icon: "warning", title: "Tienes cambios sin guardar", text: "Quedan como borrador en este equipo para recuperarlos después.", showCancelButton: true, confirmButtonText: "Salir", cancelButtonText: "Seguir editando" });
      if (!r.isConfirmed) return;
    }
    onClose();
  }

  // ------------------------------------------------------------ dibujo
  const W = design.w * zoom, H = design.h * zoom;
  const svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.w} ${design.h}" width="${W}" height="${H}" style="display:block">${MONO_DEFS}<rect width="${design.w}" height="${design.h}" fill="#fff"/>${rendered.body}</svg>`;
  const ticks = (len: number) => Array.from({ length: Math.floor(len) + 1 }, (_, i) => i);
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handlePos: Record<string, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

  return (
    <div className="fixed inset-0 z-110 flex flex-col" style={{ background: "var(--t-bg-base)", color: "var(--t-text)" }}>
      {/* ------------------------------------------------ barra superior */}
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--t-card-border)" }}>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className="h-9 min-w-0 flex-1 rounded-xl border px-3 text-sm font-black sm:max-w-xs" style={inputStyle} aria-label="Nombre de la plantilla" />
        <input value={category} onChange={(e) => setCategory(e.target.value.slice(0, 40))} placeholder="Categoría" className="hidden h-9 w-32 rounded-xl border px-3 text-sm md:block" style={inputStyle} />
        <div className="flex items-center gap-1">
          <IconBtn title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 size={16} /></IconBtn>
          <IconBtn title="Rehacer (Ctrl+Y)" onClick={redo} disabled={!future.length}><Redo2 size={16} /></IconBtn>
          <span className="mx-1 h-6 w-px" style={{ background: "var(--t-card-border)" }} />
          <IconBtn title="Alejar" onClick={() => setZoom((z) => Math.max(3, z - 1))}><ZoomOut size={16} /></IconBtn>
          <button type="button" onClick={fit} className="h-9 rounded-lg px-2 text-xs font-bold tabular-nums" title="Ajustar a la pantalla">{Math.round((zoom / 3.78) * 100)} %</button>
          <IconBtn title="Acercar" onClick={() => setZoom((z) => Math.min(40, z + 1))}><ZoomIn size={16} /></IconBtn>
          <IconBtn title={`Cuadrícula de ${GRID} mm (Alt al arrastrar la ignora)`} onClick={() => setGrid((g) => !g)} active={grid}><Grid3x3 size={16} /></IconBtn>
          <IconBtn title="Vista de impresión (sin guías)" onClick={() => setPrintView((v) => !v)} active={printView}><Eye size={16} /></IconBtn>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="soft" onClick={() => onUse(design, name)} title="Imprimir con este diseño (sin guardarlo)">Usar para imprimir</Button>
          {savedId ? <Button variant="soft" onClick={() => void save(true)} disabled={saving}>Guardar como…</Button> : null}
          <Button variant="primary" icon={<Save size={15} />} onClick={() => void save(false)} busy={saving} disabled={!dirty && Boolean(savedId)}>{savedId ? (dirty ? "Guardar" : "Guardado") : "Guardar plantilla"}</Button>
          <IconBtn title="Cerrar" onClick={() => void close()}><X size={18} /></IconBtn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------ elementos y capas */}
        <aside className="order-2 flex shrink-0 flex-col gap-3 overflow-y-auto border-t p-3 lg:order-1 lg:w-60 lg:border-r lg:border-t-0" style={{ borderColor: "var(--t-card-border)" }}>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Agregar</p>
            <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-2">
              <AddBtn icon={<Type size={16} />} label="Texto" onClick={() => addElement(newText({ content: "Texto", w: Math.min(20, design.w - 2), h: 5 }))} />
              <AddBtn icon={<Type size={16} />} label="Nombre" onClick={() => addElement(newText({ name: "Nombre", content: "{nombre}", w: design.w - 2, h: Math.min(8, design.h / 3), maxLines: 2 }))} />
              <AddBtn icon={<Type size={16} />} label="Referencia" onClick={() => addElement(newText({ name: "Referencia", content: "{referencia|codigo}", w: design.w - 2, h: 4.5, maxLines: 1 }))} />
              <AddBtn icon={<Type size={16} />} label="Precio" onClick={() => addElement(newText({ name: "Precio", content: "{precio}", w: design.w - 2, h: 5, size: 11, maxLines: 1 }))} />
              <AddBtn icon={<QrCode size={16} />} label="QR" onClick={() => addElement(newQr({ w: Math.min(14, design.h - 2), h: Math.min(14, design.h - 2) }))} />
              <AddBtn icon={<Barcode size={16} />} label="Barras" onClick={() => addElement(newBarcode({ w: design.w - 2, h: Math.min(10, design.h / 2) }))} />
              <AddBtn icon={<ImageIcon size={16} />} label="Logo" onClick={() => addElement(newImage({ name: "Logo", src: "{logo}", w: Math.min(16, design.w - 2), h: Math.min(6, design.h / 3) }))} />
              <AddBtn icon={<ImageIcon size={16} />} label="Foto" onClick={() => addElement(newImage({ name: "Foto del producto", src: "{foto}", w: Math.min(12, design.w - 2), h: Math.min(12, design.h - 2), mono: true }))} />
              <AddBtn icon={<Square size={16} />} label="Cuadro" onClick={() => addElement(newRect({ w: design.w - 2, h: design.h - 2 }))} />
              <AddBtn icon={<Circle size={16} />} label="Círculo" onClick={() => addElement(newEllipse())} />
              <AddBtn icon={<Minus size={16} />} label="Línea" onClick={() => addElement(newLine({ w: design.w - 2 }))} />
            </div>
          </div>
          <div className="min-h-0">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>Capas ({design.elements.length})</p>
            <ul className="space-y-1">
              {[...design.elements].reverse().map((e) => (
                <li key={e.id} className="flex items-center gap-1 rounded-lg border px-1.5 py-1 text-xs"
                  style={{ borderColor: sel.includes(e.id) ? "var(--t-accent)" : "var(--t-card-border)", background: sel.includes(e.id) ? "color-mix(in oklab, var(--t-accent) 12%, transparent)" : undefined }}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold" onClick={(ev) => setSel((s) => (ev.shiftKey ? (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]) : [e.id]))}
                    style={{ color: badIds.has(e.id) ? "#ef4444" : undefined, opacity: e.hidden ? 0.5 : 1 }}>
                    {elementLabel(e)}{e.type === "text" ? <span className="font-normal" style={{ color: "var(--t-muted)" }}> · {e.content.split("\n")[0].slice(0, 18)}</span> : null}
                  </button>
                  <button type="button" title={e.hidden ? "Mostrar" : "Ocultar"} onClick={() => patch(e.id, { hidden: !e.hidden })}>{e.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  <button type="button" title={e.locked ? "Desbloquear" : "Bloquear"} onClick={() => patch(e.id, { locked: !e.locked })}>{e.locked ? <Lock size={13} /> : <Unlock size={13} style={{ opacity: 0.4 }} />}</button>
                </li>
              ))}
              {!design.elements.length ? <li className="text-xs" style={{ color: "var(--t-muted)" }}>Etiqueta en blanco: agrega elementos arriba.</li> : null}
            </ul>
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--t-muted)" }}>
            Atajos: flechas mueven 0,1 mm (Mayús 1 mm) · Ctrl+Z / Ctrl+Y · Ctrl+C / X / V · Ctrl+D duplica · Supr borra · Mayús+clic selecciona varios · clic derecho: más opciones.
          </p>
        </aside>

        {/* ------------------------------------------------ lienzo */}
        <main ref={stage} className="relative order-1 min-h-[45vh] flex-1 overflow-auto lg:order-2" style={{ background: "color-mix(in oklab, var(--t-text) 6%, var(--t-bg-base))" }}
          onPointerDown={() => { setSel([]); setMenu(null); }} onPointerMove={onMove} onPointerUp={onUp}>
          <div className="relative mx-auto my-8" style={{ width: W + 28, height: H + 28 }}>
            {/* reglas en mm */}
            <svg className="absolute left-7 top-0" width={W} height={24} aria-hidden>
              {ticks(design.w).map((i) => <line key={i} x1={i * zoom} x2={i * zoom} y1={i % 10 === 0 ? 6 : i % 5 === 0 ? 13 : 18} y2={24} stroke="currentColor" strokeOpacity={0.45} />)}
              {ticks(design.w).filter((i) => i % 5 === 0).map((i) => <text key={i} x={i * zoom + 2} y={11} fontSize={9} fill="currentColor" fillOpacity={0.7}>{i}</text>)}
            </svg>
            <svg className="absolute left-0 top-7" width={24} height={H} aria-hidden>
              {ticks(design.h).map((i) => <line key={i} y1={i * zoom} y2={i * zoom} x1={i % 10 === 0 ? 6 : i % 5 === 0 ? 13 : 18} x2={24} stroke="currentColor" strokeOpacity={0.45} />)}
              {ticks(design.h).filter((i) => i % 5 === 0).map((i) => <text key={i} x={1} y={i * zoom + 10} fontSize={9} fill="currentColor" fillOpacity={0.7}>{i}</text>)}
            </svg>
            <div className="absolute left-7 top-7 shadow-xl" style={{ width: W, height: H, borderRadius: 4 }}>
              <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
              {grid && !printView ? (
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, rgba(139,92,246,.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(139,92,246,.10) 1px, transparent 1px)", backgroundSize: `${zoom}px ${zoom}px` }} />
              ) : null}
              {!printView ? <div className="pointer-events-none absolute inset-0" style={{ outline: "1px solid #cbd5e1" }} /> : null}
              {/* cajas para seleccionar, mover y cambiar tamaño */}
              {!printView ? design.elements.map((e) => {
                if (e.hidden) return null;
                const isSel = sel.includes(e.id);
                const bw = Math.max(Math.abs(e.w) * zoom, 6), bh = Math.max(Math.abs(e.h) * zoom, 6);
                const left = Math.min(e.x, e.x + (e.type === "line" ? e.w : 0)) * zoom - (e.type === "line" && !e.h ? 0 : 0);
                const top = Math.min(e.y, e.y + (e.type === "line" ? e.h : 0)) * zoom - (e.type === "line" && !e.h ? 3 : 0);
                return (
                  <div key={e.id} onPointerDown={(ev) => onDown(ev, e)} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!sel.includes(e.id)) setSel([e.id]); setMenu({ x: ev.clientX, y: ev.clientY }); }}
                    className="absolute touch-none" title={elementLabel(e)}
                    style={{
                      left, top, width: bw, height: bh, cursor: e.locked ? "not-allowed" : "move",
                      transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
                      outline: isSel ? "1.5px solid var(--t-accent)" : badIds.has(e.id) ? "1.5px dashed #ef4444" : "1px dashed rgba(139,92,246,.35)",
                      background: isSel ? "rgba(139,92,246,.06)" : undefined,
                    }}>
                    {isSel && sel.length === 1 && !e.locked ? handles.filter((h) => e.type !== "line" || h === "e" || h === "w").map((h) => (
                      <span key={h} onPointerDown={(ev) => onDown(ev, e, h)} className="absolute h-2.5 w-2.5 rounded-sm border bg-white"
                        style={{ borderColor: "var(--t-accent)", left: `calc(${handlePos[h][0] * 100}% - 5px)`, top: `calc(${handlePos[h][1] * 100}% - 5px)`, cursor: `${h}-resize` }} />
                    )) : null}
                  </div>
                );
              }) : null}
              {guides.map((g, i) => (
                <div key={i} className="pointer-events-none absolute" style={g.axis === "x" ? { left: g.at * zoom, top: -8, bottom: -8, width: 1, background: "#ec4899" } : { top: g.at * zoom, left: -8, right: -8, height: 1, background: "#ec4899" }} />
              ))}
            </div>
          </div>
          <p className="pb-4 text-center text-[11px]" style={{ color: "var(--t-muted)" }}>
            {design.w} × {design.h} mm · vista con {sample.label} · <button type="button" className="underline" onPointerDown={(e) => e.stopPropagation()} onClick={onPickSample}>cambiar producto</button>
          </p>
        </main>

        {/* ------------------------------------------------ propiedades */}
        <aside className="order-3 shrink-0 space-y-3 overflow-y-auto border-t p-3 lg:w-80 lg:border-l lg:border-t-0" style={{ borderColor: "var(--t-card-border)" }}>
          {!selected.length ? (
            <LabelProps design={design} profile={profile} onSize={(w, h, scale) => commit(scale ? resizeDesign(design, w, h) : { ...design, w, h })} />
          ) : (
            <>
              {selected.length > 1 ? <p className="text-xs font-bold">{selected.length} elementos seleccionados</p> : null}
              <div className="flex flex-wrap gap-1">
                <IconBtn title={selected.length > 1 ? "Alinear a la izquierda" : "A la izquierda de la etiqueta"} onClick={() => align("left")}><AlignStartVertical size={15} /></IconBtn>
                <IconBtn title="Centrar horizontal" onClick={() => align("hcenter")}><AlignCenterVertical size={15} /></IconBtn>
                <IconBtn title="A la derecha" onClick={() => align("right")}><AlignEndVertical size={15} /></IconBtn>
                <IconBtn title="Arriba" onClick={() => align("top")}><AlignStartHorizontal size={15} /></IconBtn>
                <IconBtn title="Centrar vertical" onClick={() => align("vcenter")}><AlignCenterHorizontal size={15} /></IconBtn>
                <IconBtn title="Abajo" onClick={() => align("bottom")}><AlignEndHorizontal size={15} /></IconBtn>
                {selected.length > 2 ? <><IconBtn title="Repartir parejo a lo ancho" onClick={() => align("hdist")}>↔</IconBtn><IconBtn title="Repartir parejo a lo alto" onClick={() => align("vdist")}>↕</IconBtn></> : null}
                <span className="mx-0.5 h-8 w-px" style={{ background: "var(--t-card-border)" }} />
                <IconBtn title="Al frente" onClick={() => order("front")}><ChevronsUp size={15} /></IconBtn>
                <IconBtn title="Subir una capa" onClick={() => order("up")}><ArrowUp size={15} /></IconBtn>
                <IconBtn title="Bajar una capa" onClick={() => order("down")}><ArrowDown size={15} /></IconBtn>
                <IconBtn title="Al fondo" onClick={() => order("back")}><ChevronsDown size={15} /></IconBtn>
                <IconBtn title="Duplicar (Ctrl+D)" onClick={duplicateSel}><Copy size={15} /></IconBtn>
                <IconBtn title="Eliminar (Supr)" onClick={removeSel}><Trash2 size={15} className="text-red-400" /></IconBtn>
              </div>
              {one ? <ElementProps el={one} design={design} profile={profile} sample={sample.data} onPatch={(p, k) => patch(one.id, p, k)} onReplace={(el) => { commit({ ...design, elements: design.elements.map((e) => (e.id === one.id ? el : e)) }); setSel([el.id]); }} /> : null}
            </>
          )}
          <IssueList issues={rendered.issues} max={8} />
        </aside>
      </div>

      {menu ? (
        <div className="fixed z-130 w-48 rounded-xl border p-1 text-sm shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 280), borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}
          onPointerDown={(e) => e.stopPropagation()}>
          {[
            ["Duplicar", duplicateSel], ["Copiar", () => { clip.current = selected.map((x) => ({ ...x })); }], ["Pegar", paste],
            ["Al frente", () => order("front")], ["Al fondo", () => order("back")],
            ["Bloquear / desbloquear", () => selected.forEach((x) => patch(x.id, { locked: !x.locked }))],
            ["Ocultar", () => selected.forEach((x) => patch(x.id, { hidden: true }))], ["Eliminar", removeSel],
          ].map(([l, fn]) => (
            <button key={l as string} type="button" onClick={() => { (fn as () => void)(); setMenu(null); }} className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-[color-mix(in_oklab,var(--t-accent)_12%,transparent)]">{l as string}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, active }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className="grid h-9 min-w-9 place-items-center rounded-lg border px-1.5 text-sm disabled:opacity-35"
      style={active ? { borderColor: "var(--t-accent)", background: "color-mix(in oklab, var(--t-accent) 16%, transparent)" } : { borderColor: "var(--t-card-border)" }}>
      {children}
    </button>
  );
}
function AddBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[11px] font-bold transition hover:-translate-y-0.5" style={{ borderColor: "var(--t-card-border)" }}>
      {icon}{label}
    </button>
  );
}

// ------------------------------------------------------------ propiedades de la etiqueta
function LabelProps({ design, profile, onSize }: { design: LabelDesign; profile: PrinterProfile; onSize: (w: number, h: number, scale: boolean) => void }) {
  const [w, setW] = useState(design.w);
  const [h, setH] = useState(design.h);
  const differs = Math.abs(design.w - profile.labelW) > 0.05 || Math.abs(design.h - profile.labelH) > 0.05;
  return (
    <div className="space-y-2">
      <p className="text-xs font-black">Etiqueta</p>
      <div className="grid grid-cols-2 gap-2">
        <MmField label="Ancho" value={w} onChange={setW} min={5} max={500} />
        <MmField label="Alto" value={h} onChange={setH} min={5} max={500} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="soft" onClick={() => onSize(w, h, true)} disabled={w === design.w && h === design.h}>Cambiar y escalar todo</Button>
        <Button variant="ghost" onClick={() => onSize(w, h, false)} disabled={w === design.w && h === design.h}>Solo el tamaño</Button>
      </div>
      {differs ? (
        <button type="button" onClick={() => { setW(profile.labelW); setH(profile.labelH); onSize(profile.labelW, profile.labelH, true); }} className="w-full rounded-xl border px-3 py-2 text-left text-xs" style={{ borderColor: "#f59e0b", color: "#d97706" }}>
          ⚠️ «{profile.name}» usa etiquetas de {profile.labelW} × {profile.labelH} mm. <b>Tamaño de la impresora</b> →
        </button>
      ) : null}
      <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Toca un elemento para cambiarlo. Todo se mide en milímetros: el zoom no cambia lo que se imprime.</p>
    </div>
  );
}

// ------------------------------------------------------------ propiedades de un elemento
function ElementProps({ el, design, profile, sample, onPatch, onReplace }: {
  el: LabelElement; design: LabelDesign; profile: PrinterProfile; sample: LabelData;
  onPatch: (p: Partial<LabelElement>, coalesce?: string) => void; onReplace: (el: LabelElement) => void;
}) {
  const box = (
    <div className="grid grid-cols-4 gap-1.5">
      <MmField label="X" value={el.x} onChange={(v) => onPatch({ x: v })} disabled={el.locked} />
      <MmField label="Y" value={el.y} onChange={(v) => onPatch({ y: v })} disabled={el.locked} />
      <MmField label="Ancho" value={el.w} onChange={(v) => onPatch(el.type === "qr" ? { w: v, h: v } : { w: v })} min={el.type === "line" ? -1000 : 0.5} disabled={el.locked} />
      <MmField label="Alto" value={el.h} onChange={(v) => onPatch(el.type === "qr" ? { w: v, h: v } : { h: v })} min={el.type === "line" ? -1000 : 0.5} disabled={el.locked} />
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input value={el.name ?? ""} placeholder={elementLabel(el)} onChange={(e) => onPatch({ name: e.target.value.slice(0, 60) || undefined }, "name")} className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm font-bold" style={inputStyle} aria-label="Nombre de la capa" />
        <select value={el.rotation ?? 0} onChange={(e) => onPatch({ rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })} className="h-8 rounded-lg border px-1 text-xs" style={inputStyle} title="Girar">
          {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
        </select>
      </div>
      {box}
      {el.type === "text" ? <TextProps el={el} sample={sample} onPatch={onPatch} /> : null}
      {el.type === "qr" ? <QrProps el={el} sample={sample} dpi={profile.dpi} onPatch={onPatch} /> : null}
      {el.type === "barcode" ? <BarcodeProps el={el} sample={sample} dpi={profile.dpi} onPatch={onPatch} onToQr={() => onReplace(newQr({ id: newId(), x: el.x, y: el.y, w: Math.min(el.w, el.h * 1.6, design.h), h: Math.min(el.w, el.h * 1.6, design.h), content: el.content }))} /> : null}
      {el.type === "image" ? <ImageProps el={el} onPatch={onPatch} /> : null}
      {el.type === "rect" || el.type === "ellipse" ? (
        <div className="grid grid-cols-2 gap-2">
          <MmField label="Grosor del borde" value={el.stroke} onChange={(v) => onPatch({ stroke: v })} min={0} max={10} step={0.05} />
          <ColorField label="Color del borde" value={el.strokeColor} onChange={(v) => onPatch({ strokeColor: v ?? "#000000" }, "sc")} />
          <ColorField label="Relleno" value={el.fill} onChange={(v) => onPatch({ fill: v }, "fill")} nullable />
          {el.type === "rect" ? <MmField label="Esquinas redondas" value={el.radius} onChange={(v) => onPatch({ radius: v })} min={0} max={50} /> : null}
        </div>
      ) : null}
      {el.type === "line" ? (
        <div className="grid grid-cols-2 gap-2">
          <MmField label="Grosor" value={el.stroke} onChange={(v) => onPatch({ stroke: v })} min={0.05} max={10} step={0.05} />
          <ColorField label="Color" value={el.color} onChange={(v) => onPatch({ color: v ?? "#000000" }, "c")} />
          <Button variant="soft" onClick={() => onPatch({ h: 0 })}>Horizontal</Button>
          <Button variant="soft" onClick={() => onPatch({ w: 0 })}>Vertical</Button>
        </div>
      ) : null}
    </div>
  );
}

/** Botones de variables: se insertan donde está el cursor (no hay que escribir llaves). */
function VariablePicker({ onPick }: { onPick: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = [...new Set(VARIABLES.map((v) => v.group))];
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-full border px-2.5 py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>+ Dato del producto</button>
      {open ? (
        <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border p-2" style={{ borderColor: "var(--t-card-border)" }}>
          {groups.map((g) => (
            <div key={g}>
              <p className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>{g}</p>
              <div className="flex flex-wrap gap-1">
                {VARIABLES.filter((v) => v.group === g).map((v) => (
                  <button key={v.key} type="button" title={`Ej.: ${v.sample}`} onClick={() => { onPick(`{${v.key}}`); setOpen(false); }}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in oklab, var(--t-accent) 12%, transparent)" }}>{v.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContentField({ value, onChange, rows = 2, label }: { value: string; onChange: (v: string) => void; rows?: number; label: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const insert = (t: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length, e = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, s) + t + value.slice(e));
    window.setTimeout(() => { el?.focus(); el?.setSelectionRange(s + t.length, s + t.length); }, 0);
  };
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}
        <textarea ref={ref} value={value} rows={rows} onChange={(e) => onChange(e.target.value.slice(0, 2000))} className={`${inputCls} mt-0.5 font-mono text-[13px] normal-case`} style={inputStyle} />
      </label>
      <VariablePicker onPick={insert} />
    </div>
  );
}

function Toggle2({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button type="button" title={title} onClick={onClick} className="h-8 min-w-8 rounded-lg border px-2 text-xs font-bold" style={segBtn(on)}>{children}</button>;
}

function ColorField({ label, value, onChange, nullable }: { label: string; value: string | null; onChange: (v: string | null) => void; nullable?: boolean }) {
  return (
    <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--t-muted)" }}>{label}
      <span className="mt-0.5 flex items-center gap-1">
        <input type="color" value={value ?? "#ffffff"} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border" style={{ borderColor: "var(--t-card-border)" }} />
        {nullable ? <button type="button" onClick={() => onChange(value ? null : "#000000")} className="h-8 rounded-lg border px-2 text-[11px] normal-case" style={{ borderColor: "var(--t-card-border)" }}>{value ? "Quitar" : "Sin color"}</button> : null}
      </span>
    </label>
  );
}

function TextProps({ el, sample, onPatch }: { el: TextElement; sample: LabelData; onPatch: (p: Partial<TextElement>, k?: string) => void }) {
  const resolved = resolveTokens(el.content, sample);
  const fitRes = fitText(resolved, el, canvasMeasure);
  return (
    <div className="space-y-2">
      <ContentField label="Texto (Enter = otra línea)" value={el.content} onChange={(v) => onPatch({ content: v }, "content")} rows={3} />
      <p className="rounded-lg px-2 py-1 text-[11px]" style={{ background: "color-mix(in oklab, var(--t-text) 6%, transparent)" }}>
        Se ve: <b>{fitRes.lines.join(" ⏎ ") || "(vacío)"}</b> · {fitRes.lines.length} línea{fitRes.lines.length === 1 ? "" : "s"} · {fitRes.size} pt{fitRes.overflow ? " · ⚠️ no cabe" : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Letra
          <select value={el.font} onChange={(e) => onPatch({ font: e.target.value as FontKey })} className="mt-0.5 h-8 w-full rounded-lg border px-1 text-xs normal-case" style={inputStyle}>
            {(Object.keys(FONT_LABEL) as FontKey[]).map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Máx. líneas
          <select value={el.maxLines} onChange={(e) => onPatch({ maxLines: Number(e.target.value) })} className="mt-0.5 h-8 w-full rounded-lg border px-1 text-xs" style={inputStyle}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <MmField label={el.autoFit ? "Tamaño máx." : "Tamaño"} value={el.size} onChange={(v) => onPatch({ size: v })} min={1} max={200} step={0.5} unit="pt" />
        <MmField label="Tamaño mín." value={el.minSize} onChange={(v) => onPatch({ minSize: v })} min={1} max={200} step={0.5} unit="pt" disabled={!el.autoFit} />
        <MmField label="Alto de línea" value={el.lineHeight} onChange={(v) => onPatch({ lineHeight: v })} min={0.7} max={3} step={0.05} unit="×" />
        <MmField label="Entre letras" value={el.letterSpacing} onChange={(v) => onPatch({ letterSpacing: v })} min={-2} max={10} step={0.05} />
      </div>
      <div className="flex flex-wrap gap-1">
        <Toggle2 on={el.bold} onClick={() => onPatch({ bold: !el.bold })} title="Negrita"><b>N</b></Toggle2>
        <Toggle2 on={el.italic} onClick={() => onPatch({ italic: !el.italic })} title="Cursiva"><i>K</i></Toggle2>
        <Toggle2 on={el.underline} onClick={() => onPatch({ underline: !el.underline })} title="Subrayado"><u>S</u></Toggle2>
        <Toggle2 on={el.strike} onClick={() => onPatch({ strike: !el.strike })} title="Tachado"><s>T</s></Toggle2>
        <span className="mx-0.5" />
        {(["left", "center", "right"] as const).map((a) => <Toggle2 key={a} on={el.align === a} onClick={() => onPatch({ align: a })} title={a === "left" ? "Izquierda" : a === "center" ? "Centro" : "Derecha"}>{a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}</Toggle2>)}
        {(["top", "middle", "bottom"] as const).map((a) => <Toggle2 key={a} on={el.valign === a} onClick={() => onPatch({ valign: a })} title={a === "top" ? "Arriba" : a === "middle" ? "En medio" : "Abajo"}>{a === "top" ? "⤒" : a === "middle" ? "↕" : "⤓"}</Toggle2>)}
      </div>
      <div className="flex flex-wrap gap-1">
        <Toggle2 on={el.autoFit} onClick={() => onPatch({ autoFit: !el.autoFit })} title="Achica la letra hasta que quepa">Ajustar solo</Toggle2>
        <Toggle2 on={el.balance} onClick={() => onPatch({ balance: !el.balance })} title="Líneas de largo parejo">Líneas parejas</Toggle2>
        <Toggle2 on={el.breakWords} onClick={() => onPatch({ breakWords: !el.breakWords })} title="Partir palabras que no caben (puede cortar una referencia)">Partir palabras</Toggle2>
        {(["none", "upper", "lower"] as const).map((t) => <Toggle2 key={t} on={el.transform === t} onClick={() => onPatch({ transform: t })}>{t === "none" ? "Aa" : t === "upper" ? "AA" : "aa"}</Toggle2>)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ColorField label="Color" value={el.color} onChange={(v) => onPatch({ color: v ?? "#000000" }, "color")} />
        <ColorField label="Fondo" value={el.background} onChange={(v) => onPatch({ background: v }, "bg")} nullable />
        <MmField label="Margen" value={el.padding} onChange={(v) => onPatch({ padding: v })} min={0} max={20} />
      </div>
    </div>
  );
}

const QR_PRESETS: Array<[string, string]> = [
  ["Código", "{codigo}"], ["Referencia", "{referencia}"], ["Nombre + referencia", "{nombre} {referencia}"],
  ["Enlace al catálogo", "{url_producto}"], ["WhatsApp de la tienda", "{url_whatsapp}"],
];

function QrProps({ el, sample, dpi, onPatch }: { el: QrElement; sample: LabelData; dpi: number; onPatch: (p: Partial<QrElement>, k?: string) => void }) {
  const content = resolveTokens(el.content, sample).trim();
  const lay = layoutQr(content, el.ecc, el.quiet, el.w, el.h, dpi);
  const [wa, setWa] = useState({ phone: "", msg: "" });
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2">
      <ContentField label="Lo que lleva el QR (puede ser distinto del texto visible)" value={el.content} onChange={(v) => onPatch({ content: v }, "content")} />
      <div className="flex flex-wrap gap-1">
        {QR_PRESETS.map(([l, v]) => <button key={l} type="button" onClick={() => onPatch({ content: v })} className="rounded-md border px-1.5 py-0.5 text-[11px]" style={{ borderColor: el.content === v ? "var(--t-accent)" : "var(--t-card-border)" }}>{l}</button>)}
      </div>
      <details className="rounded-lg border p-2 text-xs" style={{ borderColor: "var(--t-card-border)" }}>
        <summary className="cursor-pointer font-bold">Enlace, WhatsApp, teléfono o correo</summary>
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-1">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (video, manual, garantía, red social)" className="h-8 min-w-0 flex-1 rounded-lg border px-2" style={inputStyle} />
            <button type="button" className="rounded-lg border px-2" style={{ borderColor: "var(--t-card-border)" }} onClick={() => { if (/^https:\/\/[^\s]+$/i.test(url.trim())) onPatch({ content: url.trim() }); else void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "info", title: "Enlace no válido", text: "Debe empezar por https:// (los enlaces http no son seguros)." }); }}>Usar</button>
          </div>
          <p className="text-[10px]" style={{ color: "var(--t-muted)" }}>Un QR con el enlace a una imagen o video lleva el enlace, no la imagen: se abre con internet.</p>
          <div className="flex gap-1">
            <input value={wa.phone} onChange={(e) => setWa({ ...wa, phone: e.target.value })} placeholder="WhatsApp 300 123 4567" inputMode="tel" className="h-8 w-32 rounded-lg border px-2" style={inputStyle} />
            <input value={wa.msg} onChange={(e) => setWa({ ...wa, msg: e.target.value })} placeholder="Mensaje (opcional)" className="h-8 min-w-0 flex-1 rounded-lg border px-2" style={inputStyle} />
            <button type="button" className="rounded-lg border px-2" style={{ borderColor: "var(--t-card-border)" }} onClick={() => {
              let d = wa.phone.replace(/\D/g, "");
              if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
              if (d.length < 8) return;
              onPatch({ content: `https://wa.me/${d}${wa.msg ? `?text=${encodeURIComponent(wa.msg)}` : ""}` });
            }}>Usar</button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)" }} onClick={async () => { const r = await Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", title: "Teléfono", input: "tel", showCancelButton: true }); const d = String(r.value ?? "").replace(/[^\d+]/g, ""); if (r.isConfirmed && d) onPatch({ content: `tel:${d}` }); }}>📞 Teléfono</button>
            <button type="button" className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--t-card-border)" }} onClick={async () => { const r = await Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", title: "Correo", input: "email", showCancelButton: true }); if (r.isConfirmed && r.value) onPatch({ content: `mailto:${String(r.value).trim()}` }); }}>✉️ Correo</button>
          </div>
        </div>
      </details>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }} title="Más alta = aguanta rayones, pero el QR sale más denso">Corrección
          <select value={el.ecc} onChange={(e) => onPatch({ ecc: e.target.value as Ecc })} className="mt-0.5 h-8 w-full rounded-lg border px-1 text-xs" style={inputStyle}>
            <option value="L">L · 7 %</option><option value="M">M · 15 %</option><option value="Q">Q · 25 %</option><option value="H">H · 30 %</option>
          </select>
        </label>
        <MmField label="Margen blanco" value={el.quiet} onChange={(v) => onPatch({ quiet: Math.round(v) })} min={0} max={8} step={1} unit="mód." />
        <ColorField label="Color" value={el.color} onChange={(v) => onPatch({ color: v ?? "#000000" }, "color")} />
      </div>
      <div className="flex flex-wrap gap-1">
        {(["left", "center", "right"] as const).map((a) => <Toggle2 key={a} on={el.align === a} onClick={() => onPatch({ align: a })}>{a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}</Toggle2>)}
        {(["top", "middle", "bottom"] as const).map((a) => <Toggle2 key={a} on={el.valign === a} onClick={() => onPatch({ valign: a })}>{a === "top" ? "⤒" : a === "middle" ? "↕" : "⤓"}</Toggle2>)}
      </div>
      {lay.ok ? (
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>
          {lay.n}×{lay.n} cuadritos de {lay.moduleMm.toFixed(3)} mm ({lay.moduleDots} punto{lay.moduleDots === 1 ? "" : "s"} a {dpi} dpi) · mide {lay.sideMm.toFixed(2)} mm · lleva «{content.slice(0, 60)}{content.length > 60 ? "…" : ""}»
        </p>
      ) : null}
    </div>
  );
}

function BarcodeProps({ el, sample, dpi, onPatch, onToQr }: { el: BarcodeElement; sample: LabelData; dpi: number; onPatch: (p: Partial<BarcodeElement>, k?: string) => void; onToQr: () => void }) {
  const content = resolveTokens(el.content, sample).trim();
  const lay = layoutBarcode(content, el.format, el.quiet, el.w, dpi);
  const fmt = BARCODE_FORMATS.find((f) => f.key === el.format);
  return (
    <div className="space-y-2">
      <ContentField label="Lo que lleva el código" value={el.content} onChange={(v) => onPatch({ content: v.replace(/\n/g, "") }, "content")} rows={1} />
      <label className="block text-[10px] font-bold uppercase" style={{ color: "var(--t-muted)" }}>Formato
        <select value={el.format} onChange={(e) => onPatch({ format: e.target.value as BarcodeElement["format"] })} className="mt-0.5 h-8 w-full rounded-lg border px-1 text-xs normal-case" style={inputStyle}>
          {BARCODE_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      <p className="text-[11px]" style={{ color: fmt?.commercial ? "#d97706" : "var(--t-muted)" }}>{fmt?.hint}</p>
      <div className="grid grid-cols-3 gap-2">
        <MmField label="Margen blanco" value={el.quiet} onChange={(v) => onPatch({ quiet: Math.round(v) })} min={0} max={20} step={1} unit="mód." />
        <MmField label="Letra" value={el.textSize} onChange={(v) => onPatch({ textSize: v })} min={2} max={30} step={0.5} unit="pt" disabled={!el.showText} />
        <ColorField label="Color" value={el.color} onChange={(v) => onPatch({ color: v ?? "#000000" }, "color")} />
      </div>
      <div className="flex flex-wrap gap-1">
        <Toggle2 on={el.showText} onClick={() => onPatch({ showText: !el.showText })}>Números debajo</Toggle2>
        {(["left", "center", "right"] as const).map((a) => <Toggle2 key={a} on={el.align === a} onClick={() => onPatch({ align: a })}>{a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}</Toggle2>)}
      </div>
      {lay.ok ? (
        <p className="text-[11px]" style={{ color: "var(--t-muted)" }}>Barra más delgada: {lay.moduleMm.toFixed(3)} mm ({lay.moduleDots} punto{lay.moduleDots === 1 ? "" : "s"}) · ancho {lay.widthMm.toFixed(1)} de {el.w} mm · lleva «{lay.text}»</p>
      ) : (
        <Button variant="soft" icon={<QrCode size={14} />} onClick={onToQr}>Cambiar a QR con el mismo contenido</Button>
      )}
    </div>
  );
}

function ImageProps({ el, onPatch }: { el: ImageElement; onPatch: (p: Partial<ImageElement>, k?: string) => void }) {
  const [url, setUrl] = useState(el.src.startsWith("https://") ? el.src : "");
  async function upload(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "info", title: "Formato no permitido", text: "Usa PNG, JPG, WEBP o GIF (SVG no, por seguridad)." });
    // Se achica a 600 px y se guarda dentro de la plantilla (PNG).
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) return;
    const s = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/png");
    if (data.length > 500_000) return void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "info", title: "Imagen muy pesada", text: "Usa una imagen más sencilla (logo de pocos colores)." });
    onPatch({ src: data });
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Toggle2 on={el.src === "{logo}"} onClick={() => onPatch({ src: "{logo}" })}>Logo de la tienda</Toggle2>
        <Toggle2 on={el.src === "{foto}"} onClick={() => onPatch({ src: "{foto}" })}>Foto del producto</Toggle2>
        <label className="h-8 cursor-pointer rounded-lg border px-2 text-xs font-bold leading-8" style={segBtn(el.src.startsWith("data:"))}>
          Subir… <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </div>
      <div className="flex gap-1">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (imagen por enlace)" className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-xs" style={inputStyle} />
        <button type="button" className="rounded-lg border px-2 text-xs" style={{ borderColor: "var(--t-card-border)" }} onClick={() => { if (safeImageUrl(url)) onPatch({ src: url.trim() }); else void Swal.fire({ background: "var(--t-bg-base)", color: "var(--t-text)", icon: "info", title: "Enlace no válido", text: "Debe ser https://…" }); }}>Usar</button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Toggle2 on={el.fit === "contain"} onClick={() => onPatch({ fit: "contain" })}>Completa</Toggle2>
        <Toggle2 on={el.fit === "cover"} onClick={() => onPatch({ fit: "cover" })}>Llenar recortando</Toggle2>
        <Toggle2 on={el.mono} onClick={() => onPatch({ mono: !el.mono })} title="Mejor para impresoras térmicas">Blanco y negro</Toggle2>
      </div>
    </div>
  );
}

