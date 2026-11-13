"use client";

/**
 * REM para pantallas que son «una lista de productos con cantidad»: conteos, pedidos internos, compras y POS.
 * Cada pantalla da un adaptador (cómo buscar, cómo poner la cantidad, qué hacer al decir «listo»);
 * aquí está la conversación: buscar lo dicho, leer opciones, preguntar cuántas, corregir, resumir y confirmar.
 * Nunca guarda ni envía sin un «sí» dicho.
 */

import { useEffect, useRef } from "react";
import { clickRemPhoto, registerRemHandler, resumeRem, type RemReply } from "./rem";
import { compactCode, normalize, parseTransferCommand, plural, spokenReference, type TransferCommand } from "./spanish";
import { guessMode, guessSpoken } from "./fuzzy";

export type VoiceHit = { id: string; name: string; sku: string | null; barcode?: string | null; /** Existencias (null = no se sabe o no se dice). */ avail: number | null };
export type VoiceLine = { id: string; name: string; sku: string | null; qty: number };

export type ListVoiceAdapter = {
  title: string;
  examples: string[];
  /** Primera frase (qué se está haciendo). */
  intro: () => string;
  /** Busca con una frase (se llama con lo dicho y con la referencia armada). */
  search: (q: string) => Promise<VoiceHit[]>;
  lines: VoiceLine[];
  /** Pone la cantidad total de un producto (lo agrega si no estaba). `extra` viene de `preparse`. */
  put: (hit: VoiceHit, qty: number, extra?: Record<string, number>) => void;
  remove: (id: string) => void;
  /** No pasar de las existencias (POS). */
  limitToStock?: boolean;
  /** Decir cuánto hay (no en conteos: se cuenta a ciegas). */
  revealStock?: boolean;
  /** Palabra de las existencias: «hay», «allá hay». */
  stockWord?: string;
  /** Saca de la frase lo propio de la pantalla («a doce mil» → costo) antes de entenderla. */
  preparse?: (text: string) => { text: string; extra?: Record<string, number> };
  /** Frases propias («urgente», «para Zamora»). null si no es suya. */
  custom?: (text: string) => RemReply | null | Promise<RemReply | null>;
  /** Lo que falta antes de terminar (pregunta), o null. */
  missing?: () => string | null;
  /** Resumen para confirmar al decir «listo». Sin esto, «listo» solo resume y termina. */
  confirm?: () => string;
  submit?: () => Promise<{ ok: boolean; say: string }>;
  /** Qué decir al terminar sin `submit`. */
  doneSay?: () => string;
};

type Pending =
  | { type: "choice"; hits: VoiceHit[]; qty: number | null; add: boolean; extra?: Record<string, number> }
  | { type: "qty"; hit: VoiceHit; add: boolean; extra?: Record<string, number> }
  /** No se encontró exacto: «¿Estás intentando decir…?» por cada parecido, en orden. */
  | { type: "guess"; hits: VoiceHit[]; index: number; qty: number | null; add: boolean; extra?: Record<string, number> }
  | { type: "overdraw"; hit: VoiceHit; qty: number; extra?: Record<string, number> }
  | { type: "submit" }
  | null;

const short = (name: string) => name.toLowerCase().split(/\s+/).slice(0, 6).join(" ");

/** Busca lo dicho tal cual y como referencia; si un código coincide exacto, ese es. */
export async function searchSpokenWith(search: (q: string) => Promise<VoiceHit[]>, spoken: string): Promise<VoiceHit[]> {
  const ref = spokenReference(spoken);
  const candidates = [...new Set([spoken, ref, ref.replace(/[-./]/g, "")].map((x) => x.trim()).filter((x) => x.length >= 2))];
  const results = await Promise.all(candidates.map((q) => search(q).catch(() => [] as VoiceHit[])));
  const all = new Map<string, VoiceHit>();
  results.flat().forEach((h) => { if (!all.has(h.id)) all.set(h.id, h); });
  const code = compactCode(ref);
  if (code.length >= 3) {
    const exact = [...all.values()].filter((h) => compactCode(h.sku) === code || compactCode(h.barcode) === code);
    if (exact.length === 1) return exact;
  }
  const first = results.find((r) => r.length) ?? [];
  return [...first, ...[...all.values()].filter((h) => !first.some((f) => f.id === h.id))];
}

