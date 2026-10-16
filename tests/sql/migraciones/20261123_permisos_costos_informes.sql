-- =====================================================================
-- REMHUB · Permisos finos (paso 1): costos, informes, precios y anular compras
--
-- Permisos nuevos:
--   · costs_view       «Ver costos y márgenes»: sin él, el costo, el valor del
--                      inventario, la ganancia y lo comprado salen ocultos
--                      (la BASE no los entrega, no solo la pantalla).
--   · reports          «Informes de ventas» (antes iba pegado a «Auditoría»).
--   · products_prices  «Cambiar precios y % de ganancia» (un empleado puede
--                      crear productos sin tocar precios).
--   · purchases_void   «Anular compras».
--   Para no quitarle nada a nadie de golpe, se entregan UNA sola vez a quien
--   hoy ya podía hacerlo; después el dueño se los quita a quien no deba.
--
-- Huecos cerrados:
--   · Kardex: un punto solo ve movimientos de sus puntos.
--   · Resumen general de inventario: solo la tienda madre.
--   · Pagar a proveedor: solo cuentas del propio punto.
--   · Traslados y ajustes: cada punto ve solo los suyos.
--   · Bodegas y puntos: crearlos o borrarlos solo la madre; editar, la madre
--     o el propio punto (antes cualquiera con «Inventario»).
--   · % de ganancia de los productos: solo con «Ver costos» (con el % y el
--     precio se puede deducir el costo).
--
-- Cómo: las funciones de producción NO se reescriben a mano; se toma la
-- versión que hay en la base y se cambia solo lo necesario. Si algo no
-- coincide, no se cambia NADA y se avisa.
-- No borra datos. Es idempotente. Requiere 20261118 y 20261120.
-- =====================================================================

-- 0. Permisos conocidos (igual que src/lib/store-user-auth.ts).
create or replace function public.erp__known_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'store', 'billing', 'pos', 'sales_void', 'sales_return', 'price_approve', 'exports', 'clients', 'clients_delete', 'credit', 'receivables', 'users',
    'products', 'products_view', 'products_prices', 'costs_view', 'categories', 'orders', 'inventory', 'inventory_adjust', 'inventory_alerts', 'transfers', 'stock_requests',
    'stock_requests_manage', 'notifications_config', 'purchases', 'purchases_void', 'suppliers', 'payables', 'audit', 'reports', 'points', 'fiscal', 'fiscal_send',
    'fiscal_notes', 'fiscal_download', 'fiscal_config', 'fiscal_numbering', 'fiscal_provider', 'fiscal_audit',
    'profit_view', 'profit_rules', 'profit_approve',
    'profit_beneficiaries', 'profit_settle', 'profit_settle_approve', 'profit_pay',
    'expenses', 'expenses_pay', 'budgets', 'payroll', 'payroll_approve', 'payroll_pay'
  ]::text[];
$$;

-- 1. Entregar los permisos nuevos una sola vez (si se vuelve a correr, no se los devuelve a quien se los quitaron).
create table if not exists public.erp_migration_marks (key text primary key, applied_at timestamptz not null default now());
alter table public.erp_migration_marks enable row level security;
revoke all on public.erp_migration_marks from anon, authenticated;

do $$
declare v_new boolean;
begin
  insert into public.erp_migration_marks (key) values ('20261123_grants') on conflict do nothing;
  get diagnostics v_new = row_count;
  if not v_new then raise notice 'Permisos nuevos ya se habían entregado antes: no se tocan.'; return; end if;

  update public.store_users set permissions = array_append(permissions, 'costs_view')
  where not ('costs_view' = any (permissions))
    and permissions && array['products', 'inventory', 'inventory_adjust', 'purchases', 'profit_view', 'profit_approve']::text[];
  update public.store_users set permissions = array_append(permissions, 'reports')
  where not ('reports' = any (permissions)) and 'audit' = any (permissions);
  update public.store_users set permissions = array_append(permissions, 'products_prices')
  where not ('products_prices' = any (permissions)) and 'products' = any (permissions);
  update public.store_users set permissions = array_append(permissions, 'purchases_void')
  where not ('purchases_void' = any (permissions)) and 'purchases' = any (permissions);
end $$;

