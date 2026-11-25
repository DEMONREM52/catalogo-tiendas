-- =====================================================================
-- 20261344 · Conteo físico: «Inventario inicial», informe en plata antes de aplicar y revertir
-- (Necesita 20261340_auditoria_conteo.sql.)
--
-- Hasta ahora el conteo físico solo tenía una forma (20261340): lo que no se cuenta NO se toca y queda en
-- «Pendientes por contar». Esto agrega:
--   · «Inventario inicial» (partida inicial): la lista ES todo lo que hay en la bodega. Lo que está en la lista
--     queda con lo contado y TODO lo demás que el sistema dice que hay ahí queda en 0 (también lo que esté en
--     negativo). Va en un solo ajuste (motivo «Conteo físico», nota «🚩 Inventario inicial») y se guarda en el
--     informe qué se sacó. Para aplicarlo hay que mandar cuántos productos se sacan según el informe que se vio:
--     si mientras tanto cambió la bodega, no aplica y pide revisar otra vez.
--   · erp_count_preview: el informe ANTES de aplicar (cuadran, sobran, faltan, sin contar o se sacan, y la
--     diferencia neta), en unidades y en plata al costo. La plata solo sale con «Ver costos y márgenes».
--   · Revertir un conteo (cualquiera de los dos): un ajuste nuevo (motivo «Corrección de registro») devuelve cada
--     producto a como estaba, respetando lo que se movió después (se devuelve la diferencia, no el número viejo);
--     si ya no alcanza, queda en 0 y se anota. Solo el último conteo sin revertir de esa bodega, una sola vez.
--     En un punto con crédito, la deuda con la bodega también vuelve (cada ajuste la mueve, 20261342).
-- Permisos: los mismos de 20261340 («Ajustar inventario» y la bodega del usuario). No cambia permisos ni precios.
-- No borra datos. Se puede correr varias veces.
-- =====================================================================

alter table public.erp_count_audits add column if not exists mode text not null default 'count';
alter table public.erp_count_audits add column if not exists removed_products integer not null default 0;
alter table public.erp_count_audits add column if not exists removed_units integer not null default 0;
alter table public.erp_count_audits add column if not exists removed_value numeric not null default 0;
alter table public.erp_count_audits add column if not exists removed jsonb not null default '[]'::jsonb;
alter table public.erp_count_audits add column if not exists reverted_at timestamptz;
alter table public.erp_count_audits add column if not exists reverted_by uuid;
alter table public.erp_count_audits add column if not exists reverted_by_name text;
alter table public.erp_count_audits add column if not exists revert_adjustment_id uuid references public.erp_adjustments(id) on delete set null;
alter table public.erp_count_audits add column if not exists revert_note text;
alter table public.erp_count_audits add column if not exists revert_short jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'erp_count_audits_mode_chk') then
    alter table public.erp_count_audits add constraint erp_count_audits_mode_chk check (mode in ('count', 'start'));
  end if;
end $$;

-- Quién lo hace (igual que en 20261340).
create or replace function public.erp__count_actor(p_store uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_name text;
begin
  select coalesce(nullif(su.display_name, ''), su.username) into v_name
  from public.store_users su where su.store_id = p_store and su.user_id = auth.uid();
  if v_name is null then
    v_name := case when exists (select 1 from public.stores s where s.id = p_store and s.owner_id = auth.uid()) then 'Dueño' else 'Usuario' end;
  end if;
  return v_name;
end;
$$;
revoke all on function public.erp__count_actor(uuid) from public, anon, authenticated;

-- Revisa el conteo antes de calcular o aplicar. Devuelve el motivo si algo no sirve.
create or replace function public.erp__count_check(p_store uuid, p_warehouse uuid, p_counted jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_why text;
begin
  v_why := public.erp__count_scope(p_store, p_warehouse, array['inventory_adjust']);
  if v_why is not null then return v_why; end if;
  if p_warehouse is null or not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then
    return 'Bodega no válida.';
  end if;
  if jsonb_typeof(p_counted) is distinct from 'array' or jsonb_array_length(p_counted) = 0 then
    return 'El conteo no tiene productos.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id is null or x.qty is null or x.qty < 0) then
    return 'Hay una cantidad contada inválida.';
  end if;
  if (select count(*) from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer))
     <> (select count(distinct x.product_id) from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)) then
    return 'Un producto está repetido en el conteo.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
             left join public.products p on p.id = x.product_id and p.store_id = p_store where p.id is null) then
    return 'Un producto no pertenece a esta tienda.';
  end if;
  return null;
