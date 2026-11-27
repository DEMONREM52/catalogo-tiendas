-- =====================================================================
-- REMHUB · Conteo en grupo para los ajustes (Logística §36: conteo colaborativo y a ciegas)
--
--   Varias personas cuentan la misma bodega a la vez, cada una desde su celular:
--   · Se abre un conteo para una bodega (Inventario → Ajustes → «👥 Contar en grupo») y se
--     comparte el enlace. Cada quien anota lo que cuenta; si el mismo producto está en dos
--     sitios (vitrina y bodega del fondo), se SUMA lo de cada persona.
--   · Todo queda en la base: se puede seguir mañana o desde otro equipo. Nadie pisa lo de
--     otro: cada persona solo cambia lo suyo.
--   · «A ciegas» (opcional): mientras se cuenta no se muestra lo que dice el sistema.
--   · Contar NO mueve inventario. Al terminar, quien tiene «Ajustes de inventario» lo pasa
--     al ajuste de siempre (mismo informe en plata, inventario inicial, kardex, deuda del
--     punto) y, al aplicarlo, el conteo queda «aplicado».
--   · Contado en 0 ≠ no contado: un 0 anotado sí cuenta.
--   · Quién: «Inventario» y («Conteos físicos» o «Ajustes de inventario»), solo de sus puntos.
--     Terminar, reabrir, aplicar o anular: «Ajustes de inventario».
--
--   erp_gc_start · erp_gc_list · erp_gc_get · erp_gc_set · erp_gc_remove · erp_gc_close ·
--   erp_gc_reopen · erp_gc_applied · erp_gc_cancel
-- No borra datos. Es idempotente.
-- =====================================================================

create table if not exists public.erp_group_counts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses(id) on delete cascade,
  name text,
  blind boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed', 'applied', 'cancelled')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  finished_at timestamptz,
  finished_by_name text,
  check (char_length(coalesce(name, '')) <= 80)
);
create index if not exists erp_group_counts_store on public.erp_group_counts (store_id, status, created_at desc);

