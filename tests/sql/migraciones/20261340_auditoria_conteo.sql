-- 20261340 · Auditoría del conteo físico (Inventario → Ajustes, motivo «Conteo físico»)
--
-- Al aplicar un conteo físico se guarda su informe de auditoría:
--   · lo que se contó (cuadran, sobran, faltan) y
--   · lo que el sistema dice que hay en la bodega y NO se contó (foto del momento).
-- Lo que no se contó se deja como está (no se toca el inventario) y queda en «Pendientes por contar» de esa bodega
-- hasta que alguien lo cuente en otro conteo. Lo contado en los últimos 30 días en esa bodega se da por revisado.
--
--   · erp_count_progress(store, bodega): lo que hay en la bodega según el sistema, con lo pendiente y lo contado hace poco.
--   · erp_count_audit_post(store, bodega, notas, contado): ajusta solo las diferencias (erp_post_adjustment, motivo
--     «count») y guarda la auditoría. Si todo cuadra, igual queda la auditoría (sin ajuste).
--   · erp_count_audits_list / erp_count_audit_get: el historial y el informe. Los valores en plata solo salen con
--     «Ver costos y márgenes».
-- Permisos: contar y aplicar piden «Ajustar inventario» (igual que el ajuste); ver el informe pide «Ajustar
-- inventario» o «Inventario». Un usuario con punto solo ve y cuenta sus bodegas. No cambia permisos ni precios.
-- Se puede correr varias veces.

create table if not exists public.erp_count_audits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses(id) on delete cascade,
  adjustment_id uuid references public.erp_adjustments(id) on delete set null,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  counted_products integer not null default 0,
  matched_products integer not null default 0,
  over_products integer not null default 0,
  over_units integer not null default 0,
  over_value numeric not null default 0,
  short_products integer not null default 0,
  short_units integer not null default 0,
  short_value numeric not null default 0,
  uncounted_products integer not null default 0,
  uncounted_units integer not null default 0,
  uncounted_value numeric not null default 0,
  recent_products integer not null default 0,
  uncounted jsonb not null default '[]'::jsonb
);
create index if not exists erp_count_audits_store_idx on public.erp_count_audits (store_id, created_at desc);
create index if not exists erp_count_audits_wh_idx on public.erp_count_audits (warehouse_id, created_at desc);
create index if not exists erp_count_audits_adj_idx on public.erp_count_audits (adjustment_id);
alter table public.erp_count_audits enable row level security;
revoke all on public.erp_count_audits from anon, authenticated;

-- Última vez que se contó cada producto en cada bodega.
create table if not exists public.erp_count_last (
  warehouse_id uuid not null references public.erp_warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  counted_at timestamptz not null default now(),
  audit_id uuid references public.erp_count_audits(id) on delete set null,
  primary key (warehouse_id, product_id)
);
alter table public.erp_count_last enable row level security;
revoke all on public.erp_count_last from anon, authenticated;

-- Pendientes por contar: lo que una auditoría dejó sin contar. Sale al contarlo en otro conteo.
create table if not exists public.erp_count_pending (
  warehouse_id uuid not null references public.erp_warehouses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  since timestamptz not null default now(),
  audit_id uuid references public.erp_count_audits(id) on delete set null,
  qty_at integer not null default 0,
  primary key (warehouse_id, product_id)
);
create index if not exists erp_count_pending_store_idx on public.erp_count_pending (store_id, warehouse_id);
alter table public.erp_count_pending enable row level security;
revoke all on public.erp_count_pending from anon, authenticated;

