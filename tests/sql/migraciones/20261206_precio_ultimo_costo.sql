-- =====================================================================
-- REMHUB · Precios por % sobre el ÚLTIMO COSTO (no sobre el promedio)
--
-- Antes: precio = costo PROMEDIO × (1 + %). Si había 100 und. a $47.900 y
-- entraban 100 a $35.000, el promedio quedaba en $41.450 y el 20 % daba
-- $50.000 en vez de $42.000.
--
-- Ahora:
--   · Cada producto guarda su ÚLTIMO COSTO: el de la factura de compra más
--     reciente que no esté anulada. Si se anula o se corrige esa factura,
--     vuelve al de la anterior.
--   · Los precios por % se calculan sobre el último costo (regla de la tienda;
--     se puede volver al promedio). Si un producto no tiene compras, usa el promedio.
--   · El costo PROMEDIO sigue igual para valorar el inventario (kardex).
--   · Esta migración NO cambia ningún precio todavía: el panel muestra cuántos
--     y cuáles cambian, y se aplican con un botón (o con el script de abajo).
-- Requiere 20261113 y 20261119. No borra datos. Es idempotente.
-- =====================================================================

alter table public.products add column if not exists last_cost numeric(14, 4);
alter table public.products add column if not exists last_cost_at timestamptz;
alter table public.erp_profit_settings add column if not exists price_cost_basis text not null default 'last';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_profit_settings_cost_basis') then
    alter table public.erp_profit_settings add constraint erp_profit_settings_cost_basis check (price_cost_basis in ('last', 'average'));
  end if;
end $$;
-- El último costo es un dato de costo: nadie lo cambia ni lo lee directo (solo las funciones).
revoke update (last_cost, last_cost_at) on public.products from anon, authenticated;
revoke select (last_cost, last_cost_at) on public.products from anon, authenticated;

-- Último costo de un producto: el de su factura de compra más reciente (si en esa factura viene
-- en varias líneas, el promedio de esas líneas). Anuladas no cuentan.
create or replace function public.erp__refresh_last_cost(p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_purchase uuid; v_at timestamptz; v_cost numeric;
begin
  select p.id, p.created_at into v_purchase, v_at
  from public.erp_purchase_items i join public.erp_purchases p on p.id = i.purchase_id
  where i.product_id = p_product and i.unit_cost > 0 and coalesce(p.status, 'received') not in ('cancelled', 'void', 'anulada', 'draft')
  order by p.created_at desc, p.id desc limit 1;
  if v_purchase is not null then
    select round(sum(i.qty * i.unit_cost) / nullif(sum(i.qty), 0), 4) into v_cost
    from public.erp_purchase_items i where i.purchase_id = v_purchase and i.product_id = p_product and i.unit_cost > 0;
  end if;
  update public.products set last_cost = v_cost, last_cost_at = case when v_cost is null then null else v_at end
  where id = p_product and (last_cost is distinct from v_cost or last_cost_at is distinct from (case when v_cost is null then null else v_at end));
end $$;
revoke all on function public.erp__refresh_last_cost(uuid) from public, anon, authenticated;

create or replace function public.erp__purchase_item_last_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.erp__refresh_last_cost(new.product_id); end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.product_id is distinct from new.product_id) then perform public.erp__refresh_last_cost(old.product_id); end if;
  return null;
end $$;
revoke all on function public.erp__purchase_item_last_cost() from public, anon, authenticated;
drop trigger if exists erp_purchase_items_last_cost on public.erp_purchase_items;
create trigger erp_purchase_items_last_cost after insert or update or delete on public.erp_purchase_items
  for each row execute function public.erp__purchase_item_last_cost();

-- Anular (o reactivar) una factura: el último costo vuelve al de la factura anterior.
create or replace function public.erp__purchase_status_last_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is not distinct from old.status then return null; end if;
  for r in select distinct product_id from public.erp_purchase_items where purchase_id = new.id loop
    perform public.erp__refresh_last_cost(r.product_id);
  end loop;
  return null;
end $$;
revoke all on function public.erp__purchase_status_last_cost() from public, anon, authenticated;
drop trigger if exists erp_purchases_last_cost on public.erp_purchases;
create trigger erp_purchases_last_cost after update of status on public.erp_purchases
  for each row execute function public.erp__purchase_status_last_cost();

