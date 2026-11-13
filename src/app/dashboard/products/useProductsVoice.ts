"use client";

/**
 * REM en Productos: «Ren, búscame en los productos la cámara sc30a» → abre Productos, escribe la búsqueda,
 * dice qué encontró y pregunta «¿Qué quieres que haga por ti?». Después se le sigue hablando:
 * «léemelos», «abre el primero», «inactívalo», «busca otra cosa», «solo los agotados», «ordénalos por precio», «limpia».
 * Inactivar o activar siempre pregunta antes («¿Inactivo…? Di sí o no»).
 */

import { useEffect, useRef } from "react";
import { registerRemHandler, type RemReply } from "@/lib/voice/rem";
import { parseProductsCommand, type ProductsCommand } from "@/lib/voice/products-voice";
import { findSpokenLine } from "@/lib/voice/useListVoice";

export type VoiceProduct = { id: string; name: string; sku: string | null; active: boolean; stock: number | null };

export type ProductsVoiceApi = {
  /** Lo que está en pantalla ahora: lo escrito, lo ya buscado y los productos que se ven (en orden). */
  view: () => { q: string; searched: string; busy: boolean; items: VoiceProduct[] };
  setQuery: (q: string) => void;
  /** Buscar ya, sin esperar a que «termine de escribir». */
  flush: () => void;
  clear: () => void;
  setStatus: (v: "all" | "active" | "inactive") => void;
  setStock: (v: "all" | "in" | "out") => void;
  setSort: (v: "newest" | "oldest" | "name" | "price" | "price-desc" | "stock") => void;
  toggle: (id: string) => Promise<boolean>;
  open: (id: string) => void;
};

const EXAMPLES = [
  "Búscame la cámara SC30",
  "Léemelos",
  "Abre el primero",
  "Inactiva el dos",
  "Solo los agotados",
  "Ordénalos por precio",
  "Limpia",
];