-- ¿Puede ver o contar esa bodega? (permiso + bodega de la tienda + su punto). Devuelve el motivo si no.
create or replace function public.erp__count_scope(p_store uuid, p_warehouse uuid, p_perms text[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v uuid[];
begin
  if auth.uid() is null or not exists (select 1 from unnest(p_perms) x where public.erp_can(p_store, x)) then
    return 'No tienes permiso para esto.';
  end if;
  if p_warehouse is not null and not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store) then
    return 'Bodega no válida.';
  end if;
  v := public.erp_my_points(p_store);
  if p_warehouse is not null and v is not null and not (p_warehouse = any (v)) then
    return 'Esa bodega no es de tu punto.';
  end if;
  return null;
end;
$$;
revoke all on function public.erp__count_scope(uuid, uuid, text[]) from public, anon, authenticated;

-- Lo que hay en la bodega según el sistema (para «Lo que falta contar»).
create or replace function public.erp_count_progress(p_store uuid, p_warehouse uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_why text;
begin
  v_why := public.erp__count_scope(p_store, p_warehouse, array['inventory_adjust']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  if p_warehouse is null then return jsonb_build_object('ok', false, 'message', 'Elige la bodega.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url, 'qty', sl.qty,
      'pending_since', cp.since, 'last_counted_at', cl.counted_at,
      'recent', cl.counted_at is not null and cl.counted_at > now() - interval '30 days'
    ) order by sl.qty desc, p.name)
    from public.erp_stock_levels sl
    join public.products p on p.id = sl.product_id and p.store_id = p_store
    left join public.erp_count_pending cp on cp.warehouse_id = sl.warehouse_id and cp.product_id = sl.product_id
    left join public.erp_count_last cl on cl.warehouse_id = sl.warehouse_id and cl.product_id = sl.product_id
    where sl.warehouse_id = p_warehouse and sl.qty > 0
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_count_progress(uuid, uuid) from public, anon;
grant execute on function public.erp_count_progress(uuid, uuid) to authenticated;

-- Aplicar el conteo y guardar la auditoría. p_counted = [{product_id, qty}] con TODO lo contado (también lo que cuadra).
create or replace function public.erp_count_audit_post(p_store uuid, p_warehouse uuid, p_notes text, p_counted jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_why text;
  v_items jsonb;
  v_adj uuid;
  v_num bigint;
  v_audit uuid;
  v_counted integer;
  v_over integer := 0; v_over_u integer := 0; v_over_v numeric := 0;
  v_short integer := 0; v_short_u integer := 0; v_short_v numeric := 0;
  v_unc jsonb; v_unc_n integer := 0; v_unc_u integer := 0; v_unc_v numeric := 0;
  v_recent integer := 0;
  v_name text;
begin
  v_why := public.erp__count_scope(p_store, p_warehouse, array['inventory_adjust']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  if p_warehouse is null or not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then
    return jsonb_build_object('ok', false, 'message', 'Bodega no válida.');
  end if;
  if jsonb_typeof(p_counted) is distinct from 'array' or jsonb_array_length(p_counted) = 0 then
    return jsonb_build_object('ok', false, 'message', 'El conteo no tiene productos.');
  end if;
  if exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id is null or x.qty is null or x.qty < 0) then
    return jsonb_build_object('ok', false, 'message', 'Hay una cantidad contada inválida.');
  end if;
  select count(*) into v_counted from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer);
  if v_counted <> (select count(distinct x.product_id) from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)) then
    return jsonb_build_object('ok', false, 'message', 'Un producto está repetido en el conteo.');
  end if;
  if exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
             left join public.products p on p.id = x.product_id and p.store_id = p_store where p.id is null) then
    return jsonb_build_object('ok', false, 'message', 'Un producto no pertenece a esta tienda.');
  end if;

  -- 1) Solo lo que no cuadra se ajusta (igual que siempre: kardex y auditoría del ajuste).
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'qty_after', x.qty)), '[]'::jsonb) into v_items
  from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
  left join public.erp_stock_levels sl on sl.warehouse_id = p_warehouse and sl.product_id = x.product_id
  where coalesce(sl.qty, 0) <> x.qty;
  if jsonb_array_length(v_items) > 0 then
    v_adj := public.erp_post_adjustment(p_store, p_warehouse, 'count', p_notes, v_items);
    select number into v_num from public.erp_adjustments where id = v_adj;
    select count(*) filter (where diff > 0), coalesce(sum(diff) filter (where diff > 0), 0), coalesce(sum(diff * unit_cost) filter (where diff > 0), 0),
           count(*) filter (where diff < 0), coalesce(-sum(diff) filter (where diff < 0), 0), coalesce(-sum(diff * unit_cost) filter (where diff < 0), 0)
      into v_over, v_over_u, v_over_v, v_short, v_short_u, v_short_v
    from public.erp_adjustment_items where adjustment_id = v_adj;
  end if;

  -- 2) Lo que hay según el sistema y no se contó (lo contado aquí en los últimos 30 días se da por revisado).
  select count(*) into v_recent
  from public.erp_stock_levels sl
  join public.erp_count_last cl on cl.warehouse_id = sl.warehouse_id and cl.product_id = sl.product_id and cl.counted_at > now() - interval '30 days'
  where sl.warehouse_id = p_warehouse and sl.qty > 0
    and not exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id = sl.product_id);

  select count(*), coalesce(sum(sl.qty), 0), coalesce(sum(sl.qty * coalesce(p.cost_price, 0)), 0),
         coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'qty', sl.qty,
           'unit_cost', coalesce(p.cost_price, 0), 'pending_since', cp.since) order by sl.qty desc, p.name), '[]'::jsonb)
    into v_unc_n, v_unc_u, v_unc_v, v_unc
  from public.erp_stock_levels sl
  join public.products p on p.id = sl.product_id and p.store_id = p_store
  left join public.erp_count_pending cp on cp.warehouse_id = sl.warehouse_id and cp.product_id = sl.product_id
  left join public.erp_count_last cl on cl.warehouse_id = sl.warehouse_id and cl.product_id = sl.product_id
  where sl.warehouse_id = p_warehouse and sl.qty > 0
    and not exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id = sl.product_id)
    and (cl.counted_at is null or cl.counted_at <= now() - interval '30 days');

  select coalesce(nullif(su.display_name, ''), su.username) into v_name
  from public.store_users su where su.store_id = p_store and su.user_id = auth.uid();
  if v_name is null then
    v_name := case when exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) then 'Dueño' else 'Usuario' end;
  end if;

  insert into public.erp_count_audits (store_id, warehouse_id, adjustment_id, notes, created_by, created_by_name,
    counted_products, matched_products, over_products, over_units, over_value, short_products, short_units, short_value,
    uncounted_products, uncounted_units, uncounted_value, recent_products, uncounted)
  values (p_store, p_warehouse, v_adj, nullif(left(btrim(coalesce(p_notes, '')), 300), ''), auth.uid(), v_name,
    v_counted, v_counted - v_over - v_short, v_over, v_over_u, v_over_v, v_short, v_short_u, v_short_v,
    v_unc_n, v_unc_u, v_unc_v, v_recent, v_unc)
  returning id into v_audit;

  -- 3) Lo contado: queda revisado y sale de pendientes.
  insert into public.erp_count_last (warehouse_id, product_id, store_id, counted_at, audit_id)
  select p_warehouse, x.product_id, p_store, now(), v_audit from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
  on conflict (warehouse_id, product_id) do update set counted_at = excluded.counted_at, audit_id = excluded.audit_id;
  delete from public.erp_count_pending cp
  where cp.warehouse_id = p_warehouse
    and cp.product_id in (select x.product_id from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer));

  -- 4) Lo que no se contó: queda pendiente (si ya estaba, conserva desde cuándo).
  insert into public.erp_count_pending (warehouse_id, product_id, store_id, since, audit_id, qty_at)
  select p_warehouse, (u->>'product_id')::uuid, p_store, now(), v_audit, (u->>'qty')::integer
  from jsonb_array_elements(v_unc) u
  on conflict (warehouse_id, product_id) do nothing;

  begin
    perform public.erp_audit(p_store, 'count.audit', 'erp_count_audits', v_audit,
      jsonb_build_object('warehouse_id', p_warehouse, 'adjustment_id', v_adj, 'counted', v_counted,
        'over', v_over, 'short', v_short, 'uncounted', v_unc_n));
  exception when undefined_function then null;
  end;

  return jsonb_build_object('ok', true, 'audit_id', v_audit, 'adjustment_id', v_adj, 'adjustment_number', v_num,
    'counted', v_counted, 'matched', v_counted - v_over - v_short, 'over', v_over, 'short', v_short, 'uncounted', v_unc_n);
