// Pruebas de 20261217: corregir un traslado en tránsito mientras nadie lo haya revisado.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
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
const combined = path.join(os.tmpdir(), `remhub_et_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  fs.readFileSync(path.join(MIG, "20261106_rentabilidad_precios_punto.sql"), "utf8"),
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_finanzas.sql"), "utf8")),
  extra,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
  ...["20261124_credito_traslados.sql", "20261125_rentabilidad_cadena.sql", "20261126_varias_bodegas.sql"].map((f) => fs.readFileSync(path.join(MIG, f), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const M = fs.readFileSync(path.join(MIG, "20261217_editar_traslado.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const U = (n) => `cf000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Z', true, 'point') returning id", [A]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, SELLER]);
const prod = async (n) => (await raw("insert into products (store_id, name, stock, cost_price) values ($1, $2, 0, 1000) returning id", [A, n]))[0].id;
const P = await prod("OLLA"), Q = await prod("BATIDORA"), R = await prod("NUEVO");
for (const p of [P, Q, R]) await raw("select public.erp__move($1, $2, $3, 20, 'purchase', 'test', null, 1000, 'carga', null, true)", [A, B1, p]);
const qty = async (w, p) => Number((await raw("select qty from erp_stock_levels where warehouse_id = $1 and product_id = $2", [w, p]))[0]?.qty ?? 0);
const [{ id: T }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 5 }, { product_id: Q, qty: 3 }])]);
ok(await qty(B1, P) === 15 && await qty(B1, Q) === 17, "Al crear, salen 5 ollas y 3 batidoras de la bodega");

await raw("insert into erp_transfer_signatures (transfer_id, store_id, step, signer_name) values ($1, $2, 'packed', 'SARA')", [T, A]);
ok((await one(OWNER, "select public.erp_transfer_editable($1) r", [T])).editable === true, "Preparado firmado pero sin revisar: se puede cambiar");
ok((await one(SELLER, "select public.erp_transfer_update_items($1, $2::jsonb, 'x y z') r", [T, JSON.stringify([{ product_id: P, qty: 1 }])])).ok === false, "Sin permiso de traslados no se cambia");
ok((await one(OWNER, "select public.erp_transfer_update_items($1, $2::jsonb, '') r", [T, JSON.stringify([{ product_id: P, qty: 1 }])])).ok === false, "Sin motivo no se cambia");
const r1 = await one(OWNER, "select public.erp_transfer_update_items($1, $2::jsonb, 'se contó mal') r", [T, JSON.stringify([{ product_id: P, qty: 8 }, { product_id: R, qty: 2 }])]);
const items = await raw("select product_id, qty from erp_transfer_items where transfer_id = $1 order by qty", [T]);
ok(r1.ok && r1.packed_signature_removed === true, "Se cambia y la firma de «Preparado» se quita para volver a firmar", r1);
ok(await qty(B1, P) === 12 && await qty(B1, Q) === 20 && await qty(B1, R) === 18, "La bodega se ajusta solo por la diferencia", { P: await qty(B1, P), Q: await qty(B1, Q), R: await qty(B1, R) });
ok(items.length === 2 && items.some((i) => i.product_id === R && i.qty === 2), "La batidora se quitó y el producto nuevo quedó", items);
const tooMuch = await as(OWNER, "select public.erp_transfer_update_items($1, $2::jsonb, 'demasiado') r", [T, JSON.stringify([{ product_id: P, qty: 500 }])]).then(() => null).catch((e) => e.message);
ok(typeof tooMuch === "string" && /Stock insuficiente/.test(tooMuch) && await qty(B1, P) === 12, "No deja sacar más de lo que hay (y no cambia nada)", tooMuch);
ok((await one(OWNER, "select public.erp_transfer_update_items($1, $2::jsonb, 'vaciar') r", [T, JSON.stringify([{ product_id: P, qty: 0 }])])).ok === false, "No se puede dejar vacío (para eso se anula)");

await raw("insert into erp_transfer_signatures (transfer_id, store_id, step, signer_name) values ($1, $2, 'sent', 'JAVIER')", [T, A]);
ok((await one(OWNER, "select public.erp_transfer_editable($1) r", [T])).editable === false, "Con «Revisado» firmado ya no es editable");
const locked = await one(OWNER, "select public.erp_transfer_update_items($1, $2::jsonb, 'tarde') r", [T, JSON.stringify([{ product_id: P, qty: 1 }])]);
ok(locked.ok === false && /revisado/i.test(locked.error), "…y la base no deja cambiarlo", locked);

await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [T]);
ok(await qty(Z, P) === 8 && await qty(Z, R) === 2, "Al recibir llega lo corregido", { P: await qty(Z, P), R: await qty(Z, R) });

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
