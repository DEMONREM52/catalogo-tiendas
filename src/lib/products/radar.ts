/**
 * Radar de productos: qué le falta a cada producto, qué tan «sana» está su ficha y si ya toca publicarlo.
 * Todo puro (sin React ni Supabase) para poder probarlo.
 */

export type PublishState = {
  every_days: number | null;
  /** Cada cuánto en días (null en la base = 30). 0 = no recordar. */
  every: number;
  last: string | null;
  by: string | null;
  times: number;
  /** AAAA-MM-DD (hora Colombia) en que vuelve a tocar, o null si no se recuerda. */
  next_due: string | null;
};

export type RadarProduct = {
  id: string;
  name: string;
  image: string | null;
  active: boolean;
  code: string | null;
  barcode: string | null;
  created_at: string;
  prices: number[];
  cost: number | null;
  category_id: string | null;
  cats: number;
  desc: boolean;
  long: boolean;
  gallery: number;
  video: boolean;
  highlights: number;
  specs: number;
  stock: number | null;
  stock_points: number;
  last_sale_at: string | null;
  sold_30: number;
  sold_90: number;
  /** Por punto: unidades y vendidos en 30 días (20261306). */
  by_point?: Array<{ id: string; qty: number; sold_30: number }>;
  pub: PublishState;
};

export type IssueLevel = "critical" | "warning" | "tip";
/** Sección del editor donde se arregla (abre el producto ahí). */
export type EditorSectionKey = "basic" | "prices" | "stock" | "media" | "desc" | "features" | "catalogs" | "publish";

export type IssueKey =
  | "no_photo" | "no_price" | "below_cost" | "no_cost" | "no_category" | "duplicate_name"
  | "out_of_stock" | "hidden_with_stock" | "no_sales" | "publish_due" | "never_published"
  | "no_short_desc" | "no_long_desc" | "one_photo" | "no_features" | "no_barcode"
  | "photo_bad" | "photo_repeated" | "low_margin" | "long_name";

export type IssueDef = { key: IssueKey; label: string; short: string; emoji: string; level: IssueLevel; weight: number; section: EditorSectionKey; help: string };

