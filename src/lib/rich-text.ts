/**
 * Texto con formato para descripciones (como Word, guardado como texto).
 *
 * Se guarda como texto con marcas, compatible con lo que ya había (**negrita**, ### título):
 *   Líneas:  # / ## / ### título · "- " viñeta · "1. " numerada · "> " cita · "---" línea
 *            "::c " / "::r " / "::j " al inicio = centrado / derecha / justificado
 *   Dentro:  **negrita** · *cursiva* · ++subrayado++ · ~~tachado~~ · ==resaltado==
 *            {#e11d48|color} · {grande|texto} · {chico|texto} · [texto](https://…)
 *
 * Nunca se arma HTML a partir del texto para mostrarlo: se convierte en elementos de React (RichText),
 * así nadie puede meter código. El HTML de aquí es solo para el editor y todo va escapado.
 */

export type Align = "left" | "center" | "right" | "justify";
export type Inline =
  | { t: "text"; v: string }
  | { t: "b" | "i" | "u" | "s" | "mark"; c: Inline[] }
  | { t: "color"; color: string; c: Inline[] }
  | { t: "size"; size: "lg" | "sm"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };
export type Block =
  | { t: "p" | "h1" | "h2" | "h3" | "li" | "ol" | "quote"; align: Align; c: Inline[]; n?: number }
  | { t: "hr" }
  | { t: "blank" };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;
const ALIGN: Record<string, Align> = { c: "center", r: "right", j: "justify" };
const PAIRS: Array<[string, "b" | "i" | "u" | "s" | "mark"]> = [["**", "b"], ["++", "u"], ["~~", "s"], ["==", "mark"], ["*", "i"]];

