// Pruebas de 20261347: plantillas de etiquetas, versiones, impresoras e historial, aisladas por tienda.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = `
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x));
$$;
grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_etiquetas_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
const mig = fs.readFileSync(path.join(here, "migraciones", "20261347_etiquetas.sql"), "utf8");
await db.exec(mig);
await db.exec(mig);

const U = (n) => `a2400000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), EDITOR = U(2), VIEWER = U(3), BODEGA = U(4), NADIE = U(5), OTRA = U(6);
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 300) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const err = async (u, s, p) => { try { await as(u, s, p); return null; } catch (e) { return e.message; } };

const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('etq-a', 'LA VITRINA', $1) returning id", [OWNER]);
const [{ id: B }] = await raw("insert into stores (slug, name, owner_id) values ('etq-b', 'OTRA', $1) returning id", [OTRA]);
await raw(`insert into store_users (store_id, user_id, role, permissions, display_name) values
  ($1, $2, 'seller', '{products}', 'Editor'), ($1, $3, 'seller', '{products_view}', 'Mira'), ($1, $4, 'seller', '{inventory}', 'Bodega'), ($1, $5, 'seller', '{orders}', 'Nadie')`,
  [A, EDITOR, VIEWER, BODEGA, NADIE]);
const design = (n) => JSON.stringify({ v: 1, w: 31, h: 25, elements: [{ id: "t", type: "text", content: `v${n}` }] });

console.log("Plantillas");
const [{ id: T }] = await as(EDITOR, "insert into label_templates (store_id, name, design) values ($1, 'QR con referencia', $2::jsonb) returning id", [A, design(1)]);
ok(Boolean(T), "Quien edita productos guarda una plantilla");
ok(/row-level security/.test(await err(VIEWER, "insert into label_templates (store_id, name, design) values ($1, 'x', $2::jsonb)", [A, design(1)]) ?? ""), "Quien solo ve la lista no crea plantillas");
ok((await as(VIEWER, "select id from label_templates where store_id = $1", [A])).length === 1, "…pero sí las usa para imprimir");
ok((await as(NADIE, "select id from label_templates")).length === 0, "Sin permiso de productos no las ve");
ok((await as(OTRA, "select id from label_templates")).length === 0, "Otra tienda no las ve");
ok(/row-level security/.test(await err(OTRA, "insert into label_templates (store_id, name, design) values ($1, 'x', $2::jsonb)", [A, design(1)]) ?? ""), "Otra tienda no crea en esta");
ok(/row-level security/.test(await err(EDITOR, "insert into label_templates (store_id, name, design, created_by) values ($1, 'x', $2::jsonb, $3)", [A, design(1), OWNER]) ?? ""), "No se crea a nombre de otra persona");
ok((await as(VIEWER, "update label_templates set name = 'hackeada' where id = $1 returning id", [T])).length === 0, "Quien solo ve no la cambia");
ok(/check constraint|violates/.test(await err(EDITOR, "insert into label_templates (store_id, name, design) values ($1, 'grande', $2::jsonb)", [A, JSON.stringify({ x: "a".repeat(800000) })]) ?? ""), "Un diseño enorme se rechaza");

console.log("Versiones");
await as(EDITOR, "update label_templates set design = $2::jsonb where id = $1", [T, design(2)]);
let v = await raw("select version from label_templates where id = $1", [T]);
let vers = await as(EDITOR, "select version, design->'elements'->0->>'content' c from label_template_versions where template_id = $1 order by version", [T]);
ok(v[0].version === 2 && vers.length === 1 && vers[0].c === "v1", "Al guardar, la versión anterior queda para recuperarla", vers);
await as(EDITOR, "update label_templates set favorite = true where id = $1", [T]);
ok((await raw("select count(*)::int n from label_template_versions where template_id = $1", [T]))[0].n === 1, "Marcar favorita no crea versión");
for (let i = 3; i <= 40; i++) await as(EDITOR, "update label_templates set design = $2::jsonb where id = $1", [T, design(i)]);
vers = await raw("select version from label_template_versions where template_id = $1 order by version", [T]);
ok(vers.length === 30 && vers[29].version === 39, "Se guardan las últimas 30 versiones", vers.length);
ok((await as(VIEWER, "select id from label_template_versions")).length === 0, "Las versiones las ve quien edita, no quien solo imprime");
ok(/otra tienda/.test(await err(EDITOR, "update label_templates set store_id = $2 where id = $1", [T, B]) ?? "") || /row-level/.test(await err(EDITOR, "update label_templates set store_id = $2 where id = $1", [T, B]) ?? ""), "Una plantilla no se pasa a otra tienda");

console.log("Predeterminada");
const [{ id: T2 }] = await as(EDITOR, "insert into label_templates (store_id, name, design) values ($1, 'Precio', $2::jsonb) returning id", [A, design(1)]);
await as(EDITOR, "select label_set_default('template', $1)", [T]);
await as(EDITOR, "select label_set_default('template', $1)", [T2]);
const defs = await raw("select id from label_templates where store_id = $1 and is_default", [A]);
ok(defs.length === 1 && defs[0].id === T2, "Una sola predeterminada por tienda");
ok(/permiso/.test(await err(VIEWER, "select label_set_default('template', $1)", [T]) ?? ""), "Quien solo ve no cambia la predeterminada");
ok(/permiso/.test(await err(OTRA, "select label_set_default('template', $1)", [T]) ?? ""), "Otra tienda tampoco");

console.log("Impresoras");
const prof = JSON.stringify({ name: "STARPOS", cols: 3, labelW: 31 });
const [{ id: P }] = await as(BODEGA, "insert into label_printer_profiles (store_id, name, profile) values ($1, 'STARPOS iF4', $2::jsonb) returning id", [A, prof]);
ok(Boolean(P), "La bodega (inventario) guarda su impresora");
ok(/row-level security/.test(await err(VIEWER, "insert into label_printer_profiles (store_id, name, profile) values ($1, 'x', $2::jsonb)", [A, prof]) ?? ""), "Quien solo ve no crea impresoras");
await as(BODEGA, "select label_set_default('profile', $1)", [P]);
ok((await as(VIEWER, "select is_default from label_printer_profiles"))[0]?.is_default === true, "Todos ven la impresora predeterminada");
ok((await as(OTRA, "select id from label_printer_profiles")).length === 0, "Otra tienda no la ve");

console.log("Historial");
await as(VIEWER, "insert into label_print_jobs (store_id, template_name, profile_name, items, total_labels, method) values ($1, 'QR', 'STARPOS', '[{\"product_id\":\"x\",\"qty\":10}]', 10, 'dialog')", [A]);
ok((await as(EDITOR, "select user_id from label_print_jobs"))[0]?.user_id === VIEWER, "Queda quién mandó a imprimir");
ok(/row-level security/.test(await err(VIEWER, "insert into label_print_jobs (store_id, user_id, template_name, profile_name, items, total_labels, method) values ($1, $2, 'QR', 'S', '[]', 1, 'dialog')", [A, EDITOR]) ?? ""), "No se registra a nombre de otro");
ok(/violates check|check constraint/.test(await err(VIEWER, "insert into label_print_jobs (store_id, template_name, profile_name, items, total_labels, method) values ($1, 'QR', 'S', '[]', 1, 'impresa_ok')", [A]) ?? ""), "No se puede marcar como «salió bien en papel»");
ok((await as(OTRA, "select id from label_print_jobs")).length === 0, "Otra tienda no ve el historial");
ok(/permission denied/.test(await err(VIEWER, "update label_print_jobs set total_labels = 1") ?? ""), "El historial no se edita");

console.log(`\n${pass} ✔  ${fail} ✘`);
process.exit(fail ? 1 : 0);
