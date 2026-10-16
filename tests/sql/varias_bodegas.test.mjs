// Pruebas de 20261126: crédito en traslados con varias bodegas y varios puntos.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
  signer_name text, notes text, via text, user_id uuid, created_at timestamptz default now(), unique (transfer_id, step));
alter table public.erp_transfers add column if not exists checked_by_name text;
alter table public.erp_warehouses add column if not exists phone text;
`;
const combined = path.join(os.tmpdir(), `remhub_vb_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M26 = fs.readFileSync(path.join(MIG, "20261126_varias_bodegas.sql"), "utf8");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `ca000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), CIS = U(2);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const wh = async (code, kind) => (await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, $2, $2, true, $3) returning id", [A, code, kind]))[0].id;
const B2 = await wh("BODEGA 2", "warehouse"), B3 = await wh("BODEGA 3", "warehouse");
const C = await wh("CISNEROS", "point"), Z = await wh("ZAMORA", "point");
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{transfers,internal_credit}',$3)", [A, CIS, C]);
const [{ id: P }] = await raw("insert into products (store_id, name, stock, cost_price) values ($1, 'OLLAS', 0, 18000) returning id", [A]);
for (const w of [B1, B2]) await raw("select public.erp__move($1, $2, $3, 100, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, w, P]);
const send = async (from, to, qty) => {
  const [{ id }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, from, to, JSON.stringify([{ product_id: P, qty }])]);
  await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [id]);
  return id;
};
for (const p of [C, Z]) await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, p]);

// Un traslado de antes de esta migración (desde la bodega 2).
const t0 = await send(B2, C, 2);

console.log("1. Migración");
await db.exec(M26);
await db.exec(M26);
ok((await raw("select creditor_id from erp_internal_docs where transfer_id = $1", [t0]))[0].creditor_id === B2, "Lo que ya existía queda con la bodega de donde salió");
ok((await raw("select count(*)::int n from pg_proc where proname = 'erp_internal_doc_add'"))[0].n === 1, "No quedan dos versiones de las funciones");

console.log("2. Dos bodegas le prestan al mismo punto");
await send(B1, C, 10);
await send(B2, C, 5);
const s1 = (await raw("select public.erp__internal_summary($1, $2) r", [A, C]))[0].r;
const by = (s, w) => s.by_creditor.find((x) => x.creditor_id === w)?.balance ?? 0;
ok(by(s1, B1) === 10 * 20700 && by(s1, B2) === 7 * 20700 && s1.balance === 17 * 20700, "Cisneros le debe $207.000 a la principal y $144.900 a la bodega 2", s1.by_creditor);

console.log("3. Abonos, devoluciones y deuda inicial por bodega");
await as(OWNER, "select public.erp_internal_payment_add($1, $2, 100000, 'cash', null, null, null, $3)", [A, C, B2]);
const s2 = (await raw("select public.erp__internal_summary($1, $2) r", [A, C]))[0].r;
ok(by(s2, B2) === 44900 && by(s2, B1) === 207000, "El abono baja solo la deuda con la bodega 2", s2.by_creditor);
await as(OWNER, "select public.erp_internal_payment_add($1, $2, 7000, 'cash', null, null, null)", [A, C]);
ok(by((await raw("select public.erp__internal_summary($1, $2) r", [A, C]))[0].r, B1) === 200000, "Sin escoger bodega, el abono va a la principal");
const [{ id: tr }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, C, B2, JSON.stringify([{ product_id: P, qty: 1 }])]);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr]);
ok(by((await raw("select public.erp__internal_summary($1, $2) r", [A, C]))[0].r, B2) === 44900 - 20700, "Devolver a la bodega 2 baja la deuda con la bodega 2");
await raw("select public.erp__move($1, $2, $3, 4, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, Z, P]);
await as(OWNER, "select public.erp_internal_opening_from_stock($1, $2, null, null, $3)", [A, Z, B3]);
ok((await raw("select creditor_id from erp_internal_docs where point_id = $1 and kind = 'opening'", [Z]))[0].creditor_id === B3, "Deuda inicial de Zamora con la bodega 3");
ok(/no es válida/.test((await err(OWNER, "select public.erp_internal_doc_add($1, $2, 'charge', 1000, null, 'x', $3)", [A, C, Z])) ?? ""), "Un punto con crédito no puede ser «la bodega que presta»");
ok(/no es válida/.test((await err(OWNER, "select public.erp_internal_doc_add($1, $2, 'charge', 1000, null, 'x', $2)", [A, C])) ?? ""), "…ni el mismo punto");

console.log("4. Cadena principal → bodega 2 → punto");
await as(OWNER, "select public.erp_internal_point_save($1, $2, '{\"enabled\": true}'::jsonb)", [A, B3]);
await raw("select public.erp__move($1, $2, $3, 10, 'purchase', 'test', null, 18000, 'carga', null, true)", [A, B1, P]);
await send(B1, B3, 10);
ok((await raw("select public.erp__internal_summary($1, $2) r", [A, B3]))[0].r.balance === 207000, "La bodega 3 (con crédito) le debe a la principal");
await send(B3, C, 4);
ok((await raw("select public.erp__internal_summary($1, $2) r", [A, B3]))[0].r.balance === 207000 - 4 * 20700, "Al surtir a Cisneros, su deuda pasa a Cisneros");

console.log("5. Tablero e informe por bodega");
const board = (await as(OWNER, "select public.erp_internal_board($1) b", [A]))[0].b;
const names = board.creditors.map((x) => x.name);
ok(names.includes("Bodega principal") && names.includes("BODEGA 2") && !names.includes("BODEGA 3") && !names.includes("CISNEROS"), "Bodegas que pueden prestar: sin puntos ni bodegas con crédito", names);
const today = (await raw("select public.erp__internal_today()::text d"))[0].d;
const prof = (await as(OWNER, "select public.erp_internal_profit($1, $2::date - 30, $2::date) r", [A, today]))[0].r;
const pb = (w) => prof.by_creditor.find((x) => x.creditor_id === w);
ok(pb(B2).charged === 7 * 20700 && pb(B2).margin === 7 * 2700 && pb(B2).paid === 100000, "Bodega 2: trasladó $144.900, ganó $18.900, cobró $100.000", pb(B2));
const st = (await as(CIS, "select public.erp_internal_statement($1, $2) r", [A, C]))[0].r;
ok(st.moves.some((m) => m.creditor === "BODEGA 2") && st.moves.some((m) => m.creditor === "Bodega principal"), "El estado de cuenta dice a qué bodega va cada movimiento");

console.log("6. Resumen diario de deudas vencidas");
const VEND = U(9);
await raw("insert into store_users (store_id, user_id, role, permissions, point_id) values ($1,$2,'seller','{pos}',$3)", [A, VEND, C]);
await raw("update erp_internal_docs set due_date = current_date - 3 where point_id = $1 and sign = 1", [C]);
const dig = await raw("select * from public.erp_internal_push_digest()");
const dOwner = dig.find((d) => d.user_id === OWNER), dCis = dig.find((d) => d.user_id === CIS);
ok(dOwner && dOwner.points >= 1 && dOwner.first_name === "CISNEROS", "La madre recibe el resumen de los puntos en mora", dOwner);
ok(dCis && dCis.points === 1 && Number(dCis.overdue) > 0, "Cisneros recibe solo lo suyo", dCis);
ok(!dig.some((d) => d.user_id === VEND), "Un vendedor sin el permiso no lo recibe");
ok(/permission denied/.test((await err(OWNER, "select * from public.erp_internal_push_digest()")) ?? ""), "Solo el servidor lo pide");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