create table if not exists public.erp_group_count_lines (
  count_id uuid not null references public.erp_group_counts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null,
  user_name text,
  qty integer not null check (qty >= 0 and qty <= 1000000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (count_id, product_id, user_id)
);
create index if not exists erp_group_count_lines_count on public.erp_group_count_lines (count_id);

-- Llaves de cada lectura del escáner (+1): un reintento no suma dos veces.
create table if not exists public.erp_group_count_ops (
  key uuid primary key,
  count_id uuid not null references public.erp_group_counts(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

-- Solo por las funciones (revisan tienda, permiso y punto).
alter table public.erp_group_counts enable row level security;
alter table public.erp_group_count_lines enable row level security;
alter table public.erp_group_count_ops enable row level security;
revoke all on public.erp_group_counts, public.erp_group_count_lines, public.erp_group_count_ops from anon, authenticated;

-- ---------------------------------------------------------------- acceso

/** 'adjust' (puede terminar y aplicar), 'count' (solo contar) o null. Siempre dentro de sus puntos. */
create or replace function public.erp__gc_access(p_store uuid, p_warehouse uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pts uuid[]; v_adj boolean;
begin
  if auth.uid() is null then return null; end if;
  if not public.erp_can(p_store, 'inventory') then return null; end if;
  v_adj := public.erp_can(p_store, 'inventory_adjust');
  if not (v_adj or public.erp_can(p_store, 'inventory_counts')) then return null; end if;
  v_pts := public.erp_my_points(p_store);
  if v_pts is not null and not (p_warehouse = any (v_pts)) then return null; end if;
  return case when v_adj then 'adjust' else 'count' end;
end $$;
revoke all on function public.erp__gc_access(uuid, uuid) from public, anon, authenticated;

/** El conteo, bloqueado para cambiarlo, con el acceso de quien llama. */
create or replace function public.erp__gc_lock(p_id uuid, p_need text, p_status text[])
returns public.erp_group_counts language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_acc text;
begin
  select * into g from public.erp_group_counts where id = p_id for update;
  if not found then raise exception 'Conteo no encontrado.'; end if;
  v_acc := public.erp__gc_access(g.store_id, g.warehouse_id);
  if v_acc is null then raise exception 'No tienes permiso para este conteo.'; end if;
  if p_need = 'adjust' and v_acc <> 'adjust' then raise exception 'Eso lo hace quien tiene «Ajustes de inventario».'; end if;
  if not (g.status = any (p_status)) then
    raise exception '%', case g.status when 'closed' then 'El conteo ya se terminó: están revisándolo para aplicarlo.'
      when 'applied' then 'Este conteo ya se aplicó.' when 'cancelled' then 'Este conteo se anuló.' else 'El conteo sigue abierto.' end;
  end if;
  return g;
end $$;
revoke all on function public.erp__gc_lock(uuid, text, text[]) from public, anon, authenticated;

create or replace function public.erp__gc_audit(g public.erp_group_counts, p_action text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.erp_audit(g.store_id, p_action, 'erp_group_counts', g.id, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('warehouse', g.warehouse_id, 'name', g.name));
exception when undefined_function then null;
end $$;
revoke all on function public.erp__gc_audit(public.erp_group_counts, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- abrir y listar

/** Abrir un conteo en grupo. Si ya hay uno abierto (o terminado sin aplicar) en esa bodega, entra a ese (no se duplican). */
create or replace function public.erp_gc_start(p_store uuid, p_warehouse uuid, p_name text default null, p_blind boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  if public.erp__gc_access(p_store, p_warehouse) is null then raise exception 'No tienes permiso para contar en esa bodega.'; end if;
  if not exists (select 1 from public.erp_warehouses where id = p_warehouse and store_id = p_store and active) then raise exception 'Bodega no válida.'; end if;
  perform pg_advisory_xact_lock(hashtext('erp_gc:' || p_warehouse::text));
  select * into g from public.erp_group_counts where warehouse_id = p_warehouse and status in ('open', 'closed') order by created_at desc limit 1;
  if found then return jsonb_build_object('ok', true, 'id', g.id, 'existing', true); end if;
  insert into public.erp_group_counts (store_id, warehouse_id, name, blind, created_by, created_by_name)
  values (p_store, p_warehouse, nullif(btrim(left(coalesce(p_name, ''), 80)), ''), coalesce(p_blind, false), auth.uid(), public.erp_actor_name(p_store))
  returning * into g;
  perform public.erp__gc_audit(g, 'group_count.start', jsonb_build_object('blind', g.blind));
  return jsonb_build_object('ok', true, 'id', g.id, 'existing', false);
end $$;
revoke all on function public.erp_gc_start(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.erp_gc_start(uuid, uuid, text, boolean) to authenticated;

/** Conteos en grupo abiertos o por aplicar (y los aplicados de la última semana) de las bodegas que puedes contar. */
create or replace function public.erp_gc_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'warehouse_id', g.warehouse_id, 'warehouse', w.name, 'name', g.name, 'blind', g.blind, 'status', g.status,
      'created_by_name', g.created_by_name, 'created_at', g.created_at, 'updated_at', g.updated_at,
      'people', (select count(distinct l.user_id) from public.erp_group_count_lines l where l.count_id = g.id),
      'products', (select count(distinct l.product_id) from public.erp_group_count_lines l where l.count_id = g.id),
      'units', (select coalesce(sum(l.qty), 0) from public.erp_group_count_lines l where l.count_id = g.id)
    ) order by g.created_at desc)
    from public.erp_group_counts g join public.erp_warehouses w on w.id = g.warehouse_id
   where g.store_id = p_store
     and (g.status in ('open', 'closed') or (g.status = 'applied' and g.finished_at > now() - interval '7 days'))
     and public.erp__gc_access(g.store_id, g.warehouse_id) is not null), '[]'::jsonb);
end $$;
revoke all on function public.erp_gc_list(uuid) from public, anon;
grant execute on function public.erp_gc_list(uuid) to authenticated;

/**
 * Un conteo con lo de todos: total por producto, lo tuyo y quién contó cuánto.
 * Si es a ciegas, no trae lo que dice el sistema (tampoco a quien puede aplicar: lo ve en el informe del ajuste).
 */
create or replace function public.erp_gc_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g public.erp_group_counts; v_acc text; v_wh text;
begin
  select * into g from public.erp_group_counts where id = p_id;
  if not found then return null; end if;
  v_acc := public.erp__gc_access(g.store_id, g.warehouse_id);
  if v_acc is null then return null; end if;
  select name into v_wh from public.erp_warehouses where id = g.warehouse_id;
  return jsonb_build_object(
    'count', jsonb_build_object('id', g.id, 'store_id', g.store_id, 'warehouse_id', g.warehouse_id, 'warehouse', v_wh, 'name', g.name,
      'blind', g.blind, 'status', g.status, 'created_by_name', g.created_by_name, 'created_at', g.created_at, 'updated_at', g.updated_at,
      'closed_by_name', g.closed_by_name, 'closed_at', g.closed_at, 'finished_by_name', g.finished_by_name, 'finished_at', g.finished_at),
    'can_adjust', v_acc = 'adjust',
    'me', public.erp_actor_name(g.store_id),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', x.user_name, 'products', x.n, 'units', x.u, 'mine', x.user_id = auth.uid()) order by x.u desc)
                          from (select user_id, max(user_name) user_name, count(*) n, sum(qty) u from public.erp_group_count_lines where count_id = g.id group by user_id) x), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'image_url', p.image_url,
        'total', x.total, 'mine', x.mine,
        'by', x.by_people, 'updated_at', x.at,
        'system', case when g.blind then null else coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = g.warehouse_id and sl.product_id = p.id), 0) end
      ) order by x.at desc)
      from (select l.product_id, sum(l.qty)::int total, max(case when l.user_id = auth.uid() then l.qty end) mine, max(l.updated_at) at,
                   jsonb_agg(jsonb_build_object('name', l.user_name, 'qty', l.qty) order by l.updated_at) by_people
              from public.erp_group_count_lines l where l.count_id = g.id group by l.product_id) x
      join public.products p on p.id = x.product_id), '[]'::jsonb));