export const ISSUES: Record<IssueKey, IssueDef> = {
  no_photo: { key: "no_photo", label: "Sin foto", short: "Foto", emoji: "📷", level: "critical", weight: 20, section: "basic", help: "Sin foto casi nadie compra. Sube al menos una." },
  no_price: { key: "no_price", label: "Sin precio", short: "Precio", emoji: "💲", level: "critical", weight: 20, section: "prices", help: "No tiene ningún precio: no se puede vender." },
  below_cost: { key: "below_cost", label: "Precio bajo el costo", short: "Pierde", emoji: "📉", level: "critical", weight: 15, section: "prices", help: "Algún precio está por debajo de lo que cuesta: se vende perdiendo." },
  no_cost: { key: "no_cost", label: "Sin costo", short: "Costo", emoji: "🧾", level: "warning", weight: 8, section: "stock", help: "No tiene costo: entra con un ingreso de factura. Sin él no se sabe cuánto deja." },
  photo_bad: { key: "photo_bad", label: "Foto rota o muy pequeña", short: "Foto mala", emoji: "🧩", level: "warning", weight: 10, section: "basic", help: "La foto no abre o es muy pequeña (menos de 300 px): se ve borrosa en el catálogo." },
  photo_repeated: { key: "photo_repeated", label: "Misma foto que otro", short: "Foto repetida", emoji: "🪞", level: "warning", weight: 6, section: "basic", help: "Otro producto usa exactamente la misma foto: el cliente no los distingue." },
  low_margin: { key: "low_margin", label: "Gana menos del 10 %", short: "Margen bajo", emoji: "🪙", level: "warning", weight: 6, section: "prices", help: "Algún precio deja menos del 10 % sobre el costo." },
  no_category: { key: "no_category", label: "Sin categoría", short: "Categoría", emoji: "🗂️", level: "warning", weight: 10, section: "basic", help: "No aparece en ninguna sección del catálogo." },
  duplicate_name: { key: "duplicate_name", label: "Nombre repetido", short: "Repetido", emoji: "👯", level: "warning", weight: 8, section: "basic", help: "Hay otro producto con el mismo nombre: confunde al vender." },
  out_of_stock: { key: "out_of_stock", label: "Agotado", short: "Agotado", emoji: "📦", level: "warning", weight: 10, section: "stock", help: "Está activo pero no hay unidades en ningún punto." },
  hidden_with_stock: { key: "hidden_with_stock", label: "Oculto con unidades", short: "Oculto", emoji: "🙈", level: "warning", weight: 8, section: "basic", help: "Tiene unidades pero está inactivo: nadie lo ve ni lo compra." },
  no_sales: { key: "no_sales", label: "Quieto: sin ventas en 60 días", short: "Quieto", emoji: "💤", level: "warning", weight: 10, section: "publish", help: "Tiene unidades y no se vende hace más de 60 días. Publícalo, muévelo o ponle promoción." },
  publish_due: { key: "publish_due", label: "Toca publicarlo", short: "Publicar", emoji: "📣", level: "warning", weight: 10, section: "publish", help: "Ya pasó el tiempo de su recordatorio." },
  never_published: { key: "never_published", label: "Nunca publicado", short: "Sin publicar", emoji: "🕳️", level: "tip", weight: 4, section: "publish", help: "Nunca se ha marcado como publicado en redes." },
  no_short_desc: { key: "no_short_desc", label: "Sin descripción corta", short: "Descripción", emoji: "💬", level: "tip", weight: 5, section: "basic", help: "Una o dos frases debajo del nombre ayudan a vender." },
  no_long_desc: { key: "no_long_desc", label: "Sin descripción completa", short: "Ficha", emoji: "📝", level: "tip", weight: 4, section: "desc", help: "Para qué sirve, cómo se usa y por qué vale la pena." },
  one_photo: { key: "one_photo", label: "Una sola foto", short: "Más fotos", emoji: "🖼️", level: "tip", weight: 4, section: "media", help: "Más fotos (y un video) dan confianza." },
  no_features: { key: "no_features", label: "Sin características", short: "Detalles", emoji: "✨", level: "tip", weight: 3, section: "features", help: "Color, talla, material, lo que lo hace especial." },
  long_name: { key: "long_name", label: "Nombre muy largo", short: "Nombre largo", emoji: "📏", level: "tip", weight: 2, section: "basic", help: "Más de 90 letras: se corta en el catálogo y en el POS." },
  no_barcode: { key: "no_barcode", label: "Sin código de barras", short: "Barras", emoji: "📊", level: "tip", weight: 2, section: "basic", help: "Con código de barras se vende más rápido en el POS." },
};

export const ISSUE_ORDER = Object.keys(ISSUES) as IssueKey[];
export const LEVEL_ORDER: Record<IssueLevel, number> = { critical: 0, warning: 1, tip: 2 };
export const LEVEL_COLOR: Record<IssueLevel, string> = { critical: "#e5484d", warning: "#d97706", tip: "#7c3aed" };

const DAY = 86_400_000;

