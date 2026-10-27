-- =====================================================================
-- REMHUB · Cumpleaños del equipo 🎂
--
--   · erp_employee_birthdays: la fecha de cumpleaños de cada empleado (y si
--     se muestra la edad; por defecto NO). Aparte de la ficha con salario.
--   · erp_birthdays: lo que ve TODO el equipo de la tienda (solo nombre,
--     punto, día y mes; nunca salario ni documento): quién cumple hoy,
--     mañana y en el mes, con el muro de felicitaciones.
--   · erp_birthday_wishes: felicitaciones del equipo (una por persona y año).
--   · erp_birthday_push_digest: avisos al celular a cada miembro (7 días
--     antes, el día anterior y el mismo día), para el envío diario.
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_employee_birthdays (
  employee_id uuid primary key references public.erp_employees(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  birthday date not null check (birthday between date '1900-01-01' and date '2100-01-01'),
  show_age boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists erp_employee_birthdays_store on public.erp_employee_birthdays (store_id);

create table if not exists public.erp_birthday_wishes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  employee_id uuid not null references public.erp_employees(id) on delete cascade,
  year integer not null,
  user_id uuid not null,
  author_name text,
  emoji text not null default '🎉',
  message text not null check (length(btrim(message)) between 1 and 280),
  created_at timestamptz not null default now(),
  unique (employee_id, year, user_id)
);
alter table public.erp_employee_birthdays enable row level security;
alter table public.erp_birthday_wishes enable row level security;
-- Sin políticas: todo pasa por las funciones de abajo.

-- ¿Es parte del equipo de la tienda? (dueño o usuario activo)
create or replace function public.erp__is_member(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid())
    or exists (select 1 from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() and coalesce(su.active, true)))
$$;

-- Próximo cumpleaños desde «hoy» (el 29 de febrero se celebra el 28 en años no bisiestos).
create or replace function public.erp__next_birthday(p_birthday date, p_today date)
returns date language plpgsql immutable as $$
declare v_y integer := extract(year from p_today)::integer; v date;
begin
  for i in 0..1 loop
    begin
      v := make_date(v_y + i, extract(month from p_birthday)::integer, extract(day from p_birthday)::integer);
    exception when others then
      v := make_date(v_y + i, 2, 28);
    end;
    if v >= p_today then return v; end if;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------- guardar (quien maneja empleados)
create or replace function public.erp_birthday_set(p_store uuid, p_employee uuid, p_birthday date, p_show_age boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'payroll') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso de nómina para cambiar los datos del empleado.');
  end if;
  if not exists (select 1 from public.erp_employees where id = p_employee and store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'El empleado no es de esta tienda.');
  end if;
  if p_birthday is null then
    delete from public.erp_employee_birthdays where employee_id = p_employee;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  if p_birthday > (now() at time zone 'America/Bogota')::date then
    return jsonb_build_object('ok', false, 'message', 'La fecha de cumpleaños no puede ser futura.');
  end if;
  insert into public.erp_employee_birthdays (employee_id, store_id, birthday, show_age, updated_by, updated_at)
  values (p_employee, p_store, p_birthday, coalesce(p_show_age, false), auth.uid(), now())
  on conflict (employee_id) do update set birthday = excluded.birthday, show_age = excluded.show_age, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.erp_birthday_get(p_store uuid, p_employee uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.erp_can(p_store, 'payroll') then jsonb_build_object('ok', false)
    else jsonb_build_object('ok', true, 'birthday', b.birthday, 'show_age', coalesce(b.show_age, false)) end
  from (select 1) x left join public.erp_employee_birthdays b on b.employee_id = p_employee and b.store_id = p_store
$$;

-- ---------------------------------------------------------------- lo que ve todo el equipo
create or replace function public.erp_birthdays(p_store uuid, p_days integer default 31)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_days integer := least(greatest(coalesce(p_days, 31), 1), 366);
  v_list jsonb;
begin
  if not public.erp__is_member(p_store) then return jsonb_build_object('ok', false, 'message', 'Solo el equipo de la tienda.'); end if;
  -- Quien cumplió hace 1 a 3 días sigue en la lista (para ver y dejar felicitaciones).
  with b as (
    select e.id, e.full_name, w.name as point_name, bd.birthday, bd.show_age,
           public.erp__next_birthday(bd.birthday, v_today - 3) as party_on
    from public.erp_employee_birthdays bd
    join public.erp_employees e on e.id = bd.employee_id and e.active and to_jsonb(e) ->> 'deleted_at' is null
    left join public.erp_warehouses w on w.id = e.point_id
    where bd.store_id = p_store
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', r.id, 'name', r.full_name, 'first_name', split_part(btrim(r.full_name), ' ', 1), 'point', r.point_name,
           'month', extract(month from r.birthday)::integer, 'day', extract(day from r.birthday)::integer,
           'date', r.party_on, 'days_left', r.party_on - v_today,
           'age', case when r.show_age then extract(year from r.party_on)::integer - extract(year from r.birthday)::integer end,
           'wishes', (select coalesce(jsonb_agg(jsonb_build_object('author', w.author_name, 'emoji', w.emoji, 'message', w.message, 'mine', w.user_id = auth.uid(), 'at', w.created_at) order by w.created_at), '[]'::jsonb)
                      from public.erp_birthday_wishes w where w.employee_id = r.id and w.year = extract(year from r.party_on)::integer))
         order by r.party_on, r.full_name), '[]'::jsonb)
    into v_list
  from b r
  where r.party_on - v_today <= v_days;
  return jsonb_build_object('ok', true, 'today', v_today, 'items', v_list);
