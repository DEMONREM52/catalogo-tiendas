/**
 * Búsqueda «por parecido» del buscador Ctrl+K: sin tildes, tolera errores de escritura, singular/plural,
 * sinónimos y frases como «crear factura» o «ir a vales». Puntúa cada resultado y ordena por cuánto se parece.
 */

export const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Palabras que no aportan al buscar. */
const STOP = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "en", "mi", "mis", "a", "al", "y", "o", "por", "con", "que", "ir", "ver", "abrir", "quiero", "donde", "esta", "estan", "me", "lo", "le", "se", "como", "hay"]);
/** Verbos de crear: el resultado debe ser una acción. */
const CREATE = new Set(["crear", "crea", "nuevo", "nueva", "nuevos", "nuevas", "agregar", "agrega", "anadir", "registrar", "registra", "hacer", "haz", "generar", "ingresar", "subir", "cargar", "montar", "add", "new"]);

/** Sinónimos: cada palabra buscada se amplía con estas (todo sin tildes). */
const SYN: Record<string, string[]> = {
  vale: ["prestamo", "adelanto", "anticipo empleado"], prestamo: ["vale", "adelanto"], adelanto: ["vale", "prestamo", "anticipo"],
  factura: ["compra", "ingreso", "remision", "venta", "electronica"], compra: ["factura", "ingreso", "proveedor"], ingreso: ["factura", "compra"],
  venta: ["pos", "vender", "factura", "remision"], vender: ["pos", "venta"], pos: ["venta", "vender", "caja"], caja: ["pos", "cierre", "efectivo", "arqueo"],
  producto: ["articulo", "item", "referencia", "mercancia"], articulo: ["producto"], mercancia: ["producto", "inventario", "existencias"],
  precio: ["precios", "lista", "regla", "tarifa", "margen", "limite"], margen: ["ganancia", "precio", "rentabilidad"],
  liquidacion: ["liquidar", "reparto", "repartos", "pozo", "corte"], liquidar: ["liquidacion", "reparto"], reparto: ["liquidacion", "repartos", "pozo"],
  ganancia: ["rentabilidad", "utilidad", "margen"], utilidad: ["ganancia", "rentabilidad"],
  gasto: ["egreso", "pago", "salida"], egreso: ["gasto"], nomina: ["sueldo", "salario", "empleados", "pago empleados"], sueldo: ["nomina", "salario"], salario: ["nomina", "sueldo"],
  empleado: ["trabajador", "nomina", "personal", "equipo"], trabajador: ["empleado"],
  traslado: ["envio", "enviar", "trasladar", "transferencia", "mover"], enviar: ["traslado"], pedido: ["pedidos", "orden", "solicitud"],
  cliente: ["clientes", "tercero", "comprador"], proveedor: ["proveedores", "tercero"], deuda: ["cartera", "credito", "debe", "cuenta"],
  cartera: ["deuda", "credito", "cobrar"], cobrar: ["cartera", "credito"], pagar: ["cuentas por pagar", "pago", "abono"], abono: ["pago", "abonar"],
  inventario: ["existencias", "stock", "bodega"], stock: ["inventario", "existencias"], bodega: ["inventario", "punto", "almacen"],
  punto: ["sede", "tienda", "sucursal"], sede: ["punto", "sucursal"], sucursal: ["punto", "sede"],
  usuario: ["usuarios", "permisos", "equipo", "rol"], permiso: ["usuarios", "rol"], informe: ["reporte", "reportes", "informes", "estadisticas"],
  reporte: ["informe"], catalogo: ["catalogos", "tienda en linea", "pagina"], promocion: ["promo", "combo", "descuento", "oferta"], descuento: ["promocion"],
  garantia: ["devolucion", "cambio"], devolucion: ["garantia", "cambio"], ajuste: ["ajustes", "corregir inventario"], kardex: ["movimientos"],
  presupuesto: ["tope", "limite gasto"], reserva: ["ahorro", "fondo"], anticipo: ["adelanto", "vale"], firma: ["firmar", "firmas"],
  mensaje: ["chat", "mensajes", "llamada"], chat: ["mensaje"], contador: ["contabilidad", "puc", "asientos"], electronica: ["dian", "factura electronica"],
  categoria: ["categorias", "grupo"], etiqueta: ["etiquetas", "rotulo", "codigo de barras"], cotizacion: ["apartado", "presupuesto cliente"], apartado: ["cotizacion", "separado"],
  auditoria: ["historial", "quien hizo", "cambios"], seguridad: ["copia", "respaldo", "backup"], plan: ["suscripcion", "pago remhub"],
};

