// Pruebas de 20261301 (código de tienda para el equipo). Base copiada de caja.test.mjs.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[])
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active
               and (su.role = 'store_admin' or su.permissions && p_perms)));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
alter table public.erp_order_meta add column if not exists payment jsonb;
`;
const combined = path.join(os.tmpdir(), `remhub_caja_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra,
  fs.readFileSync(path.join(MIG, "20261110_gastos_presupuestos_nomina.sql"), "utf8"),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `cd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), ADMIN = U(2), SELLER = U(3), OTHER = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('b', 'B', $1) returning id", [OTHER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'store_admin','{}')", [A, ADMIN]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'seller','{pos}')", [A, SELLER]);
await db.exec(fs.readFileSync(path.join(MIG, "20261301_codigo_tienda_equipo.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261301_codigo_tienda_equipo.sql"), "utf8")); // se puede correr dos veces

const save = (u, store, code) => as(u, "select public.erp_team_code_save($1, $2) r", [store, code]).then((r) => r[0].r);
ok((await save(OWNER, A, " 4821 ")).code === "4821", "El dueño pone el código (sin espacios)");
ok((await as(ADMIN, "select public.erp_team_code_get($1) c", [A]))[0].c === "4821", "El administrador lo ve");
ok((await as(SELLER, "select public.erp_team_code_get($1) c", [A]))[0].c === null, "Un vendedor no lo ve");
ok(/dueño o un administrador/.test((await err(SELLER, "select public.erp_team_code_save($1, '9999')", [A])) ?? ""), "Un vendedor no lo cambia");
ok(/4 a 8 números/.test((await err(OWNER, "select public.erp_team_code_save($1, '12a4')", [A])) ?? ""), "Solo números");
ok(/4 a 8 números/.test((await err(OWNER, "select public.erp_team_code_save($1, '123')", [A])) ?? ""), "Mínimo 4");
ok(/menos fácil/.test((await err(OWNER, "select public.erp_team_code_save($1, '7777')", [A])) ?? ""), "No todos iguales");
ok(/fácil de adivinar/.test((await err(OWNER, "select public.erp_team_code_save($1, '1234')", [A])) ?? ""), "No 1234");
ok(/ya lo usa otra tienda/.test((await err(OTHER, "select public.erp_team_code_save($1, '4821')", [B])) ?? ""), "Único entre tiendas");
ok((await save(ADMIN, A, "")).code === null, "Vacío lo quita");
ok((await raw("select team_code from stores where id = $1", [A]))[0].team_code === null, "Queda sin código");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
