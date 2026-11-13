"use client";

/**
 * REM para pantallas que son «una lista de productos con cantidad»: conteos, pedidos internos, compras y POS.
 * Cada pantalla da un adaptador (cómo buscar, cómo poner la cantidad, qué hacer al decir «listo»);
 * aquí está la conversación:
 *   · encontrar lo dicho aunque el reconocimiento lo escriba mal (src/lib/voice/fuzzy.ts): si está seguro lo
 *     agrega; si duda pregunta «¿Estás intentando decir…?»; si hay varios parecidos lee opciones;
 *   · corregir lo último («no», «esa no, la VTS 30», «de la referencia…») y aprender de la corrección;
 *   · cantidades, quitar, resumir, foto y terminar.
 * Nunca guarda ni envía sin un «sí» dicho.
 */

import { useEffect, useRef } from "react";
import { clickRemPhoto, registerRemHandler, resumeRem, type RemReply } from "./rem";
import { compactCode, normalize, parseCorrection, parseTransferCommand, plural, spokenReference, type TransferCommand } from "./spanish";
import { forget, learn, missToLearn, resolveSpoken, type Miss, type Ranked } from "./fuzzy";

export type VoiceHit = { id: string; name: string; sku: string | null; barcode?: string | null; /** Existencias (null = no se sabe o no se dice). */ avail: number | null };
export type VoiceLine = { id: string; name: string; sku: string | null; qty: number };

