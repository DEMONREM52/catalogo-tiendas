-- =====================================================================
-- REMHUB · Eliminar productos: solo se bloquea si tiene VENTAS (sobre 20261260)
--
--   Decisión del dueño: se puede eliminar todo producto que no se haya
--   vendido. Bloquea solamente:
--     · pedidos y ventas de cualquier punto (POS, catálogo, landings) que
--       no estén anulados,
--     · facturas y documentos de venta (si guardan el producto),
--     · vales entregados a empleados (no anulados).
--   Todo lo demás se borra con el producto: kardex, compras (sus líneas),
--   traslados, ajustes, unidades en bodegas y puntos, lotes, búsqueda por
--   foto, catálogos, categorías, reglas de precio… y las líneas de pedidos
--   anulados.
--   Queda en la auditoría qué se borró y cuántas filas de cada cosa.
-- Requiere 20261260. No borra ventas. Es idempotente.
-- =====================================================================

create or replace function public.erp__product_config_tables()
returns text[] language sql immutable set search_path = public as $$
  select array['erp_stock_levels', 'store_catalog_products', 'product_category_links', 'erp_price_rules', 'erp_internal_pct_rules',
               'erp_point_costs', 'erp_supplier_item_map', 'erp_cost_alerts', 'erp_price_guard_log', 'store_social_campaign_items',
               'product_image_vectors']::text[];
$$;

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
    when 'erp_sale_finance' then 'Ventas a crédito'
    when 'erp_stock_request_items' then 'Pedidos internos'
    when 'erp_landing_pages' then 'Landing pages'
    when 'erp_employee_loans' then 'Vales de empleados'
    when 'product_image_vectors' then 'Búsqueda por foto'
    when 'erp_order_stock' then 'Reserva de inventario de pedidos'
    else p_table end;
$$;

-- Tablas de venta: si el producto aparece aquí (sin anular), no se elimina.
create or replace function public.erp__product_sale_tables()
returns text[] language sql immutable set search_path = public as $$
  select array['order_items', 'billing_document_lines', 'fiscal_document_lines', 'erp_sale_finance', 'pos_invoice_items', 'erp_warranty_claims']::text[];
$$;
revoke all on function public.erp__product_sale_tables() from public, anon, authenticated;

