"use client";

import { useEffect, useRef, useState } from "react";
import { LandingView, type LandingData } from "@/app/[slug]/oferta/[page]/LandingView";

type Mode = "edit" | "test";
type Box = { top: number; left: number; width: number; height: number; label: string; target: string; field: boolean } | null;

const post = (msg: Record<string, unknown>) => window.parent?.postMessage(msg, window.location.origin);
const rectOf = (el: HTMLElement) => el.getBoundingClientRect();

/**
 * Vista previa de una landing dentro del editor (en un marco, para que la barra fija,
 * el botón de WhatsApp y las ventanas se vean como en el celular). Recibe los datos del
 * editor por postMessage (solo del mismo sitio). No registra visitas ni crea pedidos.
 *   · Modo editar: al pasar el mouse se resalta cada parte; los textos se editan ahí mismo
 *     (se guardan al salir o con Enter) y «Más opciones» abre su sección en el editor.
 *   · Modo probar: funciona como para el cliente.
 *   · Al editar una sección en el editor, la vista previa baja sola a esa parte.
 */
export default function LandingPreviewPage() {
  const [data, setData] = useState<LandingData | null>(null);
  const [key, setKey] = useState(0);
  const [mode, setMode] = useState<Mode>("edit");
  const [box, setBox] = useState<Box>(null);
  const [flash, setFlash] = useState<Box>(null);
  const [editing, setEditing] = useState(false);
  const chip = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | null>(null);

  /** Baja a la parte que se está editando en el editor y la resalta un momento. */
  async function focusTarget(target: string) {
    const find = () => document.querySelector<HTMLElement>(`[data-edit="${CSS.escape(target)}"]`);
    let el = find();
    if (!el && ["bundles", "payments", "form"].includes(target)) {
      window.postMessage({ type: "remhub-landing-cmd", cmd: "sheet" }, window.location.origin);
      await new Promise((r) => setTimeout(r, 450));
      el = find();
    }
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      const r = rectOf(el!);
      setFlash({ top: r.top, left: r.left, width: r.width, height: r.height, label: el!.dataset.editLabel ?? "", target, field: false });
      window.setTimeout(() => setFlash(null), 1400);
    }, 450);
  }

  /** Texto editable ahí mismo: al salir o con Enter se guarda en el editor; Esc lo deja como estaba. */
  function startInline(el: HTMLElement) {
    const field = el.dataset.field;
    if (!field) return;
    const before = el.innerText;
    active.current = el;
    setEditing(true);
    setBox(null);
    try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.classList.add("lp-inline-on");
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const multi = /\.(text|a)$|^subheadline$|^cta_block\.text$/.test(field);
    const finish = (save: boolean) => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.contentEditable = "false";
      el.classList.remove("lp-inline-on");
      const value = el.innerText.replace(/ /g, " ").trim();
      if (!save || !value) el.innerText = before;
      else if (value !== before.trim()) post({ type: "remhub-landing-set", field, value });
      active.current = null;
      setEditing(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); el.blur(); }
      else if (ev.key === "Enter" && (!multi || !ev.shiftKey)) { ev.preventDefault(); el.blur(); }
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; data?: LandingData; reset?: boolean; mode?: Mode; target?: string } | null;
      if (msg?.type === "remhub-landing-mode" && (msg.mode === "edit" || msg.mode === "test")) { setMode(msg.mode); setBox(null); return; }
      if (msg?.type === "remhub-landing-focus" && msg.target) { void focusTarget(msg.target); return; }
      if (msg?.type !== "remhub-landing-preview" || !msg.data) return;
      // Mientras se escribe un texto aquí, no se repinta (se perdería lo escrito).
      if (active.current) return;
      setData(msg.data);
      if (msg.mode) setMode(msg.mode);
      if (msg.reset) setKey((k) => k + 1);
    };
    window.addEventListener("message", onMessage);
    post({ type: "remhub-landing-preview-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Modo editar: se atrapan los toques antes que la página.
  useEffect(() => {
    if (mode !== "edit") return;
    const editOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-edit]") : null);
    const onClick = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (chip.current && t && chip.current.contains(t)) return;
      if (active.current && t && active.current.contains(t)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const field = t instanceof Element ? t.closest<HTMLElement>("[data-field]") : null;
      if (field) { startInline(field); return; }
      const el = editOf(t);
      if (el?.dataset.edit) post({ type: "remhub-landing-edit", target: el.dataset.edit });
    };
    const onMove = (ev: Event) => {
      if (active.current) return;
      const t = ev.target as Element | null;
      if (chip.current && t && chip.current.contains(t)) return;
      const el = editOf(t);
      if (!el) { setBox(null); return; }
      const fieldEl = t instanceof Element ? t.closest<HTMLElement>("[data-field]") : null;
      const show = fieldEl && el.contains(fieldEl) ? fieldEl : el;
      const r = rectOf(show);
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height, label: el.dataset.editLabel ?? "Editar", target: el.dataset.edit ?? "", field: Boolean(fieldEl) });
    };
    const hide = () => { if (!active.current) setBox(null); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("touchstart", onMove, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("touchstart", onMove, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, [mode]);

  if (!data) return <main className="grid min-h-screen place-items-center bg-white text-sm text-slate-400">Cargando vista previa…</main>;
  return (
    <>
      <style>{`.lp-inline-on{outline:2px solid #7c3aed!important;outline-offset:3px;border-radius:6px;background:rgba(124,58,237,.08);cursor:text;caret-color:#7c3aed}`}</style>
      <LandingView key={key} data={data} preview editMode={mode === "edit"} />
      {mode === "edit" && box && !editing ? (
        <div className="pointer-events-none fixed z-100 rounded-xl border-2 border-dashed" style={{ top: box.top - 3, left: box.left - 3, width: box.width + 6, height: box.height + 6, borderColor: "#7c3aed", background: "rgba(124,58,237,.07)" }}>
          <div ref={chip} className="pointer-events-auto absolute -top-4 left-2 flex items-center gap-1 whitespace-nowrap">
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white shadow" style={{ background: "#7c3aed" }}>{box.field ? "✏️ Toca el texto para escribir" : `✏️ ${box.label}`}</span>
            <button type="button" onClick={() => post({ type: "remhub-landing-edit", target: box.target })} className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold shadow ring-1 ring-violet-300" style={{ color: "#7c3aed" }}>⚙️ Más opciones</button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-100 flex justify-center">
          <span className="rounded-full px-3 py-1 text-[11px] font-bold text-white shadow-lg" style={{ background: "#7c3aed" }}>✏️ Escribiendo · Enter o toca afuera para guardar · Esc para cancelar</span>
        </div>
      ) : null}
      {flash ? (
        <div className="pointer-events-none fixed z-100 animate-pulse rounded-xl border-4" style={{ top: flash.top - 4, left: flash.left - 4, width: flash.width + 8, height: flash.height + 8, borderColor: "#7c3aed" }} />
      ) : null}
    </>
  );
}