end $$;
revoke all on function public.erp_gc_get(uuid) from public, anon;
grant execute on function public.erp_gc_get(uuid) to authenticated;

-- ---------------------------------------------------------------- contar

/**
 * Anotar lo que TÚ contaste de un producto: p_add = false pone la cantidad; p_add = true suma (escáner: +1, o −1 para corregir).
 * p_key evita que un reintento sume dos veces. Nunca cambia lo de otra persona.
 */
create or replace function public.erp_gc_set(p_id uuid, p_product uuid, p_qty integer, p_add boolean default false, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_new int; v_mine int; v_total int;
begin
  g := public.erp__gc_lock(p_id, 'count', array['open']);
  if p_qty is null or abs(p_qty) > 1000000 then raise exception 'Escribe una cantidad válida.'; end if;
  if not p_add and p_qty < 0 then raise exception 'La cantidad no puede ser negativa.'; end if;
  if not exists (select 1 from public.products where id = p_product and store_id = g.store_id) then raise exception 'Ese producto no es de la tienda.'; end if;
  if p_key is not null then
    if exists (select 1 from public.erp_group_count_ops where key = p_key) then
      select coalesce(sum(qty), 0) into v_total from public.erp_group_count_lines where count_id = g.id and product_id = p_product;
      select qty into v_mine from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = auth.uid();
      return jsonb_build_object('ok', true, 'mine', coalesce(v_mine, 0), 'total', v_total, 'repeated', true);
    end if;
    insert into public.erp_group_count_ops (key, count_id) values (p_key, g.id);
  end if;
  select qty into v_mine from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = auth.uid() for update;
  v_new := case when p_add then coalesce(v_mine, 0) + p_qty else p_qty end;
  if v_new < 0 then v_new := 0; end if;
  if v_new > 1000000 then raise exception 'Escribe una cantidad válida.'; end if;
  insert into public.erp_group_count_lines (count_id, product_id, user_id, user_name, qty)
  values (g.id, p_product, auth.uid(), public.erp_actor_name(g.store_id), v_new)
  on conflict (count_id, product_id, user_id) do update set qty = excluded.qty, user_name = excluded.user_name, updated_at = clock_timestamp();
  update public.erp_group_counts set updated_at = clock_timestamp() where id = g.id;
  select coalesce(sum(qty), 0) into v_total from public.erp_group_count_lines where count_id = g.id and product_id = p_product;
  return jsonb_build_object('ok', true, 'mine', v_new, 'total', v_total);
end $$;
revoke all on function public.erp_gc_set(uuid, uuid, integer, boolean, uuid) from public, anon;
grant execute on function public.erp_gc_set(uuid, uuid, integer, boolean, uuid) to authenticated;

/** Quitar lo que TÚ anotaste de un producto (como si no lo hubieras contado). */
create or replace function public.erp_gc_remove(p_id uuid, p_product uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_lock(p_id, 'count', array['open']);
  delete from public.erp_group_count_lines where count_id = g.id and product_id = p_product and user_id = auth.uid();
  update public.erp_group_counts set updated_at = clock_timestamp() where id = g.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_gc_remove(uuid, uuid) from public, anon;
grant execute on function public.erp_gc_remove(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- terminar y aplicar

/**
 * Terminar el conteo (nadie más anota) y traer el total por producto para el ajuste, con lo que hay ahora en la bodega.
 * Se aplica con el ajuste de siempre (Inventario → Ajustes); si no se aplica, se puede reabrir.
 */
create or replace function public.erp_gc_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts; v_who text;
begin
  g := public.erp__gc_lock(p_id, 'adjust', array['open', 'closed']);
  if g.status = 'open' then
    v_who := public.erp_actor_name(g.store_id);
    update public.erp_group_counts set status = 'closed', closed_at = clock_timestamp(), closed_by_name = v_who, updated_at = clock_timestamp()
     where id = g.id returning * into g;
    perform public.erp__gc_audit(g, 'group_count.close', jsonb_build_object('products', (select count(distinct product_id) from public.erp_group_count_lines where count_id = g.id)));
  end if;
  return jsonb_build_object('ok', true, 'warehouse_id', g.warehouse_id, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'sku', p.sku, 'qty', x.total,
             'current', coalesce((select sl.qty from public.erp_stock_levels sl where sl.warehouse_id = g.warehouse_id and sl.product_id = p.id), 0)) order by p.name)
      from (select product_id, sum(qty)::int total from public.erp_group_count_lines where count_id = g.id group by product_id) x
      join public.products p on p.id = x.product_id), '[]'::jsonb));
