-- =====================================================================
-- REMHUB · Copias de seguridad y seguridad (página del panel)
--
--   erp_security_overview: lo que el dueño necesita ver de un vistazo:
--     · cuándo se bajó la última copia completa en Excel y quién la bajó;
--     · cuántos usuarios hay, cuántos son administradores, cuántos están
--       inactivos y quién puede crear o cambiar usuarios;
--     · los últimos cambios de usuarios y permisos (de la auditoría).
--   Solo lectura. Solo el dueño o quien tenga el permiso de usuarios.
-- No borra datos. Es idempotente.
-- =====================================================================

create or replace function public.erp_security_overview(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last jsonb;
  v_team jsonb;
  v_changes jsonb;
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'users') or exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'message', 'Solo el dueño o quien administra los usuarios ve esta página.');
  end if;

  select jsonb_build_object('at', l.created_at, 'by', coalesce(su.display_name, su.username), 'rows', l.detail->'rows', 'what', l.action)
    into v_last
  from public.erp_audit_logs l
  left join public.store_users su on su.store_id = l.store_id and su.user_id = l.user_id
  where l.store_id = p_store and l.action like 'export.datos.%'
  order by l.created_at desc limit 1;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where su.active),
    'inactive', count(*) filter (where not su.active),
    'admins', count(*) filter (where su.active and su.role = 'store_admin'),
    'can_users', coalesce(jsonb_agg(coalesce(su.display_name, su.username, 'Usuario') order by su.username) filter (where su.active and (su.role = 'store_admin' or 'users' = any (su.permissions))), '[]'::jsonb),
    'can_costs', count(*) filter (where su.active and (su.role = 'store_admin' or 'costs_view' = any (su.permissions)))
  ) into v_team
  from public.store_users su where su.store_id = p_store;

  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_changes from (
    select jsonb_build_object('at', l.created_at, 'action', l.action, 'by', coalesce(su.display_name, su.username)) as x
    from public.erp_audit_logs l
    left join public.store_users su on su.store_id = l.store_id and su.user_id = l.user_id
    where l.store_id = p_store and (l.action like 'usuario.%' or l.action like 'users.%')
    order by l.created_at desc limit 8
  ) t;

  return jsonb_build_object('ok', true, 'last_backup', v_last, 'team', v_team, 'changes', v_changes);
end;
$$;

revoke all on function public.erp_security_overview(uuid) from public, anon;
grant execute on function public.erp_security_overview(uuid) to authenticated;
