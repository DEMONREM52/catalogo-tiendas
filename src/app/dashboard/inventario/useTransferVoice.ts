"use client";

/**
 * REM en Traslados: armar la distribución hablando.
 *   «de bodega principal a zamora» · «tres de la a be guion doce cuarenta» · «la dos» · «quita el último»
 *   «cambia la zapatera a cuatro» · «lo lleva Pedro» · «revisó Juan» · «listo» → «¿Lo envío?» → «sí».
 * Nunca envía sin un «sí» dicho, y todo se ve en la tabla mientras se habla.
 */

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { clickRemPhoto, registerRemHandler, resumeRem, type RemReply } from "@/lib/voice/rem";
import { compactCode, matchPlace, matchPlaces, normalize, parseCorrection, parseTransferCommand, plural, spokenReference, type TransferCommand } from "@/lib/voice/spanish";
import { forget, learn, resolveSpoken, type Ranked } from "@/lib/voice/fuzzy";
import type { ProductHit, Warehouse } from "./shared";

export type TransferVoiceLine = { product_id: string; name: string; sku: string | null; available: number };

export type TransferVoiceApi = {
  storeId: string;
  /** Si el usuario está fijo en un punto, el origen no se cambia. */
  pointId: string | null;
  places: Warehouse[];
  from: string;
  targets: string[];
  lines: TransferVoiceLine[];
  matrix: Record<string, Record<string, number>>;
  carrier: string;
  checkedBy: string;
  availOf: (line: TransferVoiceLine) => number;
  setOrigin: (id: string) => void;
  setTargets: (ids: string[]) => void;
  /** Pone la cantidad de un producto para un destino (lo agrega a la lista si no estaba). */
  put: (hit: { id: string; name: string; sku: string | null; wh_qty: number }, dest: string, qty: number) => void;
  remove: (productId: string) => void;
  setCarrier: (v: string) => void;
  setCheckedBy: (v: string) => void;
  setNotes: (v: string) => void;
  /** Envía sin volver a preguntar en pantalla (ya se dijo «sí»). true si quedó enviado. */
  send: () => Promise<boolean>;
};

/** Cómo se llegó a un producto: para aprender si se confirma o se corrige. */
type Ask = { query: string; qty: number | null; dest: string; learnAlso?: string };

type Pending =
  | ({ type: "choice"; hits: ProductHit[]; add: boolean } & Ask)
  | { type: "qty"; hit: ProductHit; dest: string }
  /** No se encontró exacto: «¿Estás intentando decir…?» por cada parecido, en orden. */
  | ({ type: "guess"; ranked: Ranked<ProductHit>[]; index: number } & Ask)
  | { type: "overdraw"; hit: ProductHit; dest: string; qty: number; add: boolean }
  | { type: "send" }
  | null;

type Awaiting = Parameters<typeof parseTransferCommand>[1];

/** Lo último que REM agregó por voz (para «no», «esa no, la…»). */
type LastAdd = { turn: number; hit: ProductHit; dest: string; prevQty: number; ask: Ask; others: Ranked<ProductHit>[]; learned: boolean };
type AddFrom = Omit<LastAdd, "turn" | "hit" | "dest" | "prevQty">;

const EXAMPLES = [
  "De bodega principal a Zamora",
  "Tres de la A B guion doce cuarenta",
  "Cinco secadores para Norte",
  "La dos (cuando te lea opciones)",
  "Cambia la zapatera a cuatro · Quita el último",
  "¿Cuántos llevo?",
  "Lo lleva Pedro · Revisó Juan",
  "Listo → ¿Lo envío? → Sí",
  "Foto: busca el producto con la cámara",
  "Para / Cancelar: termina (queda el borrador)",
];

const short = (name: string) => name.toLowerCase().split(/\s+/).slice(0, 6).join(" ");

/** Busca en el origen (solo con existencias). */
async function searchIn(storeId: string, from: string, q: string, limit = 6): Promise<ProductHit[]> {
  const { data } = await supabaseBrowser().rpc("erp_search_products", { p_store: storeId, p_q: q, p_warehouse: from, p_in_stock: true, p_limit: limit });
  return (data ?? []) as ProductHit[];
}

