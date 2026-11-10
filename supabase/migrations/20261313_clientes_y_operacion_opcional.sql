-- 20261313 · Clientes y operación (opcional, se enciende en «Funciones opcionales»)
-- (Necesita 20261312: erp_store_features. Usa erp_customer_insights de 20261223 y erp_post_adjustment.)
--
--   · Recompra y cumpleaños de clientes: erp_customer_history (historial de un cliente), erp_repurchase (a quién
--     escribirle porque ya debería volver y quién cumple años esta semana) y erp_repurchase_mark (le escribí).
--   · Traslados sugeridos entre puntos: erp_rebalance_suggestions — dónde sobra (no se vende o hay de más) y dónde
--     falta (se vende y se está acabando). Solo SUGIERE: el traslado lo arma y lo envía la persona.
--   · Conteo por zonas con aprobación (erp_stock_counts, erp_stock_count_lines): se cuenta por zonas sin cerrar la
--     tienda; cada línea guarda lo que decía el sistema al contarla. Al aprobar, se ajusta solo la diferencia
--     (si después se vendió, no se pierde) con erp_post_adjustment (motivo «conteo»), que queda en el kardex y en la
--     auditoría. Contar pide «Inventario»; aprobar pide «Ajustar inventario».
-- No cambia precios ni permisos. Se puede correr varias veces.

-- ------------------------------------------------------------------ recompra y cumpleaños
alter table public.billing_customers add column if not exists birthday date;
-- Ya existe desde antes (clientes por punto); se repite por si acaso, no cambia nada.
alter table public.billing_customers add column if not exists point_id uuid references public.erp_warehouses(id) on delete set null;

create table if not exists public.erp_repurchase_contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  who text not null,
  kind text not null check (kind in ('recompra', 'cumple')),
  contacted_at timestamptz not null default now(),
  contacted_by uuid,
  contacted_by_name text
);
create index if not exists erp_repurchase_contacts_idx on public.erp_repurchase_contacts (store_id, who, kind, contacted_at desc);
alter table public.erp_repurchase_contacts enable row level security;
revoke all on public.erp_repurchase_contacts from anon, authenticated;

create or replace function public.vm__who(p text)
returns text language sql immutable as $$ select upper(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))) $$;

create or replace function public.erp_customer_history(p_store uuid, p_name text, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v uuid[];
  v_who text := public.vm__who(p_name);
begin
  if auth.uid() is null or not (public.erp_can(p_store, 'clients') or public.erp_can(p_store, 'receivables') or public.erp_can(p_store, 'reports')) then
    return jsonb_build_object('ok', false, 'message', 'No tienes permiso para ver clientes.');
  end if;
  if v_who = '' then return jsonb_build_object('ok', false, 'message', 'Falta el cliente.'); end if;
  v := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true, 'name', v_who, 'orders', coalesce((
    select jsonb_agg(x.j order by x.at desc) from (
      select coalesce(o.confirmed_at, o.created_at) at,
             jsonb_build_object('id', o.id, 'receipt_no', o.receipt_no, 'at', coalesce(o.confirmed_at, o.created_at), 'total', o.total,
               'status', o.status, 'point', w.name,
               'items', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', oi.quantity, 'price', oi.price, 'image_url', p.image_url) order by p.name)
                                  from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = o.id), '[]'::jsonb)) j
      from public.orders o
      left join public.erp_order_meta m on m.order_id = o.id
      left join public.erp_warehouses w on w.id = m.point_id
      where o.store_id = p_store and o.status in ('confirmed', 'completed') and public.vm__who(o.customer_name) = v_who
        and (v is null or m.point_id = any (v))
      order by coalesce(o.confirmed_at, o.created_at) desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)) x), '[]'::jsonb));
end;
$$;

