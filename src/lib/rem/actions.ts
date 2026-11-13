/**
 * Acciones de REM: lo único que REM puede EJECUTAR por su cuenta. Lista cerrada: nada de código armado con lo
 * que se dice. Cada acción declara su riesgo, si necesita confirmación y los permisos (basta uno).
 *
 * Reglas (las prueban tests/rem/actions.test.ts):
 *   · Sin el permiso, no corre. Ese chequeo es para responder bonito; la base lo vuelve a revisar
 *     (las consultas usan la sesión de quien habla: auth.uid(), erp_can, sus puntos). Nunca credenciales generales.
 *   · Riesgo alto: solo con «sí» explícito (`confirmed`). Crítico: no se hace por voz.
 *   · Si algo falla, lo dice. Nunca inventa un dato ni dice «listo» si no se hizo.
 * Guardar, mover inventario o cambiar un producto lo hacen las pantallas con voz (src/lib/voice/rem.ts), que ya
 * preguntan «Di sí o no» con el producto o el documento exacto, y usan las mismas funciones de la pantalla.
 */

import type { RemReply } from "@/lib/voice/rem";
import type { Confirm, Risk } from "./catalog";
import type { DebtQuery, ExpenseQuery, SalesQuery, StockQuery, Topic } from "./understand";
import { normalize } from "@/lib/voice/spanish";

export type RpcResult = { data: unknown; error: { message: string } | null };

export type ActionEnv = {
  storeId: string;
  /** Permisos de quien habla (los mismos del menú). */
  can: (permission: string) => boolean;
  /** Llamada a la base con la sesión de quien habla. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

export type ActionResult = {
  ok: boolean;
  reply: RemReply;
  topic?: Topic;
  /** Ofrece abrir algo después («¿Te lo abro?»): se abre solo si la persona dice «sí» y lo puede abrir. */
  offer?: { href: string; label: string };
  /** Preguntó «¿cuál?»: cada opción vuelve a correr la acción con esos datos. */
  choices?: Array<{ name: string; action: string; params: unknown }>;
};

