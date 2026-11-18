-- =====================================================================
-- REMHUB · Ingresos: códigos del proveedor y aviso de cambio de costo
--
-- 1. Códigos del proveedor por producto. Se usa la misma tabla que ya
--    aprende el XML (erp_supplier_item_map, 20261246): «el 88130 de NEXT
--    TECHNOLOGY es el producto 529».
--    · erp_search_products también encuentra el producto por esos códigos
--      (como si fuera su código) y dice cuál coincidió (supplier_code).
--    · erp_supplier_codes: los códigos de un producto (o de un proveedor).
--    · erp_supplier_code_delete: quitar uno.
--    Guardar sigue siendo erp_supplier_item_map_save (permiso de Ingresos).
--
-- 2. Aviso de cambio de costo en el ingreso.
--    · erp_purchase_last_costs: el costo de la ÚLTIMA COMPRA de cada
--      producto (no el promedio), con la fecha, el número y el proveedor.
--      Al editar un ingreso se excluye ese mismo ingreso.
--    · erp_purchase_settings: desde qué % se pide confirmar (20 % por
--      defecto). Lo cambia solo el dueño o el administrador de la tienda.
--
-- No cambia datos ni permisos. Es idempotente.
-- =====================================================================

create index if not exists erp_supplier_item_map_code on public.erp_supplier_item_map (store_id, upper(supplier_code));
create index if not exists erp_supplier_item_map_product on public.erp_supplier_item_map (product_id);
create index if not exists erp_purchase_items_product on public.erp_purchase_items (product_id);

-- ---------------------------------------------------------------- 1. buscador
drop function if exists public.erp_search_products(uuid, text, uuid, boolean, integer, boolean);
drop function if exists public.erp_search_products(uuid, text, uuid, boolean, integer);

create or replace function public.erp_search_products(p_store uuid, p_q text, p_warehouse uuid default null::uuid, p_in_stock boolean default false,
  p_limit integer default 20, p_include_inactive boolean default false)
returns table(id uuid, name text, sku text, barcode text, cost_price numeric, tax_rate numeric, stock integer, wh_qty integer, product_no integer,
  active boolean, auto_inactive boolean, supplier_code text)
language plpgsql stable security definer set search_path to 'public', 'extensions' as $function$
declare
  v_all boolean;
begin
  if not public.erp_can_any(p_store, array['inventory', 'purchases', 'transfers', 'inventory_adjust', 'pos', 'stock_requests',
                                           'stock_requests_manage', 'products', 'products_view']::text[]) then
    raise exception 'No tienes permiso para consultar productos.';
  end if;
  -- Los inactivos a mano solo para quien registra mercancía o edita productos (20261324).
  v_all := coalesce(p_include_inactive, false)
           and public.erp_can_any(p_store, array['purchases', 'inventory', 'products']::text[]);
  return query
    with q as materialized (
      select public.product__tokens(p_q) as tokens, public.product__code_key(p_q) as code,
             public.erp__norm_text(btrim(coalesce(p_q, ''))) as norm
    ),
    -- Códigos de proveedores que coinciden exacto con lo buscado (uno por producto).
    alias as materialized (
      select distinct on (m.product_id) m.product_id, m.supplier_code
      from q join public.erp_supplier_item_map m
        on q.code is not null and m.store_id = p_store and upper(m.supplier_code) = q.code
      order by m.product_id, m.updated_at desc
    )
    select p.id, p.name::text, p.sku::text, p.barcode::text, coalesce(p.cost_price, 0)::numeric, coalesce(p.tax_rate, 0)::numeric,
           coalesce(p.stock, 0)::integer, coalesce(l.qty, 0)::integer, p.product_no,
           coalesce(p.active, true), coalesce(p.auto_inactive, false), a.supplier_code::text
    from q
    cross join public.products p
    left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = p_warehouse
    left join alias a on a.product_id = p.id
    where p.store_id = p_store and (coalesce(p.active, true) or p.auto_inactive or v_all)
      and (cardinality(q.tokens) = 0
           or a.product_id is not null
           or public.product__code_hit(p.sku, p.barcode, p.product_no, q.code)
           or public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens)
           or (length(q.norm) >= 4 and public.product__fuzzy(q.norm, public.erp__norm_text(p.name)) >= 0.5))
      and (not p_in_stock or coalesce(l.qty, 0) > 0)
    order by (case
                when cardinality(q.tokens) = 0 then 0
                when public.product__code_hit(p.sku, p.barcode, p.product_no, q.code) then 100
                when a.product_id is not null then 95
                when public.erp__norm_text(p.name) = q.norm then 90
                when public.erp__norm_text(p.name) like q.norm || '%' then 70
                when public.product__has_tokens(public.erp__norm_text(p.name), q.tokens) then 50
                when public.product__has_tokens(public.product__haystack(p.name, p.sku, p.barcode, null), q.tokens) then 40
                else 10 + 20 * public.product__fuzzy(q.norm, public.erp__norm_text(p.name))
              end)::real desc, (coalesce(p.active, true) or p.auto_inactive) desc, p.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

