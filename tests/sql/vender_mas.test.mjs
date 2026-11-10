// Pruebas de 20261312 (funciones opcionales: carritos abandonados, avísame, cupones y envío gratis).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
// Lo que en producción ya existe y aquí se simula (mismas firmas): precios del catálogo, ofertas y el pedido de siempre.
const extra = `
alter table public.store_catalogs add column if not exists slug text;
alter table public.store_catalogs add column if not exists access_key text;
alter table public.orders add column if not exists customer_note text;
create table if not exists public.test_offers (product_id uuid primary key, price numeric);
create or replace function public.catalog__access(p_store text, p_catalog text, p_key text) returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.store_catalogs c join public.stores s on s.id = c.store_id
  where s.slug = p_store and c.slug = p_catalog and (c.access_key is null or c.access_key = p_key) $$;
create or replace function public.catalog__items_raw(p_catalog uuid, p_ids uuid[])
returns table (product_id uuid, price numeric, stock integer, category_hidden boolean) language sql stable security definer set search_path = public as $$
  select p.id, p.price_3, p.stock, false from public.products p join public.store_catalogs c on c.id = p_catalog and c.store_id = p.store_id
  where p_ids is null or p.id = any (p_ids) $$;
create or replace function public.catalog__items(p_catalog uuid, p_ids uuid[])
returns table (product_id uuid, price numeric, stock integer, category_hidden boolean) language sql stable security definer set search_path = public as $$
  select r.product_id, coalesce(o.price, r.price), r.stock, r.category_hidden from public.catalog__items_raw(p_catalog, p_ids) r
  left join public.test_offers o on o.product_id = r.product_id $$;
create or replace function public.catalog_create_order(p_store text, p_catalog text, p_key text, p_items jsonb, p_customer_name text,
  p_customer_note text default null, p_customer_whatsapp text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cat uuid := public.catalog__access(p_store, p_catalog, p_key); v_store uuid; v_order uuid; v_token text := md5(random()::text);
begin
  if v_cat is null then raise exception 'Este catálogo no está disponible.'; end if;
  select store_id into v_store from public.store_catalogs where id = v_cat;
  insert into public.orders (store_id, token, status, customer_name, customer_note) values (v_store, v_token, 'pending', p_customer_name, p_customer_note) returning id into v_order;
  insert into public.order_items (order_id, product_id, quantity, price)
  select v_order, (e->>'product_id')::uuid, (e->>'qty')::int, i.price from jsonb_array_elements(p_items) e
  join public.catalog__items(v_cat, null) i on i.product_id = (e->>'product_id')::uuid;
  update public.orders set total = (select sum(quantity * price) from public.order_items where order_id = v_order) where id = v_order;
  return jsonb_build_object('token', v_token, 'receipt_no', 1, 'catalog', p_catalog);
end $$;
create or replace function public.erp_can_any(p_store uuid, p_perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.permissions && p_perms)) $$;
`;
const combined = path.join(os.tmpdir(), `remhub_vender_mas_${process.pid}.sql`);
fs.writeFileSync(combined, [fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"), extra].join("\n"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 500) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec("set role authenticated");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const anon = async (s, p) => { await db.exec("set role anon"); try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); } };
const anonErr = async (s, p) => { try { await anon(s, p); return null; } catch (e) { return e.message; } };

const U = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), VENDE = U(2), PRECIOS = U(3), NADA = U(4);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id) values ('tienda', 'Tienda', $1) returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions) values ($1,$2,'seller','{orders}'), ($1,$3,'seller','{products,products_prices}'), ($1,$4,'seller','{}')", [A, VENDE, PRECIOS, NADA]);
const [{ id: DET }] = await raw("insert into store_catalogs (store_id, name, slug) values ($1, 'Detal', 'detal') returning id", [A]);
await raw("insert into store_catalogs (store_id, name, slug, access_key) values ($1, 'Mayor', 'mayor', 'k1')", [A]);
const prod = async (name, p3, stock = 10) => (await raw("insert into products (store_id, name, price_3, stock, active) values ($1, $2, $3, $4, true) returning id", [A, name, p3, stock]))[0].id;
const P = await prod("Patineta", 20000), Q = await prod("Carro", 10000), R = await prod("Muñeca", 30000), AG = await prod("Agotado", 5000, 0);