end;
$$;
revoke all on function public.erp_count_audit_post(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.erp_count_audit_post(uuid, uuid, text, jsonb) to authenticated;

-- Historial de auditorías (las bodegas que el usuario puede ver).
create or replace function public.erp_count_audits_list(p_store uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_why text; v uuid[]; v_cost boolean;
begin
  v_why := public.erp__count_scope(p_store, null, array['inventory_adjust', 'inventory']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v := public.erp_my_points(p_store);
  v_cost := public.erp_can(p_store, 'costs_view');
  return jsonb_build_object('ok', true, 'can_cost', v_cost, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'warehouse_id', a.warehouse_id, 'warehouse', w.name, 'adjustment_id', a.adjustment_id, 'adjustment_number', j.number,
      'created_at', a.created_at, 'created_by_name', a.created_by_name, 'notes', a.notes,
      'counted', a.counted_products, 'matched', a.matched_products,
      'over', a.over_products, 'over_units', a.over_units, 'short', a.short_products, 'short_units', a.short_units,
      'uncounted', a.uncounted_products, 'uncounted_units', a.uncounted_units, 'recent', a.recent_products,
      'over_value', case when v_cost then a.over_value end, 'short_value', case when v_cost then a.short_value end,
      'uncounted_value', case when v_cost then a.uncounted_value end
    ) order by a.created_at desc)
    from (select * from public.erp_count_audits x
          where x.store_id = p_store and (v is null or x.warehouse_id = any (v))
          order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 200))) a
    join public.erp_warehouses w on w.id = a.warehouse_id
    left join public.erp_adjustments j on j.id = a.adjustment_id
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_count_audits_list(uuid, integer) from public, anon;
grant execute on function public.erp_count_audits_list(uuid, integer) to authenticated;

