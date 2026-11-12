/**
 * REM: entender lo que se dice en español, sin IA y sin servidor.
 *
 *   · `normalize` quita tildes, mayúsculas y signos.
 *   · `parseNumberAt` lee números dichos («tres», «veintidós», «ciento veinte», «1.240»).
 *   · `spokenReference` arma la referencia dicha («a be guion doce cuarenta» → «AB-1240»).
 *   · `parseTransferCommand` reconoce las órdenes del traslado por voz.
 *
 * Todo es puro (se prueba en tests/voice/spanish.test.ts).
 */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!,;:"«»()]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};
const TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

type NumClass = "unit" | "teen" | "ten" | "hundred" | "thousand";
function classOf(word: string): { cls: NumClass; value: number } | null {
  if (word in UNITS) return { cls: "unit", value: UNITS[word] };
  if (word in TEENS) return { cls: "teen", value: TEENS[word] };
  if (word in TENS) return { cls: "ten", value: TENS[word] };
  if (word in HUNDREDS) return { cls: "hundred", value: HUNDREDS[word] };
  if (word === "mil") return { cls: "thousand", value: 1000 };
  return null;
}

const DIGITS = /^\d+(?:[.,]\d{3})*$/;

/**
 * Lee un número que empieza en `words[start]`. Devuelve el valor y cuántas palabras usó, o null.
 * «doce cuarenta» se lee como 12 (y deja «cuarenta» para el siguiente): así una referencia dicha por partes no se suma.
 */
export function parseNumberAt(words: string[], start: number): { value: number; used: number } | null {
  const first = words[start];
  if (first === undefined) return null;
  if (DIGITS.test(first)) return { value: Number(first.replace(/[.,]/g, "")), used: 1 };
  let total = 0;
  let current = 0;
  let last: NumClass | null = null;
  let i = start;
  while (i < words.length) {
    const w = words[i];
    if (w === "y" && last === "ten") {
      const next = classOf(words[i + 1] ?? "");
      if (next?.cls === "unit") { current += next.value; last = "unit"; i += 2; continue; }
      break;
    }
    const c = classOf(w);
    if (!c) break;
    const ok =
      last === null ||
      (last === "hundred" && (c.cls === "ten" || c.cls === "teen" || c.cls === "unit")) ||
      (last === "thousand" && c.cls !== "thousand") ||
      (c.cls === "thousand" && last !== "thousand" && total === 0) ||
      (c.cls === "hundred" && last === "thousand");
    if (!ok) break;
    if (c.cls === "thousand") { total = (current || 1) * 1000; current = 0; }
    else current += c.value;
    last = c.cls;
    i++;
  }
  if (i === start) return null;
  return { value: total + current, used: i - start };
}

/** Nombres de las letras como se dicen en voz alta. */
const LETTERS: Record<string, string> = {
  a: "A", be: "B", b: "B", ce: "C", c: "C", d: "D", e: "E", efe: "F", f: "F", ge: "G", g: "G", hache: "H", h: "H",
  i: "I", jota: "J", j: "J", ka: "K", k: "K", ele: "L", l: "L", eme: "M", m: "M", ene: "N", n: "N", o: "O",
  pe: "P", p: "P", cu: "Q", q: "Q", erre: "R", r: "R", ere: "R", ese: "S", s: "S", te: "T", t: "T", u: "U",
  uve: "V", ve: "V", v: "V", w: "W", equis: "X", x: "X", ye: "Y", z: "Z", zeta: "Z",
};
const SEPARATORS: Record<string, string> = { guion: "-", guiones: "-", menos: "-", raya: "-", punto: ".", barra: "/", slash: "/" };

/**
 * Referencia dicha → texto de código. «a be guion doce cuarenta» → «AB-1240»; «ref 55 08» → «5508».
 * Si hay palabras que no son letras, números ni separadores, se dejan tal cual (en mayúsculas, pegadas).
 */
export function spokenReference(text: string): string {
  const words = normalize(text).replace(/-/g, " - ").split(" ").filter(Boolean)
    .filter((w) => !["referencia", "ref", "codigo", "la", "el", "de", "del", "numero", "espacio"].includes(w));
  let out = "";
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === "-" || w in SEPARATORS) { out += w === "-" ? "-" : SEPARATORS[w]; i++; continue; }
    if (w === "doble" && (words[i + 1] === "ve" || words[i + 1] === "u" || words[i + 1] === "uve")) { out += "W"; i += 2; continue; }
    if (w === "i" && words[i + 1] === "griega") { out += "Y"; i += 2; continue; }
    // «una»/«un» casi nunca son letras en una referencia: «uno» sí es número.
    if (/^\d+$/.test(w)) { out += w; i++; continue; }
    const n = w === "un" || w === "una" ? null : parseNumberAt(words, i);
    if (n) { out += String(n.value); i += n.used; continue; }
    if (w in LETTERS) { out += LETTERS[w]; i++; continue; }
    out += w.toUpperCase();
    i++;
  }
  return out;
}