/** El texto tiene marcas de formato (para no gastar trabajo en textos simples). */
export function hasFormat(text: string | null | undefined) {
  return Boolean(text && /\*|\+\+|~~|==|\{[#a-z]|\]\(|^(#{1,3} |- |\d+\. |> |---|::[crj] )/m.test(text));
}

function findClose(s: string, mark: string, from: number) {
  for (let i = s.indexOf(mark, from); i !== -1; i = s.indexOf(mark, i + 1)) {
    if (mark === "*" && (s[i + 1] === "*" || s[i - 1] === "*")) continue;
    // "***": la negrita cierra con los dos últimos (el primero cierra la cursiva de adentro).
    while (mark.length > 1 && s[i + mark.length] === mark[0]) i++;
    if (i > from && s[i - 1] !== " ") return i;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // {#color|texto} · {grande|texto} · {chico|texto}
    if (ch === "{") {
      const m = /^\{(#[0-9a-f]{3,6}|grande|chico)\|/i.exec(s.slice(i));
      const end = m ? s.indexOf("}", i + m[0].length) : -1;
      if (m && end > i + m[0].length) {
        const inner = parseInline(s.slice(i + m[0].length, end));
        const key = m[1].toLowerCase();
        flush();
        if (key.startsWith("#")) { if (HEX.test(key)) out.push({ t: "color", color: key, c: inner }); else out.push(...inner); }
        else out.push({ t: "size", size: key === "grande" ? "lg" : "sm", c: inner });
        i = end + 1;
        continue;
      }
    }
    // [texto](https://…)
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (m && SAFE_URL.test(m[2])) { flush(); out.push({ t: "link", href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue; }
    }
    const pair = PAIRS.find(([mk]) => s.startsWith(mk, i) && !(mk === "*" && s[i + 1] === "*"));
    if (pair && s[i + pair[0].length] && s[i + pair[0].length] !== " ") {
      const close = findClose(s, pair[0], i + pair[0].length);
      if (close !== -1) {
        flush();
        out.push({ t: pair[1], c: parseInline(s.slice(i + pair[0].length, close)) });
        i = close + pair[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseRich(text: string | null | undefined): Block[] {
  const blocks: Block[] = [];
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ t: "blank" }); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ t: "hr" }); continue; }
    let align: Align = "left";
    const a = /^::([crj]) ?/.exec(line);
    if (a) { align = ALIGN[a[1]]; line = line.slice(a[0].length); }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) blocks.push({ t: `h${m[1].length}` as "h1", align, c: parseInline(m[2]) });
    else if ((m = /^\s*[-•]\s+(.*)$/.exec(line)) || (m = /^\s*\*\s+(.*)$/.exec(line))) blocks.push({ t: "li", align, c: parseInline(m[1]) });
    else if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) blocks.push({ t: "ol", align, n: Number(m[1]), c: parseInline(m[2]) });
    else if ((m = /^>\s?(.*)$/.exec(line))) blocks.push({ t: "quote", align, c: parseInline(m[1]) });
    else blocks.push({ t: "p", align, c: parseInline(line) });
  }
  while (blocks.length && blocks[blocks.length - 1].t === "blank") blocks.pop();
  while (blocks.length && blocks[0].t === "blank") blocks.shift();
  return blocks;
}

const inlinePlain = (c: Inline[]): string => c.map((x) => (x.t === "text" ? x.v : inlinePlain(x.c))).join("");

/** Sin marcas (para buscadores, redes, vistas previas de enlaces). */
export function richToPlain(text: string | null | undefined): string {
  if (!hasFormat(text)) return String(text ?? "");
  return parseRich(text).map((b) => (b.t === "hr" ? "" : b.t === "blank" ? "" : `${b.t === "li" ? "• " : b.t === "ol" ? `${b.n}. ` : ""}${inlinePlain(b.c)}`)).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ------------------------------ Editor (HTML) ------------------------------ */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(c: Inline[]): string {
  return c.map((x) => {
    switch (x.t) {
      case "text": return esc(x.v);
      case "b": return `<b>${inlineHtml(x.c)}</b>`;
      case "i": return `<i>${inlineHtml(x.c)}</i>`;
      case "u": return `<u>${inlineHtml(x.c)}</u>`;
      case "s": return `<s>${inlineHtml(x.c)}</s>`;
      case "mark": return `<mark>${inlineHtml(x.c)}</mark>`;
      case "color": return `<font color="${esc(x.color)}">${inlineHtml(x.c)}</font>`;
      case "size": return `<font size="${x.size === "lg" ? 5 : 2}">${inlineHtml(x.c)}</font>`;
      case "link": return `<a href="${esc(x.href)}">${inlineHtml(x.c)}</a>`;
    }
  }).join("");
}

/** Texto guardado → HTML para el editor (todo escapado). */
export function richToEditorHtml(text: string | null | undefined): string {
  const blocks = parseRich(text);
  let html = "";
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "blank") { html += "<div><br></div>"; continue; }
    if (b.t === "hr") { html += "<hr>"; continue; }
    const st = b.align !== "left" ? ` style="text-align:${b.align}"` : "";
    const body = inlineHtml(b.c) || "<br>";
    if (b.t === "li" || b.t === "ol") {
      const tag = b.t === "li" ? "ul" : "ol";
      let items = "";
      while (i < blocks.length && blocks[i].t === b.t) {
        const it = blocks[i] as Extract<Block, { c: Inline[] }>;
        items += `<li${it.align !== "left" ? ` style="text-align:${it.align}"` : ""}>${inlineHtml(it.c) || "<br>"}</li>`;
        i++;
      }
      i--;
      html += `<${tag}>${items}</${tag}>`;
    } else if (b.t === "quote") html += `<blockquote${st}>${body}</blockquote>`;
    else if (b.t === "p") html += `<div${st}>${body}</div>`;
    else html += `<${b.t}${st}>${body}</${b.t}>`;
  }
  return html || "<div><br></div>";
}

const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "SECTION", "ARTICLE", "HEADER", "FOOTER", "TABLE", "TR", "PRE"]);

