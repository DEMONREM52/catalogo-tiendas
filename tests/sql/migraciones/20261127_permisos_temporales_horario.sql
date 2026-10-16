-- =====================================================================
-- REMHUB · Permisos 2.0: permisos temporales y horario de acceso
--
--   · Permiso temporal: «Juan puede anular hasta el viernes 6 p. m.».
--     Al vencer deja de servir al instante (lo valida la base) y la tarea
--     diaria lo quita de la lista del usuario.
--   · Horario de acceso: días y horas en que un usuario puede trabajar
--     (ej. lunes a sábado 7:00 a 20:00, hora Colombia). Fuera del horario
--     la base le niega todo. Al dueño nunca se le limita.
--
-- Cómo: NO se reescriben erp_can ni erp_can_any. Se guarda una copia
-- exacta de cada una (erp__can_base, erp__can_any_base) y la original pasa
-- a llamar a esa copia + la revisión de vencimiento y horario. Así todas
-- las reglas de seguridad que ya usan erp_can la respetan sin tocarlas.
-- Es idempotente (no se copia dos veces). No borra datos.
-- =====================================================================

-- 1. Tablas
create table if not exists public.erp_permission_grants (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  permission text not null,
  expires_at timestamptz not null,
  note text,
  granted_by uuid,
  granted_by_name text,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id, permission)
);

create table if not exists public.erp_access_schedules (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  active boolean not null default true,
  days smallint[] not null default '{1,2,3,4,5,6}',   -- 0 = domingo … 6 = sábado
  from_time time not null default '07:00',
  to_time time not null default '20:00',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

alter table public.erp_permission_grants enable row level security;
alter table public.erp_access_schedules enable row level security;
revoke all on public.erp_permission_grants, public.erp_access_schedules from anon, authenticated;

-- 2. ¿Está fuera de horario? (hora Colombia; acepta turnos que pasan la medianoche)
create or replace function public.erp__outside_schedule(p_store uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not (
      extract(dow from now() at time zone 'America/Bogota')::smallint = any (s.days)
      and case when s.from_time <= s.to_time
               then (now() at time zone 'America/Bogota')::time >= s.from_time and (now() at time zone 'America/Bogota')::time < s.to_time
               else (now() at time zone 'America/Bogota')::time >= s.from_time or (now() at time zone 'America/Bogota')::time < s.to_time end)
    from public.erp_access_schedules s
    where s.store_id = p_store and s.user_id = p_user and s.active), false);
$$;

