// Pruebas de 20261252: landing pages (guardar, ver público, latido real, pedido con paquete, pago, adicional y clientes por recuperar).
import { makeDb } from "./setup.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = process.env.REMHUB_MIGRATIONS ?? path.join(here, "migraciones");
const combined = path.join(os.tmpdir(), `remhub_landing_${process.pid}.sql`);
fs.writeFileSync(combined, fs.readFileSync(path.join(here, "fixtures/prod_ventas.sql"), "utf8"));
process.on("unhandledRejection", (e) => { console.error("FALLA:", e?.message, e?.where ?? ""); process.exit(2); });
const { db } = await makeDb(combined, { twice: false });
fs.unlinkSync(combined);

// Lo que en producción ya existe (catálogos de RemHub Social y métodos de pago), en versión mínima.
await db.exec(`
alter table public.store_catalogs add column if not exists slug text, add column if not exists access_key text, add column if not exists active boolean default true;
alter table public.orders add column if not exists customer_note text;
create table if not exists public.store_payment_methods (id uuid primary key default gen_random_uuid(), store_id uuid, provider text, name text, enabled boolean default true, show_on_invoice boolean default true, sort_order integer default 0);
create or replace function public.catalog_public_stock(p_store text, p_catalog text, p_key text, p_ids uuid[])
returns table (id uuid, name text, price numeric, stock integer) language sql stable security definer set search_path = public as $$
  select p.id, p.name, case when p.price_3 > 0 then p.price_3 else null end, p.stock
  from public.products p join public.stores s on s.id = p.store_id and s.slug = p_store
  join public.store_catalogs c on c.store_id = s.id and c.slug = p_catalog and (c.access_key is null or c.access_key = p_key)
  where p.id = any(p_ids) and p.active
$$;
create or replace function public.catalog_create_order(p_store text, p_catalog text, p_key text, p_items jsonb, p_customer_name text, p_customer_note text, p_customer_whatsapp text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_id uuid; v_tok text := md5(random()::text); it jsonb; v_no bigint;
begin
  select id into v_store from public.stores where slug = p_store;
  select coalesce(max(receipt_no), 0) + 1 into v_no from public.orders where store_id = v_store;
  insert into public.orders (store_id, token, receipt_no, status, customer_name, customer_whatsapp, customer_note) values (v_store, v_tok, v_no, 'sent', p_customer_name, p_customer_whatsapp, p_customer_note) returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    if (select stock from public.products where id = (it->>'product_id')::uuid) < (it->>'qty')::integer then raise exception 'Stock insuficiente'; end if;
    insert into public.order_items (order_id, product_id, quantity, price) select v_id, p.id, (it->>'qty')::integer, p.price_3 from public.products p where p.id = (it->>'product_id')::uuid;
  end loop;
  update public.orders set total = (select sum(quantity * price) from public.order_items where order_id = v_id) where id = v_id;
  return jsonb_build_object('token', v_tok, 'receipt_no', v_no);
end $$;
grant execute on function public.catalog_public_stock(text, text, text, uuid[]) to anon, authenticated;
grant execute on function public.catalog_create_order(text, text, text, jsonb, text, text, text) to anon, authenticated;
`);
const M = fs.readFileSync(path.join(MIG, "20261252_landing_pages.sql"), "utf8");
await db.exec(M);
await db.exec(M);
const M2 = fs.readFileSync(path.join(MIG, "20261253_landing_contadores.sql"), "utf8");
await db.exec(M2);
await db.exec(M2);
const M3 = fs.readFileSync(path.join(MIG, "20261254_landing_precio_propio.sql"), "utf8");
await db.exec(M3);
await db.exec(M3);
const M4 = fs.readFileSync(path.join(MIG, "20261255_landing_precios_catalogo.sql"), "utf8");
await db.exec(M4);
await db.exec(M4);
const M5 = fs.readFileSync(path.join(MIG, "20261256_landing_vistas_mes.sql"), "utf8");
await db.exec(M5);
await db.exec(M5);

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✔ " + l); } else { fail++; console.log("  ✘ " + l + (x !== undefined ? " → " + JSON.stringify(x).slice(0, 600) : "")); } };
const raw = async (s, p) => (await db.query(s, p)).rows;
async function as(uid, s, p) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return (await db.query(s, p)).rows; } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); }
}
const one = async (u, s, p) => (await as(u, s, p))[0]?.r;
const anon = (s, p) => one(null, s, p);