-- Ventas del producto (lista vacía = se puede eliminar).
create or replace function public.erp__product_sales(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h record; v_hit boolean; v_out jsonb := '[]'::jsonb;
begin
  for h in select * from public.erp__product_history_columns() where tbl = any (public.erp__product_sale_tables()) loop
    if h.tbl = 'order_items' and to_regclass('public.orders') is not null then
      -- Pedidos y ventas de punto: no cuentan los anulados.
      execute format('select exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id where i.%I::text = $1::text and coalesce(o.status, '''') not in (''cancelled'', ''void'', ''voided''))', h.col)
        into v_hit using p_product;
    elsif h.tbl = 'billing_document_lines' and to_regclass('public.billing_documents') is not null then
      execute format('select exists (select 1 from public.billing_document_lines i join public.billing_documents d on d.id = i.document_id where i.%I::text = $1::text and coalesce(to_jsonb(d) ->> ''status'', '''') not in (''void'', ''voided'', ''cancelled'', ''anulado'', ''anulada''))', h.col)
        into v_hit using p_product;
    else
      execute format('select exists (select 1 from public.%I where %I::text = $1::text)', h.tbl, h.col) into v_hit using p_product;
    end if;
    if v_hit and not v_out @> jsonb_build_array(jsonb_build_object('table', h.tbl)) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', h.tbl, 'label', public.erp__product_table_label(h.tbl)));
    end if;
  end loop;
  if to_regclass('public.erp_employee_loans') is not null
     and exists (select 1 from public.erp_employee_loans where status <> 'void' and items @> jsonb_build_array(jsonb_build_object('product_id', p_product))) then
    v_out := v_out || jsonb_build_array(jsonb_build_object('table', 'erp_employee_loans', 'label', public.erp__product_table_label('erp_employee_loans')));
  end if;
  return v_out;
end $$;
revoke all on function public.erp__product_sales(uuid) from public, anon, authenticated;

-- Lo que se va a borrar con el producto (para avisar antes): historial que no es venta y unidades.
create or replace function public.erp__product_extras(p_product uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_all jsonb := public.erp__product_usage(p_product); v_sales jsonb := public.erp__product_sales(p_product); v_units numeric := 0;
begin
  if to_regclass('public.erp_stock_levels') is not null then select coalesce(sum(qty), 0) into v_units from public.erp_stock_levels where product_id = p_product; end if;
  return jsonb_build_object('units', v_units, 'history', coalesce((
    select jsonb_agg(x) from jsonb_array_elements(v_all) x
    where x ->> 'table' <> 'stock' and not v_sales @> jsonb_build_array(jsonb_build_object('table', x ->> 'table'))), '[]'::jsonb));
end $$;
revoke all on function public.erp__product_extras(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- revisar uno
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
    'units', v_extra -> 'units', 'will_delete', v_extra -> 'history');
end $$;

-- ---------------------------------------------------------------- eliminar uno
create or replace function public.erp_product_delete(p_product uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products; v_sales jsonb; h record; t text; v_table text; v_n bigint; v_left integer; v_pass integer := 0;
  v_done jsonb := '{}'::jsonb; v_units numeric := 0;
begin
  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if not public.erp__product_delete_allowed(p.store_id) then raise exception 'Necesitas el permiso «Productos» y ser de la tienda madre.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  v_sales := public.erp__product_sales(p.id);
  if jsonb_array_length(v_sales) > 0 then
    raise exception 'No se puede eliminar «%»: tiene ventas (%). Inactívalo para que no se venda más.', p.name,
      (select string_agg(x->>'label', ', ') from jsonb_array_elements(v_sales) x);
  end if;
  if to_regclass('public.erp_stock_levels') is not null then select coalesce(sum(qty), 0) into v_units from public.erp_stock_levels where product_id = p.id; end if;

  begin
    -- Historial que no es venta (y líneas de pedidos anulados). Varias vueltas por si unas tablas dependen de otras.
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
    delete from public.products where id = p.id;
  exception when foreign_key_violation then
    get stacked diagnostics v_table = table_name;
    raise exception 'No se puede eliminar «%»: tiene registros en % que no se pudieron quitar. Inactívalo.', p.name, public.erp__product_table_label(coalesce(nullif(v_table, ''), 'otra parte'));
  end;

  perform public.erp_audit(p.store_id, 'product.deleted', 'products', p.id, jsonb_build_object('name', p.name, 'sku', p.sku, 'barcode', p.barcode,
    'image_url', p.image_url, 'reason', btrim(p_reason), 'units', v_units, 'deleted', v_done));
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'image_url', p.image_url, 'deleted', v_done);
end $$;

-- ---------------------------------------------------------------- limpiar: los que no se han vendido
create or replace function public.erp_products_unused(p_store uuid, p_only_inactive boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_sold uuid[] := '{}'; v_part uuid[]; h record;
begin
  if not public.erp__product_delete_allowed(p_store) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Productos» y ser de la tienda madre.');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.products p
  where p.store_id = p_store and (not coalesce(p_only_inactive, true) or not coalesce(p.active, true));
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', true, 'products', '[]'::jsonb, 'checked', 0); end if;

  for h in select * from public.erp__product_history_columns() where tbl = any (public.erp__product_sale_tables()) loop
    if h.tbl = 'order_items' and to_regclass('public.orders') is not null then
      execute format('select coalesce(array_agg(distinct i.%I::uuid), ''{}'') from public.order_items i join public.orders o on o.id = i.order_id where i.%I::text = any ($1::text[]) and coalesce(o.status, '''') not in (''cancelled'', ''void'', ''voided'')', h.col, h.col)
        into v_part using v_ids;
    elsif h.tbl = 'billing_document_lines' and to_regclass('public.billing_documents') is not null then
      execute format('select coalesce(array_agg(distinct i.%I::uuid), ''{}'') from public.billing_document_lines i join public.billing_documents d on d.id = i.document_id where i.%I::text = any ($1::text[]) and coalesce(to_jsonb(d) ->> ''status'', '''') not in (''void'', ''voided'', ''cancelled'', ''anulado'', ''anulada'')', h.col, h.col)
        into v_part using v_ids;
    else
      execute format('select coalesce(array_agg(distinct %I::uuid), ''{}'') from public.%I where %I::text = any ($1::text[])', h.col, h.tbl, h.col) into v_part using v_ids;
    end if;
    v_sold := v_sold || v_part;
  end loop;
  if to_regclass('public.erp_employee_loans') is not null then
    select coalesce(array_agg(distinct (x->>'product_id')::uuid), '{}') into v_part
    from public.erp_employee_loans l, jsonb_array_elements(l.items) x where l.store_id = p_store and l.status <> 'void';
    v_sold := v_sold || v_part;
  end if;

  return jsonb_build_object('ok', true, 'checked', cardinality(v_ids), 'products', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'active', coalesce(p.active, true), 'created_at', p.created_at,
      'units', coalesce((select sum(s.qty) from public.erp_stock_levels s where s.product_id = p.id), 0)) order by p.name)
    from public.products p where p.id = any (v_ids) and not (p.id = any (v_sold))), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
