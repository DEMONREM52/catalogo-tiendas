-- =====================================================================
-- REMHUB · Factura de inventario inicial (100 und. por producto) · 1) REVISAR
--
-- Solo consulta: NO cambia nada. Ejecuta el archivo completo y revisa.
-- Si todo se ve bien, ejecuta «inventario_inicial_100_aplicar.sql».
-- =====================================================================

-- A. ¿Qué tienda, bodega y proveedor se usan? (debe salir UNA fila, ya_hecho = 0)
with t as (
  select p.store_id from public.erp_suppliers p where p.name ilike 'INGRESO INICIAL DE INVENTARIO%' group by p.store_id
)
select s.name as tienda,
       (select count(*) from t) as tiendas_con_proveedor_inicial,          -- debe ser 1
       (select w.name from public.erp_warehouses w where w.store_id = s.id and w.active and coalesce(w.kind, 'warehouse') = 'warehouse'
         order by w.is_default desc, w.created_at limit 1) as bodega_destino,
       (select count(*) from public.products pr where pr.store_id = s.id) as productos,
       (select count(*) from public.erp_purchases pu where pu.store_id = s.id and pu.invoice_ref = 'INVENTARIO-INICIAL-100') as ya_hecho
from public.stores s where s.id in (select store_id from t);

-- B. Producto por producto: de dónde sale el costo y con cuánto queda.
with t as (
  select p.store_id from public.erp_suppliers p where p.name ilike 'INGRESO INICIAL DE INVENTARIO%' group by p.store_id
), real_cost as (
  select distinct on (i.product_id) i.product_id, i.unit_cost
  from public.erp_purchase_items i
  join public.erp_purchases pu on pu.id = i.purchase_id
  join public.erp_suppliers su on su.id = pu.supplier_id
  where pu.status = 'received' and su.name not ilike 'INGRESO INICIAL DE INVENTARIO%' and i.unit_cost > 0
  order by i.product_id, pu.created_at desc
)
select pr.name, pr.sku, pr.active as activo, pr.stock as unidades_hoy, pr.cost_price as costo_hoy, pr.price_2,
       case when rc.unit_cost is not null then 'factura real' when coalesce(pr.price_2, 0) > 0 then 'precio 2 − 15 %' else 'SIN COSTO: no se ingresa' end as origen_costo,
       coalesce(rc.unit_cost, case when coalesce(pr.price_2, 0) > 0 then ceil(pr.price_2 / 1.15 / 100) * 100 end) as costo_nuevo,
       coalesce(pr.stock, 0) + 100 as unidades_quedan
from public.products pr
join t on t.store_id = pr.store_id
left join real_cost rc on rc.product_id = pr.id
order by (rc.unit_cost is null and coalesce(pr.price_2, 0) <= 0) desc, pr.name;
