-- 20261306 · Radar de productos: plan del día, aviso al celular, por punto, efecto de publicar, metas, tareas y calendario
-- (Necesita 20261305.)
--
--   · erp_publish_settings: por tienda, cuántos productos publicar al día (plan del día), a qué hora avisar al
--     celular (null = no avisar) y la meta de salud del Radar.
--     product_radar_settings_get / product_radar_settings_save.
--   · product_radar(p_store, p_point): igual que antes, ahora con filtro por punto (existencias y ventas solo de
--     ese punto) y, por producto, cuánto hay y cuánto se vendió en cada punto (para sugerir traslados).
--     Respeta los puntos de cada persona (erp_my_points). Se reemplaza la versión de un solo parámetro.
--   · product_publish_info: cada publicación trae las unidades vendidas 7 días antes y 7 días después.
--   · erp_radar_snapshots: salud promedio del Radar por día (para la gráfica y la meta).
--     product_radar_snapshot_save / product_radar_history.
--   · erp_product_tasks: tareas de productos asignadas a alguien del equipo («Laura: subir fotos de estos 20»).
--     product_team, product_task_create, product_task_list, product_task_set_status, erp_product_task_alerts (campana).
--   · product_publish_calendar(p_store, p_month): publicado y por publicar por día, y quién publicó cuánto.
--   · erp_publish_push_digest(p_hour): para el aviso diario al celular (solo service_role).
-- Permiso: «products». No cambia productos, precios, existencias ni permisos. Se puede correr varias veces.

-- ===== Configuración =====
create table if not exists public.erp_publish_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  daily_target integer not null default 5 check (daily_target between 1 and 100),
  push_hour integer default 9 check (push_hour is null or push_hour between 0 and 23),
  health_goal integer not null default 85 check (health_goal between 10 and 100),
  updated_at timestamptz not null default now()
);
alter table public.erp_publish_settings enable row level security;
revoke all on public.erp_publish_settings from anon, authenticated;

create or replace function public.product_radar_settings_get(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'settings', coalesce(
    (select jsonb_build_object('daily_target', s.daily_target, 'push_hour', s.push_hour, 'health_goal', s.health_goal)
       from public.erp_publish_settings s where s.store_id = p_store),
    jsonb_build_object('daily_target', 5, 'push_hour', 9, 'health_goal', 85)));
end;
$$;

