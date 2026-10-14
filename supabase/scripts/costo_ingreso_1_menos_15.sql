-- =====================================================================
-- REMHUB · Costo = precio 2 ÷ 1,15 (redondeado HACIA ARRIBA al $100)
--          para los productos del ingreso #1 «INGRESO INICIAL DE INVENTARIO»,
--          EXCEPTO el producto 1088.
--
--   ej.: 48.000 ÷ 1,15 = 41.739,13 → costo 41.800
--        50.000 ÷ 1,15 = 43.478,26 → costo 43.500
--
--   · Los precios 1 a 5 quedan iguales al precio 2.
--   · No toca las unidades, ni la factura del proveedor, ni lo que se le debe.
--   · Guarda copia de lo anterior en backup_costos_ingreso_1 (para deshacer).
--
-- Cada paso es UNA sola instrucción, sin bloques: puedes ejecutarlos uno por
-- uno o todos juntos. Si algo falla, esa instrucción no cambia nada.
-- =====================================================================


-- PASO 1 · ¿Es el ingreso correcto? Debe salir UNA sola fila.
select p.id, p.number as ingreso, s.name as tienda, sup.name as proveedor, p.created_at, p.total, p.status,
       (select count(*) from public.erp_purchase_items i where i.purchase_id = p.id) as lineas
from public.erp_purchases p
join public.stores s on s.id = p.store_id
join public.erp_suppliers sup on sup.id = p.supplier_id
where p.number = 1
  and sup.name ilike 'INGRESO INICIAL DE INVENTARIO%'
  and p.status = 'received';


-- PASO 2 · Vista previa (no cambia nada). Revisa «costo_nuevo» y «se_excluye».
select pr.name, pr.sku, pr.product_no,
       pr.cost_price as costo_actual,
       pr.price_2,
       ceil(pr.price_2 / 1.15 / 100) * 100 as costo_nuevo,
       (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088) as se_excluye,
       (coalesce(pr.price_2, 0) <= 0) as sin_precio_2_no_se_toca
from public.products pr
where pr.id in (
  select it.product_id
  from public.erp_purchase_items it
  join public.erp_purchases p on p.id = it.purchase_id
  join public.erp_suppliers sup on sup.id = p.supplier_id
  where p.number = 1 and sup.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received'
)
order by se_excluye desc, pr.name;


-- PASO 3 · Copia de seguridad (no cambia ningún producto).
create table if not exists public.backup_costos_ingreso_1 (id uuid primary key, datos jsonb not null, copiado_en timestamptz not null default now());

alter table public.backup_costos_ingreso_1 enable row level security;

revoke all on public.backup_costos_ingreso_1 from anon, authenticated;

-- Guarda cada producto tal como está ahora. Si lo corres dos veces, conserva lo ORIGINAL.
-- Solo copia si hay exactamente UN ingreso #1 con ese nombre.
insert into public.backup_costos_ingreso_1 (id, datos)
select pr.id, to_jsonb(pr)
from public.products pr
where pr.id in (
    select it.product_id
    from public.erp_purchase_items it
    join public.erp_purchases p on p.id = it.purchase_id
    join public.erp_suppliers sup on sup.id = p.supplier_id
    where p.number = 1 and sup.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received'
  )
  and coalesce(pr.price_2, 0) > 0
  and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088)
  and (select count(*) from public.erp_purchases p join public.erp_suppliers sup on sup.id = p.supplier_id
       where p.number = 1 and sup.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received') = 1
on conflict (id) do nothing;

-- ¿Cuántos se van a ajustar? (debe ser más de 0)
select count(*) as productos_a_ajustar from public.backup_costos_ingreso_1;


-- PASO 4 · Ajustar costo y precios (solo los productos guardados en la copia del paso 3).
--          El «set_config» de la última línea evita que los precios se recalculen solos.
update public.products pr
set cost_price      = ceil(pr.price_2 / 1.15 / 100) * 100,
    price_1         = pr.price_2,
    price_3         = pr.price_2,
    price_4         = pr.price_2,
    price_5         = pr.price_2,
    price_retail    = pr.price_2,
    price_wholesale = pr.price_2,
    updated_at      = now()
where pr.id in (select id from public.backup_costos_ingreso_1)
  and set_config('erp.skip_reprice', '1', true) = '1';


-- PASO 5 · (SOLO si ya ejecutaste la migración 20261113) Guardar 15 % de ganancia en cada precio,
--          para que desde ahora los precios se ajusten solos con cada factura.
--          Si dice «column markup_1 does not exist», sáltate este paso: lo demás ya quedó bien.
update public.products pr
set markup_1 = 15, markup_2 = 15, markup_3 = 15, markup_4 = 15, markup_5 = 15
where pr.id in (select id from public.backup_costos_ingreso_1)
  and set_config('erp.skip_reprice', '1', true) = '1';


-- PASO 6 · Revisar.
select pr.name, pr.sku, (b.datos->>'cost_price')::numeric as costo_antes, pr.cost_price as costo_ahora,
       pr.price_1, pr.price_2, pr.price_3, pr.price_4, pr.price_5, pr.stock as unidades
from public.products pr
join public.backup_costos_ingreso_1 b on b.id = pr.id
order by pr.name;

-- El 1088 debe seguir igual:
select name, sku, product_no, cost_price, price_1, price_2, price_3 from public.products
where coalesce(sku, '') = '1088' or coalesce(product_no, 0) = 1088;


-- =====================================================================
-- DESHACER (solo si lo necesitas): vuelve costo y precios a como estaban.
-- Quita los «-- » de la instrucción y ejecútala.
-- =====================================================================
-- update public.products p set
--   cost_price = (b.datos->>'cost_price')::numeric,
--   price_1 = (b.datos->>'price_1')::numeric, price_2 = (b.datos->>'price_2')::numeric, price_3 = (b.datos->>'price_3')::numeric,
--   price_4 = (b.datos->>'price_4')::numeric, price_5 = (b.datos->>'price_5')::numeric,
--   price_retail = (b.datos->>'price_retail')::numeric, price_wholesale = (b.datos->>'price_wholesale')::numeric
-- from public.backup_costos_ingreso_1 b
-- where b.id = p.id and set_config('erp.skip_reprice', '1', true) = '1';
--
-- (y si hiciste el paso 5) quita el 15 %:
-- update public.products p set markup_1 = null, markup_2 = null, markup_3 = null, markup_4 = null, markup_5 = null
-- from public.backup_costos_ingreso_1 b
-- where b.id = p.id and set_config('erp.skip_reprice', '1', true) = '1';