const M = fs.readFileSync(path.join(MIG, "20261312_vender_mas_opcional.sql"), "utf8");
await db.exec(M); await db.exec(M);

const call = async (u, fn, args) => (await as(u, `select public.${fn} r`, args))[0].r;
const pub = async (fn, args) => (await anon(`select public.${fn} r`, args))[0].r;

console.log("1. Todo apagado al empezar");
let f = await call(OWNER, "store_features_get($1)", [A]);
ok(f.ok && f.can_config && f.features.carritos.enabled === false && f.features.cupones.enabled === false, "Funciones nuevas apagadas", f);
ok(f.features.cierre_dia.enabled === true && f.features.arranque.enabled === true, "Lo que ya existía sigue encendido (cierre del día, primeros pasos)");
let pf = await pub("store_public_features('tienda', 'detal')", []);
ok(pf.carritos === false && pf.avisame === null && pf.cupones === false && pf.envio_gratis === null, "El catálogo no ve nada nuevo", pf);
ok((await pub("catalog_cart_lead_save('tienda','detal',null,'sesion-de-prueba-0001','Ana','3001234567',$1)", [JSON.stringify([{ product_id: P, qty: 1 }])])).off === true, "Carrito apagado: no guarda");

console.log("2. Quién enciende");
ok((await call(VENDE, "store_feature_save($1, 'carritos', true, null)", [A])).ok === false, "Un vendedor no enciende funciones");
ok((await call(NADA, "store_features_get($1)", [A])).can_config === false, "…y ve que no puede");
ok((await call(OWNER, "store_feature_save($1, 'envio_gratis', true, '{}'::jsonb)", [A])).ok === false, "Envío gratis sin monto: no se enciende");
for (const k of ["carritos", "avisame", "cupones"]) await call(OWNER, `store_feature_save($1, '${k}', true, null)`, [A]);
await call(OWNER, "store_feature_save($1, 'envio_gratis', true, $2::jsonb)", [A, JSON.stringify({ min: 100000, missing: "Faltan {falta} 🚚", catalog_slugs: ["detal"] })]);
pf = await pub("store_public_features('tienda', 'detal')", []);
ok(pf.carritos === true && pf.avisame?.button && pf.envio_gratis?.min === 100000 && pf.envio_gratis.missing === "Faltan {falta} 🚚", "Detal ve carritos, avísame y envío gratis", pf);
ok(pf.cupones === false, "Cupones encendidos pero sin ningún cupón activo: no sale la casilla");
ok((await pub("store_public_features('tienda', 'mayor')", [])).envio_gratis === null, "Mayor no ve la barra (solo en Detal)");

console.log("3. Carritos abandonados");
const items = JSON.stringify([{ product_id: P, qty: 2 }, { product_id: Q, qty: 1 }]);
let r = await pub("catalog_cart_lead_save('tienda','detal',null,'sesion-de-prueba-0001','Ana','300 123 4567',$1)", [items]);
ok(r.ok && r.saved, "Guarda el carrito con nombre y WhatsApp", r);
let lead = (await raw("select * from erp_cart_leads where store_id = $1", [A]))[0];
ok(lead.phone === "3001234567" && Number(lead.total) === 50000 && lead.units === 3, "Precios del catálogo (no los del navegador) y celular limpio", lead);
ok((await pub("catalog_cart_lead_save('tienda','detal',null,'sesion-de-prueba-0001','Ana','12',$1)", [items])).saved === false, "Celular inválido: no guarda (y quita el abierto)");
await pub("catalog_cart_lead_save('tienda','detal',null,'sesion-de-prueba-0001','Ana','3001234567',$1)", [items]);
ok((await pub("catalog_cart_lead_save('tienda','mayor','mala','sesion-de-prueba-0002','Ana','3001234567',$1)", [items])).ok === false, "Catálogo con clave equivocada: no");
ok((await call(VENDE, "cart_leads_list($1, 14)", [A])).items.length === 0, "Recién hecho no sale (el cliente puede seguir comprando)");
await raw("update erp_cart_leads set updated_at = now() - interval '2 hours'");
let list = await call(VENDE, "cart_leads_list($1, 14)", [A]);
ok(list.ok && list.items.length === 1 && list.items[0].name === "Ana" && list.items[0].items.length === 2, "A las 2 horas sale en la bandeja", list);
ok((await call(NADA, "cart_leads_list($1, 14)", [A])).ok === false, "Sin «Pedidos» no la ve");
ok((await call(VENDE, "vm_alerts($1)", [A])).carts === 1, "La campana cuenta 1 carrito");
r = await call(VENDE, "cart_lead_mark($1, $2, 'contacted')", [A, list.items[0].id]);
lead = (await raw("select * from erp_cart_leads where store_id = $1", [A]))[0];
ok(r.ok && lead.status === "contacted" && lead.contacted_at, "Se marca «le escribí»", lead);