create or replace function public.erp_repurchase(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb := public.vm__settings(p_store, 'recompra');
  v_days integer := case when jsonb_typeof(s -> 'days') = 'number' then (s ->> 'days')::integer else 0 end;
  ins jsonb;
  v uuid[];
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'clients') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Clientes».');
  end if;
  ins := public.erp_customer_insights(p_store, 730);
  if not coalesce((ins ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'message', coalesce(ins ->> 'error', 'No se pudo leer.')); end if;
  v := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'recompra'), 'settings', s, 'days', v_days,
    'due', coalesce((
      select jsonb_agg(c || jsonb_build_object('reason',
               case when v_days > 0 then 'Hace ' || (c ->> 'days_since') || ' días que no compra'
                    else 'Compra cada ~' || (c ->> 'every_days') || ' días y lleva ' || (c ->> 'days_since') end,
               'contacted_at', (select max(rc.contacted_at) from public.erp_repurchase_contacts rc
                                where rc.store_id = p_store and rc.who = c ->> 'name' and rc.kind = 'recompra'))
             order by (c ->> 'total')::numeric desc)
      from jsonb_array_elements(ins -> 'customers') c
      where (c ->> 'phone') is not null
        and case when v_days > 0
              then (c ->> 'days_since')::integer >= v_days and (c ->> 'days_since')::integer <= v_days * 4
              else (c ->> 'orders')::integer >= 2 and (c ->> 'every_days') is not null
                   and (c ->> 'days_since')::numeric >= greatest((c ->> 'every_days')::numeric * 1.2, 15)
                   and (c ->> 'days_since')::numeric <= greatest((c ->> 'every_days')::numeric * 4, 120) end
        and not exists (select 1 from public.erp_repurchase_contacts rc where rc.store_id = p_store and rc.who = c ->> 'name'
                          and rc.kind = 'recompra' and rc.contacted_at > now() - interval '14 days')), '[]'::jsonb),
    'birthdays', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone, 'birthday', b.birthday, 'days_until', b.d,
               'contacted', exists (select 1 from public.erp_repurchase_contacts rc where rc.store_id = p_store and rc.who = public.vm__who(b.name)
                                      and rc.kind = 'cumple' and rc.contacted_at > now() - interval '300 days'))
             order by b.d, b.name)
      from (
        select c.id, c.name, nullif(regexp_replace(coalesce(c.mobile, c.phone, ''), '\D', '', 'g'), '') phone, c.birthday,
               (case when make_date(extract(year from v_today)::int, extract(month from c.birthday)::int,
                                    least(extract(day from c.birthday)::int, case when extract(month from c.birthday) = 2 then 28 else 31 end)) >= v_today
                     then make_date(extract(year from v_today)::int, extract(month from c.birthday)::int,
                                    least(extract(day from c.birthday)::int, case when extract(month from c.birthday) = 2 then 28 else 31 end))
                     else make_date(extract(year from v_today)::int + 1, extract(month from c.birthday)::int,
                                    least(extract(day from c.birthday)::int, case when extract(month from c.birthday) = 2 then 28 else 31 end)) end - v_today) d
        from public.billing_customers c
        where c.store_id = p_store and c.birthday is not null and coalesce(c.active, true)
          and (v is null or c.point_id is null or c.point_id = any (v))
          and extract(day from c.birthday) <= case when extract(month from c.birthday) in (4, 6, 9, 11) then 30 else 31 end
      ) b where b.d between 0 and 7), '[]'::jsonb));
end;
$$;