revoke execute on function public.erp_search_products(uuid, text, uuid, boolean, integer, boolean) from public, anon;
grant execute on function public.erp_search_products(uuid, text, uuid, boolean, integer, boolean) to authenticated;

-- ---------------------------------------------------------------- 1b. ver y quitar códigos
create or replace function public.erp_supplier_codes(p_store uuid, p_product uuid default null, p_supplier uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  if p_product is null and p_supplier is null then
    return jsonb_build_object('ok', false, 'message', 'Falta el producto o el proveedor.');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'supplier_id', m.supplier_id, 'supplier', s.name, 'code', m.supplier_code,
             'product_id', m.product_id, 'product', p.name, 'sku', p.sku, 'description', m.description, 'updated_at', m.updated_at)
           order by s.name, m.supplier_code)
    from public.erp_supplier_item_map m
    join public.erp_suppliers s on s.id = m.supplier_id
    join public.products p on p.id = m.product_id
    where m.store_id = p_store
      and (p_product is null or m.product_id = p_product)
      and (p_supplier is null or m.supplier_id = p_supplier)
    limit 2000), '[]'::jsonb));
end $$;

create or replace function public.erp_supplier_code_delete(p_store uuid, p_supplier uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  delete from public.erp_supplier_item_map
  where store_id = p_store and supplier_id = p_supplier and supplier_code = btrim(coalesce(p_code, ''));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'deleted', n, 'message', case when n = 0 then 'Ese código ya no estaba.' end);
end $$;

revoke all on function public.erp_supplier_codes(uuid, uuid, uuid) from public, anon;
revoke all on function public.erp_supplier_code_delete(uuid, uuid, text) from public, anon;
grant execute on function public.erp_supplier_codes(uuid, uuid, uuid) to authenticated;
grant execute on function public.erp_supplier_code_delete(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. cambio de costo
create table if not exists public.erp_purchase_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  cost_alert_pct numeric not null default 20 check (cost_alert_pct >= 1 and cost_alert_pct <= 500),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.erp_purchase_settings enable row level security;
-- Sin políticas: solo se lee y cambia con las funciones de abajo.

-- Dueño de la tienda o administrador de la tienda (para ajustes de la tienda).
create or replace function public.erp__store_boss(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su
               where su.store_id = p_store and su.user_id = auth.uid() and su.active and su.role = 'store_admin'))
$$;
revoke all on function public.erp__store_boss(uuid) from public, anon, authenticated;

create or replace function public.erp_purchase_last_costs(p_store uuid, p_ids uuid[], p_exclude_purchase uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'purchases') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de Ingresos.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'alert_pct', coalesce((select s.cost_alert_pct from public.erp_purchase_settings s where s.store_id = p_store), 20),
    'can_config', public.erp__store_boss(p_store),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'unit_cost', x.unit_cost, 'at', x.created_at,
                                          'number', x.number, 'supplier', x.supplier))
      from (
        select distinct on (it.product_id) it.product_id, it.unit_cost, pu.created_at, pu.number, s.name as supplier
        from public.erp_purchase_items it
        join public.erp_purchases pu on pu.id = it.purchase_id
        left join public.erp_suppliers s on s.id = pu.supplier_id
        where pu.store_id = p_store and pu.status <> 'cancelled'
          and it.product_id = any (coalesce(p_ids, '{}'::uuid[]))
          and (p_exclude_purchase is null or pu.id <> p_exclude_purchase)
          and it.unit_cost > 0
        order by it.product_id, pu.created_at desc, pu.number desc
      ) x), '[]'::jsonb));
end $$;

-- Solo el dueño o el administrador de la tienda.
create or replace function public.erp_purchase_settings_set(p_store uuid, p_cost_alert_pct numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp__store_boss(p_store) then
    return jsonb_build_object('ok', false, 'message', 'Solo el dueño o el administrador de la tienda cambia este aviso.');
  end if;
  if p_cost_alert_pct is null or p_cost_alert_pct < 1 or p_cost_alert_pct > 500 then
    return jsonb_build_object('ok', false, 'message', 'Escribe un % entre 1 y 500.');
  end if;
  insert into public.erp_purchase_settings (store_id, cost_alert_pct, updated_by, updated_at)
  values (p_store, round(p_cost_alert_pct, 2), auth.uid(), now())
  on conflict (store_id) do update set cost_alert_pct = excluded.cost_alert_pct, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true, 'alert_pct', round(p_cost_alert_pct, 2));
end $$;

revoke all on function public.erp_purchase_last_costs(uuid, uuid[], uuid) from public, anon;
revoke all on function public.erp_purchase_settings_set(uuid, numeric) from public, anon;
grant execute on function public.erp_purchase_last_costs(uuid, uuid[], uuid) to authenticated;
grant execute on function public.erp_purchase_settings_set(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
