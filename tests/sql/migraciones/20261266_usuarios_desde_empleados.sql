-- =====================================================================
-- REMHUB · Crear usuarios con los datos de los empleados
--
--   En Usuarios se puede escoger un empleado (de Gastos → Nómina) y se
--   llenan solos el nombre, el usuario sugerido y el punto.
--   Pide el permiso «Usuarios» (no «Nómina») y solo entrega lo necesario
--   para crear el acceso: nada de salario, banco ni contrato.
--   Quien tiene puntos asignados solo ve los empleados de sus puntos.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_employees_for_users(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_points uuid[] := public.erp_my_points(p_store);
begin
  if not public.erp_can(p_store, 'users') then raise exception 'Necesitas el permiso «Usuarios».'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'document', e.document, 'position', e.position,
      'phone', e.phone, 'point_id', e.point_id) order by e.full_name)
    from public.erp_employees e
    where e.store_id = p_store and e.active and e.deleted_at is null and (v_points is null or e.point_id = any (v_points))), '[]'::jsonb);
end $$;
revoke all on function public.erp_employees_for_users(uuid) from public, anon;
grant execute on function public.erp_employees_for_users(uuid) to authenticated;

notify pgrst, 'reload schema';