/** El producto de la lista que más se parece a lo dicho. */
function findLine(lines: TransferVoiceLine[], spoken: string): TransferVoiceLine | null {
  const s = normalize(spoken);
  const code = compactCode(spokenReference(spoken));
  const words = s.split(" ").filter((w) => w.length > 2);
  let best: { l: TransferVoiceLine; score: number } | null = null;
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

export function useTransferVoice(apiRef: React.RefObject<TransferVoiceApi | null>, enabled: boolean) {
  const state = useRef({ awaiting: null as Awaiting, pending: null as Pending, lastAdded: [] as string[], dest: null as string | null, last: "", finishing: false, photo: false, turn: 0, lastAdd: null as LastAdd | null });
  const pickedRef = useRef<(hit: ProductHit) => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    const st = state.current;
    const api = () => apiRef.current!;
    const nameOf = (id: string) => api().places.find((w) => w.id === id)?.name ?? "el destino";
    const reply = (say: string, extra: Partial<RemReply> = {}): RemReply => { st.last = say; return { say, ...extra }; };

    /** Qué falta para seguir. `from`/`targets` se pasan cuando acaban de cambiar (el estado aún no llegó). */
    function nextPrompt(prefix = "", from = api().from, targets = api().targets): RemReply {
      const lead = prefix ? `${prefix} ` : "";
      if (!from) {
        st.awaiting = "from";
        const opts = api().places.filter((w) => w.active).slice(0, 4).map((w) => w.name.toLowerCase());
        return reply(`${lead}¿De dónde sale la mercancía?${opts.length ? ` Por ejemplo: ${opts.join(", ")}.` : ""}`);
      }
      if (!targets.length) { st.awaiting = "to"; return reply(`${lead}¿Para dónde va? Puedes decir varios.`); }
      st.awaiting = null;
      return reply(`${lead}Dime los productos. Por ejemplo: tres de la referencia, y la referencia.`);
    }

    function totals() {
      const a = api();
      const units = a.lines.reduce((s, l) => s + Object.values(a.matrix[l.product_id] ?? {}).reduce((x, y) => x + y, 0), 0);
      return { count: a.lines.length, units };
    }

    function summary(): RemReply {
      const a = api();
      const { count, units } = totals();
      if (!count) return nextPrompt("Todavía no llevas productos.");
      const items = a.lines.slice(-5).map((l) => `${Object.values(a.matrix[l.product_id] ?? {}).reduce((x, y) => x + y, 0)} de ${short(l.name)}`).join(", ");
      return reply(`Llevas ${plural(count, "producto", "productos")} y ${plural(units, "unidad", "unidades")}, de ${nameOf(a.from).toLowerCase()} para ${a.targets.map((t) => nameOf(t).toLowerCase()).join(" y ")}. ${count > 5 ? "Los últimos: " : ""}${items}.`);
    }

    /** Destino de un producto: el dicho («para zamora»), el actual o el primero. */
    function destFor(spoken: string | null): string | null {
      const a = api();
      if (spoken) {
        const p = matchPlace(spoken, a.places.filter((w) => a.targets.includes(w.id)));
        return p?.id ?? null;
      }
      return st.dest && a.targets.includes(st.dest) ? st.dest : a.targets[0] ?? null;
    }

    /** Pone la cantidad (sumando si `add`). Si no alcanza, pregunta si pone lo que hay. */
    function apply(hit: ProductHit, dest: string, qty: number, add: boolean, force = false, from?: AddFrom): RemReply {
      const a = api();
      const line = a.lines.find((l) => l.product_id === hit.id);
      const avail = line ? a.availOf(line) : hit.wh_qty;
      const mine = a.matrix[hit.id]?.[dest] ?? 0;
      const others = Object.entries(a.matrix[hit.id] ?? {}).filter(([d]) => d !== dest).reduce((s, [, v]) => s + v, 0);
      const room = Math.max(0, avail - others);
      let want = add ? mine + qty : qty;
      if (want > room && !force) {
        if (room <= mine && add) { st.pending = null; return reply(`De ${short(hit.name)} ya no quedan más unidades: hay ${avail}.`); }
        st.pending = { type: "overdraw", hit, dest, qty: room, add: false };
        st.awaiting = "confirm";
        return reply(`De ${short(hit.name)} solo hay ${room} disponibles. ¿Pongo ${room}?`);
      }
      want = Math.min(want, room);
      a.put(hit, dest, want);
      st.pending = null;
      st.awaiting = null;
      st.lastAdded = [...st.lastAdded.filter((id) => id !== hit.id), hit.id];
      st.lastAdd = from ? { ...from, turn: st.turn, hit, dest, prevQty: mine } : null;
      const where = a.targets.length > 1 ? ` para ${nameOf(dest).toLowerCase()}` : "";
      const sum = add && mine ? ` Ahora van ${want}.` : "";
      return reply(`${want} de ${short(hit.name)}${where}.${sum} ¿Siguiente?`);
    }

    function askChoice(hits: ProductHit[], ask: Ask, add: boolean): RemReply {
      const top = hits.slice(0, 3);
      st.pending = { type: "choice", hits: top, add, ...ask };
      st.awaiting = "choice";
      const nums = ["uno", "dos", "tres"];
      const list = top.map((h, i) => `${nums[i]}, ${short(h.name)}${h.sku ? ` ${h.sku}` : ""}`).join("; ");
      return reply(`Encontré ${top.length}: ${list}. ¿Cuál? O di ninguno.`, { show: `Encontré ${top.length}:\n${top.map((h, i) => `${i + 1}. ${h.name}${h.sku ? ` · ${h.sku}` : ""} (hay ${h.wh_qty})`).join("\n")}` });
    }

    function askGuess(p: Extract<Pending, { type: "guess" }>, lead = ""): RemReply {
      st.pending = p;
      st.awaiting = "confirm";
      const h = p.ranked[p.index].hit;
      const sku = h.sku && !normalize(h.name).includes(normalize(h.sku)) ? `, código ${h.sku}` : "";
      return reply(`${lead}¿Estás intentando decir ${h.name.toLowerCase()}${sku}?`, { show: `${lead}¿Estás intentando decir «${h.name}»${h.sku ? ` (${h.sku})` : ""}? Hay ${h.wh_qty}. Di sí o no.` });
    }

    function chosen(hit: ProductHit, qty: number | null, dest: string, add: boolean, from?: AddFrom): RemReply {
      if (qty === null) {
        st.lastAdd = null;
        st.pending = { type: "qty", hit, dest };
        st.awaiting = "qty";
        return reply(`${short(hit.name)}, hay ${hit.wh_qty}. ¿Cuántas?`);
      }
      return apply(hit, dest, qty, add, false, from);
    }

    const remember = (ask: Ask, hit: ProductHit) => { learn(ask.query, hit); if (ask.learnAlso) learn(ask.learnAlso, hit); };

    /** Deshace lo último que REM agregó (vuelve a la cantidad de antes) y olvida si venía de lo aprendido. */
    function revert(last: LastAdd) {
      const a = api();
      const others = Object.entries(a.matrix[last.hit.id] ?? {}).filter(([d]) => d !== last.dest).reduce((x, [, v]) => x + v, 0);
      if (last.prevQty > 0 || others > 0) a.put(last.hit, last.dest, last.prevQty);
      else a.remove(last.hit.id);
      st.lastAdded = st.lastAdded.filter((x) => x !== last.hit.id);
      st.lastAdd = null;
      if (last.learned) forget(last.ask.query);
    }

    /** De lo dicho al producto (en el origen, con existencias): seguro → se pone; duda → pregunta; varios → opciones. */
    async function resolveAndAdd(ask: Ask, alts: string[], lead = ""): Promise<RemReply> {
      const a = api();
      const res = await resolveSpoken<ProductHit>((q, limit) => searchIn(a.storeId, a.from, q, limit ?? 6), [ask.query, ...alts]);
      if (res.kind === "sure") {
        if (ask.learnAlso) learn(ask.learnAlso, res.hit);
        const learned = res.ranked[0]?.hit.id === res.hit.id && res.ranked[0].score === 1;
        const r = chosen(res.hit, ask.qty, ask.dest, true, { ask, others: res.ranked.filter((x) => x.hit.id !== res.hit.id), learned });
        return lead ? { ...r, say: `${lead}${r.say}`, show: `${lead}${r.show ?? r.say}` } : r;
      }
      if (res.kind === "ask") return askGuess({ type: "guess", ranked: res.ranked, index: 0, ...ask }, lead);
      if (res.kind === "choose") {
        const r = askChoice(res.ranked.map((x) => x.hit), ask, true);
        return { ...r, say: `${lead}No lo encontré exacto. ${r.say}`, show: `${lead}No lo encontré exacto. ${r.show ?? r.say}` };
      }
      return reply(`${lead}No encontré «${ask.query}» con existencias en ${nameOf(api().from).toLowerCase()}. Dilo de otra forma, dicta la referencia letra por letra, o di foto.`);
    }

    async function addSpoken(said: Extract<TransferCommand, { kind: "add" }>, alts: string[]): Promise<RemReply> {
      const a = api();
      let cmd = said;
      if (!a.from || !a.targets.length) return nextPrompt("Primero dime de dónde sale y para dónde va.");
      let dest = destFor(cmd.to);
      // «soporte para celular»: si lo de después de «para» no es un destino, es parte del nombre.
      if (!dest && cmd.to) { cmd = { ...cmd, query: `${cmd.query} para ${cmd.to}`, to: null }; dest = destFor(null); }
      if (!dest) return nextPrompt();
      const others = alts.slice(1).map((alt) => parseTransferCommand(alt, null))
        .filter((c): c is Extract<TransferCommand, { kind: "add" }> => c.kind === "add").map((c) => c.query);
      return resolveAndAdd({ query: cmd.query, qty: cmd.qty, dest }, others);
    }

    /** «Listo»: pide lo que falte y luego confirma. `now` trae lo que se acaba de decir (el estado aún no llegó). */
    function finish(now: { carrier?: string; checkedBy?: string } = {}): RemReply {
      const a = { ...api(), ...now };
      st.finishing = true;
      const { count, units } = totals();
      if (!count || !units) { st.finishing = false; return nextPrompt("Todavía no hay productos con cantidad."); }
      const over = a.lines.filter((l) => Object.values(a.matrix[l.product_id] ?? {}).reduce((x, y) => x + y, 0) > a.availOf(l));
      if (over.length) { st.finishing = false; return reply(`Hay productos con más unidades de las que hay: ${over.slice(0, 3).map((l) => short(l.name)).join(", ")}. Corrígelos diciendo, por ejemplo: cambia ${short(over[0].name)} a dos.`); }
      if (!a.checkedBy.trim()) { st.awaiting = "checker"; return reply("¿Quién revisó la mercancía?"); }
      if (!a.carrier.trim()) { st.awaiting = "carrier"; return reply("¿Quién la lleva?"); }
      st.pending = { type: "send" };
      st.awaiting = "confirm";
      return reply(`Son ${plural(count, "producto", "productos")} y ${plural(units, "unidad", "unidades")}, de ${nameOf(a.from).toLowerCase()} para ${a.targets.map((t) => nameOf(t).toLowerCase()).join(" y ")}. Revisó ${a.checkedBy.toLowerCase()}, lo lleva ${a.carrier.toLowerCase()}. ¿Lo envío?`);
    }

    async function hear(alts: string[]): Promise<RemReply> {
      const a = api();
      st.turn++;
      const pending = st.pending;
      const justAdded = st.lastAdd && st.lastAdd.turn === st.turn - 1 ? st.lastAdd : null;
      // Corrección de lo que REM acaba de poner: «esa no, la VTS 30», «de la referencia vts 30», «me refiero a…».
      if (!pending && justAdded) {
        const fix = parseCorrection(alts[0] ?? "");
        if (fix) {
          revert(justAdded);
          return resolveAndAdd({ ...justAdded.ask, query: fix.query, qty: fix.qty ?? justAdded.ask.qty, learnAlso: justAdded.ask.query }, [], `Quité ${short(justAdded.hit.name)}. `);
        }
      }
      const cmd = parseTransferCommand(alts[0] ?? "", st.awaiting);

      switch (cmd.kind) {
        case "stop":
          st.pending = null; st.awaiting = null; st.finishing = false;
          return reply(a.lines.length ? "Listo. El traslado queda como borrador en esta pantalla." : "Listo, hasta luego.", { end: true });
        case "help":
          return reply("Puedes decir: de bodega a zamora; tres de tal referencia; la dos; cambia tal a cuatro; quita el último; cuántos llevo; lo lleva fulano; revisó fulano; y listo para enviar.");
        case "repeat":
          return reply(st.last || "Dime.");
        case "summary":
          return summary();

        case "route": {
          let from = a.from;
          let targets = a.targets;
          const notes: string[] = [];
          if (cmd.from) {
            if (a.pointId) notes.push(`Sale de ${nameOf(a.pointId).toLowerCase()}, que es tu punto.`);
            else {
              const p = matchPlace(cmd.from, a.places.filter((w) => w.active));
              if (!p) notes.push(`No encontré «${cmd.from}».`);
              else if (p.id !== from && a.lines.length) notes.push(`Ya llevas productos desde ${nameOf(from).toLowerCase()}. Para cambiar el origen, descarta el borrador en pantalla.`);
              else if (p.id !== from) { from = p.id; targets = targets.filter((t) => t !== p.id); a.setOrigin(p.id); notes.push(`Sale de ${p.name.toLowerCase()}.`); }
            }
          }
          if (cmd.to) {
            const pool = a.places.filter((w) => w.active && w.id !== from);
            const { found, missing } = matchPlaces(cmd.to, pool);
            if (found.length) { targets = [...new Set([...targets, ...found.map((f) => f.id)])]; a.setTargets(targets); st.dest = found[0].id; notes.push(`Va para ${found.map((f) => f.name.toLowerCase()).join(" y ")}.`); }
            if (missing.length) notes.push(`No encontré ${missing.map((m) => `«${m}»`).join(" ni ")}.`);
          }
          if (!cmd.from && !cmd.to && a.lines.length) return reply(`Seguimos con el traslado: llevas ${plural(a.lines.length, "producto", "productos")}. Dime más productos o di listo.`);
          return nextPrompt(notes.join(" ") || "Vamos con el traslado.", from, targets);
        }

        case "destination": {
          const pool = a.places.filter((w) => w.active && w.id !== a.from);
          const p = matchPlace(cmd.to, pool);
          if (!p) return reply(`No encontré «${cmd.to}».`);
          if (!a.targets.includes(p.id)) a.setTargets([...a.targets, p.id]);
          st.dest = p.id;
          return reply(`Ahora lo que digas va para ${p.name.toLowerCase()}.`);
        }

        case "choice": {
          if (pending?.type !== "choice") return reply("No te estaba dando opciones. Dime el producto.");
          if (cmd.index === 0) { st.pending = null; st.awaiting = null; return reply("Bueno. Dime el producto de otra forma."); }
          const hit = pending.hits[cmd.index - 1];
          if (!hit) return reply(`Solo hay ${pending.hits.length} opciones. ¿Cuál?`);
          remember(pending, hit);
          return chosen(hit, pending.qty, pending.dest, pending.add, { ask: pending, others: [], learned: false });
        }

        case "number": {
          if (pending?.type === "qty") return apply(pending.hit, pending.dest, cmd.value, true);
          if (pending?.type === "guess") {
            const hit = pending.ranked[pending.index].hit;
            remember(pending, hit);
            return chosen(hit, cmd.value, pending.dest, true, { ask: pending, others: [], learned: false });
          }
          if (pending?.type === "choice") return hear([`la ${cmd.value}`]);
          if (pending?.type === "overdraw") return apply(pending.hit, pending.dest, Math.min(cmd.value, pending.qty), false);
          return reply("¿Cuántas de qué? Di por ejemplo: tres de la zapatera.");
        }

        case "yes": {
          if (pending?.type === "overdraw") return apply(pending.hit, pending.dest, Math.min(cmd.qty ?? pending.qty, pending.qty), false, true);
          if (pending?.type === "qty" && cmd.qty) return apply(pending.hit, pending.dest, cmd.qty, true);
          // «Sí» o «sí, necesito tres»: ese, con la cantidad dicha ahora o la de antes.
          if (pending?.type === "guess") {
            const hit = pending.ranked[pending.index].hit;
            remember(pending, hit);
            return chosen(hit, cmd.qty ?? pending.qty, pending.dest, true, { ask: pending, others: pending.ranked.filter((r) => r.hit.id !== hit.id), learned: false });
          }
          if (pending?.type === "choice" && pending.hits.length === 1) { remember(pending, pending.hits[0]); return chosen(pending.hits[0], cmd.qty ?? pending.qty, pending.dest, pending.add); }
          if (pending?.type === "choice") return reply("¿Cuál? Di el número: la uno, la dos…");
          if (pending?.type === "send") {
            st.pending = null; st.awaiting = null; st.finishing = false;
            const ok = await a.send();
            st.lastAdded = [];
            return ok
              ? reply("Enviado. En pantalla están los enlaces para mandar por WhatsApp.", { end: true })
              : reply("No se envió. Revisa el aviso en pantalla.", { end: true });
          }
          return st.finishing ? finish() : reply("Dime el siguiente producto, o di listo.");
        }

        case "no": {
          if (pending?.type === "send") { st.pending = null; st.awaiting = null; st.finishing = false; return reply("Bueno, no lo envío. Sigue agregando o corrige lo que necesites."); }
          if (pending?.type === "guess") {
            if (pending.index + 1 < pending.ranked.length) return askGuess({ ...pending, index: pending.index + 1 }, "¿Entonces ");
            st.pending = null; st.awaiting = null;
            return reply("Bueno. Dímelo de otra forma, dicta la referencia letra por letra, o di foto.");
          }
          if (pending) { st.pending = null; st.awaiting = null; return reply("Bueno, no lo agrego. ¿Siguiente?"); }
          // «No» justo después de que REM puso algo: lo quita y pregunta por el siguiente parecido.
          if (justAdded) {
            revert(justAdded);
            const next = justAdded.others.filter((r) => r.score >= 0.45);
            if (next.length) return askGuess({ type: "guess", ranked: next, index: 0, ...justAdded.ask }, `Quité ${short(justAdded.hit.name)}. `);
            return reply(`Quité ${short(justAdded.hit.name)}. Dímelo de otra forma, o di foto.`);
          }
          return reply("Bueno. ¿Qué hacemos?");
        }

        case "undo": {
          const id = st.lastAdded.pop() ?? a.lines.at(-1)?.product_id;
          const line = a.lines.find((l) => l.product_id === id);
          if (!line) return reply("No hay nada que quitar.");
          a.remove(line.product_id);
          return reply(`Quité ${short(line.name)}.`);
        }

        case "remove": {
          const line = findLine(a.lines, cmd.query);
          if (!line) return reply(`«${cmd.query}» no está en la lista.`);
          a.remove(line.product_id);
          st.lastAdded = st.lastAdded.filter((x) => x !== line.product_id);
          return reply(`Quité ${short(line.name)}.`);
        }

        case "set_qty": {
          const line = cmd.query ? findLine(a.lines, cmd.query) : a.lines.find((l) => l.product_id === st.lastAdded.at(-1)) ?? a.lines.at(-1);
          if (!line) return reply(cmd.query ? `«${cmd.query}» no está en la lista.` : "Todavía no hay productos.");
          const dest = destFor(null);
          if (!dest) return nextPrompt();
          return apply({ id: line.product_id, name: line.name, sku: line.sku, wh_qty: a.availOf(line), barcode: null, cost_price: 0, tax_rate: 0, stock: 0 }, dest, cmd.qty, false);
        }

        case "carrier":
          a.setCarrier(cmd.name);
          if (st.finishing) return finish({ carrier: cmd.name });
          return reply(`Anotado: lo lleva ${cmd.name.toLowerCase()}.`);
        case "checker":
          a.setCheckedBy(cmd.name);
          if (st.finishing) return finish({ checkedBy: cmd.name });
          return reply(`Anotado: revisó ${cmd.name.toLowerCase()}.`);
        case "notes":
          a.setNotes(cmd.text);
          return reply("Anoté la nota.");

        case "done":
          return finish();

        case "photo": {
          if (!a.from || !a.targets.length) return nextPrompt("Primero dime de dónde sale y para dónde va.");
          if (!clickRemPhoto()) return reply("No encontré la búsqueda por foto en pantalla.");
          st.photo = true; st.pending = null; st.awaiting = null;
          return reply("Toma la foto del producto y tócalo. Luego te pregunto cuántas.", { end: true });
        }

        case "add":
          if (pending?.type === "choice" || pending?.type === "qty" || pending?.type === "guess") st.pending = null;
          return addSpoken(cmd, alts);
      }
    }

    // Producto elegido con la foto que pidió REM: pregunta cuántas y sigue la conversación.
    pickedRef.current = (hit) => {
      if (!st.photo) return;
      st.photo = false;
      const dest = destFor(null);
      if (!dest) return;
      resumeRem(chosen(hit, null, dest, false));
    };

    const off = registerRemHandler({
      title: "Traslado",
      examples: EXAMPLES,
      start: async (first) => {
        st.pending = null; st.awaiting = null; st.finishing = false; st.lastAdded = []; st.lastAdd = null;
        if (first?.length) return hear(first);
        const a = api();
        if (a.lines.length) return reply(`Seguimos con el traslado de ${nameOf(a.from).toLowerCase()}: llevas ${plural(a.lines.length, "producto", "productos")}. Dime más o di listo.`);
        return nextPrompt("Vamos con el traslado.");
      },
      hear,
    });
    return () => { off(); pickedRef.current = () => {}; };
  }, [enabled, apiRef]);

  return { picked: (hit: ProductHit) => pickedRef.current(hit) };
}
