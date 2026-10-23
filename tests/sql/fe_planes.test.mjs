// Pruebas de 20261241: facturación electrónica como adicional (paquetes, uso del mes, extras, pagos y bloqueo).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_feplan_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create or replace function public.erp_can_any(p_store uuid, p_perms text[])
   returns boolean language sql stable security definer set search_path = public as $f$
     select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
       or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and (su.role = 'store_admin' or su.permissions && p_perms))) $f$;
   grant execute on function public.erp_can_any(uuid, text[]) to authenticated;
   create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $f$
     select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $f$;
   grant execute on function public.erp_is_platform_admin() to authenticated;
   alter table public.erp_warehouses add column if not exists kind text;
   -- Documentos fiscales (solo lo que usa esta migración).
   create table public.fiscal_documents (id uuid primary key default gen_random_uuid(), store_id uuid not null, environment text not null, status text not null default 'DRAFT',
     document_type text not null default 'pos_equivalent', issue_date timestamptz not null default now());
   create table public.fiscal_entities (id uuid primary key default gen_random_uuid(), store_id uuid);`,
  ...["20261118_compras_desde_punto.sql", "20261120_permisos_exportar_y_punto.sql", "20261127_permisos_temporales_horario.sql"].map((x) => fs.readFileSync(path.join(MIG, x), "utf8")),
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);
for (const f of ["20261211_saas_planes_suscripciones.sql", "20261213_modulos_por_plan.sql", "20261214_pagos_manuales.sql", "20261241_facturacion_electronica_planes.sql"]) {
  const sql = fs.readFileSync(path.join(MIG, f), "utf8");
  await db.exec(sql);
  if (f.startsWith("20261241")) await db.exec(sql);
}

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role ?? (uid ? "authenticated" : "anon")}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p, role) => (await as(u, s, p, role))[0]?.r;
const err = async (u, s, p, role) => { try { await as(u, s, p, role); return null; } catch (e) { return e.message; } };
const U = (n) => `5f000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), SELLER = U(2), ADMIN = U(9);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
await raw("insert into auth.users (id, email) values ($1, 'dueno@x.co')", [OWNER]);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('tienda', 'TIENDA', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [S, SELLER]);
const period = (await raw("select to_char(now() at time zone 'America/Bogota', 'YYYY-MM') p"))[0].p;
const prev = (await raw("select to_char((now() at time zone 'America/Bogota') - interval '1 month', 'YYYY-MM') p"))[0].p;
const doc = (status, env = "production", when = "now()") => raw(`insert into fiscal_documents (store_id, environment, status, issue_date) values ($1, $2, $3, ${when})`, [S, env, status]);

console.log("Paquetes y estado");
const pub = (await as(null, "select public.saas_public_addons() r"))[0].r;
ok(pub.length === 3 && pub.map((a) => a.included_docs).join() === "100,300,1000", "La página de precios muestra los 3 paquetes sin sesión", pub);
let my = await one(SELLER, "select public.saas_my_fiscal($1) r", [S]);
ok(my.ok && my.state.active === false && my.state.addon === null && my.is_owner === false, "Sin adicional: inactivo (un vendedor lo puede ver)", my.state);

console.log("Modo observar y bloqueo");
await doc("ACCEPTED");
ok((await raw("select count(*)::int n from saas_usage_events where kind = 'fiscal_no_addon'"))[0].n === 1, "Emitir sin adicional en modo observar: se deja y se anota");
await doc("ACCEPTED");
ok((await raw("select count(*)::int n from saas_usage_events where kind = 'fiscal_no_addon'"))[0].n === 1, "   (un aviso por día, no uno por documento)");
await doc("ACCEPTED", "sandbox");
await raw("update saas_settings set fiscal_enforce = true");
const blocked = await (async () => { try { await doc("DRAFT"); return null; } catch (e) { return e.message; } })();
ok(/adicional/.test(blocked ?? ""), "Con el bloqueo encendido, sin adicional no se emite en producción", blocked);
await doc("DRAFT", "sandbox");
ok(true, "   pero las pruebas (sandbox) siempre se pueden");
await raw("update saas_settings set fiscal_enforce = false");

