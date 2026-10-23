import { supabaseBrowser } from "@/lib/supabase/client";
import { docKey, fold, toBool, toIsoDate, toNumber } from "@/lib/data/read-table";
import type { XCell } from "@/lib/data/xlsx";
import { DOC_TYPES, TAX_REGIMES, type ThirdKind } from "../clientes/terceros";
import { cleanProductCode } from "../products/product-code";

/**
 * Lo que se puede importar desde «Importar y exportar». Cada importación:
 *   1. reconoce las columnas por su nombre (con o sin tildes, en cualquier orden);
 *   2. revisa cada fila contra la base (qué es nuevo, qué ya existe, qué tiene errores) ANTES de guardar;
 *   3. al confirmar vuelve a revisar (por si otra persona cambió algo) y guarda con las funciones de siempre,
 *      con sus permisos y su auditoría. Importar dos veces el mismo archivo no duplica.
 */

export type Opts = { update: boolean; warehouseId: string };
export type ICtx = { storeId: string; can: (p: string) => boolean; opts: Opts; fileName: string; step: (t: string) => void };
export type Action = "create" | "update" | "skip" | "error";
export type Prepared = { line: number; label: string; detail: string; action: Action; message: string; data: Record<string, unknown> };
export type Column = { key: string; label: string; aliases: string[]; required?: boolean; hint?: string };
export type Result = { done: number; skipped: number; failed: Array<{ line: number; label: string; error: string }> };
export type ImportDef = {
  key: string; icon: string; title: string; detail: string; perms: string[];
  columns: Column[]; sample: XCell[][]; needsWarehouse?: boolean; canUpdate?: boolean; link?: string;
  prepare: (rows: Array<{ line: number; v: Record<string, unknown> }>, ctx: ICtx) => Promise<Prepared[]>;
  apply: (rows: Prepared[], ctx: ICtx) => Promise<Result>;
};

type Row = Record<string, unknown>;
const sb = () => supabaseBrowser();
const txt = (v: unknown) => String(v ?? "").trim();
const up = (v: unknown) => txt(v).replace(/\s+/g, " ").toUpperCase();
const orNull = (v: unknown) => txt(v) || null;
const email = (v: unknown) => { const e = txt(v).toLowerCase(); return e || null; };
const money = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;
const errText = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "Error"));

async function all(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Corre tareas de a pocas a la vez (para no saturar la base) y avisa el avance. */
async function pool<T>(items: T[], size: number, work: (item: T, i: number) => Promise<void>, step: (t: string) => void, label: string) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i], i);
      done++;
      if (done % 5 === 0 || done === items.length) step(`${label} ${done} de ${items.length}…`);
    }
  }));
}

/** Documentos de un tercero para comparar: con y sin dígito de verificación (900123456-7 = 900123456). */
function docKeys(v: unknown): string[] {
  const raw = txt(v);
  if (!raw) return [];
  const full = docKey(raw);
  const noDv = /-\s*\d$/.test(raw) ? docKey(raw.replace(/-\s*\d$/, "")) : "";
  return [full, noDv].filter((k, i, a) => k.length >= 3 && a.indexOf(k) === i);
}

const DOC_WORDS: Array<[RegExp, string]> = [
  [/^(cc|cedula|cedula de ciudadania|c c)$/, "CC"], [/^(nit|n i t)$/, "NIT"], [/^(ce|cedula de extranjeria|extranjeria)$/, "CE"],
  [/^(ti|tarjeta de identidad)$/, "TI"], [/^(pp|pasaporte|pas)$/, "PP"], [/^(ppt|permiso por proteccion temporal)$/, "PPT"],
  [/^(pep|permiso especial de permanencia)$/, "PEP"], [/^(nit ext|nit extranjero|nit de otro pais)$/, "NIT_EXT"], [/^(rc|registro civil)$/, "RC"],
];
function docType(v: unknown): string | null {
  const f = fold(v);
  if (!f) return null;
  const hit = DOC_TYPES.find(([k, label]) => fold(k) === f || fold(label) === f);
  if (hit) return hit[0];
  return DOC_WORDS.find(([re]) => re.test(f))?.[1] ?? "x";
}
const KIND_WORDS: Array<[RegExp, ThirdKind]> = [
  [/^(cliente|clientes|customer)$/, "customer"], [/^(proveedor|proveedores|supplier)$/, "supplier"], [/^(trabajador|empleado|trabajadores|empleados)$/, "employee"],
  [/^(vendedor|asesor|vendedores)$/, "seller"], [/^(asociado|socio|asociados)$/, "partner"], [/^(transportador|domiciliario|mensajero)$/, "carrier"], [/^(otro|otros)$/, "other"],
];
function kinds(v: unknown): ThirdKind[] | "x" {
  const parts = txt(v).split(/[,;/|+]| y /i).map(fold).filter(Boolean);
  if (!parts.length) return ["customer"];
  const out: ThirdKind[] = [];
  for (const p of parts) {
    const k = KIND_WORDS.find(([re]) => re.test(p))?.[1];
    if (!k) return "x";
    if (!out.includes(k)) out.push(k);
  }
  return out;
}
function regime(v: unknown): string | null | "x" {
  const f = fold(v);
  if (!f) return null;
  const hit = TAX_REGIMES.find(([k, label]) => k && (fold(k) === f || fold(label) === f));
  return hit ? hit[0] : "x";
}