console.log("4. Avísame cuando llegue");
ok((await pub("catalog_notify_me('tienda','detal',null,$1,'Luis','3109998888')", [AG])).ok === true, "El cliente deja su WhatsApp");
ok((await pub("catalog_notify_me('tienda','detal',null,$1,'Luis','310 999 8888')", [AG])).ok === true, "Repetido: no duplica");
ok((await raw("select count(*)::int n from erp_stock_waitlist")).at(0).n === 1, "Una sola fila");
let wl = await call(VENDE, "stock_waitlist_list($1)", [A]);
ok(wl.ok && wl.items.length === 1 && wl.items[0].ready === false, "Aún no llega", wl);
await raw("update products set stock = 4 where id = $1", [AG]);
wl = await call(VENDE, "stock_waitlist_list($1)", [A]);
ok(wl.items[0].ready === true && wl.items[0].stock === 4, "Entró mercancía: «ya llegó»", wl.items[0]);
ok((await call(VENDE, "vm_alerts($1)", [A])).waitlist_ready === 1, "La campana avisa");
await call(VENDE, "stock_waitlist_mark($1, $2, 'notified')", [A, [wl.items[0].id]]);
ok((await call(VENDE, "vm_alerts($1)", [A])).waitlist_ready === 0, "Avisado: sale de la campana");

console.log("5. Cupones");
ok((await call(VENDE, "coupon_save($1, null, 'ZAMORA10', 'pct', 10, 0, null, null, null, '{}', null, true)", [A])).ok === false, "Sin «Cambiar precios» no crea cupones");
ok((await call(PRECIOS, "coupon_save($1, null, 'VALOR', 'value', 10000, 5000, null, null, null, '{}', null, true)", [A])).ok === false, "Por valor: el mínimo debe ser mayor que el descuento");
r = await call(PRECIOS, "coupon_save($1, null, ' zamora10 ', 'pct', 10, 0, null, null, 2, '{detal}', 'Prueba', true)", [A]);
ok(r.ok && r.items[0].code === "ZAMORA10", "Crea ZAMORA10 (10 %, 2 usos, solo Detal)", r);
ok((await pub("store_public_features('tienda', 'detal')", [])).cupones === true, "Ahora el carrito muestra la casilla de cupón");
const cart = JSON.stringify([{ product_id: P, qty: 2 }, { product_id: Q, qty: 1 }]);
r = await pub("catalog_coupon_check('tienda','detal',null,'zamora10',$1)", [cart]);
ok(r.ok && Number(r.discount) === 5000 && r.coupon_id === undefined, "10 % de $50.000 = $5.000 (sin revelar el id)", r);
ok((await pub("catalog_coupon_check('tienda','mayor','k1','ZAMORA10',$1)", [cart])).ok === false, "No sirve en Mayor");
ok((await pub("catalog_coupon_check('tienda','detal',null,'NOEXISTE',$1)", [cart])).ok === false, "Código que no existe");

await raw("insert into test_offers values ($1, 15000)", [P]);
r = await pub("catalog_coupon_check('tienda','detal',null,'ZAMORA10',$1)", [cart]);
ok(r.ok && Number(r.discount) === 1000 && r.offer_lines === 1, "No se suma a la oferta: solo descuenta el Carro ($1.000)", r);
r = await pub("catalog_coupon_check('tienda','detal',null,'ZAMORA10',$1)", [JSON.stringify([{ product_id: P, qty: 1 }])]);
ok(r.ok === false && /oferta/.test(r.message), "Solo productos en oferta: lo explica", r);