end;
$$;
revoke all on function public.erp__count_check(uuid, uuid, jsonb) from public, anon, authenticated;

-- Informe ANTES de aplicar. p_mode: 'count' (lo no contado no se toca) o 'start' (lo que no está en la lista queda en 0).
create or replace function public.erp_count_preview(p_store uuid, p_warehouse uuid, p_counted jsonb, p_mode text default 'count')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_why text; v_cost boolean; v_start boolean := p_mode = 'start';
  r record; v_diffs jsonb; v_removed jsonb;
begin
  if p_mode is null or p_mode not in ('count', 'start') then return jsonb_build_object('ok', false, 'message', 'Tipo de conteo no válido.'); end if;
  v_why := public.erp__count_check(p_store, p_warehouse, p_counted);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_cost := public.erp_can(p_store, 'costs_view');

  with c as (select x.product_id, x.qty from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)),
  d as (
    select c.qty - coalesce(sl.qty, 0) as diff, coalesce(p.cost_price, 0) as cost
    from c join public.products p on p.id = c.product_id
    left join public.erp_stock_levels sl on sl.warehouse_id = p_warehouse and sl.product_id = c.product_id
  ),
  o as (
    select sl.qty, coalesce(p.cost_price, 0) as cost,
           (cl.counted_at is not null and cl.counted_at > now() - interval '30 days') as recent
    from public.erp_stock_levels sl
    join public.products p on p.id = sl.product_id and p.store_id = p_store
    left join public.erp_count_last cl on cl.warehouse_id = sl.warehouse_id and cl.product_id = sl.product_id
    where sl.warehouse_id = p_warehouse and sl.qty <> 0 and not exists (select 1 from c where c.product_id = sl.product_id)
  )
  select
    (select count(*) from d)::int as counted,
    (select count(*) from d where diff = 0)::int as matched,
    (select count(*) from d where diff > 0)::int as over_n,
    (select coalesce(sum(diff), 0) from d where diff > 0)::int as over_u,
    (select coalesce(sum(diff * cost), 0) from d where diff > 0) as over_v,
    (select count(*) from d where diff < 0)::int as short_n,
    (select coalesce(-sum(diff), 0) from d where diff < 0)::int as short_u,
    (select coalesce(-sum(diff * cost), 0) from d where diff < 0) as short_v,
    (select count(*) from o where not v_start and qty > 0 and not recent)::int as unc_n,
    (select coalesce(sum(qty), 0) from o where not v_start and qty > 0 and not recent)::int as unc_u,
    (select coalesce(sum(qty * cost), 0) from o where not v_start and qty > 0 and not recent) as unc_v,
    (select count(*) from o where not v_start and qty > 0 and recent)::int as recent_n,
    (select count(*) from o where v_start)::int as rem_n,
    (select coalesce(sum(qty), 0) from o where v_start)::int as rem_u,
    (select coalesce(sum(qty * cost), 0) from o where v_start) as rem_v,
    (select count(*) from o where v_start and qty < 0)::int as neg_n
  into r;

  -- Las diferencias más grandes (en plata si se puede ver; si no, en unidades).
  select coalesce(jsonb_agg(z.j order by z.k desc, z.name), '[]'::jsonb) into v_diffs
  from (
    select jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'before', coalesce(sl.qty, 0), 'after', x.qty,
             'diff', x.qty - coalesce(sl.qty, 0), 'unit_cost', case when v_cost then coalesce(p.cost_price, 0) end) as j,
           case when v_cost then abs((x.qty - coalesce(sl.qty, 0)) * coalesce(p.cost_price, 0)) else abs(x.qty - coalesce(sl.qty, 0)) end as k,
           p.name
    from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
    join public.products p on p.id = x.product_id
    left join public.erp_stock_levels sl on sl.warehouse_id = p_warehouse and sl.product_id = x.product_id
    where x.qty <> coalesce(sl.qty, 0)
    order by k desc, p.name
    limit 12
  ) z;

  -- Inventario inicial: TODO lo que se va a sacar (para la lista en rojo y la cuenta del punto).
  if v_start then
    select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'qty', sl.qty,
             'unit_cost', case when v_cost then coalesce(p.cost_price, 0) end)
           order by sl.qty * coalesce(p.cost_price, 0) desc, sl.qty desc, p.name), '[]'::jsonb)
      into v_removed
    from public.erp_stock_levels sl
    join public.products p on p.id = sl.product_id and p.store_id = p_store
    where sl.warehouse_id = p_warehouse and sl.qty <> 0
      and not exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id = sl.product_id);
  end if;

  return jsonb_build_object('ok', true, 'mode', p_mode, 'can_cost', v_cost,
    'counted', r.counted, 'matched', r.matched,
    'over', r.over_n, 'over_units', r.over_u, 'over_value', case when v_cost then r.over_v end,
    'short', r.short_n, 'short_units', r.short_u, 'short_value', case when v_cost then r.short_v end,
    'uncounted', r.unc_n, 'uncounted_units', r.unc_u, 'uncounted_value', case when v_cost then r.unc_v end,
    'recent', r.recent_n,
    'removed', r.rem_n, 'removed_units', r.rem_u, 'removed_value', case when v_cost then r.rem_v end, 'negatives', r.neg_n,
    'net_units', r.over_u - r.short_u - r.rem_u,
    'net_value', case when v_cost then r.over_v - r.short_v - r.rem_v end,
    'top_diffs', v_diffs, 'removed_items', coalesce(v_removed, '[]'::jsonb));