export type ListVoiceAdapter = {
  title: string;
  examples: string[];
  /** Primera frase (qué se está haciendo). */
  intro: () => string;
  /** Busca con una frase. `limit`: cuántos traer (REM pide más cuando prueba variantes). */
  search: (q: string, limit?: number) => Promise<VoiceHit[]>;
  lines: VoiceLine[];
  /** Pone la cantidad total de un producto (lo agrega si no estaba). `extra` viene de `preparse`. */
  put: (hit: VoiceHit, qty: number, extra?: Record<string, number>) => void;
  remove: (id: string) => void;
  /** Vacía la lista de una vez (si no está, se quita uno por uno). */
  clear?: () => void;
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

/** Cómo se llegó a un producto: para aprender si se confirma o se corrige. */
type Ask = { query: string; qty: number | null; add: boolean; extra?: Record<string, number>; learnAlso?: string };

type Pending =
  | ({ type: "choice"; hits: VoiceHit[] } & Ask)
  | { type: "qty"; hit: VoiceHit; add: boolean; extra?: Record<string, number> }
  | { type: "overdraw"; hit: VoiceHit; qty: number; extra?: Record<string, number> }
  /** «¿Estás intentando decir…?» por cada parecido, en orden. */
  | ({ type: "guess"; ranked: Ranked<VoiceHit>[]; index: number } & Ask)
  | { type: "submit" }
  | { type: "clear" }
  | null;

/** Lo último que REM agregó por voz (para «no», «esa no, la…»). */
type LastAdd = { turn: number; hit: VoiceHit; prevQty: number; ask: Ask; others: Ranked<VoiceHit>[]; learned: boolean };
type AddFrom = Omit<LastAdd, "turn" | "hit" | "prevQty">;

const short = (name: string) => name.toLowerCase().split(/\s+/).slice(0, 6).join(" ");
const spokenName = (h: { name: string; sku: string | null }) =>
  `${h.name.toLowerCase()}${h.sku && !normalize(h.name).includes(normalize(h.sku)) ? `, código ${h.sku}` : ""}`;

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
  const st = useRef({
    pending: null as Pending, awaiting: null as Parameters<typeof parseTransferCommand>[1], last: "", lastAdded: [] as string[],
    photo: false, turn: 0, lastAdd: null as LastAdd | null,
    /** Lo último que no encontró (para aprender cuando enseguida se encuentre dicho de otra forma). */
    miss: null as Miss,
  });
  const pickedRef = useRef<(hit: VoiceHit) => boolean>(() => false);

  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    const A = () => adapterRef.current!;
    const reply = (say: string, extra: Partial<RemReply> = {}): RemReply => { s.last = say; return { say, ...extra }; };
    const qtyOf = (id: string) => A().lines.find((l) => l.id === id)?.qty ?? 0;
    const clear = () => { s.pending = null; s.awaiting = null; };
    const remember = (ask: Ask, hit: VoiceHit) => {
      learn(ask.query, hit);
      if (ask.learnAlso) learn(ask.learnAlso, hit);
    };

    function apply(hit: VoiceHit, qty: number, add: boolean, extra?: Record<string, number>, force = false, from?: AddFrom): RemReply {
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
      s.lastAdd = from ? { ...from, turn: s.turn, hit, prevQty: had } : null;
      return reply(`${want} de ${short(hit.name)}.${add && had ? ` Ahora van ${want}.` : ""} ¿Siguiente?`);
    }

    function chosen(hit: VoiceHit, qty: number | null, add: boolean, extra?: Record<string, number>, from?: AddFrom): RemReply {
      if (qty === null) {
        s.pending = { type: "qty", hit, add, extra };
        s.awaiting = "qty";
        s.lastAdd = null;
        const stock = A().revealStock && hit.avail !== null ? `, ${A().stockWord ?? "hay"} ${hit.avail}` : "";
        return reply(`${short(hit.name)}${stock}. ¿Cuántas?`);
      }
      return apply(hit, qty, add, extra, false, from);
    }

    function askGuess(p: Extract<Pending, { type: "guess" }>, lead = ""): RemReply {
      s.pending = p;
      s.awaiting = "confirm";
      const h = p.ranked[p.index].hit;
      const stock = A().revealStock && h.avail !== null ? ` (${A().stockWord ?? "hay"} ${h.avail})` : "";
      return reply(`${lead}¿Estás intentando decir ${spokenName(h)}?`, {
        show: `${lead}¿Estás intentando decir «${h.name}»${h.sku ? ` · ${h.sku}` : ""}${stock}? Di sí o no.`,
      });
    }

    function askChoice(hits: VoiceHit[], ask: Ask, lead = ""): RemReply {
      const top = hits.slice(0, 3);
      s.pending = { type: "choice", hits: top, ...ask };
      s.awaiting = "choice";
      const nums = ["uno", "dos", "tres"];
      const reveal = A().revealStock;
      return reply(`${lead}Encontré ${top.length}: ${top.map((h, i) => `${nums[i]}, ${short(h.name)}${h.sku ? ` ${h.sku}` : ""}`).join("; ")}. ¿Cuál? O di ninguno.`,
        { show: `${lead}Encontré ${top.length}:\n${top.map((h, i) => `${i + 1}. ${h.name}${h.sku ? ` · ${h.sku}` : ""}${reveal && h.avail !== null ? ` (${A().stockWord ?? "hay"} ${h.avail})` : ""}`).join("\n")}` });
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

    /** Deshace lo último que REM agregó (vuelve a la cantidad de antes) y olvida si venía de lo aprendido. */
    function revert(last: LastAdd) {
      const a = A();
      if (last.prevQty > 0) a.put(last.hit, last.prevQty);
      else a.remove(last.hit.id);
      s.lastAdded = s.lastAdded.filter((x) => x !== last.hit.id);
      s.lastAdd = null;
      if (last.learned) forget(last.ask.query);
    }

    /** De lo dicho al producto: seguro → se agrega; duda → pregunta; varios → opciones. */
    async function resolveAndAdd(ask: Ask, alts: string[], lead = ""): Promise<RemReply> {
      const a = A();
      // Lo que no encontró hace un momento y se parece a esto: se aprende con lo que se elija ahora.
      if (!ask.learnAlso) { const also = missToLearn(s.miss, ask.query, s.turn); if (also) ask = { ...ask, learnAlso: also }; }
      const res = await resolveSpoken<VoiceHit>((q, limit) => a.search(q, limit), [ask.query, ...alts]);
      if (res.kind === "sure") {
        if (ask.learnAlso) { learn(ask.learnAlso, res.hit); s.miss = null; }
        const learned = res.ranked[0]?.hit.id === res.hit.id && res.ranked[0].score === 1;
        const r = chosen(res.hit, ask.qty, ask.add, ask.extra, { ask, others: res.ranked.filter((x) => x.hit.id !== res.hit.id), learned });
        return lead ? { ...r, say: `${lead}${r.say}`, show: `${lead}${r.show ?? r.say}` } : r;
      }
      if (res.kind === "ask") return askGuess({ type: "guess", ranked: res.ranked, index: 0, ...ask }, lead);
      if (res.kind === "choose") return askChoice(res.ranked.map((r) => r.hit), ask, `${lead}No lo encontré exacto. `);
      s.miss = { query: ask.query, turn: s.turn };
      return reply(`${lead}No encontré «${ask.query}». Dilo de otra forma, dicta la referencia letra por letra, o di foto.`);
    }

    async function hear(alts: string[]): Promise<RemReply> {
      const a = A();
      s.turn++;
      const raw = alts[0] ?? "";
      const own = await a.custom?.(normalize(raw).replace(/^(?:oye |hey )?rem\b\s*/, ""));
      if (own) { s.last = own.say; return own; }
      const pre = a.preparse ? a.preparse(raw) : { text: raw };
      const p = s.pending;
      const justAdded = s.lastAdd && s.lastAdd.turn === s.turn - 1 ? s.lastAdd : null;

      // Corrección de lo que REM acaba de agregar: «esa no, la VTS 30», «de la referencia vts 30», «me refiero a…».
      if (!p && justAdded) {
        const fix = parseCorrection(pre.text);
        if (fix) {
          revert(justAdded);
          const ask: Ask = { ...justAdded.ask, query: fix.query, qty: fix.qty ?? justAdded.ask.qty, learnAlso: justAdded.ask.query };
          return resolveAndAdd(ask, [], `Quité ${short(justAdded.hit.name)}. `);
        }
      }

      const cmd: TransferCommand = parseTransferCommand(pre.text, s.awaiting);
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
          if (cmd.index === 0) { s.miss = { query: p.query, turn: s.turn }; clear(); return reply("Bueno. Dime el producto de otra forma, o di foto."); }
          const hit = p.hits[cmd.index - 1];
          if (!hit) return reply(`Solo hay ${p.hits.length} opciones. ¿Cuál?`);
          remember(p, hit);
          return chosen(hit, p.qty, p.add, p.extra, { ask: p, others: [], learned: false });
        }
        case "number": {
          if (p?.type === "qty") return apply(p.hit, cmd.value, p.add, p.extra ?? pre.extra);
          // «¿Estás intentando decir…?» → «cinco»: ese, con esa cantidad.
          if (p?.type === "guess") {
            const hit = p.ranked[p.index].hit;
            remember(p, hit);
            return chosen(hit, cmd.value, p.add, p.extra, { ask: p, others: [], learned: false });
          }
          if (p?.type === "choice") return hear([`la ${cmd.value}`]);
          if (p?.type === "overdraw") return apply(p.hit, Math.min(cmd.value, p.qty), false, p.extra);
          const lastId = s.lastAdded.at(-1);
          const line = a.lines.find((l) => l.id === lastId);
          if (line) return apply({ id: line.id, name: line.name, sku: line.sku, avail: null }, cmd.value, false, pre.extra);
          return reply("¿Cuántas de qué? Di por ejemplo: tres de la zapatera.");
        }
        case "clear": {
          if (!a.lines.length) return reply("La lista ya está vacía. Dime el primer producto.");
          s.pending = { type: "clear" }; s.awaiting = "confirm";
          return reply(a.lines.length === 1 ? "¿Borro el producto de la lista? Di sí o no." : `¿Borro los ${a.lines.length} productos de la lista? Di sí o no.`);
        }
        case "yes": {
          if (p?.type === "clear") {
            clear();
            if (a.clear) a.clear(); else [...a.lines].forEach((l) => a.remove(l.id));
            s.lastAdded = []; s.lastAdd = null;
            return reply("Listo, borré todo. Dime el primer producto.");
          }
          if (p?.type === "overdraw") return apply(p.hit, Math.min(cmd.qty ?? p.qty, p.qty), false, p.extra, true);
          if (p?.type === "qty" && cmd.qty) return apply(p.hit, cmd.qty, p.add, p.extra ?? pre.extra);
          // «Sí» o «sí, necesito tres»: ese, con la cantidad dicha ahora o la de antes.
          if (p?.type === "guess") {
            const hit = p.ranked[p.index].hit;
            remember(p, hit);
            return chosen(hit, cmd.qty ?? p.qty, p.add, p.extra, { ask: p, others: p.ranked.filter((r) => r.hit.id !== hit.id), learned: false });
          }
          if (p?.type === "choice" && p.hits.length === 1) { remember(p, p.hits[0]); return chosen(p.hits[0], cmd.qty ?? p.qty, p.add, p.extra); }
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
          if (p?.type === "clear") { clear(); return reply("Bueno, no borro nada. ¿Siguiente?"); }
          if (p?.type === "submit") { clear(); return reply("Bueno, todavía no. Sigue o corrige lo que necesites."); }
          if (p?.type === "guess") {
            if (p.index + 1 < p.ranked.length) return askGuess({ ...p, index: p.index + 1 }, "¿Entonces ");
            s.miss = { query: p.query, turn: s.turn };
            clear();
            return reply("Bueno. Dímelo de otra forma, dicta la referencia letra por letra, o di foto.");
          }
          if (p?.type === "choice") { s.miss = { query: p.query, turn: s.turn }; clear(); return reply("Bueno. Dime el producto de otra forma, o di foto."); }
          if (p) { clear(); return reply("Bueno, no lo agrego. ¿Siguiente?"); }
          // «No» justo después de que REM agregó algo: lo quita y pregunta por el siguiente parecido.
          if (justAdded) {
            revert(justAdded);
            const next = justAdded.others.filter((r) => r.score >= 0.45);
            if (next.length) return askGuess({ type: "guess", ranked: next, index: 0, ...justAdded.ask }, `Quité ${short(justAdded.hit.name)}. `);
            s.miss = { query: justAdded.ask.query, turn: s.turn };
            return reply(`Quité ${short(justAdded.hit.name)}. Dímelo de otra forma, o di foto.`);
          }
          return reply("Bueno. ¿Qué hacemos?");
        }
        case "undo": {
          const id = s.lastAdded.pop() ?? a.lines.at(-1)?.id;
          const line = a.lines.find((l) => l.id === id);
          if (!line) return reply("No hay nada que quitar.");
          a.remove(line.id);
          s.lastAdd = null;
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
          if (!line && cmd.query) return resolveAndAdd({ query: cmd.query, qty: cmd.qty, add: false, extra: pre.extra }, []);
          if (!line) return reply("Todavía no hay productos.");
          return apply({ id: line.id, name: line.name, sku: line.sku, avail: null }, cmd.qty, false, pre.extra);
        }
        case "done": return finish();
        case "add": {
          if (p?.type === "qty" || p?.type === "guess" || p?.type === "choice") clear();
          const query = cmd.to ? `${cmd.query} para ${cmd.to}` : cmd.query;
          const others = alts.slice(1).map((alt) => parseTransferCommand(a.preparse ? a.preparse(alt).text : alt, null))
            .filter((c): c is Extract<TransferCommand, { kind: "add" }> => c.kind === "add").map((c) => c.query);
          return resolveAndAdd({ query, qty: cmd.qty, add: !cmd.exact, extra: pre.extra }, others);
        }
        // En una lista no hay ruta ni responsables: «de la AB-1240», «para el sábado»… se toma como producto.
        case "route": case "destination": case "notes": case "carrier": case "checker": {
          const text = normalize(pre.text).replace(/^(?:de|del|desde|para|hacia) (?:la |el |los |las )?/, "");
          const c = parseTransferCommand(text, null);
          if (c.kind === "add") return resolveAndAdd({ query: c.query, qty: c.qty, add: true, extra: pre.extra }, []);
          return reply("Dime un producto con su cantidad, o di listo.");
        }
      }
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
        s.lastAdd = null;
        const intro = reply(A().intro());
        if (!first?.length) return intro;
        const r = await hear(first);
        // «Quiero hacer un pedido interno», «vender»: lo que abrió la pantalla no es un producto (salvo que lo traiga:
        // «quiero vender tres secadores»). Si no se encontró seguro, se empieza normal.
        const opener = /traslad|conteo|contar|pedido|pedir|mercancia|compra|factura|vend|venta|\bpos\b|caja/.test(normalize(first[0] ?? ""));
        const unsure = s.pending?.type === "guess" || s.pending?.type === "choice";
        if (/^(?:No encontré|Dime un producto)/.test(r.say) || (opener && unsure)) { clear(); return intro; }
        return r;
      },
      hear,
    });
    return () => { off(); pickedRef.current = () => false; };
  }, [enabled, adapterRef]);

  /** true si REM había pedido la foto (la pantalla no debe abrir su propia ventana de cantidad). */
  return { picked: (hit: VoiceHit) => pickedRef.current(hit) };
}
