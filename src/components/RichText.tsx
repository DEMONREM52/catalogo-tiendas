import { Fragment, type CSSProperties, type ReactNode } from "react";
import { parseRich, type Block, type Inline } from "@/lib/rich-text";

/**
 * Muestra una descripción con su formato (negrita, colores, títulos, listas…). Arma elementos de React,
 * nunca HTML, así que es seguro con cualquier texto. `compact`: todo en línea, para tarjetas recortadas.
 */
function renderInline(c: Inline[], key = ""): ReactNode[] {
  return c.map((x, i) => {
    const k = `${key}${i}`;
    switch (x.t) {
      case "text": return <Fragment key={k}>{x.v}</Fragment>;
      case "b": return <strong key={k} className="font-bold">{renderInline(x.c, `${k}-`)}</strong>;
      case "i": return <em key={k}>{renderInline(x.c, `${k}-`)}</em>;
      case "u": return <u key={k}>{renderInline(x.c, `${k}-`)}</u>;
      case "s": return <s key={k}>{renderInline(x.c, `${k}-`)}</s>;
      case "mark": return <mark key={k} className="rounded px-0.5" style={{ background: "#fde047", color: "#1c1917" }}>{renderInline(x.c, `${k}-`)}</mark>;
      case "color": return <span key={k} style={{ color: x.color }}>{renderInline(x.c, `${k}-`)}</span>;
      case "size": return <span key={k} style={{ fontSize: x.size === "lg" ? "1.25em" : "0.85em" }}>{renderInline(x.c, `${k}-`)}</span>;
      case "link": return <a key={k} href={x.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">{renderInline(x.c, `${k}-`)}</a>;
    }
  });
}

type TextBlock = Extract<Block, { c: Inline[] }>;
const alignStyle = (b: TextBlock): CSSProperties | undefined => (b.align !== "left" ? { textAlign: b.align } : undefined);

export function RichText({ text, className, style, compact }: { text: string | null | undefined; className?: string; style?: CSSProperties; compact?: boolean }) {
  const blocks = parseRich(text);
  if (!blocks.length) return null;

  if (compact) {
    const parts: ReactNode[] = [];
    blocks.forEach((b, i) => {
      if (b.t === "blank" || b.t === "hr") return;
      if (parts.length) parts.push(" ");
      const body = renderInline(b.c, `${i}-`);
      parts.push(b.t.startsWith("h") ? <strong key={i} className="font-bold">{body}</strong> : <Fragment key={i}>{b.t === "li" ? "• " : b.t === "ol" ? `${b.n}. ` : ""}{body}</Fragment>);
    });
    return <p className={className} style={style}>{parts}</p>;
  }

  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "blank") { out.push(<div key={i} className="h-3" aria-hidden />); continue; }
    if (b.t === "hr") { out.push(<hr key={i} className="my-3 border-current opacity-20" />); continue; }
    const body = renderInline(b.c, `${i}-`);
    if (b.t === "li" || b.t === "ol") {
      const items: TextBlock[] = [];
      const kind = b.t;
      while (i < blocks.length && blocks[i].t === kind) { items.push(blocks[i] as TextBlock); i++; }
      i--;
      const lis = items.map((it, j) => <li key={j} style={alignStyle(it)}>{renderInline(it.c, `${i}-${j}-`)}</li>);
      out.push(kind === "li"
        ? <ul key={i} className="my-1 list-disc space-y-0.5 pl-6">{lis}</ul>
        : <ol key={i} className="my-1 list-decimal space-y-0.5 pl-6" start={items[0].n}>{lis}</ol>);
      continue;
    }
    const st = alignStyle(b);
    if (b.t === "h1") out.push(<h3 key={i} className="mt-3 text-2xl font-black leading-tight" style={st}>{body}</h3>);
    else if (b.t === "h2") out.push(<h4 key={i} className="mt-3 text-xl font-black leading-tight" style={st}>{body}</h4>);
    else if (b.t === "h3") out.push(<h5 key={i} className="mt-2 text-lg font-bold leading-snug" style={st}>{body}</h5>);
    else if (b.t === "quote") out.push(<blockquote key={i} className="my-1 border-l-4 pl-3 italic opacity-90" style={{ borderColor: "currentColor", ...st }}>{body}</blockquote>);
    else out.push(<p key={i} style={st}>{body}</p>);
  }
  return <div className={className} style={style}>{out}</div>;
}