end;
$$;
revoke all on function public.erp_count_preview(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.erp_count_preview(uuid, uuid, jsonb, text) to authenticated;

-- Aplica el conteo y guarda la auditoría (los dos modos). Interna: la llaman erp_count_audit_post y erp_count_start_post.
create or replace function public.erp__count_post(p_store uuid, p_warehouse uuid, p_notes text, p_counted jsonb, p_mode text, p_expect_removed integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_why text;
  v_start boolean := p_mode = 'start';
  v_items jsonb;
  v_adj uuid;
  v_num bigint;
  v_audit uuid;
  v_counted integer;
  v_over integer := 0; v_over_u integer := 0; v_over_v numeric := 0;
  v_short integer := 0; v_short_u integer := 0; v_short_v numeric := 0;
  v_unc jsonb := '[]'::jsonb; v_unc_n integer := 0; v_unc_u integer := 0; v_unc_v numeric := 0;
  v_rem jsonb := '[]'::jsonb; v_rem_n integer := 0; v_rem_u integer := 0; v_rem_v numeric := 0;
  v_recent integer := 0;
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 300), '');
begin
  if p_mode is null or p_mode not in ('count', 'start') then return jsonb_build_object('ok', false, 'message', 'Tipo de conteo no válido.'); end if;
  v_why := public.erp__count_check(p_store, p_warehouse, p_counted);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  select count(*) into v_counted from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer);

  -- Inventario inicial: foto de lo que hay y NO está en la lista (se pone en 0). Se toma antes de ajustar.
  if v_start then
    select count(*), coalesce(sum(sl.qty), 0), coalesce(sum(sl.qty * coalesce(p.cost_price, 0)), 0),
           coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'qty', sl.qty,
             'unit_cost', coalesce(p.cost_price, 0)) order by sl.qty * coalesce(p.cost_price, 0) desc, sl.qty desc, p.name), '[]'::jsonb)
      into v_rem_n, v_rem_u, v_rem_v, v_rem
    from public.erp_stock_levels sl
    join public.products p on p.id = sl.product_id and p.store_id = p_store
    where sl.warehouse_id = p_warehouse and sl.qty <> 0
      and not exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id = sl.product_id);
    if p_expect_removed is null or p_expect_removed <> v_rem_n then
      return jsonb_build_object('ok', false, 'changed', true, 'removed', v_rem_n,
        'message', format('Mientras confirmabas cambió lo que hay en la bodega: ahora se sacarían %s productos. Revisa el informe otra vez.', v_rem_n));
    end if;
    v_notes := left(concat_ws(' · ', '🚩 Inventario inicial', v_notes), 300);
  end if;

  -- 1) El ajuste: lo contado que no cuadra (y en inventario inicial, lo que no está en la lista queda en 0).
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'qty_after', x.qty)), '[]'::jsonb) into v_items
  from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
  left join public.erp_stock_levels sl on sl.warehouse_id = p_warehouse and sl.product_id = x.product_id
  where coalesce(sl.qty, 0) <> x.qty;
  if v_start and v_rem_n > 0 then
    v_items := v_items || (select jsonb_agg(jsonb_build_object('product_id', (u->>'product_id')::uuid, 'qty_after', 0)) from jsonb_array_elements(v_rem) u);
  end if;
  if jsonb_array_length(v_items) > 0 then
    v_adj := public.erp_post_adjustment(p_store, p_warehouse, 'count', v_notes, v_items);
    select number into v_num from public.erp_adjustments where id = v_adj;
    -- Sobran y faltan: solo lo contado (lo que se sacó va aparte).
    select count(*) filter (where i.diff > 0), coalesce(sum(i.diff) filter (where i.diff > 0), 0), coalesce(sum(i.diff * i.unit_cost) filter (where i.diff > 0), 0),
           count(*) filter (where i.diff < 0), coalesce(-sum(i.diff) filter (where i.diff < 0), 0), coalesce(-sum(i.diff * i.unit_cost) filter (where i.diff < 0), 0)
      into v_over, v_over_u, v_over_v, v_short, v_short_u, v_short_v
    from public.erp_adjustment_items i
    where i.adjustment_id = v_adj
      and exists (select 1 from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer) where x.product_id = i.product_id);
  end if;

  -- 2) Conteo normal: lo que hay y no se contó (lo contado aquí en los últimos 30 días se da por revisado).
  if not v_start then
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
  end if;

  insert into public.erp_count_audits (store_id, warehouse_id, adjustment_id, notes, created_by, created_by_name, mode,
    counted_products, matched_products, over_products, over_units, over_value, short_products, short_units, short_value,
    uncounted_products, uncounted_units, uncounted_value, recent_products, uncounted,
    removed_products, removed_units, removed_value, removed)
  values (p_store, p_warehouse, v_adj, v_notes, auth.uid(), public.erp__count_actor(p_store), p_mode,
    v_counted, v_counted - v_over - v_short, v_over, v_over_u, v_over_v, v_short, v_short_u, v_short_v,
    v_unc_n, v_unc_u, v_unc_v, v_recent, v_unc,
    v_rem_n, v_rem_u, v_rem_v, v_rem)
  returning id into v_audit;

  -- 3) Lo contado: queda revisado y sale de pendientes.
  insert into public.erp_count_last (warehouse_id, product_id, store_id, counted_at, audit_id)
  select p_warehouse, x.product_id, p_store, now(), v_audit from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer)
  on conflict (warehouse_id, product_id) do update set counted_at = excluded.counted_at, audit_id = excluded.audit_id;
  if v_start then
    -- Inventario inicial: la bodega quedó igual a la lista; no queda nada pendiente por contar.
    delete from public.erp_count_pending cp where cp.warehouse_id = p_warehouse;
  else
    delete from public.erp_count_pending cp
    where cp.warehouse_id = p_warehouse
      and cp.product_id in (select x.product_id from jsonb_to_recordset(p_counted) x(product_id uuid, qty integer));
    -- 4) Lo que no se contó: queda pendiente (si ya estaba, conserva desde cuándo).
    insert into public.erp_count_pending (warehouse_id, product_id, store_id, since, audit_id, qty_at)
    select p_warehouse, (u->>'product_id')::uuid, p_store, now(), v_audit, (u->>'qty')::integer
    from jsonb_array_elements(v_unc) u
    on conflict (warehouse_id, product_id) do nothing;
  end if;

  begin
    perform public.erp_audit(p_store, case when v_start then 'count.start_inventory' else 'count.audit' end, 'erp_count_audits', v_audit,
      jsonb_build_object('warehouse_id', p_warehouse, 'adjustment_id', v_adj, 'counted', v_counted,
        'over', v_over, 'short', v_short, 'uncounted', v_unc_n, 'removed', v_rem_n, 'removed_units', v_rem_u));
  exception when undefined_function then null;
  end;

  return jsonb_build_object('ok', true, 'audit_id', v_audit, 'adjustment_id', v_adj, 'adjustment_number', v_num, 'mode', p_mode,
    'counted', v_counted, 'matched', v_counted - v_over - v_short, 'over', v_over, 'short', v_short, 'uncounted', v_unc_n,
    'removed', v_rem_n, 'removed_units', v_rem_u);
