-- =====================================================================
-- REMHUB · Eliminar productos que nunca tuvieron movimientos
--
--   · Solo se elimina un producto sin historial: ni kardex, ni ventas,
--     pedidos, compras, traslados, ajustes, facturas, lotes, garantías,
--     vales de empleados, landings… y sin unidades en ningún lado.
--   · Se revisa SOLA cualquier tabla con columna product_id (o con llave
--     foránea a products): si mañana aparece una tabla nueva con
--     historial, también protege.
--   · Lo que es configuración del producto se borra con él: catálogos,
--     categorías, reglas y costos por punto, mapeo de proveedor (XML),
--     alertas, existencias en 0.
--   · Si algo no se pudo prever (llave foránea), no se borra nada y se
--     avisa dónde está. Lo que tiene historial se inactiva, no se borra.
--   · Queda en la auditoría (nombre, código y motivo).
-- Permiso: «Productos» y ser de la madre (sin punto asignado).
-- No borra historial. Es idempotente.
-- =====================================================================

-- Tablas que son configuración del producto (se borran junto con él).
create or replace function public.erp__product_config_tables()
returns text[] language sql immutable set search_path = public as $$
  select array['erp_stock_levels', 'store_catalog_products', 'product_category_links', 'erp_price_rules', 'erp_internal_pct_rules',
               'erp_point_costs', 'erp_supplier_item_map', 'erp_cost_alerts', 'erp_price_guard_log', 'store_social_campaign_items']::text[];
$$;
revoke all on function public.erp__product_config_tables() from public, anon, authenticated;

-- Nombre para la persona de cada tabla con historial.
create or replace function public.erp__product_table_label(p_table text)
returns text language sql immutable set search_path = public as $$
  select case p_table
    when 'inventory_movements' then 'Kardex (movimientos de inventario)'
    when 'order_items' then 'Pedidos y ventas'
    when 'erp_purchase_items' then 'Compras (ingresos de mercancía)'
    when 'erp_transfer_items' then 'Traslados'
    when 'erp_adjustment_items' then 'Ajustes de inventario'
    when 'billing_document_lines' then 'Facturas y remisiones'
    when 'fiscal_document_lines' then 'Facturación electrónica'
    when 'erp_product_lots' then 'Lotes'
    when 'erp_warranty_claims' then 'Garantías'
    when 'erp_internal_claims' then 'Reclamos entre puntos'
    when 'erp_price_approvals' then 'Autorizaciones de precio'
    when 'erp_sale_finance' then 'Ventas'
    when 'erp_stock_request_items' then 'Pedidos internos'
    when 'erp_landing_pages' then 'Landing pages'
    when 'erp_employee_loans' then 'Vales de empleados'
    else p_table end;
$$;
revoke all on function public.erp__product_table_label(text) from public, anon, authenticated;

-- Columnas que pueden guardar historial de un producto: toda columna product_id de una tabla (no vista)
-- y toda llave foránea de una sola columna hacia products, menos las tablas de configuración.
create or replace function public.erp__product_history_columns()
returns table (tbl text, col text, is_uuid boolean)
language sql stable security definer set search_path = public as $$
  select distinct x.tbl, x.col, x.is_uuid from (
    select c.table_name::text as tbl, c.column_name::text as col, c.data_type = 'uuid' as is_uuid
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'product_id'
    union
    select rel.relname::text, att.attname::text, true
    from pg_constraint k
    join pg_class rel on rel.oid = k.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace and ns.nspname = 'public'
    join pg_attribute att on att.attrelid = k.conrelid and att.attnum = k.conkey[1]
    where k.contype = 'f' and k.confrelid = 'public.products'::regclass and array_length(k.conkey, 1) = 1
  ) x
  where x.tbl <> all (public.erp__product_config_tables()) and x.tbl <> 'products';
$$;
revoke all on function public.erp__product_history_columns() from public, anon, authenticated;

