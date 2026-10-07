-- =====================================================================
-- REMHUB · SEDE MANHATTAN con 1000 unidades de cada producto
--
--   · Deja TODOS los productos activos con 1000 unidades en el punto
--     "SEDE MANHATTAN" (para mostrarlos en su catálogo).
--   · Cada cambio queda en el kardex como ajuste.
--   · No toca ningún otro punto ni la bodega; el total de cada producto se
--     recalcula como la suma de todos sus lugares.
--
-- Cómo usarlo (Supabase → SQL Editor):
--   PASO 1 → ejecuta la VISTA PREVIA y revisa que encuentre el punto.
--   PASO 2 → ejecuta el AJUSTE. Si algo falla, no cambia nada.
-- =====================================================================


-- PASO 1 · VISTA PREVIA (no cambia nada)
select w.name as punto, s.name as tienda,
       (select count(*) from public.products p where p.store_id = w.store_id and p.active) as productos_que_quedan_en_1000,
       (select count(*) from public.erp_stock_levels l where l.warehouse_id = w.id and l.qty <> 0) as productos_con_unidades_hoy
from public.erp_warehouses w
join public.stores s on s.id = w.store_id
where w.name ilike '%manhattan%';


-- PASO 2 · AJUSTE
do $$
declare
  c_point constant text    := '%manhattan%';  -- punto a llenar
  c_units constant integer := 1000;           -- unidades por producto
  v_wh uuid; v_store uuid; v_n integer; v_changed integer := 0; r record;
begin
  select count(*) into v_n from public.erp_warehouses where name ilike c_point;
  if v_n <> 1 then raise exception 'Se esperaba 1 punto que coincida con "%", hay %.', c_point, v_n; end if;
  select id, store_id into v_wh, v_store from public.erp_warehouses where name ilike c_point;

  for r in
    select p.id, coalesce(l.qty, 0) as qty
    from public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = v_wh
    where p.store_id = v_store and p.active
  loop
    insert into public.erp_stock_levels (warehouse_id, product_id, store_id, qty) values (v_wh, r.id, v_store, c_units)
    on conflict (warehouse_id, product_id) do update set qty = c_units, updated_at = now();
    if r.qty <> c_units then
      insert into public.inventory_movements (store_id, product_id, kind, qty, note, ref_type, warehouse_id, movement_type, qty_before, qty_after, reason)
      values (v_store, r.id, case when c_units > r.qty then 'in' else 'out' end, abs(c_units - r.qty),
              'Carga de inventario para catálogo', 'adjustment', v_wh, 'adjustment', r.qty, c_units, 'Inventario inicial SEDE MANHATTAN');
      v_changed := v_changed + 1;
    end if;
  end loop;

  -- Total de cada producto = suma de todos sus lugares (sin mover la bodega principal).
  perform set_config('erp.skip_sync', '1', true);
  update public.products p
  set stock = coalesce((select sum(l.qty) from public.erp_stock_levels l where l.product_id = p.id), 0)
  where p.store_id = v_store and p.active;
  perform set_config('erp.skip_sync', '0', true);

  raise notice '✅ SEDE MANHATTAN quedó con % unidades por producto (% productos ajustados).', c_units, v_changed;
end $$;
