-- =====================================================================
-- 20261300 · Exportar caja a Excel
--
-- «Importar y exportar» leía erp_cash_sessions y erp_cash_moves directo y la base lo niega (RLS sin
-- lectura directa): la hoja «Caja» salía con «permission denied». Esta función entrega las cajas abiertas
-- en el rango de fechas y sus movimientos, con los mismos permisos que la pantalla de Caja
-- («Caja» o «Administrar caja») y solo de los puntos del usuario.
-- Solo lectura. No borra datos. Es idempotente. Requiere 20261128.
-- =====================================================================

create or replace function public.erp_cash_export(p_store uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[] := public.erp_my_points(p_store);
begin
  if auth.uid() is null or not public.erp_can_any(p_store, array['cash', 'cash_manage']) then
    raise exception 'Necesitas el permiso «Caja».';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'El rango de fechas no es válido.';
  end if;
  return (
    with s as (
      select c.* from public.erp_cash_sessions c
      where c.store_id = p_store
        and (v_pts is null or c.point_id = any (v_pts))
        and (c.opened_at at time zone 'America/Bogota')::date between p_from and p_to
    )
    select jsonb_build_object(
      'sessions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'point', w.name, 'number', s.number, 'status', s.status, 'opening_amount', s.opening_amount,
          'opened_by_name', s.opened_by_name, 'opened_at', s.opened_at, 'expected_amount', s.expected_amount,
          'counted_amount', s.counted_amount, 'difference', s.difference, 'closed_by_name', s.closed_by_name,
          'closed_at', s.closed_at, 'closing_note', s.closing_note) order by s.opened_at)
        from s join public.erp_warehouses w on w.id = s.point_id), '[]'::jsonb),
      'moves', coalesce((select jsonb_agg(jsonb_build_object(
          'session_id', m.session_id, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason,
          'created_by_name', m.created_by_name, 'created_at', m.created_at) order by m.created_at)
        from public.erp_cash_moves m join s on s.id = m.session_id), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.erp_cash_export(uuid, date, date) from public, anon;
grant execute on function public.erp_cash_export(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