end;
$$;

-- ---------------------------------------------------------------- felicitaciones del equipo
create or replace function public.erp_birthday_wish(p_store uuid, p_employee uuid, p_emoji text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  bd public.erp_employee_birthdays;
  v_party date;
begin
  if not public.erp__is_member(p_store) then return jsonb_build_object('ok', false, 'message', 'Solo el equipo de la tienda.'); end if;
  select * into bd from public.erp_employee_birthdays where employee_id = p_employee and store_id = p_store;
  if bd.employee_id is null then return jsonb_build_object('ok', false, 'message', 'Ese empleado no tiene cumpleaños guardado.'); end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then return jsonb_build_object('ok', false, 'message', 'Escribe tu felicitación.'); end if;
  -- Se felicita desde 7 días antes hasta 3 días después.
  v_party := public.erp__next_birthday(bd.birthday, v_today - 3);
  if v_party - v_today > 7 then return jsonb_build_object('ok', false, 'message', 'Las felicitaciones se abren 7 días antes del cumpleaños.'); end if;
  insert into public.erp_birthday_wishes (store_id, employee_id, year, user_id, author_name, emoji, message)
  values (p_store, p_employee, extract(year from v_party)::integer, auth.uid(), public.erp_actor_name(p_store),
    left(coalesce(nullif(btrim(p_emoji), ''), '🎉'), 8), left(btrim(p_message), 280))
  on conflict (employee_id, year, user_id) do update set emoji = excluded.emoji, message = excluded.message, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- avisos al celular (solo el servidor)
-- Una fila por persona del equipo y tienda: quiénes cumplen hoy, mañana y en 7 días.
create or replace function public.erp_birthday_push_digest()
returns table (store_id uuid, user_id uuid, today_names text[], tomorrow_names text[], week_names text[])
language sql
stable
security definer
set search_path = public
as $$
  with d as (select (now() at time zone 'America/Bogota')::date as today),
  b as (
    select bd.store_id, initcap(btrim(e.full_name)) as name,
           public.erp__next_birthday(bd.birthday, d.today) - d.today as left_days
    from public.erp_employee_birthdays bd join public.erp_employees e on e.id = bd.employee_id and e.active, d
  ),
  agg as (
    select b.store_id,
           array_agg(b.name order by b.name) filter (where b.left_days = 0) as t0,
           array_agg(b.name order by b.name) filter (where b.left_days = 1) as t1,
           array_agg(b.name order by b.name) filter (where b.left_days = 7) as t7
    from b where b.left_days in (0, 1, 7) group by b.store_id
  ),
  members as (
    select s.id as store_id, s.owner_id as user_id from public.stores s where s.owner_id is not null
    union
    select su.store_id, su.user_id from public.store_users su where coalesce(su.active, true)
  )
  select a.store_id, m.user_id, a.t0, a.t1, a.t7 from agg a join members m on m.store_id = a.store_id
$$;

revoke all on function public.erp__is_member(uuid) from public, anon;
revoke all on function public.erp_birthday_set(uuid, uuid, date, boolean) from public, anon;
revoke all on function public.erp_birthday_get(uuid, uuid) from public, anon;
revoke all on function public.erp_birthdays(uuid, integer) from public, anon;
revoke all on function public.erp_birthday_wish(uuid, uuid, text, text) from public, anon;
revoke all on function public.erp_birthday_push_digest() from public, anon, authenticated;
grant execute on function public.erp__is_member(uuid) to authenticated;
grant execute on function public.erp_birthday_set(uuid, uuid, date, boolean) to authenticated;
grant execute on function public.erp_birthday_get(uuid, uuid) to authenticated;
grant execute on function public.erp_birthdays(uuid, integer) to authenticated;
grant execute on function public.erp_birthday_wish(uuid, uuid, text, text) to authenticated;
grant execute on function public.erp_birthday_push_digest() to service_role;