/** Fecha AAAA-MM-DD de hoy en Colombia. */
export function bogotaToday(now = new Date()): string {
  return new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export function isPublishDue(pub: PublishState, today: string): boolean {
  return Boolean(pub.next_due && pub.next_due <= today);
}

/** Nombre normalizado para encontrar repetidos. */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function duplicateNames(products: Pick<RadarProduct, "name">[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of products) { const k = nameKey(p.name); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/** Fotos que usan varios productos. */
export function duplicateImages(products: Pick<RadarProduct, "image">[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of products) if (p.image) seen.set(p.image, (seen.get(p.image) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

export type PhotoCheck = "small" | "broken";
export type RadarContext = {
  today: string; now: number; canCosts: boolean; duplicates: Set<string>;
  duplicateImages?: Set<string>;
  /** Fotos revisadas en el navegador (rotas o pequeñas). */
  photoChecks?: Map<string, PhotoCheck>;
};

/** Lo que le falta a un producto, de lo más grave a lo menos. */
export function productIssues(p: RadarProduct, ctx: RadarContext): IssueDef[] {
  const out: IssueKey[] = [];
  const prices = p.prices.map(Number).filter((x) => Number.isFinite(x));
  const priced = prices.filter((x) => x > 0);
  const stock = p.stock === null ? null : Number(p.stock);
  const ageDays = (ctx.now - Date.parse(p.created_at)) / DAY;

  if (!p.image) out.push("no_photo");
  else if (ctx.photoChecks?.has(p.image)) out.push("photo_bad");
  if (p.image && ctx.duplicateImages?.has(p.image)) out.push("photo_repeated");
  if (!priced.length) out.push("no_price");
  if (ctx.canCosts && p.cost !== null) {
    if (Number(p.cost) > 0 && priced.some((x) => x < Number(p.cost))) out.push("below_cost");
    if (!(Number(p.cost) > 0)) out.push("no_cost");
    else if (!out.includes("below_cost") && priced.some((x) => x < Number(p.cost) * 1.1)) out.push("low_margin");
  }
  if (!p.cats) out.push("no_category");
  if (ctx.duplicates.has(nameKey(p.name))) out.push("duplicate_name");
  if (p.name.trim().length > 90) out.push("long_name");
  if (p.active && stock !== null && stock <= 0) out.push("out_of_stock");
  if (!p.active && stock !== null && stock > 0) out.push("hidden_with_stock");
  if (p.active && stock !== null && stock > 0 && ageDays > 30) {
    const last = p.last_sale_at ? Date.parse(p.last_sale_at) : null;
    if (last === null || ctx.now - last > 60 * DAY) out.push("no_sales");
  }
  if (p.active) {
    if (isPublishDue(p.pub, ctx.today)) out.push("publish_due");
    else if (!p.pub.last) out.push("never_published");
  }
  if (!p.desc) out.push("no_short_desc");
  if (!p.long) out.push("no_long_desc");
  if (p.image && p.gallery === 0 && !p.video) out.push("one_photo");
  if (!p.highlights && !p.specs) out.push("no_features");
  if (!p.barcode) out.push("no_barcode");

  return out.map((k) => ISSUES[k]).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.weight - a.weight);
}

/** Salud de 0 a 100: 100 menos el peso de cada falencia. */
export function healthScore(issues: IssueDef[]): number {
  return Math.max(0, 100 - issues.reduce((s, i) => s + i.weight, 0));
}

export function healthColor(score: number): string {
  return score >= 85 ? "#10b981" : score >= 65 ? "#84cc16" : score >= 45 ? "#d97706" : "#e5484d";
}

export function healthLabel(score: number): string {
  return score >= 85 ? "Excelente" : score >= 65 ? "Bien" : score >= 45 ? "Le falta" : "Urgente";
}

/** Opciones de recordatorio. */
export const EVERY_OPTIONS: Array<{ days: number; label: string; short: string }> = [
  { days: 1, label: "Todos los días", short: "Diario" },
  { days: 2, label: "Cada 2 días", short: "2 días" },
  { days: 3, label: "Cada 3 días", short: "3 días" },
  { days: 7, label: "Cada semana", short: "Semanal" },
  { days: 15, label: "Cada 15 días", short: "Quincenal" },
  { days: 30, label: "Cada mes", short: "Mensual" },
  { days: 0, label: "No recordarme", short: "Nunca" },
];

export function everyLabel(every: number): string {
  if (every <= 0) return "Sin recordatorio";
  const known = EVERY_OPTIONS.find((o) => o.days === every);
  return known ? known.label : `Cada ${every} días`;
}

/** DD/MM/AAAA de un timestamp o de una fecha AAAA-MM-DD. */
export function ddmmyyyy(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const [y, m, d] = value.split("-"); return `${d}/${m}/${y}`; }
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bogota" }).format(new Date(t));
}

/** «hoy», «ayer», «hace 5 días», «hace 2 meses». */
export function agoDays(days: number | null): string {
  if (days === null) return "nunca";
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 45) return `hace ${days} días`;
  const months = Math.round(days / 30);
  return months < 12 ? `hace ${months} meses` : `hace ${Math.round(days / 365)} año${Math.round(days / 365) === 1 ? "" : "s"}`;
}

/** Días desde un timestamp hasta hoy (en fechas de Colombia). */
export function daysSince(ts: string | null, today: string): number | null {
  if (!ts) return null;
  const d = bogotaToday(new Date(ts));
  return daysBetween(d, today);
}

/** Texto del estado de publicación: «Toca hoy», «Atrasado 3 días», «En 4 días», «Sin recordatorio». */
export function publishStatusText(pub: PublishState, today: string): { text: string; tone: "due" | "late" | "ok" | "off" | "never" } {
  if (!pub.next_due) return pub.last ? { text: "Sin recordatorio", tone: "off" } : { text: "Nunca publicado", tone: "never" };
  const diff = daysBetween(today, pub.next_due);
  if (diff < 0) return { text: `Atrasado ${-diff} día${diff === -1 ? "" : "s"}`, tone: "late" };
  if (diff === 0) return { text: "¡Toca hoy!", tone: "due" };
  if (diff === 1) return { text: "Toca mañana", tone: "ok" };
  return { text: `En ${diff} días`, tone: "ok" };
}

export const CHANNELS: Array<{ key: string; label: string; emoji: string }> = [
  { key: "instagram", label: "Instagram", emoji: "📸" },
  { key: "facebook", label: "Facebook", emoji: "📘" },
  { key: "whatsapp", label: "Estados de WhatsApp", emoji: "💬" },
  { key: "whatsapp_grupo", label: "Grupo de WhatsApp", emoji: "👥" },
  { key: "whatsapp_difusion", label: "Difusión de WhatsApp", emoji: "📢" },
  { key: "tiktok", label: "TikTok", emoji: "🎵" },
  { key: "marketplace", label: "Marketplace", emoji: "🛒" },
  { key: "otro", label: "Otro", emoji: "✨" },
];

/** Valor de lo que hay (al costo si se puede ver; si no, al precio). */
export function stockValue(p: RadarProduct, canCosts: boolean): { value: number; basis: "cost" | "price" } {
  const qty = Math.max(0, Number(p.stock ?? 0));
  const cost = canCosts && p.cost !== null && Number(p.cost) > 0 ? Number(p.cost) : 0;
  if (cost) return { value: qty * cost, basis: "cost" };
  const price = p.prices.map(Number).find((x) => x > 0) ?? 0;
  return { value: qty * price, basis: "price" };
}

/** Punto donde sí se vende (para sugerir un traslado). null si no hay. */
export function transferHint(p: RadarProduct, currentPoint: string | null): { pointId: string; sold: number; from: string | null; fromQty: number } | null {
  const rows = p.by_point ?? [];
  const from = currentPoint ? rows.find((r) => r.id === currentPoint) ?? null : [...rows].sort((a, b) => b.qty - a.qty)[0] ?? null;
  if (!from || from.qty <= 0 || from.sold_30 > 0) return null;
  const best = rows.filter((r) => r.id !== from.id && r.sold_30 > 0).sort((a, b) => b.sold_30 - a.sold_30)[0];
  return best ? { pointId: best.id, sold: best.sold_30, from: from.id, fromQty: from.qty } : null;
}

/**
 * Plan del día: hasta `target` productos para publicar hoy. Primero los que toca (los más atrasados), luego los quietos
 * con más unidades y los que nunca se han publicado. Los que ya se publicaron hoy cuentan como hechos.
 *
 * `skip`: sugerencias que se pidió cambiar («Ver otros»). Los que toca por recordatorio nunca se saltan.
 * `fresh`: cuántas sugerencias (sin recordatorio) quedan sin saltar, mostradas o no.
 */
export function planToday<T extends RadarProduct>(rows: T[], today: string, target: number, issuesOf: (r: T) => IssueKey[], skip?: ReadonlySet<string>): { done: T[]; todo: T[]; fresh: number } {
  const done = rows.filter((r) => r.active && r.pub.last && bogotaToday(new Date(r.pub.last)) === today);
  const doneIds = new Set(done.map((r) => r.id));
  const score = (r: T) => {
    const keys = issuesOf(r);
    const late = r.pub.next_due && r.pub.next_due <= today ? 100 + daysBetween(r.pub.next_due, today) * 5 : 0;
    return late + (keys.includes("no_sales") ? 40 : 0) + (r.pub.last ? 0 : 20) + Math.min(30, Math.max(0, Number(r.stock ?? 0)) / 10) + (r.image ? 5 : -50);
  };
  const candidates = rows
    .filter((r) => r.active && !doneIds.has(r.id) && (r.stock === null || Number(r.stock) > 0))
    .filter((r) => isPublishDue(r.pub, today) || ((!r.pub.last || issuesOf(r).includes("no_sales")) && !skip?.has(r.id)))
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name))
    .map((x) => x.r);
  const fresh = candidates.filter((r) => !isPublishDue(r.pub, today)).length;
  return { done, todo: candidates.slice(0, Math.max(0, target - done.length)), fresh };
}
