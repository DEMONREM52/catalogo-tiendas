-- =====================================================================
-- REMHUB · Factura de inventario inicial (100 und. por producto) · 2) APLICAR
--
-- ANTES: ejecuta la migración 20261119_costo_promedio_y_precio_directo.sql.
-- EJECUTA ESTE ARCHIVO COMPLETO (Ctrl+A y Run). Es un solo bloque: o pasa todo, o nada.
--
--   · Crea UNA factura del proveedor «INGRESO INICIAL DE INVENTARIO», número
--     INVENTARIO-INICIAL-100, de contado, con 100 und. de cada producto hacia
--     la BODEGA PRINCIPAL. Usa la misma función que la pantalla de ingreso de
--     factura (kardex, existencias y comprobante quedan normales).
--   · Costo de cada producto:
--       - si ya tiene una factura REAL de un proveedor → ese costo (ej. 47.900);
--       - si no → precio 2 menos el 15 % que se le había sumado, hacia arriba
--         al $100 (ej. 46.000 → 40.000).
--     Ese queda como costo del producto (sin mezclarlo con unidades sin costo).
--   · Los precios NO cambian. El % de ganancia de cada precio se ajusta para
--     que coincida con el precio actual (así una próxima factura no los mueve
--     de golpe).
--   · Productos sin precio 2 y sin factura real: se omiten (no hay con qué costear).
--   · Si ya se hizo (existe INVENTARIO-INICIAL-100), se detiene sin cambiar nada.
--   · Guarda copia de costos, precios y % en backup_inventario_inicial_100.
-- =====================================================================
do $$
declare
  v_store uuid; v_owner uuid; v_supplier uuid; v_wh uuid; v_wh_name text; v_cnt integer;
  v_items jsonb; v_purchase uuid; v_lines integer; v_skipped integer;
begin
  -- ---------- Comprobaciones
  select count(distinct store_id) into v_cnt from public.erp_suppliers where name ilike 'INGRESO INICIAL DE INVENTARIO%';
  if v_cnt <> 1 then raise exception 'Se esperaba 1 tienda con el proveedor «INGRESO INICIAL DE INVENTARIO» y hay %. No se cambió nada.', v_cnt; end if;
  select store_id, id into v_store, v_supplier from public.erp_suppliers where name ilike 'INGRESO INICIAL DE INVENTARIO%' order by created_at limit 1;
  select owner_id into v_owner from public.stores where id = v_store;
  select id, name into v_wh, v_wh_name from public.erp_warehouses
  where store_id = v_store and active and coalesce(kind, 'warehouse') = 'warehouse' order by is_default desc, created_at limit 1;
  if v_wh is null then raise exception 'La tienda no tiene una bodega principal activa. No se cambió nada.'; end if;
  if exists (select 1 from public.erp_purchases where store_id = v_store and invoice_ref = 'INVENTARIO-INICIAL-100') then
    raise exception 'Esto ya se hizo: existe la factura INVENTARIO-INICIAL-100. No se cambió nada.';
  end if;

  -- ---------- Costo de cada producto
  create temporary table zz_costos on commit drop as
  with real_cost as (
    select distinct on (i.product_id) i.product_id, i.unit_cost
    from public.erp_purchase_items i
    join public.erp_purchases pu on pu.id = i.purchase_id
    join public.erp_suppliers su on su.id = pu.supplier_id
    where pu.store_id = v_store and pu.status = 'received' and su.name not ilike 'INGRESO INICIAL DE INVENTARIO%' and i.unit_cost > 0
    order by i.product_id, pu.created_at desc
  )
  select pr.id as product_id,
         coalesce(rc.unit_cost, case when coalesce(pr.price_2, 0) > 0 then ceil(pr.price_2 / 1.15 / 100) * 100 end) as cost
  from public.products pr left join real_cost rc on rc.product_id = pr.id
  where pr.store_id = v_store;
  select count(*) into v_skipped from zz_costos where cost is null or cost <= 0;
  delete from zz_costos where cost is null or cost <= 0;
  select count(*) into v_lines from zz_costos;
  if v_lines = 0 then raise exception 'No hay productos con costo para ingresar. No se cambió nada.'; end if;

  -- ---------- Copia de seguridad
  create table if not exists public.backup_inventario_inicial_100 (id uuid primary key, datos jsonb not null, copiado_en timestamptz not null default now());
  alter table public.backup_inventario_inicial_100 enable row level security;
  revoke all on public.backup_inventario_inicial_100 from anon, authenticated;
  insert into public.backup_inventario_inicial_100 (id, datos)
  select pr.id, to_jsonb(pr) from public.products pr where pr.id in (select product_id from zz_costos)
  on conflict (id) do nothing;

  -- ---------- Factura (con la misma función de la pantalla, a nombre del dueño de la tienda)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('erp.skip_reprice', '1', true);   -- los precios no se mueven
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', 100, 'unit_cost', cost, 'tax_rate', 0, 'warehouse_id', v_wh))
  into v_items from zz_costos;
  v_purchase := public.erp_receive_invoice(
    p_store => v_store, p_supplier => v_supplier, p_invoice_ref => 'INVENTARIO-INICIAL-100', p_invoice_date => current_date,
    p_payment_type => 'cash', p_due_date => null, p_notes => 'Inventario inicial: 100 und. por producto a la bodega principal',
    p_checked_by => 'Sistema (inventario inicial)', p_items => v_items);

  -- ---------- Costo exacto y % de ganancia que respeta los precios actuales
  update public.products pr set cost_price = c.cost, updated_at = now()
  from zz_costos c where c.product_id = pr.id;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'markup_1') then
    execute $q$
      update public.products pr set
        markup_1 = case when pr.price_1 >= c.cost then least(round((pr.price_1 / c.cost - 1) * 100, 4), 1000) end,
        markup_2 = case when pr.price_2 >= c.cost then least(round((pr.price_2 / c.cost - 1) * 100, 4), 1000) end,
        markup_3 = case when pr.price_3 >= c.cost then least(round((pr.price_3 / c.cost - 1) * 100, 4), 1000) end,
        markup_4 = case when pr.price_4 >= c.cost then least(round((pr.price_4 / c.cost - 1) * 100, 4), 1000) end,
        markup_5 = case when pr.price_5 >= c.cost then least(round((pr.price_5 / c.cost - 1) * 100, 4), 1000) end
      from zz_costos c where c.product_id = pr.id
    $q$;
  end if;
  perform set_config('erp.skip_reprice', '', true);

  raise notice 'Listo ✅ Factura INVENTARIO-INICIAL-100: % productos × 100 und. a «%». Omitidos sin costo: %.', v_lines, v_wh_name, v_skipped;
end $$;

-- Revisa: ejecuta otra vez «inventario_inicial_100_revisar.sql» (ya_hecho = 1),
-- y en la app: Inventario → Ingreso de factura → INVENTARIO-INICIAL-100.
