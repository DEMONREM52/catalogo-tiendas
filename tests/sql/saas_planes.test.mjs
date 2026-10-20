// Pruebas de 20261211: planes, suscripciones, prueba gratuita, límites y pagos DE REMHUB (separados de las ventas de las tiendas).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_saas_${process.pid}.sql`);
fs.writeFileSync(combined, [
  fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"),
  `create or replace function public.erp_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $f$
     select auth.uid() is not null and exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin') $f$;
   grant execute on function public.erp_is_platform_admin() to authenticated;
   alter table public.erp_warehouses add column if not exists kind text;`,
].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 400) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p, role) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role ?? (uid ? "authenticated" : "anon")}`);
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p, role) => (await as(u, s, p, role))[0]?.r;
const err = async (u, s, p, role) => { try { await as(u, s, p, role); return null; } catch (e) { return e.message; } };

const U = (n) => `5a000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OLD_OWNER = U(1), OWNER = U(2), SELLER = U(3), STRANGER = U(4), ADMIN = U(9);
await raw("insert into user_profiles (user_id, role) values ($1, 'admin')", [ADMIN]);
await raw("insert into auth.users (id, email) values ($1, 'dueno@x.co')", [OWNER]);

// Una tienda de antes (cliente actual con fecha) y la migración.
const [{ id: OLD }] = await raw("insert into stores (slug, name, owner_id, active, active_until) values ('vieja', 'VIEJA', $1, true, now() + interval '20 days') returning id", [OLD_OWNER]);
const M = fs.readFileSync(path.join(MIG, "20261211_saas_planes_suscripciones.sql"), "utf8");
await db.exec(M);
await db.exec(M);

console.log("1. Clientes actuales y tiendas nuevas");
const oldEnt = await one(OLD_OWNER, "select public.saas_entitlements($1) r", [OLD]);
ok(oldEnt.ok && oldEnt.plan.id === "fundador" && oldEnt.status === "active" && oldEnt.limits.products === null, "El cliente actual queda en «Fundador» sin límites", oldEnt);
const [{ id: S }] = await raw("insert into stores (slug, name, owner_id) values ('nueva', 'NUEVA', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1, $2, 'seller', '{pos}')", [S, SELLER]);
let ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(ent.plan.id === "gratis" && ent.status === "free" && ent.limits.products === 10 && ent.trial_available === true, "Una tienda nueva arranca en el plan Gratis", ent);
ok((await one(SELLER, "select public.saas_entitlements($1) r", [S])).ok === true, "Un vendedor de la tienda ve sus derechos");
ok((await one(STRANGER, "select public.saas_entitlements($1) r", [S])).ok === false, "Alguien de otra tienda no los ve");
ok(/permission denied/i.test(await err(OWNER, "select * from saas_subscriptions") ?? ""), "Nadie lee las tablas de suscripción directo");
ok(/permission denied/i.test(await err(OWNER, "update saas_subscriptions set plan_id = 'empresarial'") ?? ""), "El cliente no se puede cambiar el plan");
const pub = await one(null, "select public.saas_public_plans() r");
ok(pub.length === 4 && !pub.some((p) => p.id === "fundador") && pub.find((p) => p.id === "negocio").monthly_price === 99900, "La página de precios ve 4 planes (sin Fundador)", pub.map((p) => p.id));

console.log("2. Prueba gratuita");
ok((await one(SELLER, "select public.saas_trial_start($1) r", [S])).ok === false, "Un vendedor no puede empezar la prueba");
const tr = await one(OWNER, "select public.saas_trial_start($1) r", [S]);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(tr.ok && ent.status === "trialing" && ent.plan.id === "negocio" && ent.trial_days_left === 7, "El dueño empieza 7 días del plan Negocio", ent);
ok((await one(OWNER, "select public.saas_trial_start($1) r", [S])).ok === false, "No se puede empezar dos veces");
const [{ id: S2 }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [OWNER]);
ok((await one(OWNER, "select public.saas_trial_start($1) r", [S2])).ok === false, "Ni con otra tienda del mismo dueño");
await raw("update saas_subscriptions set trial_ends_at = now() - interval '1 minute' where store_id = $1", [S]);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(ent.status === "free" && ent.plan.id === "gratis", "Al vencer la prueba vuelve a Gratis (sin borrar nada)", ent);

console.log("3. Límites (observar y bloquear)");
for (let i = 0; i < 10; i++) await as(OWNER, "insert into products (store_id, name) values ($1, $2)", [S, `P${i}`]);
const e11 = await err(OWNER, "insert into products (store_id, name) values ($1, 'P11')", [S]);
const [{ n: hits }] = await raw("select count(*)::int n from saas_usage_events where store_id = $1 and kind = 'limit_hit'", [S]);
ok(e11 === null && hits === 1, "En modo observar deja crear el producto 11 y lo anota", { e11, hits });
await raw("update saas_settings set enforce_limits = true");
const e12 = await err(OWNER, "insert into products (store_id, name) values ($1, 'P12')", [S]);
ok(/Tu plan permite hasta 10 productos/.test(e12 ?? ""), "En modo bloquear no deja pasar del límite", e12);
await raw("insert into products (store_id, name) values ($1, 'IMPORTADO')", [S]);
ok(true, "Los procesos internos no se frenan");
const eu = await err(OWNER, "insert into store_users (store_id, user_id, role) values ($1, $2, 'seller')", [S, U(5)]);
ok(/hasta 1 usuarios/.test(eu ?? ""), "Tampoco deja agregar usuarios por encima del plan", eu);
await raw("update saas_settings set enforce_limits = false");

