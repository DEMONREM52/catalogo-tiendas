"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Smile } from "lucide-react";

/**
 * Emojis para el chat: por categorías (incluida una de tienda e inventario) y «Recientes».
 * Se insertan donde está el cursor del cuadro de texto. Los recientes quedan en este navegador.
 */
const CATS: Array<{ key: string; icon: string; name: string; list: string }> = [
  { key: "caras", icon: "😀", name: "Caras", list: "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😛😜🤪🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪😴😷🤒🤕🥵🥶😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈💀💩🤡👻👽🤖" },
  { key: "gestos", icon: "👍", name: "Gestos", list: "👍👎👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋👏🙌👐🤲🤝🙏✍️💪🦾👀👁️🧠🫶❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝" },
  { key: "tienda", icon: "📦", name: "Tienda", list: "📦📫📮🏷️🛒🛍️🧾💵💰💳🪙🏦📊📈📉🗂️📋📌📍🗓️⏰⏳⌛🔖🏪🏬🏭🚚🚛🛵🏍️🚗🛻📲📞☎️📠🖨️💻⌨️🖱️📷📸🎥🔋🔌💡🔦🧰🔧🔨🪛⚙️🧹🧴🧽🎁🎀🧸⚽🎮👕👖👟👜🎒⌚💍🕶️🧢" },
  { key: "simbolos", icon: "✅", name: "Símbolos", list: "✅☑️✔️❌❎⚠️🚫⛔❓❗‼️⁉️💯🔥⭐🌟✨⚡💥💫🎉🎊🏆🥇🥈🥉🔴🟠🟡🟢🔵🟣⚫⚪🟥🟩🟦⬆️⬇️⬅️➡️↩️🔄🔁➕➖✖️➗🆕🆗🆘🔝💤🕐🕒🕕🕘" },
  { key: "comida", icon: "🍔", name: "Comida", list: "☕🍵🥤🧃🍺🍻🥂🍷🍔🍟🍕🌭🥪🌮🌯🥗🍗🍖🍝🍜🍲🍣🍱🥟🍦🍰🎂🧁🍩🍪🍫🍬🍭🍎🍌🍉🍇🍓🥑🌽🥕" },
];
const RECENT_KEY = "remhub-emoji-recent";
const split = (s: string) => [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(s)].map((x) => x.segment);

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** Botón 😊 que abre el selector y pone el emoji en el cuadro de texto `targetId`. */
export function EmojiButton({ targetId, value, onChange, disabled }: { targetId: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("recientes");
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { const r = readRecent(); setRecent(r); setCat((c) => (c === "recientes" && !r.length ? "caras" : c)); }, 0);
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function pick(emoji: string) {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    // El cursor queda después del emoji, listo para seguir escribiendo.
    window.requestAnimationFrame(() => { if (el) { el.focus(); const p = start + emoji.length; el.setSelectionRange(p, p); } });
    const next = [emoji, ...readRecent().filter((x) => x !== emoji)].slice(0, 24);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    setRecent(next);
  }

  const list = cat === "recientes" ? recent : split(CATS.find((c) => c.key === cat)?.list ?? "");
  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-label="Emojis" aria-expanded={open}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border transition hover:-translate-y-0.5 disabled:opacity-40"
        style={{ borderColor: open ? "var(--t-accent)" : "var(--t-card-border)", color: open ? "var(--t-accent)" : undefined }}>
        <Smile size={19} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            role="dialog" aria-label="Escoger emoji"
            className="absolute bottom-13 left-0 z-40 w-[min(330px,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl"
            style={{ borderColor: "var(--t-card-border)", background: "var(--t-bg-base)", color: "var(--t-text)" }}>
            <div className="flex gap-0.5 border-b p-1" style={{ borderColor: "var(--t-card-border)" }} role="tablist">
              {[{ key: "recientes", icon: "🕘", name: "Recientes" }, ...CATS].map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} title={c.name} aria-label={c.name} onClick={() => setCat(c.key)}
                  className="grid h-10 flex-1 place-items-center rounded-xl text-lg transition"
                  style={cat === c.key ? { background: "color-mix(in oklab, var(--t-accent) 20%, transparent)" } : undefined}>{c.icon}</button>
              ))}
            </div>
            <div className="grid max-h-60 grid-cols-8 gap-0.5 overflow-y-auto p-1.5">
              {list.length ? list.map((e, i) => (
                <button key={`${e}${i}`} type="button" onClick={() => pick(e)} aria-label={e}
                  className="no-tap-expand grid h-10 place-items-center rounded-xl text-2xl transition hover:scale-125 hover:bg-[color:var(--t-card-bg)] active:scale-95">{e}</button>
              )) : <p className="col-span-8 p-4 text-center text-xs" style={{ color: "var(--t-muted)" }}>Aquí aparecerán los emojis que más uses.</p>}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