const ASK = "¿Qué quieres que haga por ti?";
const short = (name: string) => name.toLowerCase().split(/\s+/).slice(0, 7).join(" ");
const nums = ["uno", "dos", "tres", "cuatro", "cinco"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function useProductsVoice(apiRef: React.RefObject<ProductsVoiceApi | null>, enabled: boolean) {
  const st = useRef({
    awaiting: null as "query" | "confirm" | "pick" | null,
    /** El producto del que se está hablando («ábrelo», «inactívalo»). */
    current: null as VoiceProduct | null,
    /** Lo que espera un «sí» o que diga cuál. */
    pending: null as null | { type: "toggle"; active: boolean; product?: VoiceProduct } | { type: "open" },
  });

  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    const api = () => apiRef.current!;
    const reply = (say: string, extra: Partial<RemReply> = {}): RemReply => ({ say, ...extra });

    /** Espera a que la búsqueda pedida esté en pantalla (máx. 9 s). */
    async function results(query: string) {
      const until = Date.now() + 9000;
      let flushed = false;
      let calm = 0;
      while (Date.now() < until) {
        await new Promise((r) => window.setTimeout(r, 140));
        const v = api().view();
        if (!flushed && v.q === query) { api().flush(); flushed = true; }
        // Dos lecturas seguidas «ya buscó y no está ocupado»: entre que cambia el texto y arranca la búsqueda hay un
        // instante en que parece listo con los resultados viejos.
        calm = v.searched === query.trim() && !v.busy ? calm + 1 : 0;
        if (calm >= 2) return v.items;
      }
      return api().view().items;
    }

    async function search(query: string): Promise<RemReply> {
      s.pending = null;
      if (!query) { s.awaiting = "query"; return reply("¿Qué producto busco?"); }
      s.awaiting = null;
      api().setQuery(query);
      const items = await results(query);
      s.current = items.length === 1 ? items[0] : null;
      if (!items.length) {
        s.awaiting = "query";
        return reply(`No encontré «${query}» en productos. Dímelo de otra forma.`);
      }
      if (items.length === 1) {
        const p = items[0];
        return reply(`Encontré ${short(p.name)}${p.active ? "" : ", que está inactivo"}. ${ASK}`, { show: `Encontré «${p.name}»${p.sku ? ` · ${p.sku}` : ""}${p.active ? "" : " (inactivo)"}.\n${ASK}` });
      }
      const top = items.slice(0, 3);
      return reply(`Encontré ${items.length >= 20 ? "varios" : items.length}. ${top.map((p, i) => `${nums[i]}, ${short(p.name)}`).join("; ")}. ${ASK}`,
        { show: `Encontré ${items.length >= 20 ? "20 o más" : items.length}:\n${top.map((p, i) => `${i + 1}. ${p.name}${p.sku ? ` · ${p.sku}` : ""}${p.active ? "" : " (inactivo)"}`).join("\n")}${items.length > 3 ? "\n…" : ""}\n${ASK}` });
    }

    /** De qué producto habla: el número, el nombre, el de la conversación o el único en pantalla. null = preguntar. */
    function pick(index: number | null, name: string | null): VoiceProduct | null {
      const items = api().view().items;
      if (index !== null) return (index === -1 ? items.at(-1) : items[index - 1]) ?? null;
      if (name) return findSpokenLine(items, name);
      if (s.current && items.some((p) => p.id === s.current!.id)) return items.find((p) => p.id === s.current!.id) ?? null;
      return items.length === 1 ? items[0] : null;
    }

    function askWhich(type: "toggle" | "open", active = false): RemReply {
      const items = api().view().items;
      if (!items.length) { s.awaiting = "query"; return reply("No hay productos en pantalla. ¿Qué busco?"); }
      s.pending = type === "toggle" ? { type, active } : { type };
      s.awaiting = "pick";
      const top = items.slice(0, 3);
      return reply(`¿Cuál? ${top.map((p, i) => `${nums[i]}, ${short(p.name)}`).join("; ")}.`);
    }

    function confirmToggle(p: VoiceProduct, active: boolean): RemReply {
      if (p.active === active) { s.current = p; return reply(`${short(p.name)} ya está ${active ? "activo" : "inactivo"}. ¿Algo más?`); }
      s.current = p;
      s.pending = { type: "toggle", active, product: p };
      s.awaiting = "confirm";
      return reply(active ? `¿Activo ${short(p.name)}? Vuelve a venderse y a salir en los catálogos. Di sí o no.` : `¿Inactivo ${short(p.name)}? Deja de venderse y de salir en los catálogos. Di sí o no.`);
    }

    function open(p: VoiceProduct): RemReply {
      s.pending = null; s.awaiting = null;
      api().open(p.id);
      return reply(`Abro ${short(p.name)}.`, { end: true });
    }

    async function run(cmd: ProductsCommand): Promise<RemReply> {
      const items = api().view().items;
      switch (cmd.kind) {
        case "stop": s.pending = null; s.awaiting = null; return reply("Listo. Aquí quedan los productos.", { end: true });
        case "help": return reply(`Puedes decir: ${EXAMPLES.slice(0, 6).join("; ")}; o listo.`);
        case "search": return search(cmd.query);
        case "read": {
          if (!items.length) return reply("No hay productos en pantalla. ¿Qué busco?");
          const top = items.slice(0, 5);
          return reply(`${items.length >= 20 ? "Hay 20 o más" : `Hay ${plural(items.length, "producto", "productos")}`}. ${top.map((p, i) => `${nums[i]}, ${short(p.name)}${p.active ? "" : ", inactivo"}`).join("; ")}. ${ASK}`);
        }
        case "open": {
          const p = pick(cmd.index, cmd.name);
          return p ? open(p) : askWhich("open");
        }
        case "toggle": {
          const p = pick(cmd.index, cmd.name);
          return p ? confirmToggle(p, cmd.active) : askWhich("toggle", cmd.active);
        }
        case "pick": {
          const pend = s.pending;
          const p = pick(cmd.index, null);
          if (!pend || !p) return reply("¿Cuál? Di el número: el uno, el dos…");
          if (pend.type === "open") return open(p);
          return confirmToggle(p, pend.active);
        }
        case "yes": {
          const pend = s.pending;
          if (pend?.type === "toggle" && pend.product) {
            s.pending = null; s.awaiting = null;
            const ok = await api().toggle(pend.product.id);
            if (!ok) return reply("No se pudo cambiar. Revisa el aviso en pantalla.");
            s.current = { ...pend.product, active: pend.active };
            return reply(`Listo, ${pend.active ? "activé" : "inactivé"} ${short(pend.product.name)}. ¿Algo más?`);
          }
          return reply(ASK);
        }
        case "no": s.pending = null; s.awaiting = null; return reply(`Bueno, no hago nada. ${ASK}`);
        case "filter": {
          if (cmd.status) api().setStatus(cmd.status);
          if (cmd.stock) api().setStock(cmd.stock);
          const what = cmd.stock === "out" ? "los agotados" : cmd.stock === "in" ? "los que tienen existencias" : cmd.status === "inactive" ? "los inactivos" : cmd.status === "active" ? "los activos" : "todos";
          const now = await results(api().view().searched);
          return reply(`Te muestro ${what}: ${now.length >= 20 ? "20 o más" : plural(now.length, "producto", "productos")}. ¿Algo más?`);
        }
        case "sort": {
          api().setSort(cmd.by);
          const label = { newest: "los más nuevos primero", oldest: "los más viejos primero", name: "por nombre", price: "del más barato al más caro", "price-desc": "del más caro al más barato", stock: "por existencias" }[cmd.by];
          return reply(`Ordenados ${label}. ¿Algo más?`);
        }
        case "clear": {
          s.current = null; s.pending = null; s.awaiting = null;
          api().clear();
          return reply("Limpié la búsqueda y los filtros. ¿Qué busco?");
        }
        default:
          return reply("No te entendí. Puedes decir: búscame la cámara, abre el primero, inactiva el dos, solo los agotados, o listo.");
      }
    }

    const off = registerRemHandler({
      title: "Productos",
      examples: EXAMPLES,
      start: async (first) => {
        s.awaiting = null; s.pending = null;
        const said = first?.[0];
        if (said) {
          const cmd = parseProductsCommand(said, null);
          if (cmd.kind !== "unknown") return run(cmd);
        }
        const q = api().view().searched;
        if (q) return reply(`Estoy en productos, con la búsqueda «${q}». ${ASK}`);
        s.awaiting = "query";
        return reply("Estoy en productos. ¿Qué busco?");
      },
      hear: async (alts) => run(parseProductsCommand(alts[0] ?? "", s.awaiting)),
      // Sus frases («muéstrame solo los agotados», «abre el primero») no son «ir a otra página».
      // «Quiero que me busques…» tampoco: se busca aquí mismo.
      // Pero «quiero ir a gastos» o «abre los gastos» sí son otra página: no se reclaman.
      claims: (text) => {
        const cmd = parseProductsCommand(text, s.awaiting === "query" ? null : s.awaiting);
        if (cmd.kind === "unknown") return false;
        if (cmd.kind === "open" && cmd.name) return Boolean(findSpokenLine(api().view().items, cmd.name));
        return true;
      },
    });
    return () => off();
  }, [enabled, apiRef]);
}