export type RemAction<P> = {
  id: string;
  label: string;
  risk: Risk;
  confirm: Confirm;
  perms: string[];
  /** null si los datos sirven; si no, qué decir. */
  validate: (p: P) => string | null;
  run: (p: P, env: ActionEnv) => Promise<ActionResult>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY = new Map<string, RemAction<any>>();

export function registerAction<P>(a: RemAction<P>) {
  REGISTRY.set(a.id, a);
}

export function actionInfo(id: string) {
  const a = REGISTRY.get(id);
  return a ? { id: a.id, label: a.label, risk: a.risk, confirm: a.confirm, perms: a.perms } : null;
}

export function listActions() {
  return [...REGISTRY.values()].map((a) => ({ id: a.id, label: a.label, risk: a.risk, confirm: a.confirm, perms: a.perms }));
}

/** Corre una acción del registro, con todos los controles. */
export async function runAction<P>(id: string, params: P, env: ActionEnv, opts: { confirmed?: boolean } = {}): Promise<ActionResult> {
  const a = REGISTRY.get(id) as RemAction<P> | undefined;
  if (!a) return { ok: false, reply: { say: "Eso todavía no lo sé hacer." } };
  if (a.perms.length && !a.perms.some((p) => env.can(p))) {
    return { ok: false, reply: { say: "Tu usuario no tiene permiso para eso. Si lo necesitas, pídeselo al administrador de la tienda." } };
  }
  const bad = a.validate(params);
  if (bad) return { ok: false, reply: { say: bad } };
  if (a.risk === "critical" || a.confirm === "strong") {
    return { ok: false, reply: { say: "Eso no lo hago por voz. Hazlo en la pantalla, donde ves exactamente qué se va a cambiar." } };
  }
  if ((a.risk === "high" || a.confirm === "yes") && !opts.confirmed) {
    return { ok: false, reply: { say: `Antes de ${a.label.toLowerCase()} necesito que me confirmes. Di sí o no.` } };
  }
  try {
    return await a.run(params, env);
  } catch {
    return { ok: false, reply: { say: "No pude hacerlo: algo falló en la conexión. No cambié nada. Inténtalo otra vez." } };
  }
}

// ---------------------------------------------------------------------------------------------
// Ventas

const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(n || 0));
const pesos = (n: number) => `${Math.round(n || 0).toLocaleString("es-CO")} pesos`;
const sales = (n: number) => `${n} ${n === 1 ? "venta" : "ventas"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type HomeToday = {
  ok: boolean; error?: string; points: string[];
  today: { count: number; total: number }; yesterday: { count: number; total: number }; mine: { count: number; total: number };
  top: Array<{ name: string; qty: number }>;
};
type DayClose = {
  ok: boolean; error?: string; day: string; total: number; count: number;
  points: Array<{ name: string; count: number; total: number }>; sellers: Array<{ name: string; count: number; total: number }>;
};

const HOME_PERMS = ["pos", "reports", "orders"];
const CLOSE_PERMS = ["reports", "cash_manage", "profit_view"];

function dbError(error: { message: string } | null, v: { ok?: boolean; error?: string } | null): string | null {
  if (error) return /Could not find|does not exist/i.test(error.message)
    ? "No pude consultar: a la base le falta una actualización."
    : "No pude consultar las ventas: la conexión falló. No te doy un número que no sea seguro.";
  if (!v?.ok) return v?.error ?? "No pude consultar las ventas.";
  return null;
}

/** El punto que se dijo, entre los que devuelve la base (que ya son solo los de quien pregunta). */
function findPoint<T extends { name: string }>(said: string, points: T[]): T | null {
  const s = normalize(said);
  return points.find((p) => normalize(p.name) === s)
    ?? points.find((p) => normalize(p.name).includes(s) || s.includes(normalize(p.name)))
    ?? null;
}

registerAction<SalesQuery>({
  id: "sales.summary",
  label: "Consultar las ventas",
  risk: "low",
  confirm: "none",
  perms: [...HOME_PERMS, ...CLOSE_PERMS],
  validate: (q) => (q.period.ago < 0 ? "Ese día todavía no llega." : q.period.ago > 366 ? "Te puedo decir las ventas de hasta un año atrás." : null),
  async run(q, env) {
    const topic: Topic = { kind: "sales", q };
    const when = q.period.label;
    const canHome = HOME_PERMS.some((p) => env.can(p));
    const canClose = CLOSE_PERMS.some((p) => env.can(p));

    if (q.range) {
      // erp_home_today y erp_daily_close son de un día. Por rango existe el informe de Rentabilidad (con costo y ganancia).
      return { ok: false, topic, offer: { href: "/dashboard/rentabilidad?tab=points", label: "Informe por fechas y horas" }, reply: {
        say: `Las ventas ${q.range.label} todavía no te las sé sumar por voz. Están en Rentabilidad, en el informe por fechas. ¿Te lo abro?`,
      } };
    }

    if (q.scope === "mine" && q.period.ago > 0) {
      return { ok: false, topic, reply: { say: `Tus ventas solo te las puedo decir de hoy. Si quieres, pregúntame por las de toda la tienda ${when}.` } };
    }

    // Hoy o ayer, sin punto: el resumen del inicio (también para quien solo vende).
    if ((q.period.ago <= 1 && !q.point) || q.scope !== "all") {
      if (!canHome) return { ok: false, topic, reply: { say: "Para ver ventas necesitas permiso de vender o de informes." } };
      const { data, error } = await env.rpc("erp_home_today", { p_store: env.storeId });
      const v = data as HomeToday | null;
      const bad = dbError(error, v);
      if (bad || !v) return { ok: false, topic, reply: { say: bad ?? "No pude consultar las ventas." } };
      const where = v.points.length ? ` en ${v.points.join(", ")}` : "";
      if (q.scope === "top") {
        if (!v.top.length) return { ok: true, topic, reply: { say: "En los últimos 7 días todavía no hay ventas." } };
        const list = v.top.slice(0, 5);
        return { ok: true, topic, reply: {
          say: `Lo más vendido en los últimos 7 días${where}: ${list.map((t, i) => `${i + 1}, ${t.name.toLowerCase()}, ${t.qty}`).join("; ")}.`,
          show: `Lo más vendido (últimos 7 días)${where}:\n${list.map((t, i) => `${i + 1}. ${t.name} · ${t.qty}`).join("\n")}`,
        } };
      }
      if (q.scope === "mine") {
        return { ok: true, topic, reply: {
          say: v.mine.count ? `Hoy llevas ${sales(v.mine.count)} a tu nombre, por ${pesos(v.mine.total)}.` : "Hoy todavía no tienes ventas a tu nombre.",
          show: `Tus ventas de hoy: ${sales(v.mine.count)} · ${money(v.mine.total)}`,
        } };
      }
      const d = q.period.ago === 0 ? v.today : v.yesterday;
      if (!d.count) return { ok: true, topic, reply: { say: `${cap(when)} no hay ventas registradas${where}.` } };
      const vs = q.period.ago === 0 && v.yesterday.total
        ? Math.round(((v.today.total - v.yesterday.total) / v.yesterday.total) * 100) : null;
      const cmp = vs === null ? "" : vs === 0 ? " Igual que ayer." : ` ${Math.abs(vs)} % ${vs > 0 ? "más" : "menos"} que ayer.`;
      return { ok: true, topic, reply: {
        say: `${q.period.ago === 0 ? "Hoy van" : "Ayer fueron"} ${sales(d.count)}${where}, por ${pesos(d.total)}.${cmp}`,
        show: `Ventas de ${when}${where}: ${sales(d.count)} · ${money(d.total)}${vs === null ? "" : ` (${vs >= 0 ? "▲" : "▼"} ${Math.abs(vs)} % vs. ayer)`}`,
      } };
    }

    // Otro día o un punto: el cierre del día (pide permiso de informes o de caja).
    if (!canClose) {
      return { ok: false, topic, reply: { say: q.point
        ? "Para ver las ventas por punto necesitas el permiso de informes de ventas."
        : "Las ventas de otros días las ve quien tiene el permiso de informes de ventas. Hoy y ayer sí te los puedo decir." } };
    }
    const { data, error } = await env.rpc("erp_daily_close", { p_store: env.storeId, p_day: q.period.day });
    const v = data as DayClose | null;
    const bad = dbError(error, v);
    if (bad || !v) return { ok: false, topic, reply: { say: bad ?? "No pude consultar las ventas." } };
    if (q.point) {
      const p = findPoint(q.point, v.points ?? []);
      if (!p) {
        const names = (v.points ?? []).map((x) => x.name);
        return { ok: false, topic: { kind: "sales", q: { ...q, point: null } }, reply: { say: names.length
          ? `${cap(when)} no encontré ventas en «${q.point}». Los puntos con ventas fueron: ${names.join(", ")}.`
          : `${cap(when)} no hay ventas registradas en ningún punto.` } };
      }
      return { ok: true, topic, reply: {
        say: `${cap(when)}, en ${p.name}: ${sales(p.count)}, por ${pesos(p.total)}.`,
        show: `Ventas de ${when} en ${p.name}: ${sales(p.count)} · ${money(p.total)}`,
      } };
    }
    if (!v.count) return { ok: true, topic, reply: { say: `${cap(when)} no hubo ventas registradas.` } };
    const pts = (v.points ?? []).filter((p) => p.count > 0).sort((a, b) => b.total - a.total);
    return { ok: true, topic, reply: {
      say: `${cap(when)} fueron ${sales(v.count)}, por ${pesos(v.total)}.${pts.length > 1 ? ` La que más vendió: ${pts[0].name}, con ${pesos(pts[0].total)}.` : ""}`,
      show: `Ventas de ${when}: ${sales(v.count)} · ${money(v.total)}${pts.length > 1 ? `\n${pts.map((p) => `📍 ${p.name}: ${money(p.total)} (${p.count})`).join("\n")}` : ""}`,
    } };
  },
});

// ---------------------------------------------------------------------------------------------
// Existencias de un producto

type ProductRow = { id: string; name: string; sku: string | null; active: boolean | null };
type StockRow = { warehouse_id: string; name: string; kind: string; qty: number };
const STOCK_PERMS = ["products", "products_view", "inventory", "pos", "purchases"];
const units = (n: number) => `${n} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;

