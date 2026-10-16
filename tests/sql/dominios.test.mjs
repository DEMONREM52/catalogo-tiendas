// Pruebas de 20261129: dominio propio de cada tienda.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_dom_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), fs.readFileSync(path.join(MIG, "20261129_dominios_tiendas.sql"), "utf8")].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: true });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role = "authenticated") {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p, role) => { try { await as(u, s, p, role); return null; } catch (e) { return e.message; } };

const U = (n) => `cd000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), OWNER2 = U(2), VEND = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('mitienda', 'MI TIENDA', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [OWNER2]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [A, VEND]);

const add = (u, store, d, t = "detal") => as(u, "select public.store_domain_add($1, $2, $3) r", [store, d, t]);
ok((await add(OWNER, A, "  HTTPS://Catalogo.MiTienda.com/inicio?x=1 "))[0].r.domain === "catalogo.mitienda.com", "Limpia lo que escriban (https, mayúsculas, ruta)");
ok(/Mi tienda/.test((await err(VEND, "select public.store_domain_add($1, 'x.com', 'detal')", [A])) ?? ""), "Sin «Mi tienda» no agrega dominios");
ok(/otra tienda/.test((await err(OWNER2, "select public.store_domain_add($1, 'catalogo.mitienda.com', 'detal')", [B])) ?? ""), "Un dominio es de una sola tienda");
ok(/no se puede usar/.test((await err(OWNER, "select public.store_domain_add($1, 'falso.remhub.co', 'detal')", [A])) ?? ""), "Nadie usa dominios de RemHub");
ok(/válido/.test((await err(OWNER, "select public.store_domain_add($1, 'no es dominio', 'detal')", [A])) ?? ""), "Valida el formato");
ok((await as(null, "select public.store_domain_resolve('catalogo.mitienda.com') r", [], "anon"))[0].r.slug === "mitienda", "Público: el dominio abre la tienda correcta");
ok((await as(null, "select public.store_public_domain('mitienda') r", [], "anon"))[0].r === null, "Mientras no esté verificado, Google sigue viendo remhub.co");
await raw("select public.store_domain_set_status('catalogo.mitienda.com', 'active', 'ok', null)");
ok((await as(null, "select public.store_public_domain('mitienda') r", [], "anon"))[0].r.domain === "catalogo.mitienda.com", "Verificado: Google ve el dominio de la tienda");
ok(/permission denied/.test((await err(OWNER, "select public.store_domain_set_status('catalogo.mitienda.com', 'active', null, null)")) ?? ""), "Solo el servidor marca verificado");
ok(/permission denied/.test((await err(OWNER, "select * from store_domains")) ?? ""), "La tabla no se lee directo");
const list = (await as(OWNER, "select public.store_domain_list($1) r", [A]))[0].r;
ok(list.ok && list.slug === "mitienda" && list.domains.length === 1 && list.domains[0].is_primary, "El dueño ve su dominio como principal");
await add(OWNER, A, "mitienda.com");
await as(OWNER, "select public.store_domain_set_primary($1, 'mitienda.com')", [A]);
ok((await as(OWNER, "select public.store_domain_list($1) r", [A]))[0].r.domains.find((d) => d.domain === "mitienda.com").is_primary, "Puede escoger cuál es el principal");
await as(OWNER, "select public.store_domain_remove($1, 'mitienda.com')", [A]);
ok((await as(OWNER, "select public.store_domain_list($1) r", [A]))[0].r.domains[0].is_primary, "Al quitar el principal, otro toma su lugar");
await raw("update stores set active = false where id = $1", [A]);
ok((await as(null, "select public.store_domain_resolve('catalogo.mitienda.com') r", [], "anon"))[0].r === null, "Tienda suspendida: el dominio deja de abrir");

console.log(`\n${pass} ok · ${fail} fallas`);
process.exit(fail ? 1 : 0);
