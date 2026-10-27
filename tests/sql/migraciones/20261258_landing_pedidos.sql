-- =====================================================================
-- REMHUB · Landing pages: panel de los pedidos que entran por las landings
--
--   erp_landing_orders_list: pedidos de las landings de la tienda con el
--   cliente, su WhatsApp, la nota (dirección, cédula, pago), los productos,
--   el total, el estado, de qué red llegó y de qué landing. Solo para quien
--   tiene el permiso de pedidos (trae datos personales del cliente).
-- Requiere 20261252. No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_landing_orders_list(p_store uuid, p_days integer default 30, p_page uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if auth.uid() is null or not public.erp_can(p_store, 'orders') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de pedidos para ver los datos de los clientes.');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'order_id', o.id, 'receipt_no', o.receipt_no, 'created_at', o.created_at, 'status', o.status,
             'payment_status', to_jsonb(o) ->> 'payment_status', 'total', o.total,
             'customer_name', o.customer_name, 'customer_whatsapp', o.customer_whatsapp, 'note', to_jsonb(o) ->> 'customer_note',
             'landing', jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug),
             'units', lo.units, 'payment', lo.payment, 'upsell', lo.upsell, 'city', lo.city, 'department', lo.department,
             'source', lo.source, 'campaign', lo.campaign,
             'items', (select coalesce(jsonb_agg(jsonb_build_object('name', pd.name, 'quantity', oi.quantity, 'price', oi.price) order by pd.name), '[]'::jsonb)
                       from public.order_items oi left join public.products pd on pd.id = oi.product_id where oi.order_id = o.id))
           order by lo.created_at desc)
    from (select * from public.erp_landing_orders x
          where x.store_id = p_store and x.created_at >= v_from and (p_page is null or x.page_id = p_page)
          order by x.created_at desc limit 300) lo
    join public.orders o on o.id = lo.order_id
    join public.erp_landing_pages p on p.id = lo.page_id), '[]'::jsonb));
end;
$$;

revoke all on function public.erp_landing_orders_list(uuid, integer, uuid) from public, anon;
grant execute on function public.erp_landing_orders_list(uuid, integer, uuid) to authenticated;