function sameProduct(said: string, p: ProductRow): boolean {
  const s = normalize(said).replace(/\s+/g, "");
  return normalize(p.name).replace(/\s+/g, "") === s || (!!p.sku && normalize(p.sku).replace(/[\s-]+/g, "") === s.replace(/-/g, ""));
}

registerAction<StockQuery & { id?: string; name?: string }>({
  id: "stock.product",
  label: "Consultar las existencias de un producto",
  risk: "low",
  confirm: "none",
  perms: STOCK_PERMS,
  validate: (q) => (q.id || q.product.trim().length >= 2 ? null : "¿De qué producto?"),
  async run(q, env) {
    const topic: Topic = { kind: "stock", q: { product: q.product } };
    let product: ProductRow | null = q.id ? { id: q.id, name: q.name ?? q.product, sku: null, active: true } : null;
    if (!product) {
      const { data, error } = await env.rpc("search_products_safe", { p_store_id: env.storeId, p_query: q.product, p_limit: 6, p_offset: 0, p_status: "all", p_category_id: null });
      if (error) return { ok: false, topic, reply: { say: "No pude buscar el producto: la conexión falló." } };
      const rows = ((data ?? []) as ProductRow[]).filter((r) => r && r.id);
      if (!rows.length) return { ok: false, topic, reply: { say: `No encontré «${q.product}» en los productos. Dímelo de otra forma o con el código.` } };
      const exact = rows.filter((r) => sameProduct(q.product, r));
      if (exact.length === 1 || rows.length === 1) product = exact[0] ?? rows[0];
      else {
        const few = rows.slice(0, 3);
        return { ok: false, topic, reply: { say: `Encontré varios. ¿Cuál? ${few.map((r, i) => `${["uno", "dos", "tres"][i]}, ${r.name.toLowerCase()}`).join("; ")}.` },
          choices: few.map((r) => ({ name: r.name, action: "stock.product", params: { product: q.product, id: r.id, name: r.name } })) };
      }
    }
    const { data, error } = await env.rpc("erp_product_stock_by_point", { p_product: product.id });
    if (error) return { ok: false, topic, reply: { say: /permiso/i.test(error.message) ? "Tu usuario no tiene permiso para ver las existencias." : "No pude consultar las existencias: la conexión falló." } };
    const rows = ((data ?? []) as StockRow[]);
    const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    const where = rows.filter((r) => Number(r.qty) !== 0).sort((a, b) => b.qty - a.qty);
    const name = product.name;
    const off = product.active === false ? " Está inactivo." : "";
    if (!where.length) return { ok: true, topic, reply: { say: `${name}: no hay unidades en ningún punto.${off}` } };
    return { ok: true, topic, reply: {
      say: `De ${name.toLowerCase()} hay ${units(total)}${where.length > 1 ? `: ${where.slice(0, 4).map((r) => `${r.name}, ${r.qty}`).join("; ")}` : `, en ${where[0].name}`}.${off}`,
      show: `${name}: ${units(total)}\n${where.map((r) => `📍 ${r.name}: ${r.qty}`).join("\n")}${off ? `\n${off.trim()}` : ""}`,
    } };
  },
});

