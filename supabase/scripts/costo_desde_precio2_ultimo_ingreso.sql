-- =====================================================================
-- REMHUB · Costo desde el PRECIO 2 (ganancia del 15 %) para los productos
--          del ÚLTIMO ingreso de factura, excepto el producto 1088
--
--   costo      = precio 2 ÷ 1,15  → redondeado HACIA ARRIBA al $100
--                (ej.: 50.000 ÷ 1,15 = 43.478,26 → 43.500)
--   precio 1-5 = precio 2 (igual en los 5)
--   ganancia   = 15 % guardado en el producto (desde ahora los precios se
--                recalculan solos cuando entre otra factura con otro costo)
--
--   · No toca la factura del proveedor ni lo que se le debe.
--   · No toca el inventario (unidades).
--   · Guarda copia de lo anterior en backup_costos_20261014 (para deshacer).
--
-- ANTES: ejecuta supabase/migrations/20261113_inventario_precios_devoluciones.sql
-- Ejecuta los pasos EN ORDEN en el SQL Editor de Supabase.
-- =====================================================================


-- PASO 1 · ¿Es este el ingreso correcto? (los 5 más recientes; se usa el primero)
select p.number as ingreso, p.invoice_ref as factura, s.name as tienda, p.created_at, p.total,
       (select count(*) from public.erp_purchase_items i where i.purchase_id = p.id) as productos
from public.erp_purchases p join public.stores s on s.id = p.store_id
where p.status = 'received'
order by p.created_at desc
limit 5;


-- PASO 2 · Vista previa (no cambia nada). Revisa la columna «se_excluye».
with ingreso as (
  select id from public.erp_purchases where status = 'received' order by created_at desc limit 1
)
select pr.name, pr.sku, pr.product_no,
       pr.cost_price as costo_actual,
       pr.price_2,
       ceil(pr.price_2 / 1.15 / 100) * 100 as costo_nuevo,
       (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088) as se_excluye
from public.erp_purchase_items it
join ingreso on ingreso.id = it.purchase_id
join public.products pr on pr.id = it.product_id
order by se_excluye desc, pr.name;


-- PASO 3 · Aplicar (todo junto).
begin;

-- Los precios se dejan exactamente iguales al precio 2 (no se recalculan ahora).
select set_config('erp.skip_reprice', '1', true);

create table if not exists public.backup_costos_20261014 as
select pr.id, pr.store_id, pr.cost_price, pr.price_1, pr.price_2, pr.price_3, pr.price_4, pr.price_5,
       pr.price_retail, pr.price_wholesale, pr.markup_1, pr.markup_2, pr.markup_3, pr.markup_4, pr.markup_5, now() as copiado_en
from public.products pr
where pr.id in (
  select it.product_id from public.erp_purchase_items it
  where it.purchase_id = (select id from public.erp_purchases where status = 'received' order by created_at desc limit 1)
);
alter table public.backup_costos_20261014 enable row level security;
revoke all on public.backup_costos_20261014 from anon, authenticated;

update public.products pr
set cost_price      = ceil(pr.price_2 / 1.15 / 100) * 100,
    price_1         = pr.price_2,
    price_3         = pr.price_2,
    price_4         = pr.price_2,
    price_5         = pr.price_2,
    price_retail    = pr.price_2,
    price_wholesale = pr.price_2,
    markup_1 = 15, markup_2 = 15, markup_3 = 15, markup_4 = 15, markup_5 = 15,
    updated_at = now()
where pr.id in (
    select it.product_id from public.erp_purchase_items it
    where it.purchase_id = (select id from public.erp_purchases where status = 'received' order by created_at desc limit 1)
  )
  and coalesce(pr.price_2, 0) > 0
  and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088);

commit;


-- PASO 4 · Revisar.
select pr.name, pr.sku, pr.cost_price as costo, pr.price_1, pr.price_2, pr.price_3, pr.price_4, pr.price_5, pr.markup_2 as ganancia
from public.products pr
join public.backup_costos_20261014 b on b.id = pr.id
order by pr.name;


-- =====================================================================
-- (Opcional) Revisar si algún producto tiene las unidades descuadradas:
-- compara el total del producto con la suma de sus puntos y bodegas.
-- =====================================================================
-- select p.name, p.sku, p.stock as total_producto, coalesce(sum(l.qty), 0) as suma_puntos
-- from public.products p left join public.erp_stock_levels l on l.product_id = p.id
-- group by p.id, p.name, p.sku, p.stock
-- having p.stock is distinct from coalesce(sum(l.qty), 0);

-- =====================================================================
-- DESHACER (solo si lo necesitas): vuelve costos, precios y % a como estaban.
-- =====================================================================
-- begin;
-- select set_config('erp.skip_reprice', '1', true);
-- update public.products p set cost_price = b.cost_price, price_1 = b.price_1, price_2 = b.price_2, price_3 = b.price_3,
--   price_4 = b.price_4, price_5 = b.price_5, price_retail = b.price_retail, price_wholesale = b.price_wholesale,
--   markup_1 = b.markup_1, markup_2 = b.markup_2, markup_3 = b.markup_3, markup_4 = b.markup_4, markup_5 = b.markup_5
-- from public.backup_costos_20261014 b where b.id = p.id;
-- commit;
