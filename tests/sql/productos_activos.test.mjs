// Pruebas de 20261210: productos nuevos activos sin unidades; se desactivan solos al quedar en 0 en todos lados.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const combined = path.join(os.tmpdir(), `remhub_pa_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create table if not exists public.erp_transfer_signatures (id uuid primary key default gen_random_uuid(), transfer_id uuid, store_id uuid, step text,
     signer_name text, notes text, via text, user_id uuid, created_at timestamptz default now(), unique (transfer_id, step));
   alter table public.erp_transfers add column if not exists checked_by_name text;`,
  crlf(fs.readFileSync(path.join(here, "fixtures/prod_traslados.sql"), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
// Buscador del panel simplificado con el mismo filtro de activos que producción (20261204).
await db.exec(`create or replace function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null, p_in_stock boolean default false)
  returns table (id uuid, name text) language sql stable security definer set search_path = public as $f$
  select p.id, p.name from public.products p
    where p.store_id = p_store and coalesce(p.active, true)
      and p.name ilike '%' || p_q || '%' $f$;
  grant execute on function public.erp_search_products(uuid, text, uuid, boolean) to authenticated;`);
const M = fs.readFileSync(path.join(MIG, "20261210_productos_activos_por_unidades.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
const st = async (id) => (await raw("select active, auto_inactive, stock from products where id = $1", [id]))[0];
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}

const OWNER = "cc000000-0000-0000-0000-000000000001";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'Z', true, 'point') returning id", [A]);
const mv = (w, p, d) => raw("select public.erp__move($1, $2, $3, $4, 'adjust', 'test', null, 1000, 'x', null, true)", [A, w, p, d]);

const [{ id: P }] = await raw("insert into products (store_id, name, stock, cost_price, active) values ($1, 'NUEVO', 0, 1000, true) returning id", [A]);
ok((await st(P)).active === true, "Un producto nuevo sin unidades queda activo");
await raw("update products set name = 'NUEVO 2' where id = $1", [P]);
ok((await st(P)).active === true, "Editarlo sin unidades no lo desactiva");

await mv(B1, P, 5);
await mv(Z, P, 3);
ok(n((await st(P)).stock) === 8 && (await st(P)).active, "Con unidades en bodega y punto sigue activo");
await mv(B1, P, -5);
ok((await st(P)).active === true, "Sin unidades en bodega pero con unidades en el punto: sigue activo");
await mv(Z, P, -3);
let s = await st(P);
ok(s.active === false && s.auto_inactive === true, "Sin unidades en ningún lado: se desactiva solo", s);
await mv(B1, P, 10);
s = await st(P);
ok(s.active === true && s.auto_inactive === false, "Le entran unidades: se activa solo", s);

// Desactivado a mano: no se reactiva solo.
await raw("update products set active = false where id = $1", [P]);
await mv(B1, P, -10);
await mv(B1, P, 4);
s = await st(P);
ok(s.active === false && s.auto_inactive === false, "Si lo desactivó una persona, no se activa solo", s);
await raw("update products set active = true where id = $1", [P]);
ok((await st(P)).active === true, "Activarlo a mano funciona");

// En camino: no se desactiva mientras viaja.
const [{ id: Q }] = await raw("insert into products (store_id, name, stock, cost_price, active) values ($1, 'VIAJERO', 0, 1000, true) returning id", [A]);
await mv(B1, Q, 2);
const [{ id: tr }] = await as(OWNER, "select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: Q, qty: 2 }])]);
s = await st(Q);
ok(s.active === true, "Con todo en camino (traslado sin recibir) sigue activo", s);
await as(OWNER, "select public.erp_confirm_transfer($1, null, 'ok')", [tr]);
ok((await st(Q)).active === true && n((await st(Q)).stock) === 2, "Al recibirlo sigue activo con sus unidades", await st(Q));

// Ilimitado: no se toca.
const [{ id: U }] = await raw("insert into products (store_id, name, stock, active) values ($1, 'SERVICIO', null, true) returning id", [A]);
await raw("update products set stock = null where id = $1", [U]);
ok((await st(U)).active === true, "Sin control de unidades no se toca");

// El buscador del panel encuentra el producto desactivado por falta de unidades.
await raw("update products set active = true where id = $1", [P]);
await mv(B1, P, -4);
const defs = await raw("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'erp_search_products'");
ok(defs.length > 0 && defs.every((r) => r.d.includes("or p.auto_inactive")), "El buscador del panel (ingreso de factura) también encuentra los agotados", defs.map((r) => r.d.slice(0, 80)));
const hit = await as(OWNER, "select id from public.erp_search_products($1::uuid, $2::text, $3::uuid, false) where id = $4", [A, "NUEVO", B1, P]).catch((e) => e.message);
ok(Array.isArray(hit) ? hit.length === 1 : /not unique/.test(hit), "…y lo devuelve aunque esté inactivo", hit);

function n(v) { return Number(v); }
console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
