-- 20261305 · Radar de productos y «¡Publícame!»
--
-- 1) Publicaciones por producto:
--    · erp_product_publish: cuándo se publicó por última vez, cada cuánto recordarlo y quién lo marcó.
--      every_days: null = el de siempre (30 días) · 0 = no recordar · 1 = diario · N = cada N días.
--    · erp_product_publish_log: cada vez que alguien tocó «Lo acabo de publicar» (con redes opcionales).
--    · product_publish_mark(p_store, p_products[], p_channels[], p_note): marca uno o varios como publicados hoy.
--    · product_publish_set_every(p_store, p_products[], p_every): cambia cada cuánto recordar.
--    · product_publish_info(p_store, p_product): estado e historial de un producto.
--    · product_publish_undo(p_store, p_product): deshace la última marca (solo de las últimas 24 h).
--    · erp_publish_alerts(p_store): aviso en la campana con los productos a los que ya les toca.
--      «Toca» = la fecha (hora Colombia) de la última publicación + cada cuánto ya llegó. Si tiene recordatorio
--      propio y nunca se ha publicado, también toca. Solo productos activos.
-- 2) product_radar(p_store): todo lo que necesita el Radar de productos en una sola llamada (sin el límite de
--    1.000 filas): datos de la ficha resumidos, existencias totales, ventas de 30/90 días y la última venta,
--    publicación y, solo para quien tiene «Ver costos y márgenes», el costo.
-- Permiso: «products» (Productos). Las tablas tienen RLS sin políticas: solo se usan desde estas funciones.
-- No cambia productos, precios, existencias ni permisos. Se puede correr varias veces.

create table if not exists public.erp_product_publish (
  product_id uuid primary key references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  every_days integer check (every_days is null or every_days between 0 and 365),
  last_published_at timestamptz,
  last_published_by uuid,
  last_published_by_name text,
  times integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists erp_product_publish_store on public.erp_product_publish (store_id);

create table if not exists public.erp_product_publish_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  published_at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  channels text[] not null default '{}',
  note text
);
create index if not exists erp_product_publish_log_product on public.erp_product_publish_log (product_id, published_at desc);
create index if not exists erp_product_publish_log_store on public.erp_product_publish_log (store_id, published_at desc);

alter table public.erp_product_publish enable row level security;
alter table public.erp_product_publish_log enable row level security;
revoke all on public.erp_product_publish from anon, authenticated;
revoke all on public.erp_product_publish_log from anon, authenticated;

-- Día de hoy en Colombia.
create or replace function public.pub__today()
returns date language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

-- Cada cuánto (en días) se recuerda: null → 30 (el de siempre).
create or replace function public.pub__every(p_every integer)
returns integer language sql immutable as $$ select coalesce(p_every, 30) $$;

-- Fecha en que vuelve a tocar (null = no se recuerda).
create or replace function public.pub__next_due(p_every integer, p_last timestamptz)
returns date language sql stable as $$
  select case
    when public.pub__every(p_every) <= 0 then null
    when p_last is null then case when p_every is not null then public.pub__today() else null end
    else (p_last at time zone 'America/Bogota')::date + public.pub__every(p_every)
  end
$$;

create or replace function public.pub__user_name(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(btrim(su.display_name), ''), nullif(btrim(su.username), ''))
       from public.store_users su where su.store_id = p_store and su.user_id = auth.uid() limit 1),
    case when exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) then 'Dueño' end,
    'Usuario')
$$;

create or replace function public.pub__state(p_product uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'every_days', x.every_days,
    'every', public.pub__every(x.every_days),
    'last_published_at', x.last_published_at,
    'last_by', x.last_published_by_name,
    'times', coalesce(x.times, 0),
    'next_due', public.pub__next_due(x.every_days, x.last_published_at),
    'due', coalesce(public.pub__next_due(x.every_days, x.last_published_at) <= public.pub__today(), false),
    'days_since', case when x.last_published_at is null then null
                       else public.pub__today() - (x.last_published_at at time zone 'America/Bogota')::date end)
  from (select p.id, pp.every_days, pp.last_published_at, pp.last_published_by_name, pp.times
        from public.products p left join public.erp_product_publish pp on pp.product_id = p.id
        where p.id = p_product) x
$$;

