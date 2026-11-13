/**
 * REM en Productos: qué se pidió («búscame en los productos la cámara sc30a», «inactívalo», «abre el dos»…).
 * Solo entiende frases; lo que hace con ellas está en src/app/dashboard/products/useProductsVoice.ts.
 */

import { isYes, normalize } from "./spanish";

export type ProductsCommand =
  | { kind: "search"; query: string }
  | { kind: "read" }
  | { kind: "open"; index: number | null; name: string | null }
  | { kind: "toggle"; active: boolean; index: number | null; name: string | null }
  | { kind: "filter"; status?: "all" | "active" | "inactive"; stock?: "all" | "in" | "out" }
  | { kind: "sort"; by: "newest" | "oldest" | "name" | "price" | "price-desc" | "stock" }
  | { kind: "clear" }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "pick"; index: number }
  | { kind: "unknown" };

const LEAD = "(?:(?:yo )?(?:quiero|necesito|quisiera)(?: que)?(?: me)? |(?:me )?(?:puedes|podrias)(?: me)? |por favor |ahora |y |tambien |otra vez )*";
const SEARCH_VERB = "(?:buscame|buscalo|buscala|busques|busca|buscar|buscas|encuentrame|encuentra|encuentres|encontrar)";
const SEARCH_RE = new RegExp(`^${LEAD}${SEARCH_VERB}(?:\\s+(.*))?$`);
const PLACE = /\b(?:en|dentro de|entre) (?:los |el |la |las |mis |todos los )?(?:productos?|catalogos?|inventario|lista de productos|referencias)\b/g;

/** «la cámara sc30a por favor» → «camara sc30a». */
function cleanQuery(q: string): string {
  return q
    .replace(PLACE, " ")
    .replace(/\b(?:por favor|porfa|ahora mismo|rapido)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a |al )?(?:(?:el|la|los|las|un|una|unos|unas|mi|mis) )?(?:(?:producto|productos|referencia|codigo|articulo)s? )?(?:(?:de|del|que se llama|llamado|llamada) )?/, "")
    .replace(/^(?:el|la|los|las|un|una) /, "")
    .trim();
}

/**
 * ¿Pide buscar productos? Devuelve qué buscar ("" si no dijo qué: «busca en productos»). null si no es una búsqueda.
 * «Busca el cliente Juan» no es de productos (null).
 */
export function searchRequest(text: string): string | null {
  const t = normalize(text);
  const m = t.match(SEARCH_RE);
  if (!m) {
    // «En productos busca la cámara»
    const inv = t.match(new RegExp(`^(?:en (?:los )?productos?) ${LEAD}${SEARCH_VERB}(?:\\s+(.*))?$`));
    return inv ? cleanQuery(inv[1] ?? "") : null;
  }
  const rest = m[1] ?? "";
  if (/\b(?:cliente|clientes|proveedor|proveedores|empleado|empleados|usuario|usuarios|factura|facturas)\b/.test(rest)) return null;
  return cleanQuery(rest);
}

const NUM: Record<string, number> = {
  uno: 1, una: 1, primero: 1, primera: 1, primer: 1, dos: 2, segundo: 2, segunda: 2, tres: 3, tercero: 3, tercera: 3, tercer: 3,
  cuatro: 4, cuarto: 4, cuarta: 4, cinco: 5, quinto: 5, quinta: 5, seis: 6, sexto: 6, sexta: 6, ultimo: -1, ultima: -1,
};

/** «el primero», «la dos», «el 3», «el último» → 1, 2, 3, -1. null si no dijo cuál. */
export function whichOne(rest: string): number | null {
  const t = normalize(rest).replace(/^(?:el|la|lo|los|las|al|a la|del|de la|numero|opcion)\s+/g, "").replace(/^(?:numero|opcion)\s+/, "");
  const first = t.split(" ")[0] ?? "";
  if (/^\d{1,2}$/.test(first)) return Number(first);
  return NUM[first] ?? null;
}

/** Lo que queda después del verbo: «inactiva la cámara solar» → número o nombre. */
function target(rest: string): { index: number | null; name: string | null } {
  const r = normalize(rest).replace(/^(?:el|la|lo|los|las|ese|esa|este|esta|producto)\s+/, "").trim();
  if (!r || /^(?:producto|ese|esa|este|esta|eso|esto)$/.test(r)) return { index: null, name: null };
  const index = whichOne(r);
  return index !== null ? { index, name: null } : { index: null, name: r };
}

