/**
 * Actualización masiva de productos por Excel (Data Studio §22-24): qué cambia, antes y después, sin tocar nada.
 * Probado en tests/data/product-update.test.ts.
 *
 * Reglas:
 *  · Solo cuentan las columnas que vienen en el archivo y que el usuario eligió actualizar.
 *  · En actualización NO se rellenan precios: si el archivo solo trae el precio 3, solo cambia el precio 3.
 *  · Celda vacía = conservar el valor actual (por defecto) o dejarlo vacío, si se pide. El nombre y los precios
 *    nunca se borran (un producto sin nombre o con precio vacío no tiene sentido).
 *  · El producto se reconoce por su ID de RemHub; si no viene, por la referencia; si no, por el código de barras
 *    (solo si ese código es de un único producto). Nunca por el nombre.
 */

export type UpdField = "name" | "barcode" | "category" | "description" | "p1" | "p2" | "p3" | "p4" | "p5";
export const UPD_FIELDS: Array<{ key: UpdField; label: string }> = [
  { key: "name", label: "Nombre" },
  { key: "barcode", label: "Código de barras" },
  { key: "category", label: "Categoría" },
  { key: "description", label: "Descripción" },
  { key: "p1", label: "Precio 1" },
  { key: "p2", label: "Precio 2 (por mayor)" },
  { key: "p3", label: "Precio 3 (detal)" },
  { key: "p4", label: "Precio 4" },
  { key: "p5", label: "Precio 5" },
];
const PRICE: Record<string, number> = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 };

export type CurrentProduct = {
  id: string; name: string; sku: string | null; barcode: string | null; category_id: string | null; description: string | null;
  price_1: number | null; price_2: number | null; price_3: number | null; price_4: number | null; price_5: number | null;
};
/** Lo que trae una fila del archivo: solo las columnas presentes (undefined = la columna no está en el archivo). */
export type FileValues = Partial<Record<UpdField, string | number | null>>;
export type Change = { field: UpdField; before: string | number | null; after: string | number | null };

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const clean = String(v).replace(/[^\d,.-]/g, "");
  if (!/\d/.test(clean)) return null;
  const n = Number(/[.,]\d{1,2}$/.test(clean) ? clean.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : clean.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Los cambios de un producto. `catByName`: categorías de la tienda (NOMBRE EN MAYÚSCULA → id); `catName`: id → nombre.
 * Devuelve también los errores de la fila (precio negativo, nombre vacío) para no aplicarla.
 */
export function productChanges(
  cur: CurrentProduct, file: FileValues, opts: { fields: Set<UpdField>; empty: "keep" | "clear"; catName: Map<string, string> },
): { changes: Change[]; errors: string[]; newCategory: string | null } {
  const changes: Change[] = [];
  const errors: string[] = [];
  let newCategory: string | null = null;
  for (const f of UPD_FIELDS.map((x) => x.key)) {
    if (!opts.fields.has(f) || !(f in file) || file[f] === undefined) continue;
    const raw = file[f];
    const blank = norm(raw) === "";
    if (f in PRICE) {
      const before = cur[`price_${PRICE[f]}` as keyof CurrentProduct] as number | null;
      if (blank) continue; // un precio vacío nunca borra
      const after = money(raw);
      if (after === null) { errors.push(`${f.toUpperCase()}: «${norm(raw)}» no es un número`); continue; }
      if (after < 0) { errors.push(`${f.toUpperCase()}: precio negativo`); continue; }
      if (Number(before ?? 0) !== after) changes.push({ field: f, before, after });
      continue;
    }
    if (f === "name") {
      if (blank) continue;
      const after = norm(raw).toUpperCase();
      if (after !== norm(cur.name)) changes.push({ field: f, before: cur.name, after });
      continue;
    }
    if (f === "category") {
      const before = cur.category_id ? opts.catName.get(cur.category_id) ?? null : null;
      if (blank) { if (opts.empty === "clear" && before) changes.push({ field: f, before, after: null }); continue; }
      const after = norm(raw).toUpperCase();
      if (after !== norm(before).toUpperCase()) {
        changes.push({ field: f, before, after });
        if (![...opts.catName.values()].some((n) => n.toUpperCase() === after)) newCategory = after;
      }
      continue;
    }
    const before = f === "barcode" ? cur.barcode : cur.description;
    if (blank) { if (opts.empty === "clear" && norm(before)) changes.push({ field: f, before, after: null }); continue; }
    const after = norm(raw);
    if (after !== norm(before)) changes.push({ field: f, before, after });
  }
  return { changes, errors, newCategory };
}

/**
 * Lo que se manda a la base (products_bulk_update): solo esos campos. La base pone el precio detal y el por mayor
 * viejos (price_retail/price_wholesale) y ajusta el % de ganancia; aquí no se mandan.
 */
export function updatePayload(changes: Change[], catId: (name: string) => string | null): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const c of changes) {
    if (c.field in PRICE) out[`price_${PRICE[c.field]}`] = c.after;
    else if (c.field === "category") out.category_id = c.after === null ? null : catId(String(c.after));
    else if (c.field === "barcode") out.barcode = c.after === null ? null : String(c.after);
    else if (c.field === "description") out.description = c.after === null ? "" : String(c.after);
    else if (c.field === "name") out.name = String(c.after);
  }
  return out;
}

/** Lo que la persona vio antes de cada campo que cambia (tal como está en la base): si al aplicar ya es otro, no se toca. */
export function expectOf(cur: CurrentProduct, changes: Change[]): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const c of changes) {
    if (c.field in PRICE) { const k = `price_${PRICE[c.field]}` as `price_${1 | 2 | 3 | 4 | 5}`; out[k] = cur[k]; }
    else if (c.field === "category") out.category_id = cur.category_id;
    else if (c.field === "barcode") out.barcode = cur.barcode;
    else if (c.field === "description") out.description = cur.description;
    else if (c.field === "name") out.name = cur.name;
  }
  return out;
}

/**
 * Qué producto es cada fila: ID de RemHub → referencia → código de barras (si es de uno solo). Nunca por nombre.
 * Devuelve el id o null, y por qué.
 */
export function matchProduct(
  row: { id?: string; sku?: string; barcode?: string },
  idx: { byId: Map<string, string>; bySku: Map<string, string>; byBarcode: Map<string, string[]> },
): { id: string | null; by: "id" | "referencia" | "codigo" | null; problem?: string } {
  const id = norm(row.id).toLowerCase();
  if (id) {
    const hit = idx.byId.get(id);
    return hit ? { id: hit, by: "id" } : { id: null, by: null, problem: "El ID de RemHub no es de un producto de esta tienda" };
  }
  const sku = norm(row.sku).toUpperCase();
  if (sku && idx.bySku.has(sku)) return { id: idx.bySku.get(sku)!, by: "referencia" };
  const bc = norm(row.barcode);
  if (bc) {
    const hits = idx.byBarcode.get(bc) ?? [];
    if (hits.length === 1) return { id: hits[0], by: "codigo" };
    if (hits.length > 1) return { id: null, by: null, problem: `El código de barras ${bc} es de ${hits.length} productos: agrega la referencia o el ID` };
  }
  return { id: null, by: null };
}
