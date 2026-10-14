-- =====================================================================
-- REMHUB · Igualar precios a partir del PRECIO 2
--
--   precio 1 = precio 2
--   precio 3 = precio 2
--   precio 4 = precio 2 + 15 %
--   precio 5 = precio 2 + 20 %
--
--   · Solo cambia productos que tienen precio 2 mayor que 0.
--   · No toca el precio 2, el costo, el precio mínimo ni nada más.
--   · Los resultados se redondean al peso (sin decimales).
--   · Antes de cambiar, guarda una copia de los precios actuales en la
--     tabla backup_precios_20261013 para poder deshacerlo (ver al final).
--
-- Ejecuta los pasos en orden en el SQL Editor de Supabase.
-- =====================================================================


-- PASO 1 · (Opcional) Ver cómo quedarían los primeros 50, sin cambiar nada.
select id, name,
       price_1, price_2, price_3, price_4, price_5,
       round(price_2)        as nuevo_precio_1,
       round(price_2)        as nuevo_precio_3,
       round(price_2 * 1.15) as nuevo_precio_4,
       round(price_2 * 1.20) as nuevo_precio_5
from public.products
where coalesce(price_2, 0) > 0
order by name
limit 50;


-- PASO 2 · Copia de seguridad + actualización (todo junto).
begin;

create table if not exists public.backup_precios_20261013 as
select id, store_id, price_1, price_2, price_3, price_4, price_5, price_retail, price_wholesale, now() as copiado_en
from public.products
where coalesce(price_2, 0) > 0;

-- La copia no se expone a la app.
alter table public.backup_precios_20261013 enable row level security;
revoke all on public.backup_precios_20261013 from anon, authenticated;

update public.products
set price_1         = round(price_2),
    price_3         = round(price_2),
    price_4         = round(price_2 * 1.15),
    price_5         = round(price_2 * 1.20),
    price_retail    = round(price_2),   -- la app lo mantiene igual al precio 3
    price_wholesale = price_2           -- la app lo mantiene igual al precio 2
where coalesce(price_2, 0) > 0;

commit;


-- PASO 3 · Revisar el resultado.
select count(*) as productos_actualizados,
       count(*) filter (where price_1 = price_2 and price_3 = price_2) as precio_1_y_3_ok,
       count(*) filter (where price_4 = round(price_2 * 1.15) and price_5 = round(price_2 * 1.20)) as precio_4_y_5_ok
from public.products
where coalesce(price_2, 0) > 0;


-- =====================================================================
-- DESHACER (solo si lo necesitas): vuelve a los precios de la copia.
-- =====================================================================
-- update public.products p
-- set price_1 = b.price_1, price_3 = b.price_3, price_4 = b.price_4, price_5 = b.price_5,
--     price_retail = b.price_retail, price_wholesale = b.price_wholesale
-- from public.backup_precios_20261013 b
-- where b.id = p.id;