end $$;
revoke all on function public.erp_gc_close(uuid) from public, anon;
grant execute on function public.erp_gc_close(uuid) to authenticated;

/** Volver a abrir un conteo terminado que no se aplicó (para seguir contando). */
create or replace function public.erp_gc_reopen(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_lock(p_id, 'adjust', array['closed']);
  update public.erp_group_counts set status = 'open', closed_at = null, closed_by_name = null, updated_at = clock_timestamp() where id = g.id returning * into g;
  perform public.erp__gc_audit(g, 'group_count.reopen', null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_gc_reopen(uuid) from public, anon;
grant execute on function public.erp_gc_reopen(uuid) to authenticated;

/** El ajuste se aplicó con este conteo: queda «aplicado» (ya no se puede contar ni reabrir). */
create or replace function public.erp_gc_applied(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_lock(p_id, 'adjust', array['closed', 'applied']);
  if g.status = 'applied' then return jsonb_build_object('ok', true, 'repeated', true); end if;
  update public.erp_group_counts set status = 'applied', finished_at = clock_timestamp(), finished_by_name = public.erp_actor_name(g.store_id), updated_at = clock_timestamp()
   where id = g.id returning * into g;
  perform public.erp__gc_audit(g, 'group_count.applied', null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_gc_applied(uuid) from public, anon;
grant execute on function public.erp_gc_applied(uuid) to authenticated;

/** Anular un conteo (no se aplica nada; lo contado queda como constancia). */
create or replace function public.erp_gc_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.erp_group_counts;
begin
  g := public.erp__gc_lock(p_id, 'adjust', array['open', 'closed']);
  update public.erp_group_counts set status = 'cancelled', finished_at = clock_timestamp(), finished_by_name = public.erp_actor_name(g.store_id), updated_at = clock_timestamp()
   where id = g.id returning * into g;
  perform public.erp__gc_audit(g, 'group_count.cancel', null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.erp_gc_cancel(uuid) from public, anon;
grant execute on function public.erp_gc_cancel(uuid) to authenticated;

notify pgrst, 'reload schema';