console.log("4. Administración de RemHub");
ok((await one(OWNER, "select public.saas_admin_set_subscription($1, '{\"plan_id\":\"empresarial\"}'::jsonb, 'quiero') r", [S])).ok === false, "El dueño no puede usar las funciones del admin");
const adm = await one(ADMIN, "select public.saas_admin_set_subscription($1, '{\"extra_points\":2}'::jsonb, 'cortesía por demora') r", [S]);
const [{ n: ev }] = await raw("select count(*)::int n from saas_subscription_events where store_id = $1 and kind = 'admin_change' and reason = 'cortesía por demora'", [S]);
ok(adm.ok && ev === 1, "El admin cambia una suscripción y queda en el historial con el motivo");
ok((await one(ADMIN, "select public.saas_admin_set_subscription($1, '{\"plan_id\":\"x\"}'::jsonb, '') r", [S])).ok === false, "Sin motivo no se aplica");

console.log("5. Cobro de RemHub y webhook");
ok((await one(SELLER, "select public.saas_checkout_create($1, 'emprendedor', 'month', 'sandbox') r", [S])).ok === false, "Solo el dueño puede contratar");
const co = await one(OWNER, "select public.saas_checkout_create($1, 'emprendedor', 'month', 'sandbox') r", [S]);
ok(co.ok && Number(co.amount_cents) === 4990000 && co.reference.startsWith("RH-"), "El precio sale de la base (49.900) con referencia única", co);
ok(/permission denied/i.test(await err(OWNER, "select public.saas_payment_apply('wompi','e1',$1,'tx1','APPROVED',4990000,'COP','CARD','sandbox','{}')", [co.reference]) ?? ""), "El navegador no puede marcar un pago como aprobado");
const ap = (key, ref, tx, status, cents, env = "sandbox") =>
  one(null, "select public.saas_payment_apply('wompi', $1, $2, $3, $4, $5, 'COP', 'CARD', $6, '{}'::jsonb) r", [key, ref, tx, status, cents, env], "service_role");
let r = await ap("e1", co.reference, "tx1", "PENDING", 4990000);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(r.status === "pending" && ent.plan.id === "gratis", "Un pago pendiente NO activa el plan", { r, plan: ent.plan.id });
r = await ap("e2", co.reference, "tx1", "APPROVED", 4990000);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
const [{ until }] = await raw("select active_until as until from stores where id = $1", [S]);
ok(r.result === "applied" && ent.status === "active" && ent.plan.id === "emprendedor" && until, "Aprobado: activa Emprendedor por un mes", { r, ent: ent.status, until });
const end1 = (await raw("select current_period_end e from saas_subscriptions where store_id = $1", [S]))[0].e;
ok((await ap("e2", co.reference, "tx1", "APPROVED", 4990000)).result === "duplicate", "El mismo evento repetido no se procesa dos veces");
await ap("e3", co.reference, "tx1", "APPROVED", 4990000);
const end2 = (await raw("select current_period_end e from saas_subscriptions where store_id = $1", [S]))[0].e;
ok(String(end1) === String(end2), "Otro aviso de la misma transacción no suma otro mes");
const co2 = await one(OWNER, "select public.saas_checkout_create($1, 'negocio', 'year', 'sandbox') r", [S]);
r = await ap("e4", co2.reference, "tx2", "APPROVED", 100);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(r.result === "review" && ent.plan.id === "emprendedor", "Si el monto no coincide queda en revisión y no activa nada", r);
const co3 = await one(OWNER, "select public.saas_checkout_create($1, 'negocio', 'month', 'sandbox') r", [S]);
r = await ap("e5", co3.reference, "tx3", "APPROVED", 9990000, "production");
ok(r.result === "review", "Un pago de pruebas no se mezcla con producción (entorno distinto → revisión)", r);
r = await ap("e6", "VENTA-DE-TIENDA-123", "tx9", "APPROVED", 5000000);
ok(r.result === "ignored", "Un pago que no es de RemHub (venta de una tienda) se ignora", r);
const co4 = await one(OWNER, "select public.saas_checkout_create($1, 'negocio', 'month', 'sandbox') r", [S]);
r = await ap("e7", co4.reference, "tx4", "DECLINED", 9990000);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(r.status === "declined" && ent.plan.id === "emprendedor", "Un pago rechazado no cambia el plan", r);
const pays = await one(OWNER, "select public.saas_my_payments($1) r", [S]);
ok(pays.length === 4 && (await one(STRANGER, "select public.saas_my_payments($1) r", [S])).length === 0, "El dueño ve su historial de pagos; otros no", pays.length);

