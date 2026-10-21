-- =====================================================================
-- REMHUB · Clientes frecuentes
--
--   · erp_customer_insights(store, días): quién compra, cuánto, cada cuánto
--     y hace cuántos días no vuelve. Agrupa las ventas confirmadas por el
--     nombre del cliente (como queda en el documento) y toma el celular del
--     documento o de su ficha de terceros. Se ignoran «consumidor final» y
--     ventas sin nombre.
--   · Respeta los puntos: un usuario de punto solo ve las ventas de su punto.
-- Solo lectura. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_customer_insights(p_store uuid, p_days integer default 365)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 365), 7), 1825));
  r jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'clients') or public.erp_can(p_store, 'receivables') or public.erp_can(p_store, 'reports')) then
    return jsonb_build_object('ok', false, 'error', 'No tienes permiso para ver clientes.');
  end if;
  v := case when to_regprocedure('public.erp_my_points(uuid)') is not null then public.erp_my_points(p_store) end;
  with sales as (
    select o.id, o.total, coalesce(o.confirmed_at, o.created_at) as at,
           upper(btrim(regexp_replace(o.customer_name, '\s+', ' ', 'g'))) as who,
           nullif(regexp_replace(coalesce(o.customer_whatsapp, ''), '\D', '', 'g'), '') as phone
    from public.orders o
    left join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= v_since
      and (v is null or m.point_id = any (v))
      and nullif(btrim(coalesce(o.customer_name, '')), '') is not null
      and upper(btrim(o.customer_name)) not in ('CONSUMIDOR FINAL', 'CLIENTE', 'CLIENTE GENERAL', 'CF', 'MOSTRADOR', 'VARIOS')
  ),
  per as (
    select s.who, count(*)::integer as orders, coalesce(sum(s.total), 0) as total, max(s.at) as last_at, min(s.at) as first_at,
           (array_agg(s.phone order by s.at desc) filter (where s.phone is not null))[1] as phone
    from sales s group by s.who
  ),
  fav as (
    select x.who, jsonb_agg(x.name order by x.qty desc) filter (where x.rn <= 3) as top
    from (
      select s.who, p.name, sum(oi.quantity) as qty, row_number() over (partition by s.who order by sum(oi.quantity) desc, p.name) as rn
      from sales s join public.order_items oi on oi.order_id = s.id join public.products p on p.id = oi.product_id
      group by s.who, p.name
    ) x group by x.who
  ),
  cust as (
    select distinct on (upper(btrim(c.name))) upper(btrim(c.name)) as who, c.id,
           nullif(regexp_replace(coalesce(c.mobile, c.phone, ''), '\D', '', 'g'), '') as phone
    from public.billing_customers c where c.store_id = p_store
    order by upper(btrim(c.name)), c.created_at
  )
  select jsonb_build_object('ok', true, 'since', v_since, 'customers', coalesce(jsonb_agg(jsonb_build_object(
      'name', per.who, 'customer_id', cust.id, 'phone', coalesce(per.phone, cust.phone),
      'orders', per.orders, 'total', round(per.total), 'avg', round(per.total / greatest(per.orders, 1)),
      'last_at', per.last_at, 'first_at', per.first_at,
      'days_since', greatest(0, floor(extract(epoch from now() - per.last_at) / 86400))::integer,
      'every_days', case when per.orders > 1 then round(extract(epoch from per.last_at - per.first_at) / 86400 / (per.orders - 1)) end,
      'top', coalesce(fav.top, '[]'::jsonb))
    order by per.total desc), '[]'::jsonb))
  into r
  from (select * from per order by total desc limit 500) per
  left join fav on fav.who = per.who
  left join cust on cust.who = per.who;
  return r;
end;
$$;
revoke all on function public.erp_customer_insights(uuid, integer) from public, anon;
grant execute on function public.erp_customer_insights(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