/** Distancia de edición con trasposición (Damerau), cortando si pasa de max. */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Quita plurales y terminaciones comunes para comparar raíces («vales» → «vale», «liquidaciones» → «liquidacion»). */
const stem = (w: string) => w.replace(/(ciones)$/, "cion").replace(/(es)$/, (m) => (w.length > 4 ? "" : m)).replace(/s$/, (m) => (w.length > 3 ? "" : m));

/** Qué tan bien se parece una palabra buscada a una palabra del resultado (0 = nada). */
function wordScore(q: string, w: string): number {
  if (!q || !w) return 0;
  if (w === q) return 10;
  if (stem(w) === stem(q)) return 9.5;
  if (w.startsWith(q)) return q.length >= 3 ? 8 : 5;
  if (q.length >= 4 && w.includes(q)) return 5.5;
  if (q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    const target = w.length > q.length + max ? w.slice(0, q.length + max) : w;
    const dist = Math.min(editDistance(q, w, max), editDistance(q, target, max), editDistance(stem(q), stem(w), max));
    if (dist <= max) return dist === 1 ? 6 : 4.5;
  }
  return 0;
}

export type Searchable = { label: string; hint?: string; keywords?: string; action?: boolean };

export function parseQuery(q: string) {
  const all = fold(q).replace(/[^\p{L}\p{N}#\s]/gu, " ").split(/\s+/).filter(Boolean);
  const create = all.some((w) => CREATE.has(w));
  const words = all.filter((w) => !STOP.has(w) && !CREATE.has(w));
  return { words, create, raw: fold(q.trim()) };
}

/** Puntaje de un resultado para una búsqueda (0 = no aparece). */
export function scoreItem(item: Searchable, query: ReturnType<typeof parseQuery>, boost = 0): number {
  const { words, create, raw } = query;
  const label = fold(item.label);
  if (!words.length) return create && item.action ? 5 + boost : 0;
  const fields: Array<[string[], number]> = [
    [label.split(/[^\p{L}\p{N}]+/u).filter(Boolean), 1.4],
    [fold(item.keywords ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean), 1.1],
    [fold(item.hint ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean), 0.7],
  ];
  let total = 0, missed = 0, strong = 0;
  for (const q of words) {
    let best = 0;
    for (const [list, weight] of fields) for (const w of list) best = Math.max(best, wordScore(q, w) * weight);
    // Sinónimos (valen un poco menos que la palabra misma).
    if (best < 8) {
      for (const s of SYN[q] ?? SYN[stem(q)] ?? []) for (const sw of s.split(" ")) for (const [list, weight] of fields) for (const w of list) best = Math.max(best, wordScore(sw, w) * weight * 0.8);
    }
    if (best === 0) missed++;
    if (best >= 8) strong++;
    total += best;
  }
  // Todas las palabras deben coincidir. Se perdona una que no esté (p. ej. el nombre de un punto: «precios zamora»)
  // si otra coincide muy bien; con 3 o más palabras siempre se perdona una.
  if (missed > 0 && !(missed === 1 && (words.length >= 3 || strong >= 1))) return 0;
  let score = total / words.length - missed * 2;
  if (label.startsWith(raw)) score += 4;
  else if (label.includes(raw) && raw.length >= 3) score += 2;
  if (create) score += item.action ? 5 : -3;
  return Math.max(0, score + boost);
}