r = await pub("catalog_create_order_plus('tienda','detal',null,$1,'Ana',null,null,'ZAMORA10','sesion-de-prueba-0001')", [cart]);
const ord = (await raw("select * from orders where token = $1", [r.token]))[0];
const its = await raw("select product_id, price, quantity from order_items where order_id = $1 order by price", [ord.id]);
ok(r.coupon && Number(r.coupon.discount) === 1000, "El pedido aplica el cupón", r);
ok(Number(ord.total) === 39000 && its.find((x) => x.product_id === Q).price == 9000 && its.find((x) => x.product_id === P).price == 15000, "Total $39.000: Carro a $9.000, la Patineta queda en su oferta", { ord, its });
ok(/Cupón ZAMORA10: -\$1\.000/.test(ord.customer_note), "La nota del pedido dice el cupón", ord.customer_note);
ok((await raw("select status from erp_cart_leads where session = 'sesion-de-prueba-0001'"))[0].status === "converted", "El carrito abandonado queda como «compró»");
ok((await raw("select uses from erp_coupons where code = 'ZAMORA10'"))[0].uses === 1, "Cuenta 1 uso");
await pub("catalog_create_order_plus('tienda','detal',null,$1,'Bea',null,null,'ZAMORA10',null)", [cart]);
const err = await anonErr("select public.catalog_create_order_plus('tienda','detal',null,$1,'Cami',null,null,'ZAMORA10',null)", [cart]);
ok(err && /todas las veces/.test(err), "Tercer uso: no deja (límite 2)", err);
ok((await raw("select count(*)::int n from orders where customer_name = 'Cami'"))[0].n === 0, "…y no queda pedido a medias");
r = await pub("catalog_create_order_plus('tienda','detal',null,$1,'Dani',null,null,null,null)", [cart]);
ok(r.token && !r.coupon, "Sin cupón: el pedido de siempre");

console.log("6. Cupón por valor (repartido)");
await call(PRECIOS, "coupon_save($1, null, 'MENOS10', 'value', 10000, 40000, null, null, null, '{}', null, true)", [A]);
await raw("delete from test_offers");
const big = JSON.stringify([{ product_id: R, qty: 1 }, { product_id: Q, qty: 2 }]);
r = await pub("catalog_coupon_check('tienda','detal',null,'MENOS10',$1)", [big]);
ok(r.ok && Number(r.discount) === 10000, "Valor $10.000 sobre $50.000", r);
ok((await pub("catalog_coupon_check('tienda','detal',null,'MENOS10',$1)", [JSON.stringify([{ product_id: Q, qty: 1 }])])).message.includes("Te faltan $30.000"), "Bajo el mínimo: dice cuánto falta");
r = await pub("catalog_create_order_plus('tienda','detal',null,$1,'Eva',null,null,'MENOS10',null)", [big]);
const o2 = (await raw("select * from orders where token = $1", [r.token]))[0];
const i2 = await raw("select product_id, price::numeric p from order_items where order_id = $1", [o2.id]);
ok(Number(o2.total) === 40000 && Number(i2.find((x) => x.product_id === R).p) === 24000 && Number(i2.find((x) => x.product_id === Q).p) === 8000,
  "Repartido según el valor: Muñeca $24.000 y Carros $8.000 c/u", i2);

console.log("7. Vencimiento y borrado");
await call(PRECIOS, "coupon_save($1, null, 'VIEJO', 'pct', 5, 0, '2020-01-01', '2020-01-31', null, '{}', null, true)", [A]);
ok(/venció/.test((await pub("catalog_coupon_check('tienda','detal',null,'VIEJO',$1)", [cart])).message), "Vencido: lo dice");
const ids = await raw("select id, code from erp_coupons");
await call(PRECIOS, "coupon_delete($1, $2)", [A, ids.find((x) => x.code === "VIEJO").id]);
await call(PRECIOS, "coupon_delete($1, $2)", [A, ids.find((x) => x.code === "ZAMORA10").id]);
const left = await raw("select code, active from erp_coupons order by code");
ok(!left.some((x) => x.code === "VIEJO") && left.find((x) => x.code === "ZAMORA10").active === false, "Sin usos se borra; con usos solo se apaga", left);
ok((await call(OWNER, "store_feature_save($1, 'cupones', false, null)", [A])).ok, "Apagar cupones");
ok((await pub("catalog_coupon_check('tienda','detal',null,'MENOS10',$1)", [big])).ok === false, "Apagado: ningún cupón funciona");

console.log(`\n${pass} bien, ${fail} mal`);
process.exit(fail ? 1 : 0);