create or replace function public.erp_repurchase_mark(p_store uuid, p_who text, p_kind text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.erp_can(p_store, 'clients') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Clientes».');
  end if;
  if p_kind not in ('recompra', 'cumple') or public.vm__who(p_who) = '' then return jsonb_build_object('ok', false); end if;
  insert into public.erp_repurchase_contacts (store_id, who, kind, contacted_by, contacted_by_name)
  values (p_store, public.vm__who(p_who), p_kind, auth.uid(),
    coalesce((select coalesce(nullif(su.display_name, ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()), 'Dueño'));
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------ traslados sugeridos
create or replace function public.erp_rebalance_suggestions(p_store uuid, p_days integer default 30, p_cover integer default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v uuid[];
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 120);
  v_cover integer := least(greatest(coalesce(p_cover, 30), 7), 90);
  v_out jsonb := '[]'::jsonb;
  pr record;
  d record;
  src record;
  v_need integer;
  v_take integer;
  v_left jsonb;
  n integer := 0;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'transfers') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Traslados».');
  end if;
  v := public.erp_my_points(p_store);

  create temp table if not exists vm_rb (product_id uuid, wid uuid, kind text, qty integer, sold integer, per_day numeric) on commit drop;
  truncate vm_rb;
  insert into vm_rb
  select sl.product_id, w.id, coalesce(w.kind, 'warehouse'), greatest(sl.qty, 0), coalesce(s.sold, 0)::integer, coalesce(s.sold, 0)::numeric / v_days
  from public.erp_stock_levels sl
  join public.erp_warehouses w on w.id = sl.warehouse_id and w.active
  join public.products p on p.id = sl.product_id and coalesce(p.active, true)
  left join (
    select m.point_id, oi.product_id, sum(oi.quantity) sold
    from public.orders o join public.order_items oi on oi.order_id = o.id
    join public.erp_order_meta m on m.order_id = o.id
    where o.store_id = p_store and o.status in ('confirmed', 'completed')
      and coalesce(o.confirmed_at, o.created_at) >= now() - make_interval(days => v_days)
    group by 1, 2
  ) s on s.point_id = w.id and s.product_id = sl.product_id
  where sl.store_id = p_store;
  -- Puntos que venden un producto pero no tienen fila de existencias (nunca les llegó).
  insert into vm_rb
  select s.product_id, s.point_id, 'point', 0, s.sold::integer, s.sold::numeric / v_days
  from (select m.point_id, oi.product_id, sum(oi.quantity) sold
        from public.orders o join public.order_items oi on oi.order_id = o.id
        join public.erp_order_meta m on m.order_id = o.id
        join public.erp_warehouses w on w.id = m.point_id and w.active
        where o.store_id = p_store and o.status in ('confirmed', 'completed')
          and coalesce(o.confirmed_at, o.created_at) >= now() - make_interval(days => v_days)
        group by 1, 2) s
  where not exists (select 1 from vm_rb r where r.product_id = s.product_id and r.wid = s.point_id);

  for pr in
    select r.product_id from vm_rb r
    where r.kind = 'point' and r.per_day > 0 and r.qty < ceil(r.per_day * v_cover / 2.0)
    group by r.product_id
  loop
    -- Lo que sobra en cada lugar de ese producto (en una bodega sin ventas, todo; en un punto, lo que pasa de 1,5 veces la cobertura).
    select coalesce(jsonb_object_agg(r.wid::text, greatest(0, r.qty - ceil(r.per_day * v_cover * 1.5))::integer), '{}'::jsonb) into v_left
    from vm_rb r where r.product_id = pr.product_id and r.qty > 0 and (v is null or r.wid = any (v));
    for d in
      select r.* from vm_rb r where r.product_id = pr.product_id and r.kind = 'point' and r.per_day > 0
        and r.qty < ceil(r.per_day * v_cover / 2.0)
      order by r.per_day desc
    loop
      v_need := ceil(d.per_day * v_cover)::integer - d.qty;
      for src in
        select r.*, (v_left ->> r.wid::text)::integer as spare from vm_rb r
        where r.product_id = pr.product_id and r.wid <> d.wid and coalesce((v_left ->> r.wid::text)::integer, 0) > 0
        order by r.per_day asc, (v_left ->> r.wid::text)::integer desc
      loop
        exit when v_need <= 0;
        v_take := least(v_need, (v_left ->> src.wid::text)::integer);
        continue when v_take <= 0;
        v_need := v_need - v_take;
        v_left := jsonb_set(v_left, array[src.wid::text], to_jsonb((v_left ->> src.wid::text)::integer - v_take));
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'product_id', pr.product_id, 'from_id', src.wid, 'to_id', d.wid, 'qty', v_take,
          'from_qty', src.qty, 'from_sold', src.sold, 'to_qty', d.qty, 'to_sold', d.sold,
          'to_days_left', case when d.per_day > 0 then floor(d.qty / d.per_day) end));
        n := n + 1;
      end loop;
      exit when n >= 400;
    end loop;
    exit when n >= 400;
  end loop;

  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'traslados_sugeridos'), 'days', v_days, 'cover', v_cover,
    'items', coalesce((
      select jsonb_agg(x || jsonb_build_object('name', p.name, 'sku', p.sku, 'image_url', p.image_url, 'from_name', wf.name, 'to_name', wt.name,
                                              'from_kind', wf.kind)
             order by wf.name, wt.name, p.name)
      from jsonb_array_elements(v_out) x
      join public.products p on p.id = (x ->> 'product_id')::uuid
      join public.erp_warehouses wf on wf.id = (x ->> 'from_id')::uuid
      join public.erp_warehouses wt on wt.id = (x ->> 'to_id')::uuid), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------------------ conteo por zonas
create table if not exists public.erp_stock_counts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses(id),
  zone text not null check (char_length(btrim(zone)) between 1 and 60),
  notes text,
  status text not null default 'counting' check (status in ('counting', 'submitted', 'approved', 'rejected')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  adjustment_id uuid
);
create index if not exists erp_stock_counts_store_idx on public.erp_stock_counts (store_id, status, created_at desc);
alter table public.erp_stock_counts enable row level security;
revoke all on public.erp_stock_counts from anon, authenticated;

create table if not exists public.erp_stock_count_lines (
  count_id uuid not null references public.erp_stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  counted integer not null check (counted >= 0),
  system_qty integer not null default 0,
  counted_at timestamptz not null default now(),
  primary key (count_id, product_id)
);
alter table public.erp_stock_count_lines enable row level security;
revoke all on public.erp_stock_count_lines from anon, authenticated;

create or replace function public.vm__user_name(p_store uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(su.display_name, ''), su.username) from public.store_users su where su.store_id = p_store and su.user_id = auth.uid()), 'Dueño')
$$;
revoke all on function public.vm__user_name(uuid) from public, anon, authenticated;

