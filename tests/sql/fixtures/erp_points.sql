-- REMHUB · Usuarios por punto de venta / bodega
-- Ejecutar DESPUÉS de erp_core.sql y erp_ops.sql. Es idempotente.
-- Un usuario con point_id solo ve y mueve el inventario de ese punto.
-- Dueño, administradores y usuarios sin punto ven todo.

alter table public.store_users
  add column if not exists point_id uuid references public.erp_warehouses(id) on delete set null;

create or replace function public.erp_my_point(p_store uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select su.point_id
  from public.store_users su
  where su.store_id = p_store and su.user_id = auth.uid() and su.active
    and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    and su.role <> 'store_admin'
  limit 1;
$$;
grant execute on function public.erp_my_point(uuid) to authenticated;

-- Impide que un usuario de punto toque bodegas ajenas.
create or replace function public.erp_point_guard(p_store uuid, p_warehouse uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_pt uuid := public.erp_my_point(p_store);
begin
  if v_pt is not null and p_warehouse is distinct from v_pt then
    raise exception 'Tu usuario solo puede operar sobre su punto asignado.';
  end if;
end;
$$;
revoke all on function public.erp_point_guard(uuid, uuid) from public, anon, authenticated;

create or replace function public.erp_guard_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pt uuid := public.erp_my_point(new.store_id);
begin
  if v_pt is null then return new; end if;
  if tg_op = 'INSERT' then
    perform public.erp_point_guard(new.store_id, new.from_warehouse_id);
  elsif new.status is distinct from old.status
        and v_pt not in (new.from_warehouse_id, new.to_warehouse_id) then
    raise exception 'Este traslado no pertenece a tu punto.';
  end if;
  return new;
end $$;
drop trigger if exists erp_guard_transfer on public.erp_transfers;
create trigger erp_guard_transfer before insert or update on public.erp_transfers
  for each row execute function public.erp_guard_transfer();

create or replace function public.erp_guard_adjustment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.erp_point_guard(new.store_id, new.warehouse_id);
  return new;
end $$;
drop trigger if exists erp_guard_adjustment on public.erp_adjustments;
create trigger erp_guard_adjustment before insert on public.erp_adjustments
  for each row execute function public.erp_guard_adjustment();

create or replace function public.erp_guard_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.erp_my_point(new.store_id) is not null then
    raise exception 'Los usuarios de punto no pueden registrar ingresos de factura.';
  end if;
  return new;
end $$;
drop trigger if exists erp_guard_purchase on public.erp_purchases;
create trigger erp_guard_purchase before insert on public.erp_purchases
  for each row execute function public.erp_guard_purchase();

create or replace function public.erp_guard_order_meta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.erp_my_point(new.store_id) is not null then
    perform public.erp_point_guard(new.store_id, new.point_id);
  end if;
  return new;
end $$;
drop trigger if exists erp_guard_order_meta on public.erp_order_meta;
create trigger erp_guard_order_meta before insert on public.erp_order_meta
  for each row execute function public.erp_guard_order_meta();

-- Lectura: cada usuario de punto solo ve lo de su punto.
drop policy if exists erp_stock_select on public.erp_stock_levels;
create policy erp_stock_select on public.erp_stock_levels for select to authenticated
  using ((public.erp_can(store_id, 'inventory') or public.erp_can(store_id, 'products'))
         and (public.erp_my_point(store_id) is null or warehouse_id = public.erp_my_point(store_id)));

drop policy if exists erp_tr_select on public.erp_transfers;
create policy erp_tr_select on public.erp_transfers for select to authenticated
  using ((public.erp_can(store_id, 'transfers') or public.erp_can(store_id, 'inventory'))
         and (public.erp_my_point(store_id) is null
              or public.erp_my_point(store_id) in (from_warehouse_id, to_warehouse_id)));

drop policy if exists erp_tri_select on public.erp_transfer_items;
create policy erp_tri_select on public.erp_transfer_items for select to authenticated
  using (exists (select 1 from public.erp_transfers t where t.id = transfer_id
    and (public.erp_can(t.store_id, 'transfers') or public.erp_can(t.store_id, 'inventory'))
    and (public.erp_my_point(t.store_id) is null
         or public.erp_my_point(t.store_id) in (t.from_warehouse_id, t.to_warehouse_id))));

drop policy if exists erp_adj_select on public.erp_adjustments;
create policy erp_adj_select on public.erp_adjustments for select to authenticated
  using ((public.erp_can(store_id, 'inventory_adjust') or public.erp_can(store_id, 'inventory'))
         and (public.erp_my_point(store_id) is null or warehouse_id = public.erp_my_point(store_id)));

drop policy if exists erp_adji_select on public.erp_adjustment_items;
create policy erp_adji_select on public.erp_adjustment_items for select to authenticated
  using (exists (select 1 from public.erp_adjustments a where a.id = adjustment_id
    and (public.erp_can(a.store_id, 'inventory_adjust') or public.erp_can(a.store_id, 'inventory'))
    and (public.erp_my_point(a.store_id) is null or a.warehouse_id = public.erp_my_point(a.store_id))));

drop policy if exists erp_pur_select on public.erp_purchases;
create policy erp_pur_select on public.erp_purchases for select to authenticated
  using (public.erp_can(store_id, 'purchases') and public.erp_my_point(store_id) is null);

drop policy if exists erp_ap_select on public.erp_payables;
create policy erp_ap_select on public.erp_payables for select to authenticated
  using (public.erp_can(store_id, 'payables') and public.erp_my_point(store_id) is null);

-- Un usuario de punto no edita puntos ni bodegas.
drop policy if exists erp_wh_write on public.erp_warehouses;
create policy erp_wh_write on public.erp_warehouses for all to authenticated
  using (public.erp_can(store_id, 'inventory') and public.erp_my_point(store_id) is null)
  with check (public.erp_can(store_id, 'inventory') and public.erp_my_point(store_id) is null);

-- Existencias paginadas: un usuario de punto ve solo las cantidades de su punto.
create or replace function public.erp_stock_page(
  p_store uuid, p_q text, p_only_low boolean, p_limit integer, p_offset integer
) returns table (
  id uuid, name text, sku text, cost_price numeric, total integer, levels jsonb, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(trim(coalesce(p_q, '')));
  v_pt uuid := public.erp_my_point(p_store);
begin
  if not (public.erp_can(p_store, 'inventory') or public.erp_can(p_store, 'products')) then
    raise exception 'No tienes permiso para ver existencias.';
  end if;
  return query
    with page as (
      select p.id, p.name::text as name, p.sku::text as sku, coalesce(p.cost_price, 0)::numeric as cost_price,
             case when v_pt is null then coalesce(p.stock, 0) else coalesce(l.qty, 0) end::integer as total,
             count(*) over () as total_count
      from public.products p
      left join public.erp_stock_levels l on l.product_id = p.id and l.warehouse_id = v_pt
      where p.store_id = p_store and coalesce(p.active, true)
        and (v_q = '' or lower(p.name) like '%' || v_q || '%' or lower(coalesce(p.sku, '')) like '%' || v_q || '%')
        and (not p_only_low or (case when v_pt is null then coalesce(p.stock, 0) else coalesce(l.qty, 0) end) <= 5)
      order by p.name
      limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    )
    select pg.id, pg.name, pg.sku, pg.cost_price, pg.total,
           coalesce((select jsonb_object_agg(l.warehouse_id::text, l.qty) from public.erp_stock_levels l
                     where l.product_id = pg.id and (v_pt is null or l.warehouse_id = v_pt)), '{}'::jsonb),
           pg.total_count
    from page pg
    order by pg.name;
end;
$$;
grant execute on function public.erp_stock_page(uuid, text, boolean, integer, integer) to authenticated;
