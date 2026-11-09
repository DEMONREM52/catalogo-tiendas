-- 20261303 · Avisos de pedidos pendientes en la campana
--
-- La campana muestra:
--   · Pedidos SIN CONFIRMAR (borrador o enviado): cuántos, el total y si alguno lleva más de un día.
--   · Pedidos CONFIRMADOS SIN COMPLETAR (aún no entregados): cuántos, el total y si alguno lleva más de un día.
-- Cada aviso lleva a Pedidos con esa vista abierta (?ver=to_confirm / ?ver=to_complete).
-- Solo lo ve quien tiene permiso de Pedidos o POS, y solo los pedidos de sus puntos (erp__order_visible).
-- Se miran los últimos 60 días. La clave del aviso cambia con la cantidad: si llega uno nuevo, vuelve a salir como «Nueva».
-- No cambia datos ni permisos. Se puede correr varias veces.

create or replace function public.erp_order_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  c_conf integer; c_conf_old integer; t_conf numeric;
  c_comp integer; c_comp_old integer; t_comp numeric;
  fmt text;
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['orders', 'pos']::text[]) then
    return '[]'::jsonb;
  end if;

  select count(*) filter (where o.status in ('draft', 'sent')),
         count(*) filter (where o.status in ('draft', 'sent') and o.created_at < now() - interval '24 hours'),
         coalesce(sum(o.total) filter (where o.status in ('draft', 'sent')), 0),
         count(*) filter (where o.status = 'confirmed'),
         count(*) filter (where o.status = 'confirmed' and coalesce(o.confirmed_at, o.created_at) < now() - interval '24 hours'),
         coalesce(sum(o.total) filter (where o.status = 'confirmed'), 0)
    into c_conf, c_conf_old, t_conf, c_comp, c_comp_old, t_comp
  from public.orders o
  where o.store_id = p_store
    and o.status in ('draft', 'sent', 'confirmed')
    and o.created_at > now() - interval '60 days'
    and public.erp__order_visible(p_store, o.id);

  if c_conf > 0 then
    fmt := '$' || replace(to_char(round(t_conf), 'FM999,999,999,990'), ',', '.');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'orders-to-confirm-' || c_conf,
      'severity', case when c_conf_old > 0 then 'warning' else 'info' end,
      'icon', 'receipt',
      'count', c_conf,
      'title', c_conf || ' pedido' || case when c_conf = 1 then '' else 's' end || ' sin confirmar',
      'body', fmt || case when c_conf_old > 0 then ' · ' || c_conf_old || ' lleva' || case when c_conf_old = 1 then '' else 'n' end || ' más de un día. ' else '. ' end
              || 'Confírmalos o anúlalos para mantener el inventario al día.',
      'href', '/dashboard/pedidos?ver=to_confirm'));
  end if;

  if c_comp > 0 then
    fmt := '$' || replace(to_char(round(t_comp), 'FM999,999,999,990'), ',', '.');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'orders-to-complete-' || c_comp,
      'severity', case when c_comp_old > 0 then 'warning' else 'info' end,
      'icon', 'shopping-bag',
      'count', c_comp,
      'title', c_comp || ' pedido' || case when c_comp = 1 then '' else 's' end || ' sin completar',
      'body', fmt || case when c_comp_old > 0 then ' · ' || c_comp_old || ' confirmado' || case when c_comp_old = 1 then '' else 's' end || ' hace más de un día. ' else '. ' end
              || 'Márcalos como completados cuando se entreguen.',
      'href', '/dashboard/pedidos?ver=to_complete'));
  end if;

  return v_out;
end;
$$;

revoke all on function public.erp_order_alerts(uuid) from public, anon;
grant execute on function public.erp_order_alerts(uuid) to authenticated;