function toHex(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (HEX.test(c)) return c;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Pone las marcas por fuera de los espacios: "** hola **" no se lee, "**hola**" sí. */
function wrap(inner: string, open: string, close = open) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2]) return inner;
  return `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

function serializeInline(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/ /g, " ").replace(/\n/g, " ");
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  if (el.tagName === "BR") return "\n";
  let s = Array.from(el.childNodes).map(serializeInline).join("");
  const tag = el.tagName;
  const st = el.style;
  const weight = st?.fontWeight;
  const deco = `${st?.textDecoration ?? ""} ${st?.textDecorationLine ?? ""}`;
  const fontSize = tag === "FONT" ? Number(el.getAttribute("size")) : 0;
  const px = parseFloat(st?.fontSize ?? "");
  const color = (tag === "FONT" && el.getAttribute("color")) || st?.color || "";
  const bg = st?.backgroundColor || "";
  const hex = color ? toHex(color) : null;
  if (tag === "A") { const href = el.getAttribute("href") ?? ""; if (SAFE_URL.test(href) && s.trim()) s = `[${s.trim()}](${href})`; }
  if (fontSize >= 5 || st?.fontSize === "x-large" || st?.fontSize === "xx-large" || px >= 20) s = wrap(s, "{grande|", "}");
  else if ((fontSize && fontSize <= 2) || st?.fontSize === "small" || st?.fontSize === "x-small" || (px && px <= 12)) s = wrap(s, "{chico|", "}");
  if (hex && hex !== "#000000" && tag !== "A") s = wrap(s, `{${hex}|`, "}");
  if (tag === "MARK" || (bg && toHex(bg) && toHex(bg) !== "#ffffff")) s = wrap(s, "==");
  if (tag === "S" || tag === "STRIKE" || tag === "DEL" || deco.includes("line-through")) s = wrap(s, "~~");
  if (tag === "U" || tag === "INS" || deco.includes("underline")) { if (tag !== "A") s = wrap(s, "++"); }
  if (tag === "I" || tag === "EM" || st?.fontStyle === "italic") s = wrap(s, "*");
  if (tag === "B" || tag === "STRONG" || weight === "bold" || Number(weight) >= 600) s = wrap(s, "**");
  return s;
}

function alignOf(el: HTMLElement): string {
  const a = (el.style?.textAlign || el.getAttribute("align") || "").toLowerCase();
  return a === "center" ? "::c " : a === "right" || a === "end" ? "::r " : a === "justify" ? "::j " : "";
}

function serializeBlocks(root: Node, lines: string[]) {
  let cur = "";
  let has = false;
  const flush = (force = false) => { if (has || force) lines.push(cur); cur = ""; has = false; };
  for (const node of Array.from(root.childNodes)) {
    const el = node.nodeType === 1 ? (node as HTMLElement) : null;
    if (!el || !BLOCK_TAGS.has(el.tagName)) {
      if (el?.tagName === "BR") { flush(true); continue; }
      const part = serializeInline(node);
      if (part.includes("\n")) { const ps = part.split("\n"); ps.forEach((p, k) => { cur += p; has = true; if (k < ps.length - 1) flush(true); }); }
      else if (part) { cur += part; has = true; }
      continue;
    }
    flush();
    const tag = el.tagName;
    const al = alignOf(el);
    if (tag === "HR") { lines.push("---"); continue; }
    if (tag === "UL" || tag === "OL") {
      let n = 0;
      for (const li of Array.from(el.children)) {
        if (li.tagName !== "LI") continue;
        n++;
        const sub: string[] = [];
        serializeBlocks(li, sub);
        const text = sub.filter((x) => x.trim()).map((x) => x.replace(/^(::[crj] )?(- |\d+\. )?/, "")).join(" ").trim();
        lines.push(`${alignOf(li as HTMLElement)}${tag === "UL" ? "- " : `${n}. `}${text}`);
      }
      continue;
    }
    if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(3, Number(tag[1]));
      const text = serializeInline(el).replace(/\n/g, " ").trim().replace(/^\*\*([\s\S]*)\*\*$/, "$1");
      lines.push(`${al}${"#".repeat(level)} ${text}`);
      continue;
    }
    const sub: string[] = [];
    serializeBlocks(el, sub);
    if (!sub.length) sub.push("");
    for (const line of sub) {
      let l = line;
      if (tag === "BLOCKQUOTE" && l.trim()) l = `> ${l.replace(/^> /, "")}`;
      if (al && l.trim() && !/^::[crj] /.test(l)) l = `${al}${l}`;
      lines.push(l);
    }
  }
  flush();
}

/** HTML del editor → texto guardado. */
export function editorDomToRich(root: HTMLElement): string {
  const lines: string[] = [];
  serializeBlocks(root, lines);
  return lines.map((l) => l.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
