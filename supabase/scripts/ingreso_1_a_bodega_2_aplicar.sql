-- =====================================================================
-- REMHUB · Ingreso #1 a la BODEGA + traslado a SEDE ZAMORA · 2) APLICAR
--
-- EJECUTA ESTE ARCHIVO COMPLETO (Ctrl+A y Run). Es un solo bloque:
-- o pasa todo, o no pasa nada.
--
--   1. El ingreso #1 «INGRESO INICIAL DE INVENTARIO» queda en la BODEGA principal.
--   2. Costo de cada línea = precio 2 ÷ 1,15 redondeado HACIA ARRIBA al $100
--      (ej. 48.000 → 41.800), menos el producto 1088 (se respeta su costo).
--      Al producto: ese costo, precios 1 a 5 = precio 2 y 15 % de ganancia.
--   3. Traslado RECIBIDO de la bodega a SEDE ZAMORA con las mismas unidades.
--   4. Se quita la entrada que el ingreso había hecho directo en Zamora,
--      así Zamora queda con lo mismo que tiene hoy (con lo ya vendido).
--
--   Kardex completo: bodega +entrada −traslado, Zamora +traslado −corrección.
--   No borra nada. Guarda copia de todo en backup_ingreso_1_bodega.
--   Si ya se hizo, se detiene sin cambiar nada.
-- =====================================================================
do $$
declare
  v_pu public.erp_purchases;
  v_cnt integer;
  v_b uuid; v_b_name text;
  v_z uuid; v_z_name text;
  v_tr uuid; v_num bigint;
  v_units integer := 0; v_lines integer := 0;
  r record;