end;
$$;
revoke all on function public.erp__count_post(uuid, uuid, text, jsonb, text, integer) from public, anon, authenticated;

-- Conteo normal (la misma firma de 20261340).
create or replace function public.erp_count_audit_post(p_store uuid, p_warehouse uuid, p_notes text, p_counted jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp__count_post(p_store, p_warehouse, p_notes, p_counted, 'count', null);
end;
$$;
revoke all on function public.erp_count_audit_post(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.erp_count_audit_post(uuid, uuid, text, jsonb) to authenticated;

-- Inventario inicial. p_expect_removed = cuántos productos se sacan según el informe que se vio.
create or replace function public.erp_count_start_post(p_store uuid, p_warehouse uuid, p_notes text, p_counted jsonb, p_expect_removed integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp__count_post(p_store, p_warehouse, p_notes, p_counted, 'start', p_expect_removed);
end;
$$;
revoke all on function public.erp_count_start_post(uuid, uuid, text, jsonb, integer) from public, anon;
grant execute on function public.erp_count_start_post(uuid, uuid, text, jsonb, integer) to authenticated;

-- ¿Se puede revertir? Devuelve el motivo si no.
create or replace function public.erp__count_revert_block(a public.erp_count_audits)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_later timestamptz;
begin
  if a.reverted_at is not null then return 'Este conteo ya se revirtió.'; end if;
  if a.adjustment_id is null then return 'Este conteo no cambió el inventario: no hay nada que revertir.'; end if;
  -- Un conteo posterior que cambió el inventario y sigue en pie (uno que todo cuadró no estorba).
  select min(b.created_at) into v_later from public.erp_count_audits b
  where b.warehouse_id = a.warehouse_id and b.created_at > a.created_at and b.reverted_at is null and b.id <> a.id
    and b.adjustment_id is not null;
  if v_later is not null then
    return 'Solo se puede revertir el último conteo de esta bodega: después se hizo otro el '
      || to_char(v_later at time zone 'America/Bogota', 'DD/MM/YYYY') || '. Revierte primero ese.';
  end if;
  return null;
end;
$$;
revoke all on function public.erp__count_revert_block(public.erp_count_audits) from public, anon, authenticated;

-- Lo que haría revertir: cada producto vuelve restando lo que cambió el conteo (respeta lo que se movió después).
create or replace function public.erp__count_revert_plan(a public.erp_count_audits)
returns table (product_id uuid, name text, sku text, diff integer, qty_now integer, target integer, short_by integer, unit_cost numeric)
language sql
stable
security definer
set search_path = public
as $$
  select i.product_id, p.name, p.sku, i.diff, coalesce(sl.qty, 0) as qty_now,
         greatest(coalesce(sl.qty, 0) - i.diff, 0) as target,
         greatest(i.diff - coalesce(sl.qty, 0), 0) as short_by,
         coalesce(i.unit_cost, 0) as unit_cost
  from public.erp_adjustment_items i
  join public.products p on p.id = i.product_id
  left join public.erp_stock_levels sl on sl.warehouse_id = a.warehouse_id and sl.product_id = i.product_id
  where i.adjustment_id = a.adjustment_id and i.diff <> 0;
$$;
revoke all on function public.erp__count_revert_plan(public.erp_count_audits) from public, anon, authenticated;

create or replace function public.erp_count_revert_preview(p_audit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.erp_count_audits; v_why text; v_cost boolean;
begin
  select * into a from public.erp_count_audits where id = p_audit;
  if a.id is null then return jsonb_build_object('ok', false, 'message', 'No encontré ese conteo.'); end if;
  v_why := public.erp__count_scope(a.store_id, a.warehouse_id, array['inventory_adjust']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_why := public.erp__count_revert_block(a);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_cost := public.erp_can(a.store_id, 'costs_view');
  return (
    select jsonb_build_object('ok', true, 'mode', a.mode, 'can_cost', v_cost,
      'changes', count(*) filter (where x.target <> x.qty_now),
      'units_in', coalesce(sum(x.target - x.qty_now) filter (where x.target > x.qty_now), 0),
      'units_out', coalesce(sum(x.qty_now - x.target) filter (where x.target < x.qty_now), 0),
      'value', case when v_cost then coalesce(sum((x.target - x.qty_now) * x.unit_cost), 0) end,
      'short', count(*) filter (where x.short_by > 0),
      'items', coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', x.name, 'sku', x.sku,
        'now', x.qty_now, 'target', x.target, 'short_by', x.short_by,
        'unit_cost', case when v_cost then x.unit_cost end) order by abs(x.target - x.qty_now) desc, x.name)
        filter (where x.target <> x.qty_now), '[]'::jsonb))
    from public.erp__count_revert_plan(a) x);
end;
$$;
revoke all on function public.erp_count_revert_preview(uuid) from public, anon;
grant execute on function public.erp_count_revert_preview(uuid) to authenticated;

create or replace function public.erp_count_audit_revert(p_audit uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.erp_count_audits; v_why text; v_items jsonb; v_short jsonb; v_adj uuid; v_num bigint; v_orig bigint;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), ''); v_label text; v_changes integer;
begin
  select * into a from public.erp_count_audits where id = p_audit for update;
  if a.id is null then return jsonb_build_object('ok', false, 'message', 'No encontré ese conteo.'); end if;
  v_why := public.erp__count_scope(a.store_id, a.warehouse_id, array['inventory_adjust']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_why := public.erp__count_revert_block(a);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  if not exists (select 1 from public.erp_warehouses where id = a.warehouse_id and active) then
    return jsonb_build_object('ok', false, 'message', 'La bodega está inactiva.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'qty_after', x.target)) filter (where x.target <> x.qty_now), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', x.name, 'sku', x.sku, 'short_by', x.short_by)) filter (where x.short_by > 0), '[]'::jsonb),
         count(*) filter (where x.target <> x.qty_now)
    into v_items, v_short, v_changes
  from public.erp__count_revert_plan(a) x;

  select number into v_orig from public.erp_adjustments where id = a.adjustment_id;
  v_label := 'Reversa del ' || case when a.mode = 'start' then 'inventario inicial' else 'conteo físico' end
    || ' del ' || to_char(a.created_at at time zone 'America/Bogota', 'DD/MM/YYYY')
    || coalesce(' (ajuste #' || v_orig || ')', '');
  if v_changes > 0 then
    v_adj := public.erp_post_adjustment(a.store_id, a.warehouse_id, 'correction', left(concat_ws(' · ', v_label, v_note), 300), v_items);
    select number into v_num from public.erp_adjustments where id = v_adj;
  end if;

  update public.erp_count_audits
     set reverted_at = now(), reverted_by = auth.uid(), reverted_by_name = public.erp__count_actor(a.store_id),
         revert_adjustment_id = v_adj, revert_note = v_note, revert_short = v_short
   where id = a.id;

  -- Lo que este conteo dio por contado o dejó pendiente vuelve a como estaba.
  delete from public.erp_count_last where warehouse_id = a.warehouse_id and audit_id = a.id;
  delete from public.erp_count_pending where warehouse_id = a.warehouse_id and audit_id = a.id;
  if a.mode = 'start' then
    -- Lo que se sacó vuelve a la bodega sin contar: queda pendiente por contar.
    insert into public.erp_count_pending (warehouse_id, product_id, store_id, since, audit_id, qty_at)
    select a.warehouse_id, (u->>'product_id')::uuid, a.store_id, now(), null, (u->>'qty')::integer
    from jsonb_array_elements(a.removed) u
    where (u->>'qty')::integer > 0 and exists (select 1 from public.products p where p.id = (u->>'product_id')::uuid)
    on conflict (warehouse_id, product_id) do nothing;
  end if;

  begin
    perform public.erp_audit(a.store_id, 'count.reverted', 'erp_count_audits', a.id,
      jsonb_build_object('warehouse_id', a.warehouse_id, 'mode', a.mode, 'adjustment_id', a.adjustment_id,
        'revert_adjustment_id', v_adj, 'changes', v_changes, 'short', jsonb_array_length(v_short), 'note', v_note));
  exception when undefined_function then null;
  end;

  return jsonb_build_object('ok', true, 'adjustment_id', v_adj, 'adjustment_number', v_num, 'changes', v_changes, 'short', jsonb_array_length(v_short));
