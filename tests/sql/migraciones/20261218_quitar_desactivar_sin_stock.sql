-- =====================================================================
-- REMHUB · Quitar el proceso viejo que apagaba productos sin unidades
--
-- El activador trg_products_auto_deactivate_when_stock_zero apagaba TODO
-- producto con 0 unidades, también los recién creados. Lo reemplaza
-- erp_products_active_by_stock (20261210):
--   · un producto nuevo queda activo aunque no tenga unidades;
--   · se apaga solo cuando TENÍA unidades y se queda en 0 en todos lados;
--   · se vuelve a prender solo cuando le entran unidades (si lo apagó el
--     sistema).
-- La función vieja se deja (sin usar) por si hace falta revisarla.
-- La protección zzz_products_keep_active (20261216) sigue como respaldo.
-- Requiere 20261210. No cambia productos. Idempotente.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'erp_products_active_by_stock' and tgrelid = 'public.products'::regclass) then
    raise exception 'Primero ejecuta 20261210_productos_activos_por_unidades.sql (es el que reemplaza al proceso viejo).';
  end if;
end $$;

drop trigger if exists trg_products_auto_deactivate_when_stock_zero on public.products;

notify pgrst, 'reload schema';

-- Productos que hoy están INACTIVOS, sin unidades y que NUNCA tuvieron movimientos de inventario:
-- casi seguro los apagó el proceso viejo al crearlos. Revisa la lista (no cambia nada).
-- Si quieres activarlos todos, ejecuta aparte el UPDATE de abajo (quítale los «--»).
select p.id, p.name, p.sku, p.created_at::date as creado
from public.products p
where coalesce(p.active, true) = false and coalesce(p.stock, 0) <= 0
  and not exists (select 1 from public.inventory_movements m where m.product_id = p.id)
order by p.created_at desc;

-- update public.products p set active = true
-- where coalesce(p.active, true) = false and coalesce(p.stock, 0) <= 0
--   and not exists (select 1 from public.inventory_movements m where m.product_id = p.id);