/** El producto de la lista que más se parece a lo dicho. */
export function findSpokenLine<T extends { name: string; sku: string | null }>(lines: T[], spoken: string): T | null {
  const s = normalize(spoken);
  const code = compactCode(spokenReference(spoken));
  const words = s.split(" ").filter((w) => w.length > 2);
  let best: { l: T; score: number } | null = null;
  for (const l of lines) {
    let score = 0;
    if (code.length >= 3 && compactCode(l.sku) === code) score = 100;
    else {
      const name = normalize(l.name);
      score = words.filter((w) => name.includes(w) || name.includes(w.replace(/(es|s)$/, ""))).length * 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { l, score };
  }
  return best?.l ?? null;
}

/**
 * Registra la pantalla en REM mientras `enabled`. Devuelve `picked(hit)`: la pantalla lo llama cuando se elige
 * un producto con la foto, para que REM pregunte cuántas (solo si REM pidió la foto).
 */
export function useListVoice(adapterRef: React.RefObject<ListVoiceAdapter | null>, enabled: boolean) {
  const st = useRef({ pending: null as Pending, awaiting: null as Parameters<typeof parseTransferCommand>[1], last: "", lastAdded: [] as string[], photo: false });
  const pickedRef = useRef<(hit: VoiceHit) => boolean>(() => false);

  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    const A = () => adapterRef.current!;
    const reply = (say: string, extra: Partial<RemReply> = {}): RemReply => { s.last = say; return { say, ...extra }; };
    const qtyOf = (id: string) => A().lines.find((l) => l.id === id)?.qty ?? 0;
    const clear = () => { s.pending = null; s.awaiting = null; };

    function apply(hit: VoiceHit, qty: number, add: boolean, extra?: Record<string, number>, force = false): RemReply {
      const a = A();
      const had = qtyOf(hit.id);
      const want = add ? had + qty : qty;
      if (a.limitToStock && hit.avail !== null && want > hit.avail && !force) {
        if (hit.avail <= had) { clear(); return reply(`De ${short(hit.name)} no hay más: hay ${hit.avail}.`); }
        s.pending = { type: "overdraw", hit, qty: hit.avail, extra };
        s.awaiting = "confirm";
        return reply(`De ${short(hit.name)} solo hay ${hit.avail}. ¿Pongo ${hit.avail}?`);
      }
      a.put(hit, want, extra);
      clear();
      s.lastAdded = [...s.lastAdded.filter((x) => x !== hit.id), hit.id];
      return reply(`${want} de ${short(hit.name)}.${add && had ? ` Ahora van ${want}.` : ""} ¿Siguiente?`);
    }

    function chosen(hit: VoiceHit, qty: number | null, add: boolean, extra?: Record<string, number>): RemReply {
      if (qty === null) {
        s.pending = { type: "qty", hit, add, extra };
        s.awaiting = "qty";
        const stock = A().revealStock && hit.avail !== null ? `, ${A().stockWord ?? "hay"} ${hit.avail}` : "";
        return reply(`${short(hit.name)}${stock}. ¿Cuántas?`);
      }
      return apply(hit, qty, add, extra);
    }

    function askGuess(p: Extract<Pending, { type: "guess" }>, lead = ""): RemReply {
      s.pending = p;
      s.awaiting = "confirm";
      const h = p.hits[p.index];
      const sku = h.sku && !normalize(h.name).includes(normalize(h.sku)) ? `, código ${h.sku}` : "";
      return reply(`${lead}¿Estás intentando decir ${h.name.toLowerCase()}${sku}?`, { show: `${lead}¿Estás intentando decir «${h.name}»${h.sku ? ` (${h.sku})` : ""}? Di sí o no.` });
    }

    function askChoice(hits: VoiceHit[], qty: number | null, add: boolean, extra?: Record<string, number>, lead = ""): RemReply {
      const top = hits.slice(0, 3);
      s.pending = { type: "choice", hits: top, qty, add, extra };
      s.awaiting = "choice";
      const nums = ["uno", "dos", "tres"];
      const reveal = A().revealStock;
      return reply(`${lead}Encontré ${top.length}: ${top.map((h, i) => `${nums[i]}, ${short(h.name)}${h.sku ? ` ${h.sku}` : ""}`).join("; ")}. ¿Cuál? O di ninguno.`,
        { show: `Encontré ${top.length}:\n${top.map((h, i) => `${i + 1}. ${h.name}${h.sku ? ` · ${h.sku}` : ""}${reveal && h.avail !== null ? ` (${A().stockWord ?? "hay"} ${h.avail})` : ""}`).join("\n")}` });
    }

    function summary(): RemReply {
      const a = A();
      if (!a.lines.length) return reply("Todavía no hay productos. Dime el primero.");
      const units = a.lines.reduce((x, l) => x + l.qty, 0);
      const items = a.lines.slice(-5).map((l) => `${l.qty} de ${short(l.name)}`).join(", ");
      return reply(`Llevas ${plural(a.lines.length, "producto", "productos")} y ${plural(units, "unidad", "unidades")}. ${a.lines.length > 5 ? "Los últimos: " : ""}${items}.`);
    }

    function finish(): RemReply {
      const a = A();
      if (!a.lines.length) return reply("Todavía no hay productos.");
      const miss = a.missing?.();
      if (miss) return reply(miss);
      if (a.confirm && a.submit) { s.pending = { type: "submit" }; s.awaiting = "confirm"; return reply(a.confirm()); }
      return reply(a.doneSay?.() ?? `${summary().say} Revisa en pantalla.`, { end: true });
    }

    async function hear(alts: string[]): Promise<RemReply> {
      const a = A();
      const raw = alts[0] ?? "";
      const own = await a.custom?.(normalize(raw).replace(/^(?:oye |hey )?rem\b\s*/, ""));
      if (own) { s.last = own.say; return own; }
      const pre = a.preparse ? a.preparse(raw) : { text: raw };
      const cmd: TransferCommand = parseTransferCommand(pre.text, s.awaiting);
      const p = s.pending;
      switch (cmd.kind) {
        case "stop": clear(); return reply("Listo. Lo que llevas queda en pantalla.", { end: true });
        case "help": return reply(`Puedes decir, por ejemplo: ${a.examples.slice(0, 4).join("; ")}.`);
        case "repeat": return reply(s.last || "Dime.");
        case "summary": return summary();
        case "photo": {
          if (!clickRemPhoto()) return reply("Aquí no hay búsqueda por foto.");
          s.photo = true;
          clear();
          return reply("Toma la foto del producto y tócalo. Luego te pregunto cuántas.", { end: true });
        }
        case "choice": {
          if (p?.type !== "choice") return reply("No te estaba dando opciones. Dime el producto.");
          if (cmd.index === 0) { clear(); return reply("Bueno. Dime el producto de otra forma, o di foto."); }
          const hit = p.hits[cmd.index - 1];
          if (!hit) return reply(`Solo hay ${p.hits.length} opciones. ¿Cuál?`);
          return chosen(hit, p.qty, p.add, p.extra);
        }
        case "number": {
          if (p?.type === "qty") return apply(p.hit, cmd.value, p.add, p.extra ?? pre.extra);
          // «¿Estás intentando decir…?» → «cinco»: ese, con esa cantidad.
          if (p?.type === "guess") return chosen(p.hits[p.index], cmd.value, p.add, p.extra);
          if (p?.type === "choice") return hear([`la ${cmd.value}`]);
          if (p?.type === "overdraw") return apply(p.hit, Math.min(cmd.value, p.qty), false, p.extra);
          const lastId = s.lastAdded.at(-1);
          const line = a.lines.find((l) => l.id === lastId);
          if (line) return apply({ id: line.id, name: line.name, sku: line.sku, avail: null }, cmd.value, false, pre.extra);
          return reply("¿Cuántas de qué? Di por ejemplo: tres de la zapatera.");
        }
        case "yes": {
          if (p?.type === "overdraw") return apply(p.hit, p.qty, false, p.extra, true);
          if (p?.type === "guess") return chosen(p.hits[p.index], p.qty, p.add, p.extra);
          if (p?.type === "choice" && p.hits.length === 1) return chosen(p.hits[0], p.qty, p.add, p.extra);
          if (p?.type === "choice") return reply("¿Cuál? Di el número: la uno, la dos…");
          if (p?.type === "submit" && a.submit) {
            clear();
            const r = await a.submit();
            s.lastAdded = [];
            return reply(r.say, { end: true });
          }
          return reply("Dime el siguiente producto, o di listo.");
        }
        case "no": {
          if (p?.type === "submit") { clear(); return reply("Bueno, todavía no. Sigue o corrige lo que necesites."); }
          if (p?.type === "guess") {
            if (p.index + 1 < p.hits.length) return askGuess({ ...p, index: p.index + 1 }, "¿Entonces ");
            clear();
            return reply("Bueno. Dímelo de otra forma, dicta la referencia letra por letra, o di foto.");
          }
          if (p?.type === "choice") { clear(); return reply("Bueno. Dime el producto de otra forma, o di foto."); }
          if (p) { clear(); return reply("Bueno, no lo agrego. ¿Siguiente?"); }
          return reply("Bueno. ¿Qué hacemos?");
        }
        case "undo": {
          const id = s.lastAdded.pop() ?? a.lines.at(-1)?.id;
          const line = a.lines.find((l) => l.id === id);
          if (!line) return reply("No hay nada que quitar.");
          a.remove(line.id);
          return reply(`Quité ${short(line.name)}.`);
        }
        case "remove": {
          const line = findSpokenLine(a.lines, cmd.query);
          if (!line) return reply(`«${cmd.query}» no está en la lista.`);
          a.remove(line.id);
          s.lastAdded = s.lastAdded.filter((x) => x !== line.id);
          return reply(`Quité ${short(line.name)}.`);
        }
        case "set_qty": {
          const line = cmd.query ? findSpokenLine(a.lines, cmd.query) : a.lines.find((l) => l.id === s.lastAdded.at(-1)) ?? a.lines.at(-1);
          // «La zapatera son seis» y no está: se busca y se pone.
          if (!line && cmd.query) return addSpoken({ kind: "add", qty: cmd.qty, query: cmd.query, to: null, exact: true }, alts, pre.extra);
          if (!line) return reply("Todavía no hay productos.");
          return apply({ id: line.id, name: line.name, sku: line.sku, avail: null }, cmd.qty, false, pre.extra);
        }
        case "done": return finish();
        case "add": return addSpoken(cmd, alts, pre.extra);
        case "notes": case "carrier": case "checker": case "route": case "destination":
          return reply("Eso no lo uso aquí. Dime un producto con su cantidad, o di listo.");
      }
    }

    async function addSpoken(cmd: Extract<TransferCommand, { kind: "add" }>, alts: string[], extra?: Record<string, number>): Promise<RemReply> {
      const a = A();
      const query = cmd.to ? `${cmd.query} para ${cmd.to}` : cmd.query;
      let hits = await searchSpokenWith(a.search, query);
      for (const alt of alts.slice(1)) {
        if (hits.length) break;
        const c = parseTransferCommand(a.preparse ? a.preparse(alt).text : alt, null);
        if (c.kind === "add") hits = await searchSpokenWith(a.search, c.query);
      }
      if (!hits.length) {
        // No salió exacto: variantes que suenan igual («bts» → «VTS»), en singular y por partes.
        const guesses = await guessSpoken(a.search, query);
        const mode = guessMode(guesses);
        if (mode === "ask") return askGuess({ type: "guess", hits: guesses.filter((g) => g.score >= 0.5).map((g) => g.hit).slice(0, 3), index: 0, qty: cmd.qty, add: !cmd.exact, extra });
        if (mode === "choose") return askChoice(guesses.map((g) => g.hit), cmd.qty, !cmd.exact, extra, "No lo encontré exacto. ");
        return reply(`No encontré «${query}». Dilo de otra forma, dicta la referencia letra por letra, o di foto.`);
      }
      if (hits.length === 1) return chosen(hits[0], cmd.qty, !cmd.exact, extra);
      return askChoice(hits, cmd.qty, !cmd.exact, extra);
    }

    pickedRef.current = (hit) => {
      if (!s.photo) return false;
      s.photo = false;
      s.pending = { type: "qty", hit, add: false };
      s.awaiting = "qty";
      s.lastAdded = [...s.lastAdded.filter((x) => x !== hit.id), hit.id];
      resumeRem(reply(`${short(hit.name)}. ¿Cuántas?`));
      return true;
    };

    const off = registerRemHandler({
      title: A().title,
      examples: A().examples,
      start: async (first) => {
        clear();
        s.photo = false;
        const intro = reply(A().intro());
        if (!first?.length) return intro;
        const r = await hear(first);
        return /^(?:Eso no lo uso|No encontré)/.test(r.say) ? intro : r;
      },
      hear,
    });
    return () => { off(); pickedRef.current = () => false; };
  }, [enabled, adapterRef]);

  /** true si REM había pedido la foto (la pantalla no debe abrir su propia ventana de cantidad). */
  return { picked: (hit: VoiceHit) => pickedRef.current(hit) };
}
