-- =====================================================================
-- REMHUB · Ingreso #1 a la BODEGA + traslado a SEDE ZAMORA · 1) REVISAR
--
-- Solo consulta, NO cambia nada. Ejecuta este archivo completo y revisa:
--   A. El ingreso, la bodega y el punto que se van a usar (una fila).
--   B. Producto por producto: unidades, costo nuevo y cómo queda Zamora.
-- Si todo se ve bien, ejecuta «ingreso_1_a_bodega_2_aplicar.sql».
-- =====================================================================

-- A. ¿Qué se va a usar?
with pu as (
  select p.* from public.erp_purchases p join public.erp_suppliers s on s.id = p.supplier_id
  where p.number = 1 and s.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received'
), bodegas as (
  select w.* from public.erp_warehouses w join pu on pu.store_id = w.store_id
  where w.active and coalesce(w.kind, 'warehouse') = 'warehouse'
)
select
  (select count(*) from pu) as ingresos_encontrados,                -- debe ser 1
  (select w.name from public.erp_warehouses w join pu on pu.warehouse_id = w.id) as hoy_esta_en,
  (select string_agg(name, ' | ') from bodegas) as bodegas_activas,  -- se usa la única (o la principal)
  (select string_agg(w.name, ' | ') from public.erp_warehouses w join pu on pu.store_id = w.store_id
     where w.active and w.name ilike '%zamora%') as punto_zamora,    -- debe ser 1
  (select total from pu) as total_hoy,
  (select round(sum(it.qty * coalesce(case when coalesce(pr.price_2, 0) > 0 and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088)
                                       then ceil(pr.price_2 / 1.15 / 100) * 100 end, it.unit_cost) * (1 + coalesce(it.tax_rate, 0) / 100)), 2)
     from public.erp_purchase_items it join public.products pr on pr.id = it.product_id join pu on pu.id = it.purchase_id) as total_nuevo,
  (select count(*) from public.erp_transfers t join pu on pu.store_id = t.store_id where t.notes like 'Ingreso #1 a bodega%') as ya_hecho;  -- debe ser 0

-- B. Producto por producto.
with pu as (
  select p.* from public.erp_purchases p join public.erp_suppliers s on s.id = p.supplier_id
  where p.number = 1 and s.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received'
), z as (
  select w.id from public.erp_warehouses w join pu on pu.store_id = w.store_id where w.active and w.name ilike '%zamora%'
), lineas as (
  select it.product_id, sum(it.qty)::integer as unidades, max(it.unit_cost) as costo_factura_hoy
  from public.erp_purchase_items it join pu on pu.id = it.purchase_id group by it.product_id
)
select pr.name as producto, pr.sku,
       l.unidades as unidades_factura,
       coalesce((select sum(case when im.kind = 'in' then im.qty else -im.qty end) from public.inventory_movements im, pu
                 where im.product_id = l.product_id and im.ref_id = pu.id and im.warehouse_id = pu.warehouse_id), 0)::integer as entraron_hoy_por_el_ingreso,
       coalesce((select qty from public.erp_stock_levels sl, z where sl.warehouse_id = z.id and sl.product_id = l.product_id), 0) as zamora_hoy,
       l.unidades - coalesce((select sum(case when im.kind = 'in' then im.qty else -im.qty end) from public.inventory_movements im, pu
                 where im.product_id = l.product_id and im.ref_id = pu.id and im.warehouse_id = pu.warehouse_id), 0)::integer
         + coalesce((select qty from public.erp_stock_levels sl, z where sl.warehouse_id = z.id and sl.product_id = l.product_id), 0) as zamora_queda,
       l.costo_factura_hoy,
       case when coalesce(pr.price_2, 0) > 0 and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088)
            then ceil(pr.price_2 / 1.15 / 100) * 100 else l.costo_factura_hoy end as costo_nuevo,
       (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088) as costo_se_respeta_1088
from lineas l join public.products pr on pr.id = l.product_id
order by (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088) desc, pr.name;
-- «zamora_queda» debe ser igual a «zamora_hoy» (salvo que la factura y el kardex no coincidan:
--  entonces Zamora queda con lo que dice la factura menos lo ya vendido).