-- Informe de una auditoría: sobrantes, faltantes y lo que quedó sin contar (con lo que sigue pendiente hoy).
create or replace function public.erp_count_audit_get(p_audit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.erp_count_audits; v_why text; v_cost boolean;
begin
  select * into a from public.erp_count_audits where id = p_audit;
  if a.id is null then return jsonb_build_object('ok', false, 'message', 'No encontré esa auditoría.'); end if;
  v_why := public.erp__count_scope(a.store_id, a.warehouse_id, array['inventory_adjust', 'inventory']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_cost := public.erp_can(a.store_id, 'costs_view');
  return jsonb_build_object('ok', true, 'can_cost', v_cost,
    'audit', jsonb_build_object(
      'id', a.id, 'warehouse_id', a.warehouse_id, 'warehouse', (select name from public.erp_warehouses where id = a.warehouse_id),
      'adjustment_id', a.adjustment_id, 'adjustment_number', (select number from public.erp_adjustments where id = a.adjustment_id),
      'created_at', a.created_at, 'created_by_name', a.created_by_name, 'notes', a.notes,
      'counted', a.counted_products, 'matched', a.matched_products,
      'over', a.over_products, 'over_units', a.over_units, 'short', a.short_products, 'short_units', a.short_units,
      'uncounted', a.uncounted_products, 'uncounted_units', a.uncounted_units, 'recent', a.recent_products,
      'over_value', case when v_cost then a.over_value end, 'short_value', case when v_cost then a.short_value end,
      'uncounted_value', case when v_cost then a.uncounted_value end),
    'diffs', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', p.name, 'sku', p.sku,
        'before', i.qty_before, 'after', i.qty_after, 'diff', i.diff, 'unit_cost', case when v_cost then i.unit_cost end) order by i.diff, p.name)
      from public.erp_adjustment_items i join public.products p on p.id = i.product_id
      where i.adjustment_id = a.adjustment_id), '[]'::jsonb),
    'uncounted', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u->>'product_id', 'name', u->>'name', 'sku', u->>'sku', 'qty', (u->>'qty')::integer,
        'unit_cost', case when v_cost then (u->>'unit_cost')::numeric end,
        'still_pending', exists (select 1 from public.erp_count_pending cp where cp.warehouse_id = a.warehouse_id and cp.product_id = (u->>'product_id')::uuid)))
      from jsonb_array_elements(a.uncounted) u), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_count_audit_get(uuid) from public, anon;
grant execute on function public.erp_count_audit_get(uuid) to authenticated;
