// Pruebas de 20261236: las vistas viejas dejan de saltarse el candado y no se leen desde la página.
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const extra = `
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
grant usage on schema public to anon, service_role;
create table public.secreto (id serial primary key, store text, total numeric);
alter table public.secreto enable row level security;
insert into public.secreto (store, total) values ('A', 100), ('B', 200);
create view public.vw_cash_receipts_export as select * from public.secreto;
grant select on public.vw_cash_receipts_export to anon, authenticated;
`;
const combined = path.join(os.tmpdir(), `remhub_vw_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const asAnon = async (s) => { await db.exec("set role anon"); try { return { rows: (await db.query(s)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role"); } };

ok((await asAnon("select count(*)::int n from public.vw_cash_receipts_export")).rows?.[0].n === 2, "Antes: sin sesión la vista mostraba todo (se saltaba el candado)");
const M = fs.readFileSync(path.join(MIG, "20261236_vistas_viejas_seguras.sql"), "utf8");
const res = await db.exec(M);
await db.exec(M);
const report = res[res.length - 1].rows;
ok(report.length === 1 && report[0].respeta_candado === "true" && report[0].visible_sin_sesion === false, "Queda respetando el candado y oculta sin sesión", report);
const after = await asAnon("select count(*)::int n from public.vw_cash_receipts_export");
ok(after.err && /permission denied/i.test(after.err), "Después: sin sesión ya no se puede leer", after);
ok((await db.query("select count(*)::int n from public.vw_cash_receipts_export")).rows[0].n === 2, "El editor SQL (dueño) la sigue viendo y la vista no se borró");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
