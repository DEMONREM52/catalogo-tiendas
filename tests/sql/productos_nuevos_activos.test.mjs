// Pruebas de 20261216: un producto nuevo queda activo aunque otro proceso intente desactivarlo.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_pna_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  // Simula el proceso de producción que desactiva productos sin unidades (al crear y al actualizar).
  `create or replace function public.prod_fake_auto_off() returns trigger language plpgsql security definer set search_path = public as $f$
   begin if coalesce(new.stock, 0) <= 0 then new.active := false; end if; return new; end $f$;
   create trigger trg_products_auto_deactivate_when_stock_zero before insert or update on public.products for each row execute function public.prod_fake_auto_off();
   grant insert, update, select on public.products to authenticated;
   alter table public.products disable row level security;`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const OWNER = "ce000000-0000-0000-0000-000000000001";
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('a', 'A', $1) returning id", [OWNER]);

const [{ id: P0 }] = await raw("insert into products (store_id, name, stock, active) values ($1, 'ANTES', 0, true) returning id", [A]);
ok((await raw("select active from products where id = $1", [P0]))[0].active === false, "Sin la migración, el proceso de producción lo desactiva (así pasaba)");

const out = await db.exec(fs.readFileSync(path.join(MIG, "20261216_productos_nuevos_activos.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261216_productos_nuevos_activos.sql"), "utf8"));
const list = out.at(-1).rows;
ok(list.some((r) => r.activador === "trg_products_auto_deactivate_when_stock_zero" && r.menciona_active), "La migración muestra qué activador tocaba «active»", list);

const [{ id: P }] = await as(OWNER, "insert into products (store_id, name, stock, active) values ($1, 'NUEVO', 0, true) returning id", [A]);
ok((await raw("select active from products where id = $1", [P]))[0].active === true, "Producto nuevo sin unidades: queda ACTIVO");
const [{ id: Q }] = await as(OWNER, "insert into products (store_id, name, stock, active) values ($1, 'APAGADO', 0, false) returning id", [A]);
ok((await raw("select active from products where id = $1", [Q]))[0].active === false, "Si la persona lo creó inactivo, se respeta");
await raw("update products set name = 'NUEVO 2' where id = $1", [P]);
ok((await raw("select active from products where id = $1", [P]))[0].active === true, "Un proceso automático no lo desactiva después");
await as(OWNER, "update products set active = false where id = $1", [P]);
ok((await raw("select active from products where id = $1", [P]))[0].active === false, "La persona sí puede desactivarlo cuando quiera");
await as(OWNER, "update products set active = true where id = $1", [P]);
await raw("update products set stock = 5 where id = $1", [P]);
await raw("update products set stock = 0 where id = $1", [P]);
ok((await raw("select active from products where id = $1", [P]))[0].active === false, "Si tenía unidades y se queda en 0, sí se desactiva (como pediste)");

console.log("Quitar el proceso viejo (20261218)");
await db.exec(fs.readFileSync(path.join(MIG, "20261210_productos_activos_por_unidades.sql"), "utf8"));
const out2 = await db.exec(fs.readFileSync(path.join(MIG, "20261218_quitar_desactivar_sin_stock.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261218_quitar_desactivar_sin_stock.sql"), "utf8"));
ok((await raw("select count(*)::int n from pg_trigger where tgname = 'trg_products_auto_deactivate_when_stock_zero'"))[0].n === 0, "El activador viejo ya no existe");
ok(out2.at(-1).rows.some((x) => x.name === "ANTES"), "Lista los productos que el proceso viejo apagó al crearlos", out2.at(-1).rows);
const [{ id: N }] = await as(OWNER, "insert into products (store_id, name, stock, active) values ($1, 'DESPUES', 0, true) returning id", [A]);
ok((await raw("select active from products where id = $1", [N]))[0].active === true, "Sin el proceso viejo, el producto nuevo queda activo");

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