create or replace function public.vm__count_access(p_count uuid, p_perm text)
returns public.erp_stock_counts language plpgsql stable security definer set search_path = public as $$
declare c public.erp_stock_counts; v uuid[];
begin
  select * into c from public.erp_stock_counts where id = p_count;
  if c.id is null then raise exception 'No encontré ese conteo.'; end if;
  if auth.uid() is null or not public.erp_can(c.store_id, p_perm) then
    raise exception '%', case when p_perm = 'inventory_adjust' then 'Aprobar un conteo pide «Ajustar inventario».' else 'Necesitas el permiso «Inventario».' end;
  end if;
  v := public.erp_my_points(c.store_id);
  if v is not null and not (c.warehouse_id = any (v)) then raise exception 'Ese conteo es de otro punto.'; end if;
  return c;
end;
$$;
revoke all on function public.vm__count_access(uuid, text) from public, anon, authenticated;

create or replace function public.count_start(p_store uuid, p_warehouse uuid, p_zone text, p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v uuid[]; v_id uuid;
begin
  if auth.uid() is null or not public.erp_can(p_store, 'inventory') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Inventario».');
  end if;
  if not public.vm__on(p_store, 'conteo_zonas') then return jsonb_build_object('ok', false, 'message', 'El conteo por zonas está apagado.'); end if;
  if not exists (select 1 from public.erp_warehouses w where w.id = p_warehouse and w.store_id = p_store and w.active) then
    return jsonb_build_object('ok', false, 'message', 'Escoge un punto o bodega.');
  end if;
  v := public.erp_my_points(p_store);
  if v is not null and not (p_warehouse = any (v)) then return jsonb_build_object('ok', false, 'message', 'Solo puedes contar en tu punto.'); end if;
  if char_length(btrim(coalesce(p_zone, ''))) = 0 then return jsonb_build_object('ok', false, 'message', 'Escribe la zona (ej. Vitrina 1, Bodega fondo).'); end if;
  insert into public.erp_stock_counts (store_id, warehouse_id, zone, notes, created_by, created_by_name)
  values (p_store, p_warehouse, left(btrim(p_zone), 60), nullif(left(btrim(coalesce(p_notes, '')), 300), ''), auth.uid(), public.vm__user_name(p_store))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- p_lines: [{product_id, counted}]. Cada vez que se cuenta una línea se guarda lo que decía el sistema en ese momento.
create or replace function public.count_save_lines(p_count uuid, p_lines jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_stock_counts; n integer;
begin
  c := public.vm__count_access(p_count, 'inventory');
  if c.status <> 'counting' then return jsonb_build_object('ok', false, 'message', 'Este conteo ya se envió.'); end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Líneas no válidas.');
  end if;
  insert into public.erp_stock_count_lines (count_id, product_id, counted, system_qty, counted_at)
  select p_count, x.pid, x.counted, coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = c.warehouse_id and sl.product_id = x.pid), 0), now()
  from (select distinct on ((e ->> 'product_id')::uuid) (e ->> 'product_id')::uuid pid, greatest(0, coalesce((e ->> 'counted')::integer, 0)) counted
        from jsonb_array_elements(p_lines) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$' and (e ->> 'counted') is not null) x
  join public.products p on p.id = x.pid and p.store_id = c.store_id
  on conflict (count_id, product_id) do update set counted = excluded.counted, system_qty = excluded.system_qty, counted_at = excluded.counted_at
  where public.erp_stock_count_lines.counted is distinct from excluded.counted;
  get diagnostics n = row_count;
  delete from public.erp_stock_count_lines l where l.count_id = p_count and l.product_id in (
    select (e ->> 'product_id')::uuid from jsonb_array_elements(p_lines) e where (e ->> 'product_id') ~ '^[0-9a-f-]{36}$' and (e ->> 'remove')::boolean is true);
  return jsonb_build_object('ok', true, 'saved', n);
end;
$$;

create or replace function public.count_get(p_count uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.erp_stock_counts; v_cost boolean;
begin
  c := public.vm__count_access(p_count, 'inventory');
  v_cost := public.erp_can(c.store_id, 'costs_view');
  return jsonb_build_object('ok', true, 'can_approve', public.erp_can(c.store_id, 'inventory_adjust'), 'can_cost', v_cost,
    'count', jsonb_build_object('id', c.id, 'warehouse_id', c.warehouse_id, 'warehouse', (select w.name from public.erp_warehouses w where w.id = c.warehouse_id),
      'zone', c.zone, 'notes', c.notes, 'status', c.status, 'created_by_name', c.created_by_name, 'created_at', c.created_at, 'submitted_at', c.submitted_at,
      'decided_by_name', c.decided_by_name, 'decided_at', c.decided_at, 'decision_note', c.decision_note, 'adjustment_id', c.adjustment_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url,
        'counted', l.counted, 'system_qty', l.system_qty, 'diff', l.counted - l.system_qty, 'counted_at', l.counted_at,
        'now_qty', coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = c.warehouse_id and sl.product_id = l.product_id), 0),
        'unit_cost', case when v_cost then coalesce(p.cost_price, 0) end)
      order by (l.counted - l.system_qty) = 0, abs(l.counted - l.system_qty) desc, p.name)
      from public.erp_stock_count_lines l join public.products p on p.id = l.product_id where l.count_id = p_count), '[]'::jsonb));