-- 2. Ayudas
create or replace function public.erp__payable_in_my_points(p_store uuid, p_purchase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.erp_my_points(p_store) is null
      or exists (select 1 from public.erp_purchases pu where pu.id = p_purchase and pu.warehouse_id = any (public.erp_my_points(p_store)));
$$;
revoke all on function public.erp__payable_in_my_points(uuid, uuid) from public, anon;
grant execute on function public.erp__payable_in_my_points(uuid, uuid) to authenticated;

-- Informe de ventas sin costos ni ganancias para quien no tiene «Ver costos».
create or replace function public.erp__mask_report(p_store uuid, v jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if v is null or public.erp_can(p_store, 'costs_view') then return v; end if;
  if v ? 'kpis' then v := jsonb_set(v, '{kpis,cost}', 'null'::jsonb); end if;
  if v ? 'previous' then v := jsonb_set(v, '{previous,cost}', 'null'::jsonb); end if;
  foreach k in array array['series', 'by_point', 'top_products'] loop
    if jsonb_typeof(v->k) = 'array' then
      v := jsonb_set(v, array[k], coalesce((select jsonb_agg(e || '{"profit": null}'::jsonb order by o) from jsonb_array_elements(v->k) with ordinality t(e, o)), '[]'::jsonb));
    end if;
  end loop;
  if jsonb_typeof(v->'inventory') = 'array' then
    v := jsonb_set(v, '{inventory}', coalesce((select jsonb_agg(e || '{"value": null}'::jsonb order by o) from jsonb_array_elements(v->'inventory') with ordinality t(e, o)), '[]'::jsonb));
  end if;
  if v ? 'purchases' then v := jsonb_set(v, '{purchases}', 'null'::jsonb); end if;
  return v || jsonb_build_object('costs_hidden', true);
end $$;
revoke all on function public.erp__mask_report(uuid, jsonb) from public, anon, authenticated;

-- 3. Ajustes sobre las funciones que hay en la base (todo o nada).
create or replace function pg_temp.patch(p_fn text, p_marker text, p_pattern text, p_replacement text)
returns void language plpgsql as $$
declare r record; v_def text; v_new text; n integer := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn loop
    n := n + 1;
    v_def := pg_get_functiondef(r.oid);
    if position(p_marker in v_def) > 0 then continue; end if;
    v_new := regexp_replace(v_def, p_pattern, p_replacement);
    if v_new = v_def then
      raise exception 'No pude ajustar % (no encontré: %). No se cambió nada; comparte el resultado de supabase/scripts/consulta_permisos.sql.', p_fn, left(p_pattern, 80);
    end if;
    execute v_new;
  end loop;
  if n = 0 then raise exception 'No existe la función % en esta base. No se cambió nada.', p_fn; end if;
end $$;

do $$
begin
  -- Informe de ventas: permiso propio y sin costos para quien no los ve.
  perform pg_temp.patch('erp_report', 'erp_can(p_store, ''reports'')',
    'if\s+not\s+public\.erp_can\(p_store,\s*''audit''\)\s+then\s+raise\s+exception\s+''[^'']*'';\s*end\s+if;',
    'if not public.erp_can(p_store, ''reports'') then raise exception ''Necesitas el permiso «Informes de ventas».''; end if;');
  perform pg_temp.patch('erp_report', 'erp__mask_report',
    'return\s+v;\s*end;',
    'return public.erp__mask_report(p_store, v);
end;');

  -- Existencias (nuevo explorador): costo y valor solo con «Ver costos».
  perform pg_temp.patch('erp_stock_browse', 'then coalesce(p.cost_price, 0) else 0 end',
    'coalesce\(p\.cost_price,\s*0\)::numeric\s+as\s+cost,',
    '(case when public.erp_can(p_store, ''costs_view'') then coalesce(p.cost_price, 0) else 0 end)::numeric as cost,');
  perform pg_temp.patch('erp_stock_browse', '''cost_price'', case when',
    '''cost_price'',\s*pg\.cost,',
    '''cost_price'', case when public.erp_can(p_store, ''costs_view'') then pg.cost end,');
  perform pg_temp.patch('erp_stock_browse', '''value'', case when',
    '''value'',\s*coalesce\(\(select\s+sum\(greatest\(qty,\s*0\)\s*\*\s*cost\)\s+from\s+filtered\),\s*0\),',
    '''value'', case when public.erp_can(p_store, ''costs_view'') then coalesce((select sum(greatest(qty, 0) * cost) from filtered), 0) end,');

  -- Existencias (versión anterior).
  perform pg_temp.patch('erp_stock_page', '''costs_view'') then coalesce(p.cost_price, 0) end',
    'coalesce\(p\.cost_price,\s*0\)::numeric\s+as\s+pcost',
    '(case when public.erp_can(p_store, ''costs_view'') then coalesce(p.cost_price, 0) end)::numeric as pcost');

  -- Kardex: costo oculto y solo los puntos propios.
  perform pg_temp.patch('erp_kardex', 'then m.unit_cost end',
    'm\.unit_cost,\s*m\.note',
    'case when public.erp_can(p_store, ''costs_view'') then m.unit_cost end, m.note');
  perform pg_temp.patch('erp_kardex', 'erp_my_points(p_store) is null or m.warehouse_id',
    'and\s+\(p_warehouse\s+is\s+null\s+or\s+m\.warehouse_id\s*=\s*p_warehouse\)',
    'and (p_warehouse is null or m.warehouse_id = p_warehouse)
    and (public.erp_my_points(p_store) is null or m.warehouse_id = any (public.erp_my_points(p_store)))');

  -- Resumen general de inventario: solo la madre; valores con «Ver costos».
  perform pg_temp.patch('erp_overview', 'solo para la tienda madre',
    '(raise\s+exception\s+''No tienes permiso para ver este resumen\.'';\s*end\s+if;)',
    '\1
  if public.erp_my_points(p_store) is not null then raise exception ''El resumen general es solo para la tienda madre.''; end if;');
  perform pg_temp.patch('erp_overview', 'inventory_value'', null',
    'return\s+r;\s*end;',
    'return case when public.erp_can(p_store, ''costs_view'') then r else r || jsonb_build_object(''inventory_value'', null, ''purchases_month'', null) end;
end;');

  -- Pagar a proveedor: solo cuentas del propio punto.
  perform pg_temp.patch('erp_pay_supplier', 'erp__payable_in_my_points',
    '(raise\s+exception\s+''No tienes permiso para registrar pagos\.'';\s*end\s+if;)',
    '\1
  if not public.erp__payable_in_my_points(ap.store_id, ap.purchase_id) then raise exception ''Esa cuenta es de otro punto.''; end if;');

  -- Costos de productos: solo con «Ver costos».
  perform pg_temp.patch('erp_product_costs', 'erp_can(p_store, ''costs_view'')',
    'if\s+not\s+\(public\.erp_can\(p_store,\s*''products''\)[^;]*then\s+raise\s+exception\s+''No tienes permiso para ver costos\.'';',
    'if not public.erp_can(p_store, ''costs_view'') then
    raise exception ''No tienes permiso para ver costos.'';');

  -- Anular compras: permiso propio.
  perform pg_temp.patch('erp_cancel_purchase', 'purchases_void',
    '(raise\s+exception\s+''No tienes permiso para anular compras\.'';\s*end\s+if;)',
    '\1
  if not public.erp_can(pu.store_id, ''purchases_void'') then raise exception ''Necesitas el permiso «Anular compras».''; end if;');
end $$;

-- 4. Traslados y ajustes: cada punto ve solo los suyos (se suma a las reglas que ya hay).
drop policy if exists erp_tr_point_scope on public.erp_transfers;
create policy erp_tr_point_scope on public.erp_transfers as restrictive for select to authenticated
  using (public.erp_my_points(store_id) is null
         or from_warehouse_id = any (public.erp_my_points(store_id))
         or to_warehouse_id = any (public.erp_my_points(store_id)));

drop policy if exists erp_adj_point_scope on public.erp_adjustments;
create policy erp_adj_point_scope on public.erp_adjustments as restrictive for select to authenticated
  using (public.erp_my_points(store_id) is null or warehouse_id = any (public.erp_my_points(store_id)));

-- 5. Bodegas y puntos: crear/borrar solo la madre; editar la madre o el propio punto.
drop policy if exists erp_wh_write on public.erp_warehouses;
drop policy if exists erp_wh_insert on public.erp_warehouses;
drop policy if exists erp_wh_update on public.erp_warehouses;
drop policy if exists erp_wh_delete on public.erp_warehouses;
create policy erp_wh_insert on public.erp_warehouses for insert to authenticated
  with check (public.erp_can_any(store_id, array['inventory', 'points', 'billing']) and public.erp_my_points(store_id) is null);
create policy erp_wh_update on public.erp_warehouses for update to authenticated
  using (public.erp_can_any(store_id, array['inventory', 'points', 'billing'])
         and (public.erp_my_points(store_id) is null or id = any (public.erp_my_points(store_id))))
  with check (public.erp_can_any(store_id, array['inventory', 'points', 'billing'])
         and (public.erp_my_points(store_id) is null or id = any (public.erp_my_points(store_id))));
create policy erp_wh_delete on public.erp_warehouses for delete to authenticated
  using (public.erp_can_any(store_id, array['inventory', 'points']) and public.erp_my_points(store_id) is null);

-- 6. Precios y % de ganancia de los productos.
-- 6a. Cambiar precios o % desde la app exige «Cambiar precios» (los cambios automáticos
--     del ingreso de factura no pasan por aquí: corren como el dueño de la base).
-- Sin «security definer» a propósito: así current_user dice si el cambio vino directo de la app.
create or replace function public.erp__products_price_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_default numeric;
begin
  if current_user <> 'authenticated' then return new; end if;
  -- Producto nuevo sin «Cambiar precios»: usa el % predeterminado de la tienda (no el que mande la pantalla).
  if tg_op = 'INSERT' then
    if not public.erp_can(new.store_id, 'products_prices') then
      begin
        execute 'select default_markup from public.erp_profit_settings where store_id = $1' into v_default using new.store_id;
      exception when undefined_table or undefined_column then v_default := null;
      end;
      v_default := coalesce(v_default, 15);
      new.markup_1 := v_default; new.markup_2 := v_default; new.markup_3 := v_default; new.markup_4 := v_default; new.markup_5 := v_default;
    end if;
    return new;
  end if;
  if (new.price_1, new.price_2, new.price_3, new.price_4, new.price_5, new.price_retail, new.price_wholesale,
      new.markup_1, new.markup_2, new.markup_3, new.markup_4, new.markup_5)
     is distinct from
     (old.price_1, old.price_2, old.price_3, old.price_4, old.price_5, old.price_retail, old.price_wholesale,
      old.markup_1, old.markup_2, old.markup_3, old.markup_4, old.markup_5)
     and not public.erp_can(new.store_id, 'products_prices') then
    raise exception 'Necesitas el permiso «Cambiar precios» para cambiar precios o %% de ganancia.';
  end if;
  return new;
end $$;
drop trigger if exists erp_products_price_guard on public.products;
create trigger erp_products_price_guard before insert or update on public.products
  for each row execute function public.erp__products_price_guard();

-- 6b. El % de ganancia se lee con «Ver costos» (con el % y el precio se deduce el costo).
create or replace function public.erp_product_markups(p_store uuid, p_ids uuid[])
returns table (product_id uuid, markup_1 numeric, markup_2 numeric, markup_3 numeric, markup_4 numeric, markup_5 numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp_can(p_store, 'costs_view') then raise exception 'No tienes permiso para ver costos.'; end if;
  if coalesce(cardinality(p_ids), 0) > 2000 then raise exception 'Pide máximo 2000 productos a la vez.'; end if;
  return query select p.id, p.markup_1, p.markup_2, p.markup_3, p.markup_4, p.markup_5
    from public.products p where p.store_id = p_store and p.id = any (p_ids);
end $$;
revoke all on function public.erp_product_markups(uuid, uuid[]) from public, anon;
grant execute on function public.erp_product_markups(uuid, uuid[]) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.products', 'SELECT') then
    raise warning 'products tiene lectura de TABLA COMPLETA para authenticated (incluye costo): ejecuta 20261107_proteger_costo.sql. El %% de ganancia no se pudo ocultar.';
  else
    revoke select (markup_1, markup_2, markup_3, markup_4, markup_5) on public.products from authenticated, anon;
  end if;
end $$;

notify pgrst, 'reload schema';

-- 7. Verificación (solo lectura): todo debe salir en «sí».
with f as (
  select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('erp_report', 'erp_stock_browse', 'erp_kardex', 'erp_pay_supplier', 'erp_cancel_purchase')
)
select 'Informe usa «Informes de ventas»' as revision,
       case when (select bool_and(def like '%''reports''%') from f where proname = 'erp_report') then 'sí' else 'NO' end as ok
union all select 'Existencias ocultan costo', case when (select bool_and(def like '%costs_view%') from f where proname = 'erp_stock_browse') then 'sí' else 'NO' end
union all select 'Kardex por punto', case when (select bool_and(def like '%erp_my_points%') from f where proname = 'erp_kardex') then 'sí' else 'NO' end
union all select 'Pago a proveedor por punto', case when (select bool_and(def like '%erp__payable_in_my_points%') from f where proname = 'erp_pay_supplier') then 'sí' else 'NO' end
union all select 'Anular compras con permiso propio', case when (select bool_and(def like '%purchases_void%') from f where proname = 'erp_cancel_purchase') then 'sí' else 'NO' end
union all select 'Costo de productos protegido', case when not has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') then 'sí' else 'NO (ejecuta 20261107)' end
union all select '% de ganancia protegido', case when not has_column_privilege('authenticated', 'public.products', 'markup_1', 'SELECT') then 'sí' else 'NO' end;