const U = (n) => `1a000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWNER = U(1), MKT = U(2), CAJA = U(3);
const [{ id: A }] = await raw("insert into stores (slug, name, owner_id, whatsapp) values ('vitrina', 'LA VITRINA', $1, '3001234567') returning id", [OWNER]);
await raw("insert into store_users (store_id, user_id, role, permissions, username) values ($1, $2, 'seller', '{products}', 'mkt'), ($1, $3, 'seller', '{pos}', 'caja')", [A, MKT, CAJA]);
const [{ id: CAT }] = await raw("insert into store_catalogs (store_id, name, slug) values ($1, 'Detal', 'detal') returning id", [A]);
const prod = async (name, price, stock) => (await raw("insert into products (store_id, name, price_3, stock, image_url) values ($1, $2, $3, $4, 'https://x.co/a.jpg') returning id", [A, name, price, stock]))[0].id;
const NEGRO = await prod("Enterizo Relax Negro", 99900, 10), BLANCO = await prod("Enterizo Relax Blanco", 99900, 1), CORREA = await prod("Correa", 30000, 5);
const [{ id: OTRA }] = await raw("insert into stores (slug, name, owner_id) values ('otra', 'OTRA', $1) returning id", [U(9)]);
const AJENO = (await raw("insert into products (store_id, name, price_3, stock) values ($1, 'x', 1000, 1) returning id", [OTRA]))[0].id;

const config = {
  option_label: "Color", option_names: { [NEGRO]: "Negro", [BLANCO]: "Blanco" },
  bundles: [{ qty: 1, pct: 0, label: "Lleva 1" }, { qty: 2, pct: 8, label: "Lleva 2" }, { qty: 3, pct: 15, label: "Lleva 3" }],
  payments: { cod: true, online: true, online_pct: 5, addi: true },
  form: { ask_document: true, ask_email: false },
  upsell: { enabled: true, product_id: CORREA, pct: 20 },
  exit_offer: { enabled: true, pct: 5 },
};
const save = (u, id, p) => one(u, "select public.erp_landing_save($1, $2, $3::jsonb) r", [A, id, JSON.stringify(p)]);
const base = { name: "Enterizo Relax", slug: "enterizo-relax", status: "published", catalog_id: CAT, product_ids: [NEGRO, BLANCO], config };

console.log("1. Guardar desde el panel");
ok(!(await save(CAJA, null, base)).ok, "Sin permiso de productos no crea landings");
ok((await save(MKT, null, { ...base, product_ids: [NEGRO, AJENO] })).field === "product_ids", "No acepta productos de otra tienda");
ok((await save(MKT, null, { ...base, config: { ...config, upsell: { enabled: true, product_id: NEGRO } } })).field === "upsell", "El adicional no puede ser una de las opciones");
ok((await save(MKT, null, { ...base, slug: "A b" })).field === "slug", "Enlace con letras, números y guiones");
const created = await save(MKT, null, base);
ok(created.ok, "Crea la landing publicada", created);
const PAGE = created.id;
ok((await save(MKT, null, base)).field === "slug", "No repite el enlace en la misma tienda");
const ids = (await one(MKT, "select public.erp_landing_get($1, $2) r", [A, PAGE])).page.product_ids;
ok(ids[0] === NEGRO && ids[1] === BLANCO, "Respeta el orden de las opciones");

console.log("2. La página pública (sin sesión)");
const pub = await anon("select public.landing_public('vitrina', 'enterizo-relax') r");
ok(pub.ok && pub.items.length === 2 && pub.items[0].option === "Negro" && Number(pub.items[0].price) === 99900, "Muestra las opciones con precio del catálogo", pub.items);
ok(pub.upsell?.name === "Correa", "Trae el adicional de último momento");
ok(pub.payments.cod && !pub.payments.online && !pub.payments.addi, "En línea y Addi solo si la tienda los tiene activos", pub.payments);
ok(!JSON.stringify(pub).includes("access_key") && !("catalog_key" in pub), "No deja ver la clave del catálogo");
ok(typeof pub.trust?.orders_done === "number" && pub.trust.since >= 2020 && Array.isArray(pub.trust.points), "Credibilidad con datos reales de la tienda", pub.trust);
ok(!(await anon("select public.landing_public('vitrina', 'no-existe') r")).ok, "Una landing que no existe no se ve");
await raw("insert into store_payment_methods (store_id, provider, name) values ($1, 'wompi', 'Wompi'), ($1, 'addi', 'Addi')", [A]);
ok((await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).payments.online, "Con Wompi activo aparece pagar en línea");

console.log("3. Personas viendo (real)");
for (const s of ["sesion-aaaa1", "sesion-bbbb2", "sesion-cccc3"]) await anon("select public.landing_ping('vitrina', 'enterizo-relax', $1, 'view', '{\"source\":\"facebook\",\"campaign\":\"oct\"}') r", [s]);
let ping = await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-aaaa1', 'beat', '{}') r");
ok(ping.live === 3, "Cuenta solo navegadores con latido reciente", ping);
await raw("update erp_landing_visits set last_seen = now() - interval '5 minutes' where session_id = 'sesion-cccc3'");
ping = await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-aaaa1', 'beat', '{}') r");
ok(ping.live === 2, "Quien cerró la página deja de contar", ping);
ok(!(await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'x', 'beat', '{}') r")).ok, "Sesión inválida no cuenta");
await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-aaaa1', 'beat', '{\"scroll\":80,\"seconds\":45,\"cta\":2,\"device\":\"mobile\"}') r");
await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-aaaa1', 'started', '{\"scroll\":30,\"seconds\":50}') r");
const [vis] = await raw("select max_scroll, seconds, cta_clicks, device, form_opened, form_started from erp_landing_visits where session_id = 'sesion-aaaa1'");
ok(vis.max_scroll === 80 && vis.seconds === 50 && vis.cta_clicks === 2 && vis.device === "mobile" && vis.form_started, "Guarda hasta dónde bajó, tiempo, clics y si empezó a llenar (sin retroceder)", vis);

console.log("4. Cliente que no terminó");
ok((await anon("select public.landing_lead('vitrina', 'enterizo-relax', 'sesion-bbbb2', '{\"name\":\"Ana Gómez\",\"whatsapp\":\"+57 310 555 1234\",\"selection\":\"2 x Negro\"}') r")).ok, "Guarda el WhatsApp para recuperarlo");

console.log("5. El pedido");
const cust = { name: "María López", whatsapp: "3105551234", document: "1037123456", department: "Risaralda", city: "Pereira", address: "Calle 10 # 20-30", neighborhood: "Centro" };
const order = (s, p) => anon("select public.landing_order('vitrina', 'enterizo-relax', $1, $2::jsonb) r", [s, JSON.stringify(p)]);
ok((await order("sesion-aaaa1", { units: [NEGRO], payment: "cod", customer: { ...cust, name: "María" } })).field === "name", "Pide nombre y apellido");
ok((await order("sesion-aaaa1", { units: [NEGRO], payment: "cod", customer: { ...cust, whatsapp: "123" } })).field === "whatsapp", "WhatsApp de 10 dígitos");
ok((await order("sesion-aaaa1", { units: [NEGRO], payment: "cod", customer: { ...cust, document: "" } })).field === "document", "Pide la cédula si la landing la pide");
ok((await order("sesion-aaaa1", { units: [AJENO], payment: "cod", customer: cust })).ok === false, "No deja pedir productos que no son de la landing");
ok((await order("sesion-aaaa1", { units: [BLANCO, BLANCO], payment: "cod", customer: cust })).code === "STOCK", "Respeta las existencias reales (solo queda 1 blanco)");
const o1 = await order("sesion-bbbb2", { units: [NEGRO, BLANCO], payment: "cod", customer: { ...cust, whatsapp: "3105551234" }, ref: { source: "facebook", campaign: "oct" } });
ok(o1.ok && Number(o1.total) === 2 * 91900, "Lleva 2: −8 % a cada una (99.900 → 91.900)", o1);
const [ord] = await raw("select o.total, o.customer_note, (select array_agg(price order by price) from order_items where order_id = o.id) prices from orders o where o.id = $1", [o1.order_id]);
ok(Number(ord.total) === 183800 && ord.customer_note.includes("Contraentrega") && ord.customer_note.includes("Pereira") && ord.customer_note.includes("facebook"), "El pedido llega con pago, dirección y de dónde vino", ord);
const o2 = await order("sesion-aaaa1", { units: [NEGRO], payment: "online", upsell: true, customer: { ...cust, name: "Juana Ríos", whatsapp: "3209998877", city: "Medellín" } });
ok(o2.ok && Number(o2.total) === 94900 + 22800, "En línea −5 % y adicional −20 % −5 % (correa 30.000 → 22.800)", o2);
const o3 = await order("sesion-exit0001", { units: [NEGRO], payment: "cod", exit: true, customer: { ...cust, name: "Laura Gil", whatsapp: "3157776655" } });
ok(o3.ok && Number(o3.total) === 94900, "Oferta de salida: −5 % real (99.900 → 94.900)", o3);
await raw("update orders set status = 'cancelled' where id = $1", [o3.order_id]);
ok((await order("sesion-aaaa1", { units: [NEGRO, NEGRO, NEGRO, NEGRO], payment: "cod", customer: cust })).ok === false, "Un paquete que no existe no se acepta");
ok((await order("sesion-aaaa1", { units: [NEGRO], payment: "nada", customer: cust })).field === "payment", "Forma de pago desconocida no");

console.log("6. Lo social real y el panel");
const soc = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
ok(soc.sold_week === 3 && soc.recent.length === 2 && soc.recent[0].name === "Juana" && soc.recent[0].city === "Medellín", "«Juana de Medellín pidió…»: solo primer nombre y ciudad", soc);
ok(!JSON.stringify(soc).includes("310555") && !JSON.stringify(soc).includes("Calle"), "Nunca muestra teléfono ni dirección");
const st = await one(MKT, "select public.erp_landing_stats($1, $2, 30) r", [A, PAGE]);
ok(st.totals.orders === 2 && Number(st.totals.revenue) === 183800 + 117700 && st.totals.online === 1 && st.totals.upsells === 1, "Estadísticas: pedidos, ventas, pagos y adicionales", st.totals);
ok(st.totals.started === 2 && st.totals.scroll50 === 1 && st.totals.mobile === 1 && st.totals.avg_seconds === 50, "Embudo: bajó, abrió, empezó a llenar y compró", st.totals);
ok(st.by_source.find((s) => s.source === "facebook")?.orders === 2, "Ventas por fuente: las dos visitas que compraron llegaron por Facebook", st.by_source);
ok(st.leads.length === 0, "Quien terminó el pedido sale de «por recuperar»", st.leads);
const list = await one(MKT, "select public.erp_landing_list($1) r", [A]);
ok(list.items[0].orders_7d === 2, "La lista muestra pedidos de la semana");
ok(!(await one(CAJA, "select public.erp_landing_stats($1, $2, 30) r", [A, PAGE])).ok, "El cajero no ve las estadísticas");

console.log("6b. Resultados por aparte: WhatsApp, pauta, costo y ganancia");
await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-bbbb2', 'whatsapp', '{}') r");
await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-bbbb2', 'whatsapp', '{}') r");
await anon("select public.landing_ping('vitrina', 'enterizo-relax', 'sesion-aaaa1', 'share', '{}') r");
await raw("update products set cost_price = 40000 where id in ($1, $2)", [NEGRO, BLANCO]);
await raw("update products set cost_price = 10000 where id = $1", [CORREA]);
ok(!(await one(MKT, "select public.erp_landing_spend_save($1, $2, (now() + interval '3 days')::date, 50000, 'facebook', null) r", [A, PAGE])).ok, "La pauta no se anota en fechas futuras");
ok((await one(MKT, "select public.erp_landing_spend_save($1, $2, (now() at time zone 'America/Bogota')::date, 60000, 'facebook', 'Campaña octubre') r", [A, PAGE])).ok, "Se anota la inversión en pauta");
await raw("insert into store_users (store_id, user_id, role, permissions, username) values ($1, $2, 'seller', '{products,costs_view}', 'gerente')", [A, U(5)]);
const sum = await one(U(5), "select public.erp_landing_summary($1, 30) r", [A]);
const m = sum.items.find((x) => x.id === PAGE);
// Ventas 183.800 + 117.700 = 301.500; costo 3 enterizos × 40.000 + correa 10.000 = 130.000; pauta 60.000.
ok(m.wa_people === 1 && m.wa_clicks === 2 && m.shares === 1, "Cuenta quién escribió por WhatsApp y quién compartió", m);
ok(Number(m.revenue) === 301500 && Number(m.cost) === 130000 && Number(m.spend) === 60000 && Number(m.profit) === 111500, "Ganancia real = ventas − costo − pauta", m);
ok(Number(m.roas) === 5.03 && Number(m.cpa) === 30000, "Retorno de la pauta y costo por pedido", m);
const sumNoCost = await one(MKT, "select public.erp_landing_summary($1, 30) r", [A]);
ok(sumNoCost.items.find((x) => x.id === PAGE).profit === null && sumNoCost.costs === false, "Sin permiso de ver costos no ve costo ni ganancia");
const st2 = await one(MKT, "select public.erp_landing_stats($1, $2, 30) r", [A, PAGE]);
ok(st2.spend.length === 1 && Number(st2.money.spend) === 60000, "Las estadísticas traen la pauta", st2.money);
ok((await one(MKT, "select public.erp_landing_spend_delete($1, $2) r", [A, st2.spend[0].id])).ok, "Se puede borrar una inversión mal anotada");

console.log("6c. Plantillas propias");
const tp = await one(MKT, "select public.erp_landing_template_save($1, 'Mi estilo', '💎', $2::jsonb) r", [A, JSON.stringify({ ...config, images: ["https://x.co/1.jpg"], meta_pixel_id: "123456789", headline: "Hola" })]);
ok(tp.ok, "Guarda la landing como plantilla propia");
const tl = await one(MKT, "select public.erp_landing_templates_list($1) r", [A]);
ok(tl.items.length === 1 && tl.items[0].config.headline === "Hola" && !("images" in tl.items[0].config) && !("meta_pixel_id" in tl.items[0].config), "La plantilla guarda diseño y textos, sin fotos ni píxeles", tl.items[0].config);
ok((await one(MKT, "select public.erp_landing_template_save($1, 'Mi estilo', '🔥', '{}'::jsonb) r", [A])).ok && (await one(MKT, "select public.erp_landing_templates_list($1) r", [A])).items.length === 1, "Mismo nombre la reemplaza");
ok(!(await one(CAJA, "select public.erp_landing_templates_list($1) r", [A])).ok, "El cajero no ve las plantillas");
ok((await one(MKT, "select public.erp_landing_template_delete($1, $2) r", [A, tp.id])).ok, "Se borra la plantilla");

console.log("7. Pausar, duplicar y borrar");
await one(MKT, "select public.erp_landing_set_status($1, $2, 'paused') r", [A, PAGE]);
ok(!(await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).ok, "Pausada no se ve");
const dup = await one(MKT, "select public.erp_landing_duplicate($1, $2) r", [A, PAGE]);
ok(dup.ok && dup.slug === "enterizo-relax-2", "Duplica con otro enlace", dup);
ok((await one(MKT, "select public.erp_landing_delete($1, $2) r", [A, PAGE])).archived === true, "Con pedidos se archiva (no se borra)");
ok((await one(MKT, "select public.erp_landing_delete($1, $2) r", [A, dup.id])).archived === false, "Sin pedidos se borra");
ok((await raw("select count(*)::int n from erp_landing_orders"))[0].n === 3, "Los pedidos quedan intactos");

console.log("8. Freno a pedidos repetidos");
await one(MKT, "select public.erp_landing_set_status($1, $2, 'published') r", [A, PAGE]);
for (let i = 0; i < 2; i++) await order("sesion-zzzz9", { units: [NEGRO], payment: "cod", customer: { ...cust, whatsapp: "3001112233" } });
const lim = await order("sesion-zzzz9", { units: [NEGRO], payment: "cod", customer: { ...cust, whatsapp: "3001112233" } });
const lim2 = await order("sesion-zzzz9", { units: [NEGRO], payment: "cod", customer: { ...cust, whatsapp: "3001112233" } });
ok(lim.ok && lim2.code === "LIMIT", "Más de 3 pedidos por hora desde el mismo navegador se frenan", lim2);

console.log("9. Contadores configurables (reales) y reinicio");
const cfgWith = async (u) => { const g = (await one(MKT, "select public.erp_landing_get($1, $2) r", [A, PAGE])).page; return save(MKT, PAGE, { name: g.name, slug: g.slug, status: "published", catalog_id: g.catalog_id, product_ids: g.product_ids, config: { ...g.config, urgency: { ...(g.config.urgency ?? {}), ...u } } }); };
await raw("update erp_landing_visits set last_seen = now() - interval '30 minutes' where session_id = 'sesion-cccc3'");
ok((await cfgWith({ viewers_window: "now" })).ok, "Se guarda el periodo de «viendo»");
const sNow = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
await cfgWith({ viewers_window: "1h", sold_window: "today", recent_hours: 24 });
const s1h = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
ok(s1h.live > sNow.live && s1h.live_window === "1h", "«En la última hora» cuenta más visitas reales que «ahora»", [sNow.live, s1h.live]);
ok(s1h.sold_window === "today" && s1h.sold_week >= 3, "Vendidos de hoy", s1h);
ok((await one(CAJA, "select public.erp_landing_reset_counters($1, $2) r", [A, PAGE])).ok === false, "El cajero no reinicia contadores");
ok((await one(MKT, "select public.erp_landing_reset_counters($1, $2) r", [A, PAGE])).ok, "Reiniciar contadores");
const sReset = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
ok(sReset.live === 0 && sReset.sold_week === 0 && sReset.recent.length === 0, "Después de reiniciar, lo público arranca en cero", sReset);
ok((await one(MKT, "select public.erp_landing_stats($1, $2, 30) r", [A, PAGE])).totals.orders >= 2, "Las estadísticas y la ganancia no se borran al reiniciar");

console.log("10. Precio propio de la landing");
const g10 = (await one(MKT, "select public.erp_landing_get($1, $2) r", [A, PAGE])).page;
const cfg10 = { ...g10.config, sale_price: 129900, option_prices: { [BLANCO]: 139900 }, exit_offer: { enabled: false } };
ok((await save(MKT, PAGE, { name: g10.name, slug: g10.slug, status: "published", catalog_id: g10.catalog_id, product_ids: g10.product_ids, config: cfg10 })).ok, "Se guarda el precio de la landing");
const pub10 = await anon("select public.landing_public('vitrina', 'enterizo-relax') r");
const negro10 = pub10.items.find((i) => i.id === NEGRO), blanco10 = pub10.items.find((i) => i.id === BLANCO);
ok(Number(negro10.price) === 129900 && Number(negro10.catalog_price) === 99900, "La página muestra el precio de la landing (más caro que el catálogo)", negro10);
ok(Number(blanco10.price) === 139900, "Una opción puede tener su propio precio", blanco10);
ok(Number(pub10.upsell.price) === 30000, "El adicional sigue con su precio del catálogo", pub10.upsell);
await raw("update products set stock = 10 where id = $1", [BLANCO]);
const o10 = await order("sesion-precio001", { units: [NEGRO, BLANCO], payment: "cod", customer: { ...cust, name: "Paula Mesa", whatsapp: "3014445566" } });
// Lleva 2 (−8 %): 129.900 → 119.500 y 139.900 → 128.700.
ok(o10.ok && Number(o10.total) === 119500 + 128700, "El pedido cobra el precio de la landing con el descuento del paquete encima", o10);
ok(Number((await raw("select price_3 from products where id = $1", [NEGRO]))[0].price_3) === 99900, "El precio del producto en la tienda no cambia");

console.log("11. El catálogo de producción devuelve una lista JSON (no filas)");
await db.exec(`drop function public.catalog_public_stock(text, text, text, uuid[]);
create function public.catalog_public_stock(p_store text, p_catalog text, p_key text, p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $q$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', case when p.price_3 > 0 then p.price_3 end, 'stock', p.stock)), '[]'::jsonb)
  from public.products p join public.stores s on s.id = p.store_id and s.slug = p_store
  join public.store_catalogs c on c.store_id = s.id and c.slug = p_catalog and (c.access_key is null or c.access_key = p_key)
  where p.id = any(p_ids) and p.active
$q$;
grant execute on function public.catalog_public_stock(text, text, text, uuid[]) to anon, authenticated;`);
const pub11 = await anon("select public.landing_public('vitrina', 'enterizo-relax') r");
ok(pub11.items.length === 2 && Number(pub11.items[0].catalog_price) === 99900, "Con la lista JSON la landing sí trae los productos (antes decía «se agotó»)", pub11.items);
const o11 = await order("sesion-json0001", { units: [NEGRO], payment: "cod", customer: { ...cust, name: "Sara Lema", whatsapp: "3023334455" } });
ok(o11.ok, "Y el pedido se crea con esa forma", o11);

console.log("12. Personas que vieron en los últimos 7 y 30 días");
await raw("update erp_landing_pages set counters_from = null where id = $1", [PAGE]);
await raw("insert into erp_landing_visits (page_id, store_id, session_id, first_seen, last_seen) values ($1, $2, 'sesion-vieja0001', now() - interval '20 days', now() - interval '20 days'), ($1, $2, 'sesion-vieja0002', now() - interval '5 days', now() - interval '5 days'), ($1, $2, 'sesion-vieja0003', now() - interval '40 days', now() - interval '40 days')", [PAGE, A]);
await cfgWith({ viewers_window: "today" });
const sToday = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
await cfgWith({ viewers_window: "week" });
const sWeek = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
await cfgWith({ viewers_window: "month" });
const sMonth = (await anon("select public.landing_public('vitrina', 'enterizo-relax') r")).social;
ok(sWeek.live === sToday.live + 1 && sMonth.live === sToday.live + 2 && sMonth.live_window === "month", "Semana y mes cuentan las visitas reales de esos días (la de hace 40 días no)", [sToday.live, sWeek.live, sMonth.live]);

console.log("13. Píxel solo en las landing pages");
await db.exec("create table if not exists public.store_tracking (store_id uuid primary key, meta_pixel_id text)");
const M6 = fs.readFileSync(path.join(MIG, "20261257_pixel_solo_landing.sql"), "utf8");
await db.exec(M6);
await db.exec(M6);
ok((await anon("select public.store_pixel_scope('vitrina') r")).landing_only === false, "Por defecto se mide en toda la tienda");
await raw("insert into store_tracking (store_id, meta_pixel_id, landing_only) values ($1, '123456789', true)", [A]);
ok((await anon("select public.store_pixel_scope('vitrina') r")).landing_only === true, "Con «solo landing pages» la página pública lo sabe");

console.log("14. Panel de pedidos de las landings");
const M7 = fs.readFileSync(path.join(MIG, "20261258_landing_pedidos.sql"), "utf8");
await db.exec(M7);
await db.exec(M7);
await raw("insert into store_users (store_id, user_id, role, permissions, username) values ($1, $2, 'seller', '{orders}', 'pedidos')", [A, U(6)]);
const lo = await one(U(6), "select public.erp_landing_orders_list($1, 30, null) r", [A]);
const firstOrder = lo.items.find((x) => x.source === "facebook");
ok(lo.ok && lo.items.length >= 3 && firstOrder && firstOrder.landing.slug === "enterizo-relax" && firstOrder.items.length > 0 && String(firstOrder.customer_whatsapp).length === 10, "Quien atiende pedidos ve los pedidos de las landings con cliente, productos y landing", firstOrder);
ok(firstOrder.note.includes("Pereira") && firstOrder.source === "facebook", "Con la nota (dirección) y de qué red llegó");
ok(!(await one(MKT, "select public.erp_landing_orders_list($1, 30, null) r", [A])).ok, "Sin permiso de pedidos no ve los datos de los clientes");
ok((await one(U(6), "select public.erp_landing_orders_list($1, 30, $2) r", [A, "00000000-0000-4000-8000-000000000000"])).items.length === 0, "Se puede filtrar por landing");

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