create or replace function public.product_radar_settings_save(p_store uuid, p_daily_target integer, p_push_hour integer, p_health_goal integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if p_daily_target is null or p_daily_target not between 1 and 100 then
    return jsonb_build_object('ok', false, 'message', 'Productos por día: entre 1 y 100.');
  end if;
  if p_push_hour is not null and p_push_hour not between 0 and 23 then
    return jsonb_build_object('ok', false, 'message', 'Hora no válida.');
  end if;
  if p_health_goal is null or p_health_goal not between 10 and 100 then
    return jsonb_build_object('ok', false, 'message', 'Meta de salud: entre 10 y 100.');
  end if;
  insert into public.erp_publish_settings (store_id, daily_target, push_hour, health_goal, updated_at)
  values (p_store, p_daily_target, p_push_hour, p_health_goal, now())
  on conflict (store_id) do update set daily_target = excluded.daily_target, push_hour = excluded.push_hour,
    health_goal = excluded.health_goal, updated_at = excluded.updated_at;
  return public.product_radar_settings_get(p_store);
end;
$$;

-- ===== Radar por punto =====
drop function if exists public.product_radar(uuid);
create or replace function public.product_radar(p_store uuid, p_point uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costs boolean;
  v_mine uuid[] := public.erp_my_points(p_store);
  v_pts uuid[];
  v_out jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if p_point is not null then
    if v_mine is not null and not (p_point = any (v_mine)) then
      return jsonb_build_object('ok', false, 'message', 'No tienes acceso a ese punto.');
    end if;
    v_pts := array[p_point];
  else
    v_pts := v_mine; -- null = todos
  end if;
  v_costs := public.erp_can(p_store, 'costs_view');

  with sales_pt as (
    select oi.product_id, m.point_id,
           max(o.created_at) as last_sale_at,
           coalesce(sum(oi.quantity) filter (where o.created_at >= now() - interval '30 days'), 0) as sold_30,
           coalesce(sum(oi.quantity) filter (where o.created_at >= now() - interval '90 days'), 0) as sold_90
    from public.orders o join public.order_items oi on oi.order_id = o.id
    left join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed') and o.created_at >= now() - interval '365 days'
    group by oi.product_id, m.point_id
  ), sales as (
    select product_id, max(last_sale_at) as last_sale_at, sum(sold_30) as sold_30, sum(sold_90) as sold_90
    from sales_pt where v_pts is null or point_id = any (v_pts) group by product_id
  ), stock_pt as (
    select s.product_id, s.warehouse_id, sum(s.qty) as qty
    from public.erp_stock_levels s where s.store_id = p_store group by s.product_id, s.warehouse_id
  ), stock as (
    select product_id, sum(qty) as qty, count(*) filter (where qty > 0) as points
    from stock_pt where v_pts is null or warehouse_id = any (v_pts) group by product_id
  ), by_point as (
    select x.product_id, jsonb_agg(jsonb_build_object('id', x.pid, 'qty', x.qty, 'sold_30', x.sold_30) order by x.sold_30 desc, x.qty desc) as j
    from (
      select coalesce(a.product_id, b.product_id) as product_id, coalesce(a.warehouse_id, b.point_id) as pid,
             coalesce(a.qty, 0) as qty, coalesce(b.sold_30, 0) as sold_30
      from stock_pt a full join sales_pt b on b.product_id = a.product_id and b.point_id = a.warehouse_id
      where coalesce(a.warehouse_id, b.point_id) is not null
        and (v_mine is null or coalesce(a.warehouse_id, b.point_id) = any (v_mine))
        and (coalesce(a.qty, 0) > 0 or coalesce(b.sold_30, 0) > 0)
    ) x group by x.product_id
  ), cats as (
    select l.product_id, count(*) as n from public.product_category_links l where l.store_id = p_store group by l.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'image', p.image_url, 'active', coalesce(p.active, true),
      'code', coalesce(nullif(p.sku, ''), to_jsonb(p) ->> 'product_no'), 'barcode', nullif(p.barcode, ''),
      'created_at', p.created_at,
      'prices', jsonb_build_array(coalesce(p.price_1, 0), coalesce(p.price_2, 0), coalesce(p.price_3, 0), coalesce(p.price_4, 0), coalesce(p.price_5, 0)),
      'cost', case when v_costs then coalesce(p.cost_price, 0) end,
      'category_id', p.category_id,
      'cats', greatest(coalesce(c.n, 0), case when p.category_id is not null then 1 else 0 end),
      'desc', length(btrim(regexp_replace(coalesce(p.description, ''), '<[^>]*>', '', 'g'))) > 0,
      'long', length(btrim(regexp_replace(coalesce(p.product_details ->> 'long_description', ''), '<[^>]*>', '', 'g'))) > 0,
      'gallery', case when jsonb_typeof(p.product_details -> 'gallery_urls') = 'array' then jsonb_array_length(p.product_details -> 'gallery_urls') else 0 end,
      'video', nullif(btrim(coalesce(p.product_details ->> 'video_url', '')), '') is not null,
      'highlights', case when jsonb_typeof(p.product_details -> 'highlights') = 'array' then jsonb_array_length(p.product_details -> 'highlights') else 0 end,
      'specs', case when jsonb_typeof(p.product_details -> 'specifications') = 'array' then jsonb_array_length(p.product_details -> 'specifications') else 0 end,
      'stock', st.qty, 'stock_points', coalesce(st.points, 0),
      'last_sale_at', sa.last_sale_at, 'sold_30', coalesce(sa.sold_30, 0), 'sold_90', coalesce(sa.sold_90, 0),
      'by_point', coalesce(bp.j, '[]'::jsonb),
      'pub', jsonb_build_object('every_days', pp.every_days, 'every', public.pub__every(pp.every_days),
               'last', pp.last_published_at, 'by', pp.last_published_by_name, 'times', coalesce(pp.times, 0),
               'next_due', public.pub__next_due(pp.every_days, pp.last_published_at))
    ) order by p.name), '[]'::jsonb)
  into v_out
  from public.products p
  left join sales sa on sa.product_id = p.id
  left join stock st on st.product_id = p.id
  left join by_point bp on bp.product_id = p.id
  left join cats c on c.product_id = p.id
  left join public.erp_product_publish pp on pp.product_id = p.id
  where p.store_id = p_store;

  return jsonb_build_object('ok', true, 'now', now(), 'today', public.pub__today(), 'can_costs', v_costs, 'products', v_out,
    'point', p_point,
    'points', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name), '[]'::jsonb)
               from public.erp_warehouses w where w.store_id = p_store and coalesce((to_jsonb(w) ->> 'active')::boolean, true)
                 and (v_mine is null or w.id = any (v_mine))),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.name), '[]'::jsonb)
                   from public.product_categories k where k.store_id = p_store and coalesce((to_jsonb(k) ->> 'active')::boolean, true)));
