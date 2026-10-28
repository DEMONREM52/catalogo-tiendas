-- =====================================================================
-- REMHUB · Eliminar productos con unidades asumiendo la pérdida (sobre 20261264)
--
--   Si lo ÚNICO que impide eliminar un producto son sus unidades en bodegas
--   o puntos, quien tenga permiso puede eliminarlo igual haciéndose
--   responsable: escribe el motivo (mínimo 10 letras) y acepta la pérdida.
--   Queda en la auditoría como evento crítico con quién lo hizo, las
--   unidades por punto, el costo y el valor que salió del inventario.
--   Las ventas y los traslados siguen bloqueando siempre.
-- Requiere 20261264. No borra datos. Es idempotente.
-- =====================================================================

-- Unidades por bodega o punto, con su costo.
create or replace function public.erp__product_units(p_product uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'units', coalesce(sum(s.qty), 0),
    'cost', coalesce((to_jsonb(p) ->> 'cost_price')::numeric, 0),
    'value', coalesce(sum(s.qty), 0) * coalesce((to_jsonb(p) ->> 'cost_price')::numeric, 0),
    'points', coalesce(jsonb_agg(jsonb_build_object('warehouse_id', s.warehouse_id, 'name', coalesce(w.name, 'Bodega'), 'qty', s.qty) order by w.name)
      filter (where s.qty <> 0), '[]'::jsonb))
  from public.products p
  left join public.erp_stock_levels s on s.product_id = p.id
  left join public.erp_warehouses w on w.id = s.warehouse_id
  where p.id = p_product
  group by p.id, to_jsonb(p) ->> 'cost_price';
$$;
revoke all on function public.erp__product_units(uuid) from public, anon, authenticated;

create or replace function public.erp_product_delete_check(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.products; v_sales jsonb; v_extra jsonb;
begin
  select * into p from public.products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'error', 'Producto no encontrado.'); end if;
  if not public.erp__product_delete_allowed(p.store_id) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Productos» y ser de la tienda madre.');
  end if;
  v_sales := public.erp__product_sales(p.id);
  v_extra := public.erp__product_extras(p.id);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'can_delete', jsonb_array_length(v_sales) = 0, 'reasons', v_sales,
    'units', v_extra -> 'units', 'will_delete', v_extra -> 'history',
    -- Solo lo bloquean sus unidades: se puede eliminar asumiendo la pérdida.
    'units_only', jsonb_array_length(v_sales) > 0 and not exists (select 1 from jsonb_array_elements(v_sales) x where x ->> 'table' <> 'stock'),
    'stock', public.erp__product_units(p.id));
end $$;

drop function if exists public.erp_product_delete(uuid, text);
create or replace function public.erp_product_delete(p_product uuid, p_reason text, p_take_units boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products; v_sales jsonb; h record; t text; v_table text; v_n bigint; v_left integer; v_pass integer := 0;
  v_done jsonb := '{}'::jsonb; v_units numeric := 0; v_stock jsonb; v_other text; v_taken boolean := false;
begin
  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if not public.erp__product_delete_allowed(p.store_id) then raise exception 'Necesitas el permiso «Productos» y ser de la tienda madre.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  v_sales := public.erp__product_sales(p.id);
  select string_agg(x ->> 'label', ', ') into v_other from jsonb_array_elements(v_sales) x where x ->> 'table' <> 'stock';
  if v_other is not null then
    raise exception 'No se puede eliminar «%»: tiene ventas o traslados (%). Inactívalo para que no se use más.', p.name, v_other;
  end if;
  if jsonb_array_length(v_sales) > 0 then
    if not coalesce(p_take_units, false) then
      raise exception 'No se puede eliminar «%»: tiene unidades en inventario. Déjalas en 0 o elimínalo haciéndote responsable de la pérdida.', p.name;
    end if;
    if char_length(btrim(p_reason)) < 10 then raise exception 'Explica qué pasó con las unidades (mínimo 10 letras).'; end if;
    v_taken := true;
  end if;
  v_stock := public.erp__product_units(p.id);
  v_units := coalesce((v_stock ->> 'units')::numeric, 0);

  begin
    loop
      v_pass := v_pass + 1; v_left := 0;
      for h in select * from public.erp__product_history_columns() loop
        begin
          if h.is_uuid then execute format('delete from public.%I where %I = $1', h.tbl, h.col) using p.id;
          else execute format('delete from public.%I where %I::text = $1::text', h.tbl, h.col) using p.id; end if;
          get diagnostics v_n = row_count;
          if v_n > 0 then v_done := v_done || jsonb_build_object(h.tbl, coalesce((v_done ->> h.tbl)::bigint, 0) + v_n); end if;
        exception when foreign_key_violation then v_left := v_left + 1;
        end;
      end loop;
      exit when v_left = 0 or v_pass >= 4;
    end loop;
    foreach t in array public.erp__product_config_tables() loop
      if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'product_id') then
        execute format('delete from public.%I where product_id = $1', t) using p.id;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_done := v_done || jsonb_build_object(t, v_n); end if;
      end if;
    end loop;
    -- Las existencias que quedaron (si erp_stock_levels no salió con el historial).
    if to_regclass('public.erp_stock_levels') is not null then
      delete from public.erp_stock_levels where product_id = p.id;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_done := v_done || jsonb_build_object('erp_stock_levels', coalesce((v_done ->> 'erp_stock_levels')::bigint, 0) + v_n); end if;
    end if;
    delete from public.products where id = p.id;
  exception when foreign_key_violation then
    get stacked diagnostics v_table = table_name;
    raise exception 'No se puede eliminar «%»: tiene registros en % que no se pudieron quitar. Inactívalo.', p.name, public.erp__product_table_label(coalesce(nullif(v_table, ''), 'otra parte'));
  end;

  if v_taken and to_regprocedure('public.erp__audit_insert(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb, text, jsonb)') is not null then
    -- Evento crítico: quién (lo pone la auditoría), qué producto, cuántas unidades en qué punto y cuánto valían.
    perform public.erp__audit_insert(p.store_id, null, 'catalog', 'critical', 'product.deleted_with_units', 'products', p.id,
      jsonb_build_object('name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'units', v_units, 'cost_price', v_stock -> 'cost', 'value', v_stock -> 'value'),
      null, btrim(p_reason),
      jsonb_build_object('responsible', true, 'image_url', p.image_url, 'points', v_stock -> 'points', 'deleted', v_done));
  else
    perform public.erp_audit(p.store_id, case when v_taken then 'product.deleted_with_units' else 'product.deleted' end, 'products', p.id,
      jsonb_build_object('name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url, 'reason', btrim(p_reason),
        'units', v_units, 'value', v_stock -> 'value', 'points', v_stock -> 'points', 'responsible', v_taken, 'deleted', v_done));
  end if;
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'image_url', p.image_url, 'deleted', v_done, 'units', v_units, 'responsible', v_taken);
end $$;
grant execute on function public.erp_product_delete(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
