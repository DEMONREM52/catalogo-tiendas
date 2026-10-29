"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ALargeSmall, AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CaseLower, CaseSensitive, CaseUpper, Code, Eye, Heading1, Heading2, Heading3,
  Highlighter, Italic, Link, List, ListOrdered, Minus, Palette, Pilcrow, Redo2, RemoveFormatting, Smile, Strikethrough, TextQuote, Underline, Undo2,
} from "lucide-react";
import Swal from "sweetalert2";
import { editorDomToRich, hasFormat, richToEditorHtml } from "@/lib/rich-text";

/**
 * Editor de descripciones como Word: negrita, cursiva, subrayado, colores, resaltado, tamaños, títulos,
 * listas, citas, alineación, enlaces, emojis y MAYÚSCULAS/minúsculas. Guarda texto con marcas (lib/rich-text),
 * así lo que ya estaba escrito con **negrita** o ### títulos se ve con su formato.
 */
const COLORS = ["#e11d48", "#f97316", "#eab308", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#78716c"];
const EMOJIS = ["✅", "⭐", "🔥", "💯", "🚀", "📦", "🚚", "💳", "🎁", "⚡", "📏", "🔋", "🛡️", "💪", "👍", "❤️", "👉", "📌", "⚠️", "❌", "🕒", "🌟", "🏆", "😍"];

function Btn({ title, on, onClick, children }: { title: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-xs font-bold transition hover:bg-[color:var(--t-card-bg-soft,rgba(127,127,127,.15))]"
      style={on ? { background: "color-mix(in oklab, var(--t-accent) 22%, transparent)", color: "var(--t-accent)" } : undefined}>
      {children}
    </button>
  );
}
function Sep() {
  return <span className="mx-0.5 h-5 w-px self-center" style={{ background: "var(--t-card-border)" }} />;
}

type Menu = "color" | "size" | "emoji" | null;

export function RichTextEditor({ value, onChange, placeholder, maxLength, minHeight = 140, className, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; minHeight?: number;
  className?: string; style?: React.CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});

  // Lo que llega de afuera (cargar el producto, «modo texto») se pinta en el editor; lo que se escribe no.
  useEffect(() => {
    const el = box.current;
    if (!el || raw || value === last.current) return;
    el.innerHTML = richToEditorHtml(value);
    last.current = value;
  }, [value, raw]);

  useEffect(() => {
    const onSel = () => {
      const el = box.current;
      const sel = document.getSelection();
      if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return;
      const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
      setActive({ bold: q("bold"), italic: q("italic"), underline: q("underline"), strike: q("strikeThrough"), ul: q("insertUnorderedList"), ol: q("insertOrderedList") });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const emit = () => {
    const el = box.current;
    if (!el) return;
    const md = editorDomToRich(el);
    last.current = md;
    onChange(md);
  };
  const exec = (cmd: string, arg?: string) => {
    box.current?.focus();
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch { /* algunos navegadores no lo tienen */ }
    document.execCommand(cmd, false, arg);
    emit();
  };
  const highlight = (on: boolean) => {
    box.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, on ? "#fde047" : "transparent");
    document.execCommand("styleWithCSS", false, "false");
    emit();
  };
  const changeCase = (mode: "upper" | "lower" | "sentence") => {
    const t = document.getSelection()?.toString() ?? "";
    if (!t) return void Swal.fire({ toast: true, position: "top-end", timer: 2200, showConfirmButton: false, icon: "info", title: "Selecciona el texto primero" });
    const lower = t.toLocaleLowerCase("es-CO");
    exec("insertText", mode === "upper" ? t.toLocaleUpperCase("es-CO") : mode === "lower" ? lower : lower.replace(/(^\s*|[.!?¡¿]\s+|\n\s*)(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase("es-CO")));
  };
  const link = async () => {
    const sel = document.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const { value: url } = await Swal.fire({
      title: "Enlace", input: "url", inputPlaceholder: "https://…", showCancelButton: true, confirmButtonText: "Poner enlace", cancelButtonText: "Cancelar",
      background: "var(--t-bg-base)", color: "var(--t-text)", confirmButtonColor: "#8b5cf6",
      inputValidator: (v) => (/^https?:\/\/\S+$/i.test(v) ? undefined : "Escribe un enlace que empiece por https://"),
    });
    if (!url) return;
    box.current?.focus();
    if (range) { sel?.removeAllRanges(); sel?.addRange(range); }
    if (range && !range.collapsed) exec("createLink", url);
    else exec("insertHTML", richToEditorHtml(`[${url}](${url})`).replace(/^<div>|<\/div>$/g, ""));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    let md = text;
    // Lo pegado de Word o de una página se limpia: queda solo el formato que entiende el editor.
    if (html) md = editorDomToRich(new DOMParser().parseFromString(html, "text/html").body);
    if (!html && !hasFormat(text)) return exec("insertText", text);
    const out = richToEditorHtml(md);
    exec("insertHTML", /^<div>(?:(?!<div)[\s\S])*<\/div>$/.test(out) ? out.slice(5, -6) : out);
  };

  const len = value.length;

  return (
    <div className={`mt-1 overflow-visible rounded-2xl border ${className ?? ""}`} style={{ borderColor: "var(--t-card-border)", ...style }}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-2xl border-b p-1.5" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
        {raw ? (
          <span className="px-2 text-xs" style={{ color: "var(--t-muted)" }}>Modo texto: **negrita** · *cursiva* · ++subrayado++ · ~~tachado~~ · ==resaltado== · {"{#e11d48|color}"} · # título · - lista</span>
        ) : (
          <>
            <Btn title="Deshacer (Ctrl+Z)" onClick={() => exec("undo")}><Undo2 size={15} /></Btn>
            <Btn title="Rehacer (Ctrl+Y)" onClick={() => exec("redo")}><Redo2 size={15} /></Btn>
            <Sep />
            <Btn title="Negrita (Ctrl+B)" on={active.bold} onClick={() => exec("bold")}><Bold size={15} /></Btn>
            <Btn title="Cursiva (Ctrl+I)" on={active.italic} onClick={() => exec("italic")}><Italic size={15} /></Btn>
            <Btn title="Subrayado (Ctrl+U)" on={active.underline} onClick={() => exec("underline")}><Underline size={15} /></Btn>
            <Btn title="Tachado" on={active.strike} onClick={() => exec("strikeThrough")}><Strikethrough size={15} /></Btn>
            <Btn title="Resaltar" onClick={() => highlight(true)}><Highlighter size={15} /></Btn>
            <div className="relative">
              <Btn title="Color de letra" on={menu === "color"} onClick={() => setMenu(menu === "color" ? null : "color")}><Palette size={15} /></Btn>
              {menu === "color" ? (
                <div className="absolute left-0 top-9 z-20 grid w-44 grid-cols-5 gap-1.5 rounded-xl border p-2 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                  {COLORS.map((c) => <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { exec("foreColor", c); setMenu(null); }} className="h-6 w-6 rounded-full border border-white/30 transition hover:scale-110" style={{ background: c }} aria-label={`Color ${c}`} />)}
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { highlight(false); setMenu(null); }} className="col-span-5 mt-1 rounded-lg border py-1 text-[11px] font-bold" style={{ borderColor: "var(--t-card-border)" }}>Quitar resaltado</button>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <Btn title="Tamaño de letra" on={menu === "size"} onClick={() => setMenu(menu === "size" ? null : "size")}><ALargeSmall size={15} /></Btn>
              {menu === "size" ? (
                <div className="absolute left-0 top-9 z-20 w-36 rounded-xl border p-1 shadow-xl" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                  {([["5", "Grande", "text-lg"], ["3", "Normal", "text-sm"], ["2", "Pequeña", "text-xs"]] as const).map(([v, l, c]) => (
                    <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { exec("fontSize", v); setMenu(null); }} className={`block w-full rounded-lg px-2 py-1.5 text-left font-semibold hover:bg-[color:var(--t-card-bg-soft,rgba(127,127,127,.15))] ${c}`}>{l}</button>
                  ))}
                </div>
              ) : null}
            </div>
            <Sep />
            <Btn title="Texto normal" onClick={() => exec("formatBlock", "<div>")}><Pilcrow size={15} /></Btn>
            <Btn title="Título grande" onClick={() => exec("formatBlock", "<h1>")}><Heading1 size={15} /></Btn>
            <Btn title="Título mediano" onClick={() => exec("formatBlock", "<h2>")}><Heading2 size={15} /></Btn>
            <Btn title="Subtítulo" onClick={() => exec("formatBlock", "<h3>")}><Heading3 size={15} /></Btn>
            <Btn title="Cita" onClick={() => exec("formatBlock", "<blockquote>")}><TextQuote size={15} /></Btn>
            <Sep />
            <Btn title="Lista con viñetas" on={active.ul} onClick={() => exec("insertUnorderedList")}><List size={15} /></Btn>
            <Btn title="Lista numerada" on={active.ol} onClick={() => exec("insertOrderedList")}><ListOrdered size={15} /></Btn>
            <Btn title="Línea divisoria" onClick={() => exec("insertHorizontalRule")}><Minus size={15} /></Btn>
            <Sep />
            <Btn title="Alinear a la izquierda" onClick={() => exec("justifyLeft")}><AlignLeft size={15} /></Btn>
            <Btn title="Centrar" onClick={() => exec("justifyCenter")}><AlignCenter size={15} /></Btn>
            <Btn title="Alinear a la derecha" onClick={() => exec("justifyRight")}><AlignRight size={15} /></Btn>
            <Btn title="Justificar" onClick={() => exec("justifyFull")}><AlignJustify size={15} /></Btn>
            <Sep />
            <Btn title="MAYÚSCULAS" onClick={() => changeCase("upper")}><CaseUpper size={15} /></Btn>
            <Btn title="minúsculas" onClick={() => changeCase("lower")}><CaseLower size={15} /></Btn>
            <Btn title="Tipo oración" onClick={() => changeCase("sentence")}><CaseSensitive size={15} /></Btn>
            <Btn title="Enlace" onClick={() => void link()}><Link size={15} /></Btn>
            <div className="relative">
              <Btn title="Emojis" on={menu === "emoji"} onClick={() => setMenu(menu === "emoji" ? null : "emoji")}><Smile size={15} /></Btn>
              {menu === "emoji" ? (
                <div className="absolute right-0 top-9 z-20 grid w-56 grid-cols-6 gap-1 rounded-xl border p-2 shadow-xl sm:left-0 sm:right-auto" style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)" }}>
                  {EMOJIS.map((em) => <button key={em} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { exec("insertText", em); setMenu(null); }} className="rounded-lg p-1 text-lg transition hover:scale-125">{em}</button>)}
                </div>
              ) : null}
            </div>
            <Btn title="Quitar formato a lo seleccionado" onClick={() => exec("removeFormat")}><RemoveFormatting size={15} /></Btn>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          {maxLength ? <span className="px-1 text-[11px] font-semibold" style={{ color: len > maxLength ? "#ef4444" : "var(--t-muted)" }}>{len.toLocaleString("es-CO")} / {maxLength.toLocaleString("es-CO")}</span> : null}
          <Btn title={raw ? "Ver con formato" : "Modo texto (ver las marcas)"} on={raw} onClick={() => { setMenu(null); setRaw(!raw); last.current = null; }}>{raw ? <Eye size={15} /> : <Code size={15} />}</Btn>
        </span>
      </div>
      {raw ? (
        <textarea className="block w-full resize-y rounded-b-2xl bg-transparent p-3 font-mono text-sm outline-none" style={{ minHeight, color: "var(--t-text)" }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <div className="relative">
          {!value ? <p className="pointer-events-none absolute left-3 top-3 text-sm" style={{ color: "var(--t-muted)" }}>{placeholder}</p> : null}
          <div
            ref={box}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={placeholder ?? "Descripción"}
            onInput={emit}
            onBlur={emit}
            onPaste={onPaste}
            onFocus={() => setMenu(null)}
            className="max-h-[60vh] overflow-y-auto rounded-b-2xl p-3 text-sm leading-6 outline-none [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:italic [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-black [&_h2]:mt-2 [&_h2]:text-xl [&_h2]:font-black [&_h3]:mt-1 [&_h3]:text-lg [&_h3]:font-bold [&_hr]:my-3 [&_hr]:opacity-30 [&_mark]:rounded [&_mark]:bg-yellow-300 [&_mark]:px-0.5 [&_mark]:text-stone-900 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
            style={{ minHeight, color: "var(--t-text)" }}
          />
        </div>
      )}
    </div>
  );
}