end;
$$;

-- ===== Historial con efecto de cada publicación =====
create or replace function public.product_publish_info(p_store uuid, p_product uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if not exists (select 1 from public.products p where p.id = p_product and p.store_id = p_store) then
    return jsonb_build_object('ok', false, 'message', 'Ese producto no es de tu tienda.');
  end if;
  return jsonb_build_object('ok', true, 'today', public.pub__today(), 'state', public.pub__state(p_product),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'at', l.published_at, 'by', l.user_name, 'channels', l.channels, 'note', l.note,
                                                          'mine', l.user_id = auth.uid(),
                                                          'before_7', l.before_7, 'after_7', l.after_7,
                                                          'after_complete', l.published_at <= now() - interval '7 days') order by l.published_at desc), '[]'::jsonb)
            from (
              select l.*,
                (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                  where oi.product_id = p_product and o.store_id = p_store and o.status in ('confirmed', 'completed')
                    and o.created_at >= l.published_at - interval '7 days' and o.created_at < l.published_at) as before_7,
                (select coalesce(sum(oi.quantity), 0) from public.order_items oi join public.orders o on o.id = oi.order_id
                  where oi.product_id = p_product and o.store_id = p_store and o.status in ('confirmed', 'completed')
                    and o.created_at >= l.published_at and o.created_at < l.published_at + interval '7 days') as after_7
              from public.erp_product_publish_log l where l.product_id = p_product order by l.published_at desc limit 12) l));
end;
$$;

-- ===== Salud por día =====
create table if not exists public.erp_radar_snapshots (
  store_id uuid not null references public.stores(id) on delete cascade,
  day date not null,
  avg_health integer not null check (avg_health between 0 and 100),
  products integer not null default 0,
  counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);
alter table public.erp_radar_snapshots enable row level security;
revoke all on public.erp_radar_snapshots from anon, authenticated;

create or replace function public.product_radar_snapshot_save(p_store uuid, p_avg integer, p_products integer, p_counts jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false);
  end if;
  if p_avg is null or p_avg not between 0 and 100 or coalesce(p_products, -1) < 0 then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.erp_radar_snapshots (store_id, day, avg_health, products, counts, updated_at)
  values (p_store, public.pub__today(), p_avg, p_products, coalesce(p_counts, '{}'::jsonb), now())
  on conflict (store_id, day) do update set avg_health = excluded.avg_health, products = excluded.products,
    counts = excluded.counts, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.product_radar_history(p_store uuid, p_days integer default 120)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'days', (
    select coalesce(jsonb_agg(jsonb_build_object('day', s.day, 'avg', s.avg_health, 'products', s.products, 'counts', s.counts) order by s.day), '[]'::jsonb)
    from public.erp_radar_snapshots s
    where s.store_id = p_store and s.day >= public.pub__today() - greatest(7, least(coalesce(p_days, 120), 730))));
end;
$$;

-- ===== Tareas de productos =====
create table if not exists public.erp_product_tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  title text not null,
  note text,
  issue text,
  product_ids uuid[] not null default '{}',
  assignee uuid not null,
  assignee_name text,
  created_by uuid,
  created_by_name text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists erp_product_tasks_store on public.erp_product_tasks (store_id, status, created_at desc);
create index if not exists erp_product_tasks_assignee on public.erp_product_tasks (assignee, status);
alter table public.erp_product_tasks enable row level security;
revoke all on public.erp_product_tasks from anon, authenticated;

-- Personas del equipo que pueden trabajar productos (dueño, administradores y quien tiene «products»).
create or replace function public.pub__team(p_store uuid)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select s.owner_id, 'Dueño'::text from public.stores s where s.id = p_store and s.owner_id is not null
  union
  select su.user_id, coalesce(nullif(btrim(su.display_name), ''), nullif(btrim(su.username), ''), 'Usuario')
  from public.store_users su
  where su.store_id = p_store and coalesce(su.active, true)
    and (su.role = 'store_admin' or 'products' = any (su.permissions))
    and su.user_id <> coalesce((select s.owner_id from public.stores s where s.id = p_store), '00000000-0000-0000-0000-000000000000'::uuid)
$$;
revoke all on function public.pub__team(uuid) from public, anon, authenticated;

create or replace function public.product_team(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.user_id, 'name', t.name, 'me', t.user_id = auth.uid()) order by t.name), '[]'::jsonb)
          from public.pub__team(p_store) t);
end;
$$;