// ---------------------------------------------------------------------------------------------
// Gastos

const EXPENSE_PERMS = ["expenses", "expenses_pay", "budgets"];

registerAction<ExpenseQuery>({
  id: "expenses.summary",
  label: "Consultar los gastos",
  risk: "low",
  confirm: "none",
  perms: EXPENSE_PERMS,
  validate: (q) => (q.range.from > q.range.to ? "Ese rango de fechas no sirve." : null),
  async run(q, env) {
    const topic: Topic = { kind: "expenses", q };
    const { data, error } = await env.rpc("erp_expenses_list", {
      p_store: env.storeId, p_point: null, p_from: q.range.from, p_to: q.range.to,
      p_status: q.status === "all" ? null : q.status, p_category: null, p_query: null, p_limit: 1, p_offset: 0,
    });
    if (error) return { ok: false, topic, reply: { say: /permiso|Gastos/i.test(error.message) ? "Tu usuario no tiene permiso para ver los gastos." : "No pude consultar los gastos: la conexión falló." } };
    const v = data as { total: number; sum: number } | null;
    if (!v) return { ok: false, topic, reply: { say: "No pude consultar los gastos." } };
    const what = q.status === "open" ? "gastos pendientes de pagar" : q.status === "overdue" ? "gastos vencidos" : "gastos";
    const n = Number(v.total) || 0;
    if (!n) return { ok: true, topic, reply: { say: `${cap(q.range.label)} no hay ${what}.` } };
    return { ok: true, topic, offer: { href: "/dashboard/gastos?tab=expenses", label: "Gastos" }, reply: {
      say: `${cap(q.range.label)} van ${n} ${n === 1 ? what.replace("gastos", "gasto") : what}, por ${pesos(Number(v.sum))}. ¿Te los muestro?`,
      show: `${cap(what)} ${q.range.label}: ${n} · ${money(Number(v.sum))}\n¿Te los muestro?`,
    } };
  },
});

