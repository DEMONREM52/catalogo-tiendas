/**
 * Catálogo de capacidades de REM: todo lo que REM sabe hacer, en un solo lugar.
 *
 * No se escribe a mano por duplicado: se ARMA con lo que ya existe en RemHub.
 *   · Páginas y formularios: el buscador Ctrl+K (src/lib/search-index.ts) y el menú (src/lib/module-tabs.ts),
 *     con sus permisos de verdad.
 *   · Qué es cada módulo y cómo se usa: src/lib/rem/modules.ts.
 *   · Pantallas que trabajan por voz y consultas: aquí abajo (VOICE_SCREENS, QUERIES).
 *
 * El catálogo describe; no autoriza. Lo que la persona puede abrir lo decide la lista filtrada por sus permisos
 * (paletteLinks en DashboardShell) y, al guardar o consultar, la base de datos (erp_can + RLS) otra vez.
 * tests/rem/catalog-sync.test.ts revisa que todo apunte a páginas y permisos reales, y docs/REM_CAPACIDADES.md
 * se genera desde aquí (npm run rem:catalog).
 */

import { SEARCH_INDEX } from "@/lib/search-index";
import { MODULE_TABS } from "@/lib/module-tabs";
import { MODULES, moduleOfPath } from "./modules";

/**
 * Riesgo de una acción:
 *  low: abrir, buscar, explicar, consultar · medium: abrir un formulario o llenar sin guardar ·
 *  high: guardar, mover inventario, cambiar precios, dinero · critical: borrar, permisos, irreversible.
 */
export type Risk = "low" | "medium" | "high" | "critical";
/** none: se hace sin preguntar · yes: «Di sí o no» con lo que se va a afectar · strong: no se hace por voz. */
export type Confirm = "none" | "yes" | "strong";

export type Capability = {
  id: string;
  kind: "page" | "form" | "voice" | "query";
  label: string;
  /** Módulo (modules.ts) al que pertenece. */
  module: string | null;
  href: string;
  /** Basta uno. Vacío = cualquiera de la tienda. */
  perms: string[];
  adminOnly?: boolean;
  synonyms: string;
  risk: Risk;
  confirm: Confirm;
  /** Quién lo ejecuta: «nav» (abrir), «form» (abrir el formulario), «screen:<título>» (la pantalla con voz) o una consulta. */
  runner: string;
  examples: string[];
  /** ready: probado · pending: existe en RemHub pero REM aún no lo ejecuta (solo lo explica o lo abre). */
  status: "ready" | "pending";
};

/** Pantallas que trabajan por voz. `match` decide a cuál lleva una frase (si la pantalla no está abierta). */
export type VoiceScreen = {
  title: string; name: string; href: string; perms: string[]; match: RegExp;
  /** Qué decir si la pantalla necesita un toque antes («Toca «Nuevo pedido»…»). */
  wait?: string;
  risk: Risk; confirm: Confirm; examples: string[];
  /** Qué guarda o cambia, para la documentación. */
  effect: string;
};