create or replace function public.product_task_create(p_store uuid, p_assignee uuid, p_title text, p_note text, p_products uuid[], p_issue text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text; v_ids uuid[]; v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  select t.name into v_name from public.pub__team(p_store) t where t.user_id = p_assignee;
  if v_name is null then
    return jsonb_build_object('ok', false, 'message', 'Esa persona no está en el equipo o no tiene permiso de Productos.');
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return jsonb_build_object('ok', false, 'message', 'Escribe qué hay que hacer.');
  end if;
  if coalesce(cardinality(p_products), 0) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Máximo 2.000 productos por tarea.');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.products p where p.store_id = p_store and p.id = any (coalesce(p_products, '{}'));
  insert into public.erp_product_tasks (store_id, title, note, issue, product_ids, assignee, assignee_name, created_by, created_by_name)
  values (p_store, left(btrim(p_title), 140), nullif(left(btrim(coalesce(p_note, '')), 600), ''), nullif(left(coalesce(p_issue, ''), 40), ''),
          v_ids, p_assignee, v_name, auth.uid(), public.pub__user_name(p_store))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'count', cardinality(v_ids));
end;
$$;

create or replace function public.product_task_list(p_store uuid, p_all boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'tasks', (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'note', t.note, 'issue', t.issue, 'product_ids', t.product_ids,
             'count', cardinality(t.product_ids), 'assignee', t.assignee, 'assignee_name', t.assignee_name, 'mine', t.assignee = auth.uid(),
             'created_by_name', t.created_by_name, 'status', t.status, 'created_at', t.created_at, 'done_at', t.done_at)
             order by (t.status = 'open') desc, t.created_at desc), '[]'::jsonb)
    from (select * from public.erp_product_tasks t
          where t.store_id = p_store and (p_all or t.assignee = auth.uid())
            and (t.status = 'open' or t.created_at >= now() - interval '30 days')
          order by t.created_at desc limit 200) t));
end;
$$;

create or replace function public.product_task_set_status(p_store uuid, p_task uuid, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.erp_product_tasks%rowtype;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if p_status not in ('open', 'done', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'Estado no válido.');
  end if;
  select * into v from public.erp_product_tasks t where t.id = p_task and t.store_id = p_store;
  if v.id is null then return jsonb_build_object('ok', false, 'message', 'No existe esa tarea.'); end if;
  -- Terminarla: quien la tiene o quien la creó. Anularla o reabrirla: quien la creó o un administrador.
  if p_status = 'done' and auth.uid() not in (v.assignee, coalesce(v.created_by, v.assignee)) and not public.erp_can(p_store, 'users') then
    return jsonb_build_object('ok', false, 'message', 'Solo quien la tiene o quien la creó la puede terminar.');
  end if;
  if p_status <> 'done' and auth.uid() <> coalesce(v.created_by, v.assignee) and not public.erp_can(p_store, 'users') then
    return jsonb_build_object('ok', false, 'message', 'Solo quien la creó la puede anular o reabrir.');
  end if;
  update public.erp_product_tasks set status = p_status, done_at = case when p_status = 'done' then now() end where id = p_task;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.erp_product_task_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c integer; titles text[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then return '[]'::jsonb; end if;
  select count(*), (array_agg(t.title order by t.created_at))[1:2] into c, titles
  from public.erp_product_tasks t where t.store_id = p_store and t.assignee = auth.uid() and t.status = 'open';
  if coalesce(c, 0) = 0 then return '[]'::jsonb; end if;
  return jsonb_build_array(jsonb_build_object(
    'key', 'product-tasks-' || c, 'severity', 'info', 'icon', 'box', 'count', c,
    'title', 'Tienes ' || c || ' tarea' || case when c = 1 then '' else 's' end || ' de productos',
    'body', array_to_string(titles, ' · ') || case when c > 2 then ' y ' || (c - 2) || ' más' else '' end || '.',
    'href', '/dashboard/products/radar?ver=tareas'));
end;
$$;

-- ===== Calendario de publicaciones =====
create or replace function public.product_publish_calendar(p_store uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := date_trunc('month', coalesce(p_month, public.pub__today()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, public.pub__today())) + interval '1 month')::date;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  return jsonb_build_object('ok', true, 'month', v_from, 'today', public.pub__today(),
    'published', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'n', d.n, 'items', d.items) order by d.day), '[]'::jsonb) from (
        select (l.published_at at time zone 'America/Bogota')::date as day, count(*) as n,
               (jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'image', p.image_url, 'by', l.user_name) order by l.published_at))
                 as items
        from public.erp_product_publish_log l join public.products p on p.id = l.product_id
        where l.store_id = p_store and (l.published_at at time zone 'America/Bogota')::date >= v_from
          and (l.published_at at time zone 'America/Bogota')::date < v_to
        group by 1) d),
    'due', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'n', d.n, 'items', d.items) order by d.day), '[]'::jsonb) from (
        select greatest(public.pub__next_due(pp.every_days, pp.last_published_at), public.pub__today()) as day, count(*) as n,
               jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'image', p.image_url) order by p.name) as items
        from public.erp_product_publish pp join public.products p on p.id = pp.product_id
        where pp.store_id = p_store and coalesce(p.active, true)
          and public.pub__next_due(pp.every_days, pp.last_published_at) is not null
          and greatest(public.pub__next_due(pp.every_days, pp.last_published_at), public.pub__today()) >= v_from
          and greatest(public.pub__next_due(pp.every_days, pp.last_published_at), public.pub__today()) < v_to
        group by 1) d),
    'by_user', (
      select coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'n', u.n) order by u.n desc), '[]'::jsonb) from (
        select coalesce(l.user_name, 'Usuario') as name, count(*) as n
        from public.erp_product_publish_log l
        where l.store_id = p_store and (l.published_at at time zone 'America/Bogota')::date >= v_from
          and (l.published_at at time zone 'America/Bogota')::date < v_to
        group by 1) u));