-- ===== Marcar publicado (uno o varios) =====
create or replace function public.product_publish_mark(p_store uuid, p_products uuid[], p_channels text[] default '{}', p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text;
  v_ids uuid[];
  v_now timestamptz := now();
  v_channels text[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if coalesce(cardinality(p_products), 0) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Escoge al menos un producto.');
  end if;
  if cardinality(p_products) > 500 then
    return jsonb_build_object('ok', false, 'message', 'Máximo 500 productos a la vez.');
  end if;
  select array_agg(p.id) into v_ids from public.products p where p.store_id = p_store and p.id = any (p_products);
  if v_ids is null then
    return jsonb_build_object('ok', false, 'message', 'Esos productos no son de tu tienda.');
  end if;
  v_name := public.pub__user_name(p_store);
  select coalesce(array_agg(distinct left(btrim(c), 30)) filter (where btrim(c) <> ''), '{}') into v_channels
  from unnest(coalesce(p_channels, '{}')) c;

  insert into public.erp_product_publish_log (store_id, product_id, published_at, user_id, user_name, channels, note)
  select p_store, id, v_now, auth.uid(), v_name, v_channels, nullif(left(btrim(coalesce(p_note, '')), 300), '')
  from unnest(v_ids) id;

  insert into public.erp_product_publish (product_id, store_id, last_published_at, last_published_by, last_published_by_name, times, updated_at)
  select id, p_store, v_now, auth.uid(), v_name, 1, v_now from unnest(v_ids) id
  on conflict (product_id) do update set
    last_published_at = excluded.last_published_at,
    last_published_by = excluded.last_published_by,
    last_published_by_name = excluded.last_published_by_name,
    times = public.erp_product_publish.times + 1,
    updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'count', cardinality(v_ids),
    'state', case when cardinality(v_ids) = 1 then public.pub__state(v_ids[1]) end);
end;
$$;

-- ===== Cada cuánto recordar =====
create or replace function public.product_publish_set_every(p_store uuid, p_products uuid[], p_every integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  if p_every is not null and (p_every < 0 or p_every > 365) then
    return jsonb_build_object('ok', false, 'message', 'Escribe entre 1 y 365 días (0 = no recordar).');
  end if;
  if coalesce(cardinality(p_products), 0) = 0 or cardinality(p_products) > 5000 then
    return jsonb_build_object('ok', false, 'message', 'Escoge entre 1 y 5.000 productos.');
  end if;
  select array_agg(p.id) into v_ids from public.products p where p.store_id = p_store and p.id = any (p_products);
  if v_ids is null then
    return jsonb_build_object('ok', false, 'message', 'Esos productos no son de tu tienda.');
  end if;

  insert into public.erp_product_publish (product_id, store_id, every_days, updated_at)
  select id, p_store, p_every, now() from unnest(v_ids) id
  on conflict (product_id) do update set every_days = excluded.every_days, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'count', cardinality(v_ids),
    'state', case when cardinality(v_ids) = 1 then public.pub__state(v_ids[1]) end);
end;
$$;

-- ===== Estado e historial de un producto =====
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
                                                          'mine', l.user_id = auth.uid()) order by l.published_at desc), '[]'::jsonb)
            from (select * from public.erp_product_publish_log l where l.product_id = p_product order by l.published_at desc limit 12) l));
end;
$$;

-- ===== Deshacer la última marca (últimas 24 h) =====
create or replace function public.product_publish_undo(p_store uuid, p_product uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_last public.erp_product_publish_log%rowtype;
  v_prev public.erp_product_publish_log%rowtype;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  select * into v_last from public.erp_product_publish_log l
  where l.product_id = p_product and l.store_id = p_store order by l.published_at desc limit 1;
  if v_last.id is null then
    return jsonb_build_object('ok', false, 'message', 'No hay nada que deshacer.');
  end if;
  if v_last.published_at < now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'message', 'Solo se puede deshacer una marca de las últimas 24 horas.');
  end if;
  delete from public.erp_product_publish_log where id = v_last.id;
  select * into v_prev from public.erp_product_publish_log l
  where l.product_id = p_product and l.store_id = p_store order by l.published_at desc limit 1;
  update public.erp_product_publish set
    last_published_at = v_prev.published_at,
    last_published_by = v_prev.user_id,
    last_published_by_name = v_prev.user_name,
    times = greatest(0, times - 1),
    updated_at = now()
  where product_id = p_product;
  return jsonb_build_object('ok', true, 'state', public.pub__state(p_product));
end;
$$;