const col = (key: string, label: string, aliases: string[], extra: Partial<Column> = {}): Column => ({ key, label, aliases: [label, ...aliases].map(fold), ...extra });

// ------------------------------------------------------------------ Terceros
const terceros: ImportDef = {
  key: "terceros", icon: "👥", title: "Terceros", perms: ["clients"], canUpdate: true,
  detail: "Clientes, proveedores, trabajadores… Si el documento ya existe se omite (o se actualiza si lo pides). Los que sean «proveedor» quedan también listos para las compras.",
  columns: [
    col("kind", "Tipo", ["tipo de tercero", "clase"], { hint: "cliente, proveedor, trabajador… (varios separados por coma)" }),
    col("name", "Nombre", ["nombre completo", "razon social", "cliente", "tercero", "nombres"], { required: true }),
    col("trade", "Nombre comercial", ["comercial", "establecimiento"]),
    col("person", "Persona", ["tipo de persona"], { hint: "natural o jurídica" }),
    col("doctype", "Tipo de documento", ["tipo doc", "tipo de identificacion", "tipo identificacion"]),
    col("doc", "Documento", ["cedula", "nit", "identificacion", "numero de documento", "cc", "cc nit", "documento de identidad"]),
    col("email", "Correo", ["email", "e mail", "correo electronico"]),
    col("mobile", "Celular", ["whatsapp", "movil", "cel"]),
    col("phone", "Teléfono", ["telefono fijo", "tel"]),
    col("contact", "Contacto", ["persona de contacto", "nombre de contacto"]),
    col("address", "Dirección", ["direccion"]),
    col("city", "Ciudad", ["municipio"]),
    col("dept", "Departamento", ["depto"]),
    col("country", "País", ["pais"]),
    col("birthday", "Cumpleaños", ["fecha de nacimiento", "nacimiento"], { hint: "DD/MM/AAAA" }),
    col("regime", "Régimen", ["regimen", "regimen tributario"]),
    col("list", "Lista de precios", ["lista", "precio", "lista precios"], { hint: "1 a 5" }),
    col("paydays", "Días de pago a proveedor", ["dias de pago", "plazo proveedor"]),
    col("tags", "Etiquetas", ["tags"]),
    col("notes", "Notas", ["observaciones", "nota"]),
    col("active", "Activo", ["activa", "estado"]),
    col("credit", "Crédito", ["credito", "tiene credito"], { hint: "Sí o No (necesita permiso de créditos)" }),
    col("limit", "Cupo", ["cupo de credito", "limite de credito"]),
    col("days", "Días de crédito", ["dias de credito", "plazo"]),
  ],
  sample: [
    ["cliente", "MARÍA LÓPEZ", "", "natural", "CC", "1098765432", "maria@correo.com", "3001234567", "", "", "CRA 1 # 2-3", "MEDELLÍN", "ANTIOQUIA", "Colombia", "15/03/1990", "", 3, "", "frecuente", "", "Sí", "Sí", 500000, 30],
    ["proveedor", "IMPORTADORA ABC S.A.S.", "ABC", "jurídica", "NIT", "900123456-7", "ventas@abc.com", "3109876543", "6041234567", "PEDRO", "CL 10 # 20-30", "BOGOTÁ", "CUNDINAMARCA", "Colombia", "", "responsable_iva", 3, 30, "", "", "Sí", "No", "", ""],
  ],
  async prepare(rows, ctx) {
    ctx.step("Revisando terceros con la base…");
    const existing = await all((a, b) => sb().from("billing_customers").select("id,name,document_number").eq("store_id", ctx.storeId).order("id").range(a, b));
    const byDoc = new Map<string, Row>(), byName = new Map<string, Row>();
    for (const e of existing) { for (const k of docKeys(e.document_number)) byDoc.set(k, e); if (!txt(e.document_number)) byName.set(fold(e.name), e); }
    const seen = new Set<string>();
    const canCredit = ctx.can("credit");
    return rows.map(({ line, v }) => {
      const name = up(v.name);
      const p: Prepared = { line, label: name || "(sin nombre)", detail: txt(v.doc), action: "create", message: "Nuevo", data: {} };
      const fail = (m: string) => ({ ...p, action: "error" as const, message: m });
      if (!name) return fail("Falta el nombre");
      const k = kinds(v.kind);
      if (k === "x") return fail(`No entiendo el tipo «${txt(v.kind)}» (usa cliente, proveedor, trabajador, vendedor, asociado, transportador u otro)`);
      const dt = docType(v.doctype);
      if (dt === "x") return fail(`No entiendo el tipo de documento «${txt(v.doctype)}»`);
      const reg = regime(v.regime);
      if (reg === "x") return fail(`No entiendo el régimen «${txt(v.regime)}»`);
      const bday = toIsoDate(v.birthday);
      if (bday === "x") return fail("El cumpleaños debe ser DD/MM/AAAA");
      const mail = email(v.email);
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail(`El correo «${mail}» no se ve bien`);
      const list = toNumber(v.list);
      if (list !== null && !(list >= 1 && list <= 5)) return fail("La lista de precios va de 1 a 5");
      const limit = toNumber(v.limit), days = toNumber(v.days), paydays = toNumber(v.paydays);
      if ((limit ?? 0) < 0 || (days ?? 0) < 0 || (paydays ?? 0) < 0) return fail("Cupo y días no pueden ser negativos");
      const keys = docKeys(v.doc);
      const key = keys[0] ?? `n:${fold(name)}`;
      if (seen.has(key)) return fail("Está repetido en el archivo");
      seen.add(key);
      const hit = keys.map((x) => byDoc.get(x)).find(Boolean) ?? (keys.length ? undefined : byName.get(fold(name)));
      const docType0 = dt ?? (txt(v.doc) ? (/-\s*\d$/.test(txt(v.doc)) || /^(8|9)\d{8}/.test(docKey(v.doc)) ? "NIT" : "CC") : "CC");
      const person = fold(v.person).startsWith("jur") ? "juridica" : fold(v.person).startsWith("nat") ? "natural" : docType0 === "NIT" ? "juridica" : "natural";
      const docNumber = txt(v.doc) ? (docType0 === "NIT" ? docKey(txt(v.doc).replace(/-\s*\d$/, "")) : docKey(v.doc)) : null;
      const credit = toBool(v.credit);
      const data: Row = {
        name, trade_name: orNull(v.trade) && up(v.trade),
        // Al actualizar, lo que no viene en el archivo se deja como está.
        kinds: txt(v.kind) || !hit ? k : null, person_type: txt(v.person) || !hit ? person : null, document_type: txt(v.doctype) || !hit ? docType0 : null, document_number: docNumber,
        email: mail, mobile: orNull(v.mobile), phone: orNull(v.phone), contact_name: orNull(v.contact) && up(v.contact), address: orNull(v.address) && up(v.address),
        city: orNull(v.city) && up(v.city), department: orNull(v.dept) && up(v.dept), country: orNull(v.country), birthday: bday, tax_regime: reg,
        price_list: list === null ? null : Math.round(list), supplier_payment_days: paydays === null ? null : Math.min(720, Math.floor(paydays)),
        tags: txt(v.tags) ? txt(v.tags).split(/[,;]/).map((t) => t.trim()).filter(Boolean) : null, notes: orNull(v.notes), active: toBool(v.active),
        ...(canCredit ? { credit_enabled: credit, credit_limit: limit === null ? null : Math.max(0, limit), credit_days: days === null ? null : Math.min(720, Math.floor(days)) } : {}),
        _id: hit ? String(hit.id) : null,
      };
      const creditIgnored = !canCredit && (credit !== null || limit !== null || days !== null);
      if (hit) {
        return ctx.opts.update
          ? { ...p, action: "update", message: `Ya existe: se actualizan los datos que vienen llenos${creditIgnored ? " (el crédito no, falta permiso)" : ""}`, data }
          : { ...p, action: "skip", message: "Ya existe (no se cambia)", data };
      }
      return { ...p, message: `Nuevo ${k.map((x) => ({ customer: "cliente", supplier: "proveedor", employee: "trabajador", seller: "vendedor", partner: "asociado", carrier: "transportador", other: "otro" })[x]).join(" y ")}${creditIgnored ? " (el crédito no se carga: falta permiso de créditos)" : ""}`, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    const clean = (d: Row, forInsert: boolean) => {
      const out: Row = {};
      for (const [k, val] of Object.entries(d)) {
        if (k.startsWith("_")) continue;
        if (val === null || val === undefined) continue; // nunca se borra un dato que ya existe con una celda vacía
        out[k] = val;
      }
      if (forInsert) {
        out.store_id = ctx.storeId;
        out.country ??= "Colombia";
        out.price_list ??= 3;
        out.active ??= true;
      }
      return out;
    };
    const creates = rows.filter((r) => r.action === "create");
    const created = new Map<number, string>();
    for (let i = 0; i < creates.length; i += 100) {
      ctx.step(`Creando terceros ${Math.min(i + 100, creates.length)} de ${creates.length}…`);
      const part = creates.slice(i, i + 100);
      const { data, error } = await sb().from("billing_customers").insert(part.map((r) => clean(r.data, true))).select("id");
      if (!error && Array.isArray(data)) { part.forEach((r, j) => created.set(r.line, String((data[j] as Row).id))); res.done += part.length; continue; }
      // Si el lote falla, se intenta uno por uno para saber cuál tiene el problema.
      for (const r of part) {
        const one = await sb().from("billing_customers").insert(clean(r.data, true)).select("id").single();
        if (one.error) res.failed.push({ line: r.line, label: r.label, error: /duplicate|23505/i.test(one.error.message) ? "Ese documento ya existe en la tienda" : one.error.message });
        else { created.set(r.line, String((one.data as Row).id)); res.done++; }
      }
    }
    await pool(rows.filter((r) => r.action === "update"), 4, async (r) => {
      const { error } = await sb().from("billing_customers").update({ ...clean(r.data, false), updated_at: new Date().toISOString() }).eq("id", String(r.data._id));
      if (error) res.failed.push({ line: r.line, label: r.label, error: error.message }); else res.done++;
    }, ctx.step, "Actualizando terceros");
    // Los proveedores quedan también en la lista de compras (si se tiene el permiso).
    if (ctx.can("suppliers")) {
      const sups = rows.filter((r) => (r.action === "create" || r.action === "update") && Array.isArray(r.data.kinds) && (r.data.kinds as string[]).includes("supplier"));
      if (sups.length) {
        const existing = await all((a, b) => sb().from("erp_suppliers").select("id,name,nit").eq("store_id", ctx.storeId).order("id").range(a, b));
        const have = new Set(existing.flatMap((e) => [...docKeys(e.nit), `n:${fold(e.name)}`]));
        const add = sups.filter((r) => !(docKeys(r.data.document_number).some((k) => have.has(k)) || have.has(`n:${fold(r.data.name)}`)));
        if (add.length) {
          ctx.step("Agregando proveedores a compras…");
          await sb().from("erp_suppliers").insert(add.map((r) => ({
            store_id: ctx.storeId, name: r.data.name, nit: r.data.document_number, contact_name: r.data.contact_name, phone: r.data.mobile ?? r.data.phone,
            email: r.data.email, address: r.data.address, payment_days: r.data.supplier_payment_days ?? 0, third_party_id: created.get(r.line) ?? r.data._id ?? null,
          })));
        }
      }
    }
    return res;
  },
};

// ------------------------------------------------------------------ Proveedores (compras)
const proveedores: ImportDef = {
  key: "proveedores", icon: "🚚", title: "Proveedores de compras", perms: ["suppliers"], canUpdate: true,
  detail: "Los proveedores que usas en los ingresos de factura. Se reconocen por NIT (o por nombre si no tienen).",
  columns: [
    col("name", "Nombre", ["proveedor", "razon social"], { required: true }),
    col("nit", "NIT", ["documento", "identificacion", "nit cc"]),
    col("contact", "Contacto", ["persona de contacto"]),
    col("phone", "Teléfono", ["celular", "telefono", "whatsapp"]),
    col("email", "Correo", ["email"]),
    col("address", "Dirección", ["direccion"]),
    col("days", "Días de pago", ["dias de credito", "plazo", "dias"]),
    col("notes", "Notas", ["observaciones"]),
    col("active", "Activo", ["activa", "estado"]),
  ],
  sample: [["IMPORTADORA ABC S.A.S.", "900123456", "PEDRO", "3109876543", "ventas@abc.com", "CL 10 # 20-30", 30, "", "Sí"]],
  async prepare(rows, ctx) {
    ctx.step("Revisando proveedores con la base…");
    const existing = await all((a, b) => sb().from("erp_suppliers").select("id,name,nit").eq("store_id", ctx.storeId).order("id").range(a, b));
    const byKey = new Map<string, Row>();
    for (const e of existing) { for (const k of docKeys(e.nit)) byKey.set(k, e); byKey.set(`n:${fold(e.name)}`, e); }
    const seen = new Set<string>();
    return rows.map(({ line, v }) => {
      const name = up(v.name);
      const p: Prepared = { line, label: name || "(sin nombre)", detail: txt(v.nit), action: "create", message: "Nuevo", data: {} };
      if (!name) return { ...p, action: "error", message: "Falta el nombre" };
      const days = toNumber(v.days);
      if ((days ?? 0) < 0) return { ...p, action: "error", message: "Los días de pago no pueden ser negativos" };
      const keys = [...docKeys(v.nit), `n:${fold(name)}`];
      if (seen.has(keys[0])) return { ...p, action: "error", message: "Está repetido en el archivo" };
      seen.add(keys[0]);
      const hit = keys.map((k) => byKey.get(k)).find(Boolean);
      const data: Row = { name, nit: txt(v.nit) ? docKey(txt(v.nit).replace(/-\s*\d$/, "")) : null, contact_name: orNull(v.contact) && up(v.contact), phone: orNull(v.phone),
        email: email(v.email), address: orNull(v.address) && up(v.address), payment_days: days === null ? null : Math.min(720, Math.floor(days)), notes: orNull(v.notes),
        active: toBool(v.active), _id: hit ? String(hit.id) : null };
      if (hit) return ctx.opts.update ? { ...p, action: "update", message: "Ya existe: se actualizan los datos que vienen llenos", data } : { ...p, action: "skip", message: "Ya existe (no se cambia)", data };
      return { ...p, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    const clean = (d: Row) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !k.startsWith("_") && v !== null && v !== undefined));
    const creates = rows.filter((r) => r.action === "create");
    for (let i = 0; i < creates.length; i += 100) {
      ctx.step(`Creando proveedores ${Math.min(i + 100, creates.length)} de ${creates.length}…`);
      const part = creates.slice(i, i + 100);
      const { error } = await sb().from("erp_suppliers").insert(part.map((r) => ({ store_id: ctx.storeId, payment_days: 0, ...clean(r.data) })));
      if (!error) { res.done += part.length; continue; }
      for (const r of part) {
        const one = await sb().from("erp_suppliers").insert({ store_id: ctx.storeId, payment_days: 0, ...clean(r.data) });
        if (one.error) res.failed.push({ line: r.line, label: r.label, error: one.error.message }); else res.done++;
      }
    }
    await pool(rows.filter((r) => r.action === "update"), 4, async (r) => {
      const { error } = await sb().from("erp_suppliers").update({ ...clean(r.data), updated_at: new Date().toISOString() }).eq("id", String(r.data._id));
      if (error) res.failed.push({ line: r.line, label: r.label, error: error.message }); else res.done++;
    }, ctx.step, "Actualizando proveedores");
    return res;
  },
};

// ------------------------------------------------------------------ Categorías
const categorias: ImportDef = {
  key: "categorias", icon: "🗂️", title: "Categorías", perms: ["categories"], canUpdate: true,
  detail: "Crea las categorías que falten (si ya existe con ese nombre, se omite).",
  columns: [col("name", "Nombre", ["categoria", "categorias", "linea", "grupo"], { required: true }), col("order", "Orden", ["posicion"]), col("active", "Activa", ["activo", "estado"])],
  sample: [["AUDIO", 1, "Sí"], ["HOGAR", 2, "Sí"]],
  async prepare(rows, ctx) {
    const existing = await all((a, b) => sb().from("product_categories").select("id,name").eq("store_id", ctx.storeId).range(a, b));
    const byName = new Map(existing.map((c) => [fold(c.name), c]));
    const seen = new Set<string>();
    return rows.map(({ line, v }) => {
      const name = up(v.name);
      const p: Prepared = { line, label: name || "(sin nombre)", detail: "", action: "create", message: "Nueva", data: {} };
      if (!name) return { ...p, action: "error", message: "Falta el nombre" };
      if (seen.has(fold(name))) return { ...p, action: "error", message: "Está repetida en el archivo" };
      seen.add(fold(name));
      const order = toNumber(v.order);
      const hit = byName.get(fold(name));
      const data: Row = { name, sort_order: order === null ? null : Math.floor(order), active: toBool(v.active), _id: hit ? String(hit.id) : null };
      if (hit) return ctx.opts.update ? { ...p, action: "update", message: "Ya existe: se actualiza orden / activa", data } : { ...p, action: "skip", message: "Ya existe", data };
      return { ...p, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    const clean = (d: Row) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !k.startsWith("_") && v !== null && v !== undefined));
    for (const r of rows.filter((x) => x.action === "create" || x.action === "update")) {
      const q = r.action === "create"
        ? sb().from("product_categories").insert({ store_id: ctx.storeId, active: true, ...clean(r.data) })
        : sb().from("product_categories").update(clean(r.data)).eq("id", String(r.data._id));
      const { error } = await q;
      if (error) res.failed.push({ line: r.line, label: r.label, error: error.message }); else res.done++;
    }
    return res;
  },
};

// ------------------------------------------------------------------ Cartera inicial
const cartera: ImportDef = {
  key: "cartera", icon: "📒", title: "Cartera inicial (lo que te deben)", perms: ["receivables", "credit"],
  detail: "Saldos que tus clientes te deben de antes de usar RemHub. Cada fila es un documento por cobrar. Si el cliente no existe y viene el nombre, se crea.",
  columns: [
    col("doc", "Documento del cliente", ["cedula", "nit", "documento", "identificacion", "cc"]),
    col("name", "Cliente", ["nombre", "nombre del cliente"]),
    col("amount", "Valor", ["saldo", "debe", "valor adeudado", "monto", "total"], { required: true }),
    col("due", "Vence", ["vencimiento", "fecha de vencimiento", "fecha limite"], { hint: "DD/MM/AAAA" }),
    col("number", "Número", ["factura", "numero de factura", "documento soporte", "n factura", "referencia"], { hint: "Con número no se duplica si importas otra vez" }),
    col("desc", "Descripción", ["concepto", "detalle", "nota"]),
  ],
  sample: [["1098765432", "MARÍA LÓPEZ", 250000, "30/11/2026", "FAC-1021", "Saldo de antes de RemHub"], ["52111222", "JUAN PÉREZ", 80000, "", "REM-77", ""]],
  async prepare(rows, ctx) {
    ctx.step("Revisando clientes y cartera con la base…");
    const parties = await all((a, b) => sb().from("billing_customers").select("id,name,document_number").eq("store_id", ctx.storeId).order("id").range(a, b));
    const byDoc = new Map<string, Row>(), byName = new Map<string, Row>();
    for (const e of parties) { for (const k of docKeys(e.document_number)) byDoc.set(k, e); byName.set(fold(e.name), e); }
    const recs = await all((a, b) => sb().from("erp_receivables").select("customer_id,doc_number,status").eq("store_id", ctx.storeId).neq("status", "void").order("customer_id").range(a, b));
    const have = new Set(recs.filter((r) => txt(r.doc_number)).map((r) => `${r.customer_id}|${up(r.doc_number)}`));
    const seen = new Set<string>();
    const canCreate = ctx.can("clients");
    return rows.map(({ line, v }) => {
      const amount = toNumber(v.amount);
      const name = up(v.name);
      const p: Prepared = { line, label: name || txt(v.doc) || "(sin cliente)", detail: amount ? money(amount) : "", action: "create", message: "", data: {} };
      const fail = (m: string) => ({ ...p, action: "error" as const, message: m });
      if (!txt(v.doc) && !name) return fail("Falta el documento o el nombre del cliente");
      if (!(amount && amount > 0)) return fail("El valor debe ser mayor que cero");
      const due = toIsoDate(v.due);
      if (due === "x") return fail("El vencimiento debe ser DD/MM/AAAA");
      const keys = docKeys(v.doc);
      const party = keys.map((k) => byDoc.get(k)).find(Boolean) ?? (keys.length ? undefined : byName.get(fold(name)));
      const number = up(v.number);
      const dupKey = `${party ? party.id : keys[0] ?? fold(name)}|${number}`;
      if (number && seen.has(dupKey)) return fail("Ese número está repetido en el archivo para el mismo cliente");
      if (number) seen.add(dupKey);
      const data: Row = { amount, due, number: number || null, desc: txt(v.desc) || "Saldo inicial importado", customer_id: party ? String(party.id) : null,
        new_customer: party ? null : { name, document_number: keys[0] ? (/-\s*\d$/.test(txt(v.doc)) ? docKey(txt(v.doc).replace(/-\s*\d$/, "")) : keys[0]) : null } };
      if (party && number && have.has(`${party.id}|${number}`)) return { ...p, label: String(party.name), action: "skip", message: `Ya está cargado (${number})`, data };
      if (!party) {
        if (!name) return fail("Ese cliente no existe: agrega la columna «Cliente» con el nombre para crearlo, o súbelo primero en Terceros");
        if (!canCreate) return fail("Ese cliente no existe y no tienes permiso para crear terceros");
        return { ...p, message: `Nuevo cliente y saldo de ${money(amount)}${due ? "" : " (vence según su plazo)"}`, data };
      }
      return { ...p, label: String(party.name), message: `Saldo de ${money(amount)}${number ? ` · ${number}` : " · sin número (si importas otra vez se repite)"}`, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    // Primero los clientes nuevos (uno por documento/nombre, aunque tengan varias filas).
    const pending = new Map<string, Prepared[]>();
    for (const r of rows.filter((x) => x.action === "create" && !x.data.customer_id)) {
      const nc = r.data.new_customer as { name: string; document_number: string | null };
      const k = nc.document_number ?? `n:${fold(nc.name)}`;
      pending.set(k, [...(pending.get(k) ?? []), r]);
    }
    for (const [, list] of pending) {
      const nc = list[0].data.new_customer as { name: string; document_number: string | null };
      const { data, error } = await sb().from("billing_customers").insert({ store_id: ctx.storeId, name: nc.name, document_number: nc.document_number, document_type: nc.document_number && /^(8|9)\d{8}$/.test(nc.document_number) ? "NIT" : "CC", kinds: ["customer"], price_list: 3, active: true, country: "Colombia" }).select("id").single();
      if (error) { for (const r of list) res.failed.push({ line: r.line, label: r.label, error: `No se pudo crear el cliente: ${error.message}` }); continue; }
      for (const r of list) r.data.customer_id = String((data as Row).id);
    }
    await pool(rows.filter((r) => r.action === "create" && r.data.customer_id), 3, async (r) => {
      const { error } = await sb().rpc("erp_receivable_manual", { p_customer: r.data.customer_id, p_amount: r.data.amount, p_due: r.data.due, p_description: r.data.desc, p_doc: r.data.number });
      if (error) res.failed.push({ line: r.line, label: r.label, error: errText(error) }); else res.done++;
    }, ctx.step, "Cargando cartera");
    return res;
  },
};

// ------------------------------------------------------------------ Cuentas por pagar iniciales
const pagar: ImportDef = {
  key: "pagar", icon: "🧾", title: "Cuentas por pagar iniciales", perms: ["payables"],
  detail: "Lo que les debes a tus proveedores de antes de usar RemHub. Si el proveedor no existe y viene el nombre, se crea.",
  columns: [
    col("name", "Proveedor", ["nombre", "razon social", "nombre del proveedor"]),
    col("nit", "NIT", ["documento", "identificacion", "nit cc"]),
    col("amount", "Valor", ["saldo", "debo", "monto", "total"], { required: true }),
    col("due", "Vence", ["vencimiento", "fecha de vencimiento"], { hint: "DD/MM/AAAA" }),
    col("ref", "Referencia", ["factura", "numero", "numero de factura", "factura del proveedor"], { hint: "Con referencia no se duplica si importas otra vez" }),
    col("notes", "Nota", ["notas", "descripcion", "concepto"]),
  ],
  sample: [["IMPORTADORA ABC S.A.S.", "900123456", 1200000, "15/11/2026", "FV-5521", "Saldo de antes de RemHub"]],
  async prepare(rows, ctx) {
    ctx.step("Revisando proveedores y deudas con la base…");
    const sups = await all((a, b) => sb().from("erp_suppliers").select("id,name,nit").eq("store_id", ctx.storeId).order("id").range(a, b));
    const byKey = new Map<string, Row>();
    for (const e of sups) { for (const k of docKeys(e.nit)) byKey.set(k, e); byKey.set(`n:${fold(e.name)}`, e); }
    const test = await sb().from("erp_payables").select("supplier_id,reference,status").eq("store_id", ctx.storeId).limit(1);
    if (test.error && /reference/i.test(test.error.message)) throw new Error("Falta ejecutar en Supabase la migración 20261239_importar_datos.sql.");
    const pays = await all((a, b) => sb().from("erp_payables").select("supplier_id,reference,status").eq("store_id", ctx.storeId).neq("status", "void").order("supplier_id").range(a, b));
    const have = new Set(pays.filter((r) => txt(r.reference)).map((r) => `${r.supplier_id}|${txt(r.reference)}`));
    const seen = new Set<string>();
    return rows.map(({ line, v }) => {
      const amount = toNumber(v.amount);
      const name = up(v.name);
      const p: Prepared = { line, label: name || txt(v.nit) || "(sin proveedor)", detail: amount ? money(amount) : "", action: "create", message: "", data: {} };
      const fail = (m: string) => ({ ...p, action: "error" as const, message: m });
      if (!name && !txt(v.nit)) return fail("Falta el proveedor (nombre o NIT)");
      if (!(amount && amount > 0)) return fail("El valor debe ser mayor que cero");
      const due = toIsoDate(v.due);
      if (due === "x") return fail("El vencimiento debe ser DD/MM/AAAA");
      const keys = [...docKeys(v.nit), ...(name ? [`n:${fold(name)}`] : [])];
      const sup = keys.map((k) => byKey.get(k)).find(Boolean);
      const ref = txt(v.ref);
      const dupKey = `${sup ? sup.id : keys[0]}|${ref}`;
      if (ref && seen.has(dupKey)) return fail("Esa referencia está repetida en el archivo para el mismo proveedor");
      if (ref) seen.add(dupKey);
      const data: Row = { amount, due, ref: ref || null, notes: txt(v.notes) || "Saldo inicial importado", supplier_id: sup ? String(sup.id) : null,
        new_supplier: sup ? null : { name, nit: txt(v.nit) ? docKey(txt(v.nit).replace(/-\s*\d$/, "")) : null } };
      if (sup && ref && have.has(`${sup.id}|${ref}`)) return { ...p, label: String(sup.name), action: "skip", message: `Ya está cargada (${ref})`, data };
      if (!sup) {
        if (!name) return fail("Ese proveedor no existe: agrega la columna «Proveedor» con el nombre para crearlo");
        if (!ctx.can("suppliers")) return fail("Ese proveedor no existe y no tienes permiso para crear proveedores");
        return { ...p, message: `Nuevo proveedor y deuda de ${money(amount)}`, data };
      }
      return { ...p, label: String(sup.name), message: `Deuda de ${money(amount)}${ref ? ` · ${ref}` : " · sin referencia (si importas otra vez se repite)"}`, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    const pending = new Map<string, Prepared[]>();
    for (const r of rows.filter((x) => x.action === "create" && !x.data.supplier_id)) {
      const ns = r.data.new_supplier as { name: string; nit: string | null };
      const k = ns.nit ?? `n:${fold(ns.name)}`;
      pending.set(k, [...(pending.get(k) ?? []), r]);
    }
    for (const [, list] of pending) {
      const ns = list[0].data.new_supplier as { name: string; nit: string | null };
      const { data, error } = await sb().from("erp_suppliers").insert({ store_id: ctx.storeId, name: ns.name, nit: ns.nit, payment_days: 0 }).select("id").single();
      if (error) { for (const r of list) res.failed.push({ line: r.line, label: r.label, error: `No se pudo crear el proveedor: ${error.message}` }); continue; }
      for (const r of list) r.data.supplier_id = String((data as Row).id);
    }
    await pool(rows.filter((r) => r.action === "create" && r.data.supplier_id), 3, async (r) => {
      const { data, error } = await sb().rpc("erp_payable_opening", { p_store: ctx.storeId, p_supplier: r.data.supplier_id, p_amount: r.data.amount, p_due: r.data.due, p_reference: r.data.ref, p_notes: r.data.notes });
      if (error) res.failed.push({ line: r.line, label: r.label, error: errText(error) });
      else if ((data as { duplicate?: boolean } | null)?.duplicate) res.skipped++;
      else res.done++;
    }, ctx.step, "Cargando cuentas por pagar");
    return res;
  },
};

// ------------------------------------------------------------------ Conteo de inventario
const conteo: ImportDef = {
  key: "conteo", icon: "🔢", title: "Conteo de inventario", perms: ["inventory_adjust"], needsWarehouse: true,
  detail: "Sube lo que contaste en un punto o bodega: RemHub deja las unidades exactas con un ajuste (queda en el kardex y la auditoría). Los productos que no vengan en el archivo no se tocan.",
  columns: [
    col("sku", "Referencia", ["codigo", "ref", "sku", "codigo interno"]),
    col("barcode", "Código de barras", ["barras", "codigo de barras", "ean"]),
    col("name", "Producto", ["nombre", "descripcion"]),
    col("qty", "Unidades contadas", ["unidades", "cantidad", "conteo", "contado", "existencias", "stock"], { required: true }),
  ],
  sample: [["PB-01", "7701234567890", "PARLANTE BLUETOOTH", 8], ["CB-C1", "", "CABLE USB TIPO C", 47]],
  async prepare(rows, ctx) {
    if (!ctx.opts.warehouseId) throw new Error("Escoge el punto o bodega que contaste.");
    ctx.step("Buscando productos y existencias…");
    const prods = await all((a, b) => sb().from("products").select("id,name,sku,barcode").eq("store_id", ctx.storeId).order("id").range(a, b));
    const bySku = new Map<string, Row>(), byBar = new Map<string, Row>(), byName = new Map<string, Row[]>();
    for (const p of prods) {
      if (txt(p.sku)) bySku.set(cleanProductCode(String(p.sku)) ?? "", p);
      if (txt(p.barcode)) byBar.set(txt(p.barcode), p);
      const f = fold(p.name); byName.set(f, [...(byName.get(f) ?? []), p]);
    }
    const levels = await all((a, b) => sb().from("erp_stock_levels").select("product_id,qty").eq("store_id", ctx.storeId).eq("warehouse_id", ctx.opts.warehouseId).order("product_id").range(a, b));
    const qtyOf = new Map(levels.map((l) => [String(l.product_id), Number(l.qty ?? 0)]));
    const seen = new Set<string>();
    return rows.map(({ line, v }) => {
      const qty = toNumber(v.qty);
      const p: Prepared = { line, label: up(v.name) || txt(v.sku) || txt(v.barcode), detail: "", action: "update", message: "", data: {} };
      const fail = (m: string) => ({ ...p, action: "error" as const, message: m });
      if (qty === null || qty < 0 || !Number.isInteger(qty)) return fail("Las unidades deben ser un número entero de 0 en adelante");
      let prod = (txt(v.sku) && bySku.get(cleanProductCode(txt(v.sku)) ?? "")) || (txt(v.barcode) && byBar.get(txt(v.barcode))) || undefined;
      if (!prod && txt(v.name)) {
        const list = byName.get(fold(v.name)) ?? [];
        if (list.length > 1) return fail("Hay varios productos con ese nombre: pon la referencia");
        prod = list[0];
      }
      if (!prod) return fail("No encontré ese producto (revisa la referencia o el código de barras)");
      const id = String(prod.id);
      if (seen.has(id)) return fail("Ese producto está repetido en el archivo");
      seen.add(id);
      const before = qtyOf.get(id) ?? 0;
      const diff = qty - before;
      const data = { product_id: id, qty_after: qty, before };
      const out = { ...p, label: String(prod.name), detail: `${before} → ${qty}` };
      if (diff === 0) return { ...out, action: "skip", message: "Igual a lo que hay", data };
      return { ...out, message: diff > 0 ? `Suben ${diff}` : `Bajan ${-diff}`, data };
    });
  },
  async apply(rows, ctx) {
    const res: Result = { done: 0, skipped: rows.filter((r) => r.action === "skip").length, failed: [] };
    const items = rows.filter((r) => r.action === "update");
    for (let i = 0; i < items.length; i += 200) {
      ctx.step(`Ajustando ${Math.min(i + 200, items.length)} de ${items.length}…`);
      const part = items.slice(i, i + 200);
      const { error } = await sb().rpc("erp_post_adjustment", {
        p_store: ctx.storeId, p_warehouse: ctx.opts.warehouseId, p_reason: "count",
        p_notes: `Conteo importado desde ${ctx.fileName}${items.length > 200 ? ` (parte ${i / 200 + 1})` : ""}`,
        p_items: part.map((r) => ({ product_id: r.data.product_id, qty_after: r.data.qty_after })),
      });
      if (error) for (const r of part) res.failed.push({ line: r.line, label: r.label, error: errText(error) });
      else res.done += part.length;
    }
    return res;
  },
};

// ------------------------------------------------------------------ Productos (pantalla propia)
const productos: ImportDef = {
  key: "productos", icon: "📦", title: "Productos", perms: ["products"], link: "/dashboard/products/importar",
  detail: "Nombre, referencia, código de barras, categoría, los 5 precios, unidades y costo (las unidades entran como ingreso de factura).",
  columns: [], sample: [], prepare: async () => [], apply: async () => ({ done: 0, skipped: 0, failed: [] }),
};

export const IMPORTS: ImportDef[] = [productos, terceros, proveedores, categorias, cartera, pagar, conteo];