end;
$$;
revoke all on function public.erp_count_audit_revert(uuid, text) from public, anon;
grant execute on function public.erp_count_audit_revert(uuid, text) to authenticated;

-- Historial: ahora dice si fue inventario inicial y si se revirtió.
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
      'created_at', a.created_at, 'created_by_name', a.created_by_name, 'notes', a.notes, 'mode', a.mode,
      'counted', a.counted_products, 'matched', a.matched_products,
      'over', a.over_products, 'over_units', a.over_units, 'short', a.short_products, 'short_units', a.short_units,
      'uncounted', a.uncounted_products, 'uncounted_units', a.uncounted_units, 'recent', a.recent_products,
      'removed', a.removed_products, 'removed_units', a.removed_units,
      'over_value', case when v_cost then a.over_value end, 'short_value', case when v_cost then a.short_value end,
      'uncounted_value', case when v_cost then a.uncounted_value end, 'removed_value', case when v_cost then a.removed_value end,
      'net_value', case when v_cost then a.over_value - a.short_value - a.removed_value end,
      'reverted_at', a.reverted_at, 'reverted_by_name', a.reverted_by_name
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

-- Informe: lo de antes + lo que se sacó (inventario inicial), la diferencia neta y si se puede revertir.
create or replace function public.erp_count_audit_get(p_audit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.erp_count_audits; v_why text; v_cost boolean; v_block text;
begin
  select * into a from public.erp_count_audits where id = p_audit;
  if a.id is null then return jsonb_build_object('ok', false, 'message', 'No encontré esa auditoría.'); end if;
  v_why := public.erp__count_scope(a.store_id, a.warehouse_id, array['inventory_adjust', 'inventory']);
  if v_why is not null then return jsonb_build_object('ok', false, 'message', v_why); end if;
  v_cost := public.erp_can(a.store_id, 'costs_view');
  v_block := case when public.erp_can(a.store_id, 'inventory_adjust') then public.erp__count_revert_block(a) else 'Revertir pide «Ajustar inventario».' end;
  return jsonb_build_object('ok', true, 'can_cost', v_cost, 'can_revert', v_block is null, 'revert_block', v_block,
    'audit', jsonb_build_object(
      'id', a.id, 'warehouse_id', a.warehouse_id, 'warehouse', (select name from public.erp_warehouses where id = a.warehouse_id),
      'adjustment_id', a.adjustment_id, 'adjustment_number', (select number from public.erp_adjustments where id = a.adjustment_id),
      'created_at', a.created_at, 'created_by_name', a.created_by_name, 'notes', a.notes, 'mode', a.mode,
      'counted', a.counted_products, 'matched', a.matched_products,
      'over', a.over_products, 'over_units', a.over_units, 'short', a.short_products, 'short_units', a.short_units,
      'uncounted', a.uncounted_products, 'uncounted_units', a.uncounted_units, 'recent', a.recent_products,
      'removed', a.removed_products, 'removed_units', a.removed_units,
      'over_value', case when v_cost then a.over_value end, 'short_value', case when v_cost then a.short_value end,
      'uncounted_value', case when v_cost then a.uncounted_value end, 'removed_value', case when v_cost then a.removed_value end,
      'net_value', case when v_cost then a.over_value - a.short_value - a.removed_value end,
      'reverted_at', a.reverted_at, 'reverted_by_name', a.reverted_by_name, 'revert_note', a.revert_note,
      'revert_adjustment_number', (select number from public.erp_adjustments where id = a.revert_adjustment_id),
      'revert_short', a.revert_short),
    'diffs', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', p.name, 'sku', p.sku,
        'before', i.qty_before, 'after', i.qty_after, 'diff', i.diff, 'unit_cost', case when v_cost then i.unit_cost end) order by i.diff, p.name)
      from public.erp_adjustment_items i join public.products p on p.id = i.product_id
      where i.adjustment_id = a.adjustment_id
        and not exists (select 1 from jsonb_array_elements(a.removed) u where (u->>'product_id')::uuid = i.product_id)), '[]'::jsonb),
    'removed', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u->>'product_id', 'name', u->>'name', 'sku', u->>'sku', 'qty', (u->>'qty')::integer,
        'unit_cost', case when v_cost then (u->>'unit_cost')::numeric end))
      from jsonb_array_elements(a.removed) u), '[]'::jsonb),
    'uncounted', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u->>'product_id', 'name', u->>'name', 'sku', u->>'sku', 'qty', (u->>'qty')::integer,
        'unit_cost', case when v_cost then (u->>'unit_cost')::numeric end,
        'still_pending', exists (select 1 from public.erp_count_pending cp where cp.warehouse_id = a.warehouse_id and cp.product_id = (u->>'product_id')::uuid)))
      from jsonb_array_elements(a.uncounted) u), '[]'::jsonb));
end;
$$;
revoke all on function public.erp_count_audit_get(uuid) from public, anon;
grant execute on function public.erp_count_audit_get(uuid) to authenticated;

notify pgrst, 'reload schema';