-- Precio = costo × (1 + %): el costo es el ÚLTIMO (regla de la tienda) o el promedio.
create or replace function public.erp__product_autoprice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_step integer := 100; v_dir text := 'nearest'; v_basis text := 'last'; v_changed boolean; v_cost numeric;
begin
  if coalesce(current_setting('erp.skip_reprice', true), '') = '1' then return new; end if;
  if new.markup_1 is null and new.markup_2 is null and new.markup_3 is null and new.markup_4 is null and new.markup_5 is null then return new; end if;
  v_changed := tg_op = 'INSERT'
    or coalesce(current_setting('remhub.force_reprice', true), '') = '1'
    or new.cost_price is distinct from old.cost_price or new.last_cost is distinct from old.last_cost
    or new.markup_1 is distinct from old.markup_1 or new.markup_2 is distinct from old.markup_2 or new.markup_3 is distinct from old.markup_3
    or new.markup_4 is distinct from old.markup_4 or new.markup_5 is distinct from old.markup_5;
  if not v_changed then return new; end if;
  select coalesce(s.product_round_step, 100), coalesce(s.product_round_dir, 'nearest'), coalesce(s.price_cost_basis, 'last')
  into v_step, v_dir, v_basis from public.erp_profit_settings s where s.store_id = new.store_id;
  v_step := coalesce(v_step, 100); v_dir := coalesce(v_dir, 'nearest'); v_basis := coalesce(v_basis, 'last');
  v_cost := case when v_basis = 'last' and coalesce(new.last_cost, 0) > 0 then new.last_cost else new.cost_price end;
  if coalesce(v_cost, 0) <= 0 then return new; end if;
  if new.markup_1 is not null then new.price_1 := public.erp__round_step(round(v_cost * (1 + new.markup_1 / 100), 0), v_step, v_dir); end if;
  if new.markup_2 is not null then new.price_2 := public.erp__round_step(round(v_cost * (1 + new.markup_2 / 100), 0), v_step, v_dir); end if;
  if new.markup_3 is not null then new.price_3 := public.erp__round_step(round(v_cost * (1 + new.markup_3 / 100), 0), v_step, v_dir); end if;
  if new.markup_4 is not null then new.price_4 := public.erp__round_step(round(v_cost * (1 + new.markup_4 / 100), 0), v_step, v_dir); end if;
  if new.markup_5 is not null then new.price_5 := public.erp__round_step(round(v_cost * (1 + new.markup_5 / 100), 0), v_step, v_dir); end if;
  new.price_retail := new.price_3;
  new.price_wholesale := new.price_2;
  return new;
end;
$$;

-- Llenar el último costo de todos los productos SIN cambiar precios todavía.
do $$
declare r record;
begin
  perform set_config('erp.skip_reprice', '1', true);
  for r in select distinct i.product_id from public.erp_purchase_items i loop
    perform public.erp__refresh_last_cost(r.product_id);
  end loop;
  perform set_config('erp.skip_reprice', '', true);
end $$;