end;
$$;

create or replace function public.count_list(p_store uuid, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if auth.uid() is null or not public.erp_can(p_store, 'inventory') then
    return jsonb_build_object('ok', false, 'message', 'Necesitas el permiso «Inventario».');
  end if;
  v := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true, 'on', public.vm__on(p_store, 'conteo_zonas'), 'can_approve', public.erp_can(p_store, 'inventory_adjust'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'warehouse_id', c.warehouse_id, 'warehouse', w.name, 'zone', c.zone, 'status', c.status,
        'created_by_name', c.created_by_name, 'created_at', c.created_at, 'submitted_at', c.submitted_at, 'decided_by_name', c.decided_by_name,
        'decided_at', c.decided_at, 'lines', s.lines, 'diffs', s.diffs, 'units_diff', s.units)
      order by case c.status when 'submitted' then 0 when 'counting' then 1 else 2 end, c.created_at desc)
      from public.erp_stock_counts c
      join public.erp_warehouses w on w.id = c.warehouse_id
      left join lateral (select count(*)::integer lines, count(*) filter (where l.counted <> l.system_qty)::integer diffs,
                                coalesce(sum(l.counted - l.system_qty), 0)::integer units
                         from public.erp_stock_count_lines l where l.count_id = c.id) s on true
      where c.store_id = p_store and (v is null or c.warehouse_id = any (v))
        and (p_status is null or c.status = p_status)
        and (c.status in ('counting', 'submitted') or c.created_at > now() - interval '120 days')
      limit 200), '[]'::jsonb));
end;
$$;