console.log("6. Cancelar y vencer");
const ca = await one(OWNER, "select public.saas_cancel($1, 'muy caro') r", [S]);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(ca.ok && ent.status === "canceled" && ent.plan.id === "emprendedor", "Cancelar mantiene el plan hasta el final del período", ent);
await raw("update saas_subscriptions set current_period_end = now() - interval '1 day' where store_id = $1", [S]);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
ok(ent.status === "past_due" && ent.plan.id === "emprendedor", "Vencido hace 1 día: días de gracia con el mismo plan", ent);
await raw("update saas_subscriptions set current_period_end = now() - interval '5 days' where store_id = $1", [S]);
ent = await one(OWNER, "select public.saas_entitlements($1) r", [S]);
const [{ n: prods }] = await raw("select count(*)::int n from products where store_id = $1", [S]);
ok(ent.status === "expired" && ent.plan.id === "gratis" && prods === 12, "Pasada la gracia queda en Gratis sin borrar sus productos", { ent: ent.status, prods });

console.log("7. Tablero del admin");
const dash = await one(ADMIN, "select public.saas_admin_dashboard(current_date - 30, current_date) r");
ok(dash.ok && Number(dash.money.collected) === 49900 && dash.counts.stores === 3 && dash.counts.founders === 1, "El admin ve lo cobrado (49.900) y las tiendas", { money: dash.money, counts: dash.counts });
ok((await one(OWNER, "select public.saas_admin_dashboard(current_date - 30, current_date) r")).ok === false, "Un dueño no ve el tablero de RemHub");
const cust = await one(ADMIN, "select public.saas_admin_customers($1, null, null) r", ["dueno@"]);
ok(cust.ok && cust.total === 2, "Busca clientes por correo", cust.total);
const adp = await one(ADMIN, "select public.saas_admin_payments(null) r");
ok(adp.payments.length === 4 && adp.webhooks.length >= 6, "Ve los pagos de RemHub y los avisos de Wompi", { p: adp.payments.length, w: adp.webhooks.length });
const plansAdm = await one(ADMIN, "select public.saas_admin_plans() r");
ok(plansAdm.length === 5 && (await one(OWNER, "select public.saas_admin_plans() r")).length === 0, "Solo el admin ve todos los planes (con Fundador)");
const sp = await one(ADMIN, "select public.saas_admin_save_plan($1::jsonb, 'subir precio') r", [JSON.stringify({ ...plansAdm.find((p) => p.id === "emprendedor"), monthly_price: 59900 })]);
const co5 = await one(OWNER, "select public.saas_checkout_create($1, 'emprendedor', 'month', 'sandbox') r", [S]);
ok(sp.ok && Number(co5.amount_cents) === 4990000, "Subir el precio del plan no cambia el de quien ya pagó (renueva a 49.900)", co5.amount_cents);


console.log("8. Pagos manuales (sin Wompi)");
await db.exec(fs.readFileSync(path.join(MIG, "20261214_pagos_manuales.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(MIG, "20261214_pagos_manuales.sql"), "utf8"));
ok((await one(OWNER, "select public.saas_admin_manual_payment($1, 'negocio', 'month', 99900, 'nequi', 'NQ-1', 'pagó Juan') r", [S2])).ok === false, "Un dueño no puede registrarse pagos a sí mismo");
ok((await one(ADMIN, "select public.saas_admin_manual_payment($1, 'negocio', 'month', 99900, 'nequi', 'NQ-1', '') r", [S2])).ok === false, "Sin nota no se registra");
const mp = await one(ADMIN, "select public.saas_admin_manual_payment($1, 'negocio', 'month', 99900, 'nequi', 'NQ-123', 'Pagó por Nequi a la cuenta de RemHub') r", [S2]);
const ent2 = await one(OWNER, "select public.saas_entitlements($1) r", [S2]);
ok(mp.ok && mp.result.result === "applied" && ent2.status === "active" && ent2.plan.id === "negocio", "El pago manual activa el plan por un mes", { mp, st: ent2.status });
const dash2 = await one(ADMIN, "select public.saas_admin_dashboard(current_date - 30, current_date) r");
ok(Number(dash2.money.collected) === 49900 + 99900, "Cuenta en «Cobrado» igual que un pago en línea", dash2.money.collected);
const adp2 = await one(ADMIN, "select public.saas_admin_payments('NQ-123') r");
ok(adp2.payments.length === 1 && adp2.payments[0].provider === "manual" && adp2.payments[0].method === "nequi", "Se encuentra por la referencia de la transferencia", adp2.payments[0]);
const fund = await one(ADMIN, "select public.saas_admin_set_subscription($1, '{\"plan_id\":\"fundador\",\"status\":\"active\",\"current_period_end\":null}'::jsonb, 'cortesía todo incluido') r", [S2]);
const ent3 = await one(OWNER, "select public.saas_entitlements($1) r", [S2]);
ok(fund.ok && ent3.plan.id === "fundador" && ent3.limits.products === null && ent3.modules.includes("payroll"), "El admin activa «todo incluido» sin vencimiento", ent3.plan);

console.log(`\n${pass} bien, ${fail} mal`);
await db.close();
process.exitCode = fail ? 1 : 0;
