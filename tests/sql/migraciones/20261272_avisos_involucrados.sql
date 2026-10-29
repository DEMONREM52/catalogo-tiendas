-- =====================================================================
-- REMHUB · Avisos del chat de pedidos internos: solo a los involucrados (sobre 20261271)
--
--   Antes cada mensaje avisaba a todo el equipo de los dos puntos. Ahora:
--   · Si en el pedido se escogió a quién avisar (botón «🔔 Avisos»), solo a esas
--     personas.
--   · Si no, a los involucrados: quien pidió, quien atiende y quienes escribieron.
--   · Mientras nadie del punto que atiende lo haya tomado, también a ese punto
--     (para que un pedido nuevo no se quede sin respuesta).
--   · erp_sr_notify_get / erp_sr_notify_set: ver y escoger a quién avisar.
--   · erp_sr_should_notify: de una lista de pedidos, en cuáles me toca el aviso.
--   · erp_sr_notify_users: (solo servidor) a quién mandar el aviso al celular.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_sr_notify (
  request_id uuid not null references public.erp_stock_requests(id) on delete cascade,
  user_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);
alter table public.erp_sr_notify enable row level security;
revoke all on public.erp_sr_notify from anon, authenticated;

-- ¿A esta persona le toca el aviso de un mensaje en este pedido?
create or replace function public.erp__sr_notify_target(p_request uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  if exists (select 1 from public.erp_sr_notify where request_id = p_request) then
    return exists (select 1 from public.erp_sr_notify where request_id = p_request and user_id = p_user);
  end if;
  if public.erp__sr_involved(p_request, p_user) then return true; end if;
  select * into r from public.erp_stock_requests where id = p_request;
  -- Nadie del punto que atiende lo ha tomado: se le avisa a ese punto.
  -- Solo quienes están asignados a ese punto (no el dueño ni quienes ven todos los puntos).
  return r.id is not null and (to_jsonb(r) ->> 'handled_by') is null and exists (
    select 1 from public.store_users su, lateral (select to_jsonb(su) j) x
    where su.store_id = r.store_id and su.user_id = p_user and coalesce((x.j ->> 'active')::boolean, true)
      and (su.role = 'store_admin' or su.permissions && array['stock_requests', 'stock_requests_manage', 'transfers'])
      and (x.j ->> 'point_id' = r.to_point_id::text or (jsonb_typeof(x.j -> 'point_ids') = 'array' and (x.j -> 'point_ids') ? r.to_point_id::text)));
end $$;
revoke all on function public.erp__sr_notify_target(uuid, uuid) from public, anon, authenticated;

-- Quiénes pueden ver el pedido (para escoger a quién avisar o con quién abrir un chat).
create or replace function public.erp__sr_people(p_request uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select m.u from public.erp_stock_requests r,
    lateral (select su.user_id u from public.store_users su where su.store_id = r.store_id
             union select s.owner_id from public.stores s where s.id = r.store_id) m
  where r.id = p_request
    and (public.erp__sr_involved(p_request, m.u) or public.erp__member_covers(r.store_id, m.u, r.from_point_id) or public.erp__member_covers(r.store_id, m.u, r.to_point_id));
$$;
revoke all on function public.erp__sr_people(uuid) from public, anon, authenticated;

/** A quién avisar en este pedido: la lista (marcando involucrados y escogidos) y si se escogió a mano. */
create or replace function public.erp_sr_notify_get(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.erp_stock_requests;
begin
  select * into r from public.erp_stock_requests where id = p_request;
  if r.id is null or not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  return jsonb_build_object(
    'custom', exists (select 1 from public.erp_sr_notify where request_id = p_request),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.erp__member_name(r.store_id, p.user_id),
               'point', (select w.name from public.store_users su join public.erp_warehouses w on w.id::text = to_jsonb(su) ->> 'point_id' where su.store_id = r.store_id and su.user_id = p.user_id),
               'me', p.user_id = auth.uid(),
               'involved', public.erp__sr_involved(p_request, p.user_id),
               'selected', public.erp__sr_notify_target(p_request, p.user_id))
             order by (p.user_id = auth.uid()) desc, public.erp__sr_involved(p_request, p.user_id) desc, public.erp__member_name(r.store_id, p.user_id))
      from (select distinct user_id from public.erp__sr_people(p_request)) p
    ), '[]'::jsonb));
end $$;
revoke all on function public.erp_sr_notify_get(uuid) from public, anon;
grant execute on function public.erp_sr_notify_get(uuid) to authenticated;

/** Escoge a quién avisar en este pedido. Lista vacía = volver al automático (involucrados). */
create or replace function public.erp_sr_notify_set(p_request uuid, p_users uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.erp__sr_visible(p_request) then raise exception 'No tienes acceso a este pedido.'; end if;
  delete from public.erp_sr_notify where request_id = p_request;
  insert into public.erp_sr_notify (request_id, user_id, added_by)
  select p_request, u, auth.uid() from (select distinct unnest(coalesce(p_users, '{}'::uuid[])) u) x
  where u in (select user_id from public.erp__sr_people(p_request));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'count', v_n, 'custom', v_n > 0);
end $$;
revoke all on function public.erp_sr_notify_set(uuid, uuid[]) from public, anon;
grant execute on function public.erp_sr_notify_set(uuid, uuid[]) to authenticated;

/** De estos pedidos, ¿en cuáles me toca el aviso de mensajes? (para el sonido dentro de la app) */
create or replace function public.erp_sr_should_notify(p_requests uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x), '{}'::uuid[]) from unnest(coalesce(p_requests, '{}'::uuid[])) x
  where public.erp__sr_visible(x) and public.erp__sr_notify_target(x, auth.uid());
$$;
revoke all on function public.erp_sr_should_notify(uuid[]) from public, anon;
grant execute on function public.erp_sr_should_notify(uuid[]) to authenticated;

/** (Servidor) A quiénes mandar el aviso al celular de un mensaje del pedido. */
create or replace function public.erp_sr_notify_users(p_request uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.user_id), '{}'::uuid[]) from public.erp__sr_people(p_request) p
  where public.erp__sr_notify_target(p_request, p.user_id);
$$;
revoke all on function public.erp_sr_notify_users(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.erp_sr_notify_users(uuid) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
