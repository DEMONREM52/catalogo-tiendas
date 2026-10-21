// Pruebas de 20261219: con el enlace del traslado se ven los precios del punto que recibe, sin sesión.
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
alter table public.erp_transfers add column if not exists track_token text;
alter table public.erp_transfers add column if not exists track_expires_at timestamptz;
alter table public.erp_warehouses add column if not exists phone text;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
grant usage on schema public to anon;
`;
const combined = path.join(os.tmpdir(), `remhub_ptp_${process.pid}.sql`);
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
const M = fs.readFileSync(path.join(MIG, "20261219_precios_traslado_publico.sql"), "utf8");
await db.exec(M);
await db.exec(M);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function anon(s, p) {
  await db.query("select set_config('test.uid', '', false)");
  await db.exec("set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); }
}
const U = (n) => `cf000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const B1 = (await raw("select public.erp_ensure_default_warehouse($1) id", [A]))[0].id;
const [{ id: Z }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Z', 'ZAMORA', true, 'point') returning id", [A]);
const [{ id: Y }] = await raw("insert into erp_warehouses (store_id, code, name, active, kind) values ($1, 'Y', 'OTRO', true, 'point') returning id", [A]);
const prod = async (n, p2, p3) => (await raw("insert into products (store_id, name, sku, stock, cost_price, price_2, price_3) values ($1, $2, $2, 0, 1000, $3, $4) returning id", [A, n, p2, p3]))[0].id;
const P = await prod("OLLA", 20000, 25000), Q = await prod("BATIDORA", 10000, 12000), N = await prod("NO VA", 5000, 6000);
for (const p of [P, Q]) await raw("select public.erp__move($1, $2, $3, 20, 'purchase', 'test', null, 1000, 'carga', null, true)", [A, B1, p]);
await raw("insert into erp_price_rules (store_id, point_id, scope, kind, value, status, reason, valid_from) values ($1, $2, 'point', 'pct', 15, 'active', 'margen 15', now() - interval '1 day')", [A, Z]);
await raw("insert into erp_price_rules (store_id, point_id, scope, product_id, kind, value, status, reason, valid_from) values ($1, $2, 'product', $3, 'fixed', 11000, 'active', 'fijo', now() - interval '1 day')", [A, Z, Q]);

await db.query("select set_config('test.uid', $1, false)", [OWNER]);
const T1 = (await raw("select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Z, JSON.stringify([{ product_id: P, qty: 5 }, { product_id: Q, qty: 3 }])]))[0].id;
const T2 = (await raw("select public.erp_create_transfer($1, $2, $3, 'x', $4::jsonb) id", [A, B1, Y, JSON.stringify([{ product_id: P, qty: 1 }])]))[0].id;
await db.query("select set_config('test.uid', '', false)");
await raw("update erp_transfers set track_token = 'tok-zamora-123', track_expires_at = now() + interval '7 days' where id = $1", [T1]);
await raw("update erp_transfers set track_token = 'tok-otro-456', track_expires_at = now() + interval '7 days' where id = $1", [T2]);

const rows = await anon("select * from public.erp_transfer_track_prices('tok-zamora-123')");
const by = new Map(rows.map((r) => [r.product_id, r]));
ok(rows.length === 2, "Sin sesión, con el enlace: trae los 2 productos del traslado", rows);
ok(Number(by.get(P)?.price_2) === 23000, "Precio por mayor del punto que recibe: 20.000 + 15 % = 23.000", by.get(P));
ok(Number(by.get(P)?.price_3) === 28750, "Precio detal del punto también con su regla", by.get(P));
ok(Number(by.get(Q)?.price_2) === 11000, "La regla del producto gana a la del punto (fijo 11.000)", by.get(Q));
ok(by.get(P)?.sku === "OLLA", "Incluye la referencia");
ok(!rows.some((r) => r.product_id === N), "Solo productos de ese traslado");
ok(!Object.keys(rows[0] ?? {}).some((k) => /cost/i.test(k)), "Nunca entrega costos", Object.keys(rows[0] ?? {}));

const other = await anon("select * from public.erp_transfer_track_prices('tok-otro-456')");
ok(Number(other[0]?.price_2) === 20000, "Punto sin regla: precio de la tienda madre", other);
ok((await anon("select * from public.erp_transfer_track_prices('no-existe-999')")).length === 0, "Enlace inventado: nada");
ok((await anon("select * from public.erp_transfer_track_prices(null)")).length === 0, "Sin enlace: nada");

await raw("update erp_transfers set track_expires_at = now() - interval '1 day' where id = $1", [T1]);
ok((await anon("select * from public.erp_transfer_track_prices('tok-zamora-123')")).length === 0, "Enlace vencido en tránsito: nada");
await raw("update erp_transfers set status = 'received' where id = $1", [T1]);
ok((await anon("select * from public.erp_transfer_track_prices('tok-zamora-123')")).length === 2, "Ya recibido: el enlace sigue mostrando la hoja con precios");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