export const VOICE_SCREENS: VoiceScreen[] = [
  { title: "Traslado", name: "Traslados", href: "/dashboard/inventario?tab=transfers", perms: ["transfers"],
    match: /traslad|distribu|(?:mandar|enviar|despachar) (?:la )?mercancia/,
    risk: "high", confirm: "yes", examples: ["Quiero hacer un traslado", "Traslado de bodega a Zamora"], effect: "Envía el traslado (mueve existencias) después de «¿Lo envío?»" },
  { title: "Conteo", name: "Conteos", href: "/dashboard/inventario?tab=conteos", perms: ["inventory_counts", "inventory_adjust"],
    match: /conteo|contar|inventario fisico/, wait: "Abre o empieza un conteo y sigo solo.",
    risk: "high", confirm: "yes", examples: ["Quiero hacer un conteo"], effect: "Anota lo contado en el conteo abierto" },
  { title: "Pedido interno", name: "Pedidos internos", href: "/dashboard/pedidos?tab=internos&nuevo=1", perms: ["stock_requests"],
    match: /pedido interno|pedir mercancia|hacer un pedido|nuevo pedido|pedirle a|pedir a la bodega|pedido a/, wait: "Toca «Nuevo pedido» y sigo solo.",
    risk: "high", confirm: "yes", examples: ["Quiero hacer un pedido interno"], effect: "Envía el pedido a la bodega después de confirmar" },
  { title: "Compra", name: "Compras", href: "/dashboard/inventario?tab=purchases", perms: ["purchases"],
    match: /compra|factura de(?:l)? proveedor|ingres(?:o|ar) (?:de )?mercancia|llego mercancia|registrar factura/,
    risk: "high", confirm: "yes", examples: ["Registrar una compra"], effect: "Llena la factura de compra; se guarda al confirmar" },
  { title: "Venta", name: "POS", href: "/dashboard/pos", perms: ["pos"],
    match: /vend|venta|\bpos\b|caja|cobrar|facturar/,
    risk: "high", confirm: "yes", examples: ["Vender", "Quiero hacer una venta"], effect: "Arma el carrito; se cobra al confirmar" },
  // «Búscame en los productos la cámara sc30a»: lo decide searchRequest (src/lib/voice/products-voice.ts), no esta expresión.
  { title: "Productos", name: "Productos", href: "/dashboard/products", perms: ["products"], match: /(?!)/,
    risk: "high", confirm: "yes", examples: ["Búscame en los productos la cámara SC30", "Inactiva el dos"], effect: "Busca y filtra; activa o inactiva un producto después de «Di sí o no»" },
];

/** Consultas que REM responde con datos de la base (con la sesión de quien habla; la base revisa el permiso). */
export const QUERIES: Capability[] = [
  { id: "query:sales", kind: "query", label: "Ventas de un día", module: "home", href: "/dashboard", perms: ["pos", "reports", "orders"],
    synonyms: "cuanto vendimos ventas de hoy como van las ventas lo que hemos vendido mis ventas lo mas vendido ayer",
    risk: "low", confirm: "none", runner: "sales.summary", status: "ready",
    examples: ["¿Cuánto vendimos hoy?", "¿Y ayer?", "¿Cuánto he vendido yo?", "¿Qué es lo más vendido?", "Ventas del lunes"] },
  { id: "query:stock", kind: "query", label: "Existencias de un producto", module: "inventory", href: "/dashboard/inventario?tab=stock", perms: ["products", "products_view", "inventory", "pos", "purchases"],
    synonyms: "cuantas hay quedan stock existencias unidades hay de",
    risk: "low", confirm: "none", runner: "stock.product", status: "ready",
    examples: ["¿Cuántas hay de la cámara SC30A?", "¿Cuántas zapateras quedan?", "Stock de la VTS30"] },
  { id: "query:expenses", kind: "query", label: "Gastos de un periodo", module: "expenses", href: "/dashboard/gastos?tab=expenses", perms: ["expenses", "expenses_pay", "budgets"],
    synonyms: "cuanto hemos gastado gastos del mes pendientes por pagar vencidos semana",
    risk: "low", confirm: "none", runner: "expenses.summary", status: "ready",
    examples: ["¿Cuánto hemos gastado este mes?", "¿Y el mes pasado?", "Gastos pendientes", "Gastos vencidos"] },
  { id: "query:debts", kind: "query", label: "Cartera de clientes", module: "clients", href: "/dashboard/clientes?tab=cartera", perms: ["receivables", "credit"],
    synonyms: "cuanto nos deben cartera por cobrar cuanto debe deuda de fiado",
    risk: "low", confirm: "none", runner: "debts.summary", status: "ready",
    examples: ["¿Cuánto nos deben?", "¿Cuánto debe Juan Pérez?", "¿Cómo va la cartera?"] },
  { id: "form:gasto-por-voz", kind: "form", label: "Gasto llenado por voz", module: "expenses", href: "/dashboard/gastos?tab=expenses&nuevo=gasto", perms: ["expenses", "expenses_pay"],
    synonyms: "registra un gasto de anota un gasto apunta un gasto",
    risk: "medium", confirm: "none", runner: "form", status: "ready",
    examples: ["Registra un gasto de 50 mil en arriendo", "Anota un gasto de almuerzo por 20.000"] },
];