-- ¿Este permiso está bloqueado para quien llama? (vencido o fuera de horario). Al dueño nunca.
create or replace function public.erp__perm_blocked(p_store uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
     and not exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin')
     and (
       exists (select 1 from public.erp_permission_grants g
               where g.store_id = p_store and g.user_id = auth.uid() and g.permission = p_perm and g.expires_at <= now())
       or public.erp__outside_schedule(p_store, auth.uid())
     );
$$;
revoke all on function public.erp__outside_schedule(uuid, uuid) from public, anon;
revoke all on function public.erp__perm_blocked(uuid, text) from public, anon;
grant execute on function public.erp__outside_schedule(uuid, uuid) to authenticated;
grant execute on function public.erp__perm_blocked(uuid, text) to authenticated;

-- 3. Envolver erp_can y erp_can_any (una sola vez).
do $$
declare v_def text; v_names text[];
begin
  -- erp_can(store, permiso)
  v_def := pg_get_functiondef('public.erp_can(uuid, text)'::regprocedure);
  if position('erp__can_base' in v_def) = 0 then
    execute regexp_replace(v_def, 'FUNCTION public\.erp_can\(', 'FUNCTION public.erp__can_base(');
    select proargnames into v_names from pg_proc where oid = 'public.erp_can(uuid, text)'::regprocedure;
    execute format($f$
      create or replace function public.erp_can(%1$I uuid, %2$I text)
      returns boolean language sql stable security definer set search_path = public as $b$
        select public.erp__can_base(%1$I, %2$I) and not public.erp__perm_blocked(%1$I, %2$I)
      $b$ $f$, v_names[1], v_names[2]);
  end if;

  -- erp_can_any(store, permisos)
  if to_regprocedure('public.erp_can_any(uuid, text[])') is not null then
    v_def := pg_get_functiondef('public.erp_can_any(uuid, text[])'::regprocedure);
    if position('erp__can_any_base' in v_def) = 0 then
      execute regexp_replace(v_def, 'FUNCTION public\.erp_can_any\(', 'FUNCTION public.erp__can_any_base(');
      select proargnames into v_names from pg_proc where oid = 'public.erp_can_any(uuid, text[])'::regprocedure;
      execute format($f$
        create or replace function public.erp_can_any(%1$I uuid, %2$I text[])
        returns boolean language sql stable security definer set search_path = public as $b$
          select public.erp__can_any_base(%1$I, %2$I)
             and exists (select 1 from unnest(%2$I) x where public.erp__can_base(%1$I, x) and not public.erp__perm_blocked(%1$I, x))
        $b$ $f$, v_names[1], v_names[2]);
    end if;
  end if;
end $$;
revoke all on function public.erp__can_base(uuid, text) from public, anon;
grant execute on function public.erp__can_base(uuid, text) to authenticated;
do $$
begin
  if to_regprocedure('public.erp__can_any_base(uuid, text[])') is not null then
    execute 'revoke all on function public.erp__can_any_base(uuid, text[]) from public, anon';
    execute 'grant execute on function public.erp__can_any_base(uuid, text[]) to authenticated';
  end if;
end $$;

-- 4. Administrar (quien tiene «Usuarios»).
create or replace function public.erp__users_manager(p_store uuid, p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'users') then raise exception 'Necesitas el permiso «Usuarios».'; end if;
  if p_user = auth.uid() then raise exception 'No puedes cambiar tus propios límites.'; end if;
  if exists (select 1 from public.stores where id = p_store and owner_id = p_user) then raise exception 'Al dueño no se le ponen límites.'; end if;
  if not exists (select 1 from public.store_users where store_id = p_store and user_id = p_user) then raise exception 'Ese usuario no es de esta tienda.'; end if;
end $$;
revoke all on function public.erp__users_manager(uuid, uuid) from public, anon, authenticated;

-- Dar un permiso por un tiempo (se agrega a sus permisos y vence solo).
create or replace function public.erp_permission_grant_temp(p_store uuid, p_user uuid, p_permission text, p_expires timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.erp__users_manager(p_store, p_user);
  if not (p_permission = any (public.erp__known_permissions())) then raise exception 'Permiso desconocido.'; end if;
  if p_expires is null or p_expires <= now() then raise exception 'La fecha de vencimiento debe ser futura.'; end if;
  if p_expires > now() + interval '366 days' then raise exception 'Máximo un año; para más, dalo como permiso fijo.'; end if;
  if exists (select 1 from public.store_users where store_id = p_store and user_id = p_user and p_permission = any (permissions))
     and not exists (select 1 from public.erp_permission_grants where store_id = p_store and user_id = p_user and permission = p_permission) then
    raise exception 'Ya tiene ese permiso fijo. Si quieres que venza, quítaselo primero y dáselo como temporal.';
  end if;
  update public.store_users set permissions = array_append(permissions, p_permission)
  where store_id = p_store and user_id = p_user and not (p_permission = any (permissions));
  insert into public.erp_permission_grants (store_id, user_id, permission, expires_at, note, granted_by, granted_by_name)
  values (p_store, p_user, p_permission, p_expires, left(nullif(btrim(coalesce(p_note, '')), ''), 200), auth.uid(), public.erp_actor_name(p_store))
  on conflict (store_id, user_id, permission) do update
    set expires_at = excluded.expires_at, note = excluded.note, granted_by = excluded.granted_by, granted_by_name = excluded.granted_by_name, created_at = now();
  perform public.erp_audit(p_store, 'users.temp_permission', 'store_users', p_user,
    jsonb_build_object('permission', p_permission, 'expires_at', p_expires, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- Quitar el límite de tiempo (queda fijo) o quitar el permiso de una vez.
create or replace function public.erp_permission_temp_end(p_store uuid, p_user uuid, p_permission text, p_keep boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.erp__users_manager(p_store, p_user);
  delete from public.erp_permission_grants where store_id = p_store and user_id = p_user and permission = p_permission;
  if not coalesce(p_keep, false) then
    update public.store_users set permissions = array_remove(permissions, p_permission) where store_id = p_store and user_id = p_user;
  end if;
  perform public.erp_audit(p_store, case when p_keep then 'users.temp_permission_kept' else 'users.temp_permission_removed' end, 'store_users', p_user,
    jsonb_build_object('permission', p_permission));
  return jsonb_build_object('ok', true);
end $$;

-- Horario de acceso (p_cfg null = sin horario).
create or replace function public.erp_access_schedule_save(p_store uuid, p_user uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days smallint[];
begin
  perform public.erp__users_manager(p_store, p_user);
  if p_cfg is null then
    delete from public.erp_access_schedules where store_id = p_store and user_id = p_user;
  else
    select coalesce(array_agg(distinct (x #>> '{}')::smallint order by (x #>> '{}')::smallint), '{}') into v_days
    from jsonb_array_elements(coalesce(p_cfg->'days', '[]'::jsonb)) x where (x #>> '{}') ~ '^[0-6]$';
    if cardinality(v_days) = 0 then raise exception 'Escoge al menos un día.'; end if;
    if nullif(p_cfg->>'from_time', '') is null or nullif(p_cfg->>'to_time', '') is null or (p_cfg->>'from_time') = (p_cfg->>'to_time') then
      raise exception 'Escribe la hora de entrada y de salida.';
    end if;
    insert into public.erp_access_schedules (store_id, user_id, active, days, from_time, to_time, updated_by, updated_at)
    values (p_store, p_user, coalesce((p_cfg->>'active')::boolean, true), v_days, (p_cfg->>'from_time')::time, (p_cfg->>'to_time')::time, auth.uid(), now())
    on conflict (store_id, user_id) do update set active = excluded.active, days = excluded.days, from_time = excluded.from_time,
      to_time = excluded.to_time, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.erp_audit(p_store, 'users.schedule', 'store_users', p_user, coalesce(p_cfg, '{"removed": true}'::jsonb));
  return jsonb_build_object('ok', true);
end $$;

-- Lo que ve la pantalla de usuarios: temporales y horarios de todos.
create or replace function public.erp_access_overview(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'users') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true,
    'grants', coalesce((select jsonb_agg(jsonb_build_object('user_id', g.user_id, 'permission', g.permission, 'expires_at', g.expires_at,
                                                            'expired', g.expires_at <= now(), 'note', g.note, 'by', g.granted_by_name) order by g.expires_at)
                        from public.erp_permission_grants g where g.store_id = p_store), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'active', s.active, 'days', s.days,
                                                               'from_time', to_char(s.from_time, 'HH24:MI'), 'to_time', to_char(s.to_time, 'HH24:MI')))
                           from public.erp_access_schedules s where s.store_id = p_store), '[]'::jsonb));
end $$;

-- Lo que la pantalla del propio usuario necesita: qué tiene bloqueado ahora y su horario.
create or replace function public.erp_my_access(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  v_owner := exists (select 1 from public.stores where id = p_store and owner_id = auth.uid());
  return jsonb_build_object('ok', true,
    'outside_schedule', not v_owner and public.erp__outside_schedule(p_store, auth.uid()),
    'schedule', (select jsonb_build_object('days', s.days, 'from_time', to_char(s.from_time, 'HH24:MI'), 'to_time', to_char(s.to_time, 'HH24:MI'))
                 from public.erp_access_schedules s where s.store_id = p_store and s.user_id = auth.uid() and s.active),
    'expired', case when v_owner then '[]'::jsonb else coalesce((select jsonb_agg(g.permission) from public.erp_permission_grants g
                  where g.store_id = p_store and g.user_id = auth.uid() and g.expires_at <= now()), '[]'::jsonb) end,
    'temporary', coalesce((select jsonb_agg(jsonb_build_object('permission', g.permission, 'expires_at', g.expires_at)) from public.erp_permission_grants g
                  where g.store_id = p_store and g.user_id = auth.uid() and g.expires_at > now()), '[]'::jsonb));
end $$;

-- Limpieza diaria: quita de la lista los permisos temporales vencidos (solo el servidor).
create or replace function public.erp_permission_grants_cleanup()
returns integer language plpgsql security definer set search_path = public as $$
declare g record; n integer := 0;
begin
  for g in select * from public.erp_permission_grants where expires_at <= now() loop
    update public.store_users set permissions = array_remove(permissions, g.permission) where store_id = g.store_id and user_id = g.user_id;
    delete from public.erp_permission_grants where store_id = g.store_id and user_id = g.user_id and permission = g.permission;
    perform public.erp_audit(g.store_id, 'users.temp_permission_expired', 'store_users', g.user_id, jsonb_build_object('permission', g.permission));
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['erp_permission_grant_temp(uuid, uuid, text, timestamptz, text)', 'erp_permission_temp_end(uuid, uuid, text, boolean)',
                           'erp_access_schedule_save(uuid, uuid, jsonb)', 'erp_access_overview(uuid)', 'erp_my_access(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.erp_permission_grants_cleanup() from public, anon, authenticated;
grant execute on function public.erp_permission_grants_cleanup() to service_role;

notify pgrst, 'reload schema';