/** Solo letras y números, para comparar códigos sin importar guiones ni espacios. */
export function compactCode(text: string | null | undefined): string {
  return (text ?? "").toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------------------------
// Puntos y bodegas por nombre

export type NamedPlace = { id: string; name: string; code?: string | null };

function placeScore(spoken: string, place: NamedPlace): number {
  const s = normalize(spoken);
  const n = normalize(place.name);
  if (!s) return 0;
  if (s === n || (place.code && s === normalize(place.code))) return 100;
  const sw = s.split(" ").filter((w) => w.length > 2 && !["punto", "bodega", "la", "el", "del", "los", "las"].includes(w));
  const nw = n.split(" ");
  // Solo una palabra genérica («la bodega»): vale si la tiene (si la tienen varios, empatan y no se elige ninguno).
  if (!sw.length) return nw.some((w) => w.length > 2 && s.split(" ").includes(w)) ? 45 : 0;
  if (n.includes(s) || s.includes(n)) return 80 - Math.abs(n.length - s.length) / 4;
  const hits = sw.filter((w) => nw.some((x) => x === w || (x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)) ))).length;
  return hits ? 40 + (hits / sw.length) * 30 : 0;
}

/** El punto o bodega que más se parece a lo dicho; null si ninguno se parece o si dos empatan. */
export function matchPlace(spoken: string, places: NamedPlace[]): NamedPlace | null {
  const ranked = places.map((p) => ({ p, s: placeScore(spoken, p) })).filter((x) => x.s >= 40).sort((a, b) => b.s - a.s);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[1].s === ranked[0].s) return null;
  return ranked[0].p;
}

/** «Zamora y Centro» → los dos. Devuelve los que encontró y las partes que no. */
export function matchPlaces(spoken: string, places: NamedPlace[]): { found: NamedPlace[]; missing: string[] } {
  const parts = normalize(spoken).split(/\s+(?:y|e|con|mas)\s+|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  const found: NamedPlace[] = [];
  const missing: string[] = [];
  // Primero el nombre completo: «Bodega y Punto Norte» podría ser un solo nombre.
  const whole = matchPlace(spoken, places);
  if (whole && placeScore(spoken, whole) >= 80) return { found: [whole], missing: [] };
  for (const part of parts) {
    const p = matchPlace(part, places);
    if (p) { if (!found.some((f) => f.id === p.id)) found.push(p); }
    else missing.push(part);
  }
  return { found, missing };
}

// ---------------------------------------------------------------------------------------------
// Órdenes del traslado

export type TransferCommand =
  | { kind: "stop" }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "help" }
  | { kind: "repeat" }
  | { kind: "summary" }
  | { kind: "done" }
  | { kind: "undo" }
  | { kind: "remove"; query: string }
  | { kind: "set_qty"; query: string | null; qty: number }
  | { kind: "carrier"; name: string }
  | { kind: "checker"; name: string }
  | { kind: "notes"; text: string }
  | { kind: "route"; from: string | null; to: string | null }
  | { kind: "destination"; to: string }
  | { kind: "choice"; index: number }
  | { kind: "number"; value: number }
  | { kind: "add"; qty: number | null; query: string; to: string | null };

const ORDINALS: Record<string, number> = {
  primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5,
};

const STOP = /^(?:para|parar|pare|detente|deten|cancela|cancelar|cancelalo|cancela todo|chao|adios|salir|sal|callate|silencio|ya no|olvidalo|hasta luego|gracias rem|gracias)$/;
const YES = /^(?:si|si senor|claro|dale|de una|correcto|eso|exacto|afirmativo|ok|okay|okey|hagale|hazlo|confirmo|confirmado|envialo|si envialo|si dale|si por favor|si claro|listo si|bueno|vale)$/;
const NO = /^(?:no|nop|nel|negativo|todavia no|aun no|no gracias|no todavia|espera|esperate|todavia)$/;
const DONE = /^(?:listo|lista|ya|ya esta|termine|terminamos|termina|terminar|eso es todo|es todo|nada mas|eso seria todo|enviar|envia|envialo ya|guardar|guarda|guardalo|finalizar|finaliza|ya termine|listo rem|listo ya)$/;

/** Quita el «REM» del principio y muletillas que no cambian la orden. */
function clean(text: string): string {
  return normalize(text)
    .replace(/^(?:oye |hey |ey |ok |okay )?(?:rem|ren|rem rem)\b[ ,]*/, "")
    .replace(/\s+por favor$/, "")
    .replace(/^(?:por favor|porfa|bueno|entonces|ahora|y|ok|vale) /, "")
    .trim();
}