console.log("Comprar el paquete en línea");
ok(/dueño/.test((await one(SELLER, "select public.saas_fiscal_checkout($1, 'fe_100', 'month', 'sandbox', 'addon') r", [S])).error ?? ""), "Solo el dueño contrata");
const co = await one(OWNER, "select public.saas_fiscal_checkout($1, 'fe_100', 'month', 'sandbox', 'addon') r", [S]);
ok(co.ok && co.amount_cents === 3490000 && /^RH-FE-/.test(co.reference), "Checkout del paquete Básico: $34.900", co);
const apply = (ref, cents, key) => one(null, "select public.saas_payment_apply('wompi', $1, $2, $3, 'APPROVED', $4, 'COP', 'CARD', 'sandbox', '{}'::jsonb) r", [key, ref, "tx-" + key, cents], "service_role");
const planBefore = (await raw("select plan_id, status, current_period_end from saas_subscriptions where store_id = $1", [S]))[0];
let r = await apply(co.reference, co.amount_cents, "ev1");
ok(r.result === "applied", "Pago aprobado", r);
const sub = (await raw("select plan_id, status, current_period_end, fiscal_addon_id, fiscal_addon_until, fiscal_addon_locked_monthly from saas_subscriptions where store_id = $1", [S]))[0];
ok(sub.fiscal_addon_id === "fe_100" && sub.fiscal_addon_until && sub.fiscal_addon_locked_monthly === 34900, "Queda con el paquete por un mes y precio pactado", sub);
ok(sub.plan_id === planBefore.plan_id && sub.status === planBefore.status && String(sub.current_period_end) === String(planBefore.current_period_end), "El plan no cambia", { before: planBefore, sub });
ok((await apply(co.reference, co.amount_cents, "ev1")).result === "duplicate", "El mismo aviso de pago no se aplica dos veces");
my = await one(OWNER, "select public.saas_my_fiscal($1) r", [S]);
ok(my.state.active && my.state.included === 100 && my.state.used === 2 && my.state.extra === 0, "Ahora: 2 de 100 documentos este mes (sandbox no cuenta)", my.state);
ok((await one(OWNER, "select public.saas_has_module($1, 'fiscal') r", [S])) === true, "Con el adicional tiene el módulo de facturación electrónica");
const co2 = await one(OWNER, "select public.saas_fiscal_checkout($1, 'fe_100', 'month', 'sandbox', 'addon') r", [S]);
await apply(co2.reference, co2.amount_cents, "ev2");
const until2 = (await raw("select fiscal_addon_until from saas_subscriptions where store_id = $1", [S]))[0].fiscal_addon_until;
ok(new Date(until2) - new Date(sub.fiscal_addon_until) > 27 * 86400000, "Renovar suma otro mes desde el vencimiento", { a: sub.fiscal_addon_until, b: until2 });

console.log("Extras al cerrar el mes");
for (let i = 0; i < 103; i++) await doc("ACCEPTED", "production", `(date_trunc('month', now() at time zone 'America/Bogota') - interval '10 days') at time zone 'America/Bogota'`);
await doc("REJECTED", "production", `(date_trunc('month', now() at time zone 'America/Bogota') - interval '10 days') at time zone 'America/Bogota'`);
ok((await one(OWNER, "select public.saas_fiscal_close_month($1) r", [prev])).ok === false, "El dueño no cierra meses");
ok((await one(ADMIN, "select public.saas_fiscal_close_month($1) r", [period])).ok === false, "No se cierra el mes en curso");
r = await one(ADMIN, "select public.saas_fiscal_close_month($1) r", [prev]);
const over = (await raw("select * from saas_fiscal_overages where store_id = $1", [S]))[0];
ok(r.charges === 1 && over.used === 103 && over.included === 100 && over.extra === 3 && over.unit_price === 450 && over.amount === 1350 && over.status === "open", "Mes pasado: 103 aceptados (el rechazado no cuenta) → 3 extra × $450 = $1.350", over);
ok((await one(ADMIN, "select public.saas_fiscal_close_month($1) r", [prev])).charges === 0, "Cerrar otra vez no duplica el cobro");
my = await one(OWNER, "select public.saas_my_fiscal($1) r", [S]);
ok(my.state.open_overages === 1350 && my.overages.length === 1, "El dueño ve que debe $1.350 de extras", my.state);
const co3 = await one(OWNER, "select public.saas_fiscal_checkout($1, null, 'month', 'sandbox', 'overages') r", [S]);
ok(co3.ok && co3.amount_cents === 135000, "Pagar los extras en línea: $1.350", co3);
await apply(co3.reference, co3.amount_cents, "ev3");
ok((await raw("select status, payment_reference from saas_fiscal_overages where store_id = $1", [S]))[0].status === "paid", "Pagado el cobro de extras");
ok((await raw("select fiscal_addon_until from saas_subscriptions where store_id = $1", [S]))[0].fiscal_addon_until.getTime() === new Date(until2).getTime(), "   y pagar extras no cambia el vencimiento del paquete");
ok((await one(OWNER, "select public.saas_fiscal_checkout($1, null, 'month', 'sandbox', 'overages') r", [S])).ok === false, "Sin extras abiertos no hay nada por pagar");

