-- SOLO LECTURA (una consulta, no cambia nada): productos creados con la remisión 001695 de RAUL ALBERTO
-- SALAZAR ZULUAGA que podrían estar repetidos con uno que ya existía.
-- Compara sin guiones, espacios ni palabras de relleno (DE, LA, EL, PARA, CON, Y), y por la referencia del modelo
-- (las palabras con números: VTCK168, WB999, HS887…). Una fila por posible repetido; «sin parecido» si no hay.
with tienda as (
  select id from public.stores where upper(btrim(name)) = 'LA VITRINA'
),
nuevos as (
  select p.id, p.sku, p.name, p.stock,
         regexp_replace(regexp_replace(upper(p.name), '\m(DE|LA|EL|LOS|LAS|PARA|CON|Y)\M', '', 'g'), '[^A-Z0-9]', '', 'g') as norm,
         array(select regexp_replace(w, '[^A-Z0-9]', '', 'g') from regexp_split_to_table(upper(p.name), '\s+') w
               where w ~ '[0-9]' and length(regexp_replace(w, '[^A-Z0-9]', '', 'g')) >= 3) as modelos
  from public.products p join tienda t on t.id = p.store_id
  where p.sku in ('MV-879T','MV-759','PO-818','MW-WB999','LU-HS887','K41-COMBO','PF-X311BT','TB-2442A','IB-VTCK168','AP-K7','LU-SUNQY8')
),
otros as (
  select p.id, p.sku, p.name, p.product_no, p.stock, p.active, p.created_at,
         regexp_replace(regexp_replace(upper(p.name), '\m(DE|LA|EL|LOS|LAS|PARA|CON|Y)\M', '', 'g'), '[^A-Z0-9]', '', 'g') as norm,
         regexp_replace(upper(coalesce(p.name, '') || ' ' || coalesce(p.sku, '') || ' ' || coalesce(p.barcode, '')), '[^A-Z0-9]', '', 'g') as todo
  from public.products p join tienda t on t.id = p.store_id
  where p.id not in (select id from nuevos)
)
select n.sku as codigo_nuevo, n.name as producto_nuevo, n.stock as und_nuevo,
       o.name as ya_existia, o.sku as codigo_existente, o.product_no as numero, o.stock as und_existente, o.active as activo,
       case when o.id is null then 'sin parecido'
            when o.norm = n.norm then 'MISMO NOMBRE (sin guiones ni DE)'
            else 'misma referencia: ' || (select string_agg(m, ', ') from unnest(n.modelos) m where o.todo like '%' || m || '%') end as por_que,
       n.id as id_nuevo, o.id as id_existente
from nuevos n
left join otros o on o.norm = n.norm or exists (select 1 from unnest(n.modelos) m where o.todo like '%' || m || '%')
order by n.sku, (o.norm = n.norm) desc nulls last, o.name;