create or replace function public.count_submit(p_count uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_stock_counts;
begin
  c := public.vm__count_access(p_count, 'inventory');
  if c.status <> 'counting' then return jsonb_build_object('ok', false, 'message', 'Este conteo ya se envió.'); end if;
  if not exists (select 1 from public.erp_stock_count_lines l where l.count_id = p_count) then
    return jsonb_build_object('ok', false, 'message', 'El conteo no tiene productos.');
  end if;
  update public.erp_stock_counts set status = 'submitted', submitted_at = now() where id = p_count;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.count_reopen(p_count uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_stock_counts;
begin
  c := public.vm__count_access(p_count, 'inventory');
  if c.status <> 'submitted' then return jsonb_build_object('ok', false, 'message', 'Solo un conteo enviado se puede volver a abrir.'); end if;
  update public.erp_stock_counts set status = 'counting', submitted_at = null where id = p_count;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.count_delete(p_count uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.erp_stock_counts;
begin
  c := public.vm__count_access(p_count, 'inventory');
  if c.status not in ('counting', 'submitted') then return jsonb_build_object('ok', false, 'message', 'Un conteo aprobado o rechazado queda en el historial.'); end if;
  if c.created_by is distinct from auth.uid() and not public.erp_can(c.store_id, 'inventory_adjust') then
    return jsonb_build_object('ok', false, 'message', 'Solo quien lo empezó o quien aprueba conteos lo puede borrar.');
  end if;
  delete from public.erp_stock_counts where id = p_count;
  return jsonb_build_object('ok', true);
end;
$$;

-- Aprobar: ajusta SOLO la diferencia contra lo que había al contar (lo vendido después no se pierde).
create or replace function public.count_decide(p_count uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c public.erp_stock_counts;
  v_items jsonb;
  v_adj uuid := null;
  v_lines integer;
begin
  c := public.vm__count_access(p_count, 'inventory_adjust');
  if c.status <> 'submitted' then return jsonb_build_object('ok', false, 'message', 'Solo se decide un conteo enviado.'); end if;
  perform 1 from public.erp_stock_counts where id = p_count for update;
  if coalesce(p_approve, false) then
    select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id,
             'qty_after', greatest(0, coalesce(sl.qty, 0) + (l.counted - l.system_qty)))), '[]'::jsonb), count(*)
      into v_items, v_lines
    from public.erp_stock_count_lines l
    left join public.erp_stock_levels sl on sl.warehouse_id = c.warehouse_id and sl.product_id = l.product_id
    where l.count_id = p_count and l.counted <> l.system_qty;
    if v_lines > 0 then
      v_adj := public.erp_post_adjustment(c.store_id, c.warehouse_id, 'count',
        left('Conteo por zonas · ' || c.zone || coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), ''), 300), v_items);
    end if;
  end if;
  update public.erp_stock_counts set status = case when coalesce(p_approve, false) then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_by_name = public.vm__user_name(c.store_id), decided_at = now(),
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''), adjustment_id = v_adj
  where id = p_count;
  begin
    perform public.erp_audit(c.store_id, case when coalesce(p_approve, false) then 'count.approved' else 'count.rejected' end, 'erp_stock_counts', p_count,
      jsonb_build_object('zone', c.zone, 'warehouse_id', c.warehouse_id, 'adjusted_lines', coalesce(v_lines, 0), 'adjustment_id', v_adj));
  exception when undefined_function then null; end;
  return jsonb_build_object('ok', true, 'adjustment_id', v_adj, 'adjusted', coalesce(v_lines, 0));
end;
$$;

create or replace function public.vm_ops_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  v := public.erp_my_points(p_store);
  return jsonb_build_object('ok', true,
    'counts_pending', case when public.vm__on(p_store, 'conteo_zonas') and public.erp_can(p_store, 'inventory_adjust') then
      (select count(*) from public.erp_stock_counts c where c.store_id = p_store and c.status = 'submitted' and (v is null or c.warehouse_id = any (v))) else 0 end);
end;
$$;

revoke all on function public.erp_customer_history(uuid, text, integer) from public, anon;
revoke all on function public.erp_repurchase(uuid) from public, anon;
revoke all on function public.erp_repurchase_mark(uuid, text, text) from public, anon;
revoke all on function public.erp_rebalance_suggestions(uuid, integer, integer) from public, anon;
revoke all on function public.count_start(uuid, uuid, text, text) from public, anon;
revoke all on function public.count_save_lines(uuid, jsonb) from public, anon;
revoke all on function public.count_get(uuid) from public, anon;
revoke all on function public.count_list(uuid, text) from public, anon;
revoke all on function public.count_submit(uuid) from public, anon;
revoke all on function public.count_reopen(uuid) from public, anon;
revoke all on function public.count_delete(uuid) from public, anon;
revoke all on function public.count_decide(uuid, boolean, text) from public, anon;
revoke all on function public.vm_ops_alerts(uuid) from public, anon;
grant execute on function public.erp_customer_history(uuid, text, integer) to authenticated;
grant execute on function public.erp_repurchase(uuid) to authenticated;
grant execute on function public.erp_repurchase_mark(uuid, text, text) to authenticated;
grant execute on function public.erp_rebalance_suggestions(uuid, integer, integer) to authenticated;
grant execute on function public.count_start(uuid, uuid, text, text) to authenticated;
grant execute on function public.count_save_lines(uuid, jsonb) to authenticated;
grant execute on function public.count_get(uuid) to authenticated;
grant execute on function public.count_list(uuid, text) to authenticated;
grant execute on function public.count_submit(uuid) to authenticated;
grant execute on function public.count_reopen(uuid) to authenticated;
grant execute on function public.count_delete(uuid) to authenticated;
grant execute on function public.count_decide(uuid, boolean, text) to authenticated;
grant execute on function public.vm_ops_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