console.log("Administrador");
ok((await one(OWNER, "select public.saas_admin_save_addon($1::jsonb, 'x') r", [JSON.stringify({ id: "fe_100", name: "X" })])).ok === false, "Solo el admin edita paquetes");
ok((await one(ADMIN, "select public.saas_admin_save_addon($1::jsonb, 'Subió el costo de Alanube') r", [JSON.stringify({ id: "fe_100", name: "Básica", monthly_price: 39900, yearly_price: 399000, included_docs: 120, overage_price: 450 })])).ok, "El admin cambia el precio y los documentos del paquete");
ok((await raw("select monthly_price from saas_addons where id = 'fe_100'"))[0].monthly_price === 39900 && (await raw("select count(*)::int n from saas_addon_history where addon_id = 'fe_100'"))[0].n === 1, "Queda en el historial del paquete");
const co4 = await one(OWNER, "select public.saas_fiscal_checkout($1, 'fe_100', 'month', 'sandbox', 'addon') r", [S]);
ok(co4.amount_cents === 3490000, "Quien ya tenía el paquete renueva con su precio pactado ($34.900)", co4);
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [U(5)]);
ok((await one(ADMIN, "select public.saas_admin_set_fiscal_addon($1, 'fe_300', null, 'Cliente Fundador') r", [S2])).ok, "El admin regala el paquete sin vencimiento");
ok((await one(ADMIN, "select public.saas_admin_fiscal_overview() r")).stores.some((x) => x.store_id === S2 && x.active), "El tablero del admin lo muestra activo");
await raw("insert into saas_fiscal_overages (store_id, period, extra, unit_price, amount) values ($1, '2026-01', 2, 500, 1000)", [S2]);
const ov2 = (await raw("select id from saas_fiscal_overages where store_id = $1", [S2]))[0].id;
ok((await one(ADMIN, "select public.saas_admin_overage_set($1, 'waived', 'Primer mes de cortesía') r", [ov2])).ok && (await raw("select status from saas_fiscal_overages where id = $1", [ov2]))[0].status === "waived", "El admin puede perdonar un cobro de extras");
ok((await one(ADMIN, "select public.saas_admin_fiscal_settings(true, 600, 'Ya hay clientes') r")).ok && (await raw("select fiscal_enforce, fiscal_payg_price from saas_settings"))[0].fiscal_payg_price === 600, "El admin enciende el bloqueo y el precio sin paquete");

console.log("Los pagos de planes siguen igual");
const pc = await one(OWNER, "select public.saas_checkout_create($1, 'emprendedor', 'month', 'sandbox') r", [S]);
ok(pc.ok, "Checkout de plan como siempre", pc);
await apply(pc.reference, pc.amount_cents, "ev-plan");
const sp = (await raw("select plan_id, status, fiscal_addon_id from saas_subscriptions where store_id = $1", [S]))[0];
ok(sp.plan_id === "emprendedor" && sp.status === "active" && sp.fiscal_addon_id === "fe_100", "Pagar el plan lo activa y conserva el paquete de facturación", sp);

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
