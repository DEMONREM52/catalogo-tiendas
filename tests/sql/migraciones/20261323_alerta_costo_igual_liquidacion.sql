-- =====================================================================
-- 20261323 · «Precio por debajo del costo» con el MISMO costo que la ganancia
--
-- Problema (SECADOR DE ROPA PORTÁTIL AB26114 2, 2026-11-17): último costo $30.000,
-- costo promedio $43.494, vendido a $36.512. El POS decía «por debajo del costo»
-- porque comparaba siempre contra el PROMEDIO, aunque el precio se calcula con el
-- último costo (20261206) y la ganancia del punto puede usar el último costo (20261287).
--
-- Ahora el aviso del POS, la alerta que le llega al administrador y la lista de
-- «Precios por debajo del costo» usan el costo que de verdad se va a usar:
--   · Venta en un punto (aviso y alerta): el costo con que se guarda la ganancia de esa
--     venta (erp__sale_cost_basis del punto): el último costo si el punto lo tiene activado
--     y el producto tiene compras; si no, el promedio. Así el aviso sale solo cuando
--     la liquidación también va a mostrar pérdida.
--   · Lista de precios (Rentabilidad): la base con que la tienda calcula los precios
--     (price_cost_basis: último costo o promedio).
-- El vendedor sigue sin ver el costo. No cambia permisos.
-- Requiere 20261206, 20261225 y 20261287. No borra datos. Es idempotente.
-- =====================================================================

-- Costo unitario con que se guarda la ganancia de una venta de este producto en este punto, ahora.
create or replace function public.erp__sale_unit_cost(p_store uuid, p_point uuid, p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when public.erp__sale_cost_basis(p_store, p_point, now()) = 'last' and coalesce(p.last_cost, 0) > 0
              then p.last_cost else coalesce(p.cost_price, 0) end
  from public.products p
  where p.id = p_product and p.store_id = p_store;
$$;
revoke all on function public.erp__sale_unit_cost(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- aviso del POS
-- Ahora recibe el punto desde donde se vende (opcional: sin punto, el promedio, como antes).
drop function if exists public.erp_below_cost_check(uuid, jsonb);
create or replace function public.erp_below_cost_check(p_store uuid, p_items jsonb, p_point uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.erp__is_store_member(p_store) then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object('product_id', c.id, 'name', c.name) order by c.name)
      from (
        select p.id, p.name, coalesce((x->>'price')::numeric, 0) as price,
               public.erp__sale_unit_cost(p_store,
                 (select w.id from public.erp_warehouses w where w.id = p_point and w.store_id = p_store), p.id) as cost
        from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
        join public.products p on p.id = (x->>'product_id')::uuid and p.store_id = p_store
      ) c
      where c.cost > 0 and c.price < c.cost
    ), '[]'::jsonb) end;
$$;
revoke all on function public.erp_below_cost_check(uuid, jsonb, uuid) from public, anon;
grant execute on function public.erp_below_cost_check(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- alerta al administrador
create or replace function public.erp__capture_cost_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  begin
    insert into public.erp_cost_alerts (store_id, order_id, point_id, product_id, product_name, qty, price, cost, seller_id, seller_name, doc_number)
    select new.store_id, new.order_id, new.point_id, oi.product_id, p.name, sum(oi.quantity)::integer, min(oi.price), c.cost,
           new.seller_id, new.seller_name, new.doc_number
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    cross join lateral (select public.erp__sale_unit_cost(new.store_id, new.point_id, p.id) as cost) c
    where oi.order_id = new.order_id and coalesce(c.cost, 0) > 0 and oi.price < c.cost
    group by oi.product_id, p.name, c.cost
    on conflict (order_id, product_id) do nothing;
    get diagnostics n = row_count;
    -- Aviso al celular (pg_net), si está instalado. Nunca frena la venta.
    if n > 0 and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
      perform net.http_post(
        url := 'https://remhub.co/api/push/cost-alerts',
        body := jsonb_build_object('order_id', new.order_id),
        headers := '{"Content-Type": "application/json"}'::jsonb);
    end if;
  exception when others then
    null; -- una alerta nunca puede impedir facturar
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------- lista de precios bajo el costo
create or replace function public.erp_prices_below_cost(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb; v_basis text;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'costs_view') or public.erp_can(p_store, 'profit_view')) then
    return jsonb_build_object('ok', false, 'error', 'Necesitas «Ver costos».');
  end if;
  v_basis := coalesce((select price_cost_basis from public.erp_profit_settings where store_id = p_store), 'last');
  with b as (
    select p.*, case when v_basis = 'last' and coalesce(p.last_cost, 0) > 0 then p.last_cost else coalesce(p.cost_price, 0) end as base_cost
    from public.products p
    where p.store_id = p_store and coalesce(p.active, true)
  )
  select jsonb_build_object('ok', true, 'basis', v_basis, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'product_id', b.id, 'name', b.name, 'sku', b.sku, 'cost', b.base_cost,
      'levels', (select jsonb_agg(l) from unnest(array[1, 2, 3, 4, 5]) l
                 where coalesce(case l when 1 then b.price_1 when 2 then b.price_2 when 3 then b.price_3 when 4 then b.price_4 else b.price_5 end, 0) between 0.01 and b.base_cost - 0.01),
      'prices', jsonb_build_array(b.price_1, b.price_2, b.price_3, b.price_4, b.price_5)) order by b.name), '[]'::jsonb))
  into r
  from b
  where b.base_cost > 0
    and (   (coalesce(b.price_1, 0) > 0 and b.price_1 < b.base_cost) or (coalesce(b.price_2, 0) > 0 and b.price_2 < b.base_cost)
         or (coalesce(b.price_3, 0) > 0 and b.price_3 < b.base_cost) or (coalesce(b.price_4, 0) > 0 and b.price_4 < b.base_cost)
         or (coalesce(b.price_5, 0) > 0 and b.price_5 < b.base_cost));
  return r;
end;
$$;
revoke all on function public.erp_prices_below_cost(uuid) from public, anon;
grant execute on function public.erp_prices_below_cost(uuid) to authenticated;

notify pgrst, 'reload schema';