// ---------------------------------------------------------------------------------------------
// Cartera (lo que deben los clientes)

const DEBT_PERMS = ["receivables", "credit"];
type Receivables = {
  kpis: { open: number; open_count: number; overdue: number; overdue_count: number; customers: number };
  items: Array<{ customer_id: string; customer: string; balance: number; late: number }>;
};

registerAction<DebtQuery>({
  id: "debts.summary",
  label: "Consultar la cartera",
  risk: "low",
  confirm: "none",
  perms: DEBT_PERMS,
  validate: () => null,
  async run(q, env) {
    const topic: Topic = { kind: "debts", q };
    const { data, error } = await env.rpc("erp_receivables_overview", { p_store: env.storeId });
    if (error) return { ok: false, topic, reply: { say: /permiso/i.test(error.message) ? "Tu usuario no tiene permiso para ver la cartera." : "No pude consultar la cartera: la conexión falló." } };
    const v = data as Receivables | null;
    if (!v?.kpis) return { ok: false, topic, reply: { say: "No pude consultar la cartera." } };
    const offer = { href: "/dashboard/clientes?tab=cartera", label: "Cartera" };
    if (q.customer) {
      const words = normalize(q.customer).split(" ").filter((w) => w.length > 1);
      const mine = (v.items ?? []).filter((i) => { const n = normalize(i.customer); return words.every((w) => n.includes(w)); });
      const people = [...new Set(mine.map((i) => i.customer_id))];
      if (!mine.length) return { ok: true, topic, reply: { say: `No encontré deudas abiertas de «${q.customer}».` } };
      if (people.length > 1) {
        const names = [...new Set(mine.map((i) => i.customer))].slice(0, 3);
        return { ok: false, topic, reply: { say: `Hay varios clientes que se llaman así: ${names.join(", ")}. Dime el nombre completo.` } };
      }
      const sum = mine.reduce((a, i) => a + Number(i.balance || 0), 0);
      const late = Math.max(...mine.map((i) => Number(i.late) || 0));
      return { ok: true, topic, offer, reply: {
        say: `${mine[0].customer} debe ${pesos(sum)}${mine.length > 1 ? ` en ${mine.length} documentos` : ""}.${late > 0 ? ` Lo más viejo tiene ${late} ${late === 1 ? "día" : "días"} de vencido.` : " Nada vencido."} ¿Te abro la cartera?`,
        show: `${mine[0].customer}: ${money(sum)} (${mine.length} doc.)${late > 0 ? ` · ${late} días de vencido` : ""}\n¿Te abro la cartera?`,
      } };
    }
    const k = v.kpis;
    if (!k.open_count) return { ok: true, topic, reply: { say: "Nadie te debe: no hay cartera abierta." } };
    return { ok: true, topic, offer, reply: {
      say: `Te deben ${pesos(k.open)} entre ${k.customers} ${k.customers === 1 ? "cliente" : "clientes"}.${k.overdue_count ? ` De eso, ${pesos(k.overdue)} está vencido.` : " Nada está vencido."} ¿Te abro la cartera?`,
      show: `Cartera: ${money(k.open)} · ${k.customers} clientes${k.overdue_count ? `\nVencido: ${money(k.overdue)} (${k.overdue_count} doc.)` : ""}\n¿Te abro la cartera?`,
    } };
  },
});
