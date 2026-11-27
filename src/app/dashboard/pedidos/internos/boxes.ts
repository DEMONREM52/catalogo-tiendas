/**
 * Cajas de un pedido interno (20261348): tipos y cuentas puras (probadas en tests/pedidos/boxes.test.ts).
 * Las cajas no mueven inventario: dicen en qué caja va cada unidad de lo que se envía.
 */

export type SrBox = {
  id: string; number: number; name: string | null; color: string | null; notes: string | null; fragile: boolean;
  weight_kg: number | null; dims: string | null; seal: string | null; status: "open" | "closed"; token: string;
  created_by_name: string | null; created_at: string; updated_at: string; closed_at: string | null; closed_by_name: string | null;
  /** Quien recibe la marcó «Llegó esta caja» (20261349). */
  received_at?: string | null; received_by_name?: string | null;
  items: Array<{ item_id: string; qty: number }>;
};
/** can_receive: quien recibe puede marcar cajas que llegaron. origin «transfer»: el pedido nació de un traslado de Inventario. */
export type SrBoxes = { boxes: SrBox[]; can_edit: boolean; can_receive?: boolean; origin?: "request" | "transfer" };

/** Colores automáticos (contraste con texto blanco en claro y oscuro). Siempre van con el número: nunca solo el color. */
export const BOX_COLORS = ["#7c3aed", "#0ea5e9", "#16a34a", "#ea580c", "#db2777", "#0d9488", "#ca8a04", "#4f46e5", "#dc2626", "#475569"] as const;
export const boxColor = (b: Pick<SrBox, "number" | "color">) => b.color ?? BOX_COLORS[(Math.max(1, b.number) - 1) % BOX_COLORS.length];
export const boxTitle = (b: Pick<SrBox, "number" | "name">) => `Caja ${b.number}${b.name ? ` · ${b.name}` : ""}`;

export type BoxLine = { id: string; toSend: number };
export type Distribution = {
  /** Unidades de cada producto en cada caja: item → [{box, qty}] en orden de caja. */
  perItem: Map<string, Array<{ box: SrBox; qty: number }>>;
  /** Cuántas unidades de cada producto ya están en alguna caja. */
  boxed: Map<string, number>;
  /** Lo que falta por meter en caja de cada producto (nunca negativo). */
  unboxed: Map<string, number>;
  /** Productos con más en cajas que lo que se envía (bajaron la cantidad después de empacar). */
  over: Array<{ id: string; boxed: number; toSend: number }>;
  totals: { refsUnboxed: number; unitsUnboxed: number; unitsBoxed: number; unitsToSend: number; boxes: number; open: number };
};

export function distribution(lines: BoxLine[], boxes: SrBox[]): Distribution {
  const perItem = new Map<string, Array<{ box: SrBox; qty: number }>>();
  const boxed = new Map<string, number>();
  for (const b of [...boxes].sort((a, c) => a.number - c.number)) {
    for (const x of b.items) {
      perItem.set(x.item_id, [...(perItem.get(x.item_id) ?? []), { box: b, qty: x.qty }]);
      boxed.set(x.item_id, (boxed.get(x.item_id) ?? 0) + x.qty);
    }
  }
  const unboxed = new Map<string, number>();
  const over: Distribution["over"] = [];
  let refsUnboxed = 0, unitsUnboxed = 0, unitsBoxed = 0, unitsToSend = 0;
  for (const l of lines) {
    const inB = boxed.get(l.id) ?? 0;
    const left = Math.max(0, l.toSend - inB);
    unboxed.set(l.id, left);
    if (left > 0) { refsUnboxed++; unitsUnboxed += left; }
    if (inB > l.toSend) over.push({ id: l.id, boxed: inB, toSend: l.toSend });
    unitsBoxed += inB;
    unitsToSend += l.toSend;
  }
  return { perItem, boxed, unboxed, over, totals: { refsUnboxed, unitsUnboxed, unitsBoxed, unitsToSend, boxes: boxes.length, open: boxes.filter((b) => b.status === "open").length } };
}

export const boxUnits = (b: SrBox) => b.items.reduce((s, x) => s + x.qty, 0);

/** «C1·30 · C2·40 · 10 sin caja»: dónde está cada unidad de un producto. */
export function distributionText(parts: Array<{ box: Pick<SrBox, "number">; qty: number }>, unboxed: number): string {
  const p = parts.map((x) => `C${x.box.number}·${x.qty}`);
  if (unboxed > 0) p.push(`${unboxed} sin caja`);
  return p.join(" · ");
}

/** Selección para guardar en caja: nunca más de lo que queda sin caja, ni menos de 1. Quita lo que ya no aplica. */
export function clampSelection(sel: Record<string, number>, unboxed: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, q] of Object.entries(sel)) {
    const max = unboxed.get(id) ?? 0;
    if (max <= 0) continue;
    out[id] = Math.min(max, Math.max(1, Math.floor(q) || 1));
  }
  return out;
}