-- ===== Aviso en la campana =====
create or replace function public.erp_publish_alerts(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c integer; c_late integer; names text[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return '[]'::jsonb;
  end if;
  select count(*),
         count(*) filter (where public.pub__next_due(pp.every_days, pp.last_published_at) < public.pub__today() - greatest(1, public.pub__every(pp.every_days))),
         (array_agg(p.name order by public.pub__next_due(pp.every_days, pp.last_published_at), p.name))[1:3]
    into c, c_late, names
  from public.erp_product_publish pp join public.products p on p.id = pp.product_id
  where pp.store_id = p_store and coalesce(p.active, true)
    and public.pub__next_due(pp.every_days, pp.last_published_at) <= public.pub__today();
  if coalesce(c, 0) = 0 then return '[]'::jsonb; end if;
  return jsonb_build_array(jsonb_build_object(
    'key', 'publish-due-' || c || '-' || public.pub__today(),
    'severity', case when c_late > 0 then 'warning' else 'info' end,
    'icon', 'megaphone',
    'count', c,
    'title', '¡Hey! ' || c || ' producto' || case when c = 1 then '' else 's' end || ' por publicar',
    'body', array_to_string(names, ', ') || case when c > 3 then ' y ' || (c - 3) || ' más' else '' end
            || '. Ya les toca según el recordatorio de cada uno.',
    'href', '/dashboard/products/radar?ver=publicar'));
end;
$$;

-- ===== Datos del Radar =====
create or replace function public.product_radar(p_store uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costs boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'products') then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso de Productos.');
  end if;
  v_costs := public.erp_can(p_store, 'costs_view');

  with sales as (
    select oi.product_id,
           max(o.created_at) as last_sale_at,
           coalesce(sum(oi.quantity) filter (where o.created_at >= now() - interval '30 days'), 0) as sold_30,
           coalesce(sum(oi.quantity) filter (where o.created_at >= now() - interval '90 days'), 0) as sold_90
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed') and o.created_at >= now() - interval '365 days'
    group by oi.product_id
  ), stock as (
    select s.product_id, sum(s.qty) as qty, count(*) filter (where s.qty > 0) as points
    from public.erp_stock_levels s where s.store_id = p_store group by s.product_id
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
      'video', coalesce(nullif(btrim(p.product_details ->> 'video_url'), ''), null) is not null,
      'highlights', case when jsonb_typeof(p.product_details -> 'highlights') = 'array' then jsonb_array_length(p.product_details -> 'highlights') else 0 end,
      'specs', case when jsonb_typeof(p.product_details -> 'specifications') = 'array' then jsonb_array_length(p.product_details -> 'specifications') else 0 end,
      'stock', st.qty, 'stock_points', coalesce(st.points, 0),
      'last_sale_at', sa.last_sale_at, 'sold_30', coalesce(sa.sold_30, 0), 'sold_90', coalesce(sa.sold_90, 0),
      'pub', jsonb_build_object('every_days', pp.every_days, 'every', public.pub__every(pp.every_days),
               'last', pp.last_published_at, 'by', pp.last_published_by_name, 'times', coalesce(pp.times, 0),
               'next_due', public.pub__next_due(pp.every_days, pp.last_published_at))
    ) order by p.name), '[]'::jsonb)
  into v_out
  from public.products p
  left join sales sa on sa.product_id = p.id
  left join stock st on st.product_id = p.id
  left join cats c on c.product_id = p.id
  left join public.erp_product_publish pp on pp.product_id = p.id
  where p.store_id = p_store;

  return jsonb_build_object('ok', true, 'now', now(), 'today', public.pub__today(), 'can_costs', v_costs, 'products', v_out,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.name), '[]'::jsonb)
                   from public.product_categories k where k.store_id = p_store and coalesce((to_jsonb(k) ->> 'active')::boolean, true)));
end;
$$;

revoke all on function public.pub__user_name(uuid) from public, anon;
revoke all on function public.pub__state(uuid) from public, anon, authenticated;
revoke all on function public.product_publish_mark(uuid, uuid[], text[], text) from public, anon;
revoke all on function public.product_publish_set_every(uuid, uuid[], integer) from public, anon;
revoke all on function public.product_publish_info(uuid, uuid) from public, anon;
revoke all on function public.product_publish_undo(uuid, uuid) from public, anon;
revoke all on function public.erp_publish_alerts(uuid) from public, anon;
revoke all on function public.product_radar(uuid) from public, anon;
grant execute on function public.product_publish_mark(uuid, uuid[], text[], text) to authenticated;
grant execute on function public.product_publish_set_every(uuid, uuid[], integer) to authenticated;
grant execute on function public.product_publish_info(uuid, uuid) to authenticated;
grant execute on function public.product_publish_undo(uuid, uuid) to authenticated;
grant execute on function public.erp_publish_alerts(uuid) to authenticated;
grant execute on function public.product_radar(uuid) to authenticated;