begin
  -- ---------- Comprobaciones (si algo no cuadra, no se cambia nada)
  select count(*) into v_cnt from public.erp_purchases p join public.erp_suppliers s on s.id = p.supplier_id
  where p.number = 1 and s.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received';
  if v_cnt <> 1 then raise exception 'Se esperaba 1 ingreso #1 «INGRESO INICIAL DE INVENTARIO» y hay %. No se cambió nada.', v_cnt; end if;
  select p.* into v_pu from public.erp_purchases p join public.erp_suppliers s on s.id = p.supplier_id
  where p.number = 1 and s.name ilike 'INGRESO INICIAL DE INVENTARIO%' and p.status = 'received';

  -- Bodega: la única bodega activa, o la principal si hay varias.
  select count(*) into v_cnt from public.erp_warehouses where store_id = v_pu.store_id and active and coalesce(kind, 'warehouse') = 'warehouse';
  if v_cnt = 1 then
    select id, name into v_b, v_b_name from public.erp_warehouses where store_id = v_pu.store_id and active and coalesce(kind, 'warehouse') = 'warehouse';
  else
    select id, name into v_b, v_b_name from public.erp_warehouses where store_id = v_pu.store_id and active and coalesce(kind, 'warehouse') = 'warehouse' and is_default;
  end if;
  if v_b is null then raise exception 'Hay % bodegas activas y ninguna es la principal. No se cambió nada.', v_cnt; end if;

  select count(*) into v_cnt from public.erp_warehouses where store_id = v_pu.store_id and active and name ilike '%zamora%';
  if v_cnt <> 1 then raise exception 'Se esperaba 1 punto «Zamora» activo y hay %. No se cambió nada.', v_cnt; end if;
  select id, name into v_z, v_z_name from public.erp_warehouses where store_id = v_pu.store_id and active and name ilike '%zamora%';

  if v_b = v_z then raise exception 'La bodega y Zamora son el mismo lugar. No se cambió nada.'; end if;
  if v_pu.warehouse_id = v_b or exists (select 1 from public.erp_transfers where store_id = v_pu.store_id and notes like 'Ingreso #1 a bodega%') then
    raise exception 'Esto ya se hizo: el ingreso #1 ya está en «%». No se cambió nada.', v_b_name;
  end if;

  -- ---------- Copia de seguridad
  create table if not exists public.backup_ingreso_1_bodega (tipo text not null, id uuid, datos jsonb not null, copiado_en timestamptz not null default now());
  alter table public.backup_ingreso_1_bodega enable row level security;
  revoke all on public.backup_ingreso_1_bodega from anon, authenticated;
  insert into public.backup_ingreso_1_bodega (tipo, id, datos) select 'ingreso', v_pu.id, to_jsonb(v_pu);
  insert into public.backup_ingreso_1_bodega (tipo, id, datos)
    select 'linea', it.id, to_jsonb(it) from public.erp_purchase_items it where it.purchase_id = v_pu.id;
  insert into public.backup_ingreso_1_bodega (tipo, id, datos)
    select 'producto', pr.id, to_jsonb(pr) from public.products pr
    where pr.id in (select product_id from public.erp_purchase_items where purchase_id = v_pu.id);
  insert into public.backup_ingreso_1_bodega (tipo, id, datos)
    select 'existencia', sl.product_id, to_jsonb(sl) from public.erp_stock_levels sl
    where sl.product_id in (select product_id from public.erp_purchase_items where purchase_id = v_pu.id);

  -- Los precios quedan iguales al precio 2 (no se recalculan con el %).
  perform set_config('erp.skip_reprice', '1', true);

  -- ---------- 2. Costos de la factura (menos 1088)
  update public.erp_purchase_items it
  set unit_cost = ceil(pr.price_2 / 1.15 / 100) * 100,
      line_total = round(it.qty * (ceil(pr.price_2 / 1.15 / 100) * 100) * (1 + coalesce(it.tax_rate, 0) / 100), 2)
  from public.products pr
  where pr.id = it.product_id and it.purchase_id = v_pu.id
    and coalesce(pr.price_2, 0) > 0
    and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088);

  update public.erp_purchases p
  set subtotal = x.sub, tax = x.tax, total = x.sub + x.tax, warehouse_id = v_b
  from (select round(sum(qty * unit_cost), 2) as sub, round(sum(qty * unit_cost * coalesce(tax_rate, 0) / 100), 2) as tax
        from public.erp_purchase_items where purchase_id = v_pu.id) x
  where p.id = v_pu.id;

  -- Producto: costo nuevo, precios 1 a 5 = precio 2, 15 % de ganancia (menos 1088).
  update public.products pr
  set cost_price = ceil(pr.price_2 / 1.15 / 100) * 100,
      price_1 = pr.price_2, price_3 = pr.price_2, price_4 = pr.price_2, price_5 = pr.price_2,
      price_retail = pr.price_2, price_wholesale = pr.price_2, updated_at = now()
  where pr.id in (select product_id from public.erp_purchase_items where purchase_id = v_pu.id)
    and coalesce(pr.price_2, 0) > 0
    and not (coalesce(pr.sku, '') = '1088' or coalesce(pr.product_no, 0) = 1088);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'markup_1') then
    execute 'update public.products pr set markup_1 = 15, markup_2 = 15, markup_3 = 15, markup_4 = 15, markup_5 = 15
             where pr.id in (select product_id from public.erp_purchase_items where purchase_id = $1)
               and coalesce(pr.price_2, 0) > 0 and not (coalesce(pr.sku, '''') = ''1088'' or coalesce(pr.product_no, 0) = 1088)' using v_pu.id;
  end if;

  -- ---------- 3. Traslado bodega → Zamora (ya recibido)
  v_num := public.erp_next_number(v_pu.store_id, 'transfer');
  insert into public.erp_transfers (store_id, number, from_warehouse_id, to_warehouse_id, status, notes, received_at)
  values (v_pu.store_id, v_num, v_b, v_z, 'received', 'Ingreso #1 a bodega y traslado a ' || v_z_name, now())
  returning id into v_tr;

  for r in
    select it.product_id, sum(it.qty)::integer as q, max(it.unit_cost) as cost,
           coalesce((select sum(case when im.kind = 'in' then im.qty else -im.qty end) from public.inventory_movements im
                     where im.store_id = v_pu.store_id and im.product_id = it.product_id
                       and im.ref_id = v_pu.id and im.warehouse_id = v_pu.warehouse_id), 0)::integer as n
    from public.erp_purchase_items it where it.purchase_id = v_pu.id
    group by it.product_id
  loop
    -- Entrada de la factura a la bodega.
    perform public.erp__move(v_pu.store_id, v_b, r.product_id, r.q, 'purchase', 'purchase', v_pu.id, r.cost,
      'Compra #' || v_pu.number || ' (a ' || v_b_name || ')', 'El ingreso #1 se registra en la bodega principal', true);
    -- Traslado: sale de la bodega y entra a Zamora.
    insert into public.erp_transfer_items (transfer_id, product_id, qty) values (v_tr, r.product_id, r.q);
    perform public.erp__move(v_pu.store_id, v_b, r.product_id, -r.q, 'transfer_out', 'transfer', v_tr, null,
      'Traslado #' || v_num || ' (salida)', null, false);
    perform public.erp__move(v_pu.store_id, v_z, r.product_id, r.q, 'transfer_in', 'transfer', v_tr, null,
      'Traslado #' || v_num || ' (entrada)', null, false);
    -- 4. Se quita la entrada original que el ingreso hizo directo en el punto.
    if r.n > 0 then
      perform public.erp__move(v_pu.store_id, v_pu.warehouse_id, r.product_id, -r.n, 'purchase_void', 'purchase', v_pu.id, null,
        'Compra #' || v_pu.number || ': pasa a ' || v_b_name, 'Corrección: el ingreso #1 entra por la bodega y llega por traslado', true);
    end if;
    v_units := v_units + r.q; v_lines := v_lines + 1;
  end loop;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_transfer_items' and column_name = 'received_qty') then
    execute 'update public.erp_transfer_items set received_qty = qty where transfer_id = $1' using v_tr;
  end if;

  perform set_config('erp.skip_reprice', '', true);

  begin
    perform public.erp_audit(v_pu.store_id, 'purchase.moved_to_warehouse', 'erp_purchases', v_pu.id,
      jsonb_build_object('warehouse', v_b_name, 'transfer_number', v_num, 'to', v_z_name, 'units', v_units));
  exception when others then null;  -- el registro de auditoría es opcional
  end;

  raise notice 'Listo ✅ Ingreso #1 en «%», traslado #% a «%» con % productos (% unidades).', v_b_name, v_num, v_z_name, v_lines, v_units;
end $$;

-- Revisa el resultado: ejecuta otra vez «ingreso_1_a_bodega_1_revisar.sql»
-- (ahora «hoy_esta_en» = la bodega y «ya_hecho» = 1), y en la app:
-- Inventario → Traslados (verás el traslado recibido) y el kardex de cualquier producto.