-- Por qué no se puede eliminar un producto (lista vacía = se puede).
create or replace function public.erp__product_usage(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h record; v_hit boolean; v_out jsonb := '[]'::jsonb; v_units numeric := 0;
begin
  if to_regclass('public.erp_stock_levels') is not null then
    select coalesce(sum(abs(qty)), 0) into v_units from public.erp_stock_levels where product_id = p_product;
  end if;
  select v_units + coalesce(abs(max(p.stock)), 0) into v_units from public.products p where p.id = p_product;
  if v_units > 0 then v_out := v_out || jsonb_build_array(jsonb_build_object('table', 'stock', 'label', 'Tiene unidades en inventario')); end if;

  for h in select * from public.erp__product_history_columns() order by 1 loop
    if h.is_uuid then
      execute format('select exists (select 1 from public.%I where %I = $1)', h.tbl, h.col) into v_hit using p_product;
    else
      execute format('select exists (select 1 from public.%I where %I::text = $1::text)', h.tbl, h.col) into v_hit using p_product;
    end if;
    if v_hit and not v_out @> jsonb_build_array(jsonb_build_object('table', h.tbl)) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', h.tbl, 'label', public.erp__product_table_label(h.tbl)));
    end if;
  end loop;

  -- Vales de mercancía a empleados (los productos van dentro de items).
  if to_regclass('public.erp_employee_loans') is not null then
    if exists (select 1 from public.erp_employee_loans where items @> jsonb_build_array(jsonb_build_object('product_id', p_product))) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', 'erp_employee_loans', 'label', public.erp__product_table_label('erp_employee_loans')));
    end if;
  end if;
  return v_out;
end $$;
revoke all on function public.erp__product_usage(uuid) from public, anon, authenticated;

create or replace function public.erp__product_delete_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.erp_can(p_store, 'products') and public.erp_my_points(p_store) is null;
$$;
revoke all on function public.erp__product_delete_allowed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- revisar uno
create or replace function public.erp_product_delete_check(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.products; v_why jsonb;
begin
  select * into p from public.products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'error', 'Producto no encontrado.'); end if;
  if not public.erp__product_delete_allowed(p.store_id) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Productos» y ser de la tienda madre.');
  end if;
  v_why := public.erp__product_usage(p.id);
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'can_delete', jsonb_array_length(v_why) = 0, 'reasons', v_why);
end $$;
revoke all on function public.erp_product_delete_check(uuid) from public, anon;
grant execute on function public.erp_product_delete_check(uuid) to authenticated;

-- ---------------------------------------------------------------- eliminar uno
create or replace function public.erp_product_delete(p_product uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products; v_why jsonb; t text; v_table text;
begin
  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if not public.erp__product_delete_allowed(p.store_id) then raise exception 'Necesitas el permiso «Productos» y ser de la tienda madre.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  v_why := public.erp__product_usage(p.id);
  if jsonb_array_length(v_why) > 0 then
    raise exception 'No se puede eliminar «%»: tiene historial (%). Inactívalo para que no se venda.', p.name,
      (select string_agg(x->>'label', ', ') from jsonb_array_elements(v_why) x);
  end if;

  begin
    foreach t in array public.erp__product_config_tables() loop
      if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'product_id') then
        execute format('delete from public.%I where product_id = $1', t) using p.id;
      end if;
    end loop;
    delete from public.products where id = p.id;
  exception when foreign_key_violation then
    get stacked diagnostics v_table = table_name;
    raise exception 'No se puede eliminar «%»: tiene registros en %. Inactívalo para que no se venda.', p.name, public.erp__product_table_label(coalesce(nullif(v_table, ''), 'otra parte'));
  end;

  perform public.erp_audit(p.store_id, 'product.deleted', 'products', p.id, jsonb_build_object('name', p.name, 'sku', p.sku, 'barcode', p.barcode,
    'image_url', p.image_url, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'image_url', p.image_url);
end $$;
revoke all on function public.erp_product_delete(uuid, text) from public, anon;
grant execute on function public.erp_product_delete(uuid, text) to authenticated;

-- ---------------------------------------------------------------- limpiar: los que se pueden eliminar
-- Productos de la tienda sin historial y sin unidades (consulta por tabla, no por producto).
create or replace function public.erp_products_unused(p_store uuid, p_only_inactive boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_used uuid[] := '{}'; h record; v_part uuid[];
begin
  if not public.erp__product_delete_allowed(p_store) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Productos» y ser de la tienda madre.');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.products p
  where p.store_id = p_store and (not coalesce(p_only_inactive, true) or not coalesce(p.active, true)) and coalesce(p.stock, 0) = 0;
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', true, 'products', '[]'::jsonb, 'checked', 0); end if;

  if to_regclass('public.erp_stock_levels') is not null then
    select coalesce(array_agg(distinct product_id), '{}') into v_part from public.erp_stock_levels where product_id = any (v_ids) and qty <> 0;
    v_used := v_used || v_part;
  end if;
  for h in select * from public.erp__product_history_columns() loop
    if h.is_uuid then
      execute format('select coalesce(array_agg(distinct %I), ''{}'') from public.%I where %I = any ($1)', h.col, h.tbl, h.col) into v_part using v_ids;
    else
      execute format('select coalesce(array_agg(distinct %I::uuid), ''{}'') from public.%I where %I::text = any ($1::text[])', h.col, h.tbl, h.col) into v_part using v_ids;
    end if;
    v_used := v_used || v_part;
  end loop;
  if to_regclass('public.erp_employee_loans') is not null then
    select coalesce(array_agg(distinct (x->>'product_id')::uuid), '{}') into v_part
    from public.erp_employee_loans l, jsonb_array_elements(l.items) x where l.store_id = p_store;
    v_used := v_used || v_part;
  end if;

  return jsonb_build_object('ok', true, 'checked', cardinality(v_ids), 'products', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'active', coalesce(p.active, true), 'created_at', p.created_at) order by p.name)
    from public.products p where p.id = any (v_ids) and not (p.id = any (v_used))), '[]'::jsonb));
end $$;
revoke all on function public.erp_products_unused(uuid, boolean) from public, anon;
grant execute on function public.erp_products_unused(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