end;
$$;

-- ===== Aviso diario al celular (lo llama el cron cada hora con la hora de Colombia) =====
create or replace function public.erp_publish_push_digest(p_hour integer)
returns table (store_id uuid, user_id uuid, due integer, names text[], tasks integer, target integer)
language sql stable security definer set search_path = public as $$
  with st as (
    select s.id as store_id, coalesce(cfg.daily_target, 5) as target
    from public.stores s left join public.erp_publish_settings cfg on cfg.store_id = s.id
    where coalesce(s.active, true) and (case when cfg.store_id is null then 9 else cfg.push_hour end) = p_hour
  ), dues as (
    select pp.store_id, count(*)::int as due,
           (array_agg(p.name order by public.pub__next_due(pp.every_days, pp.last_published_at), p.name))[1:3] as names
    from public.erp_product_publish pp join public.products p on p.id = pp.product_id
    where coalesce(p.active, true) and public.pub__next_due(pp.every_days, pp.last_published_at) <= public.pub__today()
    group by pp.store_id
  ), tk as (
    select t.store_id, t.assignee, count(*)::int as n from public.erp_product_tasks t where t.status = 'open' group by 1, 2
  )
  select st.store_id, tm.user_id, coalesce(d.due, 0), d.names, coalesce(tk.n, 0), st.target
  from st
  cross join lateral public.pub__team(st.store_id) tm
  left join dues d on d.store_id = st.store_id
  left join tk on tk.store_id = st.store_id and tk.assignee = tm.user_id
  where coalesce(d.due, 0) > 0 or coalesce(tk.n, 0) > 0
$$;

revoke all on function public.product_radar(uuid, uuid) from public, anon;
revoke all on function public.product_radar_settings_get(uuid) from public, anon;
revoke all on function public.product_radar_settings_save(uuid, integer, integer, integer) from public, anon;
revoke all on function public.product_radar_snapshot_save(uuid, integer, integer, jsonb) from public, anon;
revoke all on function public.product_radar_history(uuid, integer) from public, anon;
revoke all on function public.product_team(uuid) from public, anon;
revoke all on function public.product_task_create(uuid, uuid, text, text, uuid[], text) from public, anon;
revoke all on function public.product_task_list(uuid, boolean) from public, anon;
revoke all on function public.product_task_set_status(uuid, uuid, text) from public, anon;
revoke all on function public.erp_product_task_alerts(uuid) from public, anon;
revoke all on function public.product_publish_calendar(uuid, date) from public, anon;
revoke all on function public.erp_publish_push_digest(integer) from public, anon, authenticated;
grant execute on function public.product_radar(uuid, uuid) to authenticated;
grant execute on function public.product_radar_settings_get(uuid) to authenticated;
grant execute on function public.product_radar_settings_save(uuid, integer, integer, integer) to authenticated;
grant execute on function public.product_radar_snapshot_save(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.product_radar_history(uuid, integer) to authenticated;
grant execute on function public.product_team(uuid) to authenticated;
grant execute on function public.product_task_create(uuid, uuid, text, text, uuid[], text) to authenticated;
grant execute on function public.product_task_list(uuid, boolean) to authenticated;
grant execute on function public.product_task_set_status(uuid, uuid, text) to authenticated;
grant execute on function public.erp_product_task_alerts(uuid) to authenticated;
grant execute on function public.product_publish_calendar(uuid, date) to authenticated;
grant execute on function public.erp_publish_push_digest(integer) to service_role;