-- Panel: regla de la tienda y último costo de productos.
create or replace function public.erp_product_pricing_get(p_store uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.erp__is_store_member(p_store) then jsonb_build_object(
    'round_step', coalesce((select product_round_step from public.erp_profit_settings where store_id = p_store), 100),
    'round_dir', coalesce((select product_round_dir from public.erp_profit_settings where store_id = p_store), 'nearest'),
    'default_markup', coalesce((select default_markup from public.erp_profit_settings where store_id = p_store), 15),
    'cost_basis', coalesce((select price_cost_basis from public.erp_profit_settings where store_id = p_store), 'last'),
    'can_edit', public.erp_can(p_store, 'products') and public.erp_my_points(p_store) is null)
  else null end;
$$;
revoke all on function public.erp_product_pricing_get(uuid) from public, anon;
grant execute on function public.erp_product_pricing_get(uuid) to authenticated;

create or replace function public.erp_product_last_costs(p_store uuid, p_ids uuid[])
returns table (product_id uuid, last_cost numeric, last_cost_at timestamptz, avg_cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Mismo permiso que ver el costo (lo revisa erp_product_costs).
  perform 1 from public.erp_product_costs(p_store, p_ids) limit 1;
  return query select p.id, p.last_cost, p.last_cost_at, p.cost_price from public.products p where p.store_id = p_store and p.id = any (p_ids);
end $$;
revoke all on function public.erp_product_last_costs(uuid, uuid[]) from public, anon;
grant execute on function public.erp_product_last_costs(uuid, uuid[]) to authenticated;

-- Productos cuyo precio cambia si se recalcula con la regla actual (para revisar antes de aplicar).
create or replace function public.erp_reprice_preview(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_step integer; v_dir text; v_basis text; v_see boolean := public.erp_can(p_store, 'costs_view');
begin
  if not public.erp_can(p_store, 'products') or public.erp_my_points(p_store) is not null then raise exception 'Solo la tienda madre con permiso «Productos».'; end if;
  select coalesce(s.product_round_step, 100), coalesce(s.product_round_dir, 'nearest'), coalesce(s.price_cost_basis, 'last')
  into v_step, v_dir, v_basis from public.erp_profit_settings s where s.store_id = p_store;
  v_step := coalesce(v_step, 100); v_dir := coalesce(v_dir, 'nearest'); v_basis := coalesce(v_basis, 'last');
  return (
    with base as (
      select p.id, p.name, p.cost_price, p.last_cost, p.price_3 as old_price,
             case when v_basis = 'last' and coalesce(p.last_cost, 0) > 0 then p.last_cost else p.cost_price end as cost, p.markup_3
      from public.products p
      where p.store_id = p_store and coalesce(p.active, true)
        and (p.markup_1 is not null or p.markup_2 is not null or p.markup_3 is not null or p.markup_4 is not null or p.markup_5 is not null)
    ), calc as (
      select b.*, case when b.markup_3 is null or coalesce(b.cost, 0) <= 0 then b.old_price
                       else public.erp__round_step(round(b.cost * (1 + b.markup_3 / 100), 0), v_step, v_dir) end as new_price
      from base b
    )
    select jsonb_build_object(
      'basis', v_basis,
      'changes', (select count(*) from calc where new_price is distinct from old_price),
      'up', (select count(*) from calc where new_price > old_price),
      'down', (select count(*) from calc where new_price < old_price),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name,
                                                              -- Los costos solo con «Ver costos».
                                                              'avg_cost', case when v_see then cost_price end, 'last_cost', case when v_see then last_cost end,
                                                              'old_price', old_price, 'new_price', new_price) order by abs(new_price - old_price) desc)
                          from (select * from calc where new_price is distinct from old_price order by abs(new_price - old_price) desc limit 40) x), '[]'::jsonb))
  );
end $$;
revoke all on function public.erp_reprice_preview(uuid) from public, anon;
grant execute on function public.erp_reprice_preview(uuid) to authenticated;

-- Cambiar la regla (último costo / promedio) y, si se pide, recalcular ya todos los precios por %.
create or replace function public.erp_reprice_apply(p_store uuid, p_basis text, p_apply boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_basis text := lower(btrim(coalesce(p_basis, 'last'))); v_n integer := 0;
begin
  if not public.erp_can(p_store, 'products') or public.erp_my_points(p_store) is not null then raise exception 'Solo la tienda madre con permiso «Productos».'; end if;
  if v_basis not in ('last', 'average') then raise exception 'Regla inválida.'; end if;
  insert into public.erp_profit_settings (store_id, price_cost_basis) values (p_store, v_basis)
  on conflict (store_id) do update set price_cost_basis = excluded.price_cost_basis;
  if p_apply then
    perform set_config('remhub.force_reprice', '1', true);
    update public.products set updated_at = now()
    where store_id = p_store and (markup_1 is not null or markup_2 is not null or markup_3 is not null or markup_4 is not null or markup_5 is not null);
    get diagnostics v_n = row_count;
    perform set_config('remhub.force_reprice', '', true);
  end if;
  perform public.erp_audit(p_store, 'products.reprice', 'products', null, jsonb_build_object('basis', v_basis, 'applied', p_apply, 'products', v_n));
  return jsonb_build_object('ok', true, 'basis', v_basis, 'products', v_n);
end $$;
revoke all on function public.erp_reprice_apply(uuid, text, boolean) from public, anon;
grant execute on function public.erp_reprice_apply(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