export function parseProductsCommand(text: string, awaiting: "query" | "confirm" | "pick" | null = null): ProductsCommand {
  const t = normalize(text);
  if (!t) return { kind: "unknown" };
  if (awaiting === "confirm" || awaiting === "pick") {
    if (isYes(t)) return { kind: "yes" };
    if (/^(?:no|nop|negativo|todavia no|mejor no|no gracias|cancela|ninguno|ninguna)$/.test(t)) return { kind: "no" };
  }
  if (awaiting === "pick") { const n = whichOne(t); if (n !== null) return { kind: "pick", index: n }; }
  if (/^(?:listo|gracias|eso es todo|nada mas|nada|chao|adios|ya|ya esta|termina|terminar|salir|para|parar|detente)$/.test(t)) return { kind: "stop" };
  if (/^(?:ayuda|que puedes hacer|que puedo decir|que mas puedes hacer|que haces)$/.test(t)) return { kind: "help" };

  const search = searchRequest(t);
  if (search !== null) return { kind: "search", query: search };

  if (/^(?:limpia(?:r)?(?: la busqueda| los filtros| todo)?|borra(?:r)? la busqueda|quita(?:r)? (?:la busqueda|los filtros)|todos los productos|muestrame todos|ver todos|empieza de nuevo)$/.test(t)) return { kind: "clear" };
  if (/^(?:leemelos|leelos|leemelo|lee(?:me)?(?: los)? resultados|cuales (?:son|hay|encontraste|salieron)|que (?:encontraste|hay|salio|salieron)|dime cuales(?: son)?|cuantos (?:hay|son|encontraste|salieron)|que productos (?:hay|salieron))$/.test(t)) return { kind: "read" };

  // Inactivar va antes que activar («inactiva» contiene «activa»).
  const off = t.match(/^(?:(?:por favor|ahora|y) )?(?:inactiva|inactivalo|inactivala|inactivar|desactiva|desactivalo|desactivala|desactivar|oculta|ocultalo|ocultala|ocultar|apaga|apagalo|apagala|quita de la venta|ya no hay(?: de)?)\b\s*(.*)$/);
  if (off) return { kind: "toggle", active: false, ...target(off[1] ?? "") };
  const on = t.match(/^(?:(?:por favor|ahora|y) )?(?:activa|activalo|activala|activar|reactiva|reactivalo|reactivala|prende|prendelo|prendela|vuelve a vender)\b\s*(.*)$/);
  if (on) return { kind: "toggle", active: true, ...target(on[1] ?? "") };

  const open = t.match(/^(?:(?:por favor|ahora|y) )?(?:abre|abrelo|abrela|abrir|edita|editalo|editala|editar|entra a|entra al|entra en|muestramelo|muestramela|ver|ve a)\b\s*(.*)$/);
  if (open) return { kind: "open", ...target(open[1] ?? "") };

  if (/\b(?:solo|solamente|nada mas|muestrame)\b.*\bagotados?\b|\bsin existencias\b|\bque no hay\b/.test(t)) return { kind: "filter", stock: "out" };
  if (/\b(?:solo|solamente|muestrame)\b.*\b(?:con existencias|que hay|disponibles)\b|^con existencias$/.test(t)) return { kind: "filter", stock: "in" };
  if (/\b(?:solo|solamente|muestrame)\b.*\binactivos?\b|^(?:los )?inactivos$/.test(t)) return { kind: "filter", status: "inactive" };
  if (/\b(?:solo|solamente|muestrame)\b.*\bactivos?\b|^(?:los )?activos$/.test(t)) return { kind: "filter", status: "active" };
  if (/^(?:todos|todos los estados|quita el filtro)$/.test(t)) return { kind: "filter", status: "all", stock: "all" };

  const sort = t.match(/\b(?:ordena|ordenalos|ordenar|organiza|organizalos)\b.*\bpor\s+(.+)$/);
  const by = sort?.[1] ?? (/\b(?:mas caros?|primero los caros)\b/.test(t) ? "mas caro" : /\b(?:mas baratos?|primero los baratos)\b/.test(t) ? "precio" : null);
  if (by) {
    if (/caro|mayor precio/.test(by)) return { kind: "sort", by: "price-desc" };
    if (/precio|barato/.test(by)) return { kind: "sort", by: "price" };
    if (/nombre|alfabet/.test(by)) return { kind: "sort", by: "name" };
    if (/existencia|stock|cantidad|unidades/.test(by)) return { kind: "sort", by: "stock" };
    if (/viejo|antiguo/.test(by)) return { kind: "sort", by: "oldest" };
    if (/nuevo|reciente/.test(by)) return { kind: "sort", by: "newest" };
  }
  if (awaiting === "query") return { kind: "search", query: cleanQuery(t) };
  return { kind: "unknown" };
}