const pathOf = (href: string) => href.split("?")[0];

function build(): Capability[] {
  const out: Capability[] = [];
  const seen = new Set<string>();
  const push = (c: Capability) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } };
  for (const e of SEARCH_INDEX) {
    push({
      id: `${e.action ? "form" : "page"}:${e.href}#${e.label}`, kind: e.action ? "form" : "page", label: e.label,
      module: moduleOfPath(e.href)?.id ?? null, href: e.href, perms: e.perms, adminOnly: e.adminOnly,
      synonyms: [e.hint, e.keywords].filter(Boolean).join(" "),
      risk: e.action ? "medium" : "low", confirm: "none", runner: e.action ? "form" : "nav", examples: [], status: "ready",
    });
  }
  for (const tabs of Object.values(MODULE_TABS)) for (const t of tabs) {
    if (SEARCH_INDEX.some((e) => e.href === t.href)) continue;
    push({
      id: `page:${t.href}#${t.label}`, kind: "page", label: t.label, module: moduleOfPath(t.href)?.id ?? null, href: t.href,
      perms: t.permissions, adminOnly: t.adminOnly, synonyms: t.short ?? "", risk: "low", confirm: "none", runner: "nav", examples: [], status: "ready",
    });
  }
  for (const v of VOICE_SCREENS) {
    push({
      id: `voice:${v.title}`, kind: "voice", label: `${v.name} por voz`, module: moduleOfPath(v.href)?.id ?? null, href: v.href,
      perms: v.perms, synonyms: v.examples.join(" "), risk: v.risk, confirm: v.confirm, runner: `screen:${v.title}`, examples: v.examples, status: "ready",
    });
  }
  for (const q of QUERIES) push(q);
  return out;
}

export const CAPABILITIES: Capability[] = build();

/** Qué se puede crear desde el módulo en el que se está (para «crea uno nuevo»), de las acciones del buscador. */
export function createOptions(path: string): Capability[] {
  const [p, qs = ""] = path.split("?");
  const mod = moduleOfPath(p);
  if (!mod) return [];
  const tab = new URLSearchParams(qs).get("tab");
  const forms = CAPABILITIES.filter((c) => c.kind === "form" && moduleOfPath(c.href)?.id === mod.id);
  const extra = (mod.creates ?? []).flatMap((href) => CAPABILITIES.filter((c) => c.kind === "form" && pathOf(c.href) === href));
  const all = [...forms, ...extra.filter((x) => !forms.includes(x))];
  if (tab) {
    const inTab = all.filter((c) => new URLSearchParams(c.href.split("?")[1] ?? "").get("tab") === tab);
    if (inTab.length) return inTab;
  }
  return all;
}

/** Permisos de un módulo (basta uno): los de todo lo del catálogo que vive en él. */
export function modulePerms(moduleId: string): string[] {
  return [...new Set(CAPABILITIES.filter((c) => c.module === moduleId).flatMap((c) => c.perms))];
}

/** Versión del catálogo: cambia cuando cambia cualquier capacidad (la documentación generada la lleva). */
export function catalogVersion(): string {
  const text = JSON.stringify([CAPABILITIES.map((c) => [c.id, c.href, c.perms, c.risk, c.confirm, c.status]), MODULES.map((m) => [m.id, m.path, m.about, m.howto])]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