/** Lee un número (cifras, palabras u ordinal) que sea toda la frase o casi: «la dos», «el número 3», «tres». */
function loneNumber(text: string): number | null {
  const words = text.replace(/^(?:la|el|los|las|numero|opcion|son|serian|van|pon|ponle|que sean|sean)\s+/, "").replace(/^(?:numero|opcion)\s+/, "").replace(/\s+(?:unidades|unidad|piezas|pares|cajas)$/, "").split(" ");
  if (words.length === 1 && words[0] in ORDINALS) return ORDINALS[words[0]];
  const n = parseNumberAt(words, 0);
  return n && n.used === words.length ? n.value : null;
}

const ADD_VERB = /^(?:agrega|agregale|agregar|anade|anadir|anadele|pon|ponle|pone|mete|metele|suma|sumale|incluye|y|tambien|mas|otro|otra)\s+/;
const UNIT_WORDS = /^(?:unidades|unidad|piezas|pieza|pares|par|cajas|caja|de|del)\s+/;

/**
 * Orden del traslado. `awaiting` dice qué preguntó REM: un número suelto es elección («la dos»),
 * cantidad o nada según lo que se esté esperando.
 */
export function parseTransferCommand(raw: string, awaiting: "choice" | "qty" | "confirm" | "from" | "to" | "carrier" | "checker" | null = null): TransferCommand {
  const t = clean(raw);
  if (!t) return { kind: "repeat" };
  if (STOP.test(t)) return { kind: "stop" };
  if (YES.test(t)) return { kind: "yes" };
  if (NO.test(t)) return { kind: "no" };
  if (/^(?:ayuda|que puedo decir|que digo|como funciona|como se usa|que sabes hacer)$/.test(t)) return { kind: "help" };
  if (/^(?:repite|repitelo|otra vez|que dijiste|como|perdon|no te entendi|no entendi)$/.test(t)) return { kind: "repeat" };
  if (/^(?:cuantos? llevo|cuantas? llevo|que llevo|que llevamos|resumen|lee la lista|leeme la lista|como vamos|cuanto llevo|como va)$/.test(t)) return { kind: "summary" };
  if (/^(?:quita|quitale|borra|borrale|elimina|saca|deshaz|deshacer|devuelve)(?: (?:el|la|lo))? ultim[oa](?: que agregue| producto)?$|^(?:deshacer|deshaz|me equivoque)$/.test(t)) return { kind: "undo" };

  if (awaiting === "carrier" || awaiting === "checker") {
    const name = t.replace(/^(?:lo |la )?(?:lleva|llevo|traslada|reviso|revisa)\s+/, "").replace(/^(?:es|fue|se llama)\s+/, "");
    if (name && !DONE.test(t)) return { kind: awaiting, name: name.toUpperCase() };
  }

  const carrier = t.match(/^(?:(?:lo|la|los|las) )?(?:lleva|llevan|traslada|transporta|lo va a llevar|va a llevar|conductor|transportador|mensajero)(?: es)? (.+)$/);
  if (carrier) return { kind: "carrier", name: carrier[1].toUpperCase() };
  const checker = t.match(/^(?:(?:lo|la|los|las) )?(?:reviso|revisa|revisado por|revisada por|revisador|lo reviso|quien reviso es|reviso la mercancia)(?: es)? (.+)$/);
  if (checker) return { kind: "checker", name: checker[1].toUpperCase() };
  const notes = t.match(/^(?:nota|notas|anota|observacion|observaciones)[: ]+(.+)$/);
  if (notes) return { kind: "notes", text: notes[1] };

  if (DONE.test(t)) return { kind: "done" };

  if (awaiting === "choice") {
    if (/^(?:ninguno|ninguna|ningun|ni uno|otro|otra|no es ninguno)$/.test(t)) return { kind: "choice", index: 0 };
    const n = loneNumber(t);
    if (n !== null) return { kind: "choice", index: n };
  }
  if (awaiting === "qty" || awaiting === "confirm") {
    const n = loneNumber(t);
    if (n !== null) return { kind: "number", value: n };
  }

  // Ruta: «de bodega principal a zamora», «sale de la bodega», «para zamora y centro».
  const route = t.match(/^(?:(?:quiero |vamos a |voy a )?(?:hacer |crear |armar )?(?:un )?(?:traslado|trasladar|distribucion|enviar mercancia|mandar mercancia)\s*)?(?:(?:sale )?(?:desde|de) (?:la |el )?(.+?))?\s*(?:(?:\ba\b|para|hacia|hasta|rumbo a|con destino a) (?:la |el )?(.+))?$/);
  if (awaiting === "from") {
    // Respuesta a «¿de dónde sale?»: «bodega principal», «de la bodega a zamora».
    const m = t.replace(/^(?:sale )?(?:de |desde )?(?:la |el )?/, "").match(/^(.+?)(?:\s+(?:a|para|hacia|hasta)\s+(?:la |el )?(.+))?$/);
    if (m) return { kind: "route", from: m[1], to: m[2] ?? null };
  }
  if (awaiting === "to" && !/^(?:de|desde)\b/.test(t)) return { kind: "route", from: null, to: t.replace(/^(?:para|hacia|hasta|a) /, "").replace(/^(?:la|el) /, "") };
  if (route && (route[1] || route[2]) && /^(?:quiero|vamos|voy|hacer|crear|armar|un|traslado|trasladar|distribucion|enviar|mandar|sale|desde|de )/.test(t) && !/^de \d/.test(t)) {
    return { kind: "route", from: route[1]?.trim() || null, to: route[2]?.trim() || null };
  }
  if (/^(?:quiero |vamos a |voy a )?(?:hacer |crear |armar )?(?:un |otro )?(?:traslado|trasladar|distribucion)$/.test(t)) return { kind: "route", from: null, to: null };
  const dest = t.match(/^(?:ahora )?(?:para|hacia|todo para|esto para|lo siguiente para|cambia el destino a) (?:la |el )?(.+)$/);
  if (dest) return { kind: "destination", to: dest[1] };

  // Cambiar cantidad: «cambia la zapatera a cuatro», «la zapatera son cuatro», «ponle cinco a la zapatera», «son cuatro».
  const set1 = t.match(/^(?:cambia|cambiale|corrige|deja|ajusta)\s+(?:la |el |los |las )?(.+?)\s+(?:a|en)\s+(.+)$/);
  const set2 = t.match(/^(?:la |el |los |las )?(.+?)\s+(?:son|van|serian|quedan en|que sean)\s+(.+)$/);
  const set3 = t.match(/^(?:ponle|pon|dejale|cambiale)\s+(.+?)\s+(?:a|al|a la)\s+(?:la |el )?(.+)$/);
  for (const [q, n] of [set1 ? [set1[1], set1[2]] : null, set2 ? [set2[1], set2[2]] : null, set3 ? [set3[2], set3[1]] : null].filter((x): x is string[] => Boolean(x))) {
    const qty = loneNumber(n);
    if (qty !== null) return { kind: "set_qty", query: /^(?:ultim[oa]|eso|ese|esa|este|esta)$/.test(q) ? null : q, qty };
  }
  const setLast = t.match(/^(?:mejor |no )?(?:son|que sean|cambia a|ponle|mejor) (.+)$/);
  if (setLast) { const qty = loneNumber(setLast[1]); if (qty !== null) return { kind: "set_qty", query: null, qty }; }

  const remove = t.match(/^(?:quita|quitale|quitar|borra|borrar|elimina|eliminar|saca|sacar)\s+(?:la |el |los |las |lo de )?(.+)$/);
  if (remove) return { kind: "remove", query: remove[1] };

  // Agregar: «tres de AB-1240», «agrega cinco secadores para zamora», «zapatera negra».
  let rest = t.replace(ADD_VERB, "");
  let to: string | null = null;
  const toMatch = rest.match(/^(.+?)\s+(?:para|hacia) (?:la |el )?(.+)$/);
  if (toMatch) { rest = toMatch[1]; to = toMatch[2]; }
  const words = rest.split(" ");
  const lead = parseNumberAt(words, 0);
  let qty: number | null = null;
  let query = rest;
  // Un número solo («cuatro», «4») es cantidad; «1240» solo es referencia.
  if (lead && lead.used === words.length && !/^\d{4,}$/.test(words[0])) return { kind: "number", value: lead.value };
  if (lead && lead.used < words.length) {
    const after = words.slice(lead.used).join(" ");
    // «1240» solo, o «12 40» (referencia en números): no es cantidad.
    const looksRef = /^\d+$/.test(words[0]) && /^\d/.test(after) && !UNIT_WORDS.test(after + " ");
    if (!looksRef) { qty = lead.value; query = after.replace(UNIT_WORDS, "").replace(UNIT_WORDS, ""); }
  }
  query = query.replace(/^(?:la |el |los |las |un |una |unos |unas )/, "").trim();
  if (!query) return qty !== null ? { kind: "number", value: qty } : { kind: "repeat" };
  return { kind: "add", qty, query, to };
}

/** Cifras dichas en voz alta («3» → «tres» no hace falta: la voz del celular lee cifras). Plural sencillo. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
