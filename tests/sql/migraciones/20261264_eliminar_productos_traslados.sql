-- =====================================================================
-- REMHUB · Eliminar productos: los TRASLADOS también bloquean (sobre 20261263)
--
--   Un producto no se elimina si tiene ventas (pedidos y ventas de punto
--   sin anular, facturas, vales a empleados), traslados entre bodegas y
--   puntos (en camino o recibidos; los anulados no cuentan) o UNIDADES en
--   cualquier bodega o punto.
--   Lo demás (kardex, compras, ajustes, búsqueda por foto, catálogos…) se
--   sigue borrando con el producto.
--   La regla de qué fila cuenta queda en un solo lugar:
--   erp__product_block_sql.
-- Requiere 20261263. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp__product_sale_tables()
returns text[] language sql immutable set search_path = public as $$
  select array['order_items', 'billing_document_lines', 'fiscal_document_lines', 'erp_sale_finance', 'pos_invoice_items', 'erp_warranty_claims',
               'erp_transfer_items']::text[];
$$;

-- Consulta que trae los productos (de la lista $1, como texto) que tienen filas que bloquean en esa tabla.
create or replace function public.erp__product_block_sql(p_table text, p_col text)
returns text language plpgsql stable set search_path = public as $$
begin
  if p_table = 'order_items' and to_regclass('public.orders') is not null then
    return format('select distinct i.%1$I::text from public.order_items i join public.orders o on o.id = i.order_id where i.%1$I::text = any ($1) and coalesce(o.status, '''') not in (''cancelled'', ''void'', ''voided'')', p_col);
  elsif p_table = 'billing_document_lines' and to_regclass('public.billing_documents') is not null then
    return format('select distinct i.%1$I::text from public.billing_document_lines i join public.billing_documents d on d.id = i.document_id where i.%1$I::text = any ($1) and coalesce(to_jsonb(d) ->> ''status'', '''') not in (''void'', ''voided'', ''cancelled'', ''anulado'', ''anulada'')', p_col);
  elsif p_table = 'erp_transfer_items' and to_regclass('public.erp_transfers') is not null then
    return format('select distinct i.%1$I::text from public.erp_transfer_items i join public.erp_transfers t on t.id = i.transfer_id where i.%1$I::text = any ($1) and coalesce(t.status, '''') <> ''cancelled''', p_col);
  end if;
  return format('select distinct %1$I::text from public.%2$I where %1$I::text = any ($1)', p_col, p_table);
end $$;
revoke all on function public.erp__product_block_sql(text, text) from public, anon, authenticated;

-- Productos de la lista que tienen ventas o traslados (y vales no anulados).
create or replace function public.erp__products_blocked(p_store uuid, p_ids uuid[])
returns table (product_id uuid, tbl text) language plpgsql stable security definer set search_path = public as $$
declare h record;
begin
  for h in select * from public.erp__product_history_columns() where erp__product_history_columns.tbl = any (public.erp__product_sale_tables()) loop
    return query execute format('select x::uuid, %L::text from (%s) s(x)', h.tbl, public.erp__product_block_sql(h.tbl, h.col)) using p_ids::text[];
  end loop;
  -- Unidades en cualquier bodega o punto: perder inventario no tiene vuelta atrás.
  if to_regclass('public.erp_stock_levels') is not null then
    return query select distinct s.product_id, 'stock'::text from public.erp_stock_levels s where s.product_id = any (p_ids) and s.qty <> 0;
  end if;
  if to_regclass('public.erp_employee_loans') is not null then
    return query select distinct (x ->> 'product_id')::uuid, 'erp_employee_loans'::text
      from public.erp_employee_loans l, jsonb_array_elements(l.items) x
      where l.store_id = p_store and l.status <> 'void' and (x ->> 'product_id') = any (p_ids::text[]);
  end if;
end $$;
revoke all on function public.erp__products_blocked(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.erp__product_table_label(p_table text)
returns text language sql immutable set search_path = public as $$
  select case p_table
    when 'stock' then 'Tiene unidades en inventario (déjalas en 0 con un ajuste o un traslado)'
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

-- Ventas o traslados de un producto (lista vacía = se puede eliminar).
create or replace function public.erp__product_sales(p_product uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('table', b.tbl, 'label', public.erp__product_table_label(b.tbl)) order by b.tbl), '[]'::jsonb)
  from (select distinct x.tbl from public.products p, public.erp__products_blocked(p.store_id, array[p.id]) x where p.id = p_product) b;
$$;

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
    raise exception 'No se puede eliminar «%»: tiene ventas o traslados (%). Inactívalo para que no se use más.', p.name,
      (select string_agg(x->>'label', ', ') from jsonb_array_elements(v_sales) x);
  end if;
  if to_regclass('public.erp_stock_levels') is not null then select coalesce(sum(qty), 0) into v_units from public.erp_stock_levels where product_id = p.id; end if;

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
    delete from public.products where id = p.id;
  exception when foreign_key_violation then
    get stacked diagnostics v_table = table_name;
    raise exception 'No se puede eliminar «%»: tiene registros en % que no se pudieron quitar. Inactívalo.', p.name, public.erp__product_table_label(coalesce(nullif(v_table, ''), 'otra parte'));
  end;

  perform public.erp_audit(p.store_id, 'product.deleted', 'products', p.id, jsonb_build_object('name', p.name, 'sku', p.sku, 'barcode', p.barcode,
    'image_url', p.image_url, 'reason', btrim(p_reason), 'units', v_units, 'deleted', v_done));
  return jsonb_build_object('ok', true, 'id', p.id, 'name', p.name, 'image_url', p.image_url, 'deleted', v_done);
end $$;

-- Limpiar: los que no tienen ventas ni traslados.
create or replace function public.erp_products_unused(p_store uuid, p_only_inactive boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_blocked uuid[];
begin
  if not public.erp__product_delete_allowed(p_store) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas el permiso «Productos» y ser de la tienda madre.');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.products p
  where p.store_id = p_store and (not coalesce(p_only_inactive, true) or not coalesce(p.active, true));
  if cardinality(v_ids) = 0 then return jsonb_build_object('ok', true, 'products', '[]'::jsonb, 'checked', 0); end if;
  select coalesce(array_agg(distinct b.product_id), '{}') into v_blocked from public.erp__products_blocked(p_store, v_ids) b;
  return jsonb_build_object('ok', true, 'checked', cardinality(v_ids), 'products', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'active', coalesce(p.active, true), 'created_at', p.created_at,
      'units', coalesce((select sum(s.qty) from public.erp_stock_levels s where s.product_id = p.id), 0)) order by p.name)
    from public.products p where p.id = any (v_ids) and not (p.id = any (v_blocked))), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
